/**
 * SR (Storage Repository) service — wraps XAPI SR.*, VDI.*, PBD.* methods.
 * All functions accept connectionId as the first parameter for multi-connection support.
 * v5: Renamed from storage.service.ts and extended with SR management features.
 */
import { connectionManager } from '../connection-manager'
import { readOperationResult, ReadScopeChangedError } from '../../../shared/read-operation-result'
import { XMLParser, XMLValidator } from 'fast-xml-parser'
import { isLostMutationResponse, readMutationResult, confirmRecordDeleted } from './mutation-result'
import type { IscsiProbeOptions, IscsiLun, VdiDeleteResult, SrIdentity, SrIdentityUpdate } from '../../../shared/types/xapi'

export interface SrRecord {
  ref: string
  uuid: string
  name_label: string
  name_description: string
  type: string
  physical_size: number
  physical_utilisation: number
  virtual_allocation: number
  VDIs: string[]
  PBDs: string[]
  shared: boolean
}

export interface VdiRecord {
  ref: string
  uuid: string
  name_label: string
  virtual_size: number
  physical_utilisation: number
  type: string
  SR: string
  VBDs: string[]
  read_only: boolean
}

export interface ConnectedSrRecord extends SrRecord {
  connectionId: string
  poolName: string
}

export interface ConnectedVdiRecord extends VdiRecord {
  connectionId: string
  poolName: string
}

export interface SrCreateParams {
  type: 'ext' | 'nfs' | 'iscsi' | 'hba' | 'iso'
  existingSrUuid?: string
  nameLabel: string
  nameDescription: string
  nfsServer?: string
  nfsPath?: string
  iscsiTarget?: string
  iscsiPort?: number
  iscsiIqn?: string
  iscsiLun?: string
  chapUser?: string
  chapPassword?: string
}

export interface NfsTarget {
  server: string
  path: string
}

export interface IscsiTarget {
  iqn: string
  address: string
  port: number
  luns?: IscsiLun[]
}


const SR_TYPE_TO_BACKEND: Record<SrCreateParams['type'], string> = {
  ext: 'ext',
  nfs: 'nfs',
  iscsi: 'lvmoiscsi',
  hba: 'lvmohba',
  iso: 'iso',
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
// v4: Existing methods (preserved for backwards compatibility)
// ============================================================================

export async function getAllSrs(connectionId: string): Promise<ConnectedSrRecord[]> {
  const client = getClient(connectionId)
  const poolName = getPoolName(connectionId)
  // Use get_all_records to avoid N+1 pattern
  const allRecords: Record<string, any> = await client.callWithSession('SR.get_all_records', [])
  const records = Object.entries(allRecords).map(([ref, record]) => ({
    ref,
    ...record,
    physical_size: Number(record.physical_size),
    physical_utilisation: Number(record.physical_utilisation),
    virtual_allocation: Number(record.virtual_allocation),
    connectionId,
    poolName,
  })) as ConnectedSrRecord[]
  // ISO repositories are user-visible resources; only internal udev repositories are hidden.
  return records.filter(sr => sr.type !== 'udev')
}

export async function getAllVdis(connectionId: string, srRef: string): Promise<ConnectedVdiRecord[]> {
  const client = getClient(connectionId)
  const poolName = getPoolName(connectionId)
  const refs: string[] = await client.callWithSession('SR.get_VDIs', [srRef])
  const records = await Promise.all(
    refs.map(async (ref) => {
      const record = await client.callWithSession('VDI.get_record', [ref])
      return {
        ref,
        ...record,
        virtual_size: Number(record.virtual_size),
        physical_utilisation: Number(record.physical_utilisation),
        connectionId,
        poolName,
      } as ConnectedVdiRecord
    })
  )
  return records
}

export async function createVdi(
  connectionId: string,
  srRef: string,
  name: string,
  sizeBytes: number
): Promise<string> {
  const client = getClient(connectionId)
  return await client.callWithSession('VDI.create', [{
    name_label: name,
    name_description: '',
    SR: srRef,
    virtual_size: String(sizeBytes),
    type: 'user',
    sharable: false,
    read_only: false,
    other_config: {},
    xenstore_data: {},
    sm_config: {},
    tags: []
  }])
}

export async function destroyVdi(connectionId: string, vdiRef: string): Promise<VdiDeleteResult> {
  const client = getClient(connectionId)
  const vdi = await client.callWithSession('VDI.get_record', [vdiRef])
  if (!Array.isArray(vdi.VBDs)) throw new Error('无法确认磁盘连接关系，已停止删除')
  if (vdi.VBDs.length > 1 || vdi.sharable === true || vdi.is_a_snapshot === true
    || !['user', 'system'].includes(vdi.type) || Object.keys(vdi.current_operations ?? {}).length > 0) {
    throw new Error('该磁盘正被共享、快照或其他操作使用，不能直接删除')
  }

  let detachedVbdRef: string | undefined
  if (vdi.VBDs.length === 1) {
    const vbdRef: string = vdi.VBDs[0]
    const vbd = await client.callWithSession('VBD.get_record', [vbdRef])
    if (vbd.type !== 'Disk' || vbd.VDI !== vdiRef || vbd.mode !== 'RW'
      || vbd.other_config?.owner !== 'true'
      || vbd.currently_attached === true) {
      throw new Error('磁盘连接不属于可删除的独占停机磁盘')
    }
    const vm = await client.callWithSession('VM.get_record', [vbd.VM])
    if (vm.power_state !== 'Halted' || vm.is_a_template === true || vm.is_a_snapshot === true) {
      throw new Error('只有已停止 VM 的独占磁盘可以删除')
    }
    try { await client.callWithSession('VBD.destroy', [vbdRef]) }
    catch (error) {
      if (!isLostMutationResponse(error)) throw error
      await confirmRecordDeleted('磁盘连接删除', () => client.callWithSession('VBD.get_record', [vbdRef]),
        () => connectionManager.getClient(connectionId) === client)
    }
    detachedVbdRef = vbdRef
  }

  try {
    const freshVdi = detachedVbdRef
      ? await client.callWithSession('VDI.get_record', [vdiRef]) : vdi
    if (!Array.isArray(freshVdi.allowed_operations)
      || !freshVdi.allowed_operations.includes('destroy')) {
      throw new Error('XAPI 当前不允许删除该磁盘')
    }
    await client.callWithSession('VDI.destroy', [vdiRef])
    return { vdiDeleted: true, ...(detachedVbdRef ? { detachedVbdRef } : {}) }
  } catch (err: any) {
    if (isLostMutationResponse(err)) {
      await confirmRecordDeleted('虚拟磁盘删除', () => client.callWithSession('VDI.get_record', [vdiRef]),
        () => connectionManager.getClient(connectionId) === client)
      return { vdiDeleted: true, ...(detachedVbdRef ? { detachedVbdRef } : {}) }
    }
    if (!detachedVbdRef) throw err
    return {
      vdiDeleted: false,
      detachedVbdRef,
      warning: err?.message || '磁盘连接已删除，但 VDI 仍保留在存储仓库',
    }
  }
}

// ============================================================================
// v5: New SR management methods
// ============================================================================

/**
 * Create a new SR with the specified type and parameters.
 * Supports EXT (local), NFS, iSCSI, and HBA types.
 */
export async function createSr(
  connectionId: string,
  hostRef: string,
  params: SrCreateParams
): Promise<string> {
  const client = getClient(connectionId)
  const scope = connectionManager.getConnectionInfo(connectionId)
  const current = () => connectionManager.getClient(connectionId) === client
    && connectionManager.getConnectionInfo(connectionId)?.poolUuid === scope?.poolUuid
    && connectionManager.getConnectionInfo(connectionId)?.epoch === scope?.epoch
  const backendType = SR_TYPE_TO_BACKEND[params.type]

  const deviceConfig: Record<string, string> = {}

  switch (params.type) {
    case 'iso':
      if (!params.nfsServer?.trim() || !params.nfsPath?.startsWith('/')) throw new Error('请填写 NFS 服务器及以 / 开头的 ISO 共享目录')
      deviceConfig.location = `${params.nfsServer}:${params.nfsPath}`
      deviceConfig.type = 'nfs_iso'
      break
    case 'nfs':
      if (!params.nfsServer || !params.nfsPath) {
        throw new Error('NFS server and path are required')
      }
      deviceConfig.server = params.nfsServer
      deviceConfig.serverpath = params.nfsPath
      break

    case 'iscsi':
      if (!params.iscsiTarget?.trim() || !params.iscsiIqn?.trim() || !params.iscsiLun?.trim()) {
        throw new Error('iSCSI 地址、目标 IQN 和 SCSI 标识均不能为空，请先完成发现或填写已核实的标识')
      }
      if (/^\d{1,5}$/.test(params.iscsiLun.trim())) throw new Error('SCSI 标识不能使用 LUN 序号，请选择发现结果中的 SCSI 标识')
      deviceConfig.target = params.iscsiTarget
      if (params.iscsiPort !== undefined) deviceConfig.port = String(params.iscsiPort)
      if (params.iscsiIqn) {
        deviceConfig.targetIQN = params.iscsiIqn
      }
      if (params.iscsiLun) {
        deviceConfig.SCSIid = params.iscsiLun
      }
      if (params.chapUser) {
        deviceConfig.chapuser = params.chapUser
      }
      if (params.chapPassword) {
        deviceConfig.chappassword = params.chapPassword
      }
      break

    case 'ext':
    case 'hba':
      // No additional device config needed
      break

    default:
      throw new Error(`Unsupported SR type: ${params.type}`)
  }

  const supportedTypes: string[] = await client.callWithSession('SR.get_supported_types', [])
  if (!supportedTypes.includes(backendType)) {
    throw new Error(`SR type '${backendType}' is not supported on this host`)
  }

  const host = await client.callWithSession('host.get_record', [hostRef])
  if (!host || typeof host !== 'object') throw new Error('无法确认创建存储仓库的目标主机')
  if (params.type === 'iscsi') {
    const probe = await client.callWithSession('SR.probe', [hostRef, deviceConfig, backendType, {}])
    const existingSrs = probeNodes(parseProbeDocument(probe)).map((node) => field(node, 'uuid')).filter(Boolean)
    if (params.existingSrUuid) {
      if (!existingSrs.includes(params.existingSrUuid)) throw new Error('所选设备的存储仓库 UUID 已变化，请重新发现并核对')
      if (!current()) throw new ReadScopeChangedError()
      return reattachIscsiSr(client, current, hostRef, params, deviceConfig)
    }
    if (existingSrs.length) {
      const existing = new Error(`所选 LUN 已包含存储仓库 ${existingSrs.join('、')}。请使用重新接入已有存储的流程，不能覆盖创建。`) as Error & { code: string; details: unknown }
      existing.code = 'SR_ALREADY_EXISTS_ON_DEVICE'
      existing.details = { srUuids: existingSrs, hostRef }
      throw existing
    }
  }
  const shared = params.type === 'nfs' || params.type === 'iscsi' || params.type === 'hba' || params.type === 'iso'
  if (!current()) throw new ReadScopeChangedError()

  let srRef: string
  try { srRef = await client.callWithSession('SR.create', [
    hostRef,
    deviceConfig,
    '0', // physical_size (will be auto-detected)
    params.nameLabel,
    params.nameDescription,
    backendType,
    params.type === 'iso' ? 'iso' : '',
    shared,
    {}
  ]) } catch (error: any) {
    if (['transport', 'client'].includes(error?.details?.kind)
      || /^(E(CONN|PIPE|TIMEDOUT|HOST|NET)|XAPI_CONTRACT_MISMATCH)/.test(error?.code ?? '')) {
      const unknown = new Error('创建请求已发送，但未确认资源池结果。请重新连接并核对存储仓库和 PBD，勿重复创建。') as Error & { code: string; details: unknown }
      unknown.code = 'SR_CREATE_OUTCOME_UNKNOWN'
      unknown.details = { hostRef, nameLabel: params.nameLabel, outcome: 'unknown' }
      throw unknown
    }
    throw error
  }

  try {
    await readOperationResult(async () => {
      const sr = await client.callWithSession('SR.get_record', [srRef])
      const pbds = await Promise.all((sr?.PBDs ?? []).map((ref: string) => client.callWithSession('PBD.get_record', [ref])))
      if (!pbds.some((pbd) => pbd.SR === srRef && pbd.host === hostRef && pbd.currently_attached === true)) {
        throw new Error('目标主机的存储连接尚未接通')
      }
    }, { isCurrent: () => connectionManager.getClient(connectionId) === client })
    await client.callWithSession('SR.scan', [srRef])
    return srRef
  } catch (error) {
    const partial = new Error(`存储仓库已创建，但连接或扫描未完成：${error instanceof Error ? error.message : String(error)}。已保留 ${srRef}，请核对后继续，勿重复创建。`) as Error & { code: string; details: unknown }
    partial.code = 'SR_CREATED_INCOMPLETE'
    partial.details = { srRef, hostRef }
    throw partial
  }
}

/** Reintroduce only the UUID freshly discovered on the selected LUN; never format it. */
async function reattachIscsiSr(client: ReturnType<typeof getClient>, current: () => boolean, hostRef: string, params: SrCreateParams, deviceConfig: Record<string, string>): Promise<string> {
  const assertCurrent = () => { if (!current()) throw new ReadScopeChangedError() }
  assertCurrent()
  let srRef: string
  try { srRef = await client.callWithSession('SR.get_by_uuid', [params.existingSrUuid!]) }
  catch (error) {
    if (!/UUID_INVALID|HANDLE_INVALID/.test((error as any)?.code ?? (error as Error)?.message ?? '')) throw error
    try {
      assertCurrent()
      srRef = await client.callWithSession('SR.introduce', [params.existingSrUuid!, params.nameLabel, params.nameDescription, 'lvmoiscsi', 'user', true, {}])
    } catch (writeError) {
      if (!isLostMutationResponse(writeError)) throw writeError
      srRef = await readMutationResult('已有存储接入', () => client.callWithSession('SR.get_by_uuid', [params.existingSrUuid!]), current)
    }
  }
  assertCurrent()
  const original = await client.callWithSession('SR.get_record', [srRef])
  if (original.uuid !== params.existingSrUuid || original.type !== 'lvmoiscsi') throw new Error('已有存储仓库的身份或类型不一致')
  if (Object.keys(original.current_operations ?? {}).length) throw new Error('已有存储仓库正在执行其他操作，请完成后重新读取')
  const all: Record<string, any> = await client.callWithSession('PBD.get_all_records', [])
  const existingPbd = Object.entries(all).find(([, pbd]) => pbd.host === hostRef && pbd.SR === srRef)
  if (existingPbd && existingPbd[1].device_config?.SCSIid !== deviceConfig.SCSIid) throw new Error('已有主机存储连接的 SCSI 标识与所选 LUN 不一致，请先核对原连接')
  let pbdRef = existingPbd?.[0]
  if (!pbdRef) {
    try { assertCurrent(); pbdRef = await client.callWithSession('PBD.create', [{ host: hostRef, SR: srRef, device_config: deviceConfig, other_config: {} }]) }
    catch (error) {
      if (!isLostMutationResponse(error)) throw error
      pbdRef = await readMutationResult('已有存储连接', async () => {
        const pbds: Record<string, any> = await client.callWithSession('PBD.get_all_records', [])
        const matches = Object.entries(pbds).filter(([, pbd]) => pbd.host === hostRef && pbd.SR === srRef)
        if (matches.length !== 1) throw new Error('未读到目标主机的唯一存储连接')
        return matches[0][0]
      }, current)
    }
  }
  try { assertCurrent(); if (existingPbd?.[1].currently_attached !== true) await client.callWithSession('PBD.plug', [pbdRef]) }
  catch (error) { if (!isLostMutationResponse(error)) throw error }
  await readMutationResult('已有存储接入', async () => {
    const sr = await client.callWithSession('SR.get_record', [srRef])
    const pbd = await client.callWithSession('PBD.get_record', [pbdRef])
    if (sr.uuid !== params.existingSrUuid || sr.type !== 'lvmoiscsi' || pbd.SR !== srRef || pbd.host !== hostRef || pbd.currently_attached !== true) throw new Error('存储身份或目标主机接入状态不一致')
  }, current)
  assertCurrent()
  await client.callWithSession('SR.scan', [srRef])
  return srRef
}

/**
 * Permanently destroy an SR and all its VDIs.
 */
export async function destroySr(connectionId: string, srRef: string): Promise<void> {
  const client = getClient(connectionId)
  await client.callWithSession('SR.destroy', [srRef])
}

/**
 * Scan an SR to refresh its VDI list.
 */
export async function scanSr(connectionId: string, srRef: string): Promise<void> {
  const client = getClient(connectionId)
  await client.callWithSession('SR.scan', [srRef])
}

/**
 * Detach an SR by unplugging all PBDs and forgetting the SR.
 * This preserves the SR metadata but removes it from the host.
 */
export async function detachSr(connectionId: string, srRef: string): Promise<void> {
  const client = getClient(connectionId)

  // Get all PBDs for this SR
  const srRecord = await client.callWithSession('SR.get_record', [srRef])
  const pbdRefs: string[] = srRecord.PBDs || []

  // Unplug each PBD
  for (const pbdRef of pbdRefs) {
    try {
      await client.callWithSession('PBD.unplug', [pbdRef])
    } catch (err: any) {
      // Ignore if already unplugged
      if (!err?.faultString?.includes('DEVICE_ALREADY_DETACHED')) {
        throw err
      }
    }
  }

  // Forget the SR (keeps metadata but removes from host)
  await client.callWithSession('SR.forget', [srRef])
}

/**
 * Set the default SR for a pool.
 */
export async function setDefaultSr(
  connectionId: string,
  poolRef: string,
  srRef: string
): Promise<void> {
  const client = getClient(connectionId)
  const sr = await client.callWithSession('SR.get_record', [srRef])
  if (sr.type === 'iso' || sr.type === 'udev' || sr.content_type === 'iso') {
    throw new Error('ISO 库和设备存储不能作为默认虚拟磁盘存储仓库')
  }
  await client.callWithSession('pool.set_default_SR', [poolRef, srRef])
  try {
    await readOperationResult(async () => {
      const actual = await client.callWithSession('pool.get_default_SR', [poolRef])
      if (actual !== srRef) throw new Error('资源池返回的默认存储仓库与所选目标不同')
    }, { isCurrent: () => connectionManager.getClient(connectionId) === client })
  } catch (cause) {
    const error = new Error(`无法获取默认存储仓库设置结果：${cause instanceof Error ? cause.message : String(cause)}`) as Error & { code: string }
    error.code = 'SR_DEFAULT_UNCONFIRMED'
    throw error
  }
}

/**
 * Probe NFS server for available exports.
 * Timeout: 30 seconds
 */
export async function probeNfs(
  connectionId: string,
  hostRef: string,
  server: string
): Promise<NfsTarget[]> {
  const client = getClient(connectionId)

  const deviceConfig = { server }

  const result: string = await client.callWithSession('SR.probe', [
    hostRef,
    deviceConfig,
    'nfs',
    {}
  ])

  // Parse XML response
  return parseNfsProbeResult(result, server)
}

/**
 * Probe iSCSI target for available IQNs.
 * Timeout: 30 seconds
 */
export async function probeIscsi(
  connectionId: string,
  hostRef: string,
  target: string,
  options: IscsiProbeOptions = {},
): Promise<IscsiTarget[]> {
  const client = getClient(connectionId)
  const deviceConfig: Record<string, string> = { target: target.trim() }
  if (options.port !== undefined) deviceConfig.port = String(options.port)
  if (options.iqn) deviceConfig.targetIQN = options.iqn.trim()
  if (options.chapUser) deviceConfig.chapuser = options.chapUser
  if (options.chapPassword) deviceConfig.chappassword = options.chapPassword
  let result: string
  try {
    result = await client.callWithSession('SR.probe', [hostRef, deviceConfig, 'lvmoiscsi', {}])
  } catch (error: any) {
    // These two backend errors are the documented discovery responses, not failed mutations.
    const code = error?.code ?? error?.ErrorDescription?.[0]
    const parameters = error?.params ?? error?.details?.params ?? error?.ErrorDescription?.slice(1) ?? []
    const xml = Array.isArray(parameters) ? parameters.find((part: unknown) => typeof part === 'string' && part.includes('<')) : undefined
    if (!['SR_BACKEND_FAILURE_96', 'SR_BACKEND_FAILURE_107'].includes(code) || !xml) throw error
    result = xml
  }
  const document = parseProbeDocument(result)
  if (options.iqn) {
    const luns = probeNodes(document).flatMap((node) => {
      const id = field(node, 'scsiid')
      if (!id) return []
      return [{ id, lunId: field(node, 'lunid'), size: Math.max(0, Number(field(node, 'size')) || 0), vendor: field(node, 'vendor') }]
    })
    return [{ iqn: options.iqn, address: target, port: options.port ?? 3260, luns: [...new Map(luns.map((lun) => [lun.id, lun])).values()] }]
  }
  const targets = probeNodes(document).flatMap((node) => {
    const iqn = field(node, 'targetiqn') || field(node, 'iqn')
    if (!iqn || iqn === '*') return []
    return [{ iqn, address: field(node, 'address') || field(node, 'ipaddress') || target,
      port: Number(field(node, 'port')) || options.port || 3260 }]
  })
  return [...new Map(targets.map((item) => [`${item.iqn}:${item.address}:${item.port}`, item])).values()]
}

function parseProbeDocument(xml: string): Record<string, unknown> {
  if (typeof xml !== 'string' || XMLValidator.validate(xml) !== true || /<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw new Error('存储探测返回了无效的 XML，未更改存储配置')
  }
  return new XMLParser({ ignoreAttributes: true, removeNSPrefix: true, parseTagValue: false, trimValues: true }).parse(xml)
}

function probeNodes(value: unknown): Record<string, unknown>[] {
  if (!value || typeof value !== 'object') return []
  if (Array.isArray(value)) return value.flatMap(probeNodes)
  const node = value as Record<string, unknown>
  return [node, ...Object.values(node).flatMap(probeNodes)]
}

function field(node: Record<string, unknown>, key: string): string {
  const value = Object.entries(node).find(([name]) => name.toLowerCase() === key)?.[1]
  return typeof value === 'string' ? value.trim() : ''
}

function parseNfsProbeResult(xml: string, server: string): NfsTarget[] {
  const targets = probeNodes(parseProbeDocument(xml)).flatMap((node) => {
    const path = field(node, 'serverpath') || field(node, 'path')
    return path ? [{ server: field(node, 'server') || server, path }] : []
  })
  return [...new Map(targets.map((item) => [`${item.server}:${item.path}`, item])).values()]
}

/** Edit only SR display identity; storage placement, access, and contents are unchanged. */
export async function updateSrIdentity(connectionId: string, srRef: string, update: SrIdentityUpdate): Promise<SrIdentity> {
  const client = getClient(connectionId)
  const nameLabel = update.nameLabel.trim()
  if (!nameLabel) throw new Error('SR_NAME_REQUIRED: 存储仓库名称不能为空')
  const current = await client.callWithSession('SR.get_record', [srRef])
  const readSaved = () => readOperationResult(async () => {
    const actual = await client.callWithSession('SR.get_record', [srRef])
    if (actual?.uuid !== current.uuid) throw new ReadScopeChangedError()
    if (typeof actual?.name_label !== 'string' || typeof actual?.name_description !== 'string'
      || (nameChanged && actual.name_label !== nameLabel)
      || (descriptionChanged && actual.name_description !== update.nameDescription)) throw new Error('服务器返回的名称或描述与请求不一致')
    return { nameLabel: actual.name_label, nameDescription: actual.name_description }
  }, { isCurrent: () => connectionManager.getClient(connectionId) === client })
  const nameChanged = nameLabel !== update.expectedNameLabel
  const descriptionChanged = update.nameDescription !== update.expectedNameDescription
  if ((nameChanged && current.name_label !== update.expectedNameLabel && current.name_label !== nameLabel)
    || (descriptionChanged && current.name_description !== update.expectedNameDescription && current.name_description !== update.nameDescription)) {
    throw new Error('SR_IDENTITY_CONFLICT: 名称或描述已被其他操作修改，请重新读取后编辑。')
  }
  let mutationError: unknown
  try {
    if (nameChanged && current.name_label !== nameLabel) await client.callWithSession('SR.set_name_label', [srRef, nameLabel])
    if (descriptionChanged && current.name_description !== update.nameDescription) await client.callWithSession('SR.set_name_description', [srRef, update.nameDescription])
  } catch (error) { mutationError = error }
  try {
    return await readSaved()
  } catch (error) {
    throw Object.assign(new Error(`无法完成存储仓库信息保存：${mutationError instanceof Error ? mutationError.message : error instanceof Error ? error.message : String(error)}`), {
      code: 'SR_IDENTITY_UNCONFIRMED', details: { connectionId, srRef },
    })
  }
}
