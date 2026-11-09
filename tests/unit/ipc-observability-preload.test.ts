import { describe, expect, it, vi } from 'vitest'
import { createObservabilityApi } from '../../src/preload/observability-api'

const historyRecord = {
  id: 'alert-1',
  ruleId: 'rule-1',
  ruleName: 'High CPU',
  connectionId: 'pool-1',
  entityRef: 'OpaqueRef:host',
  entityName: 'host-1',
  metricType: 'cpu' as const,
  metricValue: 95,
  threshold: 90,
  severity: 'warning' as const,
  triggeredAt: 1_700_000_000_000,
  status: 'active' as const,
}

describe('observability preload IPC contracts', () => {
  it('exposes the exact invoke groups and a subscriber without a push invoke', () => {
    const api = createObservabilityApi({
      invoke: vi.fn(), on: vi.fn(), removeListener: vi.fn(),
    })

    expect(Object.keys(api.metrics)).toEqual([
      'startCollection', 'stopCollection', 'getHistory', 'getRange',
      'getStats', 'getVmHistory', 'getCollectionError',
    ])
    expect(Object.keys(api.alerts)).toEqual(['getAll', 'dismiss', 'dismissAll'])
    expect(Object.keys(api.alertRules)).toEqual(['list', 'create', 'update', 'delete', 'evaluate'])
    expect(Object.keys(api.alertHistory)).toEqual(['list', 'acknowledge', 'getCount'])
    expect(Object.keys(api.alertNotify)).toEqual([
      'getConfig', 'saveConfig', 'test', 'getHistory', 'send',
    ])
    expect(Object.keys(api)).toEqual([
      'metrics', 'alerts', 'alertRules', 'alertHistory', 'alertNotify', 'onAlertTriggered',
    ])
  })

  it('pairs all 23 invoke methods and preserves explicit undefined optionals', async () => {
    const invoke = vi.fn()
    const api = createObservabilityApi({ invoke, on: vi.fn(), removeListener: vi.fn() })
    const metricPoint = { timestamp: 100, cpuPercent: 10, memoryPercent: 20 }
    const rule = {
      id: 'rule-1', name: 'High CPU', metricType: 'cpu' as const,
      operator: '>' as const, threshold: 90, duration: 5,
      severity: 'warning' as const, enabled: true,
      createdAt: 100, updatedAt: 100,
    }
    const config = {
      enabled: false,
      email: {
        enabled: false, host: '', port: 587, secure: false,
        auth: { user: '', pass: '' }, from: '', to: '',
      },
      webhook: { enabled: false, url: '' },
      filterSeverities: ['error' as const],
    }
    const testEmailConfig = {
      enabled: true,
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      auth: { user: 'alerts', pass: 'secret' },
      from: 'alerts@example.com',
      to: 'ops@example.com',
    }
    const cases: Array<{
      method: (...args: never[]) => Promise<unknown>
      channel: string
      args: unknown[]
      result: unknown
    }> = [
      { method: api.metrics.startCollection, channel: 'metrics:startCollection', args: ['pool-1'], result: undefined },
      { method: api.metrics.stopCollection, channel: 'metrics:stopCollection', args: ['pool-1'], result: undefined },
      { method: api.metrics.getHistory, channel: 'metrics:getHistory', args: ['pool-1'], result: [] },
      { method: api.metrics.getRange, channel: 'metrics:getRange', args: ['pool-1', 'OpaqueRef:host', { startTime: 10, endTime: 20 }], result: [metricPoint] },
      { method: api.metrics.getStats, channel: 'metrics:getStats', args: ['pool-1', 'OpaqueRef:host', 'cpu', { startTime: 10, endTime: 20 }], result: { current: 10, max: 20, avg: 15, min: 5 } },
      { method: api.metrics.getVmHistory, channel: 'metrics:getVmHistory', args: ['pool-1', 'OpaqueRef:vm', { startTime: 10, endTime: 20 }], result: [metricPoint] },
      { method: api.metrics.getCollectionError, channel: 'metrics:getCollectionError', args: ['pool-1'], result: null },
      { method: api.alerts.getAll, channel: 'alerts:getAll', args: ['pool-1'], result: [] },
      { method: api.alerts.dismiss, channel: 'alerts:dismiss', args: ['pool-1', 'OpaqueRef:message'], result: undefined },
      { method: api.alerts.dismissAll, channel: 'alerts:dismissAll', args: ['pool-1'], result: 0 },
      { method: api.alertRules.list, channel: 'alertRules:list', args: [], result: [rule] },
      { method: api.alertRules.create, channel: 'alertRules:create', args: [{ name: 'High CPU', metricType: 'cpu', operator: '>', threshold: 90, duration: 5, severity: 'warning' }], result: rule },
      { method: api.alertRules.update, channel: 'alertRules:update', args: ['rule-1', { enabled: false }], result: { ...rule, enabled: false } },
      { method: api.alertRules.delete, channel: 'alertRules:delete', args: ['rule-1'], result: undefined },
      { method: api.alertRules.evaluate, channel: 'alertRules:evaluate', args: [], result: [] },
      { method: api.alertHistory.list, channel: 'alertHistory:list', args: [], result: [] },
      { method: api.alertHistory.acknowledge, channel: 'alertHistory:acknowledge', args: ['alert-1'], result: undefined },
      { method: api.alertHistory.getCount, channel: 'alertHistory:getCount', args: [], result: { active: 0, acknowledged: 0, resolved: 0 } },
      { method: api.alertNotify.getConfig, channel: 'alertNotify:getConfig', args: [], result: config },
      { method: api.alertNotify.saveConfig, channel: 'alertNotify:saveConfig', args: [config], result: { success: true } },
      { method: api.alertNotify.test, channel: 'alertNotify:test', args: ['email', testEmailConfig], result: true },
      { method: api.alertNotify.getHistory, channel: 'alertNotify:history', args: [], result: [] },
      { method: api.alertNotify.send, channel: 'alertNotify:send', args: [{
        ruleName: 'High CPU', connectionId: 'pool-1', poolName: 'Lab Pool',
        entityRef: 'OpaqueRef:host', entityName: 'host-1', severity: 'warning',
        message: 'CPU exceeded threshold', timestamp: 100,
      }], result: { email: false, webhook: false } },
    ]

    for (const testCase of cases) {
      invoke.mockResolvedValueOnce(testCase.result)
      await expect(testCase.method(...testCase.args as never[])).resolves.toEqual(testCase.result)
    }

    const expectedCalls = cases.map(({ channel, args }) => [channel, ...args])
    expectedCalls[0] = ['metrics:startCollection', 'pool-1', undefined]
    expectedCalls[7] = ['alerts:getAll', 'pool-1', undefined]
    expectedCalls[9] = ['alerts:dismissAll', 'pool-1', undefined]
    expectedCalls[15] = ['alertHistory:list', undefined]
    expectedCalls[21] = ['alertNotify:history', undefined]
    expect(invoke.mock.calls).toEqual(expectedCalls)
  })

  it('fails closed at invoke and push boundaries and returns an unsubscribe function', async () => {
    const invoke = vi.fn().mockResolvedValueOnce({ active: -1, acknowledged: 0, resolved: 0 })
    const listeners = new Map<string, (...args: unknown[]) => void>()
    const transport = {
      invoke,
      on: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
        listeners.set(channel, listener)
      }),
      removeListener: vi.fn(),
    }
    const api = createObservabilityApi(transport)

    await expect(api.metrics.getStats(
      'pool-1', 'OpaqueRef:host', 'temperature' as never, { startTime: 10, endTime: 20 },
    )).rejects.toMatchObject({ code: 'IPC_SCHEMA_INVALID' })
    expect(invoke).not.toHaveBeenCalled()

    await expect(api.alertHistory.getCount())
      .rejects.toMatchObject({ code: 'IPC_RESULT_INVALID' })

    const callback = vi.fn()
    const unsubscribe = api.onAlertTriggered(callback)
    expect(transport.on).toHaveBeenCalledWith('alert:triggered', expect.any(Function))
    listeners.get('alert:triggered')?.({}, historyRecord)
    listeners.get('alert:triggered')?.({}, { ...historyRecord, status: 'bogus' })
    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenCalledWith(historyRecord)

    unsubscribe()
    expect(transport.removeListener).toHaveBeenCalledWith(
      'alert:triggered', listeners.get('alert:triggered'),
    )
  })
})
