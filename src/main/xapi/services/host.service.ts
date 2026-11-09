/**
 * Host service — wraps XAPI host.* and host_metrics.* methods.
 * All functions accept connectionId as the first parameter for multi-connection support.
 * v5: Extended with maintenance mode and evacuation features.
 */
import { connectionManager } from '../connection-manager'
import { waitForXapiTask, taskOutcomeUnknown } from './xapi-task'
import { readOperationResult } from '../../../shared/read-operation-result'
import type {
  HostRecord,
  HostMetrics,
  ConnectedHostRecord,
  MaintenanceStatus,
  EvacuateResult,
} from '../../../shared/types/xapi'

const MAINTENANCE_KEY = 'xenadmin-modern:maintenance'

// Re-export shared types for backward compatibility
export type {
  HostRecord,
  HostMetrics,
  ConnectedHostRecord,
  MaintenanceStatus,
  EvacuateResult,
}

function getClient(connectionId: string) {
  const client = connectionManager.getClient(connectionId)
  if (!client) {
    throw new Error(`No connection found for connectionId: ${connectionId}`)
  }
  return client
}

function getPoolName(connectionId: string): string {
  return connectionManager.getConnectionInfo(connectionId)?.poolName ?? connectionId
}

// ============================================================================
// v4: Existing methods
// ============================================================================

export async function getAllHosts(connectionId: string): Promise<ConnectedHostRecord[]> {
  const client = getClient(connectionId)
  const poolName = getPoolName(connectionId)
  // Use get_all_records to fetch all hosts in a single XAPI call (avoids N+1 pattern)
  const allRecords: Record<string, any> = await client.callWithSession('host.get_all_records', [])
  const records = await Promise.all(Object.entries(allRecords).map(async ([ref, record]) => {
    // Modern XAPI removed host_metrics memory fields; RRD sources report KiB.
    const values = await Promise.allSettled(['memory_total_kib', 'memory_free_kib'].map(async (source) => {
      const raw = await client.callWithSession('host.query_data_source', [ref, source])
      const value = typeof raw === 'number' || typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN
      if (!Number.isFinite(value) || value < 0 || value * 1024 > Number.MAX_SAFE_INTEGER || source === 'memory_total_kib' && value === 0) throw new Error(`${source} 未返回有效容量`)
      return value * 1024
    }))
    const [total, free] = values
    const errors = values.flatMap((value) => value.status === 'rejected' ? [value.reason instanceof Error ? value.reason.message : String(value.reason)] : [])
    const invalidFree = total.status === 'fulfilled' && free.status === 'fulfilled' && free.value > total.value
    if (invalidFree) errors.push('可用内存超过总容量')
    return {
      ...record, ref, connectionId, poolName,
      memory_total: total.status === 'fulfilled' ? total.value : undefined,
      memory_free: free.status === 'fulfilled' && !invalidFree ? free.value : undefined,
      memoryReadError: errors.length ? [...new Set(errors)].join('；') : undefined,
    }
  })) as ConnectedHostRecord[]
  return records
}

export async function getHostMetrics(connectionId: string, metricsRef: string): Promise<HostMetrics> {
  const client = getClient(connectionId)
  const record = await client.callWithSession('host_metrics.get_record', [metricsRef])
  return { ref: metricsRef, ...record }
}

export async function enableHost(connectionId: string, hostRef: string): Promise<void> {
  const client = getClient(connectionId)
  await client.callWithSession('host.enable', [hostRef])
}

export async function disableHost(connectionId: string, hostRef: string): Promise<void> {
  const client = getClient(connectionId)
  await client.callWithSession('host.disable', [hostRef])
}

export async function rebootHost(connectionId: string, hostRef: string): Promise<void> {
  const client = getClient(connectionId)
  await client.callWithSession('host.reboot', [hostRef])
}

export async function shutdownHost(connectionId: string, hostRef: string): Promise<void> {
  const client = getClient(connectionId)
  await client.callWithSession('host.shutdown', [hostRef])
}

// ============================================================================
// v5: New maintenance mode methods
// ============================================================================

/**
 * Get the maintenance status of a host.
 * Returns the host state, running VM count, and resident VM list.
 */
export async function getMaintenanceStatus(
  connectionId: string,
  hostRef: string
): Promise<MaintenanceStatus> {
  const client = getClient(connectionId)

  const record = await client.callWithSession('host.get_record', [hostRef])

  const residentVms: string[] = []
  let runningVms = 0
  for (const vmRef of record.resident_VMs || []) {
    const vm = await client.callWithSession('VM.get_record', [vmRef])
    if (!vm.is_control_domain) {
      residentVms.push(vmRef)
      if (vm.power_state === 'Running' || vm.power_state === 'Paused') runningVms++
    }
  }
  const state: MaintenanceStatus['state'] = record.enabled ? 'enabled'
    : record.other_config?.[MAINTENANCE_KEY] === 'true' && residentVms.length === 0 ? 'maintenance' : 'disabled'

  return {
    hostRef,
    state,
    runningVms,
    residentVms,
  }
}

/**
 * Evacuate all VMs from a host.
 * Observe the server task and resident VM postcondition without replaying failures.
 */
export async function evacuateHost(
  connectionId: string,
  hostRef: string
): Promise<EvacuateResult> {
  const client = getClient(connectionId)
  // Disable scheduling before reading residents so new workloads cannot arrive.
  const before = await client.callWithSession('host.get_record', [hostRef])
  if (before.enabled) await disableHost(connectionId, hostRef)
  const status = await getMaintenanceStatus(connectionId, hostRef)
  if (status.state === 'enabled') throw new Error('HOST_DISABLE_UNCONFIRMED: Host still accepts workloads')
  if (status.residentVms.length === 0) return { success: true, migratedVms: [], failedVms: [] }
  const taskRef = await client.callWithSession('Async.host.evacuate', [hostRef])
  await waitForXapiTask(client, taskRef)
  let after: MaintenanceStatus
  try { after = await readOperationResult(() => getMaintenanceStatus(connectionId, hostRef)) }
  catch (error) { throw taskOutcomeUnknown(taskRef, error instanceof Error ? error.message : String(error)) }
  const remaining = new Set(after.residentVms)
  return {
    success: after.state !== 'enabled' && remaining.size === 0,
    migratedVms: status.residentVms.filter((ref) => !remaining.has(ref)),
    failedVms: after.residentVms.map((vmRef) => ({ vmRef, error: 'VM_STILL_RESIDENT: VM remains on the source host' })),
  }
}

/** Enter maintenance only after scheduling is disabled and evacuation is verified. */
export async function enterMaintenanceMode(connectionId: string, hostRef: string): Promise<EvacuateResult> {
  const result = await evacuateHost(connectionId, hostRef)
  if (!result.success) return result
  const client = getClient(connectionId)
  if ((await getMaintenanceStatus(connectionId, hostRef)).state === 'maintenance') return result
  await client.callWithSession('host.remove_from_other_config', [hostRef, MAINTENANCE_KEY])
  await client.callWithSession('host.add_to_other_config', [hostRef, MAINTENANCE_KEY, 'true'])
  const status = await getMaintenanceStatus(connectionId, hostRef)
  if (status.state !== 'maintenance') throw new Error('MAINTENANCE_UNCONFIRMED: Host maintenance state could not be verified')
  return result
}

/**
 * Exit maintenance mode: enable the host.
 */
export async function exitMaintenanceMode(
  connectionId: string,
  hostRef: string
): Promise<void> {
  await enableHost(connectionId, hostRef)
  const client = getClient(connectionId)
  const record = await client.callWithSession('host.get_record', [hostRef])
  if (!record.enabled) throw new Error('HOST_ENABLE_UNCONFIRMED: Host is still disabled')
  await client.callWithSession('host.remove_from_other_config', [hostRef, MAINTENANCE_KEY])
}
