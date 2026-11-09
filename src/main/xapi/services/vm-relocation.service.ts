import { startVmCopy } from './vm-copy.service'
/**
 * VM relocation workflows — host migration, halted storage moves, and cross-pool migrate/copy.
 */
import { connectionManager } from '../connection-manager'
import { taskOutcomeUnknown, waitForXapiTask } from './xapi-task'
import { readOperationResult } from '../../../shared/read-operation-result'
import { moveVdi } from './vdi.service'
import type {
  ConnectedHostRecord,
  ConnectedNetworkRecord,
  ConnectedSrRecord,
  VmRelocationBlocker,
  VmRelocationDisk,
  VmRelocationMode,
  VmRelocationPayload,
  VmRelocationPlan,
  VmRelocationResult,
  VmRelocationVif,
} from '../../../shared/types/xapi'

type XapiClientLike = {
  callWithSession: (method: string, params: unknown[]) => Promise<any>
}

export class RelocationError extends Error {
  code: string
  details?: unknown

  constructor(code: string, message: string, details?: unknown) {
    super(message)
    this.code = code
    this.details = details
  }
}

function getClient(connectionId: string): XapiClientLike {
  const client = connectionManager.getClient(connectionId)
  if (!client) {
    throw new RelocationError('CONNECTION_NOT_FOUND', `No connection found for connectionId: ${connectionId}`)
  }
  return client
}

function getPoolName(connectionId: string): string {
  return connectionManager.getConnectionInfo(connectionId)?.poolName ?? connectionId
}

function isNullRef(ref: unknown): boolean {
  return !ref || ref === 'OpaqueRef:NULL'
}

function hasCurrentOperation(record: any): boolean {
  return Object.keys(record?.current_operations ?? {}).length > 0
}

function isIsoSr(record: any): boolean {
  return record?.type === 'iso' || record?.type === 'udev' || record?.content_type === 'iso'
}

function isUsableSr(record: any): boolean {
  return !isIsoSr(record) && (record?.PBDs?.length ?? 1) > 0
}

function hasOwnerFlag(record: any): boolean {
  return record?.other_config?.owner === 'true'
}

function isOwnerDiskVbd(record: any): boolean {
  return record?.type === 'Disk' && hasOwnerFlag(record) && !isNullRef(record?.VDI)
}

function makeBlocker(code: string, message: string): VmRelocationBlocker {
  return { code, message }
}

async function getAllRecords(client: XapiClientLike, method: string): Promise<Record<string, any>> {
  return await client.callWithSession(method, [])
}

async function listHosts(connectionId: string): Promise<ConnectedHostRecord[]> {
  const client = getClient(connectionId)
  const records = await getAllRecords(client, 'host.get_all_records')
  const poolName = getPoolName(connectionId)
  return await Promise.all(Object.entries(records).map(async ([ref, record]) => {
    const metrics = !isNullRef(record.metrics)
      ? await client.callWithSession('host_metrics.get_record', [record.metrics])
      : null
    const memoryTotal = Number(metrics?.memory_total ?? record.memory_total)
    const memoryFree = Number(metrics?.memory_free ?? record.memory_free)
    if (!Number.isFinite(memoryTotal) || !Number.isFinite(memoryFree)) {
      throw new RelocationError('HOST_METRICS_UNAVAILABLE', `无法读取主机 ${record.name_label || ref} 的内存容量`)
    }
    return {
      ref,
      ...record,
      memory_total: memoryTotal,
      memory_free: memoryFree,
      connectionId,
      poolName,
    } as ConnectedHostRecord
  }))
}

async function listSrs(connectionId: string): Promise<ConnectedSrRecord[]> {
  const client = getClient(connectionId)
  const records = await getAllRecords(client, 'SR.get_all_records')
  const poolName = getPoolName(connectionId)
  return Object.entries(records)
    .filter(([, record]) => isUsableSr(record))
    .map(([ref, record]) => ({
      ref,
      ...record,
      physical_size: Number(record.physical_size),
      physical_utilisation: Number(record.physical_utilisation),
      virtual_allocation: Number(record.virtual_allocation),
      connectionId,
      poolName,
    })) as ConnectedSrRecord[]
}

async function listNetworks(connectionId: string): Promise<ConnectedNetworkRecord[]> {
  const client = getClient(connectionId)
  const records = await getAllRecords(client, 'network.get_all_records')
  const poolName = getPoolName(connectionId)
  return Object.entries(records)
    .filter(([, record]) => record?.managed !== false && record?.name_label !== 'Host internal management network')
    .map(([ref, record]) => ({
      ref,
      ...record,
      MTU: Number(record.MTU),
      connectionId,
      poolName,
    })) as ConnectedNetworkRecord[]
}

async function getVmDisks(client: XapiClientLike, vmRecord: any): Promise<VmRelocationDisk[]> {
  const disks: VmRelocationDisk[] = []

  for (const vbdRef of vmRecord.VBDs ?? []) {
    const vbd = await client.callWithSession('VBD.get_record', [vbdRef])
    if (vbd?.type !== 'Disk' || isNullRef(vbd?.VDI)) continue

    const vdi = await client.callWithSession('VDI.get_record', [vbd.VDI])
    disks.push({
      vbdRef,
      vdiRef: vbd.VDI,
      nameLabel: vdi?.name_label || vbd.VDI,
      size: Number(vdi?.virtual_size) || 0,
      sourceSrRef: vdi?.SR || 'OpaqueRef:NULL',
      userdevice: vbd?.userdevice ?? '',
      bootable: vbd?.bootable === true,
      mode: vbd?.mode || 'RW',
      type: vbd?.type || 'Disk',
      owner: hasOwnerFlag(vbd),
    })
  }

  return disks
}

async function getVmVifs(client: XapiClientLike, vmRecord: any): Promise<VmRelocationVif[]> {
  const vifs: VmRelocationVif[] = []

  for (const vifRef of vmRecord.VIFs ?? []) {
    const vif = await client.callWithSession('VIF.get_record', [vifRef])
    if (isNullRef(vif?.network)) continue

    let networkName = vif.network
    try {
      const network = await client.callWithSession('network.get_record', [vif.network])
      networkName = network?.name_label || vif.network
    } catch {
      // A missing network name should not hide the VIF mapping requirement.
    }

    vifs.push({
      vifRef,
      device: vif?.device ?? '',
      networkRef: vif.network,
      networkName,
    })
  }

  return vifs
}

function getVmBlockers(vmRecord: any): VmRelocationBlocker[] {
  const blockers: VmRelocationBlocker[] = []

  if (vmRecord?.is_a_template) {
    blockers.push(makeBlocker('VM_IS_TEMPLATE', '模板不能迁移或移动。'))
  }
  if (vmRecord?.is_a_snapshot) {
    blockers.push(makeBlocker('VM_IS_SNAPSHOT', '快照记录不能迁移或移动。'))
  }
  if (vmRecord?.is_control_domain) {
    blockers.push(makeBlocker('VM_IS_CONTROL_DOMAIN', '控制域不能迁移或移动。'))
  }
  if (vmRecord?.locked || vmRecord?.Locked) {
    blockers.push(makeBlocker('VM_LOCKED', 'VM 已锁定，当前不能迁移或移动。'))
  }
  if (hasCurrentOperation(vmRecord)) {
    blockers.push(makeBlocker('VM_HAS_CURRENT_OPERATIONS', 'VM 正在执行其他操作。'))
  }

  return blockers
}

function getAllowedModes(vmRecord: any, sameConnection: boolean, blockers: VmRelocationBlocker[]): VmRelocationMode[] {
  if (blockers.length > 0) return []

  const modes: VmRelocationMode[] = []
  if (sameConnection) {
    if (Array.isArray(vmRecord.allowed_operations) && vmRecord.allowed_operations.includes('pool_migrate')) {
      modes.push('pool-migrate')
    }
    if (vmRecord.power_state === 'Halted') {
      modes.push('storage-move')
    }
  } else {
    modes.push('cross-pool-migrate')
    if (vmRecord.power_state === 'Halted') modes.push('cross-pool-copy')
  }

  return modes
}

export async function getVmRelocationPlan(
  sourceConnectionId: string,
  vmRef: string,
  targetConnectionId = sourceConnectionId
): Promise<VmRelocationPlan> {
  const sourceClient = getClient(sourceConnectionId)
  getClient(targetConnectionId)

  const vmRecord = await sourceClient.callWithSession('VM.get_record', [vmRef])
  const sameConnection = sourceConnectionId === targetConnectionId
  const blockers = getVmBlockers(vmRecord)
  const disks = await getVmDisks(sourceClient, vmRecord)
  const vifs = await getVmVifs(sourceClient, vmRecord)

  const sourceInventory = Promise.all([listHosts(sourceConnectionId), listSrs(sourceConnectionId), listNetworks(sourceConnectionId)])
  const [sourceResources, targetResources] = await Promise.all([
    sourceInventory,
    sameConnection ? sourceInventory : Promise.all([listHosts(targetConnectionId), listSrs(targetConnectionId), listNetworks(targetConnectionId)]),
  ])
  const [sourceHosts, sourceSrs, sourceNetworks] = sourceResources
  const [targetHosts, targetSrs, targetNetworks] = targetResources

  const warnings: VmRelocationBlocker[] = []
  if (sameConnection && vmRecord.power_state !== 'Halted') {
    warnings.push(makeBlocker('STORAGE_MOVE_REQUIRES_HALTED_VM', '存储移动只支持已停止的 VM。'))
  }
  if (!sameConnection && disks.length === 0) {
    warnings.push(makeBlocker('VM_HAS_NO_DISKS', 'VM 没有需要映射的磁盘。'))
  }

  return {
    sourceConnectionId,
    targetConnectionId,
    vmRef,
    vmName: vmRecord?.name_label || vmRef,
    powerState: vmRecord?.power_state || 'Halted',
    allowedModes: getAllowedModes(vmRecord, sameConnection, blockers),
    blockers,
    warnings,
    disks,
    vifs,
    sourceHosts,
    targetHosts,
    sourceSrs,
    targetSrs,
    sourceNetworks,
    targetNetworks,
  }
}

function requireValue(value: unknown, code: string, message: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new RelocationError(code, message)
  }
}

function requireCompleteMap(
  refs: string[],
  map: Record<string, string> | undefined,
  code: string,
  message: string
): Record<string, string> {
  const result = map ?? {}
  const missing = refs.filter((ref) => !result[ref])
  if (missing.length > 0) {
    throw new RelocationError(code, message, { missing })
  }
  return result
}

async function moveHaltedVmStorage(
  connectionId: string,
  client: XapiClientLike,
  vmRecord: any,
  storageMap: Record<string, string>
): Promise<string[]> {
  const movedVdis: string[] = []
  for (const vbdRef of vmRecord.VBDs ?? []) {
    const vbd = await client.callWithSession('VBD.get_record', [vbdRef])
    if (!isOwnerDiskVbd(vbd)) continue
    const vdi = await client.callWithSession('VDI.get_record', [vbd.VDI])
    const targetSrRef = storageMap[vbd.VDI]
    if (!targetSrRef || targetSrRef === vdi.SR) continue
    try {
      if (!Array.isArray(vdi.VBDs) || vdi.VBDs.length !== 1 || vdi.VBDs[0] !== vbdRef || vdi.sharable === true) {
        throw new Error('只能移动该 VM 独占的磁盘')
      }
      const result = await moveVdi(connectionId, { vdiRef: vbd.VDI, targetSrRef })
      movedVdis.push(result.newVdiRef)
    } catch (error: any) {
      throw new RelocationError('STORAGE_MOVE_INCOMPLETE', `存储移动未全部完成：${error?.message || String(error)}。已完成的磁盘保留在目标存储，请核对后继续。`, {
        movedVdis, failedSourceVdiRef: vbd.VDI, targetSrRef, causeCode: error?.code, taskRef: error?.details?.taskRef,
      })
    }
  }
  return movedVdis
}

export async function relocateVm(payload: VmRelocationPayload): Promise<VmRelocationResult> {
  if (payload.mode === 'cross-pool-copy') {
    const vm = await getClient(payload.sourceConnectionId).callWithSession('VM.get_record', [payload.vmRef])
    return { copyOperation: await startVmCopy(payload.sourceConnectionId, { mode: 'cross-pool-copy', vmRef: payload.vmRef, targetConnectionId: payload.targetConnectionId, targetHostRef: payload.targetHostRef, transferNetworkRef: payload.transferNetworkRef, storageMap: payload.storageMap, networkMap: payload.networkMap, newName: `Copy of ${vm.name_label || payload.vmRef}` }) }
  }
  const sourceClient = getClient(payload.sourceConnectionId)
  const targetConnectionId = payload.targetConnectionId ?? payload.sourceConnectionId
  const targetClient = getClient(targetConnectionId)
  const vmRecord = await sourceClient.callWithSession('VM.get_record', [payload.vmRef])
  const blockers = getVmBlockers(vmRecord)

  if (blockers.length > 0) {
    throw new RelocationError('VM_RELOCATION_BLOCKED', blockers[0].message, { blockers })
  }

  switch (payload.mode) {
    case 'pool-migrate': {
      requireValue(payload.targetHostRef, 'TARGET_HOST_REQUIRED', '请选择目标主机。')
      if (targetConnectionId !== payload.sourceConnectionId) {
        throw new RelocationError('TARGET_POOL_MISMATCH', '同池迁移的目标主机必须位于源资源池。')
      }
      if (!Array.isArray(vmRecord.allowed_operations) || !vmRecord.allowed_operations.includes('pool_migrate')) {
        throw new RelocationError('POOL_MIGRATE_NOT_ALLOWED', 'XAPI 当前不允许迁移该 VM。')
      }
      if (vmRecord.resident_on === payload.targetHostRef) {
        throw new RelocationError('TARGET_IS_CURRENT_HOST', '目标主机与当前主机相同。')
      }
      const targetHost = await sourceClient.callWithSession('host.get_record', [payload.targetHostRef])
      if (targetHost.enabled !== true) {
        throw new RelocationError('TARGET_HOST_DISABLED', '目标主机当前不可用。')
      }
      await sourceClient.callWithSession('VM.assert_can_boot_here', [payload.vmRef, payload.targetHostRef])
      const taskRef: string = await sourceClient.callWithSession('Async.VM.pool_migrate', [
        payload.vmRef,
        payload.targetHostRef,
        {},
      ])
      await waitForXapiTask(sourceClient, taskRef)
      try {
        await readOperationResult(async () => {
          const movedVm = await sourceClient.callWithSession('VM.get_record', [payload.vmRef])
          if (movedVm?.resident_on !== payload.targetHostRef) throw new Error('VM 尚未归属目标主机')
        })
      } catch (error) {
        throw taskOutcomeUnknown(taskRef, error instanceof Error ? error.message : String(error))
      }
      return { taskRef }
    }

    case 'storage-move': {
      if (vmRecord.power_state !== 'Halted') {
        throw new RelocationError('STORAGE_MOVE_REQUIRES_HALTED_VM', '存储移动只支持已停止的 VM。')
      }
      const ownerVdiRefs: string[] = []
      for (const vbdRef of vmRecord.VBDs ?? []) {
        const vbd = await sourceClient.callWithSession('VBD.get_record', [vbdRef])
        if (isOwnerDiskVbd(vbd)) ownerVdiRefs.push(vbd.VDI)
      }
      const storageMap = requireCompleteMap(
        ownerVdiRefs,
        payload.storageMap,
        'STORAGE_MAP_INCOMPLETE',
        '请为所有可移动磁盘选择目标 SR。'
      )
      const movedVdis = await moveHaltedVmStorage(payload.sourceConnectionId, sourceClient, vmRecord, storageMap)
      return { movedVdis }
    }

    case 'cross-pool-migrate': {
      if (payload.sourceConnectionId === targetConnectionId) {
        throw new RelocationError('TARGET_POOL_REQUIRED', '跨池迁移/复制需要选择不同的目标资源池。')
      }
      requireValue(payload.targetHostRef, 'TARGET_HOST_REQUIRED', '请选择目标主机。')
      requireValue(payload.transferNetworkRef, 'TRANSFER_NETWORK_REQUIRED', '请选择目标池的迁移传输网络。')

      const disks = await getVmDisks(sourceClient, vmRecord)
      const vifs = await getVmVifs(sourceClient, vmRecord)
      const vdiMap = requireCompleteMap(
        disks.map((disk) => disk.vdiRef),
        payload.storageMap,
        'STORAGE_MAP_INCOMPLETE',
        '请为所有 VM 磁盘选择目标 SR。'
      )
      const vifMap = requireCompleteMap(
        vifs.map((vif) => vif.vifRef),
        payload.networkMap,
        'NETWORK_MAP_INCOMPLETE',
        '请为所有 VM 网卡选择目标网络。'
      )

      const targetHost = await targetClient.callWithSession('host.get_record', [payload.targetHostRef])
      if (targetHost?.enabled !== true) throw new RelocationError('TARGET_HOST_DISABLED', '目标主机当前不可用。')
      if ((vmRecord.VGPUs ?? []).length) throw new RelocationError('VGPU_MAPPING_REQUIRED', '跨池迁移需要显式 vGPU 映射，当前工作流无法提供。')
      const dest = await targetClient.callWithSession('host.migrate_receive', [
        payload.targetHostRef,
        payload.transferNetworkRef,
        {},
      ])
      const options = {}
      await sourceClient.callWithSession('VM.assert_can_migrate', [payload.vmRef, dest, true, vdiMap, vifMap, options, {}])
      const taskRef: string = await sourceClient.callWithSession('Async.VM.migrate_send', [
        payload.vmRef,
        dest,
        true,
        vdiMap,
        vifMap,
        options,
        {}, // No vGPU mapping is required for this guarded workflow.
      ])
      const task = await waitForXapiTask(sourceClient, taskRef)
      const refs = [...new Set(String(task.result ?? '').match(/OpaqueRef:[A-Za-z0-9._:-]+/g) ?? [])]
        .filter((ref) => ref !== 'OpaqueRef:NULL')
      if (refs.length !== 1) throw taskOutcomeUnknown(taskRef)
      try {
        await readOperationResult(async () => {
          const targetVm = await targetClient.callWithSession('VM.get_record', [refs[0]])
          if (!targetVm?.uuid || targetVm.is_a_snapshot || targetVm.is_a_template) throw taskOutcomeUnknown(taskRef)
          if (payload.mode === 'cross-pool-migrate' && targetVm.resident_on !== payload.targetHostRef) throw taskOutcomeUnknown(taskRef)
          const targetDisks = await getVmDisks(targetClient, targetVm)
          const targetVifs = await getVmVifs(targetClient, targetVm)
          for (const disk of disks) {
            if (!targetDisks.some((item) => item.userdevice === disk.userdevice && item.sourceSrRef === vdiMap[disk.vdiRef])) throw taskOutcomeUnknown(taskRef)
          }
          for (const vif of vifs) {
            if (!targetVifs.some((item) => item.device === vif.device && item.networkRef === vifMap[vif.vifRef])) throw taskOutcomeUnknown(taskRef)
          }
        })
      } catch (error) { throw taskOutcomeUnknown(taskRef, error instanceof Error ? error.message : String(error)) }
      return { taskRef }
    }

    default:
      throw new RelocationError('UNKNOWN_RELOCATION_MODE', `Unsupported relocation mode: ${payload.mode}`)
  }
}
