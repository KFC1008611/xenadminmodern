import { startVmCopy } from './vm-copy.service'
import type { VmCopyOperation } from '../../../shared/types/xapi'
/**
 * VM service — wraps XAPI VM.* methods for lifecycle and metadata management.
 * All functions accept connectionId as the first parameter for multi-connection support.
 */
import { connectionManager } from '../connection-manager'
import { readOperationResult, ReadScopeChangedError } from '../../../shared/read-operation-result'
import { vifPolicy } from '../../../shared/vm-creation'
import { runVmPowerAction } from './vm-power.service'
import { toIpcDateTime } from '../xapi-datetime'
import { confirmRecordDeleted, isLostMutationResponse, readMutationResult, resultReadFailed } from './mutation-result'
import { canRunVmAction } from '../../../shared/vm-actions'
import { createLogger } from '../../logger'
import { validateVmMemoryLimits, vmMemoryLimits, vmMemoryEditReason, sameVmMemory } from '../../../shared/vm-memory'
import type {
  VmRecord,
  VmPowerIntent,
  VmDetailRecord,
  ConnectedVmRecord,
  VBDRecord,
  IsoImageRecord,
  VmCdDriveRecord,
  VIFRecord,
  SnapshotRecord,
  VmCopyPayload,
  VmDestroyOptions,
  VmDestroyResult,
  TemplateClonePayload,
  TemplateDeletePayload,
  TemplateSettingsPayload,
} from '../../../shared/types/xapi'

const log = createLogger('VmService')

// Re-export shared types for backward compatibility
export type {
  VmRecord,
  VmDetailRecord,
  ConnectedVmRecord,
  VBDRecord,
  IsoImageRecord,
  VmCdDriveRecord,
  VIFRecord,
  SnapshotRecord,
  VmCopyPayload,
  VmDestroyOptions,
}

/** Categorized templates: user-created vs system defaults */
export interface CategorizedTemplates {
  user: VmRecord[]
  system: VmRecord[]
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

function isNullRef(ref: unknown): boolean {
  return !ref || ref === 'OpaqueRef:NULL'
}

function isXapiCode(err: any, code: string): boolean {
  return err?.code === code || err?.details?.code === code || err?.faultString === code
}

function isXapiHandleInvalid(err: any): boolean {
  return (
    isXapiCode(err, 'HANDLE_INVALID') ||
    err?.message === 'HANDLE_INVALID' ||
    err?.details?.[0] === 'HANDLE_INVALID' ||
    err?.params?.[0] === 'HANDLE_INVALID'
  )
}

function hasCurrentOperation(record: any): boolean {
  return Object.keys(record?.current_operations ?? {}).length > 0
}

function isOwnerDiskVbd(record: any): boolean {
  // XAPI's provisioner uses an empty owner marker; imported clients also use "true".
  const owner = record?.other_config?.owner
  return record?.type === 'Disk' && (owner === '' || owner === 'true')
}

function diskDeleteReason(vbd: any, vbdRef: string, vdi: any): string | undefined {
  if (!isOwnerDiskVbd(vbd)) return '磁盘归属不明确，保留此磁盘'
  if (vbd.mode !== 'RW' || vdi?.read_only === true) return '只读磁盘，保留此磁盘'
  if (!vdi || typeof vdi.uuid !== 'string' || !vdi.uuid || !Array.isArray(vdi.VBDs)) return '磁盘身份或关系读取失败，禁止删除'
  if (vdi.sharable === true || vdi.VBDs.length !== 1 || vdi.VBDs[0] !== vbdRef) return '共享或非独占磁盘，保留此磁盘'
  if (vdi.is_a_snapshot === true || !['user', 'system'].includes(vdi.type)) return '快照或特殊磁盘，保留此磁盘'
  if (hasCurrentOperation(vdi)) return '磁盘正在执行其他操作，保留此磁盘'
  return undefined
}

function sortDeviceIds(deviceIds: string[]): string[] {
  return [...deviceIds].sort((a, b) => {
    const aNum = Number(a)
    const bNum = Number(b)
    if (Number.isFinite(aNum) && Number.isFinite(bNum)) return aNum - bNum
    return a.localeCompare(b)
  })
}

function compareDeviceIds(a: string, b: string): number {
  const [first, second] = sortDeviceIds([a, b])
  if (first === second) return 0
  return first === a ? -1 : 1
}

function isIsoSrRecord(record: any): boolean {
  return record?.type === 'iso' || record?.content_type === 'iso'
}

function isIsoVdiRecord(vdi: any, srRecord?: any): boolean {
  return vdi?.is_tools_iso === true || vdi?.type === 'iso' || isIsoSrRecord(srRecord)
}

function normalizeVmNumericFields(record: any): any {
  const normalized = { ...record }
  for (const key of [
    'VCPUs_max', 'VCPUs_at_startup', 'memory_static_min', 'memory_static_max',
    'memory_dynamic_min', 'memory_dynamic_max',
  ]) {
    if (record[key] !== undefined) normalized[key] = Number(record[key])
  }
  return normalized
}

export async function getAllVms(connectionId: string): Promise<ConnectedVmRecord[]> {
  const client = getClient(connectionId)
  const poolName = getPoolName(connectionId)

  log.debug(`getAllVms() connectionId=${connectionId} poolName=${poolName}`)

  // Use get_all_records to fetch all VMs in a single XAPI call (avoids N+1 pattern)
  const allRecords: Record<string, any> = await client.callWithSession('VM.get_all_records', [])
  log.debug(`getAllVms() got ${Object.keys(allRecords).length} VM records from XAPI`)

  const records = Object.entries(allRecords).map(([ref, record]) => ({
    ref,
    ...normalizeVmNumericFields(record),
    connectionId,
    poolName,
  })) as ConnectedVmRecord[]

  // Filter out templates, snapshots, and dom0 control domains
  const filtered = records.filter(vm => !vm.is_a_template && !vm.is_a_snapshot && !vm.is_control_domain)
  const withGuestMetrics = filtered.filter(vm => (vm.power_state === 'Running' || vm.power_state === 'Paused') && !isNullRef(vm.guest_metrics))
  if (withGuestMetrics.length) {
    try {
      // One bulk read per pool avoids a request for every VM on each refresh.
      const metrics = await client.callWithSession('VM_guest_metrics.get_all_records', [])
      for (const vm of withGuestMetrics) vm.networks = metrics[vm.guest_metrics]?.networks ?? {}
    } catch {
      // Optional guest data must not hide the VM inventory when unavailable.
      for (const vm of withGuestMetrics) vm.guestMetricsError = '客户机 IP 读取失败，请刷新重试'
    }
  }
  log.debug(`getAllVms() returning ${filtered.length} VMs (filtered from ${records.length} total)`)
  return filtered
}

export async function startVm(connectionId: string, vmRef: string, intent?: VmPowerIntent): Promise<void> {
  await runVmPowerAction(connectionId, vmRef, 'start', intent)
}

export async function shutdownVm(connectionId: string, vmRef: string, intent?: VmPowerIntent): Promise<void> {
  await runVmPowerAction(connectionId, vmRef, 'shutdown', intent)
}

export async function forceShutdownVm(connectionId: string, vmRef: string, intent?: VmPowerIntent): Promise<void> {
  await runVmPowerAction(connectionId, vmRef, 'forceShutdown', intent)
}

export async function rebootVm(connectionId: string, vmRef: string, intent?: VmPowerIntent): Promise<void> {
  await runVmPowerAction(connectionId, vmRef, 'reboot', intent)
}

export async function pauseVm(connectionId: string, vmRef: string, intent?: VmPowerIntent): Promise<void> {
  await runVmPowerAction(connectionId, vmRef, 'pause', intent)
}

export async function unpauseVm(connectionId: string, vmRef: string, intent?: VmPowerIntent): Promise<void> {
  await runVmPowerAction(connectionId, vmRef, 'unpause', intent)
}

export async function suspendVm(connectionId: string, vmRef: string, intent?: VmPowerIntent): Promise<void> {
  await runVmPowerAction(connectionId, vmRef, 'suspend', intent)
}

export async function resumeVm(connectionId: string, vmRef: string, intent?: VmPowerIntent): Promise<void> {
  await runVmPowerAction(connectionId, vmRef, 'resume', intent)
}

export async function destroyVm(
  connectionId: string,
  vmRef: string,
  options: VmDestroyOptions = {}
): Promise<VmDestroyResult> {
  const client = getClient(connectionId)
  const info = connectionManager.getConnectionInfo(connectionId)
  const identity = JSON.stringify([info?.poolUuid, info?.epoch])
  const isCurrent = () => {
    const current = connectionManager.getConnectionInfo(connectionId)
    return getClient(connectionId) === client && JSON.stringify([current?.poolUuid, current?.epoch]) === identity
  }
  const record = await client.callWithSession('VM.get_record', [vmRef])
  const intentMatches = () => !options.intent || (record.uuid === options.intent.vmUuid
    && info?.poolUuid === options.intent.poolUuid && info?.epoch === options.intent.epoch)
  if (!isCurrent() || !intentMatches()) throw new Error('虚拟机或资源池连接已变化，未提交删除')

  if (Object.prototype.hasOwnProperty.call(record.blocked_operations ?? {}, 'destroy')) {
    throw new Error(`VM 已启用删除保护：${record.blocked_operations.destroy}`)
  }
  if (record.is_a_template || record.is_a_snapshot) {
    throw new Error('模板请使用模板删除操作')
  }
  if (record.is_control_domain) {
    throw new Error('控制域不能删除')
  }
  if (record.locked || record.Locked) {
    throw new Error('VM 已锁定，当前不能删除')
  }
  if (hasCurrentOperation(record)) {
    throw new Error('VM 正在执行其他操作，当前不能删除')
  }
  if (record.power_state !== 'Halted') {
    throw new Error('只有已停止的 VM 可以删除')
  }
  if (!Array.isArray(record.allowed_operations) || !record.allowed_operations.includes('destroy')) {
    throw new Error('XAPI 当前不允许删除该 VM')
  }

  const requestedVdiRefs = new Set(options.vdiRefs ?? [])
  const ownerVdiVbdRefs = new Map<string, string>()
  const diskUuids = new Map<string, string>()

  if (requestedVdiRefs.size > 0 || options.deleteDisks) {
    for (const vbdRef of record.VBDs ?? []) {
      try {
        const vbd = await client.callWithSession('VBD.get_record', [vbdRef])
        if (isOwnerDiskVbd(vbd) && vbd.mode === 'RW' && !isNullRef(vbd.VDI)) {
          if (options.deleteDisks) {
            const vdi = await client.callWithSession('VDI.get_record', [vbd.VDI])
            if (diskDeleteReason(vbd, vbdRef, vdi)) continue
            requestedVdiRefs.add(vbd.VDI)
          }
          ownerVdiVbdRefs.set(vbd.VDI, vbdRef)
        }
      } catch (err: any) {
        if (!isXapiHandleInvalid(err)) throw err
      }
    }

    const invalidRef = [...requestedVdiRefs].find((ref) => !ownerVdiVbdRefs.has(ref))
    if (invalidRef) {
      throw new Error(`所选磁盘不属于该 VM: ${invalidRef}`)
    }
    for (const vdiRef of requestedVdiRefs) {
      const vdi = await client.callWithSession('VDI.get_record', [vdiRef])
      const soleVbdRef = ownerVdiVbdRefs.get(vdiRef)
      if (typeof vdi.uuid !== 'string' || !vdi.uuid || !Array.isArray(vdi.VBDs) || vdi.VBDs.length !== 1 || vdi.VBDs[0] !== soleVbdRef
        || vdi.sharable === true || vdi.read_only === true || vdi.is_a_snapshot === true
        || !['user', 'system'].includes(vdi.type) || hasCurrentOperation(vdi)) {
        throw new Error(`所选磁盘并非可删除的独占拥有磁盘: ${vdiRef}`)
      }
      diskUuids.set(vdiRef, vdi.uuid)
    }
  }

  const vdiRefsToDelete = new Set(requestedVdiRefs)
  if (!isNullRef(record.suspend_VDI)) {
    vdiRefsToDelete.add(record.suspend_VDI)
  }

  if (!isCurrent()) throw new Error('资源池连接已变化，未提交删除')
  if (options.intent) {
    const latest = await client.callWithSession('VM.get_record', [vmRef])
    const guard = canRunVmAction(latest, 'delete')
    if (!isCurrent() || latest.uuid !== options.intent.vmUuid || !guard.canRun) throw new Error(guard.reason || '虚拟机身份已变化，未提交删除')
  }
  await client.callWithSession('VM.destroy', [vmRef])
  await confirmRecordDeleted('删除虚拟机', () => client.callWithSession('VM.get_record', [vmRef]), isCurrent)

  const failedVdiRefs: string[] = []
  for (const vdiRef of vdiRefsToDelete) {
    try {
      if (!isCurrent()) throw new Error('资源池连接已变化，已停止磁盘清理')
      const disk = await client.callWithSession('VDI.get_record', [vdiRef])
      if ((diskUuids.has(vdiRef) && disk.uuid !== diskUuids.get(vdiRef))
        || !Array.isArray(disk.VBDs) || disk.VBDs.length || disk.sharable === true
        || disk.read_only === true || disk.is_a_snapshot === true || hasCurrentOperation(disk)) throw new Error('磁盘身份、关系或状态已变化，保留此磁盘')
      if (!isCurrent()) throw new Error('资源池连接已变化，已停止磁盘清理')
      await client.callWithSession('VDI.destroy', [vdiRef])
      await confirmRecordDeleted('删除磁盘', () => client.callWithSession('VDI.get_record', [vdiRef]), isCurrent)
    } catch (err: any) {
      if (isXapiHandleInvalid(err)) {
        continue
      } else {
        failedVdiRefs.push(vdiRef)
        log.warn(`VDI cleanup failed after VM.destroy for ${vdiRef}: ${err?.message || err}`)
      }
    }
  }
  return { vmDeleted: true, failedVdiRefs }
}

export async function snapshotVm(connectionId: string, vmRef: string, name: string, intent?: VmPowerIntent): Promise<string> {
  const client = getClient(connectionId)
  const info = connectionManager.getConnectionInfo(connectionId)
  const isCurrent = () => connectionManager.getClient(connectionId) === client
    && connectionManager.getConnectionInfo(connectionId)?.poolUuid === info?.poolUuid
    && connectionManager.getConnectionInfo(connectionId)?.epoch === info?.epoch
  if (intent) {
    const vm = await client.callWithSession('VM.get_record', [vmRef])
    const guard = canRunVmAction(vm, 'snapshot')
    if (!guard.canRun || vm.uuid !== intent.vmUuid || info?.poolUuid !== intent.poolUuid || info?.epoch !== intent.epoch || !isCurrent()) {
      throw Object.assign(new Error(guard.reason || '虚拟机或资源池连接已变化，未提交快照'), { details: { outcome: 'failed' } })
    }
  }
  const ref = await client.callWithSession('VM.snapshot', [vmRef, name])
  if (intent) await readMutationResult('创建快照', async () => {
    if (typeof ref !== 'string' || !ref.startsWith('OpaqueRef:') || ref === 'OpaqueRef:NULL') throw new Error('服务器未返回有效快照引用')
    const snapshot = await client.callWithSession('VM.get_record', [ref])
    if (!snapshot?.is_a_snapshot || snapshot.snapshot_of !== vmRef) throw new Error('服务器未返回原虚拟机的快照记录')
  }, isCurrent)
  return ref
}

export async function migrateVm(connectionId: string, vmRef: string, targetHostRef: string): Promise<void> {
  const client = getClient(connectionId)
  await client.callWithSession('VM.pool_migrate', [vmRef, targetHostRef, {}])
}

export async function copyVm(connectionId: string, payload: VmCopyPayload): Promise<VmCopyOperation> {
  return startVmCopy(connectionId, payload)
}

export async function getVmConsole(
  connectionId: string,
  vmRef: string
): Promise<{ ref: string; location: string; protocol: string }[]> {
  const client = getClient(connectionId)
  const consoleRefs: string[] = await client.callWithSession('VM.get_consoles', [vmRef])
  const consoles = await Promise.all(
    consoleRefs.map(async (ref) => {
      const record = await client.callWithSession('console.get_record', [ref])
      return { ref, ...record }
    })
  )
  return consoles
}

/**
 * Get detailed VM record including guest metrics (IPs, OS info).
 */
export async function getVmRecord(connectionId: string, vmRef: string): Promise<VmDetailRecord> {
  const client = getClient(connectionId)
  const record = await client.callWithSession('VM.get_record', [vmRef])
  let os_version: Record<string, string> = {}
  let networks: Record<string, string> = {}
  let memoryActual: number | undefined

  if (record.guest_metrics && record.guest_metrics !== 'OpaqueRef:NULL') {
    try {
      const gm = await client.callWithSession('VM_guest_metrics.get_record', [record.guest_metrics])
      os_version = gm.os_version || {}
      networks = gm.networks || {}
    } catch {
      // guest metrics may not be available if guest tools not installed
    }
  }

  if ((record.power_state === 'Running' || record.power_state === 'Paused') && !isNullRef(record.metrics)) {
    try {
      const metrics = await client.callWithSession('VM_metrics.get_record', [record.metrics])
      const actual = Number(metrics.memory_actual)
      if (Number.isSafeInteger(actual) && actual >= 0) memoryActual = actual
    } catch {
      // Runtime allocation is optional; unavailable metrics must not hide configuration.
    }
  }

  return {
    ref: vmRef,
    ...normalizeVmNumericFields(record),
    memory_static_min: Number(record.memory_static_min) || 0,
    memory_dynamic_min: Number(record.memory_dynamic_min) || 0,
    os_version,
    networks,
    memory_actual: memoryActual,
  } as VmDetailRecord
}

export async function setVmNameLabel(connectionId: string, vmRef: string, nameLabel: string): Promise<void> {
  if (!nameLabel.trim()) throw new Error('虚拟机名称不能为空')
  const client = getClient(connectionId)
  await client.callWithSession('VM.set_name_label', [vmRef, nameLabel])
}

export async function setVmNameDescription(connectionId: string, vmRef: string, description: string): Promise<void> {
  const client = getClient(connectionId)
  await client.callWithSession('VM.set_name_description', [vmRef, description])
}

export async function setVmVcpus(connectionId: string, vmRef: string, count: number): Promise<void> {
  const client = getClient(connectionId)
  if (!Number.isInteger(count) || count < 1) throw new Error('VCPU 数量必须为正整数')
  const record = await client.callWithSession('VM.get_record', [vmRef])
  if (record.power_state !== 'Halted') throw new Error('只有已停止的 VM 可以修改启动 VCPU 数量')
  if (record.is_a_template || record.is_a_snapshot || record.is_control_domain || record.locked || record.Locked || hasCurrentOperation(record)) {
    throw new Error('当前 VM 不能修改 VCPU 配置')
  }
  if (Array.isArray(record.allowed_operations) && !record.allowed_operations.includes('changing_VCPUs')) {
    throw new Error('XAPI 当前不允许修改 VCPU 配置')
  }
  const startup = Number(record.VCPUs_at_startup)
  const maximum = Number(record.VCPUs_max)
  if (!Number.isInteger(startup) || startup < 1 || !Number.isInteger(maximum) || maximum < startup) {
    throw new Error('无法确认当前 VCPU 配置')
  }
  if (startup === count && maximum === count) return
  let mutationError: unknown
  try {
    if (count < startup) {
      await client.callWithSession('VM.set_VCPUs_at_startup', [vmRef, count])
      if (maximum !== count) await client.callWithSession('VM.set_VCPUs_max', [vmRef, count])
    } else {
      if (maximum !== count) await client.callWithSession('VM.set_VCPUs_max', [vmRef, count])
      if (startup !== count) await client.callWithSession('VM.set_VCPUs_at_startup', [vmRef, count])
    }
  } catch (error) { mutationError = error }
  let updated: any
  try { updated = await readOperationResult(async () => {
    const actual = await client.callWithSession('VM.get_record', [vmRef])
    if (!actual || typeof actual !== 'object') throw new Error('服务器未返回有效 VM 记录')
    if (actual?.uuid !== record.uuid) throw new ReadScopeChangedError()
    return actual
  }, { isCurrent: () => connectionManager.getClient(connectionId) === client }) }
  catch (error) {
    throw new Error(`无法获取 VCPU 保存结果：${error instanceof Error ? error.message : String(error)}`)
  }
  if (Number(updated.VCPUs_at_startup) === count && Number(updated.VCPUs_max) === count) return
  const reason = mutationError instanceof Error ? `；${mutationError.message}` : ''
  throw new Error(`VCPU 配置未完全应用：当前启动数量 ${updated.VCPUs_at_startup}，最大数量 ${updated.VCPUs_max}${reason}`)
}

export async function setVmMemoryLimits(
  connectionId: string,
  vmRef: string,
  staticMin: number,
  dynamicMin: number,
  dynamicMax: number,
  staticMax: number
): Promise<void> {
  const client = getClient(connectionId)
  const limits = { staticMin, dynamicMin, dynamicMax, staticMax }
  const invalid = validateVmMemoryLimits(limits)
  if (invalid) throw new Error(invalid)
  const record = normalizeVmNumericFields(await client.callWithSession('VM.get_record', [vmRef]))
  const current = vmMemoryLimits(record)
  if (validateVmMemoryLimits(current)) throw new Error('无法确认当前内存配置，请刷新后重试。')
  // Preserve the platform/template minimum; lowering it is not a supported edit.
  if (staticMin !== current.staticMin) throw new Error('不能修改虚拟机的静态内存下限。')
  if (sameVmMemory(current, limits)) return
  const reason = vmMemoryEditReason(record, limits)
  if (reason) throw new Error(reason)
  if (staticMax !== current.staticMax) {
    await client.callWithSession('VM.set_memory_limits', [
      vmRef, String(staticMin), String(staticMax), String(dynamicMin), String(dynamicMax),
    ])
  } else {
    await client.callWithSession('VM.set_memory_dynamic_range', [vmRef, String(dynamicMin), String(dynamicMax)])
  }
}

export async function getVmVBDs(connectionId: string, vmRef: string): Promise<VBDRecord[]> {
  const client = getClient(connectionId)
  const vbdRefs: string[] = await client.callWithSession('VM.get_VBDs', [vmRef])
  const records = await Promise.all(
    vbdRefs.map(async (ref) => {
      const vbd = await client.callWithSession('VBD.get_record', [ref])
      let vdiName = ''
      let vdiSize = 0
      let srRef = ''
      let deleteReason = '磁盘信息读取失败，禁止删除'

      if (vbd.VDI && vbd.VDI !== 'OpaqueRef:NULL') {
        try {
          const vdi = await client.callWithSession('VDI.get_record', [vbd.VDI])
          vdiName = vdi.name_label || ''
          vdiSize = Number(vdi.virtual_size) || 0
          srRef = vdi.SR || ''
          deleteReason = diskDeleteReason(vbd, ref, vdi) || ''
        } catch {
          // VDI might be gone
        }
      }

      return {
        ref,
        VDI: vbd.VDI || '',
        userdevice: vbd.userdevice || '',
        mode: vbd.mode || '',
        type: vbd.type || '',
        bootable: Boolean(vbd.bootable),
        currently_attached: Boolean(vbd.currently_attached),
        unpluggable: Boolean(vbd.unpluggable),
        allowed_operations: vbd.allowed_operations || [],
        owner: isOwnerDiskVbd(vbd),
        deleteReason: deleteReason || undefined,
        vdiName,
        vdiSize,
        srRef,
      } as VBDRecord
    })
  )
  return records.filter(v => v.type === 'Disk')
}

export async function plugVbd(connectionId: string, vbdRef: string): Promise<void> {
  const client = getClient(connectionId)
  await client.callWithSession('VBD.plug', [vbdRef])
}

export async function unplugVbd(connectionId: string, vbdRef: string): Promise<void> {
  const client = getClient(connectionId)
  await client.callWithSession('VBD.unplug', [vbdRef])
}

export async function detachVbd(connectionId: string, vbdRef: string): Promise<void> {
  const client = getClient(connectionId)
  const record = await client.callWithSession('VBD.get_record', [vbdRef])

  try {
    if (record.currently_attached) await client.callWithSession('VBD.unplug', [vbdRef])
    await client.callWithSession('VBD.destroy', [vbdRef])
  } catch (error) {
    let fresh: any
    try { fresh = await client.callWithSession('VBD.get_record', [vbdRef]) } catch (readError) {
      if (isXapiHandleInvalid(readError)) return
    }
    const failure = new Error(fresh?.currently_attached === false
      ? '磁盘已停用，但连接记录未删除；磁盘数据仍保留在 SR 中。'
      : '磁盘分离结果尚未确认，请刷新连接状态后再操作。') as Error & { code: string; details: unknown }
    failure.code = 'VBD_DETACH_INCOMPLETE'
    failure.details = { vbdRef, currentlyAttached: fresh?.currently_attached, cause: error instanceof Error ? error.message : String(error) }
    throw failure
  }
}

export async function listIsoImages(connectionId: string): Promise<IsoImageRecord[]> {
  const client = getClient(connectionId)
  const poolName = getPoolName(connectionId)
  const [srRecords, vdiRecords]: [Record<string, any>, Record<string, any>] = await Promise.all([
    client.callWithSession('SR.get_all_records', []),
    client.callWithSession('VDI.get_all_records', []),
  ])

  return Object.entries(vdiRecords)
    .filter(([, record]) => isIsoVdiRecord(record, srRecords[record.SR]))
    .map(([ref, record]) => {
      const sr = srRecords[record.SR] || {}
      return {
        ref,
        uuid: record.uuid || '',
        name_label: record.name_label || '',
        name_description: record.name_description || '',
        virtual_size: Number(record.virtual_size) || 0,
        physical_utilisation: Number(record.physical_utilisation) || 0,
        type: record.type || '',
        SR: record.SR || '',
        srName: sr.name_label || '',
        read_only: Boolean(record.read_only),
        connectionId,
        poolName,
      } as IsoImageRecord
    })
    .sort((a, b) => a.name_label.localeCompare(b.name_label))
}

async function getIsoImageRecord(client: ReturnType<typeof getClient>, vdiRef: string) {
  const vdi = await client.callWithSession('VDI.get_record', [vdiRef])
  let srRecord: any = null
  if (!isNullRef(vdi.SR)) {
    try {
      srRecord = await client.callWithSession('SR.get_record', [vdi.SR])
    } catch {
      // Older tools ISOs can still be identified by VDI.is_tools_iso.
    }
  }

  if (!isIsoVdiRecord(vdi, srRecord)) {
    throw new Error('VDI is not an ISO')
  }
  return vdi
}

async function getSrName(client: ReturnType<typeof getClient>, srRef: string): Promise<string> {
  if (isNullRef(srRef)) return ''
  try {
    const sr = await client.callWithSession('SR.get_record', [srRef])
    return sr.name_label || ''
  } catch {
    return ''
  }
}

async function getCdVbd(
  client: ReturnType<typeof getClient>,
  vmRef: string
): Promise<{ ref: string; record: any } | null> {
  const vbdRefs: string[] = await client.callWithSession('VM.get_VBDs', [vmRef])
  const cdVbds: Array<{ ref: string; record: any }> = []

  for (const ref of vbdRefs) {
    const record = await client.callWithSession('VBD.get_record', [ref])
    if (record.type === 'CD') {
      cdVbds.push({ ref, record })
    }
  }

  if (cdVbds.length === 0) return null
  cdVbds.sort((a, b) => compareDeviceIds(a.record.userdevice || '', b.record.userdevice || ''))
  return cdVbds[0]
}

async function ensureCdVbd(
  client: ReturnType<typeof getClient>,
  vmRef: string
): Promise<{ ref: string; record: any }> {
  const existing = await getCdVbd(client, vmRef)
  if (existing) return existing

  const allowedDevices: string[] = await client.callWithSession('VM.get_allowed_VBD_devices', [vmRef])
  const [userdevice] = sortDeviceIds(allowedDevices)
  if (!userdevice) {
    throw new Error('没有可用的虚拟光驱设备号')
  }

  const vbdRef: string = await client.callWithSession('VBD.create', [{
    VM: vmRef,
    VDI: 'OpaqueRef:NULL',
    userdevice,
    bootable: false,
    mode: 'RO',
    type: 'CD',
    unpluggable: true,
    empty: true,
    other_config: {},
    qos_algorithm_type: '',
    qos_algorithm_params: {},
  }])

  return {
    ref: vbdRef,
    record: {
      VDI: 'OpaqueRef:NULL',
      userdevice,
      mode: 'RO',
      type: 'CD',
      bootable: false,
      empty: true,
    },
  }
}

export async function getVmCdDrive(connectionId: string, vmRef: string): Promise<VmCdDriveRecord> {
  const client = getClient(connectionId)
  const cdVbd = await getCdVbd(client, vmRef)
  if (!cdVbd) {
    return {
      vbdRef: null,
      vdiRef: null,
      userdevice: null,
      empty: true,
      isoName: null,
      isoSize: null,
      srRef: null,
      srName: null,
    }
  }

  const vdiRef = isNullRef(cdVbd.record.VDI) ? null : cdVbd.record.VDI
  if (!vdiRef) {
    return {
      vbdRef: cdVbd.ref,
      vdiRef: null,
      userdevice: cdVbd.record.userdevice || null,
      empty: true,
      isoName: null,
      isoSize: null,
      srRef: null,
      srName: null,
    }
  }

  try {
    const vdi = await client.callWithSession('VDI.get_record', [vdiRef])
    return {
      vbdRef: cdVbd.ref,
      vdiRef,
      userdevice: cdVbd.record.userdevice || null,
      empty: false,
      isoName: vdi.name_label || '',
      isoSize: Number(vdi.virtual_size) || 0,
      srRef: vdi.SR || null,
      srName: await getSrName(client, vdi.SR),
    }
  } catch {
    return {
      vbdRef: cdVbd.ref,
      vdiRef,
      userdevice: cdVbd.record.userdevice || null,
      empty: false,
      isoName: '',
      isoSize: 0,
      srRef: null,
      srName: null,
    }
  }
}

export async function mountVmIso(
  connectionId: string,
  vmRef: string,
  isoVdiRef: string
): Promise<void> {
  const client = getClient(connectionId)
  await getIsoImageRecord(client, isoVdiRef)

  const cdVbd = await ensureCdVbd(client, vmRef)
  const currentVdiRef = isNullRef(cdVbd.record.VDI) ? null : cdVbd.record.VDI

  if (currentVdiRef === isoVdiRef) return

  try {
    if (currentVdiRef) await client.callWithSession('VBD.eject', [cdVbd.ref])
    await client.callWithSession('VBD.insert', [cdVbd.ref, isoVdiRef])
  } catch (error) {
    let fresh: any
    try { fresh = await client.callWithSession('VBD.get_record', [cdVbd.ref]) } catch { /* Retain unknown state. */ }
    if (fresh?.VDI === isoVdiRef && fresh?.empty !== true) return
    const empty = fresh && (fresh.empty === true || isNullRef(fresh.VDI))
    const failure = new Error(empty
      ? '新 ISO 挂载失败，光驱当前为空，原 ISO 已弹出。'
      : fresh?.VDI === currentVdiRef ? '新 ISO 挂载失败，原 ISO 仍在光驱中。' : 'ISO 替换结果未知，请刷新光驱状态后再操作。') as Error & { code: string; details: unknown }
    failure.code = 'ISO_REPLACE_INCOMPLETE'
    failure.details = { vbdRef: cdVbd.ref, previousVdiRef: currentVdiRef, requestedVdiRef: isoVdiRef,
      actualVdiRef: fresh ? (empty ? null : fresh.VDI) : undefined, cause: error instanceof Error ? error.message : String(error) }
    throw failure
  }
}

export async function ejectVmIso(connectionId: string, vmRef: string): Promise<void> {
  const client = getClient(connectionId)
  const cdVbd = await getCdVbd(client, vmRef)
  if (!cdVbd || isNullRef(cdVbd.record.VDI)) return

  try {
    await client.callWithSession('VBD.eject', [cdVbd.ref])
  } catch (err: any) {
    if (isXapiCode(err, 'VBD_IS_EMPTY')) return
    if (!isLostMutationResponse(err)) throw err
    const actual = await readMutationResult('弹出 ISO', () => client.callWithSession('VBD.get_record', [cdVbd.ref]),
      () => connectionManager.getClient(connectionId) === client)
    if (actual?.empty !== true && !isNullRef(actual?.VDI)) throw err
  }
}

export async function getVmVIFs(connectionId: string, vmRef: string): Promise<VIFRecord[]> {
  const client = getClient(connectionId)
  const vifRefs: string[] = await client.callWithSession('VM.get_VIFs', [vmRef])
  const records = await Promise.all(
    vifRefs.map(async (ref) => {
      const vif = await client.callWithSession('VIF.get_record', [ref])
      let networkName = ''

      if (vif.network && vif.network !== 'OpaqueRef:NULL') {
        try {
          const net = await client.callWithSession('network.get_record', [vif.network])
          networkName = net.name_label || ''
        } catch {
          // network might be gone
        }
      }

      return {
        ref,
        device: vif.device || '',
        MAC: vif.MAC || '',
        network: vif.network || '',
        networkName,
        MTU: Number(vif.MTU) || 1500,
        policy: vifPolicy(vif),
        currently_attached: vif.currently_attached === true,
      } as VIFRecord
    })
  )
  return records
}

export async function getVmSnapshots(connectionId: string, vmRef: string): Promise<SnapshotRecord[]> {
  const client = getClient(connectionId)
  const snapRefs: string[] = await client.callWithSession('VM.get_snapshots', [vmRef])
  const records = await Promise.all(
    snapRefs.map(async (ref) => {
      const record = await client.callWithSession('VM.get_record', [ref])
      // Estimate size from VBDs
      let size = 0
      if (record.VBDs && record.VBDs.length > 0) {
        try {
          const vbdSizes = await Promise.all(
            record.VBDs.map(async (vbdRef: string) => {
              try {
                const vbd = await client.callWithSession('VBD.get_record', [vbdRef])
                if (vbd.VDI && vbd.VDI !== 'OpaqueRef:NULL') {
                  const vdi = await client.callWithSession('VDI.get_record', [vbd.VDI])
                  return Number(vdi.virtual_size) || 0
                }
              } catch {
                // ignore
              }
              return 0
            })
          )
          size = vbdSizes.reduce((a, b) => a + b, 0)
        } catch {
          // ignore size errors
        }
      }

      return {
        ref,
        uuid: record.uuid || '',
        name_label: record.name_label || '',
        name_description: record.name_description || '',
        snapshot_time: toIpcDateTime(record.snapshot_time || new Date()),
        size,
      } as SnapshotRecord
    })
  )
  return records.sort((a, b) => b.snapshot_time.localeCompare(a.snapshot_time))
}

export async function revertVmSnapshot(connectionId: string, snapshotRef: string): Promise<void> {
  const client = getClient(connectionId)
  await client.callWithSession('VM.revert', [snapshotRef])
}

async function destroySnapshotOrTemplate(
  client: ReturnType<typeof getClient>,
  vmRef: string,
  record: any,
  deleteDisks: boolean,
): Promise<VmDestroyResult> {
  if (!Array.isArray(record.allowed_operations) || !record.allowed_operations.includes('destroy')) {
    throw new Error('XAPI 当前不允许删除该对象')
  }
  if (hasCurrentOperation(record)) {
    throw new Error('对象正在执行其他操作，当前不能删除')
  }

  const deletable: string[] = []
  const retained: string[] = []
  if (deleteDisks) {
    for (const vbdRef of record.VBDs ?? []) {
      const vbd = await client.callWithSession('VBD.get_record', [vbdRef])
      if (vbd?.type !== 'Disk' || isNullRef(vbd.VDI)) continue
      const vdiRef: string = vbd.VDI
      const vdi = await client.callWithSession('VDI.get_record', [vdiRef])
      const exclusive = Array.isArray(vdi.VBDs)
        && vdi.VBDs.length === 1 && vdi.VBDs[0] === vbdRef
      // Snapshot cleanup must still be able to remove its own snapshot VDIs.
      const templateDiskSafe = record.is_a_snapshot === true
        || (vdi.read_only !== true && vdi.is_a_snapshot !== true && !hasCurrentOperation(vdi))
      if (isOwnerDiskVbd(vbd) && vbd.mode === 'RW' && exclusive && vdi.sharable !== true
        && templateDiskSafe) {
        deletable.push(vdiRef)
      } else {
        retained.push(vdiRef)
      }
    }
  }

  if (!isNullRef(record.suspend_VDI)) deletable.push(record.suspend_VDI)

  await client.callWithSession('VM.destroy', [vmRef])
  const failedVdiRefs = [...retained]
  for (const vdiRef of new Set(deletable)) {
    try {
      await client.callWithSession('VDI.destroy', [vdiRef])
    } catch (err: any) {
      if (!isXapiHandleInvalid(err)) {
        failedVdiRefs.push(vdiRef)
        log.warn(`VDI cleanup failed after VM.destroy for ${vdiRef}: ${err?.message || err}`)
      }
    }
  }
  return { vmDeleted: true, failedVdiRefs }
}

export async function deleteVmSnapshot(connectionId: string, snapshotRef: string): Promise<VmDestroyResult> {
  const client = getClient(connectionId)
  let record = await client.callWithSession('VM.get_record', [snapshotRef])
  if (record.is_a_snapshot !== true) throw new Error('所选对象不是 VM 快照')
  if (record.power_state === 'Suspended') {
    if (!record.allowed_operations?.includes('hard_shutdown') || hasCurrentOperation(record)) {
      throw new Error('快照包含挂起内存，但当前不能释放其挂起状态；已保留快照')
    }
    const suspendVdi = record.suspend_VDI
    await client.callWithSession('VM.hard_shutdown', [snapshotRef])
    record = await client.callWithSession('VM.get_record', [snapshotRef])
    if (record.power_state !== 'Halted') throw new Error('快照尚未停止，已保留快照供核对')
    if (isNullRef(record.suspend_VDI)) record = { ...record, suspend_VDI: suspendVdi }
  }
  return destroySnapshotOrTemplate(client, snapshotRef, record, true)
}

export async function renameVmSnapshot(connectionId: string, snapshotRef: string, newName: string): Promise<void> {
  const client = getClient(connectionId)
  await client.callWithSession('VM.set_name_label', [snapshotRef, newName])
}

/**
 * Returns all VM templates categorized as user-created or system defaults.
 * Uses get_all_records for efficiency (avoids N+1 pattern).
 * System templates are identified by is_default_template=true or
 * other_config.default_template='true'.
 */
export async function getTemplates(connectionId: string): Promise<CategorizedTemplates> {
  const client = getClient(connectionId)
  
  // Use get_all_records for efficiency (same pattern as getAllVms)
  const allRecords: Record<string, any> = await client.callWithSession('VM.get_all_records', [])
  
  const templates = Object.entries(allRecords)
    .map(([ref, record]) => ({ ref, ...normalizeVmNumericFields(record) }) as VmRecord)
    .filter((vm) =>
      vm.is_a_template &&
      !vm.is_a_snapshot &&
      !vm.is_control_domain &&
      vm.other_config?.['HideFromXenCenter'] !== 'true' &&
      !Object.prototype.hasOwnProperty.call(vm.other_config ?? {}, 'xensource_internal')
    )
    .sort((a, b) => a.name_label.localeCompare(b.name_label))
  
  const user: VmRecord[] = []
  const system: VmRecord[] = []
  
  for (const tpl of templates) {
    const isDefault = tpl.is_default_template === true || 
      tpl.other_config?.['default_template'] === 'true'
    
    if (isDefault) {
      system.push(tpl)
    } else {
      user.push(tpl)
    }
  }
  
  return { user, system }
}

/**
 * Clones a template. Uses VM.copy for cross-SR cloning or VM.clone for same-pool.
 */
export async function cloneTemplate(connectionId: string, payload: TemplateClonePayload): Promise<VmCopyOperation> {
  const record = await getClient(connectionId).callWithSession('VM.get_record', [payload.templateRef])
  if (record.is_a_template !== true || record.is_a_snapshot) throw new Error('所选对象不是 VM 模板')
  return startVmCopy(connectionId, { vmRef: payload.templateRef, newName: payload.newName,
    ...(payload.targetSrRef ? { mode: 'copy', targetSrRef: payload.targetSrRef } : { mode: 'clone' }) })
}

/**
 * Deletes a template. Optionally deletes associated VDIs.
 * Protects system templates from deletion.
 */
export async function deleteTemplate(
  connectionId: string,
  payload: TemplateDeletePayload
): Promise<VmDestroyResult> {
  const client = getClient(connectionId)
  const { templateRef, deleteDisks } = payload

  // Get template record for validation and disk cleanup
  const record = await client.callWithSession('VM.get_record', [templateRef])
  if (record.is_a_template !== true || record.is_a_snapshot === true) {
    throw new Error('所选对象不是 VM 模板')
  }

  // Protect system templates
  const isDefault = record.is_default_template === true ||
    record.other_config?.['default_template'] === 'true'
  if (isDefault) {
    throw new Error('无法删除系统模板')
  }

  return destroySnapshotOrTemplate(client, templateRef, record, deleteDisks)
}

/**
 * Updates template settings (name, description, CPU, memory).
 * Only updates fields that are provided in the payload.
 */
export async function updateTemplateSettings(
  connectionId: string,
  payload: TemplateSettingsPayload
): Promise<void> {
  const client = getClient(connectionId)
  const {
    templateRef,
    nameLabel,
    nameDescription,
    vcpusMax,
    vcpusAtStartup,
    memoryStaticMax,
    memoryDynamicMax,
    memoryDynamicMin,
    memoryStaticMin,
  } = payload

  const hasMemoryUpdate = memoryStaticMin !== undefined ||
    memoryDynamicMin !== undefined ||
    memoryDynamicMax !== undefined ||
    memoryStaticMax !== undefined
  const hasCpuUpdate = vcpusMax !== undefined || vcpusAtStartup !== undefined
  if (nameLabel === undefined && nameDescription === undefined && !hasCpuUpdate && !hasMemoryUpdate) return

  const scope = connectionManager.getConnectionInfo(connectionId)
  const isCurrent = () => connectionManager.getClient(connectionId) === client
    && connectionManager.getConnectionInfo(connectionId)?.poolUuid === scope?.poolUuid
    && connectionManager.getConnectionInfo(connectionId)?.epoch === scope?.epoch
  const record = await readOperationResult(() => client.callWithSession('VM.get_record', [templateRef]), { isCurrent })
  if (!record?.uuid || record.is_a_template !== true || record.is_a_snapshot || record.is_control_domain) {
    throw new Error('所选对象不是身份已确认的 VM 模板，请刷新模板列表')
  }
  if (record.power_state !== 'Halted' || record.locked || record.Locked || hasCurrentOperation(record)) {
    throw new Error('模板当前不能修改设置，请等待已有操作结束后刷新')
  }
  if (nameLabel !== undefined && !nameLabel.trim()) throw new Error('模板名称不能为空')

  // Validate the whole target before applying independent fields.
  const maximum = vcpusMax ?? Number(record.VCPUs_max)
  const startup = vcpusAtStartup ?? Number(record.VCPUs_at_startup)
  if (hasCpuUpdate && (!Number.isSafeInteger(maximum) || !Number.isSafeInteger(startup) || startup < 1 || maximum < startup)) {
    throw new Error('VCPU 配置无效：启动数量必须为正整数，且不能大于最大数量')
  }
  const memory = {
    staticMin: memoryStaticMin ?? Number(record.memory_static_min),
    dynamicMin: memoryDynamicMin ?? Number(record.memory_dynamic_min),
    dynamicMax: memoryDynamicMax ?? Number(record.memory_dynamic_max),
    staticMax: memoryStaticMax ?? Number(record.memory_static_max),
  }
  const memoryError = hasMemoryUpdate ? validateVmMemoryLimits(memory) : null
  if (memoryError) throw new Error(memoryError)

  type Setting = { label: string; method: string; args: unknown[]; matches: (actual: any) => boolean }
  const settings: Setting[] = []
  const add = (label: string, method: string, value: unknown, field: string, numeric = false) => {
    const matches = (actual: any) => (numeric ? Number(actual[field]) : actual[field]) === value
    if (!matches(record)) settings.push({ label, method, args: [templateRef, value], matches })
  }
  if (nameLabel !== undefined) add('名称', 'VM.set_name_label', nameLabel, 'name_label')
  if (nameDescription !== undefined) add('简介', 'VM.set_name_description', nameDescription, 'name_description')
  const addMaximum = () => { if (vcpusMax !== undefined) add('最大 VCPU 数量', 'VM.set_VCPUs_max', maximum, 'VCPUs_max', true) }
  const addStartup = () => { if (vcpusAtStartup !== undefined) add('启动 VCPU 数量', 'VM.set_VCPUs_at_startup', startup, 'VCPUs_at_startup', true) }
  // XAPI requires startup <= maximum after each individual write.
  if (maximum < Number(record.VCPUs_at_startup)) { addStartup(); addMaximum() }
  else { addMaximum(); addStartup() }
  if (hasMemoryUpdate) settings.push({ label: '内存', method: 'VM.set_memory_limits',
    args: [templateRef, ...[memory.staticMin, memory.staticMax, memory.dynamicMin, memory.dynamicMax].map(String)],
    matches: (actual) => sameVmMemory(memory, vmMemoryLimits(actual)),
  })
  if (settings.length === 0) return

  const readResult = () => readMutationResult('模板设置', async () => {
    const actual = await client.callWithSession('VM.get_record', [templateRef])
    if (!actual || typeof actual !== 'object') throw new Error('服务器未返回有效模板记录')
    if (actual.uuid !== record.uuid || actual.is_a_template !== true || actual.is_a_snapshot) throw new ReadScopeChangedError()
    return actual
  }, isCurrent)
  let writeError: unknown
  for (const setting of settings) {
    if (!isCurrent()) throw resultReadFailed('模板设置', new ReadScopeChangedError())
    try {
      await client.callWithSession(setting.method, setting.args)
    } catch (cause) {
      if (isLostMutationResponse(cause)) {
        // A lost reply is resolved by reading this field; never replay its write.
        const actual = await readResult()
        if (setting.matches(actual)) continue
      }
      writeError = cause
      break
    }
  }
  const actual = await readResult()
  const missing = settings.filter((setting) => !setting.matches(actual)).map((setting) => setting.label)
  if (missing.length) {
    const cpu = hasCpuUpdate ? `当前 VCPU：启动 ${actual.VCPUs_at_startup}，最大 ${actual.VCPUs_max}。` : ''
    const reason = writeError instanceof Error ? `原因：${writeError.message}。` : ''
    throw Object.assign(new Error(`模板设置未全部保存，未完成：${missing.join('、')}。${cpu}${reason}请刷新模板列表后重新编辑。`), { code: 'TEMPLATE_SETTINGS_PARTIAL' })
  }
}
