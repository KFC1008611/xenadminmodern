import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const { encryption, sendMail, close, fetchMock } = vi.hoisted(() => ({ encryption: vi.fn(() => true), sendMail: vi.fn(), close: vi.fn(), fetchMock: vi.fn() }))
vi.mock('electron', () => ({ safeStorage: {
  isEncryptionAvailable: encryption,
  getSelectedStorageBackend: () => 'gnome_libsecret',
  encryptString: (value: string) => Buffer.from(`encrypted:${Buffer.from(value).toString('base64')}`),
  decryptString: (value: Buffer) => Buffer.from(value.toString().slice(10), 'base64').toString(),
} }))
vi.mock('nodemailer', () => ({ createTransport: () => ({ sendMail, close }) }))
let directory: string
let metrics: typeof import('../../src/main/xapi/services/metrics-db.service')
async function load() {
  const persistence = await import('../../src/main/persistence/json-store')
  persistence.configureJsonStoreDirectory(directory)
  metrics = await import('../../src/main/xapi/services/metrics-db.service')
  await metrics.initDatabase()
  return { metrics, rules: await import('../../src/main/xapi/services/alert-rule.service'), dbRules: await import('../../src/main/xapi/services/alert-rule.db'), history: await import('../../src/main/xapi/services/alert-history.db'), notifications: await import('../../src/main/xapi/services/alert-notification.service') }
}
beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); encryption.mockReturnValue(true); sendMail.mockResolvedValue({ accepted: ['ops@example.test'] }); fetchMock.mockResolvedValue({ ok: true }); vi.stubGlobal('fetch', fetchMock); directory = mkdtempSync(join(tmpdir(), 'xenadmin-observability-')) })
afterEach(async () => { await metrics?.closeDatabase(); (await import('../../src/main/persistence/json-store')).configureJsonStoreDirectory(null); rmSync(directory, { recursive: true, force: true }); vi.unstubAllGlobals() })
const input = { name: 'CPU', metricType: 'cpu' as const, operator: '>' as const, threshold: 80, duration: 1, severity: 'warning' as const, enabled: true }
const config = { enabled: true, email: { enabled: true, host: 'smtp.example.test', port: 587, secure: false, auth: { user: 'sender', pass: 'smtp-password' }, from: 'from@example.test', to: 'ops@example.test' }, webhook: { enabled: true, url: 'https://hook.example.test/secret-token', headers: { Authorization: 'Bearer token-value' }, secret: 'hmac-secret' }, filterSeverities: ['warning' as const] }
const payload = { eventId: 'incident-1', transition: 'triggered' as const, poolUuid: 'pool-1', ruleName: '<script>CPU</script>', connectionId: 'c1', poolName: 'Pool', entityRef: 'OpaqueRef:host', entityName: 'Host', severity: 'warning' as const, message: 'High CPU', timestamp: 100, metricType: 'cpu', metricValue: 90, threshold: 0 }

describe('observability persistence', () => {
  it('rolls back an unsaved rule change when durable storage is unavailable', async () => {
    const modules = await load()
    modules.metrics.initDatabase(); modules.metrics.markDefaultRulesInitialized()
    const rule = modules.rules.createAlertRule(input)
    const persistence = await import('../../src/main/persistence/json-store')
    const invalidDirectory = join(directory, 'not-a-directory')
    persistence.configureJsonStoreDirectory(invalidDirectory)
    rmSync(invalidDirectory, { recursive: true })
    writeFileSync(invalidDirectory, 'keep')
    try {
      expect(() => modules.rules.updateAlertRule(rule.id, { name: 'unsaved' })).toThrow()
      expect(modules.rules.getAlertRules()[0].name).toBe(input.name)
      expect(() => modules.rules.createAlertRule({ ...input, name: 'unsaved second' })).toThrow()
      expect(modules.rules.getAlertRules()).toHaveLength(1)
    } finally { persistence.configureJsonStoreDirectory(directory) }
  })
  it('restores rules, acknowledged history, metrics, and explicit deletion of all defaults', async () => {
    let modules = await load(); modules.metrics.initDatabase(); modules.metrics.markDefaultRulesInitialized()
    const rule = modules.rules.createAlertRule(input)
    const incident = modules.history.createAlertHistory({ ruleId: rule.id, ruleName: rule.name, connectionId: 'c1', poolUuid: 'pool-1', entityRef: 'OpaqueRef:host', entityName: 'Host', metricType: 'cpu', metricValue: 90, threshold: 80, severity: 'warning', triggeredAt: Date.now(), status: 'active' })
    modules.history.acknowledgeAlert(incident.id)
    const timestamp = Date.now()
    modules.metrics.persistMetricSample({ connectionId: 'c1', poolUuid: 'pool-1', hostRef: 'OpaqueRef:host', timestamp, cpuPercent: 90, memoryPercent: 40 })
    await modules.metrics.closeDatabase(); vi.resetModules(); modules = await load()
    expect(modules.rules.getAlertRules()).toEqual([expect.objectContaining({ id: rule.id })])
    expect(modules.history.getAlertHistory()).toEqual([expect.objectContaining({ id: incident.id, status: 'acknowledged', poolUuid: 'pool-1' })])
    expect(modules.metrics.getAlertMetricWindow('host', 'c1', 'OpaqueRef:host', timestamp, timestamp, 'pool-1')).toHaveLength(1)
    modules.rules.deleteAlertRule(rule.id); await modules.metrics.closeDatabase(); vi.resetModules(); modules = await load()
    expect(modules.rules.getAlertRules()).toEqual([])
    expect(modules.history.getAlertHistory()[0].status).toBe('resolved')
  })
  it('bounds samples and replaces duplicate timestamps within one pool without mixing another pool', async () => {
    const { metrics } = await load(); const now = Date.now()
    metrics.persistMetricBatch(Array.from({ length: 100_100 }, (_, index) => ({ connectionId: 'c', poolUuid: 'pool-a', hostRef: 'OpaqueRef:h', timestamp: now - index, cpuPercent: 70, memoryPercent: 30 })))
    const window = metrics.getAlertMetricWindow('host', 'c', 'OpaqueRef:h', now - 200_000, now, 'pool-a')
    expect(window).toHaveLength(100_000)
    metrics.persistMetricSample({ connectionId: 'c', poolUuid: 'pool-a', hostRef: 'OpaqueRef:h', timestamp: now, cpuPercent: 90, memoryPercent: 30 })
    expect(metrics.getAlertMetricWindow('host', 'c', 'OpaqueRef:h', now, now, 'pool-a')).toHaveLength(1)
    metrics.persistMetricSample({ connectionId: 'c', poolUuid: 'pool-b', hostRef: 'OpaqueRef:h', timestamp: now, cpuPercent: 10, memoryPercent: 30 })
    expect(metrics.getAlertMetricWindow('host', 'c', 'OpaqueRef:h', now, now, 'pool-a')[0].cpuPercent).toBe(90)
    expect(metrics.getAlertMetricWindow('host', 'c', 'OpaqueRef:h', now, now, 'pool-b')[0].cpuPercent).toBe(10)
  })
  it('writes notification secrets only as OS-encrypted payload and reloads them', async () => {
    let { notifications } = await load(); notifications.saveNotificationConfig(config)
    const saved = readFileSync(join(directory, 'notification-config.json'), 'utf8')
    for (const secret of ['smtp-password', 'secret-token', 'token-value', 'hmac-secret']) expect(saved).not.toContain(secret)
    vi.resetModules(); ({ notifications } = await load())
    expect(notifications.getNotificationConfig()).toEqual(config)
  })
  it('does not save secrets if system encryption is unavailable', async () => {
    const { notifications } = await load(); encryption.mockReturnValue(false)
    expect(() => notifications.saveNotificationConfig(config)).toThrow('NOTIFICATION_SECRET_STORE_UNAVAILABLE')
  })
  it('deduplicates successful trigger delivery across process reload and separately sends recovery', async () => {
    let { notifications } = await load(); notifications.saveNotificationConfig(config)
    await Promise.all([notifications.sendAlertNotification(payload), notifications.sendAlertNotification(payload)])
    expect(sendMail).toHaveBeenCalledTimes(1); expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(sendMail.mock.calls[0][0].html).not.toContain('<script>'); expect(sendMail.mock.calls[0][0].html).toContain('&lt;script&gt;')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: 'error', signal: expect.any(AbortSignal), headers: expect.objectContaining({ 'X-Alert-Signature': expect.any(String) }) })
    vi.resetModules(); ({ notifications } = await load()); await notifications.sendAlertNotification(payload)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await notifications.sendAlertNotification({ ...payload, transition: 'resolved', timestamp: 200 })
    expect(fetchMock).toHaveBeenCalledTimes(2); expect(notifications.getNotificationHistory()).toHaveLength(2)
  })
  it('records uncertain delivery without exposing URLs or automatically resending', async () => {
    const { notifications } = await load(); notifications.saveNotificationConfig({ ...config, email: { ...config.email, enabled: false } })
    fetchMock.mockRejectedValue(new Error('request failed https://hook.example.test/secret-token'))
    expect(await notifications.sendAlertNotification(payload)).toEqual({ email: false, webhook: false })
    expect(notifications.getNotificationHistory()[0]).toMatchObject({ status: 'unconfirmed' })
    expect(JSON.stringify(notifications.getNotificationHistory())).not.toContain('secret-token')
    await notifications.sendAlertNotification(payload); expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('reports an explicit rejection and does not call a disabled test successful', async () => {
    const { notifications } = await load(); notifications.saveNotificationConfig({ ...config, email: { ...config.email, enabled: false } })
    fetchMock.mockResolvedValue({ ok: false, status: 403 })
    await notifications.sendAlertNotification(payload)
    expect(notifications.getNotificationHistory()[0].status).toBe('failed')
    await expect(notifications.testNotification('webhook', { enabled: false })).rejects.toThrow('NOTIFICATION_CHANNEL_DISABLED')
  })
})
