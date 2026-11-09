/**
 * HA (High Availability) service — wraps XAPI pool.* and VM.* HA methods.
 * All functions accept connectionId as the first parameter for multi-connection support.
 * v9: New service for HA configuration and management.
 */
import { connectionManager } from '../connection-manager'
import type {
  ConnectedHaConfiguration,
  HaComputeResult,
  HaFailoverPlan,
  HaHostStatus,
  HaVmConfig,
  HaRestartPriority,
} from '../../../shared/types/xapi'


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
// HA Status and Configuration
// ============================================================================

/**
 * Get HA configuration for the pool.
 */
export async function getHaConfiguration(
  connectionId: string
): Promise<ConnectedHaConfiguration | null> {
  const client = getClient(connectionId)
  const poolName = getPoolName(connectionId)

  // Get pool record
  const poolRefs: string[] = await client.callWithSession('pool.get_all', [])
  if (poolRefs.length === 0) {
    return null
  }

  const poolRef = poolRefs[0]
  const poolRecord = await client.callWithSession('pool.get_record', [poolRef])

  // Host liveness belongs to host_metrics, not a synthetic host.get_ha_state API.
  const hostRecords = await client.callWithSession('host.get_all_records', [])
  const metricsRecords = await client.callWithSession('host_metrics.get_all_records', [])
  const hosts: HaHostStatus[] = Object.entries(hostRecords).map(([hostRef, value]) => {
    const host = value as Record<string, any>
    const live = metricsRecords[host.metrics]?.live
    return {
      hostRef, hostName: host.name_label || hostRef,
      live: typeof live === 'boolean' ? live : null,
      failed: typeof live === 'boolean' ? !live : null,
      failureMode: 'unknown',
    }
  })
  const heartbeatSRs = new Set<string>()
  for (const statefile of poolRecord.ha_statefiles || []) {
    const vdiRef = statefile.startsWith('OpaqueRef:')
      ? statefile
      : await client.callWithSession('VDI.get_by_uuid', [statefile])
    const vdi = await client.callWithSession('VDI.get_record', [vdiRef])
    heartbeatSRs.add(vdi.SR)
  }

  return {
    enabled: poolRecord.ha_enabled || false,
    allowOvercommit: poolRecord.ha_allow_overcommit || false,
    plannedRepeats: poolRecord.ha_plan_exists_for || 0,
    heartbeatSRs: [...heartbeatSRs],
    hosts,
    connectionId,
    poolName,
  }
}

/**
 * Enable HA for the pool.
 */
export async function enableHa(
  connectionId: string,
  params: {
    heartbeatSRs: string[]
    allowOvercommit?: boolean
  }
): Promise<void> {
  const client = getClient(connectionId)

  const poolRefs: string[] = await client.callWithSession('pool.get_all', [])
  if (poolRefs.length === 0) {
    throw new Error('POOL_NOT_FOUND: Not connected to a pool')
  }

  const poolRef = poolRefs[0]
  const poolRecord = await client.callWithSession('pool.get_record', [poolRef])
  const nextAllowOvercommit = params.allowOvercommit ?? false
  if (Boolean(poolRecord?.ha_allow_overcommit) !== nextAllowOvercommit) {
    await client.callWithSession('pool.set_ha_allow_overcommit', [poolRef, nextAllowOvercommit])
  }
  // A lost enable response is not evidence that HA stayed disabled. Do not
  // automatically restore a setting while HA may already be active.
  await client.callWithSession('pool.enable_ha', [params.heartbeatSRs, {}])
}

/**
 * Disable HA for the pool.
 */
export async function disableHa(connectionId: string): Promise<void> {
  const client = getClient(connectionId)
  await client.callWithSession('pool.disable_ha', [])
}

// ============================================================================
// HA Compute and Planning
// ============================================================================

/**
 * Compute maximum host failures the pool can tolerate.
 */
export async function computeHaTolerance(
  connectionId: string
): Promise<HaComputeResult> {
  const client = getClient(connectionId)

  const result = await client.callWithSession(
    'pool.ha_compute_max_host_failures_to_tolerate',
    []
  )

  if (typeof result !== 'number' || !Number.isInteger(result) || result < 0) {
    throw new Error('HA_CONTRACT_MISMATCH: Expected a non-negative integer failure tolerance')
  }
  return {
    canHandleHostFailures: result,
    vmsThatCouldBeRestarted: null,
    vmsThatWouldNotBeRestarted: null,
  }
}

/**
 * Prevent HA restarts for a specified period.
 */
export async function preventHaRestarts(
  connectionId: string,
  seconds: number
): Promise<void> {
  const client = getClient(connectionId)
  await client.callWithSession('pool.ha_prevent_restarts_for', [seconds])
}

/**
 * Always restart VMs immediately (override normal HA behavior).
 */
export async function haAlwaysRestart(connectionId: string): Promise<void> {
  // 0 seconds = restart immediately for all VMs
  await preventHaRestarts(connectionId, 0)
}

// ============================================================================
// VM HA Configuration
// ============================================================================

/**
 * Get HA configuration for all VMs.
 */
export async function getHaVmConfigs(
  connectionId: string
): Promise<HaVmConfig[]> {
  const client = getClient(connectionId)

  const records = await client.callWithSession('VM.get_all_records', [])
  const configs: HaVmConfig[] = []
  for (const [vmRef, value] of Object.entries(records)) {
    const vmRecord = value as Record<string, any>
    if (vmRecord.is_a_template || vmRecord.is_a_snapshot || vmRecord.is_control_domain) continue
    const priority = vmRecord.ha_restart_priority
    if (priority !== '' && priority !== 'restart' && priority !== 'best-effort') {
      throw new Error(`HA_CONTRACT_MISMATCH: Unknown restart policy for VM ${vmRef}`)
    }
    configs.push({
      vmRef, vmName: vmRecord.name_label || vmRef, restartPriority: priority,
      alwaysRun: vmRecord.ha_always_run === true,
    })
  }

  return configs
}

/**
 * Set HA restart priority for a VM.
 */
export async function setHaVmRestartPriority(
  connectionId: string,
  vmRef: string,
  priority: HaRestartPriority
): Promise<void> {
  const client = getClient(connectionId)
  if (!['', 'restart', 'best-effort'].includes(priority)) throw new Error('HA_RESTART_POLICY_INVALID')
  await client.callWithSession('VM.set_ha_restart_priority', [vmRef, priority])
}

/**
 * Set VM to always run.
 */
export async function setHaVmAlwaysRun(
  connectionId: string,
  vmRef: string,
  alwaysRun: boolean
): Promise<void> {
  const client = getClient(connectionId)
  await client.callWithSession('VM.set_ha_always_run', [vmRef, alwaysRun])
}

/**
 * Get if VM is set to always run.
 */
export async function getHaVmAlwaysRun(
  connectionId: string,
  vmRef: string
): Promise<boolean> {
  const client = getClient(connectionId)
  const vmRecord = await client.callWithSession('VM.get_record', [vmRef])
  return vmRecord.ha_always_run || false
}

// ============================================================================
// Emergency Operations
// ============================================================================

/**
 * Emergency transition to master.
 * Use when the pool master has failed and cannot be recovered.
 */
export async function emergencyTransitionToMaster(
  connectionId: string
): Promise<void> {
  const client = getClient(connectionId)
  await client.callWithSession('pool.emergency_transition_to_master', [])
}

/**
 * Recover failed slave hosts.
 */
export async function recoverHaSlaves(
  connectionId: string
): Promise<void> {
  const client = getClient(connectionId)
  await client.callWithSession('pool.recover_slaves', [])
}

/**
 * Get HA failover plan.
 */
export async function getHaFailoverPlan(
  connectionId: string
): Promise<HaFailoverPlan> {
  // Get VM configs
  const vmConfigs = await getHaVmConfigs(connectionId)

  // This endpoint summarizes the configured policies. A placement prediction
  // needs an explicit failed-host scenario and ha_compute_vm_failover_plan.
  const vmsByPriority = (['restart', 'best-effort'] as const)
    .map(priority => ({ priority, vms: vmConfigs.filter(vm => vm.restartPriority === priority) }))
    .filter(group => group.vms.length > 0)
  const { canHandleHostFailures: canTolerateFailures } = await computeHaTolerance(connectionId)

  return {
    vmsByPriority,
    canTolerateFailures,
  }
}
