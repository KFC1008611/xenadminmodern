/**
 * Bounded metric samples with periodic durable snapshots; alert state is saved on mutation.
 */
import { readJsonStore, readJsonArrayStore, isJsonStoreConfigured, writeJsonStore, writeJsonArrayStore } from '../../persistence/json-store'
import { createLogger } from '../../logger'
import { BoundedSamples } from './bounded-samples'
import type {
  MetricDataPoint,
  VmMetricDataPoint,
  MetricStats,
  AlertRule,
  AlertHistoryRecord,
} from '../../../shared/types/xapi'

// Re-export shared types for consumers.
export type {
  MetricDataPoint,
  VmMetricDataPoint,
  MetricStats,
}

export type AlertMetricPoint = (MetricDataPoint | VmMetricDataPoint) & { availableMetrics?: string[] }

interface HostMetricSample extends MetricDataPoint {
  availableMetrics?: string[]
  poolUuid?: string
  connectionId: string
  hostRef: string
  serverTimestamp: number
}

interface VmMetricSample extends VmMetricDataPoint {
  availableMetrics?: string[]
  poolUuid?: string
  connectionId: string
  vmRef: string
  serverTimestamp: number
}

const MAX_SAMPLES = 100_000
function hostKey(sample: HostMetricSample): string { return JSON.stringify([sample.connectionId, sample.poolUuid, sample.hostRef, sample.timestamp]) }
function vmKey(sample: VmMetricSample): string { return JSON.stringify([sample.connectionId, sample.poolUuid, sample.vmRef, sample.timestamp]) }
let hostStore = new BoundedSamples<HostMetricSample>(MAX_SAMPLES, hostKey)
let vmStore = new BoundedSamples<VmMetricSample>(MAX_SAMPLES, vmKey)
let hostSamples = hostStore.rows
let vmSamples = vmStore.rows
function reindexSamples(): void { hostStore.rebuild(); vmStore.rebuild() }
function appendHost(sample: HostMetricSample): void { hostStore.put(sample) }
function appendVm(sample: VmMetricSample): void { vmStore.put(sample) }
const alertRules: AlertRule[] = []
const alertHistory: AlertHistoryRecord[] = []

let initialized = false
let metricsReady = false
let metricRestore: Promise<void> | null = null
let metricRestoreError: Error | null = null
let defaultsInitialized = false
let metricFlushTimer: NodeJS.Timeout | null = null
let metricRevision = 0
let savedMetricRevision = 0
let metricFlush: Promise<void> | null = null
const MAX_HISTORY = 10_000
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const log = createLogger('MetricsDatabase')

export function flushMetricStore(): Promise<void> {
  if (metricFlushTimer) { clearTimeout(metricFlushTimer); metricFlushTimer = null }
  if (metricRestore) return metricRestore.then(() => flushMetricStore())
  if (metricRestoreError) return Promise.reject(metricRestoreError)
  if (!metricsReady) return Promise.resolve()
  if (!metricFlush && metricRevision === savedMetricRevision) return Promise.resolve()
  if (!metricFlush) {
    metricFlush = (async () => {
      while (savedMetricRevision !== metricRevision) {
        const revision = metricRevision
        // Array copies are cheap; JSON encoding and disk writes yield every
        // 256 samples. One writer owns the atomic rename, including shutdown.
        // Updates during a write advance the revision and require another pass.
        await writeJsonArrayStore('metric-samples', { hosts: hostSamples.slice(), vms: vmSamples.slice() })
        savedMetricRevision = revision
      }
    })().finally(() => { metricFlush = null })
  }
  return metricFlush
}

function scheduleMetricFlush(): void {
  // Each insertion already enforces the hard capacity with incremental eviction.
  metricRevision++
  if (!metricFlushTimer) {
    metricFlushTimer = setTimeout(() => {
      void flushMetricStore().catch((error) => log.error('Metric snapshot could not be saved', error))
    }, 30_000)
    metricFlushTimer.unref()
  }
}

export function persistAlertState(): void {
  ensureInitialized()
  // Retain active/acknowledged incidents; prune only the oldest resolved history.
  const resolved = alertHistory.filter((record) => record.status === 'resolved').sort((a, b) => b.triggeredAt - a.triggeredAt).slice(0, MAX_HISTORY)
  const retained = alertHistory.filter((record) => record.status !== 'resolved').concat(resolved)
  writeJsonStore('alert-state', { rules: alertRules, history: retained, defaultsInitialized })
  alertHistory.length = 0
  for (const record of retained) alertHistory.push(record)
}

export function mutateAlertState<T>(mutation: () => T): T {
  ensureInitialized()
  const previousRules = alertRules.map((rule) => ({ ...rule }))
  const previousHistory = alertHistory.map((record) => ({ ...record }))
  const previousDefaults = defaultsInitialized
  try {
    const result = mutation()
    persistAlertState()
    return result
  } catch (error) {
    alertRules.length = 0; alertHistory.length = 0
    for (const rule of previousRules) alertRules.push(rule)
    for (const record of previousHistory) alertHistory.push(record)
    defaultsInitialized = previousDefaults
    throw error
  }
}

export function areDefaultRulesInitialized(): boolean { ensureInitialized(); return defaultsInitialized }
export function markDefaultRulesInitialized(): void { mutateAlertState(() => { defaultsInitialized = true }) }

// ============================================================================
// Store management
// ============================================================================

function ensureInitialized(): void {
  if (initialized) return
  const alerts = readJsonStore<{ rules: AlertRule[]; history: AlertHistoryRecord[]; defaultsInitialized?: boolean }>('alert-state', { rules: [], history: [] })
  if (!Array.isArray(alerts.rules) || !Array.isArray(alerts.history)) throw new Error('OBSERVABILITY_STORE_INVALID: Local data was preserved')
  for (const rule of alerts.rules) alertRules.push(rule)
  for (const record of alerts.history) alertHistory.push(record)
  defaultsInitialized = alerts.defaultsInitialized === true
  initialized = true
}

function ensureMetricsInitialized(): void {
  ensureInitialized()
  if (!metricsReady && !metricRestore && !metricRestoreError) void initDatabase().catch(() => {})
  if (!metricsReady) throw metricRestoreError ?? new Error('指标历史正在恢复，请稍后重试')
}

/** Alerts stay immediately available. Metric decoding runs in a worker and
 * publishes only a complete, bounded snapshot; queries await this shared task. */
export function initDatabase(): Promise<void> {
  ensureInitialized()
  if (metricsReady) return Promise.resolve()
  if (metricRestore) return metricRestore
  if (!isJsonStoreConfigured()) { metricsReady = true; return Promise.resolve() }
  const hosts = new BoundedSamples<HostMetricSample>(MAX_SAMPLES, hostKey)
  const vms = new BoundedSamples<VmMetricSample>(MAX_SAMPLES, vmKey)
  metricRestoreError = null
  metricRestore = readJsonArrayStore<HostMetricSample | VmMetricSample>('metric-samples', ['hosts', 'vms'], (field, rows) => {
    const cutoff = Date.now() - RETENTION_MS
    for (const sample of rows) {
      if (!sample || !Number.isFinite(sample.timestamp) || sample.timestamp < cutoff) continue
      if (field === 'hosts') hosts.put(sample as HostMetricSample)
      else vms.put(sample as VmMetricSample)
    }
  }).then(() => {
    hostStore = hosts; vmStore = vms
    hostSamples = hosts.rows; vmSamples = vms.rows
    metricsReady = true
  }).catch((error: Error) => {
    metricRestoreError = error
    throw error
  }).finally(() => { metricRestore = null })
  return metricRestore
}

export async function closeDatabase(): Promise<void> {
  // A joined flush's completion handlers may enqueue one last sample before
  // this continuation runs. Drain that revision before clearing the store.
  do { await flushMetricStore() } while (savedMetricRevision !== metricRevision)
  if (metricFlushTimer) { clearTimeout(metricFlushTimer); metricFlushTimer = null }
  hostStore.clear(); vmStore.clear()
  alertRules.length = 0
  alertHistory.length = 0
  initialized = false
  metricsReady = false
  metricRestoreError = null
  defaultsInitialized = false
  metricRevision = 0
  savedMetricRevision = 0
}

export function getAlertRuleStore(): AlertRule[] {
  ensureInitialized()
  return alertRules
}

export function getAlertHistoryStore(): AlertHistoryRecord[] {
  ensureInitialized()
  return alertHistory
}

// ============================================================================
// Metric persistence
// ============================================================================

export function persistMetricSample(
  sample: MetricDataPoint & { connectionId: string; hostRef: string; poolUuid?: string; availableMetrics?: string[] }
): void {
  ensureMetricsInitialized()
  appendHost({
    ...sample,
    serverTimestamp: Date.now(),
  })
  scheduleMetricFlush()
}

export function persistMetricBatch(
  samples: Array<MetricDataPoint & { connectionId: string; hostRef: string; poolUuid?: string; availableMetrics?: string[] }>
): void {
  if (samples.length === 0) {
    return
  }
  ensureMetricsInitialized()
  const serverTimestamp = Date.now()
  for (const sample of samples) {
    appendHost({
      ...sample,
      serverTimestamp,
    })
  }
  scheduleMetricFlush()
}

export function persistVmMetricSample(
  sample: VmMetricDataPoint & { connectionId: string; vmRef: string; poolUuid?: string; availableMetrics?: string[] }
): void {
  persistVmMetricBatch([sample])
}

/** Apply retention once per archive, rather than rebuilding 100k entries for each point. */
export function persistVmMetricBatch(
  samples: Array<VmMetricDataPoint & { connectionId: string; vmRef: string; poolUuid?: string; availableMetrics?: string[] }>
): void {
  if (samples.length === 0) return
  ensureMetricsInitialized()
  const serverTimestamp = Date.now()
  for (const sample of samples) appendVm({ ...sample, serverTimestamp })
  scheduleMetricFlush()
}

// ============================================================================
// Metric queries
// ============================================================================

const TARGET_QUERY_POINTS = 300
const DOWNSAMPLE_INTERVALS_MS = [
  30 * 1000,
  60 * 1000,
  5 * 60 * 1000,
  15 * 60 * 1000,
  60 * 60 * 1000,
  4 * 60 * 60 * 1000,
]

function getDownsampleInterval(
  sampleCount: number,
  startTime: number,
  endTime: number,
  firstTimestamp: number | null,
  lastTimestamp: number | null
): number | null {
  if (sampleCount <= TARGET_QUERY_POINTS) {
    return null
  }

  const spanStart = firstTimestamp ?? startTime
  const spanEnd = lastTimestamp ?? endTime
  const effectiveSpanMs = Math.max(spanEnd - spanStart, 1)
  const desiredIntervalMs = Math.ceil(effectiveSpanMs / TARGET_QUERY_POINTS)

  for (const candidate of DOWNSAMPLE_INTERVALS_MS) {
    if (candidate >= desiredIntervalMs) {
      return candidate
    }
  }

  return DOWNSAMPLE_INTERVALS_MS[DOWNSAMPLE_INTERVALS_MS.length - 1]
}

function roundTo2(value: number): number {
  return Math.round(value * 100) / 100
}

function avg(values: number[]): number {
  if (values.length === 0) {
    return 0
  }
  return values.reduce((acc, cur) => acc + cur, 0) / values.length
}

function avgNullable(values: Array<number | undefined>): number | undefined {
  const filtered = values.filter((v): v is number => v !== undefined)
  if (filtered.length === 0) {
    return undefined
  }
  return avg(filtered)
}

function mergedAvailability(samples: AlertMetricPoint[]): string[] | undefined {
  if (!samples.some((sample) => sample.availableMetrics !== undefined)) return undefined
  return ['cpuPercent', 'memoryPercent', 'networkRxBytes', 'networkTxBytes', 'diskReadBytes', 'diskWriteBytes']
    .filter((key) => samples.every((sample) => sample.availableMetrics ? sample.availableMetrics.includes(key) : typeof sample[key as keyof MetricDataPoint] === 'number'))
}

export function getMetricsRange(
  connectionId: string,
  hostRef: string,
  startTime: number,
  endTime: number,
  poolUuid?: string
): MetricDataPoint[] {
  ensureMetricsInitialized()
  const rows = hostSamples
    .filter(
      (sample) =>
        sample.connectionId === connectionId &&
        (poolUuid === undefined || sample.poolUuid === poolUuid) &&
        sample.hostRef === hostRef &&
        sample.timestamp >= startTime &&
        sample.timestamp <= endTime
    )
    .sort((a, b) => a.timestamp - b.timestamp)

  if (rows.length === 0) {
    return []
  }

  const intervalMs = getDownsampleInterval(
    rows.length,
    startTime,
    endTime,
    rows[0]?.timestamp ?? null,
    rows[rows.length - 1]?.timestamp ?? null
  )

  if (!intervalMs) {
    return rows.map((row) => ({
      timestamp: row.timestamp,
      availableMetrics: row.availableMetrics,
      cpuPercent: row.cpuPercent,
      memoryPercent: row.memoryPercent,
      networkRxBytes: row.networkRxBytes,
      networkTxBytes: row.networkTxBytes,
      diskReadBytes: row.diskReadBytes,
      diskWriteBytes: row.diskWriteBytes,
    }))
  }

  const buckets = new Map<number, HostMetricSample[]>()
  for (const row of rows) {
    const bucket = Math.floor(row.timestamp / intervalMs) * intervalMs
    const list = buckets.get(bucket)
    if (list) {
      list.push(row)
    } else {
      buckets.set(bucket, [row])
    }
  }

  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([bucket, samples]) => ({
      timestamp: bucket,
      availableMetrics: mergedAvailability(samples),
      cpuPercent: roundTo2(avg(samples.map((s) => s.cpuPercent))),
      memoryPercent: roundTo2(avg(samples.map((s) => s.memoryPercent))),
      networkRxBytes: (() => {
        const value = avgNullable(samples.map((s) => s.networkRxBytes))
        return value === undefined ? undefined : Math.round(value)
      })(),
      networkTxBytes: (() => {
        const value = avgNullable(samples.map((s) => s.networkTxBytes))
        return value === undefined ? undefined : Math.round(value)
      })(),
      diskReadBytes: (() => {
        const value = avgNullable(samples.map((s) => s.diskReadBytes))
        return value === undefined ? undefined : Math.round(value)
      })(),
      diskWriteBytes: (() => {
        const value = avgNullable(samples.map((s) => s.diskWriteBytes))
        return value === undefined ? undefined : Math.round(value)
      })(),
    }))
}

export function getAlertMetricWindow(
  kind: 'host' | 'vm', connectionId: string, entityRef: string, startTime: number, endTime: number, poolUuid?: string,
): AlertMetricPoint[] {
  ensureMetricsInitialized()
  const rows = kind === 'host'
    ? hostSamples.filter((sample) => sample.connectionId === connectionId && sample.hostRef === entityRef)
    : vmSamples.filter((sample) => sample.connectionId === connectionId && sample.vmRef === entityRef)
  return rows.filter((sample) => (poolUuid === undefined || sample.poolUuid === poolUuid) && sample.timestamp >= startTime && sample.timestamp <= endTime)
    .sort((a, b) => a.timestamp - b.timestamp).map((sample) => ({ ...sample }))
}

export function getMetricStats(
  connectionId: string,
  hostRef: string,
  metricType: string,
  startTime: number,
  endTime: number,
  poolUuid?: string
): MetricStats {
  ensureMetricsInitialized()

  const keyMap: Record<string, keyof MetricDataPoint> = {
    cpu: 'cpuPercent',
    memory: 'memoryPercent',
    networkRx: 'networkRxBytes',
    networkTx: 'networkTxBytes',
    diskRead: 'diskReadBytes',
    diskWrite: 'diskWriteBytes',
  }

  const key = keyMap[metricType]
  if (!key) {
    throw new Error(`Invalid metric type: ${metricType}`)
  }

  const scoped = hostSamples
    .filter(
      (sample) =>
        sample.connectionId === connectionId &&
        (poolUuid === undefined || sample.poolUuid === poolUuid) &&
        sample.hostRef === hostRef &&
        sample.timestamp >= startTime &&
        sample.timestamp <= endTime
    )
    .sort((a, b) => a.timestamp - b.timestamp)

  const values = scoped
    .filter((sample) => !sample.availableMetrics || sample.availableMetrics.includes(key))
    .map((sample) => sample[key])
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))

  if (values.length === 0) {
    return { current: 0, max: 0, avg: 0, min: 0, sampleCount: 0 }
  }

  const current = values[values.length - 1]
  return {
    sampleCount: values.length,
    current,
    max: Math.max(...values),
    avg: roundTo2(avg(values)),
    min: Math.min(...values),
  }
}

export function getVmMetricsRange(
  connectionId: string,
  vmRef: string,
  startTime: number,
  endTime: number,
  poolUuid?: string
): VmMetricDataPoint[] {
  ensureMetricsInitialized()
  const rows = vmSamples
    .filter(
      (sample) =>
        sample.connectionId === connectionId &&
        (poolUuid === undefined || sample.poolUuid === poolUuid) &&
        sample.vmRef === vmRef &&
        sample.timestamp >= startTime &&
        sample.timestamp <= endTime
    )
    .sort((a, b) => a.timestamp - b.timestamp)

  if (rows.length === 0) {
    return []
  }

  const intervalMs = getDownsampleInterval(
    rows.length,
    startTime,
    endTime,
    rows[0]?.timestamp ?? null,
    rows[rows.length - 1]?.timestamp ?? null
  )

  if (!intervalMs) {
    return rows.map((row) => ({
      timestamp: row.timestamp,
      availableMetrics: row.availableMetrics,
      cpuPercent: row.cpuPercent,
      memoryPercent: row.memoryPercent,
      memoryUsed: row.memoryUsed,
      memoryTotal: row.memoryTotal,
      networkRxBytes: row.networkRxBytes,
      networkTxBytes: row.networkTxBytes,
      diskReadBytes: row.diskReadBytes,
      diskWriteBytes: row.diskWriteBytes,
    }))
  }

  const buckets = new Map<number, VmMetricSample[]>()
  for (const row of rows) {
    const bucket = Math.floor(row.timestamp / intervalMs) * intervalMs
    const list = buckets.get(bucket)
    if (list) {
      list.push(row)
    } else {
      buckets.set(bucket, [row])
    }
  }

  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([bucket, samples]) => ({
      timestamp: bucket,
      availableMetrics: mergedAvailability(samples),
      cpuPercent: roundTo2(avg(samples.map((s) => s.cpuPercent))),
      memoryPercent: roundTo2(avg(samples.map((s) => s.memoryPercent))),
      memoryUsed: (() => {
        const value = avgNullable(samples.map((s) => s.memoryUsed))
        return value === undefined ? undefined : Math.round(value)
      })(),
      memoryTotal: (() => {
        const value = avgNullable(samples.map((s) => s.memoryTotal))
        return value === undefined ? undefined : Math.round(value)
      })(),
      networkRxBytes: (() => {
        const value = avgNullable(samples.map((s) => s.networkRxBytes))
        return value === undefined ? undefined : Math.round(value)
      })(),
      networkTxBytes: (() => {
        const value = avgNullable(samples.map((s) => s.networkTxBytes))
        return value === undefined ? undefined : Math.round(value)
      })(),
      diskReadBytes: (() => {
        const value = avgNullable(samples.map((s) => s.diskReadBytes))
        return value === undefined ? undefined : Math.round(value)
      })(),
      diskWriteBytes: (() => {
        const value = avgNullable(samples.map((s) => s.diskWriteBytes))
        return value === undefined ? undefined : Math.round(value)
      })(),
    }))
}

// ============================================================================
// Data maintenance
// ============================================================================

export function downsampleOldMetrics(): void {
  ensureMetricsInitialized()
  const now = Date.now()

  const oneHourAgo = now - 24 * 60 * 60 * 1000
  const oneDayAgo = now - 2 * 24 * 60 * 60 * 1000
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000

  const downsampleRange = (
    fromInclusive: number,
    toExclusive: number,
    bucketMs: number
  ): HostMetricSample[] => {
    const inRange = hostSamples.filter(
      (sample) => sample.timestamp >= fromInclusive && sample.timestamp < toExclusive
    )

    const grouped = new Map<string, HostMetricSample[]>()
    for (const sample of inRange) {
      const bucket = Math.floor(sample.timestamp / bucketMs) * bucketMs
      const key = JSON.stringify([sample.connectionId, sample.poolUuid, sample.hostRef, bucket])
      const list = grouped.get(key)
      if (list) {
        list.push(sample)
      } else {
        grouped.set(key, [sample])
      }
    }

    const merged: HostMetricSample[] = []
    for (const [key, samples] of grouped.entries()) {
      const [connectionId, poolUuid, hostRef, bucket] = JSON.parse(key)
      merged.push({
        connectionId,
        hostRef, poolUuid: poolUuid || undefined,
        timestamp: Number(bucket),
        serverTimestamp: now,
      availableMetrics: mergedAvailability(samples),
        cpuPercent: avg(samples.map((s) => s.cpuPercent)),
        memoryPercent: avg(samples.map((s) => s.memoryPercent)),
        networkRxBytes: avgNullable(samples.map((s) => s.networkRxBytes)),
        networkTxBytes: avgNullable(samples.map((s) => s.networkTxBytes)),
        diskReadBytes: avgNullable(samples.map((s) => s.diskReadBytes)),
        diskWriteBytes: avgNullable(samples.map((s) => s.diskWriteBytes)),
      })
    }

    return merged
  }

  const recent = hostSamples.filter((sample) => sample.timestamp >= oneHourAgo)
  const merged5m = downsampleRange(oneDayAgo, oneHourAgo, 5 * 60 * 1000)
  const merged1h = downsampleRange(sevenDaysAgo, oneDayAgo, 60 * 60 * 1000)

  hostSamples.length = 0
  for (const sample of recent) hostSamples.push(sample)
  for (const sample of merged5m) hostSamples.push(sample)
  for (const sample of merged1h) hostSamples.push(sample)

  const vmCutoffIndex = vmSamples.findIndex((sample) => sample.timestamp < sevenDaysAgo)
  if (vmCutoffIndex !== -1) {
    const kept = vmSamples.filter((sample) => sample.timestamp >= sevenDaysAgo)
    vmSamples.length = 0
    for (const sample of kept) vmSamples.push(sample)
  }

  // Downsample old VM samples (same strategy as host samples)
  const vmRecent = vmSamples.filter((sample) => sample.timestamp >= oneHourAgo)
  const vm5m = downsampleVmRange(oneDayAgo, oneHourAgo, 5 * 60 * 1000)
  const vm1h = downsampleVmRange(sevenDaysAgo, oneDayAgo, 60 * 60 * 1000)

  vmSamples.length = 0
  for (const sample of vmRecent) vmSamples.push(sample)
  for (const sample of vm5m) vmSamples.push(sample)
  for (const sample of vm1h) vmSamples.push(sample)
  reindexSamples()
  scheduleMetricFlush()
}

function downsampleVmRange(
  fromInclusive: number,
  toExclusive: number,
  bucketMs: number
): VmMetricSample[] {
  const now = Date.now()
  const inRange = vmSamples.filter(
    (sample) => sample.timestamp >= fromInclusive && sample.timestamp < toExclusive
  )

  const grouped = new Map<string, VmMetricSample[]>()
  for (const sample of inRange) {
    const bucket = Math.floor(sample.timestamp / bucketMs) * bucketMs
    const key = JSON.stringify([sample.connectionId, sample.poolUuid, sample.vmRef, bucket])
    const list = grouped.get(key)
    if (list) {
      list.push(sample)
    } else {
      grouped.set(key, [sample])
    }
  }

  const merged: VmMetricSample[] = []
  for (const [key, samples] of grouped.entries()) {
    const [connectionId, poolUuid, vmRef, bucket] = JSON.parse(key)
    merged.push({
      connectionId,
      vmRef, poolUuid: poolUuid || undefined,
      timestamp: Number(bucket),
      serverTimestamp: now,
      availableMetrics: mergedAvailability(samples),
      cpuPercent: avg(samples.map((s) => s.cpuPercent)),
      memoryPercent: avg(samples.map((s) => s.memoryPercent)),
      memoryUsed: avgNullable(samples.map((s) => s.memoryUsed)),
      memoryTotal: avgNullable(samples.map((s) => s.memoryTotal)),
      networkRxBytes: avgNullable(samples.map((s) => s.networkRxBytes)),
      networkTxBytes: avgNullable(samples.map((s) => s.networkTxBytes)),
      diskReadBytes: avgNullable(samples.map((s) => s.diskReadBytes)),
      diskWriteBytes: avgNullable(samples.map((s) => s.diskWriteBytes)),
    })
  }

  return merged
}

export function cleanupOldMetrics(daysToKeep: number = 7): void {
  ensureMetricsInitialized()
  const cutoff = Date.now() - daysToKeep * 24 * 60 * 60 * 1000

  hostStore.prune(cutoff)
  vmStore.prune(cutoff)
  scheduleMetricFlush()
}
