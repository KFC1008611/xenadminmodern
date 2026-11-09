/**
 * Pool service — wraps XAPI pool.* methods.
 * All functions accept connectionId as the first parameter for multi-connection support.
 * v6: Extended with pool scaling operations (addHost, removeHost, transferMaster).
 */
import { connectionManager } from '../connection-manager'
import { XapiClient } from '../client'
import { evacuateHost } from './host.service'
import { waitForXapiTask, taskOutcomeUnknown } from './xapi-task'
import type {
  ConnectedPoolRecord,
  PoolJoinParams,
} from '../../../shared/types/xapi'

export interface PoolEvacuateResult {
  success: boolean
  migratedVms: string[]
  failedVms: Array<{ vmRef: string; error: string }>
}

/**
 * Custom error class for IPC-call-level errors with structured codes.
 */
export class IpcError extends Error {
  code: string
  details?: any
  constructor(code: string, message: string, details?: any) {
    super(message)
    this.code = code
    this.details = details
  }
}

function getClient(connectionId: string) {
  const client = connectionManager.getClient(connectionId)
  if (!client) {
    throw new Error(`No connection found for connectionId: ${connectionId}`)
  }
  return client
}

export async function getPool(connectionId: string): Promise<ConnectedPoolRecord | null> {
  const client = getClient(connectionId)
  const refs: string[] = await client.callWithSession('pool.get_all', [])
  if (refs.length === 0) return null
  const record = await client.callWithSession('pool.get_record', [refs[0]])
  return { ref: refs[0], ...record, connectionId }
}

// ============================================================================
// v6: Pool scaling methods
// ============================================================================

/**
 * Add a host to the pool.
 * Connects to the target host, verifies version compatibility,
 * then calls pool.join to add it to the pool.
 * Returns a task ref for progress tracking.
 */
export async function addHostToPool(
  connectionId: string,
  params: PoolJoinParams
): Promise<string> {
  const client = getClient(connectionId)
  const pool = await getPool(connectionId)
  if (!pool) throw new IpcError('POOL_JOIN_FAILED', 'No pool found for the current connection')
  const destination = connectionManager.getConnectionOptions(connectionId)
  if (!destination) throw new IpcError('POOL_JOIN_FAILED', 'Destination credentials are unavailable')
  const master = await client.callWithSession('host.get_record', [pool.master])
  if (params.masterAddress !== master.address) throw new IpcError('POOL_MASTER_MISMATCH', 'Destination address must match the selected pool coordinator')
  if (params.targetHost === master.address) throw new IpcError('HOST_ALREADY_IN_POOL', 'The selected host is already the coordinator')
  const joining = new XapiClient()
  try {
    await joining.connect({ ...destination, host: params.targetHost, username: params.username, password: params.password })
    // XapiClient follows HOST_IS_SLAVE for normal connections. A join must never
    // accidentally execute on the existing pool coordinator after that redirect.
    if (joining.getConnectedHost() !== params.targetHost) throw new IpcError('HOST_ALREADY_IN_POOL', 'Joining host belongs to another resource pool')
    const hosts = await joining.callWithSession('host.get_all_records', [])
    const entries = Object.entries(hosts)
    if (entries.length !== 1) throw new IpcError('HOST_ALREADY_IN_POOL', 'Only a standalone host can join a pool')
    const target = entries[0][1] as any
    if (target.uuid === master.uuid) throw new IpcError('HOST_ALREADY_IN_POOL', 'Joining host is the destination coordinator')
    if (!params.forceJoin && (!master.software_version?.product_version || target.software_version?.product_version !== master.software_version.product_version)) {
      throw new IpcError('HOST_VERSION_INCOMPATIBLE', 'Joining host and coordinator versions differ or are unknown')
    }
    const taskRef = await joining.callWithSession(params.forceJoin ? 'Async.pool.join_force' : 'Async.pool.join', [
      master.address, destination.username, destination.password,
    ])
    await waitForXapiTask(joining, taskRef)
    let joinedHosts: Record<string, any>
    try { joinedHosts = await client.callWithSession('host.get_all_records', []) } catch { throw taskOutcomeUnknown(taskRef) }
    if (!Object.values(joinedHosts).some((host) => host.uuid === target.uuid)) throw taskOutcomeUnknown(taskRef)
    return taskRef
  } finally {
    await joining.disconnect()
  }
}

/**
 * Remove a host from the pool.
 * Checks if the host is the master (cannot be removed),
 * optionally evacuates running VMs, then calls pool.eject.
 * Returns a task ref and evacuation results.
 */
export async function removeHostFromPool(
  connectionId: string,
  hostRef: string
): Promise<string> {
  const client = getClient(connectionId)

  // Check if this is the master host
  const poolRefs: string[] = await client.callWithSession('pool.get_all', [])
  if (poolRefs.length > 0) {
    const poolRecord = await client.callWithSession('pool.get_record', [poolRefs[0]])
    if (poolRecord.master === hostRef) {
      throw new IpcError(
        'HOST_IS_MASTER',
        'Cannot remove the pool master. Transfer master role first.'
      )
    }
  }

  // Get host record to check for running VMs
  const hostRecord = await client.callWithSession('host.get_record', [hostRef])
  const residentVms: string[] = hostRecord.resident_VMs || []

  if (hostRecord.enabled !== false) throw new IpcError('HOST_NOT_DISABLED', 'Disable and evacuate the host before removal')
  for (const vmRef of residentVms) {
    const vm = await client.callWithSession('VM.get_record', [vmRef])
    if (!vm.is_control_domain) throw new IpcError('HOST_HAS_RESIDENT_VMS', 'Evacuate all guest VMs before removal')
  }

  // Eject the host from the pool
  const taskRef: string = await client.callWithSession('Async.pool.eject', [hostRef])

  return taskRef
}

/**
 * Transfer pool master role to a new host.
 * Validates the new master candidate, then calls pool.designate_new_master.
 * Returns a task ref for progress tracking.
 */
export async function transferPoolMaster(
  connectionId: string,
  newMasterRef: string
): Promise<string> {
  const client = getClient(connectionId)

  // Verify the new master candidate exists and is enabled
  let hostRecord: any
  try {
    hostRecord = await client.callWithSession('host.get_record', [newMasterRef])
  } catch (error: any) {
    if (error?.code !== 'HANDLE_INVALID' && !error?.message?.includes('HANDLE_INVALID')) throw error
    throw new IpcError(
      'HOST_NOT_IN_POOL',
      `Host ${newMasterRef} not found in the pool`
    )
  }

  if (!hostRecord.enabled) {
    throw new IpcError(
      'HOST_NOT_ENABLED',
      `Host ${hostRecord.name_label || newMasterRef} is not enabled`
    )
  }

  // Execute master transfer
  const taskRef: string = await client.callWithSession(
    'Async.pool.designate_new_master',
    [newMasterRef]
  )

  return taskRef
}

/**
 * Evacuate all VMs from a host before removal.
 * Shares the verified host evacuation workflow.
 */
export async function evacuateHostForRemoval(
  connectionId: string,
  hostRef: string
): Promise<PoolEvacuateResult> {
  return evacuateHost(connectionId, hostRef)
}
