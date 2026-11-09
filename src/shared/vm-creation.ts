import type { VmInstallMode, VmVifPolicy } from './types/xapi'

export const GIB = 1073741824

export function gibToBytes(value: number): number {
  return Math.round(value * GIB)
}

export function isHvmTemplate(template: { HVM_boot_policy?: string; PV_bootloader?: string }): boolean {
  return !!template.HVM_boot_policy
}

export function templateInstallModes(template: {
  HVM_boot_policy?: string
  PV_bootloader?: string
  other_config?: Record<string, string>
}): VmInstallMode[] {
  const methods = (template.other_config?.['install-methods'] ?? '').split(',').map((v) => v.trim().toLowerCase()).filter(Boolean)
  if (isHvmTemplate(template)) return methods.length ? ['iso', 'pxe'] : ['none', 'iso', 'pxe']
  const modes: VmInstallMode[] = []
  if (methods.includes('cdrom')) modes.push('iso')
  if (template.PV_bootloader === 'eliloader' && methods.some((method) => ['http', 'ftp', 'nfs'].includes(method))) modes.push('url')
  return modes.length ? modes : ['none']
}

export function validInstallUrl(value: string, methods?: string): boolean {
  try {
    const url = new URL(value)
    const method = url.protocol === 'https:' ? 'http' : url.protocol.replace(':', '')
    return !!url.hostname && ['http', 'ftp', 'nfs'].includes(method)
      && (!methods || methods.split(',').map((v) => v.trim().toLowerCase()).includes(method))
      && !url.username && !url.password
  } catch { return false }
}

export function creationCoresPerSocket(template: { platform?: Record<string, string> }, vcpus: number): number {
  const cores = Number(template.platform?.['cores-per-socket'])
  return Number.isSafeInteger(cores) && cores > 0 && vcpus % cores === 0 ? cores : 1
}

export function vifPolicy(record: Partial<VmVifPolicy> = {}): VmVifPolicy {
  return {
    MTU: Number(record.MTU) || 1500,
    qos_algorithm_type: record.qos_algorithm_type ?? '',
    qos_algorithm_params: record.qos_algorithm_params ?? {},
    locking_mode: record.locking_mode ?? 'network_default',
    ipv4_allowed: record.ipv4_allowed ?? [],
    ipv6_allowed: record.ipv6_allowed ?? [],
  }
}

export function sameVifPolicy(a: VmVifPolicy, b: VmVifPolicy): boolean {
  const normalize = (policy: VmVifPolicy) => ({ ...policy,
    qos_algorithm_params: Object.fromEntries(Object.entries(policy.qos_algorithm_params).sort(([a], [b]) => a.localeCompare(b))),
    ipv4_allowed: [...policy.ipv4_allowed].sort(), ipv6_allowed: [...policy.ipv6_allowed].sort() })
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b))
}

export function vifPolicyLabel(policy: VmVifPolicy | undefined): string {
  if (!policy) return ''
  const mode = { network_default: '网络默认限制', locked: '地址限制', unlocked: '不限地址', disabled: '禁止通信' }[policy.locking_mode]
  return [`MTU ${policy.MTU}`, policy.qos_algorithm_type ? `QoS ${policy.qos_algorithm_type}${Object.entries(policy.qos_algorithm_params).map(([key, value]) => ` ${key}=${value}`).join('')}` : '', mode,
    policy.ipv4_allowed.length ? `IPv4 ${policy.ipv4_allowed.join(', ')}` : '', policy.ipv6_allowed.length ? `IPv6 ${policy.ipv6_allowed.join(', ')}` : ''].filter(Boolean).join(' · ')
}
