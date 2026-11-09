import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
const { getClient, listConnections, notify, emit } = vi.hoisted(() => ({ getClient: vi.fn(), listConnections: vi.fn(), notify: vi.fn(), emit: vi.fn() }))
vi.mock('../../src/main/xapi/connection-manager', () => ({ connectionManager: { getClient, listConnections } }))
vi.mock('../../src/main/xapi/services/alert-notification.service', () => ({ sendAlertNotification: notify }))
vi.mock('../../src/main/xapi/services/alert.service', () => ({ emitAlertTriggered: emit }))
let engine: typeof import('../../src/main/xapi/services/alert-engine.service')
let metrics: typeof import('../../src/main/xapi/services/metrics-db.service')
let rules: typeof import('../../src/main/xapi/services/alert-rule.db')
let history: typeof import('../../src/main/xapi/services/alert-history.db')
let now: number
function samples(value: number, from = now - 60_000, to = now, connectionId = 'c1', kind = 'host') {
  for (let timestamp = from; timestamp <= to; timestamp += 10_000) {
    const poolUuid = listConnections.mock.results.at(-1)?.value?.find((conn: any) => conn.id === connectionId)?.poolUuid || (connectionId === 'c1' ? 'pool-a' : 'pool-b')
    const point = { connectionId, poolUuid, timestamp, cpuPercent: value, memoryPercent: 40 }
    if (kind === 'vm') metrics.persistVmMetricSample({ ...point, vmRef: 'OpaqueRef:vm' })
    else metrics.persistMetricSample({ ...point, hostRef: 'OpaqueRef:same' })
  }
}
function createRule(extra: Record<string, any> = {}) {
  return rules.createAlertRule({ name: 'CPU', metricType: 'cpu', operator: '>', threshold: 50, duration: 1, severity: 'warning', enabled: true, ...extra })
}
beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks(); vi.useFakeTimers(); now = Date.now(); vi.setSystemTime(now)
  engine = await import('../../src/main/xapi/services/alert-engine.service')
  metrics = await import('../../src/main/xapi/services/metrics-db.service')
  rules = await import('../../src/main/xapi/services/alert-rule.db')
  history = await import('../../src/main/xapi/services/alert-history.db')
  metrics.initDatabase(); metrics.markDefaultRulesInitialized()
  listConnections.mockReturnValue([{ id: 'c1', state: 'connected', poolName: 'Pool A', poolUuid: 'pool-a' }])
  getClient.mockReturnValue({ callWithSession: vi.fn().mockResolvedValue({ 'OpaqueRef:same': { name_label: 'host' } }) })
  notify.mockResolvedValue({ email: false, webhook: false })
})
afterEach(async () => { await engine.evaluateOnce().catch(() => {}); engine.stopAlertEngine(); await metrics.closeDatabase(); vi.useRealTimers() })
describe('continuous, scoped, durable alert evaluation', () => {
  it('requires a complete duration, not one high point', async () => {
    createRule(); samples(90, now, now)
    expect(await engine.evaluateOnce()).toEqual([])
    expect(notify).not.toHaveBeenCalled()
  })
  it('rejects sparse windows with missing samples', async () => {
    createRule(); samples(90, now - 60_000, now - 60_000); samples(90, now, now)
    expect(await engine.evaluateOnce()).toEqual([])
  })
  it('rejects a short window even with many samples', async () => {
    createRule(); samples(90, now - 30_000)
    expect(await engine.evaluateOnce()).toEqual([])
  })
  it('triggers once for an observed uninterrupted threshold duration', async () => {
    const rule = createRule(); samples(90)
    expect(await engine.evaluateOnce()).toEqual([expect.objectContaining({ ruleId: rule.id, connectionId: 'c1', poolUuid: 'pool-a', status: 'active', entityRef: 'OpaqueRef:same' })])
    expect(await engine.evaluateOnce()).toEqual([])
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ transition: 'triggered', poolUuid: 'pool-a', poolName: 'Pool A', eventId: expect.any(String) }))
  })
  it('does not use a missing RRD metric converted for display as a real zero or recovery', async () => {
    createRule(); samples(90)
    const [incident] = await engine.evaluateOnce()
    now += 70_000; vi.setSystemTime(now)
    for (let timestamp = now - 60_000; timestamp <= now; timestamp += 10_000) {
      metrics.persistMetricSample({ connectionId: 'c1', poolUuid: 'pool-a', hostRef: 'OpaqueRef:same', timestamp, cpuPercent: 0, memoryPercent: 0, availableMetrics: [] })
    }
    expect(await engine.evaluateOnce()).toEqual([])
    expect(history.getAlertHistory()[0]).toMatchObject({ id: incident.id, status: 'active' })
    expect(notify).toHaveBeenCalledTimes(1)
  })
  it('does not retrigger an acknowledged but still active incident', async () => {
    createRule(); samples(90)
    const [incident] = await engine.evaluateOnce(); history.acknowledgeAlert(incident.id)
    expect(await engine.evaluateOnce()).toEqual([])
    expect(history.getAlertHistory()).toHaveLength(1)
  })
  it('keeps identical OpaqueRefs in separate pool connections independent', async () => {
    createRule(); samples(90); samples(90, now - 60_000, now, 'c2')
    listConnections.mockReturnValue([{ id: 'c1', state: 'connected', poolUuid: 'pool-a' }, { id: 'c2', state: 'connected', poolUuid: 'pool-b' }])
    expect((await engine.evaluateOnce()).map((record) => record.connectionId)).toEqual(['c1', 'c2'])
  })
  it('does not deduplicate another pool UUID on a reused connection identity', async () => {
    createRule(); samples(90)
    await engine.evaluateOnce()
    listConnections.mockReturnValue([{ id: 'c1', state: 'connected', poolUuid: 'pool-b' }])
    expect(await engine.evaluateOnce()).toHaveLength(0)
    // Only samples observed from the replacement pool can trigger its incident.
    samples(90)
    expect(await engine.evaluateOnce()).toHaveLength(1)
  })
  it('binds a targeted rule to its configured connection', async () => {
    createRule({ connectionId: 'c1', targetType: 'host', targetRef: 'OpaqueRef:same' }); samples(90); samples(90, now - 60_000, now, 'c2')
    listConnections.mockReturnValue([{ id: 'c1', state: 'connected' }, { id: 'c2', state: 'connected' }])
    expect((await engine.evaluateOnce()).map((record) => record.connectionId)).toEqual(['c1'])
  })
  it('reports an ambiguous legacy targeted rule rather than applying its ref to all pools', async () => {
    createRule({ targetType: 'host', targetRef: 'OpaqueRef:same' }); samples(90)
    listConnections.mockReturnValue([{ id: 'c1', state: 'connected' }, { id: 'c2', state: 'connected' }])
    await expect(engine.evaluateOnce()).rejects.toThrow('旧版定向规则未绑定资源池')
  })
  it('evaluates VM windows independently of host samples', async () => {
    createRule({ connectionId: 'c1', targetType: 'vm', targetRef: 'OpaqueRef:vm' }); samples(90, now - 60_000, now, 'c1', 'vm')
    expect(await engine.evaluateOnce()).toEqual([expect.objectContaining({ entityRef: 'OpaqueRef:vm' })])
  })
  it('requires continuous recovery and sends one resolved transition', async () => {
    createRule(); samples(90)
    const [incident] = await engine.evaluateOnce()
    history.acknowledgeAlert(incident.id)
    now += 70_000; vi.setSystemTime(now)
    samples(20, now, now)
    await engine.evaluateOnce(); expect(history.getAlertHistory()[0].status).toBe('acknowledged')
    samples(20, now - 60_000, now)
    await engine.evaluateOnce(); expect(history.getAlertHistory()[0].status).toBe('resolved')
    expect(notify).toHaveBeenLastCalledWith(expect.objectContaining({ eventId: incident.id, transition: 'resolved' }))
    expect(emit).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'resolved' }))
    await engine.evaluateOnce(); expect(notify).toHaveBeenCalledTimes(2)
  })
  it('does not infer recovery from a disconnected pool or stale metrics', async () => {
    createRule(); samples(90); await engine.evaluateOnce()
    now += 120_000; vi.setSystemTime(now)
    await engine.evaluateOnce(); expect(history.getAlertHistory()[0].status).toBe('active')
    listConnections.mockReturnValue([{ id: 'c1', state: 'disconnected', poolUuid: 'pool-a' }])
    samples(20); await engine.evaluateOnce(); expect(history.getAlertHistory()[0].status).toBe('active')
  })
  it('preserves a raw threshold break even in a large sample window', async () => {
    createRule(); samples(90)
    metrics.persistMetricSample({ connectionId: 'c1', poolUuid: 'pool-a', hostRef: 'OpaqueRef:same', timestamp: now - 30_000, cpuPercent: 20, memoryPercent: 40 })
    expect(await engine.evaluateOnce()).toEqual([])
  })
  it('coalesces concurrent evaluations and sends only once', async () => {
    createRule(); samples(90)
    const first = engine.evaluateOnce(), second = engine.evaluateOnce()
    expect(first).toBe(second)
    await Promise.all([first, second]); expect(history.getAlertHistory()).toHaveLength(1); expect(notify).toHaveBeenCalledTimes(1)
  })
  it('makes connection read failures visible to manual evaluation', async () => {
    createRule(); getClient.mockReturnValue({ callWithSession: vi.fn().mockRejectedValue(new Error('SESSION_INVALID')) })
    await expect(engine.evaluateOnce()).rejects.toThrow('ALERT_EVALUATION_PARTIAL')
    expect(engine.getEngineStatus().lastErrors).toEqual([expect.stringContaining('SESSION_INVALID')])
  })
  it('does not evaluate disabled rules', async () => {
    createRule({ enabled: false }); samples(90)
    expect(await engine.evaluateOnce()).toEqual([])
  })
  it('starts, replaces, and stops its periodic timer', async () => {
    engine.startAlertEngine(5000); await engine.evaluateOnce(); expect(engine.getEngineStatus().isRunning).toBe(true)
    engine.startAlertEngine(10000); await engine.evaluateOnce(); engine.stopAlertEngine(); expect(engine.getEngineStatus().isRunning).toBe(false)
  })
})
