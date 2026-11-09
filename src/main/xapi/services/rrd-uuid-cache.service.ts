/**
 * RRD UUID Cache service — caches OpaqueRef → UUID mappings for RRD endpoints.
 *
 * XenServer's RRD HTTP endpoints (/host_rrd, /vm_rrd) require entity UUIDs
 * rather than OpaqueRefs. This service caches the mapping, fetching it
 * from XAPI on first access and refreshing after a TTL.
 */
import { connectionManager } from '../connection-manager'

// ============================================================================
// Types
// ============================================================================

interface CachedEntry {
  uuid: string
  fetchedAt: number
}

interface RunningVmInfo {
  vmRef: string
  vmUuid: string
  vmName: string
  memoryDynamicMax?: number
}

// ============================================================================
// Internal state
// ============================================================================

const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

// connectionId → entityRef → { uuid, fetchedAt }
const hostCache = new Map<string, Map<string, CachedEntry>>()
const vmCache = new Map<string, Map<string, CachedEntry>>()

// Track last full VM sweep to avoid refetching too often
const vmSweepTimestamps = new Map<string, number>()

// ============================================================================
// Helpers
// ============================================================================

function getClient(connectionId: string) {
  const client = connectionManager.getClient(connectionId)
  if (!client) {
    throw new Error(`No connection found for connectionId: ${connectionId}`)
  }
  return client
}

function isEntryValid(entry: CachedEntry | undefined): boolean {
  if (!entry) return false
  return Date.now() - entry.fetchedAt < CACHE_TTL_MS
}

// ============================================================================
// Host UUID
// ============================================================================

/**
 * Get the UUID for a host by its OpaqueRef.
 * Fetches from XAPI on cache miss.
 */
export async function getHostUuid(
  connectionId: string,
  hostRef: string
): Promise<string> {
  const connCache = hostCache.get(connectionId)
  const cached = connCache?.get(hostRef)

  if (isEntryValid(cached)) {
    return cached!.uuid
  }

  const client = getClient(connectionId)
  const record = await client.callWithSession('host.get_record', [hostRef])
  const uuid = String(record.uuid ?? '')

  if (!uuid) {
    throw new Error(`Host ${hostRef} has no UUID`)
  }

  if (!hostCache.has(connectionId)) {
    hostCache.set(connectionId, new Map())
  }
  hostCache.get(connectionId)!.set(hostRef, { uuid, fetchedAt: Date.now() })

  return uuid
}

/**
 * Get UUIDs for all hosts in a connection.
 * Fetches all host records in a single call and caches them.
 */
export async function getAllHostUuids(
  connectionId: string
): Promise<Array<{ hostRef: string; hostUuid: string; hostName: string }>> {
  const client = getClient(connectionId)
  const records: Record<string, any> = await client.callWithSession('host.get_all_records', [])

  const result: Array<{ hostRef: string; hostUuid: string; hostName: string }> = []

  if (!hostCache.has(connectionId)) {
    hostCache.set(connectionId, new Map())
  }
  const connCache = hostCache.get(connectionId)!
  const now = Date.now()

  for (const [hostRef, record] of Object.entries(records)) {
    if (!hostRef || hostRef === 'OpaqueRef:NULL') continue

    const uuid = String(record.uuid ?? '')
    const name = String(record.name_label ?? '')
    if (!uuid) continue

    connCache.set(hostRef, { uuid, fetchedAt: now })
    result.push({ hostRef, hostUuid: uuid, hostName: name })
  }

  return result
}

// ============================================================================
// VM UUID
// ============================================================================

/**
 * Get the UUID for a single VM by its OpaqueRef.
 * Fetches from XAPI on cache miss.
 */
export async function getVmUuid(
  connectionId: string,
  vmRef: string
): Promise<string> {
  const connCache = vmCache.get(connectionId)
  const cached = connCache?.get(vmRef)

  if (isEntryValid(cached)) {
    return cached!.uuid
  }

  const client = getClient(connectionId)
  const record = await client.callWithSession('VM.get_record', [vmRef])
  const uuid = String(record.uuid ?? '')

  if (!uuid) {
    throw new Error(`VM ${vmRef} has no UUID`)
  }

  if (!vmCache.has(connectionId)) {
    vmCache.set(connectionId, new Map())
  }
  vmCache.get(connectionId)!.set(vmRef, { uuid, fetchedAt: Date.now() })

  return uuid
}

/**
 * Get UUIDs for all running (non-template, non-control-domain) VMs.
 * Fetches all VM records in a single call and caches them.
 */
export async function getRunningVmUuids(
  connectionId: string
): Promise<RunningVmInfo[]> {
  const client = getClient(connectionId)
  const records: Record<string, any> = await client.callWithSession('VM.get_all_records', [])

  const result: RunningVmInfo[] = []

  if (!vmCache.has(connectionId)) {
    vmCache.set(connectionId, new Map())
  }
  const connCache = vmCache.get(connectionId)!
  const now = Date.now()

  for (const [vmRef, record] of Object.entries(records)) {
    if (!vmRef || vmRef === 'OpaqueRef:NULL') continue
    if (record.is_a_template || record.is_control_domain) continue
    if (record.power_state !== 'Running') continue

    const uuid = String(record.uuid ?? '')
    const name = String(record.name_label ?? '')
    if (!uuid) continue

    connCache.set(vmRef, { uuid, fetchedAt: now })
    const memoryDynamicMax = Number(record.memory_dynamic_max)
    result.push({ vmRef, vmUuid: uuid, vmName: name,
      ...(Number.isFinite(memoryDynamicMax) && memoryDynamicMax > 0 ? { memoryDynamicMax } : {}) })
  }

  vmSweepTimestamps.set(connectionId, now)

  return result
}

/**
 * Get memory_dynamic_max for a VM (needed for VM memory percentage calculation).
 * This is not cached since it may change.
 */
export async function getVmMemoryDynamicMax(
  connectionId: string,
  vmRef: string
): Promise<number> {
  const client = getClient(connectionId)
  const record = await client.callWithSession('VM.get_record', [vmRef])
  return Number(record.memory_dynamic_max) || 0
}

// ============================================================================
// Cache invalidation
// ============================================================================

/**
 * Invalidate all cached data for a connection.
 */
export function invalidateConnection(connectionId: string): void {
  hostCache.delete(connectionId)
  vmCache.delete(connectionId)
  vmSweepTimestamps.delete(connectionId)
}

/**
 * Invalidate the cached entry for a specific VM.
 */
export function invalidateVm(connectionId: string, vmRef: string): void {
  vmCache.get(connectionId)?.delete(vmRef)
}

/**
 * Check whether a full VM sweep is needed (TTL expired).
 */
export function isVmSweepNeeded(connectionId: string): boolean {
  const lastSweep = vmSweepTimestamps.get(connectionId)
  if (!lastSweep) return true
  return Date.now() - lastSweep >= CACHE_TTL_MS
}
