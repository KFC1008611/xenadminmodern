/**
 * VDI (Virtual Disk Image) management service — resize, create, and query operations.
 * All functions accept connectionId as the first parameter for multi-connection support.
 *
 * v6: New service extending VDI capabilities beyond basic create/destroy (in sr.service).
 */
import { connectionManager } from '../connection-manager'
import { XMLParser } from 'fast-xml-parser'
import { taskOutcomeUnknown, waitForXapiTask } from './xapi-task'
import { readOperationResult } from '../../../shared/read-operation-result'
import type {
  AttachableVdiRecord,
  VdiAttachPayload,
  VdiAttachResult,
  VdiCreateParams,
  VdiCreateForVmResult,
  VdiMovePayload,
  VdiMoveResult,
  VdiResizeParams,
} from '../../../shared/types/xapi'

export type { VdiCreateParams, VdiResizeParams } from '../../../shared/types/xapi'

// ============================================================================
// Type definitions
// ============================================================================

export interface VdiAllowedOperations {
  resize: boolean
  create: boolean
  destroy: boolean
  onlineResize: boolean
}

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

function isNullRef(ref: unknown): boolean {
  return !ref || ref === 'OpaqueRef:NULL'
}

function hasCurrentOperation(record: any): boolean {
  return Object.keys(record?.current_operations ?? {}).length > 0
}

function isIsoSrRecord(record: any): boolean {
  return record?.type === 'iso' || record?.type === 'udev' || record?.content_type === 'iso'
}

function isExcludedAttachableVdi(vdi: any, srRecord?: any): boolean {
  return (
    vdi?.type === 'crashdump' ||
    vdi?.type === 'ephemeral' ||
    vdi?.type === 'suspend' ||
    vdi?.type === 'iso' ||
    vdi?.is_tools_iso === true ||
    vdi?.is_a_snapshot === true ||
    vdi?.locked === true ||
    vdi?.Locked === true ||
    hasCurrentOperation(vdi) ||
    isIsoSrRecord(srRecord)
  )
}

function sortDeviceIds(deviceIds: string[]): string[] {
  return [...deviceIds].sort((a, b) => {
    const aNum = Number(a)
    const bNum = Number(b)
    if (Number.isFinite(aNum) && Number.isFinite(bNum)) return aNum - bNum
    return a.localeCompare(b)
  })
}

async function chooseVbdDevice(
  client: ReturnType<typeof getClient>,
  vmRef: string,
  requestedDevice?: string
): Promise<string> {
  const allowedDevices: string[] = await client.callWithSession('VM.get_allowed_VBD_devices', [vmRef])
  if (requestedDevice && allowedDevices.includes(requestedDevice)) return requestedDevice

  const [device] = sortDeviceIds(allowedDevices)
  if (!device) {
    throw new IpcError('VBD_NO_AVAILABLE_DEVICE', 'VM has no available VBD device number')
  }
  return device
}

// ============================================================================
// Service functions
// ============================================================================

/**
 * Resize a VDI (only supports expanding).
 * Checks SR free space and VM online resize capability before performing the resize.
 * Returns a task ref for progress tracking.
 */
export async function resizeVdi(
  connectionId: string,
  params: VdiResizeParams
): Promise<string> {
  const client = getClient(connectionId)

  // Get current VDI record to check current size
  const vdiRecord = await client.callWithSession('VDI.get_record', [params.vdiRef])
  const currentSize = Number(vdiRecord.virtual_size) || 0
  const allowedOperations: string[] = Array.isArray(vdiRecord.allowed_operations)
    ? vdiRecord.allowed_operations
    : []
  if (hasCurrentOperation(vdiRecord)) {
    throw new IpcError('VDI_BUSY', 'VDI is already performing another operation')
  }

  // Validate new size is greater than current size
  if (params.newSize <= currentSize) {
    throw new IpcError(
      'VDI_SIZE_INVALID',
      `New size (${params.newSize} bytes) must be greater than current size (${currentSize} bytes)`
    )
  }

  // Check SR free space
  const srRecord = await client.callWithSession('SR.get_record', [vdiRecord.SR])
  const physicalSize = Number(srRecord.physical_size) || 0
  const physicalUtilisation = Number(srRecord.physical_utilisation) || 0
  const freeSpace = physicalSize - physicalUtilisation
  const additionalSpaceNeeded = params.newSize - currentSize

  if (freeSpace < additionalSpaceNeeded) {
    throw new IpcError(
      'SR_SPACE_INSUFFICIENT',
      `SR has ${freeSpace} bytes free, but resize requires ${additionalSpaceNeeded} additional bytes`
    )
  }

  // A running guest needs the published online operation. A detached VBD does not.
  const vbdRefs: string[] = vdiRecord.VBDs || []
  let needsOnlineResize = false
  for (const vbdRef of vbdRefs) {
    const vbd = await client.callWithSession('VBD.get_record', [vbdRef])
    if (vbd.currently_attached !== true || isNullRef(vbd.VM)) continue
    const vmRecord = await client.callWithSession('VM.get_record', [vbd.VM])
    if (vmRecord.power_state === 'Running') needsOnlineResize = true
  }

  if (needsOnlineResize && !allowedOperations.includes('resize_online')) {
    throw new IpcError('VM_ONLINE_RESIZE_NOT_SUPPORTED', 'The running VM does not support online VDI resize')
  }
  const operation = needsOnlineResize
    ? 'resize_online'
    : allowedOperations.includes('resize') ? 'resize' : allowedOperations.includes('resize_online') ? 'resize_online' : null
  if (!operation) {
    throw new IpcError('VDI_RESIZE_NOT_ALLOWED', 'XAPI does not allow resizing this VDI')
  }

  const taskRef: string = await client.callWithSession(`Async.VDI.${operation}`, [
    params.vdiRef,
    String(params.newSize),
  ])

  return taskRef
}

/**
 * Create a new VDI and attach it to a VM via VBD.
 * If the VM is running, the service tries to hot-plug the new VBD.
 */
export async function createVdiForVm(
  connectionId: string,
  params: VdiCreateParams,
  vmRef: string
): Promise<VdiCreateForVmResult> {
  const client = getClient(connectionId)

  // Check SR space
  const srRecord = await client.callWithSession('SR.get_record', [params.srRef])
  if (['iso', 'udev'].includes(srRecord.type) || srRecord.content_type === 'iso') throw new IpcError('SR_NOT_AVAILABLE', '所选存储仓库不能创建虚拟磁盘')
  const physicalSize = Number(srRecord.physical_size) || 0
  const physicalUtilisation = Number(srRecord.physical_utilisation) || 0
  const freeSpace = physicalSize - physicalUtilisation

  if (freeSpace < params.size) {
    throw new IpcError(
      'SR_SPACE_INSUFFICIENT',
      `SR has ${freeSpace} bytes free, but requested VDI size is ${params.size} bytes`
    )
  }

  // Check if SR is available
  const pbdRefs: string[] = srRecord.PBDs || []
  if (pbdRefs.length === 0) {
    throw new IpcError(
      'SR_NOT_AVAILABLE',
      `SR ${srRecord.name_label} is not attached to any host`
    )
  }

  // Check VM power state
  const vmRecord = await client.callWithSession('VM.get_record', [vmRef])
  const vmRunning = vmRecord.power_state === 'Running'
  if (vmRecord.is_a_template || vmRecord.is_a_snapshot || vmRecord.is_control_domain) throw new IpcError('VM_NOT_AVAILABLE', '只能为普通 VM 新建磁盘')
  const pbds = await Promise.all(pbdRefs.map((ref) => client.callWithSession('PBD.get_record', [ref])))
  const available = pbds.some((pbd) => pbd.currently_attached === true && (!vmRunning || pbd.host === vmRecord.resident_on))
  if (!available) throw new IpcError('SR_NOT_AVAILABLE', vmRunning ? '所选存储仓库未接入 VM 当前运行主机' : '所选存储仓库没有已接入的物理存储连接')
  const device = await chooseVbdDevice(client, vmRef)

  // Create the VDI
  const vdiRef: string = await client.callWithSession('VDI.create', [{
    name_label: params.nameLabel,
    name_description: params.nameDescription,
    SR: params.srRef,
    virtual_size: String(params.size),
    type: params.type || 'user',
    sharable: params.sharable || false,
    read_only: params.readOnly || false,
    other_config: {},
    xenstore_data: {},
    sm_config: {},
    tags: [],
  }])

  // Create VBD to connect VDI to VM
  let vbdRef: string
  try {
    vbdRef = await client.callWithSession('VBD.create', [{
      VM: vmRef,
      VDI: vdiRef,
      userdevice: device,
      bootable: false,
      mode: params.readOnly ? 'RO' : 'RW',
      type: 'Disk',
      unpluggable: true,
      empty: false,
      other_config: { owner: 'true' },
      qos_algorithm_type: '',
      qos_algorithm_params: {},
    }])
  } catch (err: any) {
    // A lost create response can still leave a VBD connected to this new VDI.
    const unknown = ['transport', 'client'].includes(err?.details?.kind)
      || /^(E(CONN|PIPE|TIMEDOUT|HOST|NET)|XAPI_CONTRACT_MISMATCH)/.test(err?.code ?? '')
    let vdi: any
    let matchingVbd: string | undefined
    let resultError = err?.message || String(err)
    try {
      matchingVbd = await readOperationResult(async () => {
        vdi = await client.callWithSession('VDI.get_record', [vdiRef])
        for (const ref of vdi?.VBDs ?? []) {
          const vbd = await client.callWithSession('VBD.get_record', [ref])
          if (vbd.VM === vmRef && vbd.VDI === vdiRef && String(vbd.userdevice) === device) return ref as string
        }
        if (unknown) throw new Error(`服务器尚未返回 VDI ${vdiRef} 与目标 VM 的连接`)
        return undefined
      }, { isCurrent: () => connectionManager.getClient(connectionId) === client })
    } catch (readError: any) { resultError = readError?.message || String(readError) }
    if (matchingVbd) {
      vbdRef = matchingVbd
    } else {
      if (!unknown && connectionManager.getClient(connectionId) === client
        && Array.isArray(vdi?.VBDs) && vdi.VBDs.length === 0 && !hasCurrentOperation(vdi)) {
        try {
          await client.callWithSession('VDI.destroy', [vdiRef])
        } catch {
          throw new IpcError('VDI_CREATED_ATTACH_INCOMPLETE', `磁盘已创建，但连接失败且未能清理。已保留 VDI ${vdiRef}。`, { vdiRef, outcome: 'partial' })
        }
        throw err
      }
      throw new IpcError('VDI_CREATED_ATTACH_INCOMPLETE', `磁盘已创建，但无法获取磁盘连接结果：${resultError}。已保留 VDI ${vdiRef}。`, { vdiRef, outcome: unknown ? 'unknown' : 'partial' })
    }
  }

  // Running VMs get a best-effort hot-plug; halted VMs only need the VBD record.
  if (vmRunning) {
    try {
      await client.callWithSession('VBD.plug', [vbdRef])
    } catch (err: any) {
      let attached: boolean | undefined
      try {
        attached = (await readOperationResult(() => client.callWithSession('VBD.get_record', [vbdRef]),
          { isCurrent: () => connectionManager.getClient(connectionId) === client }))?.currently_attached
      } catch { /* Preserve the created disk and report the result retrieval error below. */ }
      if (attached === true) return { vdiRef, vbdRef, plugged: true }
      return {
        vdiRef,
        vbdRef,
        plugged: false,
        warning: attached === false ? `磁盘已创建但尚未激活：${err?.message || '热插拔失败'}` : `磁盘已创建，但无法获取 VBD ${vbdRef} 的激活结果：${err?.message || String(err)}`,
      }
    }
  }

  return { vdiRef, vbdRef, plugged: vmRunning }
}

/**
 * List VDIs that can be attached to the VM, following XenAdmin's conservative filtering.
 */
export async function listAttachableVdis(
  connectionId: string,
  vmRef: string
): Promise<AttachableVdiRecord[]> {
  const client = getClient(connectionId)
  const poolName = connectionManager.getConnectionInfo(connectionId)?.poolName ?? connectionId
  const vmRecord = await client.callWithSession('VM.get_record', [vmRef])
  const srRecords: Record<string, any> = await client.callWithSession('SR.get_all_records', [])
  const vdiRecords: Record<string, any> = await client.callWithSession('VDI.get_all_records', [])
  const attachedToTargetVm = new Set<string>()

  for (const vbdRef of vmRecord.VBDs ?? []) {
    try {
      const vbd = await client.callWithSession('VBD.get_record', [vbdRef])
      if (!isNullRef(vbd?.VDI)) {
        attachedToTargetVm.add(vbd.VDI)
      }
    } catch {
      // Ignore stale VBD references.
    }
  }

  const result: AttachableVdiRecord[] = []

  for (const [ref, vdi] of Object.entries(vdiRecords)) {
    const srRecord = srRecords[vdi?.SR]
    if (attachedToTargetVm.has(ref) || isExcludedAttachableVdi(vdi, srRecord)) continue
    if (!srRecord || (srRecord.PBDs?.length ?? 1) === 0) continue

    let forceReadOnly = vdi?.read_only === true
    const attachedVmRefs = new Set<string>()
    let activelyUsedRw = false

    for (const vbdRef of vdi?.VBDs ?? []) {
      try {
        const vbd = await client.callWithSession('VBD.get_record', [vbdRef])
        if (!isNullRef(vbd?.VM)) attachedVmRefs.add(vbd.VM)
        if (vbd?.currently_attached === true && vbd?.mode !== 'RO') {
          activelyUsedRw = true
        }
      } catch {
        // Ignore stale VBD references.
      }
    }

    if ((vdi?.VBDs?.length ?? 0) > 0 && vdi?.sharable !== true) {
      if (activelyUsedRw) continue
      forceReadOnly = true
    }

    result.push({
      ref,
      ...vdi,
      connectionId,
      poolName,
      srName: srRecord.name_label || vdi.SR,
      forceReadOnly,
      attachedVmRefs: [...attachedVmRefs],
    } as AttachableVdiRecord)
  }

  return result.sort((a, b) => (a.name_label || a.ref).localeCompare(b.name_label || b.ref))
}

export async function attachExistingVdi(
  connectionId: string,
  payload: VdiAttachPayload
): Promise<VdiAttachResult> {
  const client = getClient(connectionId)
  const candidates = await listAttachableVdis(connectionId, payload.vmRef)
  const candidate = candidates.find((vdi) => vdi.ref === payload.vdiRef)

  if (!candidate) {
    throw new IpcError('VDI_NOT_ATTACHABLE', 'Selected VDI cannot be attached to this VM')
  }

  const vmRecord = await client.callWithSession('VM.get_record', [payload.vmRef])
  if (vmRecord.is_a_snapshot || vmRecord.locked || vmRecord.Locked) {
    throw new IpcError('VM_ATTACH_BLOCKED', 'VM is not currently eligible for disk attach')
  }

  const userdevice = await chooseVbdDevice(client, payload.vmRef, payload.userdevice)
  const readOnly = payload.readOnly === true || candidate.forceReadOnly === true
  const vbdRef: string = await client.callWithSession('VBD.create', [{
    VM: payload.vmRef,
    VDI: payload.vdiRef,
    userdevice,
    bootable: userdevice === '0',
    mode: readOnly ? 'RO' : 'RW',
    type: 'Disk',
    unpluggable: true,
    empty: false,
    other_config: candidate.VBDs?.length ? {} : { owner: 'true' },
    qos_algorithm_type: '',
    qos_algorithm_params: {},
  }])

  if (vmRecord.power_state === 'Running') {
    try {
      await client.callWithSession('VBD.plug', [vbdRef])
      return { vbdRef, plugged: true }
    } catch (err: any) {
      let attached: boolean | undefined
      try { attached = (await client.callWithSession('VBD.get_record', [vbdRef]))?.currently_attached } catch { /* Unknown is reported below. */ }
      if (attached === true) return { vbdRef, plugged: true }
      return {
        vbdRef,
        plugged: false,
        warning: attached === false ? `磁盘连接已创建但尚未激活：${err?.message || '热插拔失败'}` : `磁盘连接已创建，激活结果未知，请刷新核对 VBD ${vbdRef}`,
      }
    }
  }

  return { vbdRef, plugged: false }
}

export async function moveVdi(
  connectionId: string,
  payload: VdiMovePayload
): Promise<VdiMoveResult> {
  const client = getClient(connectionId)
  const vdiRecord = await client.callWithSession('VDI.get_record', [payload.vdiRef])
  const targetSr = await client.callWithSession('SR.get_record', [payload.targetSrRef])

  if (isExcludedAttachableVdi(vdiRecord) || isIsoSrRecord(targetSr)) {
    throw new IpcError('VDI_MOVE_BLOCKED', 'This VDI cannot be moved to the selected SR')
  }
  if (vdiRecord.SR === payload.targetSrRef) {
    throw new IpcError('VDI_MOVE_SAME_SR', 'Selected SR is already the current SR')
  }

  if (hasCurrentOperation(vdiRecord)) {
    throw new IpcError('VDI_BUSY', 'This VDI has an operation in progress')
  }
  if (!Array.isArray(targetSr.PBDs) || targetSr.PBDs.length === 0) {
    throw new IpcError('TARGET_SR_NOT_ATTACHED', 'The target SR is not attached to a host')
  }

  // XAPI preserves VBD relationships during pool_migrate. Recreating VBDs
  // can collide on userdevice and leave the source disk in use.
  const taskRef: string = await client.callWithSession('Async.VDI.pool_migrate', [
    payload.vdiRef,
    payload.targetSrRef,
    {},
  ])
  const task = await waitForXapiTask(client, taskRef)
  let newVdiRef: unknown = task.result
  if (typeof newVdiRef === 'string' && newVdiRef.trim().startsWith('<')) {
    try {
      const value = new XMLParser({ trimValues: true }).parse(newVdiRef)?.value
      newVdiRef = typeof value === 'string' ? value : value?.string
    } catch {
      throw taskOutcomeUnknown(taskRef)
    }
  }
  if (typeof newVdiRef !== 'string' || !/^OpaqueRef:[\w.:-]+$/.test(newVdiRef)) {
    throw taskOutcomeUnknown(taskRef)
  }
  try {
    await readOperationResult(async () => {
      const movedVdi = await client.callWithSession('VDI.get_record', [newVdiRef])
      if (movedVdi?.SR !== payload.targetSrRef) throw new Error('移动后的磁盘尚未归属目标存储仓库')
      for (const vbdRef of vdiRecord.VBDs ?? []) {
        const vbd = await client.callWithSession('VBD.get_record', [vbdRef])
        if (vbd?.VDI !== newVdiRef) throw new Error(`磁盘挂载 ${vbdRef} 尚未指向移动后的磁盘`)
      }
    }, { isCurrent: () => connectionManager.getClient(connectionId) === client })
  } catch (error) {
    throw taskOutcomeUnknown(taskRef, error instanceof Error ? error.message : String(error))
  }
  return { newVdiRef }
}

/**
 * Get the allowed VDI operations for a specific VDI/VM combination.
 * Used by the UI to determine which operations to show.
 */
export async function getAllowedVdiOperations(
  connectionId: string,
  vdiRef: string,
  vmRef: string
): Promise<VdiAllowedOperations> {
  const client = getClient(connectionId)

  const result: VdiAllowedOperations = {
    resize: false,
    create: true,
    destroy: false,
    onlineResize: false,
  }

  // XAPI reports capabilities for this particular VDI and SR. Do not infer
  // support from the VM power state: resize_online is version dependent.
  try {
    const vdiRecord = await client.callWithSession('VDI.get_record', [vdiRef])
    const allowedOperations: string[] = Array.isArray(vdiRecord.allowed_operations)
      ? vdiRecord.allowed_operations : []
    const busy = vdiRecord.current_operations &&
      Object.keys(vdiRecord.current_operations).length > 0
    const activeVbds = (vdiRecord.VBDs || []).filter(
      (ref: string) => ref !== 'OpaqueRef:NULL'
    )
    result.destroy = !busy && activeVbds.length === 0 && allowedOperations.includes('destroy')
    result.resize = !busy && allowedOperations.includes('resize')
    result.onlineResize = !busy && allowedOperations.includes('resize_online')
  } catch {
    // Unknown capabilities remain unavailable.
  }

  // Check VM-specific operations
  if (vmRef && vmRef !== 'OpaqueRef:NULL') {
    try {
      const vmRecord = await client.callWithSession('VM.get_record', [vmRef])

      if (vmRecord.power_state === 'Halted') {
        result.onlineResize = false
      } else if (vmRecord.power_state === 'Running') {
        result.resize = result.onlineResize
      } else {
        result.resize = false
        result.onlineResize = false
      }

      // Cannot destroy VDI if VM is running and VDI is attached
      if (vmRecord.power_state === 'Running') {
        result.destroy = false
      }
    } catch {
      result.resize = false
      result.onlineResize = false
      result.destroy = false
    }
  }

  return result
}
