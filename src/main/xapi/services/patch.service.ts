/** Legacy pool_patch inventory. This does not enumerate modern repository updates. */
import { connectionManager } from '../connection-manager'
import type {
  ConnectedPatchRecord, HostPatchStatus, PatchUploadResult, PatchApplyResult,
  PatchCompatibilityInfo,
} from '../../../shared/ipc-contracts/patch-governance'
export type { ConnectedPatchRecord, HostPatchStatus, PatchUploadResult, PatchApplyResult, PatchCompatibilityInfo }
export type PatchRecord = Omit<ConnectedPatchRecord, 'connectionId' | 'poolName'>

function getClient(connectionId: string) {
  const client = connectionManager.getClient(connectionId)
  if (!client) throw new Error(`No connection found for connectionId: ${connectionId}`)
  return client
}

function mapPatch(connectionId: string, ref: string, record: any, statuses: HostPatchStatus[], hostRefs: string[]): ConnectedPatchRecord {
  if (typeof record.version !== 'string') throw new Error('PATCH_CONTRACT_MISMATCH: Patch version must be a string')
  const hosts = statuses.filter((status) => status.patchRef === ref && status.applied).map((status) => status.hostRef)
  return {
    ref, uuid: record.uuid || '', name_label: record.name_label || '', name_description: record.name_description || '',
    size: record.size || 0, version: record.version, update_url: '',
    applied: hostRefs.length > 0 && hostRefs.every((hostRef) => hosts.includes(hostRef)),
    after_apply_guides: record.after_apply_guidance || [], upload_date: null, hosts,
    connectionId, poolName: connectionManager.getConnectionInfo(connectionId)?.poolName ?? connectionId,
  }
}

async function inventory(connectionId: string) {
  const client = getClient(connectionId)
  const [patches, hosts, hostPatches] = await Promise.all([
    client.callWithSession('pool_patch.get_all_records', []),
    client.callWithSession('host.get_all_records', []),
    client.callWithSession('host_patch.get_all_records', []),
  ])
  const statuses: HostPatchStatus[] = Object.values(hostPatches).map((raw) => {
    const record = raw as Record<string, any>
    const patch = patches[record.pool_patch]
    const host = hosts[record.host]
    if (!patch || !host || typeof record.applied !== 'boolean') {
      throw new Error('PATCH_INVENTORY_INCOMPLETE: Cannot resolve a host_patch record')
    }
    const timestamp = record.timestamp_applied ? new Date(record.timestamp_applied) : undefined
    if (timestamp && Number.isNaN(timestamp.getTime())) throw new Error('PATCH_CONTRACT_MISMATCH: Invalid applied timestamp')
    return {
      hostRef: record.host, hostName: host.name_label || record.host,
      patchRef: record.pool_patch, patchName: patch.name_label || record.pool_patch, applied: record.applied,
      ...(record.applied && timestamp ? { appliedTimestamp: timestamp } : {}),
    }
  })
  return { patches, hosts, statuses }
}

export async function getAllPatches(connectionId: string): Promise<ConnectedPatchRecord[]> {
  const { patches, hosts, statuses } = await inventory(connectionId)
  return Object.entries(patches).map(([ref, patch]) => mapPatch(connectionId, ref, patch, statuses, Object.keys(hosts)))
}

export async function getPatchRecord(connectionId: string, patchRef: string): Promise<ConnectedPatchRecord | null> {
  const { patches, hosts, statuses } = await inventory(connectionId)
  return patches[patchRef] ? mapPatch(connectionId, patchRef, patches[patchRef], statuses, Object.keys(hosts)) : null
}

export async function getHostPatchStatus(connectionId: string): Promise<HostPatchStatus[]> {
  return (await inventory(connectionId)).statuses
}

export async function getMissingPatchesForHost(connectionId: string, hostRef: string): Promise<ConnectedPatchRecord[]> {
  const { patches, hosts, statuses } = await inventory(connectionId)
  if (!hosts[hostRef]) throw new Error('HANDLE_INVALID: Host is absent from patch inventory')
  const applied = new Set(statuses.filter((status) => status.hostRef === hostRef && status.applied).map((status) => status.patchRef))
  return Object.entries(patches).filter(([ref]) => !applied.has(ref))
    .map(([ref, patch]) => mapPatch(connectionId, ref, patch, statuses, Object.keys(hosts)))
}

export async function uploadPatch(_connectionId: string, _filePath: string): Promise<PatchUploadResult> {
  // Upload uses an authenticated HTTP data plane, never an RPC carrying a local path.
  throw new Error('PATCH_UPLOAD_UNAVAILABLE: Authenticated patch upload is not implemented for this server family')
}

export async function precheckPatch(connectionId: string, patchRef: string): Promise<PatchCompatibilityInfo> {
  const client = getClient(connectionId)
  const record = await client.callWithSession('pool_patch.get_record', [patchRef])
  const hosts = await client.callWithSession('host.get_all_records', [])
  const incompatibilities: PatchCompatibilityInfo['incompatibilities'] = []
  for (const [hostRef, host] of Object.entries(hosts)) {
    try {
      await client.callWithSession('pool_patch.precheck', [patchRef, hostRef])
    } catch (error: any) {
      // A transport/session failure gives no compatibility verdict.
      if (!String(error?.code || error?.message).match(/PATCH_|UPDATE_|HOST_IN_EMERGENCY_MODE/)) throw error
      incompatibilities.push({ hostRef, hostName: (host as any).name_label || hostRef, reason: error.message })
    }
  }
  return { patchRef, patchName: record.name_label || patchRef, compatible: incompatibilities.length === 0,
    incompatibilities, afterApplyGuides: record.after_apply_guidance || [] }
}

export async function applyPatchToHost(connectionId: string, hostRef: string, patchRef: string): Promise<void> {
  const client = getClient(connectionId)
  await client.callWithSession('pool_patch.precheck', [patchRef, hostRef])
  await client.callWithSession('pool_patch.apply', [patchRef, hostRef])
  const statuses = await getHostPatchStatus(connectionId)
  if (!statuses.some((status) => status.hostRef === hostRef && status.patchRef === patchRef && status.applied)) {
    throw new Error('PATCH_APPLY_UNCONFIRMED: Application returned but host_patch does not confirm it; refresh before retrying')
  }
}

export async function applyPatch(connectionId: string, patchRef: string): Promise<PatchApplyResult> {
  const hosts = await getClient(connectionId).callWithSession('host.get_all_records', [])
  const result: PatchApplyResult = { patchRef, success: true, hostResults: [] }
  for (const [hostRef, host] of Object.entries(hosts)) {
    // Stop on error: a lost response must not start mutations on more hosts.
    await applyPatchToHost(connectionId, hostRef, patchRef)
    result.hostResults.push({ hostRef, hostName: (host as any).name_label || hostRef, success: true })
  }
  return result
}

/** Delete uploaded patch files; this does not uninstall an applied patch. */
export async function cleanPatch(connectionId: string, patchRef: string): Promise<void> {
  await getClient(connectionId).callWithSession('pool_patch.clean', [patchRef])
}

/** Remove an unapplied legacy patch record and its files. */
export async function destroyPatch(connectionId: string, patchRef: string): Promise<void> {
  const statuses = await getHostPatchStatus(connectionId)
  if (statuses.some((status) => status.patchRef === patchRef && status.applied)) throw new Error('PATCH_ALREADY_APPLIED: Applied patches cannot be uninstalled')
  await getClient(connectionId).callWithSession('pool_patch.destroy', [patchRef])
}

export async function destroyPatchFromHost(_connectionId: string, _hostRef: string, _patchRef: string): Promise<void> {
  throw new Error('PATCH_UNINSTALL_UNSUPPORTED: XAPI does not provide host patch uninstall')
}

export async function applyPatchesBatch(connectionId: string, patchRefs: string[]): Promise<Array<{ patchRef: string; result: PatchApplyResult }>> {
  const results: Array<{ patchRef: string; result: PatchApplyResult }> = []
  for (const patchRef of patchRefs) results.push({ patchRef, result: await applyPatch(connectionId, patchRef) })
  return results
}
