import type { NetworkRecord, VIFRecord } from '../types/xapi'
import { formatVlanLabel } from './networkTerminology'

export interface GuestIpAddress {
  device: string
  family: 'IPv4' | 'IPv6'
  address: string
}

/** Guest Tools report VIF device numbers in VM_guest_metrics.networks keys. */
export function getGuestIpAddresses(networks: Record<string, string>): GuestIpAddress[] {
  const addresses: GuestIpAddress[] = []
  const seen = new Set<string>()

  for (const [key, value] of Object.entries(networks)) {
    const match = /^(\d+)\/(ip|ipv4\/\d+|ipv6\/\d+)$/.exec(key)
    if (!match) continue

    const device = match[1]
    const family = match[2].startsWith('ipv6/') ? 'IPv6' : 'IPv4'
    // Older guest agents can put several space-separated addresses in one field.
    for (const address of value.trim().split(/\s+/).filter(Boolean)) {
      const identity = `${device}\0${family}\0${address}`
      if (seen.has(identity)) continue
      seen.add(identity)
      addresses.push({ device, family, address })
    }
  }

  return addresses
}

const DEFAULT_DEVICE_PATTERN = /^(?:Pool-wide network|Network) associated with (.+)$/i
const VLAN_NAME_PATTERN = /^vlan[\s_-]*(\d+)$/i

function fallbackRef(ref?: string): string {
  if (!ref) return '—'
  return ref.replace('OpaqueRef:', '').substring(0, 8)
}

function defaultDeviceName(name: string): string | null {
  const match = name.match(DEFAULT_DEVICE_PATTERN)
  return match?.[1]?.trim() || null
}

function defaultNetworkLabel(device: string): string {
  const ethernet = /^eth(\d+)$/i.exec(device)
  return `Network ${ethernet?.[1] ?? device}`
}

/** XenAdmin's default network names are derived from the attached device, not custom names. */
export function formatRawNetworkName(name: string): string {
  const device = defaultDeviceName(name)
  if (!device) return name
  return defaultNetworkLabel(device)
}

export function isNameOnlyVlanNetwork(network: NetworkRecord): boolean {
  const pifCount = Math.max(network.pifRefs?.length ?? 0, network.PIFs?.length ?? 0)
  return !network.isVlan && network.kind !== 'vlan' && pifCount === 0 && VLAN_NAME_PATTERN.test(network.name_label || '')
}

export function formatNetworkName(network: NetworkRecord): string {
  const rawName = network.name_label || ''
  const defaultDevice = defaultDeviceName(rawName)
  const hasPif = Math.max(network.pifRefs?.length ?? 0, network.PIFs?.length ?? 0) > 0
  const name = defaultDevice
    ? defaultNetworkLabel(hasPif && network.device ? network.device : defaultDevice)
    : rawName
  if (defaultDevice && (network.kind === 'vlan' || network.isVlan)) {
    return network.vlan === null || network.vlan === undefined ? name : `${name} · ${formatVlanLabel(network.vlan)}`
  }
  return name || (network.ref ? `Network ${fallbackRef(network.ref)}` : 'Unnamed Network')
}

export function formatNetworkTypeLabel(network: NetworkRecord): string {
  if (network.kind === 'external') return '外部网络'
  if (network.kind === 'bond' || network.isBond) return '绑定网络'
  if (network.kind === 'vlan' || network.isVlan) return 'VLAN 网络'
  if (network.kind === 'tunnel' || network.isTunnel) return '隧道网络'
  if (network.kind === 'sriov' || network.isSriov) return 'SR-IOV 网络'
  return '内部网络'
}

export const NAME_ONLY_VLAN_WARNING = '名称像 VLAN，未配置 VLAN 接口'

export function formatNetworkAttachment(network: NetworkRecord): string {
  if (network.isVlan || network.kind === 'vlan') {
    const vlan = formatVlanLabel(network.vlan)
    return network.device ? `Host Interface ${network.device} · ${vlan}` : vlan
  }
  if (isNameOnlyVlanNetwork(network)) {
    return NAME_ONLY_VLAN_WARNING
  }
  if (network.device) return `Host Interface ${network.device}`
  return '—'
}

export function formatNetworkOptionLabel(network: NetworkRecord): string {
  const name = formatNetworkName(network)
  const type = formatNetworkTypeLabel(network)
  const attachment = formatNetworkAttachment(network)
  if (attachment === name || attachment === '—') return `${name} (${type})`
  return `${name} (${type}, ${attachment})`
}

export function formatVifNetworkName(vif: VIFRecord, networks: NetworkRecord[]): string {
  const network = networks.find((item) => item.ref === vif.network)
  if (network) return formatNetworkName(network)
  return formatRawNetworkName(vif.networkName || '') || `Network ${fallbackRef(vif.network)}`
}
