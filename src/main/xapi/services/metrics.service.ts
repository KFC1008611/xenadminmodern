/**
 * Metrics collection service — collects performance metrics via XenServer RRD endpoints.
 *
 * Replaces the previous XML-RPC polling approach with RRD HTTP endpoints:
 *   /host_rrd — host CPU, memory, network, disk metrics
 *   /vm_rrd   — VM CPU, memory, network, disk metrics
 *   /rrd_updates — incremental updates via HTTP
 *
 * Dual-timer architecture:
 *   - Discover new resources every 30 seconds and bootstrap their RRD history once
 *   - Incremental updates every 10 seconds (rrd_updates for near-real-time data)
 */
import { connectionManager } from '../connection-manager'
import { createLogger } from '../../logger'
import {
  persistMetricBatch,
  persistVmMetricBatch,
  downsampleOldMetrics,
  cleanupOldMetrics,
  initDatabase,
  getMetricsRange as dbGetMetricsRange,
  getMetricStats as dbGetMetricStats,
  getVmMetricsRange as dbGetVmMetricsRange,
  type MetricDataPoint as DbMetricDataPoint,
  type VmMetricDataPoint as DbVmMetricDataPoint,
  type MetricStats,
} from './metrics-db.service'
import {
  fetchHostRrd,
  fetchVmRrd,
  fetchRrdUpdates,
  RrdFetchError,
} from './rrd-client.service'
import {
  parseHostRrdXml,
  parseVmRrdXml,
  parseRrdUpdatesXml,
  rrdDataToMetricDataPoints,
  rrdDataToVmMetricDataPoints,
  type RrdDataPoint,
  type RrdHostData,
} from './rrd-parser.service'
import {
  getAllHostUuids,
  getRunningVmUuids,
  getVmUuid,
  getVmMemoryDynamicMax,
  invalidateConnection as invalidateUuidCache,
} from './rrd-uuid-cache.service'

// Re-export DB types for consumers
export type { MetricStats } from './metrics-db.service'

// ============================================================================
// Type definitions
// ============================================================================

export interface MetricDataPoint {
  availableMetrics?: string[]
  timestamp: number
  cpuPercent: number
  memoryPercent: number
  networkRxBytes?: number
  networkTxBytes?: number
  diskReadBytes?: number
  diskWriteBytes?: number
}

export interface VmMetricDataPoint {
  availableMetrics?: string[]
  timestamp: number
  cpuPercent: number
  memoryPercent: number
  memoryUsed?: number
  memoryTotal?: number
  networkRxBytes?: number
  networkTxBytes?: number
  diskReadBytes?: number
  diskWriteBytes?: number
}

export interface HostMetricsHistory {
  hostRef: string
  hostName: string
  dataPoints: MetricDataPoint[]
}

export interface MetricsCollectionConfig {
  interval: number        // Resource discovery / bootstrap retry interval, default 30000
  maxDataPoints: number   // Max retained data points in memory, default 120
}

export interface MetricsRangeParams {
  startTime: number
  endTime: number
}

// ============================================================================
// Internal state
// ============================================================================

const DEFAULT_CONFIG: MetricsCollectionConfig = {
  interval: 30000,
  maxDataPoints: 120,
}

const INCREMENTAL_INTERVAL_MS = 10_000 // Incremental updates every 10 seconds
const VM_SAMPLE_FRESHNESS_MS = INCREMENTAL_INTERVAL_MS * 3

// Per-connection timers
const fullDumpTimers = new Map<string, NodeJS.Timeout>()
const incrementalTimers = new Map<string, NodeJS.Timeout>()
const collectionData = new Map<string, HostMetricsHistory[]>()
const collectionInFlight = new Set<string>()
const incrementalInFlight = new Set<string>()
const vmCollections = new Map<string, { generation: number }>()
const collectionAborts = new Map<string, AbortController>()
const bootstrappedVms = new Map<string, Set<string>>()
interface VmArchiveScope {
  connectionId: string; identity: string; client: ReturnType<typeof connectionManager.getClient>; generation?: number
}
const initializedVmArchives = new Map<string, VmArchiveScope & { timestamp: number; updatedAt: number }>()
const runningVmSnapshots = new Map<string, VmArchiveScope & { refs: Set<string>; observedAt: number }>()
const vmArchiveReads = new Map<string, VmArchiveScope & {
  controller: AbortController; promise: Promise<VmMetricDataPoint | null>
}>()
const archiveKey = (connectionId: string, vmRef: string) => JSON.stringify([connectionId, vmRef])
function connectionIdentity(connectionId: string): string {
  const info = connectionManager.getConnectionInfo?.(connectionId)
  return JSON.stringify([info?.epoch, info?.poolUuid, info?.connectedAt])
}
function isCurrentVmArchive(scope: VmArchiveScope): boolean {
  return connectionIdentity(scope.connectionId) === scope.identity
    && connectionManager.getClient(scope.connectionId) === scope.client
    && collectionGenerations.get(scope.connectionId) === scope.generation
}
function clearVmArchives(connectionId?: string): void {
  for (const [key, read] of vmArchiveReads) {
    if (!connectionId || read.connectionId === connectionId) { read.controller.abort(); vmArchiveReads.delete(key) }
  }
  for (const [key, archive] of initializedVmArchives) {
    if (!connectionId || archive.connectionId === connectionId) initializedVmArchives.delete(key)
  }
  if (connectionId) runningVmSnapshots.delete(connectionId)
  else runningVmSnapshots.clear()
}

/** Reuse the existing batch metadata reads to distinguish inactive VMs from
 * running VMs whose incremental source has stalled, without per-VM RPCs. */
async function readRunningVms(connectionId: string, generation: number) {
  const scope = { connectionId, generation, identity: connectionIdentity(connectionId), client: connectionManager.getClient(connectionId) }
  const vms = await getRunningVmUuids(connectionId)
  if (!isCurrentVmArchive(scope)) return null
  runningVmSnapshots.set(connectionId, { ...scope, refs: new Set(vms.map((vm) => vm.vmRef)), observedAt: Date.now() })
  return vms
}

// Track the last rrd_updates timestamp per connection
let nextGeneration = 0
const collectionGenerations = new Map<string, number>()
const lastUpdateTimestamp = new Map<string, Map<string, number>>()

// Track last collection error per connection for UI visibility
const lastCollectionError = new Map<string, string>()
const lastIncrementalError = new Map<string, string>()
// Once a host archive exceeds the response budget, use the published recent
// window endpoint for this collection instead of repeatedly downloading it.
const boundedHostWindows = new Map<string, Map<string, number>>()

// Downsample scheduler
let persistTimer: NodeJS.Timeout | null = null

const log = createLogger('MetricsService')

const METRICS_DEBUG_ENABLED = false // Debug logging now controlled via LOG_LEVEL env

// ============================================================================
// Helpers
// ============================================================================

function logMetricsDebug(event: string, context?: Record<string, unknown>): void {
  if (!METRICS_DEBUG_ENABLED) return
  if (context) {
    log.debug(event, context)
  } else {
    log.debug(event)
  }
}

function logMetricsError(event: string, error: unknown, context?: Record<string, unknown>): void {
  if (!METRICS_DEBUG_ENABLED) return
  const message = error instanceof Error ? error.message : String(error)
  if (context) {
    log.warn(`${event} failed: ${message}`, context)
  } else {
    log.warn(`${event} failed: ${message}`)
  }
}

function availableMetrics(point: RrdDataPoint, vmMemoryMax?: number): string[] {
  const keys = [...point.values.keys()]
  if (point.values.has('memoryBytes') && vmMemoryMax && vmMemoryMax > 0) keys.push('memoryPercent')
  return keys
}

// ============================================================================
// Service functions
// ============================================================================

/**
 * Start periodic metrics collection for a connection.
 * Uses RRD HTTP endpoints with dual timers (bootstrap discovery + incremental).
 */
export async function startMetricsCollection(
  connectionId: string,
  config?: Partial<MetricsCollectionConfig>
): Promise<void> {
  logMetricsDebug('startCollection:request', {
    connectionId,
    hasExistingTimer: fullDumpTimers.has(connectionId),
    config,
  })

  // Stop existing collection for this connection if any
  if (fullDumpTimers.has(connectionId)) {
    stopMetricsCollection(connectionId)
  }

  const generation = ++nextGeneration
  collectionGenerations.set(connectionId, generation)
  collectionAborts.set(connectionId, new AbortController())
  bootstrappedVms.set(connectionId, new Set())
  await initDatabase()
  if (collectionGenerations.get(connectionId) !== generation) return
  startPersistScheduler()

  const mergedConfig: MetricsCollectionConfig = {
    ...DEFAULT_CONFIG,
    ...config,
  }

  if (!collectionData.has(connectionId)) {
    collectionData.set(connectionId, [])
  }

  // Discover new resources and retry unsuccessful history bootstraps.
  const fullDumpCycle = async () => {
    if (collectionInFlight.has(connectionId)) {
      logMetricsDebug('fullDump:skip-in-flight', { connectionId })
      return
    }
    collectionInFlight.add(connectionId)
    logMetricsDebug('fullDump:start', { connectionId })
    try {
      await collectFullDump(connectionId, generation)
    } catch (error) {
      if (collectionGenerations.get(connectionId) === generation) lastCollectionError.set(connectionId, `主机 RRD 采集失败: ${error instanceof Error ? error.message : String(error)}`)
      logMetricsError('fullDump', error, { connectionId })
    } finally {
      if (collectionGenerations.get(connectionId) === generation) collectionInFlight.delete(connectionId)
      logMetricsDebug('fullDump:end', { connectionId })
    }
  }

  const fullDumpTimer = setInterval(() => {
    void fullDumpCycle()
  }, mergedConfig.interval)
  fullDumpTimers.set(connectionId, fullDumpTimer)

  // Incremental timer — fetches rrd_updates for near-real-time data
  const incrementalCycle = async () => {
    if (incrementalInFlight.has(connectionId)) {
      logMetricsDebug('incremental:skip-in-flight', { connectionId })
      return
    }
    incrementalInFlight.add(connectionId)
    try {
      await collectIncrementalUpdate(connectionId, generation)
    } catch (error) {
      if (collectionGenerations.get(connectionId) === generation) lastIncrementalError.set(connectionId, `增量指标采集失败: ${error instanceof Error ? error.message : String(error)}`)
      logMetricsError('incremental', error, { connectionId })
    } finally {
      if (collectionGenerations.get(connectionId) === generation) incrementalInFlight.delete(connectionId)
    }
  }

  const incrementalTimer = setInterval(() => {
    void incrementalCycle()
  }, INCREMENTAL_INTERVAL_MS)
  incrementalTimers.set(connectionId, incrementalTimer)

  logMetricsDebug('startCollection:timers-created', {
    connectionId,
    fullDumpIntervalMs: mergedConfig.interval,
    incrementalIntervalMs: INCREMENTAL_INTERVAL_MS,
  })

  // Trigger initial full dump in background
  void fullDumpCycle()
}

/**
 * Stop metrics collection for a connection.
 */
export async function stopMetricsCollection(
  connectionId: string
): Promise<void> {
  const fullDumpTimer = fullDumpTimers.get(connectionId)
  if (fullDumpTimer) {
    clearInterval(fullDumpTimer)
    fullDumpTimers.delete(connectionId)
  }

  const incrementalTimer = incrementalTimers.get(connectionId)
  if (incrementalTimer) {
    clearInterval(incrementalTimer)
    incrementalTimers.delete(connectionId)
  }

  clearVmArchives(connectionId)
  collectionGenerations.delete(connectionId)
  collectionAborts.get(connectionId)?.abort()
  collectionAborts.delete(connectionId)
  vmCollections.delete(connectionId)
  bootstrappedVms.delete(connectionId)
  collectionData.delete(connectionId)
  collectionInFlight.delete(connectionId)
  incrementalInFlight.delete(connectionId)
  lastUpdateTimestamp.delete(connectionId)
  lastCollectionError.delete(connectionId)
  lastIncrementalError.delete(connectionId)
  boundedHostWindows.delete(connectionId)

  invalidateUuidCache(connectionId)

  if (fullDumpTimers.size === 0) {
    stopPersistScheduler()
  }

  logMetricsDebug('stopCollection:done', {
    connectionId,
    remainingConnections: fullDumpTimers.size,
  })
}

/**
 * Stop all metrics collection. Called on application exit.
 */
export function stopAllCollections(): void {
  for (const [, timer] of fullDumpTimers.entries()) {
    clearInterval(timer)
  }
  fullDumpTimers.clear()

  for (const [, timer] of incrementalTimers.entries()) {
    clearInterval(timer)
  }
  incrementalTimers.clear()

  clearVmArchives()
  collectionGenerations.clear()
  for (const controller of collectionAborts.values()) controller.abort()
  collectionAborts.clear()
  vmCollections.clear()
  bootstrappedVms.clear()
  collectionData.clear()
  collectionInFlight.clear()
  incrementalInFlight.clear()
  lastUpdateTimestamp.clear()
  lastCollectionError.clear()
  lastIncrementalError.clear()
  boundedHostWindows.clear()

  stopPersistScheduler()
  logMetricsDebug('stopAllCollections:done')
}

// ============================================================================
// Full dump collection
// ============================================================================

/**
 * Collect a full dump of metrics using /host_rrd and /vm_rrd endpoints.
 */
async function collectFullDump(connectionId: string, generation: number): Promise<void> {
  const startedAt = Date.now()
  logMetricsDebug('collectFullDump:start', { connectionId })

  // Collect host metrics
  await collectHostMetricsRrd(connectionId, generation)

  // Collect VM metrics (non-blocking)
  triggerVmRrdCollection(connectionId, generation)

  logMetricsDebug('collectFullDump:end', {
    connectionId,
    durationMs: Date.now() - startedAt,
  })
}

async function readHostMetricData(connectionId: string, hostUuid: string, generation: number): Promise<RrdHostData> {
  const signal = collectionAborts.get(connectionId)?.signal
  let clockOffset = boundedHostWindows.get(connectionId)?.get(hostUuid)
  if (clockOffset === undefined) {
    try {
      return parseHostRrdXml(await fetchHostRrd(connectionId, hostUuid, signal))
    } catch (error) {
      if (!(error instanceof RrdFetchError) || error.code !== 'TOO_LARGE') throw error
      clockOffset = error.serverTime === undefined ? 0 : error.serverTime - Date.now()
      if (collectionGenerations.get(connectionId) === generation) {
        if (!boundedHostWindows.has(connectionId)) boundedHostWindows.set(connectionId, new Map())
        boundedHostWindows.get(connectionId)!.set(hostUuid, clockOffset)
      }
    }
  }
  // 120 five-second samples match the in-memory collection window. Use the
  // host's HTTP clock so workstation clock skew cannot exclude recent samples.
  const start = Math.floor((Date.now() + clockOffset) / 1000) - DEFAULT_CONFIG.maxDataPoints * 5
  signal?.throwIfAborted()
  const result = parseRrdUpdatesXml(await fetchRrdUpdates(connectionId, start, true, hostUuid, signal))
  const data = result.hostData.find((host) => host.uuid === hostUuid)
  if (!data?.dataPoints.length) throw new Error('RRD recent window has no samples for the requested host')
  return data
}

/**
 * Collect host metrics via RRD for all hosts in a connection.
 */
async function collectHostMetricsRrd(connectionId: string, generation: number): Promise<void> {
  const poolUuid = connectionManager.getConnectionInfo?.(connectionId)?.poolUuid
  // Get host UUIDs
  let hostUuids: Array<{ hostRef: string; hostUuid: string; hostName: string }>
  try {
    hostUuids = await getAllHostUuids(connectionId)
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    if (collectionGenerations.get(connectionId) === generation) lastCollectionError.set(connectionId, `获取主机UUID失败: ${msg}`)
    logMetricsError('collectHosts:uuidFetch', error, { connectionId })
    return
  }

  if (collectionGenerations.get(connectionId) !== generation) return
  logMetricsDebug('collectHosts:uuids', {
    connectionId,
    hostCount: hostUuids.length,
  })

  let existingData = collectionData.get(connectionId)
  if (!existingData) {
    existingData = []
    collectionData.set(connectionId, existingData)
  }

  const failedHosts: string[] = []
  for (const { hostRef, hostUuid, hostName } of hostUuids) {
    if (collectionGenerations.get(connectionId) !== generation) return
    // The archive seeds history once; /rrd_updates owns subsequent samples.
    if (lastUpdateTimestamp.get(connectionId)?.has(hostUuid)) continue
    try {
      const rrdData = await readHostMetricData(connectionId, hostUuid, generation)
      if (collectionGenerations.get(connectionId) !== generation) return
      const dataPoints = rrdDataToMetricDataPoints(rrdData)

      logMetricsDebug('collectHosts:rrdParsed', {
        connectionId,
        hostRef,
        hostName,
        dataPointCount: dataPoints.length,
        firstTs: dataPoints.length > 0 ? dataPoints[0].timestamp : null,
        lastTs: dataPoints.length > 0 ? dataPoints[dataPoints.length - 1].timestamp : null,
      })

      // Update in-memory collection
      let hostEntry = existingData.find(h => h.hostRef === hostRef)
      if (!hostEntry) {
        hostEntry = { hostRef, hostName, dataPoints: [] }
        existingData.push(hostEntry)
      }

      // Merge: replace with newer data, keeping maxDataPoints
      hostEntry.dataPoints = mergeDataPoints(hostEntry.dataPoints, dataPoints, DEFAULT_CONFIG.maxDataPoints)

      // Persist to DB
      persistMetricBatch(
        dataPoints.map((dp, index) => ({ ...dp, connectionId, poolUuid, hostRef, availableMetrics: availableMetrics(rrdData.dataPoints[index]) }))
      )

      // Track latest timestamp for incremental updates
      if (dataPoints.length > 0) {
        const latestTs = dataPoints[dataPoints.length - 1].timestamp
        let cursors = lastUpdateTimestamp.get(connectionId)
        if (!cursors) { cursors = new Map(); lastUpdateTimestamp.set(connectionId, cursors) }
        cursors.set(hostUuid, Math.max(latestTs, cursors.get(hostUuid) ?? 0))
      }
    } catch (error) {
      failedHosts.push(`${hostName || hostRef}（${error instanceof Error ? error.message : String(error)}）`)
      logMetricsError('collectHosts:rrdFetch', error, {
        connectionId,
        hostRef,
        hostName,
      })
    }
  }
  if (collectionGenerations.get(connectionId) === generation) {
    if (failedHosts.length) lastCollectionError.set(connectionId, `主机 RRD 采集失败: ${failedHosts.join(', ')}`)
    else lastCollectionError.delete(connectionId)
  }
}

// ============================================================================
// VM collection
// ============================================================================

function triggerVmRrdCollection(connectionId: string, generation: number): void {
  if (collectionGenerations.get(connectionId) !== generation) return
  if (vmCollections.get(connectionId)?.generation === generation) return
  const entry = { generation }
  vmCollections.set(connectionId, entry)
  void collectVmMetricsRrdBatch(connectionId, generation).catch((error) => {
    logMetricsError('vmRrdBatch', error, { connectionId })
  }).finally(() => { if (vmCollections.get(connectionId) === entry) vmCollections.delete(connectionId) })
}

/**
 * Collect VM metrics via RRD for all running VMs.
 * Uses concurrent fetching with a concurrency limit.
 */
async function collectVmMetricsRrdBatch(connectionId: string, generation: number): Promise<void> {
  // Get running VM UUIDs
  let vmList: Awaited<ReturnType<typeof getRunningVmUuids>>
  try {
    const running = await readRunningVms(connectionId, generation)
    if (!running) return
    vmList = running
  } catch (error) {
    logMetricsError('vmBatch:uuidFetch', error, { connectionId })
    return
  }
  if (collectionGenerations.get(connectionId) !== generation) return
  const seeded = bootstrappedVms.get(connectionId)!
  const running = new Set(vmList.map((vm) => vm.vmUuid))
  for (const uuid of seeded) if (!running.has(uuid)) seeded.delete(uuid)
  vmList = vmList.filter((vm) => !seeded.has(vm.vmUuid))
  const signal = collectionAborts.get(connectionId)?.signal

  logMetricsDebug('vmBatch:start', {
    connectionId,
    runningVmCount: vmList.length,
  })

  // Process VMs in batches of 5 concurrent requests
  const CONCURRENCY = 5
  let sampled = 0
  let errors = 0

  for (let i = 0; i < vmList.length; i += CONCURRENCY) {
    if (collectionGenerations.get(connectionId) !== generation) return
    const batch = vmList.slice(i, i + CONCURRENCY)
    const results = await Promise.allSettled(
      batch.map(async ({ vmRef, vmUuid, memoryDynamicMax }) => {
        const point = await collectSingleVmRrd(connectionId, vmRef, vmUuid, generation, memoryDynamicMax, signal)
        if (point && collectionGenerations.get(connectionId) === generation) seeded.add(vmUuid)
      })
    )

    for (const result of results) {
      if (result.status === 'fulfilled') {
        sampled += 1
      } else {
        errors += 1
      }
    }
  }

  logMetricsDebug('vmBatch:summary', {
    connectionId,
    totalVms: vmList.length,
    sampled,
    errors,
  })
}

/**
 * Collect metrics for a single VM via RRD.
 */
async function collectSingleVmRrd(
  connectionId: string,
  vmRef: string,
  vmUuid: string,
  generation: number,
  memoryDynamicMax?: number,
  signal?: AbortSignal,
): Promise<VmMetricDataPoint | null> {
  return readVmArchive(connectionId, vmRef, { vmUuid, memoryDynamicMax, generation, signal })
}

/** Shared by bootstrap and on-demand reads; one archive per VM can be in flight.
 * A replaced connection or stopped collection cannot publish a late response. */
function readVmArchive(
  connectionId: string, vmRef: string,
  metadata?: { vmUuid: string; memoryDynamicMax?: number; generation: number; signal?: AbortSignal },
): Promise<VmMetricDataPoint | null> {
  const key = archiveKey(connectionId, vmRef)
  const identity = connectionIdentity(connectionId)
  const client = connectionManager.getClient(connectionId)
  const generation = metadata?.generation ?? collectionGenerations.get(connectionId)
  const pending = vmArchiveReads.get(key)
  if (pending?.identity === identity && pending.client === client && pending.generation === generation) return pending.promise
  if (pending) { pending.controller.abort(); vmArchiveReads.delete(key) }
  const poolUuid = connectionManager.getConnectionInfo?.(connectionId)?.poolUuid
  const controller = new AbortController()
  const signal = metadata?.signal ? AbortSignal.any([controller.signal, metadata.signal]) : controller.signal
  const entry = { connectionId, identity, client, generation, controller, promise: Promise.resolve<VmMetricDataPoint | null>(null) }
  vmArchiveReads.set(key, entry)
  const current = () => vmArchiveReads.get(key) === entry && !signal.aborted && isCurrentVmArchive(entry)
  entry.promise = (async () => {
    const uuid = metadata?.vmUuid ?? await getVmUuid(connectionId, vmRef)
    if (!current()) return null
    const xml = await fetchVmRrd(connectionId, uuid, signal)
    if (!current()) return null
    const rrdData = parseVmRrdXml(xml)
    let memoryMax = metadata?.memoryDynamicMax
    if (!metadata) {
      try { memoryMax = await getVmMemoryDynamicMax(connectionId, vmRef) } catch { /* Preserve metric availability. */ }
    }
    if (!current()) return null
    const dataPoints = rrdDataToVmMetricDataPoints(rrdData, memoryMax)
    persistVmMetricBatch(dataPoints.map((point, index) => ({ ...point, connectionId, poolUuid, vmRef,
      availableMetrics: availableMetrics(rrdData.dataPoints[index], memoryMax) })))
    const latest = dataPoints[dataPoints.length - 1] ?? null
    if (latest) {
      const previous = initializedVmArchives.get(key)
      initializedVmArchives.set(key, { connectionId, identity, client, generation,
        timestamp: Math.max(latest.timestamp, previous && isCurrentVmArchive(previous) ? previous.timestamp : -Infinity), updatedAt: Date.now() })
    }
    return latest
  })().finally(() => { if (vmArchiveReads.get(key) === entry) vmArchiveReads.delete(key) })
  return entry.promise
}

// ============================================================================
// Incremental updates
// ============================================================================

/**
 * Collect incremental metrics via the /rrd_updates HTTP endpoint.
 */
async function collectIncrementalUpdate(connectionId: string, generation: number): Promise<void> {
  const poolUuid = connectionManager.getConnectionInfo?.(connectionId)?.poolUuid
  const cursors = lastUpdateTimestamp.get(connectionId)
  if (!cursors) return
  const errors: string[] = []
  const hosts = await getAllHostUuids(connectionId)
  const hostRefs = new Map(hosts.map((host) => [host.hostUuid, host.hostRef]))
  let vmRefs: Map<string, Awaited<ReturnType<typeof getRunningVmUuids>>[number]> | null = null
  for (const host of hosts) {
    if (collectionGenerations.get(connectionId) !== generation) return
    const lastTs = cursors.get(host.hostUuid)
    if (!lastTs) continue
    try {
      const xml = await fetchRrdUpdates(connectionId, Math.floor(lastTs / 1000), true, host.hostUuid, collectionAborts.get(connectionId)?.signal)
      if (collectionGenerations.get(connectionId) !== generation) return
      const result = parseRrdUpdatesXml(xml)
      if (result.vmData.length && !vmRefs) {
        const vms = await readRunningVms(connectionId, generation)
        if (!vms) return
        vmRefs = new Map(vms.map((vm) => [vm.vmUuid, vm]))
      }
      if (collectionGenerations.get(connectionId) !== generation) return
      let latest = lastTs
      for (const hostUpdate of result.hostData) {
        // A member endpoint must not attribute another host's sample to this member.
        if (hostUpdate.uuid !== host.hostUuid) continue
        const hostRef = hostRefs.get(hostUpdate.uuid)!
        const dataPoints = rrdDataToMetricDataPoints(hostUpdate)
        persistMetricBatch(dataPoints.map((point, index) => ({ ...point, connectionId, poolUuid, hostRef, availableMetrics: availableMetrics(hostUpdate.dataPoints[index]) })))
        const entry = collectionData.get(connectionId)?.find((candidate) => candidate.hostRef === hostRef)
        if (entry) entry.dataPoints = mergeDataPoints(entry.dataPoints, dataPoints, DEFAULT_CONFIG.maxDataPoints)
        for (const point of dataPoints) latest = Math.max(latest, point.timestamp)
      }
      for (const vmUpdate of result.vmData) {
        const metadata = vmRefs?.get(vmUpdate.uuid)
        if (!metadata) continue
        const { vmRef, memoryDynamicMax: memoryMax } = metadata
        const dataPoints = rrdDataToVmMetricDataPoints(vmUpdate, memoryMax)
        persistVmMetricBatch(dataPoints.map((point, index) => ({ ...point, connectionId, poolUuid, vmRef, availableMetrics: availableMetrics(vmUpdate.dataPoints[index], memoryMax) })))
        const archive = initializedVmArchives.get(archiveKey(connectionId, vmRef))
        const currentArchive = archive && isCurrentVmArchive(archive) ? archive : null
        for (const point of dataPoints) {
          latest = Math.max(latest, point.timestamp)
          // Receiving the same old sample again does not prove freshness. Use
          // local observation time so server clock skew does not trigger dumps.
          if (currentArchive && point.timestamp > currentArchive.timestamp) {
            currentArchive.timestamp = point.timestamp
            currentArchive.updatedAt = Date.now()
          }
        }
      }
      // Advance only to an observed server sample, independently for each host.
      cursors.set(host.hostUuid, latest)
    } catch (error) {
      errors.push(`${host.hostName || host.hostRef}（${error instanceof Error ? error.message : String(error)}）`)
      logMetricsError('incremental:updateFailed', error, { connectionId, hostRef: host.hostRef })
    }
  }
  if (collectionGenerations.get(connectionId) !== generation) return
  if (errors.length) lastIncrementalError.set(connectionId, `增量指标采集失败: ${errors.join(', ')}`)
  else lastIncrementalError.delete(connectionId)
}

// ============================================================================
// VM on-demand collection (for METRICS_GET_VM_HISTORY)
// ============================================================================

/**
 * Collect VM metrics on demand for a specific VM.
 * Used by the METRICS_GET_VM_HISTORY IPC handler.
 */
export async function collectVmMetrics(
  connectionId: string,
  vmRef: string
): Promise<VmMetricDataPoint | null> {
  await initDatabase()
  // A direct detail route can be opened before Dashboard starts collection.
  // Ensure later refreshes have the same incremental source as the dashboard.
  const info = connectionManager.getConnectionInfo?.(connectionId)
  if (info?.state === 'connected' && !collectionGenerations.has(connectionId)) await startMetricsCollection(connectionId)
  // Restored samples may predate a run that ended while the app was closed.
  // Stopped VMs never enter background bootstrap, so they still need one archive.
  const archive = initializedVmArchives.get(archiveKey(connectionId, vmRef))
  if (collectionGenerations.has(connectionId) && archive && isCurrentVmArchive(archive)) {
    const now = Date.now()
    const running = runningVmSnapshots.get(connectionId)
    const inactive = running && isCurrentVmArchive(running) && now - running.observedAt < DEFAULT_CONFIG.interval * 2 && !running.refs.has(vmRef)
    if (inactive || now - archive.updatedAt < VM_SAMPLE_FRESHNESS_MS) {
      const rows = dbGetVmMetricsRange(connectionId, vmRef, 0, now, info?.poolUuid)
      if (rows.length) return rows[rows.length - 1]
    }
  }
  return readVmArchive(connectionId, vmRef)
}

// ============================================================================
// History queries
// ============================================================================

/**
 * Get the collected metrics history for a connection.
 * Returns all host data with data points sorted by timestamp ascending.
 */
export async function getMetricsHistory(
  connectionId: string
): Promise<HostMetricsHistory[]> {
  await initDatabase()
  const data = collectionData.get(connectionId)
  if (!data) {
    return []
  }

  return data.map(hostData => ({
    ...hostData,
    dataPoints: [...hostData.dataPoints].sort(
      (a, b) => a.timestamp - b.timestamp
    ),
  }))
}

/**
 * Query host metrics within a time range.
 */
export function getMetricsRange(
  connectionId: string,
  hostRef: string,
  params: MetricsRangeParams
): DbMetricDataPoint[] {
  const rows = dbGetMetricsRange(connectionId, hostRef, params.startTime, params.endTime, connectionManager.getConnectionInfo?.(connectionId)?.poolUuid)
  const firstTimestamp = rows.length > 0 ? rows[0].timestamp : null
  const lastTimestamp = rows.length > 0 ? rows[rows.length - 1].timestamp : null
  logMetricsDebug('query:hostRange', {
    connectionId,
    hostRef,
    startTime: params.startTime,
    endTime: params.endTime,
    rowCount: rows.length,
    firstTimestamp,
    lastTimestamp,
  })
  return rows
}

/**
 * Get statistics for a specific host metric type within a time range.
 */
export function getMetricsStats(
  connectionId: string,
  hostRef: string,
  metricType: string,
  params: MetricsRangeParams
): MetricStats {
  const stats = dbGetMetricStats(connectionId, hostRef, metricType, params.startTime, params.endTime, connectionManager.getConnectionInfo?.(connectionId)?.poolUuid)
  logMetricsDebug('query:hostStats', {
    connectionId,
    hostRef,
    metricType,
    startTime: params.startTime,
    endTime: params.endTime,
    stats,
  })
  return stats
}

/**
 * Query VM metrics within a time range.
 */
export function getVmMetricsRange(
  connectionId: string,
  vmRef: string,
  params: MetricsRangeParams
): DbVmMetricDataPoint[] {
  const rows = dbGetVmMetricsRange(connectionId, vmRef, params.startTime, params.endTime, connectionManager.getConnectionInfo?.(connectionId)?.poolUuid)
  const firstTimestamp = rows.length > 0 ? rows[0].timestamp : null
  const lastTimestamp = rows.length > 0 ? rows[rows.length - 1].timestamp : null
  logMetricsDebug('query:vmRange', {
    connectionId,
    vmRef,
    startTime: params.startTime,
    endTime: params.endTime,
    rowCount: rows.length,
    firstTimestamp,
    lastTimestamp,
  })
  return rows
}

// ============================================================================
// Data merge utility
// ============================================================================

/**
 * Merge new data points into existing ones, avoiding duplicates by timestamp.
 * Keeps at most maxDataPoints entries (FIFO).
 */
function mergeDataPoints(
  existing: MetricDataPoint[],
  incoming: MetricDataPoint[],
  maxDataPoints: number
): MetricDataPoint[] {
  const tsSet = new Set(existing.map(dp => dp.timestamp))
  const newPoints = incoming.filter(dp => !tsSet.has(dp.timestamp))

  const merged = [...existing, ...newPoints].sort((a, b) => a.timestamp - b.timestamp)

  if (merged.length > maxDataPoints) {
    return merged.slice(merged.length - maxDataPoints)
  }

  return merged
}

// ============================================================================
// Downsample scheduler
// ============================================================================

function startPersistScheduler(intervalMs: number = 5 * 60 * 1000): void {
  if (persistTimer) return

  logMetricsDebug('persistScheduler:start', { intervalMs })

  persistTimer = setInterval(() => {
    downsampleOldMetrics()
    cleanupOldMetrics()
    logMetricsDebug('persistScheduler:tick')
  }, intervalMs)
}

function stopPersistScheduler(): void {
  if (persistTimer) {
    clearInterval(persistTimer)
    persistTimer = null
    logMetricsDebug('persistScheduler:stop')
  }
}

// ============================================================================
// Collection status for UI visibility
// ============================================================================

/**
 * Get the last collection error for a connection, if any.
 * Returns null if no error or if collection is working.
 */
export function getCollectionError(connectionId: string): string | null {
  return [lastCollectionError.get(connectionId), lastIncrementalError.get(connectionId)].filter(Boolean).join('；') || null
}
