/**
 * Storage advanced service — wraps XAPI VDI.*, PBD.*, SR.* advanced methods.
 * All functions accept connectionId as the first parameter for multi-connection support.
 * v9: New service for advanced storage features (VDI clone/snapshot, PBD management, ISO).
 */
import { connectionManager } from '../connection-manager'
import { readOperationResult } from '../../../shared/read-operation-result'
import type {
  ConnectedPbdRecord,
  ConnectedVdiRecord,
  SrIntroduceParams,
  ThinProvisioningStats,
  VdiCloneParams,
  VdiCopyParams,
} from '../../../shared/types/xapi'

export type {
  ConnectedPbdRecord,
  PbdRecord,
  SrIntroduceParams,
  ThinProvisioningStats,
  VdiCloneParams,
  VdiCopyParams,
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

function isIsoSrRecord(record: any): boolean {
  return record?.type === 'iso' || record?.content_type === 'iso'
}

function isIsoVdiRecord(vdi: any, srRecord?: any): boolean {
  return vdi?.is_tools_iso === true || vdi?.type === 'iso' || isIsoSrRecord(srRecord)
}

// ============================================================================
// PBD management
// ============================================================================

/**
 * Get all PBDs for the pool.
 */
export async function getAllPbds(connectionId: string): Promise<ConnectedPbdRecord[]> {
  const client = getClient(connectionId)
  const poolName = getPoolName(connectionId)
  const allRecords: Record<string, any> = await client.callWithSession('PBD.get_all_records', [])
  const records = Object.entries(allRecords).map(([ref, record]) => ({
    ref,
    ...record,
    connectionId,
    poolName,
  })) as ConnectedPbdRecord[]
  return records
}

/**
 * Create a PBD to connect an SR to a host.
 */
export async function createPbd(
  connectionId: string,
  hostRef: string,
  srRef: string,
  deviceConfig: Record<string, string> = {}
): Promise<string> {
  const client = getClient(connectionId)
  const pbdRef = await client.callWithSession('PBD.create', [{
    host: hostRef,
    SR: srRef,
    device_config: deviceConfig,
    other_config: {},
  }])
  return pbdRef
}

/**
 * Plug (connect) a PBD.
 */
export async function plugPbd(connectionId: string, pbdRef: string): Promise<void> {
  const client = getClient(connectionId)
  await client.callWithSession('PBD.plug', [pbdRef])
  try {
    await readOperationResult(async () => {
      const attached = await client.callWithSession('PBD.get_currently_attached', [pbdRef])
      if (attached !== true) throw new Error('主机尚未报告该物理存储连接已接通')
    }, { isCurrent: () => connectionManager.getClient(connectionId) === client })
  } catch (cause) {
    const error = new Error(`无法获取物理存储连接结果：${cause instanceof Error ? cause.message : String(cause)}`) as Error & { code: string }
    error.code = 'PBD_STATE_UNCONFIRMED'
    throw error
  }
}

/**
 * Unplug (disconnect) a PBD.
 */
export async function unplugPbd(connectionId: string, pbdRef: string): Promise<void> {
  const client = getClient(connectionId)
  await client.callWithSession('PBD.unplug', [pbdRef])
}

/**
 * Destroy a PBD.
 */
export async function destroyPbd(connectionId: string, pbdRef: string): Promise<void> {
  const client = getClient(connectionId)
  await client.callWithSession('PBD.destroy', [pbdRef])
}

// ============================================================================
// VDI clone/snapshot/copy
// ============================================================================

/**
 * Clone a VDI within the same SR or to a different SR.
 */
export async function cloneVdi(connectionId: string, params: VdiCloneParams): Promise<string> {
  const client = getClient(connectionId)
  const nameLabel = params.nameLabel || 'Cloned VDI'

  const newVdiRef: string = await client.callWithSession('VDI.clone', [params.vdiRef, {}])
  await client.callWithSession('VDI.set_name_label', [newVdiRef, nameLabel])

  return newVdiRef
}

/**
 * Create a snapshot of a VDI.
 */
export async function snapshotVdi(
  connectionId: string,
  vdiRef: string,
  nameLabel?: string
): Promise<string> {
  const client = getClient(connectionId)
  const name = nameLabel || `Snapshot ${new Date().toISOString()}`

  const snapshotRef: string = await client.callWithSession('VDI.snapshot', [vdiRef, {}])
  await client.callWithSession('VDI.set_name_label', [snapshotRef, name])

  return snapshotRef
}

/**
 * Copy a VDI to a different SR.
 */
export async function copyVdi(connectionId: string, params: VdiCopyParams): Promise<string> {
  const client = getClient(connectionId)

  const newVdiRef: string = await client.callWithSession('VDI.copy', [
    params.vdiRef,
    params.targetSrRef,
    'OpaqueRef:NULL',
    'OpaqueRef:NULL',
  ])

  if (params.nameLabel) {
    await client.callWithSession('VDI.set_name_label', [newVdiRef, params.nameLabel])
  }

  return newVdiRef
}

// ============================================================================
// SR introduce/forget/shared
// ============================================================================

/**
 * Introduce (register) an existing SR to the pool.
 */
export async function introduceSr(connectionId: string, params: SrIntroduceParams): Promise<string> {
  const client = getClient(connectionId)

  const srRef: string = await client.callWithSession('SR.introduce', [
    params.uuid,
    params.nameLabel,
    params.nameDescription,
    params.type,
    params.contentType || '',
    params.shared || false,
  ])

  return srRef
}

/**
 * Forget (unregister) an SR from the pool without destroying data.
 */
export async function forgetSr(connectionId: string, srRef: string): Promise<void> {
  const client = getClient(connectionId)
  await client.callWithSession('SR.forget', [srRef])
}

/**
 * Set an SR as shared or not shared.
 */
export async function setSrShared(
  connectionId: string,
  srRef: string,
  shared: boolean
): Promise<void> {
  const client = getClient(connectionId)
  await client.callWithSession('SR.set_shared', [srRef, shared])
}

// ============================================================================
// VDI metadata
// ============================================================================

/**
 * Set VDI name label.
 */
export async function setVdiNameLabel(
  connectionId: string,
  vdiRef: string,
  name: string
): Promise<void> {
  const client = getClient(connectionId)
  await client.callWithSession('VDI.set_name_label', [vdiRef, name])
}

/**
 * Set VDI name description.
 */
export async function setVdiNameDescription(
  connectionId: string,
  vdiRef: string,
  description: string
): Promise<void> {
  const client = getClient(connectionId)
  await client.callWithSession('VDI.set_name_description', [vdiRef, description])
}

/**
 * Add a tag to a VDI.
 */
export async function addVdiTag(connectionId: string, vdiRef: string, tag: string): Promise<void> {
  const client = getClient(connectionId)
  await client.callWithSession('VDI.add_to_tags', [vdiRef, tag])
}

/**
 * Remove a tag from a VDI.
 */
export async function removeVdiTag(
  connectionId: string,
  vdiRef: string,
  tag: string
): Promise<void> {
  const client = getClient(connectionId)
  await client.callWithSession('VDI.remove_from_tags', [vdiRef, tag])
}

// ============================================================================
// ISO management
// ============================================================================

/**
 * Get ISO VDIs from an ISO SR.
 */
export async function getIsos(connectionId: string, srRef: string): Promise<ConnectedVdiRecord[]> {
  const client = getClient(connectionId)
  const poolName = getPoolName(connectionId)

  const [srRecord, allRecords]: [any, Record<string, any>] = await Promise.all([
    client.callWithSession('SR.get_record', [srRef]),
    client.callWithSession('VDI.get_all_records', []),
  ])

  const records = Object.entries(allRecords)
    .filter(([, record]: [string, any]) => record.SR === srRef && isIsoVdiRecord(record, srRecord))
    .map(([ref, record]) => ({
      ref,
      ...record,
      virtual_size: Number(record.virtual_size),
      physical_utilisation: Number(record.physical_utilisation),
      connectionId,
      poolName,
    })) as ConnectedVdiRecord[]

  return records
}

/**
 * Delete an ISO VDI.
 */
export async function deleteIso(connectionId: string, vdiRef: string): Promise<void> {
  const client = getClient(connectionId)

  const vdiRecord = await client.callWithSession('VDI.get_record', [vdiRef])
  let srRecord: any = null
  if (vdiRecord.SR && vdiRecord.SR !== 'OpaqueRef:NULL') {
    try {
      srRecord = await client.callWithSession('SR.get_record', [vdiRecord.SR])
    } catch {
      // Tools ISOs can still be identified by VDI.is_tools_iso.
    }
  }
  if (!isIsoVdiRecord(vdiRecord, srRecord)) {
    throw new Error('VDI is not an ISO')
  }

  await client.callWithSession('VDI.destroy', [vdiRef])
}

// ============================================================================
// Thin provisioning stats
// ============================================================================

/**
 * Get thin provisioning stats for an SR.
 */
export async function getSrThinProvisioningStats(
  connectionId: string,
  srRef: string,
): Promise<ThinProvisioningStats> {
  const client = getClient(connectionId)
  const srRecord = await client.callWithSession('SR.get_record', [srRef])

  const physicalSize = Number(srRecord.physical_size)
  const physicalUtilisation = Number(srRecord.physical_utilisation)
  const virtualAllocation = Number(srRecord.virtual_allocation)
  if (![physicalSize, physicalUtilisation, virtualAllocation].every((value) => Number.isFinite(value) && value >= 0)) {
    throw new Error('存储仓库未返回有效容量数据，无法计算精简配置统计')
  }

  const overprovisionRatio = physicalSize > 0 ? virtualAllocation / physicalSize : 0

  return {
    physicalSize,
    physicalUtilisation,
    virtualAllocation,
    overprovisionRatio,
  }
}
