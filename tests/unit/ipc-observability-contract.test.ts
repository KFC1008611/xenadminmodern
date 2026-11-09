import { describe, expect, it } from 'vitest'
import {
  alertHistoryAcknowledgeContract,
  alertHistoryGetCountContract,
  alertHistoryListContract,
  alertNotifyConfigGetContract,
  alertNotifyConfigSaveContract,
  alertNotifyHistoryContract,
  alertNotifySendContract,
  alertNotifyTestContract,
  alertRulesCreateContract,
  alertRulesUpdateContract,
  alertTriggeredContract,
  alertsDismissAllContract,
  alertsGetAllContract,
  metricsGetHistoryContract,
  metricsGetRangeContract,
  metricsGetStatsContract,
  metricsGetVmHistoryContract,
  metricsStartCollectionContract,
  observabilityContracts,
  observabilityInvokeContracts,
} from '../../src/shared/ipc-contracts/observability'

const metricPoint = {
  timestamp: 1_700_000_000_000,
  cpuPercent: 42,
  memoryPercent: 64,
  networkRxBytes: 1024,
}

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

const notificationConfig = {
  enabled: true,
  email: {
    enabled: true,
    host: 'smtp.example.com',
    port: 587,
    secure: false,
    auth: { user: 'alerts', pass: 'smtp-secret' },
    from: 'alerts@example.com',
    to: 'ops@example.com',
    subjectPrefix: '[XenAdmin]',
  },
  webhook: {
    enabled: true,
    url: 'https://hooks.example.com/alerts',
    method: 'POST' as const,
    headers: { Authorization: 'Bearer webhook-token' },
    secret: 'hmac-secret',
  },
  filterSeverities: ['error', 'warning'] as const,
}

describe('observability IPC contracts', () => {
  it('declares the literal 23 invoke channels plus the one-way alert push', () => {
    expect(observabilityInvokeContracts.map(({ channel }) => channel)).toEqual([
      'metrics:startCollection',
      'metrics:stopCollection',
      'metrics:getHistory',
      'metrics:getRange',
      'metrics:getStats',
      'metrics:getVmHistory',
      'metrics:getCollectionError',
      'alerts:getAll',
      'alerts:dismiss',
      'alerts:dismissAll',
      'alertRules:list',
      'alertRules:create',
      'alertRules:update',
      'alertRules:delete',
      'alertRules:evaluate',
      'alertHistory:list',
      'alertHistory:acknowledge',
      'alertHistory:getCount',
      'alertNotify:getConfig',
      'alertNotify:saveConfig',
      'alertNotify:test',
      'alertNotify:history',
      'alertNotify:send',
    ])
    expect(observabilityContracts).toEqual([
      ...observabilityInvokeContracts,
      alertTriggeredContract,
    ])
    expect(new Set(observabilityContracts.map(({ channel }) => channel))).toHaveLength(24)
    for (const contract of observabilityInvokeContracts) {
      expect(contract).toMatchObject({
        direction: 'invoke',
        callerPolicy: 'app-window-main-frame',
        errorShape: 'ipc-error-response-v1',
      })
    }
    expect(alertTriggeredContract).toMatchObject({
      channel: 'alert:triggered',
      direction: 'push',
      callerPolicy: 'main-process',
      resultSchema: null,
      errorShape: null,
      redaction: ['none'],
    })
    expect(alertNotifyConfigSaveContract.redaction).toEqual(['notification-secret'])
    expect(alertNotifyTestContract.redaction).toEqual(['notification-secret'])
  })

  it('validates metrics tuples, metric enums, ranges, and normalized results', () => {
    expect(metricsStartCollectionContract.argsSchema.parse(['pool-1']))
      .toEqual(['pool-1'])
    expect(metricsStartCollectionContract.argsSchema.parse(['pool-1', undefined]))
      .toEqual(['pool-1', undefined])
    expect(metricsStartCollectionContract.argsSchema.parse([
      'pool-1', { interval: 30_000, maxDataPoints: 120 },
    ])).toEqual(['pool-1', { interval: 30_000, maxDataPoints: 120 }])
    expect(metricsGetRangeContract.argsSchema.parse([
      'pool-1', 'OpaqueRef:host', {
        startTime: 1_700_000_000_000,
        endTime: 1_700_000_060_000,
        downsample: '1m',
      },
    ])).toHaveLength(3)
    expect(metricsGetHistoryContract.resultSchema.parse([{
      hostRef: 'OpaqueRef:host', hostName: 'host-1', dataPoints: [metricPoint],
    }])).toHaveLength(1)
    expect(metricsGetRangeContract.resultSchema.parse([metricPoint])).toEqual([metricPoint])
    expect(metricsGetRangeContract.resultSchema.parse([{ ...metricPoint, availableMetrics: [] }])[0].availableMetrics).toEqual([])
    expect(() => metricsGetRangeContract.resultSchema.parse([{ ...metricPoint, availableMetrics: ['invented'] }])).toThrow()
    expect(metricsGetStatsContract.resultSchema.parse({ current: 42, max: 80, avg: 50, min: 20 }))
      .toEqual({ current: 42, max: 80, avg: 50, min: 20 })
    expect(metricsGetVmHistoryContract.resultSchema.parse([{
      ...metricPoint, memoryUsed: undefined, memoryTotal: 1024,
    }])).toHaveLength(1)

    for (const args of [
      ['pool-1', { interval: 0 }],
      ['pool-1', { interval: 30_000, extra: true }],
      ['pool-1', 'OpaqueRef:host', { startTime: 20, endTime: 10 }],
      ['pool-1', 'OpaqueRef:host', { startTime: 10, endTime: 20, downsample: '2m' }],
    ]) expect(() => metricsStartCollectionContract.argsSchema.parse(args)).toThrow()
    expect(() => metricsGetRangeContract.argsSchema.parse([
      'pool-1', 'OpaqueRef:host', { startTime: 20, endTime: 10 },
    ])).toThrow()
    expect(() => metricsGetStatsContract.argsSchema.parse([
      'pool-1', 'OpaqueRef:host', 'temperature', { startTime: 10, endTime: 20 },
    ])).toThrow()
  })

  it('validates XAPI alert filters and exact alert results', () => {
    const filters = {
      severity: ['error', 'warning'] as const,
      since: 100,
      until: 200,
      objUuid: 'object-uuid',
    }
    expect(alertsGetAllContract.argsSchema.parse(['pool-1', filters]))
      .toEqual(['pool-1', filters])
    expect(alertsGetAllContract.argsSchema.parse(['pool-1', undefined]))
      .toEqual(['pool-1', undefined])
    expect(alertsGetAllContract.resultSchema.parse([{
      ref: 'OpaqueRef:message',
      uuid: 'message-uuid',
      name: 'HOST_OFFLINE',
      priority: 1,
      severity: 'error',
      body: 'Host is offline',
      timestamp: 150,
      cls: 'Host',
      objUuid: 'object-uuid',
      connectionId: 'pool-1',
      poolName: 'Lab Pool',
    }])).toHaveLength(1)
    expect(alertsGetAllContract.resultSchema.parse([{
      ref: 'OpaqueRef:message',
      uuid: '',
      name: '',
      priority: 5,
      severity: 'info',
      body: '',
      timestamp: 150,
      cls: '',
      objUuid: '',
      connectionId: 'pool-1',
      poolName: 'Lab Pool',
    }])).toHaveLength(1)
    expect(alertsDismissAllContract.resultSchema.parse(2)).toBe(2)

    for (const filters of [
      { severity: ['critical'] },
      { since: 200, until: 100 },
      { objUuid: ' ' },
      { severity: [], extra: true },
    ]) expect(() => alertsGetAllContract.argsSchema.parse(['pool-1', filters])).toThrow()
    expect(() => alertsDismissAllContract.resultSchema.parse(-1)).toThrow()
  })

  it('enforces alert-rule target discriminators and alert-history state shapes', () => {
    const input = {
      name: 'High CPU',
      metricType: 'cpu' as const,
      operator: '>' as const,
      threshold: 90,
      duration: 5,
      severity: 'warning' as const,
      enabled: true,
      targetType: 'host' as const,
      targetRef: 'OpaqueRef:host',
    }
    expect(alertRulesCreateContract.argsSchema.parse([input])).toEqual([input])
    expect(alertRulesCreateContract.argsSchema.parse([{
      ...input, targetRef: undefined, targetType: undefined,
    }])).toHaveLength(1)
    expect(alertRulesCreateContract.resultSchema.parse({
      id: 'rule-1',
      ...input,
      targetRef: undefined,
      targetType: undefined,
      createdAt: 100,
      updatedAt: 100,
    })).toMatchObject({ id: 'rule-1', targetRef: undefined, targetType: undefined })
    expect(alertRulesUpdateContract.argsSchema.parse(['rule-1', { enabled: false }]))
      .toEqual(['rule-1', { enabled: false }])
    expect(alertHistoryListContract.argsSchema.parse([undefined])).toEqual([undefined])
    expect(alertHistoryAcknowledgeContract.argsSchema.parse(['alert-1']))
      .toEqual(['alert-1'])
    expect(alertHistoryGetCountContract.resultSchema.parse({
      active: 1, acknowledged: 2, resolved: 3,
    })).toEqual({ active: 1, acknowledged: 2, resolved: 3 })
    expect(alertTriggeredContract.argsSchema.parse([historyRecord])).toEqual([historyRecord])

    for (const invalidInput of [
      { ...input, metricType: 'temperature' },
      { ...input, targetRef: undefined },
      { ...input, targetType: undefined },
      { ...input, threshold: 101 },
      { ...input, duration: 1.5 },
      { ...input, duration: 1441 },
      { ...input, name: 'x'.repeat(101) },
      { ...input, extra: true },
    ]) expect(() => alertRulesCreateContract.argsSchema.parse([invalidInput])).toThrow()
    expect(() => alertRulesUpdateContract.argsSchema.parse(['rule-1', {}])).toThrow()
    expect(() => alertTriggeredContract.argsSchema.parse([{
      ...historyRecord, status: 'acknowledged', acknowledgedAt: undefined,
    }])).toThrow()
  })

  it('validates notification branches, filters, results, and secret-bearing contracts', () => {
    expect(alertNotifyConfigGetContract.resultSchema.parse(notificationConfig))
      .toEqual(notificationConfig)
    expect(alertNotifyConfigSaveContract.argsSchema.parse([notificationConfig]))
      .toEqual([notificationConfig])
    expect(alertNotifyConfigSaveContract.resultSchema.parse({ success: true }))
      .toEqual({ success: true })
    expect(alertNotifyTestContract.argsSchema.parse(['email', notificationConfig.email]))
      .toEqual(['email', notificationConfig.email])
    expect(alertNotifyTestContract.argsSchema.parse(['webhook', notificationConfig.webhook]))
      .toEqual(['webhook', notificationConfig.webhook])
    expect(alertNotifyHistoryContract.argsSchema.parse([undefined])).toEqual([undefined])
    expect(alertNotifySendContract.argsSchema.parse([{
      ruleName: 'High CPU',
      connectionId: 'pool-1',
      poolName: 'Lab Pool',
      entityRef: 'OpaqueRef:host',
      entityName: 'host-1',
      severity: 'warning',
      message: 'CPU exceeded threshold',
      metricType: 'cpu',
      metricValue: 95,
      threshold: 90,
      timestamp: 1_700_000_000_000,
    }])).toHaveLength(1)
    expect(alertNotifySendContract.resultSchema.parse({ email: true, webhook: false }))
      .toEqual({ email: true, webhook: false })

    expect(() => alertNotifyTestContract.argsSchema.parse([
      'email', { enabled: true, url: 'https://wrong-branch.example.com' },
    ])).toThrow()
    expect(() => alertNotifyTestContract.argsSchema.parse(['email', {}])).toThrow()
    expect(() => alertNotifyTestContract.argsSchema.parse([
      'email', { ...notificationConfig.email, enabled: false },
    ])).toThrow()
    expect(() => alertNotifyTestContract.argsSchema.parse([
      'webhook', { enabled: true, url: 'ftp://invalid.example.com' },
    ])).toThrow()
    expect(() => alertNotifyHistoryContract.argsSchema.parse([{
      since: 200, until: 100,
    }])).toThrow()
    expect(() => alertNotifyConfigGetContract.resultSchema.parse({
      ...notificationConfig, filterSeverities: ['critical'],
    })).toThrow()
    expect(() => alertNotifyConfigSaveContract.argsSchema.parse([{
      ...notificationConfig,
      email: { ...notificationConfig.email, host: '' },
    }])).toThrow()
    expect(() => alertNotifySendContract.argsSchema.parse([{
      ruleName: 'High CPU',
      connectionId: 'pool-1',
      poolName: 'Lab Pool',
      entityRef: 'OpaqueRef:host',
      entityName: 'host-1',
      severity: 'warning',
      message: 'CPU exceeded threshold',
      metricType: 'cpu',
      timestamp: 1_700_000_000_000,
    }])).toThrow()
    expect(() => alertNotifySendContract.argsSchema.parse([{
      ruleName: 'High CPU',
      connectionId: 'pool-1',
      poolName: 'Lab Pool',
      entityRef: 'OpaqueRef:host',
      entityName: 'host-1',
      severity: 'warning',
      message: 'CPU exceeded threshold',
      metricType: undefined,
      metricValue: 95,
      threshold: 90,
      timestamp: 1_700_000_000_000,
    }])).toThrow()
    expect(alertNotifySendContract.argsSchema.parse([{
      ruleName: 'High CPU',
      connectionId: 'pool-1',
      poolName: 'Lab Pool',
      entityRef: 'OpaqueRef:host',
      entityName: 'host-1',
      severity: 'warning',
      message: 'CPU exceeded threshold',
      metricType: undefined,
      metricValue: undefined,
      threshold: undefined,
      timestamp: 1_700_000_000_000,
    }])).toHaveLength(1)
    expect(() => alertNotifySendContract.resultSchema.parse({
      email: true, webhook: 'yes',
    })).toThrow()
  })
})
