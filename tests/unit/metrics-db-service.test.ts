/**
 * Unit tests for metrics-db.service — in-memory metrics and alert stores.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { BoundedSamples } from '../../src/main/xapi/services/bounded-samples'

describe('metrics-db.service', () => {
  let metricsDb: typeof import('../../src/main/xapi/services/metrics-db.service')
  let alertRuleDb: typeof import('../../src/main/xapi/services/alert-rule.db')
  let alertHistoryDb: typeof import('../../src/main/xapi/services/alert-history.db')

  beforeEach(async () => {
    vi.resetModules()
    metricsDb = await import('../../src/main/xapi/services/metrics-db.service')
    alertRuleDb = await import('../../src/main/xapi/services/alert-rule.db')
    alertHistoryDb = await import('../../src/main/xapi/services/alert-history.db')
    metricsDb.initDatabase()
  })

  afterEach(async () => {
    await metricsDb.closeDatabase()
  })

  // ========================================================================
  // Store initialization
  // ========================================================================

  describe('initDatabase', () => {
    it('initializes database without error', () => {
      // Already called in beforeEach; verify no throw on double-init
      expect(() => metricsDb.initDatabase()).not.toThrow()
    })

    it('auto-initializes when reading rule/history stores', () => {
      expect(() => metricsDb.getAlertRuleStore()).not.toThrow()
      expect(() => metricsDb.getAlertHistoryStore()).not.toThrow()
    })
  })

  // ========================================================================
  // Metric persistence
  // ========================================================================

  describe('persistMetricSample', () => {
    it('persists a metric sample and can query it back', () => {
      const now = Date.now()
      metricsDb.persistMetricSample({
        timestamp: now,
        cpuPercent: 75.5,
        memoryPercent: 60,
        connectionId: 'conn-1',
        hostRef: 'OpaqueRef:host1',
      })

      const results = metricsDb.getMetricsRange('conn-1', 'OpaqueRef:host1', now - 1000, now + 1000)
      expect(results).toHaveLength(1)
      expect(results[0].cpuPercent).toBe(75.5)
      expect(results[0].memoryPercent).toBe(60)
    })

    it('persists optional network and disk IO fields', () => {
      const now = Date.now()
      metricsDb.persistMetricSample({
        timestamp: now,
        cpuPercent: 50,
        memoryPercent: 40,
        networkRxBytes: 1000,
        networkTxBytes: 2000,
        diskReadBytes: 3000,
        diskWriteBytes: 4000,
        connectionId: 'conn-1',
        hostRef: 'OpaqueRef:host1',
      })

      const results = metricsDb.getMetricsRange('conn-1', 'OpaqueRef:host1', now - 1000, now + 1000)
      expect(results[0].networkRxBytes).toBe(1000)
      expect(results[0].diskWriteBytes).toBe(4000)
    })
  })

  describe('persistMetricBatch', () => {
    it('persists multiple samples in a transaction', () => {
      const now = Date.now()
      const samples = Array.from({ length: 10 }, (_, i) => ({
        timestamp: now + i * 1000,
        cpuPercent: 50 + i,
        memoryPercent: 40 + i,
        connectionId: 'conn-1',
        hostRef: 'OpaqueRef:host1',
      }))

      metricsDb.persistMetricBatch(samples)
      const results = metricsDb.getMetricsRange('conn-1', 'OpaqueRef:host1', now - 1000, now + 15000)
      expect(results).toHaveLength(10)
    })

    it('does nothing for empty batch', () => {
      expect(() => metricsDb.persistMetricBatch([])).not.toThrow()
    })
  })

  describe('persistVmMetricSample', () => {
    it('retains the newest bounded VM archive and replaces duplicates within its pool', () => {
      const now = Date.now()
      const sample = { connectionId: 'c', poolUuid: 'pool-a', vmRef: 'v', cpuPercent: 10, memoryPercent: 20 }
      metricsDb.persistVmMetricBatch(Array.from({ length: 100_120 }, (_, index) => ({ ...sample, timestamp: now - index })))
      const retained = metricsDb.getAlertMetricWindow('vm', 'c', 'v', 0, now, 'pool-a')
      expect(retained).toHaveLength(100_000)
      expect(retained[0].timestamp).toBe(now - 99_999)
      metricsDb.persistVmMetricBatch([
        { ...sample, timestamp: now, cpuPercent: 40 },
        { ...sample, timestamp: now, cpuPercent: 60 },
        { ...sample, poolUuid: 'pool-b', timestamp: now, cpuPercent: 80 },
      ])
      expect(metricsDb.getAlertMetricWindow('vm', 'c', 'v', now, now, 'pool-a')).toEqual([expect.objectContaining({ cpuPercent: 60 })])
      expect(metricsDb.getAlertMetricWindow('vm', 'c', 'v', now, now, 'pool-b')).toEqual([expect.objectContaining({ cpuPercent: 80 })])
      expect(metricsDb.getAlertMetricWindow('vm', 'c', 'v', 0, now)).toHaveLength(100_000)
      expect(() => metricsDb.persistVmMetricBatch([])).not.toThrow()
    })

    it('persists VM metric sample', () => {
      const now = Date.now()
      metricsDb.persistVmMetricSample({
        timestamp: now,
        cpuPercent: 80,
        memoryPercent: 70,
        memoryUsed: 1073741824,
        memoryTotal: 2147483648,
        connectionId: 'conn-1',
        vmRef: 'OpaqueRef:vm1',
      })

      const results = metricsDb.getVmMetricsRange('conn-1', 'OpaqueRef:vm1', now - 1000, now + 1000)
      expect(results).toHaveLength(1)
      expect(results[0].cpuPercent).toBe(80)
      expect(results[0].memoryUsed).toBe(1073741824)
    })
  })

  // ========================================================================
  // Metric queries
  // ========================================================================

  describe('getMetricsRange', () => {
    it('returns empty array when no data exists', () => {
      const results = metricsDb.getMetricsRange('conn-none', 'OpaqueRef:none', 0, Date.now())
      expect(results).toHaveLength(0)
    })

    it('filters by time range', () => {
      const now = Date.now()
      metricsDb.persistMetricSample({ timestamp: now - 5000, cpuPercent: 10, memoryPercent: 10, connectionId: 'c1', hostRef: 'h1' })
      metricsDb.persistMetricSample({ timestamp: now, cpuPercent: 20, memoryPercent: 20, connectionId: 'c1', hostRef: 'h1' })
      metricsDb.persistMetricSample({ timestamp: now + 5000, cpuPercent: 30, memoryPercent: 30, connectionId: 'c1', hostRef: 'h1' })

      const results = metricsDb.getMetricsRange('c1', 'h1', now - 1000, now + 1000)
      expect(results).toHaveLength(1)
      expect(results[0].cpuPercent).toBe(20)
    })

    it('does not collapse sparse samples into one point for long ranges', () => {
      const now = Date.now()
      const twoHoursAgo = now - 2 * 60 * 60 * 1000
      // Sparse recent samples should be kept even if the selected range is large.
      for (let i = 0; i < 5; i++) {
        metricsDb.persistMetricSample({
          timestamp: twoHoursAgo + i * 30_000,
          cpuPercent: 50 + i * 10,
          memoryPercent: 50,
          connectionId: 'c1',
          hostRef: 'h1',
        })
      }

      const results = metricsDb.getMetricsRange('c1', 'h1', twoHoursAgo - 1000, now + 1000)
      expect(results).toHaveLength(5)
    })

    it('keeps sparse points for ranges > 24h', () => {
      const now = Date.now()
      const twoDaysAgo = now - 2 * 24 * 60 * 60 * 1000
      metricsDb.persistMetricSample({ timestamp: twoDaysAgo, cpuPercent: 50, memoryPercent: 50, connectionId: 'c1', hostRef: 'h1' })
      metricsDb.persistMetricSample({ timestamp: twoDaysAgo + 1000, cpuPercent: 60, memoryPercent: 60, connectionId: 'c1', hostRef: 'h1' })

      const results = metricsDb.getMetricsRange('c1', 'h1', twoDaysAgo - 1000, now + 1000)
      expect(results).toHaveLength(2)
    })

    it('downsamples dense data to a manageable number of points', () => {
      const now = Date.now()
      const twoHoursAgo = now - 2 * 60 * 60 * 1000
      const denseSamples = Array.from({ length: 800 }, (_, i) => ({
        timestamp: twoHoursAgo + i * 9000,
        cpuPercent: 30 + (i % 40),
        memoryPercent: 45,
        connectionId: 'c1',
        hostRef: 'h1',
      }))

      metricsDb.persistMetricBatch(denseSamples)
      const results = metricsDb.getMetricsRange('c1', 'h1', twoHoursAgo - 1000, now + 1000)

      expect(results.length).toBeLessThan(denseSamples.length)
      expect(results.length).toBeLessThanOrEqual(300)
    })
  })

  describe('getMetricStats', () => {
    it('returns correct stats for cpu metric', () => {
      const now = Date.now()
      metricsDb.persistMetricSample({ timestamp: now, cpuPercent: 50, memoryPercent: 30, connectionId: 'c1', hostRef: 'h1' })
      metricsDb.persistMetricSample({ timestamp: now + 1000, cpuPercent: 80, memoryPercent: 40, connectionId: 'c1', hostRef: 'h1' })
      metricsDb.persistMetricSample({ timestamp: now + 2000, cpuPercent: 60, memoryPercent: 50, connectionId: 'c1', hostRef: 'h1' })

      const stats = metricsDb.getMetricStats('c1', 'h1', 'cpu', now - 1000, now + 3000)
      expect(stats.max).toBe(80)
      expect(stats.min).toBe(50)
      expect(stats.current).toBe(60) // latest
      expect(stats.avg).toBeCloseTo(63.33, 0)
    })

    it('throws on invalid metric type', () => {
      expect(() => metricsDb.getMetricStats('c1', 'h1', 'invalid', 0, Date.now())).toThrow('Invalid metric type')
    })

    it('returns zeros when no data exists', () => {
      const stats = metricsDb.getMetricStats('c1', 'h1-none', 'cpu', 0, Date.now())
      expect(stats.current).toBe(0)
      expect(stats.max).toBe(0)
      expect(stats.avg).toBe(0)
      expect(stats.min).toBe(0)
      expect(stats.sampleCount).toBe(0)
    })
    it('excludes missing metrics from statistics and retains availability in range results', () => {
      const now = Date.now()
      metricsDb.persistMetricSample({ connectionId: 'c1', hostRef: 'h1', timestamp: now - 5, cpuPercent: 50, memoryPercent: 0, availableMetrics: ['cpuPercent'] })
      metricsDb.persistMetricSample({ connectionId: 'c1', hostRef: 'h1', timestamp: now, cpuPercent: 0, memoryPercent: 0, availableMetrics: [] })
      expect(metricsDb.getMetricStats('c1', 'h1', 'cpu', now - 10, now)).toMatchObject({ avg: 50, min: 50, sampleCount: 1 })
      expect(metricsDb.getMetricStats('c1', 'h1', 'memory', now - 10, now).sampleCount).toBe(0)
      expect(metricsDb.getMetricsRange('c1', 'h1', now - 10, now)[1].availableMetrics).toEqual([])
    })
  })

  describe('getVmMetricsRange', () => {
    it('queries VM metrics by connectionId and vmRef', () => {
      const now = Date.now()
      metricsDb.persistVmMetricSample({
        timestamp: now,
        cpuPercent: 90,
        memoryPercent: 80,
        connectionId: 'c1',
        vmRef: 'vm1',
      })

      const results = metricsDb.getVmMetricsRange('c1', 'vm1', now - 1000, now + 1000)
      expect(results).toHaveLength(1)
      expect(results[0].cpuPercent).toBe(90)
    })

    it('does not collapse sparse VM samples in a long range', () => {
      const now = Date.now()
      const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000

      for (let i = 0; i < 4; i++) {
        metricsDb.persistVmMetricSample({
          timestamp: now - i * 30_000,
          cpuPercent: 20 + i,
          memoryPercent: 60,
          connectionId: 'c1',
          vmRef: 'vm1',
        })
      }

      const results = metricsDb.getVmMetricsRange('c1', 'vm1', sevenDaysAgo, now + 1000)
      expect(results).toHaveLength(4)
    })
  })

  // ========================================================================
  // Alert rules
  // ========================================================================

  describe('alert rules CRUD', () => {
    it('creates and retrieves an alert rule', () => {
      const rule = alertRuleDb.createAlertRule({
        name: 'Test Rule',
        metricType: 'cpu',
        operator: '>',
        threshold: 80,
        duration: 5,
        severity: 'warning',
      })

      expect(rule.id).toBeDefined()
      expect(rule.name).toBe('Test Rule')

      const rules = alertRuleDb.getAlertRules()
      const found = rules.find(r => r.id === rule.id)
      expect(found).toBeDefined()
      expect(found!.threshold).toBe(80)
    })

    it('updates an alert rule', () => {
      const rule = alertRuleDb.createAlertRule({
        name: 'Original',
        metricType: 'cpu',
        operator: '>',
        threshold: 80,
        duration: 5,
        severity: 'warning',
      })

      const updated = alertRuleDb.updateAlertRule(rule.id, { name: 'Updated', threshold: 90 })
      expect(updated.name).toBe('Updated')
      expect(updated.threshold).toBe(90)
    })

    it('throws RULE_NOT_FOUND on update of nonexistent rule', () => {
      expect(() => alertRuleDb.updateAlertRule('nonexistent', { name: 'X' })).toThrow('RULE_NOT_FOUND')
    })

    it('deletes an alert rule', () => {
      const rule = alertRuleDb.createAlertRule({
        name: 'To Delete',
        metricType: 'memory',
        operator: '>',
        threshold: 90,
        duration: 5,
        severity: 'error',
      })

      alertRuleDb.deleteAlertRule(rule.id)
      const rules = alertRuleDb.getAlertRules()
      expect(rules.find(r => r.id === rule.id)).toBeUndefined()
    })

    it('retains and resolves incident history when its rule is deleted', () => {
      const rule = alertRuleDb.createAlertRule({
        name: 'Cascade Test',
        metricType: 'cpu',
        operator: '>',
        threshold: 90,
        duration: 5,
        severity: 'warning',
      })

      alertHistoryDb.createAlertHistory({
        ruleId: rule.id,
        ruleName: rule.name,
        connectionId: 'c1',
        entityRef: 'h1',
        entityName: 'Host 1',
        metricType: 'cpu',
        metricValue: 95,
        threshold: 90,
        severity: 'warning',
        triggeredAt: Date.now(),
        status: 'active',
      })

      alertRuleDb.deleteAlertRule(rule.id)
      const history = alertHistoryDb.getAlertHistory({ connectionId: 'c1' })
      expect(history).toHaveLength(1)
      expect(history[0].status).toBe('resolved')
      expect(history[0].resolvedAt).toBeDefined()
    })

    it('throws RULE_NOT_FOUND on delete of nonexistent rule', () => {
      expect(() => alertRuleDb.deleteAlertRule('nonexistent')).toThrow('RULE_NOT_FOUND')
    })
  })

  // ========================================================================
  // Alert history
  // ========================================================================

  describe('alert history', () => {
    it('creates and retrieves alert history', () => {
      const record = alertHistoryDb.createAlertHistory({
        ruleId: 'rule-1',
        ruleName: 'CPU Alert',
        connectionId: 'c1',
        entityRef: 'h1',
        entityName: 'Host 1',
        metricType: 'cpu',
        metricValue: 95,
        threshold: 90,
        severity: 'warning',
        triggeredAt: Date.now(),
        status: 'active',
      })

      expect(record.id).toBeDefined()
      const history = alertHistoryDb.getAlertHistory()
      expect(history.length).toBeGreaterThanOrEqual(1)
    })

    it('filters by status', () => {
      alertHistoryDb.createAlertHistory({
        ruleId: 'rule-1', ruleName: 'R1', connectionId: 'c1',
        entityRef: 'h1', entityName: 'H1', metricType: 'cpu',
        metricValue: 95, threshold: 90, severity: 'warning',
        triggeredAt: Date.now(), status: 'active',
      })

      const activeAlerts = alertHistoryDb.getAlertHistory({ status: ['active'] })
      expect(activeAlerts.every(a => a.status === 'active')).toBe(true)

      const resolvedAlerts = alertHistoryDb.getAlertHistory({ status: ['resolved'] })
      expect(resolvedAlerts).toHaveLength(0)
    })

    it('acknowledge transitions active -> acknowledged', () => {
      const record = alertHistoryDb.createAlertHistory({
        ruleId: 'rule-1', ruleName: 'R1', connectionId: 'c1',
        entityRef: 'h1', entityName: 'H1', metricType: 'cpu',
        metricValue: 95, threshold: 90, severity: 'warning',
        triggeredAt: Date.now(), status: 'active',
      })

      alertHistoryDb.acknowledgeAlert(record.id)
      const history = alertHistoryDb.getAlertHistory()
      const found = history.find(h => h.id === record.id)
      expect(found?.status).toBe('acknowledged')
      expect(found?.acknowledgedAt).toBeDefined()
    })

    it('acknowledge throws ALERT_NOT_FOUND for nonexistent id', () => {
      expect(() => alertHistoryDb.acknowledgeAlert('nonexistent')).toThrow('ALERT_NOT_FOUND')
    })

    it('acknowledge throws ALERT_ALREADY_ACKNOWLEDGED for non-active alert', () => {
      const record = alertHistoryDb.createAlertHistory({
        ruleId: 'rule-1', ruleName: 'R1', connectionId: 'c1',
        entityRef: 'h1', entityName: 'H1', metricType: 'cpu',
        metricValue: 95, threshold: 90, severity: 'warning',
        triggeredAt: Date.now(), status: 'active',
      })

      alertHistoryDb.acknowledgeAlert(record.id)
      expect(() => alertHistoryDb.acknowledgeAlert(record.id)).toThrow('ALERT_ALREADY_ACKNOWLEDGED')
    })

    it('resolve transitions to resolved', () => {
      const record = alertHistoryDb.createAlertHistory({
        ruleId: 'rule-1', ruleName: 'R1', connectionId: 'c1',
        entityRef: 'h1', entityName: 'H1', metricType: 'cpu',
        metricValue: 95, threshold: 90, severity: 'warning',
        triggeredAt: Date.now(), status: 'active',
      })

      alertHistoryDb.resolveAlert(record.id)
      const history = alertHistoryDb.getAlertHistory()
      const found = history.find(h => h.id === record.id)
      expect(found?.status).toBe('resolved')
      expect(found?.resolvedAt).toBeDefined()
    })

    it('resolve is idempotent for already resolved alerts', () => {
      const record = alertHistoryDb.createAlertHistory({
        ruleId: 'rule-1', ruleName: 'R1', connectionId: 'c1',
        entityRef: 'h1', entityName: 'H1', metricType: 'cpu',
        metricValue: 95, threshold: 90, severity: 'warning',
        triggeredAt: Date.now(), status: 'active',
      })

      alertHistoryDb.resolveAlert(record.id)
      expect(() => alertHistoryDb.resolveAlert(record.id)).not.toThrow()
    })

    it('getAlertCountByStatus returns correct counts', () => {
      alertHistoryDb.createAlertHistory({
        ruleId: 'r1', ruleName: 'R1', connectionId: 'c1',
        entityRef: 'h1', entityName: 'H1', metricType: 'cpu',
        metricValue: 95, threshold: 90, severity: 'warning',
        triggeredAt: Date.now(), status: 'active',
      })
      const r2 = alertHistoryDb.createAlertHistory({
        ruleId: 'r2', ruleName: 'R2', connectionId: 'c1',
        entityRef: 'h2', entityName: 'H2', metricType: 'memory',
        metricValue: 95, threshold: 90, severity: 'error',
        triggeredAt: Date.now(), status: 'active',
      })

      alertHistoryDb.acknowledgeAlert(r2.id)

      const counts = alertHistoryDb.getAlertCountByStatus()
      expect(counts.active).toBe(1)
      expect(counts.acknowledged).toBe(1)
      expect(counts.resolved).toBe(0)
    })
  })

  // ========================================================================
  // Data maintenance
  // ========================================================================

  describe('cleanupOldMetrics', () => {
    it('removes metrics older than retention period', () => {
      const now = Date.now()
      const eightDaysAgo = now - 8 * 24 * 60 * 60 * 1000

      metricsDb.persistMetricSample({ timestamp: eightDaysAgo, cpuPercent: 50, memoryPercent: 50, connectionId: 'c1', hostRef: 'h1' })
      metricsDb.persistMetricSample({ timestamp: now, cpuPercent: 60, memoryPercent: 60, connectionId: 'c1', hostRef: 'h1' })

      metricsDb.cleanupOldMetrics(7)

      const results = metricsDb.getMetricsRange('c1', 'h1', eightDaysAgo - 1000, now + 1000)
      expect(results).toHaveLength(1)
      expect(results[0].cpuPercent).toBe(60)
    })

    it('handles a large number of retained host samples without overflowing the call stack', () => {
      const now = Date.now()
      const samples = Array.from({ length: 500_000 }, (_, i) => ({
        timestamp: now - (i % 60_000),
        cpuPercent: 50,
        memoryPercent: 40,
        connectionId: 'c1',
        hostRef: 'h1',
      }))

      metricsDb.persistMetricBatch(samples)

      metricsDb.cleanupOldMetrics()
    })
  })

  describe('downsampleOldMetrics', () => {
    it('handles a large number of recent host samples without overflowing the call stack', () => {
      const now = Date.now()
      const samples = Array.from({ length: 500_000 }, (_, i) => ({
        timestamp: now - (i % 60_000),
        cpuPercent: 50,
        memoryPercent: 40,
        connectionId: 'c1',
        hostRef: 'h1',
      }))

      metricsDb.persistMetricBatch(samples)

      metricsDb.downsampleOldMetrics()
    })
  })
})

describe('bounded metric eviction', () => {
  it('matches the newest unique samples for out-of-order writes, duplicate updates and expiry', () => {
    const store = new BoundedSamples<{ timestamp: number; value: number }>(32, (point) => String(point.timestamp))
    const expected = new Map<number, { timestamp: number; value: number }>()
    let seed = 12345
    for (let i = 0; i < 1000; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      const point = { timestamp: seed % 1000, value: i }
      store.put(point)
      expected.set(point.timestamp, { ...point })
      const retained = [...expected.values()].sort((a, b) => b.timestamp - a.timestamp).slice(0, 32)
      expected.clear(); for (const item of retained) expected.set(item.timestamp, item)
      expect(store.rows.slice().sort((a, b) => a.timestamp - b.timestamp)).toEqual(retained.sort((a, b) => a.timestamp - b.timestamp))
    }
    store.prune(990)
    expect(store.rows.every((point) => point.timestamp >= 990)).toBe(true)
    store.rebuild()
    store.put({ timestamp: 1001, value: 7 })
    expect(store.rows).toContainEqual({ timestamp: 1001, value: 7 })
  })

  it('keeps the hard limit during many small updates after the cache fills', async () => {
    const db = await import('../../src/main/xapi/services/metrics-db.service')
    const now = Date.now()
    const base = { connectionId: 'c', poolUuid: 'pool', cpuPercent: 10, memoryPercent: 20 }
    try {
      db.persistVmMetricBatch(Array.from({ length: 100_000 }, (_, i) => ({ ...base, vmRef: 'archive', timestamp: now - i })))
      for (let i = 0; i < 500; i++) db.persistVmMetricBatch([0, 1].map((offset) => ({ ...base, vmRef: `vm-${i}`, timestamp: now + offset })))
      expect(db.getAlertMetricWindow('vm', 'c', 'archive', 0, now, 'pool')).toHaveLength(99_000)
      expect(db.getAlertMetricWindow('vm', 'c', 'archive', 0, now - 98_999, 'pool')).toHaveLength(1)
      expect(db.getAlertMetricWindow('vm', 'c', 'vm-499', now, now + 1, 'pool')).toHaveLength(2)
    } finally { await db.closeDatabase() }
  })
})
