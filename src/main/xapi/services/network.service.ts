/**
 * Network service — wraps XAPI network.*, PIF.*, VIF.* methods.
 * All functions accept connectionId as the first parameter for multi-connection support.
 * v5: Extended with network write operations and VIF management.
 */
import { connectionManager } from '../connection-manager'
import { readOperationResult } from '../../../shared/read-operation-result'
import { randomUUID } from 'node:crypto'
import { isJsonStoreConfigured } from '../../persistence/json-store'
import { isLostMutationResponse, isMissingRecord, recordExists, readMutationResult, confirmRecordDeleted, resultReadFailed } from './mutation-result'
import { findVifCreation, saveVifCreation, forgetVifCreation, markVifCreationsDeleted, removedVifCreationError, type VifCreationRecord } from './vif-creation-journal'
import type {
  ConnectedPifRecord,
  ConnectedTunnelRecord,
  PifIpConfig,
  VifQosParams,
  VifCreateResult,
} from '../../../shared/types/xapi'
import {
  bondDeviceSignature,
  findDuplicateVlan,
  getBondDevicesFromRefs,
  groupPifsByHostForDevices,
  normalizeBonds,
  normalizeNetworks,
  normalizePifs,
  normalizeVlans,
  type NetworkTopology,
  type NormalizedBondRecord,
  type NormalizedNetworkRecord,
  type NormalizedPifRecord,
  type NormalizedVlanRecord,
} from './network-domain'

export type {
  ConnectedPifRecord,
  ConnectedTunnelRecord,
  PifIpConfig,
  VifQosParams,
} from '../../../shared/types/xapi'

export type NetworkRecord = NormalizedNetworkRecord
export type PifRecord = NormalizedPifRecord
export type ConnectedNetworkRecord = NormalizedNetworkRecord & { connectionId: string; poolName: string }

// v5: New interfaces
export interface NetworkCreateParams {
  nameLabel: string
  nameDescription: string
  mtu?: number
  vlan?: number
}

export interface VifCreateParams {
  vmRef: string
  networkRef: string
  mac?: string
  mtu?: number
  requestId?: string
}

export interface VifRecord {
  ref: string
  uuid: string
  device: string
  MAC: string
  network: string
  VM: string
  currently_attached: boolean
  MTU: number
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

async function getAllRecords(client: ReturnType<typeof getClient>, method: string): Promise<Record<string, any>> {
  return await client.callWithSession(method, [])
}

async function getOptionalAllRecords(client: ReturnType<typeof getClient>, method: string): Promise<{
  records: Record<string, any>
  available: boolean
}> {
  try {
    return { records: await getAllRecords(client, method), available: true }
  } catch (error: any) {
    if (error?.code === 'MESSAGE_METHOD_UNKNOWN' || error?.message?.includes('MESSAGE_METHOD_UNKNOWN')) return { records: {}, available: false }
    throw error
  }
}

function addConnectionMetadata<T extends { ref: string }>(records: T[], connectionId: string, poolName: string): (T & {
  connectionId: string
  poolName: string
})[] {
  return records.map((record) => ({ ...record, connectionId, poolName }))
}

function clusterPifRefsFromRecords(clusterHostRecords: Record<string, any>): Set<string> {
  const refs = new Set<string>()
  for (const record of Object.values(clusterHostRecords)) {
    const pif = record?.PIF || record?.pif
    if (typeof pif === 'string' && pif && pif !== 'OpaqueRef:NULL') refs.add(pif)
  }
  return refs
}

async function loadNetworkTopology(connectionId: string, options: {
  includeHiddenNetworks?: boolean
  requireClusterStatus?: boolean
} = {}): Promise<NetworkTopology & {
  rawNetworks: Record<string, any>
  rawPifs: Record<string, any>
  rawPools: Record<string, any>
  rawBonds: Record<string, any>
  rawVlans: Record<string, any>
}> {
  const client = getClient(connectionId)
  const [
    rawNetworks,
    rawPifs,
    metricsResult,
    rawBonds,
    rawVlans,
    tunnelResult,
    poolResult,
    clusterResult,
  ] = await Promise.all([
    getAllRecords(client, 'network.get_all_records'),
    getAllRecords(client, 'PIF.get_all_records'),
    getOptionalAllRecords(client, 'PIF_metrics.get_all_records'),
    getAllRecords(client, 'Bond.get_all_records'),
    getAllRecords(client, 'VLAN.get_all_records'),
    getOptionalAllRecords(client, 'tunnel.get_all_records'),
    getAllRecords(client, 'pool.get_all_records').then((records) => ({ records, available: true })),
    getOptionalAllRecords(client, 'Cluster_host.get_all_records'),
  ])

  if (options.requireClusterStatus && !clusterResult.available) {
    throw new Error('NETWORK_CLUSTER_STATUS_UNKNOWN: Unable to confirm cluster networking status')
  }

  const pifs = normalizePifs({
    pifRecords: rawPifs,
    networkRecords: rawNetworks,
    metricsRecords: metricsResult.records,
    tunnelRecords: tunnelResult.records,
    clusterPifRefs: clusterPifRefsFromRecords(clusterResult.records),
  })
  const networks = normalizeNetworks({ networkRecords: rawNetworks, pifs })
  const bonds = normalizeBonds({ bondRecords: rawBonds, pifs })
  const vlans = normalizeVlans({ vlanRecords: rawVlans, pifs })

  return {
    pifs,
    networks: options.includeHiddenNetworks ? networks : networks.filter((network) => network.visible),
    bonds,
    vlans,
    clusterStatusKnown: clusterResult.available,
    rawNetworks,
    rawPifs,
    rawPools: poolResult.records,
    rawBonds,
    rawVlans,
  }
}

function getPoolMaster(rawPools: Record<string, any>): string | null {
  const firstPool = Object.values(rawPools)[0]
  return typeof firstPool?.master === 'string' ? firstPool.master : null
}

function isHaEnabled(rawPools: Record<string, any>): boolean {
  return Object.values(rawPools).some((pool: any) => pool?.ha_enabled === true)
}

function sortHostsCoordinatorLast(hosts: string[], masterRef: string | null): string[] {
  if (!masterRef || !hosts.includes(masterRef)) return hosts
  return [...hosts.filter((host) => host !== masterRef), masterRef]
}

function hasRiskyPif(pifs: NormalizedPifRecord[]): {
  primaryManagement: boolean
  secondaryManagement: boolean
  cluster: boolean
} {
  return {
    primaryManagement: pifs.some((pif) => pif.isPrimaryManagement),
    secondaryManagement: pifs.some((pif) => pif.isSecondaryManagement),
    cluster: pifs.some((pif) => pif.isClusterPif),
  }
}

function assertSafeNetworkOperation(risk: ReturnType<typeof hasRiskyPif>, rawPools: Record<string, any>, confirmed?: boolean): void {
  if (risk.cluster) {
    throw new Error('NETWORK_CLUSTER_PIF_BLOCKED: Operation involves a clustering PIF')
  }
  if ((risk.primaryManagement || risk.secondaryManagement) && (Object.keys(rawPools).length === 0 || Object.values(rawPools).some((pool) => typeof pool.ha_enabled !== 'boolean'))) {
    throw new Error('NETWORK_HA_STATUS_UNKNOWN: Unable to confirm resource pool HA status')
  }
  if ((risk.primaryManagement || risk.secondaryManagement) && isHaEnabled(rawPools)) {
    throw new Error('NETWORK_MANAGEMENT_HA_BLOCKED: HA must be disabled before changing management networking')
  }
  if ((risk.primaryManagement || risk.secondaryManagement) && !confirmed) {
    throw new Error('NETWORK_MANAGEMENT_CONFIRMATION_REQUIRED: Operation involves a management interface')
  }
}

function makeNetworkCreateRecord(name: string, description: string, mtu = 1500, tags: string[] = []): Record<string, any> {
  return {
    name_label: name,
    name_description: description,
    MTU: mtu,
    other_config: {},
    bridge: '',
    managed: true,
    tags,
  }
}

// ============================================================================
// v4: Existing methods
// ============================================================================

export async function getAllNetworks(connectionId: string): Promise<ConnectedNetworkRecord[]> {
  const poolName = getPoolName(connectionId)
  const topology = await loadNetworkTopology(connectionId)
  return addConnectionMetadata(topology.networks, connectionId, poolName) as ConnectedNetworkRecord[]
}

export async function getAllPifs(connectionId: string): Promise<ConnectedPifRecord[]> {
  const poolName = getPoolName(connectionId)
  const topology = await loadNetworkTopology(connectionId, { includeHiddenNetworks: true })
  return addConnectionMetadata(topology.pifs, connectionId, poolName) as ConnectedPifRecord[]
}

export async function createNetwork(connectionId: string, name: string, description: string): Promise<string> {
  const client = getClient(connectionId)
  const nameLabel = name.trim()
  if (!nameLabel) throw new Error('NETWORK_NAME_REQUIRED: 网络名称不能为空')
  let networkRef: string
  try {
    networkRef = await client.callWithSession('network.create', [makeNetworkCreateRecord(nameLabel, description)])
  } catch (error: any) {
    if (['transport', 'client'].includes(error?.details?.kind)
      || /^(E(CONN|PIPE|TIMEDOUT|HOST|NET)|XAPI_CONTRACT_MISMATCH)/.test(error?.code ?? '')) {
      throw Object.assign(new Error(`无法取得网络创建响应：${error?.message || String(error)}。服务器未返回网络引用，无法确定创建结果。`), {
        code: 'NETWORK_CREATE_OUTCOME_UNKNOWN', details: { connectionId, nameLabel, outcome: 'unknown' },
      })
    }
    throw error
  }
  if (typeof networkRef !== 'string' || !networkRef || networkRef === 'OpaqueRef:NULL') {
    throw Object.assign(new Error('创建响应未包含有效网络引用，无法确定创建结果。'), {
      code: 'NETWORK_CREATE_OUTCOME_UNKNOWN', details: { connectionId, nameLabel, outcome: 'unknown' },
    })
  }
  try {
    await readOperationResult(async () => {
      const record = await client.callWithSession('network.get_record', [networkRef])
      if (record?.name_label !== nameLabel) throw new Error('网络名称与创建请求不一致')
    }, { isCurrent: () => connectionManager.getClient(connectionId) === client })
  } catch (error: any) {
    throw Object.assign(new Error(`网络已创建（${networkRef}），读取网络信息失败：${error?.message || String(error)}`), {
      code: 'NETWORK_CREATED_UNCONFIRMED', details: { networkRef, connectionId, nameLabel },
    })
  }
  return networkRef
}

// ============================================================================
// v5: New network management methods
// ============================================================================

/**
 * Destroy a network. Only allowed if no VIFs are connected.
 */
export async function destroyNetwork(connectionId: string, networkRef: string): Promise<void> {
  const client = getClient(connectionId)
  const topology = await loadNetworkTopology(connectionId, { includeHiddenNetworks: true })
  const network = topology.networks.find((record) => record.ref === networkRef)
  const record = topology.rawNetworks[networkRef]
  if (!network || !record) {
    throw new Error('NETWORK_NOT_FOUND: Network does not exist')
  }
  if ((record.VIFs || []).length > 0) {
    throw new Error('NETWORK_IN_USE: Network has VIFs connected')
  }
  if ((record.PIFs || []).length > 0 || network.pifRefs.length > 0) {
    throw new Error('NETWORK_IN_USE: Network has PIFs connected')
  }
  if (Object.keys(record.current_operations ?? {}).length > 0) {
    throw new Error('NETWORK_BUSY: Network has an operation in progress')
  }
  if (!network.allowedActions.destroy) {
    throw new Error('NETWORK_DESTROY_BLOCKED: Network is attached to physical host configuration')
  }

  await client.callWithSession('network.destroy', [networkRef])
}

/**
 * Rename a network.
 */
export async function renameNetwork(
  connectionId: string,
  networkRef: string,
  newName: string
): Promise<void> {
  const client = getClient(connectionId)
  const nameLabel = newName.trim()
  if (!nameLabel) throw new Error('NETWORK_NAME_REQUIRED: 网络名称不能为空')
  let writeError: unknown
  try { await client.callWithSession('network.set_name_label', [networkRef, nameLabel]) }
  catch (error) { writeError = error }
  try {
    await readOperationResult(async () => {
      const record = await client.callWithSession('network.get_record', [networkRef])
      if (record?.name_label !== nameLabel) throw new Error('读回的网络名称与请求不一致')
    }, { isCurrent: () => connectionManager.getClient(connectionId) === client })
  } catch (error: any) {
    throw Object.assign(new Error(`无法完成网络重命名：${writeError instanceof Error ? writeError.message : error?.message || String(error)}`), {
      code: 'NETWORK_RENAME_UNCONFIRMED', details: { networkRef, connectionId, nameLabel },
    })
  }
}

// ============================================================================
// v5: VIF management methods
// ============================================================================

/**
 * Create a VIF for a VM. If the VM is running, automatically plug the VIF.
 */
const vifCreationsInFlight = new Set<string>()

export async function createVif(
  connectionId: string,
  params: VifCreateParams
): Promise<VifCreateResult> {
  const client = getClient(connectionId)
  const info = connectionManager.getConnectionInfo(connectionId)
  const current = () => connectionManager.getClient(connectionId) === client
    && connectionManager.getConnectionInfo(connectionId)?.poolUuid === info?.poolUuid
    && connectionManager.getConnectionInfo(connectionId)?.epoch === info?.epoch
  const vmRecord = await client.callWithSession('VM.get_record', [params.vmRef])
  if (!current()) throw resultReadFailed('网卡创建', new Error('管理连接已变化'))
  if (vmRecord.is_a_template || vmRecord.is_a_snapshot || vmRecord.is_control_domain) throw new Error('只能为普通 VM 添加网卡')
  if (isJsonStoreConfigured() && (!info?.poolUuid || !vmRecord.uuid)) throw new Error('请先重新读取资源池和虚拟机身份')
  const poolUuid = info?.poolUuid || connectionId
  const vmUuid = vmRecord.uuid || params.vmRef
  const key = JSON.stringify([poolUuid, vmUuid])
  if (vifCreationsInFlight.has(key)) throw new Error('该虚拟机正在添加网卡，请等待原请求完成')
  vifCreationsInFlight.add(key)
  try {
    let prior = findVifCreation(poolUuid, vmUuid, params.requestId)
    if (prior?.deleted) throw removedVifCreationError()
    if (prior && prior.networkRef !== params.networkRef) {
      if (!prior.vifRef || await readMutationResult('原网卡读取', () => recordExists(() => client.callWithSession('VIF.get_record', [prior!.vifRef])), current)) {
        throw resultReadFailed('上次网卡创建', new Error('请先核对原目标网络的创建记录'))
      }
      saveVifCreation({ ...prior, deleted: true })
      if (params.requestId === prior.requestId) throw removedVifCreationError()
      prior = undefined
    }
    if (prior?.result) return prior.result
    if (prior) {
      try {
        const result = await recoverCreatedVif(prior, params.vmRef, client, current)
        saveVifCreation({ ...prior, vifRef: result.vifRef, result })
        return result
      } catch (error: any) {
        if (error?.code !== 'VIF_CREATION_REMOVED' || params.requestId === prior.requestId) throw error
      }
    }
    const allowedDevices: string[] = await client.callWithSession('VM.get_allowed_VIF_devices', [params.vmRef])
    const [deviceNumber] = [...allowedDevices].sort((a, b) => Number(a) - Number(b))
    if (!deviceNumber) {
      throw new Error('VIF_NO_AVAILABLE_DEVICE: No available VIF device number')
    }

    const pending: VifCreationRecord = { poolUuid, vmUuid, requestId: params.requestId || randomUUID(), networkRef: params.networkRef, device: deviceNumber }
    if (!current()) throw resultReadFailed('网卡创建', new Error('管理连接已变化'))
    saveVifCreation(pending)
    let vifRef: string
    try { vifRef = await client.callWithSession('VIF.create', [{
      VM: params.vmRef,
      network: params.networkRef,
      device: deviceNumber,
      MAC: params.mac || '',
      MTU: params.mtu ?? 1500,
      other_config: { 'xenadmin:create-request': pending.requestId },
      qos_algorithm_type: '',
      qos_algorithm_params: {},
      locking_mode: 'network_default',
      ipv4_allowed: [],
      ipv6_allowed: [],
    }]) } catch (error) {
      if (!isLostMutationResponse(error)) { forgetVifCreation(pending); throw error }
      const result = await recoverCreatedVif(pending, params.vmRef, client, current)
      saveVifCreation({ ...pending, vifRef: result.vifRef, result })
      return result
    }
    pending.vifRef = vifRef
    saveVifCreation(pending)
    if (!current()) throw resultReadFailed('网卡创建', new Error('管理连接已变化，已保存原网卡记录'))

    // If VM is running, plug the VIF
    if (vmRecord.power_state === 'Running') {
      try {
        await client.callWithSession('VIF.plug', [vifRef])
      } catch (err: any) {
        const actual = await readMutationResult('网卡连接', () => client.callWithSession('VIF.get_record', [vifRef]), current)
        if (typeof actual?.currently_attached !== 'boolean') throw resultReadFailed('网卡连接', new Error('服务器未返回连接状态'))
        const result = { vifRef, plugged: actual.currently_attached, ...(!actual.currently_attached ? { warning: err?.message || '虚拟网卡未激活' } : {}) }
        saveVifCreation({ ...pending, result })
        return result
      }
    }

    const result = { vifRef, plugged: vmRecord.power_state === 'Running' }
    saveVifCreation({ ...pending, result })
    return result
  } finally { vifCreationsInFlight.delete(key) }
}

async function recoverCreatedVif(pending: VifCreationRecord, vmRef: string, client: ReturnType<typeof getClient>, current: () => boolean): Promise<VifCreateResult> {
  let missing = false
  try {
    return await readMutationResult('网卡创建', async () => {
      missing = false
      let original: any
      if (pending.vifRef) {
        try { original = await client.callWithSession('VIF.get_record', [pending.vifRef]) }
        catch (error) { missing = isMissingRecord(error); throw error }
      }
      const all: Record<string, any> = pending.vifRef
        ? { [pending.vifRef]: original }
        : await client.callWithSession('VIF.get_all_records', [])
      const matches = Object.entries(all).filter(([, v]) => v.VM === vmRef && v.network === pending.networkRef
        && String(v.device) === pending.device && v.other_config?.['xenadmin:create-request'] === pending.requestId)
      if (matches.length !== 1 || typeof matches[0][1].currently_attached !== 'boolean') throw new Error('服务器未返回原请求对应的唯一网卡及连接状态')
      const [vifRef, vif] = matches[0]
      return { vifRef, plugged: vif.currently_attached, ...(!vif.currently_attached ? { warning: '网卡已创建，当前未激活，可在网卡列表连接' } : {}) }
    }, current)
  } catch (error) {
    if (missing && current()) {
      saveVifCreation({ ...pending, deleted: true })
      throw removedVifCreationError()
    }
    throw error
  }
}

/**
 * Destroy a VIF. If connected, first unplug it.
 */
export async function destroyVif(connectionId: string, vifRef: string): Promise<void> {
  const client = getClient(connectionId)
  const info = connectionManager.getConnectionInfo(connectionId)
  const current = () => connectionManager.getClient(connectionId) === client
    && connectionManager.getConnectionInfo(connectionId)?.poolUuid === info?.poolUuid
    && connectionManager.getConnectionInfo(connectionId)?.epoch === info?.epoch

  // Check if VIF is connected
  let record: any
  try { record = await client.callWithSession('VIF.get_record', [vifRef]) }
  catch (error) {
    if (!isMissingRecord(error) || !current()) throw error
    markVifCreationsDeleted(info?.poolUuid || connectionId, vifRef)
    return
  }
  if (!current()) throw resultReadFailed('网卡删除', new Error('管理连接已变化'))
  if (record.currently_attached) {
    await setVifAttachment(connectionId, vifRef, false)
  }

  if (!current()) throw resultReadFailed('网卡删除', new Error('管理连接已变化'))

  try { await client.callWithSession('VIF.destroy', [vifRef]) }
  catch (error) {
    if (!isLostMutationResponse(error)) throw error
    await confirmRecordDeleted('网卡删除', () => client.callWithSession('VIF.get_record', [vifRef]),
      current)
  }
  if (!current()) throw resultReadFailed('网卡删除', new Error('管理连接已变化'))
  markVifCreationsDeleted(info?.poolUuid || connectionId, vifRef)
}

/**
 * Plug (attach) a VIF to a running VM.
 */
export async function plugVif(connectionId: string, vifRef: string): Promise<void> {
  await setVifAttachment(connectionId, vifRef, true)
}

/**
 * Unplug (detach) a VIF from a running VM.
 */
export async function unplugVif(connectionId: string, vifRef: string): Promise<void> {
  await setVifAttachment(connectionId, vifRef, false)
}

async function setVifAttachment(connectionId: string, vifRef: string, attached: boolean): Promise<void> {
  const client = getClient(connectionId)
  try { await client.callWithSession(attached ? 'VIF.plug' : 'VIF.unplug', [vifRef]) }
  catch (error) {
    if (!isLostMutationResponse(error)) throw error
    const actual = await readMutationResult('网卡连接', () => client.callWithSession('VIF.get_record', [vifRef]),
      () => connectionManager.getClient(connectionId) === client)
    if (actual?.currently_attached !== attached) throw error
  }
}

/** VIF.move preserves the interface identity, MAC and guest device number. */
export async function moveVif(connectionId: string, vifRef: string, networkRef: string): Promise<void> {
  const client = getClient(connectionId)
  const before = await client.callWithSession('VIF.get_record', [vifRef])
  if (before.network === networkRef) return
  const vm = await client.callWithSession('VM.get_record', [before.VM])
  if (vm.is_a_template || vm.is_a_snapshot || vm.is_control_domain || Object.keys(vm.current_operations ?? {}).length) throw new Error('当前虚拟机不能修改网卡网络')
  const network = await client.callWithSession('network.get_record', [networkRef])
  if (vm.power_state === 'Running' && network.PIFs?.length) {
    const pifs = await Promise.all(network.PIFs.map((ref: string) => client.callWithSession('PIF.get_record', [ref])))
    if (!pifs.some((pif) => pif.host === vm.resident_on && pif.currently_attached === true)) throw new Error('目标网络未接入虚拟机当前运行主机')
  }
  try { await client.callWithSession('VIF.move', [vifRef, networkRef]) }
  catch (error) { if (!isLostMutationResponse(error)) throw error }
  await readMutationResult('网卡换网', async () => {
    const actual = await client.callWithSession('VIF.get_record', [vifRef])
    if (actual.uuid !== before.uuid || actual.VM !== before.VM || actual.MAC !== before.MAC || actual.network !== networkRef) throw new Error('网卡身份或目标网络不一致')
  }, () => connectionManager.getClient(connectionId) === client)
}

// ============================================================================
// v9: Bond management methods
// ============================================================================

export interface BondRecord {
  ref: string
  uuid: string
  master: string
  slaves: string[]
  mode: string // balance-slb, active-backup, lacp
  properties: Record<string, string>
  links_up: number
}

export type ConnectedBondRecord = NormalizedBondRecord & {
  connectionId: string
  poolName: string
}

export interface BondCreateParams {
  pifRefs: string[] // [master, slave1, slave2, ...]
  mode?: 'balance-slb' | 'active-backup' | 'lacp'
  networkRef?: string
  nameLabel?: string
  nameDescription?: string
  mtu?: number
  confirmManagementDisruption?: boolean
}

/**
 * Get all bond interfaces for the pool.
 */
export async function getAllBonds(connectionId: string): Promise<ConnectedBondRecord[]> {
  const poolName = getPoolName(connectionId)
  const topology = await loadNetworkTopology(connectionId, { includeHiddenNetworks: true })
  return addConnectionMetadata(topology.bonds, connectionId, poolName) as ConnectedBondRecord[]
}

/**
 * Create a bond interface from multiple PIFs.
 * Returns the bond reference.
 */
export async function createBond(
  connectionId: string,
  params: BondCreateParams
): Promise<string[]> {
  const client = getClient(connectionId)

  if (params.pifRefs.length < 2) {
    throw new Error('BOND_REQUIRES_TWO_PIFS: Bond requires at least 2 PIFs')
  }

  const topology = await loadNetworkTopology(connectionId, {
    includeHiddenNetworks: true,
    requireClusterStatus: true,
  })
  const mode = params.mode || 'active-backup'
  let networkRef = params.networkRef
  let createdNetworkRef: string | null = null
  const devices = getBondDevicesFromRefs(topology.pifs, params.pifRefs)

  if (devices.length < 2) {
    throw new Error('BOND_REQUIRES_TWO_PIFS: Bond requires at least 2 distinct devices')
  }

  const selectedPifs = topology.pifs.filter((pif) => params.pifRefs.includes(pif.ref))
  if (selectedPifs.length !== params.pifRefs.length || selectedPifs.some((pif) => !pif.isBondCandidate)) {
    throw new Error('BOND_PIF_NOT_AVAILABLE: One or more selected PIFs cannot be bonded')
  }

  const poolHosts: string[] = await client.callWithSession('host.get_all', [])
  const hosts = sortHostsCoordinatorLast(poolHosts, getPoolMaster(topology.rawPools))
  const hostPifs = groupPifsByHostForDevices(topology.pifs, hosts, devices)
  const missingHosts = hosts.filter((hostRef) => (hostPifs.get(hostRef) || []).length !== devices.length)
  if (missingHosts.length > 0) {
    throw new Error('BOND_PIFS_NOT_PRESENT_ON_ALL_HOSTS: Selected devices are not available on every host')
  }

  const allMemberPifs = [...hostPifs.values()].flat()
  if (allMemberPifs.some((pif) => !pif.isBondCandidate)) throw new Error('BOND_PIF_NOT_AVAILABLE: A corresponding PIF on another host cannot be bonded')
  assertSafeNetworkOperation(hasRiskyPif(allMemberPifs), topology.rawPools, params.confirmManagementDisruption)

  if (!networkRef) {
    const newNetworkRef: string = await client.callWithSession('network.create', [
      makeNetworkCreateRecord(
        params.nameLabel || `Bond ${devices.join('+')}`,
        params.nameDescription || `Bond ${devices.join('+')}`,
        params.mtu ?? 1500,
        ['bond'],
      ),
    ])
    networkRef = newNetworkRef
    createdNetworkRef = newNetworkRef
  }

  const createdBondRefs: string[] = []
  try {
    for (const hostRef of hosts) {
      const members = hostPifs.get(hostRef) || []
      const bondRef: string = await client.callWithSession('Bond.create', [
        networkRef,
        members.map((pif) => pif.ref),
        '',
        mode,
        {},
      ])
      createdBondRefs.push(bondRef)
    }
  } catch (error: any) {
    // A missing response may hide a created bond. Preserve known resources for
    // reconciliation instead of tearing down live networking automatically.
    const failure = new Error(`BOND_CREATE_INCOMPLETE: ${error?.message || 'Unable to confirm creation'}; refresh topology before retrying`)
    Object.assign(failure, { code: 'BOND_CREATE_INCOMPLETE', details: { networkRef: createdNetworkRef || networkRef, createdBondRefs } })
    throw failure
  }

  return createdBondRefs
}

/**
 * Destroy a bond interface. This will unplug and destroy the master PIF.
 */
export async function destroyBond(
  connectionId: string,
  bondRef: string
): Promise<void> {
  await destroyBondGroup(connectionId, bondRef)
}

/**
 * Destroy a pool-wide bond group matching the selected bond's slave devices.
 */
export async function destroyBondGroup(
  connectionId: string,
  bondRef: string,
  options: { confirmManagementDisruption?: boolean } = {}
): Promise<string[]> {
  const client = getClient(connectionId)
  const topology = await loadNetworkTopology(connectionId, {
    includeHiddenNetworks: true,
    requireClusterStatus: true,
  })
  const target = topology.bonds.find((bond) => bond.ref === bondRef)
  if (!target) throw new Error('BOND_NOT_FOUND: Bond does not exist')

  const signature = bondDeviceSignature(target.devices)
  const matchingBonds = signature
    ? topology.bonds.filter((bond) => bond.network === target.network && bondDeviceSignature(bond.devices) === signature)
    : [target]
  const relatedPifs = topology.pifs.filter((pif) =>
    matchingBonds.some((bond) => bond.master === pif.ref || bond.slaves.includes(pif.ref))
  )

  assertSafeNetworkOperation(hasRiskyPif(relatedPifs), topology.rawPools, options.confirmManagementDisruption)

  const destroyedBondRefs: string[] = []
  for (const bond of matchingBonds) {
    await client.callWithSession('Bond.destroy', [bond.ref])
    destroyedBondRefs.push(bond.ref)
  }

  if (target.network) {
    const rawNetwork = topology.rawNetworks[target.network]
    if (rawNetwork && (rawNetwork.VIFs || []).length === 0) {
      try {
        await client.callWithSession('network.destroy', [target.network])
      } catch {
        // The bond destroy already succeeded; leave network cleanup to the next refresh/action.
      }
    }
  }

  return destroyedBondRefs
}

/**
 * Get a single bond record.
 */
export async function getBondRecord(
  connectionId: string,
  bondRef: string
): Promise<ConnectedBondRecord> {
  const poolName = getPoolName(connectionId)
  const topology = await loadNetworkTopology(connectionId, { includeHiddenNetworks: true })
  const record = topology.bonds.find((bond) => bond.ref === bondRef)
  if (!record) throw new Error('BOND_NOT_FOUND: Bond does not exist')
  return { ...record, connectionId, poolName } as ConnectedBondRecord
}

// ============================================================================
// v9: VLAN management methods
// ============================================================================

export interface VlanRecord {
  ref: string
  uuid: string
  tag: number // VLAN tag (1-4094)
  tagged_PIF: string // The physical PIF this VLAN is tagged on
  untagged_PIF: string // The untagged PIF representing this VLAN
  network: string // The network this VLAN belongs to
}

export type ConnectedVlanRecord = NormalizedVlanRecord & {
  connectionId: string
  poolName: string
}

export interface VlanCreateParams {
  taggedPifRef: string // The physical PIF to tag
  vlanTag: number // VLAN tag (0-4094)
  networkRef?: string // Optional: create new network if not provided
  nameLabel?: string // Network name label
  nameDescription?: string // Network name description
  confirmManagementDisruption?: boolean
}

/**
 * Get all VLAN interfaces for the pool.
 */
export async function getAllVlans(connectionId: string): Promise<ConnectedVlanRecord[]> {
  const poolName = getPoolName(connectionId)
  const topology = await loadNetworkTopology(connectionId, { includeHiddenNetworks: true })
  return addConnectionMetadata(topology.vlans, connectionId, poolName) as ConnectedVlanRecord[]
}

/**
 * Create a VLAN interface on a physical PIF.
 * Returns the VLAN reference.
 */
export async function createVlan(
  connectionId: string,
  params: VlanCreateParams
): Promise<string[]> {
  const client = getClient(connectionId)

  if (!Number.isInteger(params.vlanTag) || params.vlanTag < 0 || params.vlanTag > 4094) {
    throw new Error('VLAN_TAG_INVALID: VLAN tag must be between 0 and 4094')
  }

  const topology = await loadNetworkTopology(connectionId, {
    includeHiddenNetworks: true,
    requireClusterStatus: true,
  })
  const taggedPif = topology.pifs.find((pif) => pif.ref === params.taggedPifRef)
  if (!taggedPif || !taggedPif.isVlanCandidate) {
    throw new Error('VLAN_PIF_NOT_AVAILABLE: Selected PIF cannot be used for VLAN tagging')
  }
  const hosts: string[] = await client.callWithSession('host.get_all', [])
  const members = topology.pifs.filter((pif) => pif.device === taggedPif.device && pif.vlan === -1)
  if (hosts.some((hostRef) => members.filter((pif) => pif.host === hostRef).length !== 1)
      || members.some((pif) => !pif.isVlanCandidate)) {
    throw new Error('VLAN_PIFS_NOT_PRESENT_ON_ALL_HOSTS: Corresponding device is unavailable on a pool host')
  }
  assertSafeNetworkOperation(hasRiskyPif(members), topology.rawPools, params.confirmManagementDisruption)
  if (members.some((pif) => findDuplicateVlan(topology.pifs, pif.ref, params.vlanTag))) {
    throw new Error('VLAN_TAG_IN_USE: VLAN tag is already in use on a pool host')
  }

  // If no network provided, create one
  let networkRef = params.networkRef
  let createdNetworkRef: string | null = null
  if (!networkRef) {
    const newNetworkRef: string = await client.callWithSession('network.create', [
      makeNetworkCreateRecord(
        params.nameLabel || `VLAN ${params.vlanTag}`,
        params.nameDescription || `VLAN ${params.vlanTag}`,
        taggedPif.MTU || 1500,
        [`vlan:${params.vlanTag}`],
      ),
    ])
    networkRef = newNetworkRef
    createdNetworkRef = newNetworkRef
  }

  try {
    const vlanPifRefs: string[] = await client.callWithSession('pool.create_VLAN_from_PIF', [
      params.taggedPifRef,
      networkRef,
      params.vlanTag,
    ])

    return vlanPifRefs
  } catch (error: any) {
    const failure = new Error(`VLAN_CREATE_INCOMPLETE: ${error?.message || 'Unable to confirm creation'}; refresh topology before retrying`)
    Object.assign(failure, { code: 'VLAN_CREATE_INCOMPLETE', details: { networkRef: createdNetworkRef || networkRef } })
    throw failure
  }
}

/**
 * Destroy a VLAN interface.
 */
export async function destroyVlan(
  connectionId: string,
  vlanRef: string
): Promise<void> {
  const client = getClient(connectionId)
  await client.callWithSession('VLAN.destroy', [vlanRef])
}

/**
 * Destroy every VLAN mux/demuxer attached to a VLAN network, then clean up the network.
 */
export async function destroyVlanNetwork(
  connectionId: string,
  networkRef: string,
  options: { confirmManagementDisruption?: boolean } = {}
): Promise<string[]> {
  const client = getClient(connectionId)
  const topology = await loadNetworkTopology(connectionId, {
    includeHiddenNetworks: true,
    requireClusterStatus: true,
  })
  const rawNetwork = topology.rawNetworks[networkRef]
  if (!rawNetwork) throw new Error('NETWORK_NOT_FOUND: Network does not exist')
  if ((rawNetwork.VIFs || []).length > 0) {
    throw new Error('NETWORK_IN_USE: Network has VIFs connected')
  }

  const vlans = topology.vlans.filter((vlan) => vlan.network === networkRef)
  if (vlans.length === 0) {
    throw new Error('VLAN_NOT_FOUND: Network has no VLAN mux/demuxers')
  }

  const relatedPifRefs = new Set(vlans.flatMap((vlan) => [vlan.tagged_PIF, vlan.untagged_PIF]))
  const relatedPifs = topology.pifs.filter((pif) => relatedPifRefs.has(pif.ref) || pif.network === networkRef)
  assertSafeNetworkOperation(hasRiskyPif(relatedPifs), topology.rawPools, options.confirmManagementDisruption)

  const destroyedRefs: string[] = []
  for (const vlan of vlans) {
    await client.callWithSession('VLAN.destroy', [vlan.ref])
    destroyedRefs.push(vlan.ref)
  }

  try {
    await client.callWithSession('network.destroy', [networkRef])
  } catch {
    // VLANs are already gone; keep the orphan network visible for a later manual cleanup.
  }

  return destroyedRefs
}

/**
 * Get a single VLAN record.
 */
export async function getVlanRecord(
  connectionId: string,
  vlanRef: string
): Promise<ConnectedVlanRecord> {
  const poolName = getPoolName(connectionId)
  const topology = await loadNetworkTopology(connectionId, { includeHiddenNetworks: true })
  const record = topology.vlans.find((vlan) => vlan.ref === vlanRef)
  if (!record) throw new Error('VLAN_NOT_FOUND: VLAN does not exist')
  return { ...record, connectionId, poolName } as ConnectedVlanRecord
}

// ============================================================================
// v9: Tunnel management methods
// ============================================================================

/**
 * Get all tunnel interfaces for the pool.
 */
export async function getAllTunnels(connectionId: string): Promise<ConnectedTunnelRecord[]> {
  const client = getClient(connectionId)
  const poolName = getPoolName(connectionId)
  const allRecords: Record<string, any> = await client.callWithSession('tunnel.get_all_records', [])
  const records = Object.entries(allRecords).map(([ref, record]) => ({
    ref,
    ...record,
    connectionId,
    poolName,
  })) as ConnectedTunnelRecord[]
  return records
}

/**
 * Create a tunnel interface.
 * Returns the tunnel reference.
 */
export async function createTunnel(
  connectionId: string,
  accessPifRef: string,
  networkRef: string
): Promise<string> {
  const client = getClient(connectionId)
  const tunnelRef: string = await client.callWithSession('tunnel.create', [
    accessPifRef,
    networkRef,
  ])
  return tunnelRef
}

/**
 * Destroy a tunnel interface.
 */
export async function destroyTunnel(
  connectionId: string,
  tunnelRef: string
): Promise<void> {
  const client = getClient(connectionId)
  await client.callWithSession('tunnel.destroy', [tunnelRef])
}

// ============================================================================
// v9: PIF advanced methods
// ============================================================================

/**
 * Reconfigure IP settings of a PIF.
 */
export async function reconfigurePifIp(
  connectionId: string,
  pifRef: string,
  config: PifIpConfig
): Promise<void> {
  const client = getClient(connectionId)

  if (config.mode === 'Static') {
    if (!config.ip || !config.netmask) {
      throw new Error('PIF_IP_CONFIG_INVALID: Static IP requires ip and netmask')
    }
    await client.callWithSession('PIF.reconfigure_ip', [
      pifRef,
      config.mode,
      config.ip,
      config.netmask,
      config.gateway || '',
      config.dns || '',
    ])
  } else if (config.mode === 'DHCP') {
    await client.callWithSession('PIF.reconfigure_ip', [
      pifRef,
      'DHCP',
      '',
      '',
      '',
      '',
    ])
  } else {
    await client.callWithSession('PIF.reconfigure_ip', [
      pifRef,
      'None',
      '',
      '',
      '',
      '',
    ])
  }
}

/**
 * Scan for new PIFs on a host.
 */
export async function scanPifs(
  connectionId: string,
  hostRef: string
): Promise<void> {
  const client = getClient(connectionId)
  await client.callWithSession('PIF.scan', [hostRef])
}

/**
 * Get PIFs for a specific host.
 */
export async function getPifsForHost(
  connectionId: string,
  hostRef: string
): Promise<ConnectedPifRecord[]> {
  const poolName = getPoolName(connectionId)
  const topology = await loadNetworkTopology(connectionId, { includeHiddenNetworks: true })
  const records = topology.pifs.filter((pif) => pif.host === hostRef)
  return addConnectionMetadata(records, connectionId, poolName) as ConnectedPifRecord[]
}

// ============================================================================
// v9: VIF QoS methods
// ============================================================================

/**
 * Set QoS parameters for a VIF.
 */
export async function setVifQos(
  connectionId: string,
  vifRef: string,
  params: VifQosParams
): Promise<void> {
  const client = getClient(connectionId)

  await client.callWithSession('VIF.set_qos_algorithm_type', [
    vifRef,
    params.algorithmType,
  ])

  // Set each algorithm parameter
  for (const [key, value] of Object.entries(params.algorithmParams)) {
    await client.callWithSession('VIF.add_to_qos_algorithm_params', [
      vifRef,
      key,
      value,
    ])
  }
}

/**
 * Clear QoS parameters for a VIF.
 */
export async function clearVifQos(
  connectionId: string,
  vifRef: string
): Promise<void> {
  const client = getClient(connectionId)

  // Reset to no QoS
  await client.callWithSession('VIF.set_qos_algorithm_type', [
    vifRef,
    '',
  ])
}

/**
 * Get allowed operations for a network.
 */
export async function getNetworkAllowedOperations(
  connectionId: string,
  networkRef: string
): Promise<string[]> {
  const client = getClient(connectionId)
  const record = await client.callWithSession('network.get_record', [networkRef])
  return record.allowed_operations || []
}

/**
 * Add a tag to a network.
 */
export async function addNetworkTag(
  connectionId: string,
  networkRef: string,
  tag: string
): Promise<void> {
  const client = getClient(connectionId)
  await client.callWithSession('network.add_to_tags', [networkRef, tag])
}

/**
 * Remove a tag from a network.
 */
export async function removeNetworkTag(
  connectionId: string,
  networkRef: string,
  tag: string
): Promise<void> {
  const client = getClient(connectionId)
  await client.callWithSession('network.remove_from_tags', [networkRef, tag])
}

/**
 * Update network other_config.
 */
export async function updateNetworkOtherConfig(
  connectionId: string,
  networkRef: string,
  key: string,
  value: string
): Promise<void> {
  const client = getClient(connectionId)
  await client.callWithSession('network.add_to_other_config', [networkRef, key, value])
}
