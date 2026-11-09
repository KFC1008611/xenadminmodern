/**
 * VM Advanced service — wraps XAPI VM advanced methods for affinity, protection, VCPU hotplug, etc.
 * All functions accept connectionId as the first parameter for multi-connection support.
 * v9: New service for VM advanced features.
 */
import { connectionManager } from '../connection-manager'
import type { VmAdvancedConfig, VmAffinityConfig } from '../../../shared/types/xapi'
import { readOperationResult, ReadScopeChangedError } from '../../../shared/read-operation-result'

function getClient(connectionId: string) {
  const client = connectionManager.getClient(connectionId)
  if (!client) {
    throw new Error(`No connection found for connectionId: ${connectionId}`)
  }
  return client
}

const PROTECTION_REASON = 'XenAdmin Modern: VM deletion protection'

async function submitVmWrite(write: () => Promise<unknown>): Promise<void> {
  try {
    await write()
  } catch (error: any) {
    if (!['transport', 'client'].includes(error?.details?.kind)
      && !/^(E(CONN|PIPE|TIMEDOUT|HOST|NET)|XAPI_CONTRACT_MISMATCH)/.test(error?.code ?? '')) throw error
    // Resolve a lost acknowledgement from the following resource read, never replay the write.
  }
}

async function readVmResult(connectionId: string, client: NonNullable<ReturnType<typeof connectionManager.getClient>>, vmRef: string,
  uuid: string, validate: (record: any) => void | Promise<void>): Promise<void> {
  await readOperationResult(async () => {
    const record = await client.callWithSession('VM.get_record', [vmRef])
    if (!record || typeof record !== 'object') throw new Error('服务器未返回有效 VM 记录')
    if (record?.uuid !== uuid) throw new ReadScopeChangedError()
    await validate(record)
  }, { isCurrent: () => connectionManager.getClient(connectionId) === client })
}

function throwUnsupportedAntiAffinity(): never {
  throw new Error('VM anti-affinity is not supported by this XenAPI VM interface；请通过支持 VM Group 的管理工具配置放置组')
}

async function readAntiAffinity(client: ReturnType<typeof getClient>, vmRef: string, vm: any): Promise<string[]> {
  if (!Array.isArray(vm.groups)) return []
  const members = new Set<string>()
  for (const groupRef of vm.groups) {
    const group = await client.callWithSession('VM_group.get_record', [groupRef])
    if (!group || !Array.isArray(group.VMs)) throw new Error('服务器未返回有效 VM Group 成员')
    if (group.placement === 'anti_affinity') for (const ref of group.VMs) if (ref !== vmRef) members.add(ref)
  }
  return [...members]
}

// ============================================================================
// VM Advanced Configuration
// ============================================================================

/**
 * Get advanced VM configuration.
 */
export async function getVmAdvancedConfig(
  connectionId: string,
  vmRef: string
): Promise<VmAdvancedConfig> {
  const client = getClient(connectionId)

  const vmRecord = await client.callWithSession('VM.get_record', [vmRef])

  return {
    vmRef,
    vmName: vmRecord.name_label,
    affinity: vmRecord.affinity === 'OpaqueRef:NULL' ? null : vmRecord.affinity || null,
    antiAffinity: await readAntiAffinity(client, vmRef, vmRecord),
    antiAffinitySupported: Array.isArray(vmRecord.groups),
    isProtected: Object.prototype.hasOwnProperty.call(vmRecord.blocked_operations ?? {}, 'destroy'),
    vcpusHotplug: Number(vmRecord.VCPUs_at_startup) < Number(vmRecord.VCPUs_max),
    startDelay: parseInt(vmRecord.start_delay || '0', 10),
    bootOrder: vmRecord.HVM_boot_params?.order || '',
    hvmBootParams: vmRecord.HVM_boot_params || {},
    otherConfig: vmRecord.other_config || {},
    platform: vmRecord.platform || {},
  }
}

// ============================================================================
// VM Affinity (Host affinity)
// ============================================================================

/**
 * Set VM affinity to a specific host.
 */
export async function setVmAffinity(
  connectionId: string,
  vmRef: string,
  hostRef: string | null
): Promise<void> {
  const client = getClient(connectionId)
  const scope = connectionManager.getConnectionInfo?.(connectionId)
  const current = () => connectionManager.getClient(connectionId) === client
    && connectionManager.getConnectionInfo?.(connectionId)?.poolUuid === scope?.poolUuid
    && connectionManager.getConnectionInfo?.(connectionId)?.epoch === scope?.epoch
  const vm = await client.callWithSession('VM.get_record', [vmRef])
  if (!vm || typeof vm.uuid !== 'string' || !vm.uuid) throw new Error('无法读取虚拟机身份，请重新读取后再保存')
  if (vm.is_control_domain || vm.is_a_template || vm.is_a_snapshot) throw new Error('只能设置普通 VM 的亲和主机')
  if (hostRef) await client.callWithSession('host.get_record', [hostRef])
  if (!current()) throw new ReadScopeChangedError()
  await submitVmWrite(() => client.callWithSession('VM.set_affinity', [vmRef, hostRef || 'OpaqueRef:NULL']))
  await readVmResult(connectionId, client, vmRef, vm.uuid, (actual) => {
    if (!current()) throw new ReadScopeChangedError()
    if ((actual.affinity || 'OpaqueRef:NULL') !== (hostRef || 'OpaqueRef:NULL')) throw new Error('亲和主机未保存')
  })
}

/**
 * Get VM affinity configuration.
 */
export async function getVmAffinity(
  connectionId: string,
  vmRef: string
): Promise<VmAffinityConfig> {
  const client = getClient(connectionId)

  const vmRecord = await client.callWithSession('VM.get_record', [vmRef])

  return {
    vmRef,
    hostRef: vmRecord.affinity === 'OpaqueRef:NULL' ? null : vmRecord.affinity || null,
    antiAffinityRefs: await readAntiAffinity(client, vmRef, vmRecord),
  }
}

// ============================================================================
// VM Anti-Affinity
// ============================================================================

/**
 * Set VM anti-affinity (VMs that should not run on same host).
 */
export async function setVmAntiAffinity(
  connectionId: string,
  vmRef: string,
  vmRefs: string[]
): Promise<void> {
  void connectionId
  void vmRef
  void vmRefs
  throwUnsupportedAntiAffinity()
}

/**
 * Add VM to anti-affinity group.
 */
export async function addVmAntiAffinity(
  connectionId: string,
  vmRef: string,
  antiAffinityVmRef: string
): Promise<void> {
  void connectionId
  void vmRef
  void antiAffinityVmRef
  throwUnsupportedAntiAffinity()
}

/**
 * Remove VM from anti-affinity group.
 */
export async function removeVmAntiAffinity(
  connectionId: string,
  vmRef: string,
  antiAffinityVmRef: string
): Promise<void> {
  void connectionId
  void vmRef
  void antiAffinityVmRef
  throwUnsupportedAntiAffinity()
}

// ============================================================================
// VM Protection
// ============================================================================

/**
 * Enable server-enforced VM deletion protection without changing HA policy.
 */
export async function enableVmProtection(
  connectionId: string,
  vmRef: string
): Promise<void> {
  const client = getClient(connectionId)
  const record = await client.callWithSession('VM.get_record', [vmRef])
  if (record.is_control_domain || record.is_a_template || record.is_a_snapshot) throw new Error('只能保护普通 VM')
  if (Object.prototype.hasOwnProperty.call(record.blocked_operations ?? {}, 'destroy')) return
  await submitVmWrite(() => client.callWithSession('VM.add_to_blocked_operations', [vmRef, 'destroy', PROTECTION_REASON]))
  await readVmResult(connectionId, client, vmRef, record.uuid, (updated) => {
    if (!Object.prototype.hasOwnProperty.call(updated.blocked_operations ?? {}, 'destroy')) throw new Error('服务器尚未启用删除保护')
  })
}

/**
 * Disable VM protection.
 */
export async function disableVmProtection(
  connectionId: string,
  vmRef: string
): Promise<void> {
  const client = getClient(connectionId)
  const record = await client.callWithSession('VM.get_record', [vmRef])
  const reason = record.blocked_operations?.destroy
  if (reason === undefined) return
  if (reason !== PROTECTION_REASON) throw new Error('删除保护由其他工具或管理员设置，请在原设置来源解除')
  await submitVmWrite(() => client.callWithSession('VM.remove_from_blocked_operations', [vmRef, 'destroy']))
  await readVmResult(connectionId, client, vmRef, record.uuid, (updated) => {
    if (Object.prototype.hasOwnProperty.call(updated.blocked_operations ?? {}, 'destroy')) throw new Error('服务器仍保留删除保护')
  })
}

// ============================================================================
// VCPU Hotplug
// ============================================================================

/**
 * Set maximum VCPUs (enables hotplug if max > startup).
 */
export async function setVmVcpuHotplug(
  connectionId: string,
  vmRef: string,
  maxVcpus: number
): Promise<void> {
  const client = getClient(connectionId)
  if (!Number.isInteger(maxVcpus) || maxVcpus < 1) throw new Error('最大 VCPU 数必须为正整数')
  const vmRecord = await client.callWithSession('VM.get_record', [vmRef])

  // VM must be halted to change VCPUs_max
  if (vmRecord.power_state !== 'Halted') {
    throw new Error('VM必须处于关闭状态才能更改最大VCPU数')
  }

  if (!Number.isInteger(Number(vmRecord.VCPUs_at_startup)) || Number(vmRecord.VCPUs_at_startup) < 1 || maxVcpus < Number(vmRecord.VCPUs_at_startup)) {
    throw new Error('最大 VCPU 数不能低于已确认的启动数量')
  }
  await submitVmWrite(() => client.callWithSession('VM.set_VCPUs_max', [vmRef, maxVcpus]))
  await readVmResult(connectionId, client, vmRef, vmRecord.uuid, (updated) => {
    if (Number(updated.VCPUs_max) !== maxVcpus) throw new Error(`最大 VCPU 数仍为 ${updated.VCPUs_max}，未达到 ${maxVcpus}`)
  })
}

/**
 * Set current VCPUs (runtime change if hotplug enabled).
 */
export async function setVmVcpusNumber(
  connectionId: string,
  vmRef: string,
  vcpus: number
): Promise<void> {
  const client = getClient(connectionId)
  if (!Number.isInteger(vcpus) || vcpus < 1) throw new Error('VCPU 数量必须为正整数')
  const vmRecord = await client.callWithSession('VM.get_record', [vmRef])
  if (!Number.isInteger(Number(vmRecord.VCPUs_max)) || vcpus > Number(vmRecord.VCPUs_max)) throw new Error('VCPU 数量不能超过已确认的最大数量')
  if (vmRecord.power_state === 'Running') {
    await submitVmWrite(() => client.callWithSession('VM.set_VCPUs_number_live', [vmRef, vcpus]))
    await readVmResult(connectionId, client, vmRef, vmRecord.uuid, async (updated) => {
      if (!updated.metrics || updated.metrics === 'OpaqueRef:NULL') throw new Error('无法获取运行 VCPU 指标')
      const metrics = await client.callWithSession('VM_metrics.get_record', [updated.metrics])
      if (Number(metrics.VCPUs_number) !== vcpus) throw new Error(`运行 VCPU 数仍为 ${metrics.VCPUs_number}，未达到 ${vcpus}`)
    })
  } else if (vmRecord.power_state === 'Halted') {
    await submitVmWrite(() => client.callWithSession('VM.set_VCPUs_at_startup', [vmRef, vcpus]))
    await readVmResult(connectionId, client, vmRef, vmRecord.uuid, (updated) => {
      if (Number(updated.VCPUs_at_startup) !== vcpus) throw new Error(`启动 VCPU 数仍为 ${updated.VCPUs_at_startup}，未达到 ${vcpus}`)
    })
  } else {
    throw new Error('当前 VM 电源状态不支持修改 VCPU 数量')
  }
}

// ============================================================================
// VM Start Delay
// ============================================================================

/**
 * Set VM start delay (for boot storms prevention).
 */
export async function setVmStartDelay(
  connectionId: string,
  vmRef: string,
  delaySeconds: number
): Promise<void> {
  const client = getClient(connectionId)
  await client.callWithSession('VM.set_start_delay', [vmRef, delaySeconds])
}

// ============================================================================
// VM Boot Order
// ============================================================================

/**
 * Set VM boot order (c=hard disk, d=CD-ROM, n=network).
 */
export async function setVmBootOrder(
  connectionId: string,
  vmRef: string,
  order: string // e.g., 'cdn', 'dc', 'n'
): Promise<void> {
  const client = getClient(connectionId)
  const vmRecord = await client.callWithSession('VM.get_record', [vmRef])

  // VM must be halted to change boot order
  if (vmRecord.power_state !== 'Halted') {
    throw new Error('VM必须处于关闭状态才能更改启动顺序')
  }

  await client.callWithSession('VM.set_HVM_boot_params', [
    vmRef, { ...(vmRecord.HVM_boot_params ?? {}), order },
  ])
}

/**
 * Set HVM boot parameters.
 */
export async function setVmHvmBootParams(
  connectionId: string,
  vmRef: string,
  params: Record<string, string>
): Promise<void> {
  const client = getClient(connectionId)
  const vmRecord = await client.callWithSession('VM.get_record', [vmRef])
  await client.callWithSession('VM.set_HVM_boot_params', [
    vmRef, { ...(vmRecord.HVM_boot_params ?? {}), ...params },
  ])
}

// ============================================================================
// VM Platform Settings
// ============================================================================

/**
 * Set VM platform parameter (e.g., viridian, acpi, apic).
 */
export async function setVmPlatformParam(
  connectionId: string,
  vmRef: string,
  key: string,
  value: string
): Promise<void> {
  const client = getClient(connectionId)
  const vmRecord = await client.callWithSession('VM.get_record', [vmRef])
  await client.callWithSession('VM.set_platform', [
    vmRef, { ...(vmRecord.platform ?? {}), [key]: value },
  ])
}

/**
 * Enable/disable Viridian (Hyper-V compatibility).
 */
export async function setVmViridian(
  connectionId: string,
  vmRef: string,
  enabled: boolean
): Promise<void> {
  await setVmPlatformParam(connectionId, vmRef, 'viridian', enabled ? 'true' : 'false')
}

// ============================================================================
// VM Other Config
// ============================================================================

/**
 * Set VM other config parameter.
 */
export async function setVmOtherConfig(
  connectionId: string,
  vmRef: string,
  key: string,
  value: string
): Promise<void> {
  const client = getClient(connectionId)
  const vmRecord = await client.callWithSession('VM.get_record', [vmRef])
  const otherConfig = vmRecord.other_config || {}
  otherConfig[key] = value
  await client.callWithSession('VM.set_other_config', [vmRef, otherConfig])
}

/**
 * Add VM tag.
 */
export async function addVmTag(
  connectionId: string,
  vmRef: string,
  tag: string
): Promise<void> {
  const client = getClient(connectionId)
  const vmRecord = await client.callWithSession('VM.get_record', [vmRef])
  const tags = vmRecord.tags || []

  if (!tags.includes(tag)) {
    await client.callWithSession('VM.set_tags', [vmRef, [...tags, tag]])
  }
}

/**
 * Remove VM tag.
 */
export async function removeVmTag(
  connectionId: string,
  vmRef: string,
  tag: string
): Promise<void> {
  const client = getClient(connectionId)
  const vmRecord = await client.callWithSession('VM.get_record', [vmRef])
  const tags = vmRecord.tags || []
  await client.callWithSession('VM.set_tags', [vmRef, tags.filter((t: string) => t !== tag)])
}

// ============================================================================
// Batch VM Operations
// ============================================================================

/**
 * Get VM advanced configuration for all VMs.
 */
export async function getAllVmAdvancedConfigs(
  connectionId: string
): Promise<VmAdvancedConfig[]> {
  const client = getClient(connectionId)

  const vmRefs: string[] = await client.callWithSession('VM.get_all', [])
  const configs: VmAdvancedConfig[] = []

  for (const vmRef of vmRefs) {
    try {
      const config = await getVmAdvancedConfig(connectionId, vmRef)
      configs.push(config)
    } catch (err) {
      console.warn(`[vm-advanced.service] Failed to get config for VM ${vmRef}:`, err)
    }
  }

  return configs
}

/**
 * Set pool-wide VM start order and delays.
 */
export async function setPoolVmStartOrder(
  connectionId: string,
  vmStartConfigs: Array<{ vmRef: string; startDelay: number; order: number }>
): Promise<void> {
  // Set start delay for each VM
  for (const config of vmStartConfigs) {
    await setVmStartDelay(connectionId, config.vmRef, config.startDelay)
  }
}
