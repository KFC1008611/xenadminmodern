import type { PifRecord } from '../types/xapi'

export const NETWORK_TERMS = {
  physicalNic: 'NIC',
  hostInterface: 'Host Interface',
  hostInterfaceCompact: 'Host Interface',
  virtualNic: 'Virtual Interface',
  bond: 'Bond',
  vlanCarrier: 'Carrier Interface',
} as const

function formatNicDevice(device: string): string {
  const match = /^eth(\d+)$/i.exec(device)
  return match ? `NIC ${match[1]} (${device})` : `NIC ${device || '—'}`
}

export function formatVifLabel(device: string): string {
  return `${NETWORK_TERMS.virtualNic} ${device}`
}

export function formatPhysicalNicLabel(device: string): string {
  return formatNicDevice(device)
}

export function formatHostInterfaceLabel(
  pif: Pick<PifRecord, 'device' | 'isBondMember' | 'isBondMaster' | 'isVlan' | 'isTunnelAccess' | 'isPhysicalNic'>,
): string {
  const role = formatHostInterfaceRole(pif)
  if (role === NETWORK_TERMS.physicalNic) return formatNicDevice(pif.device)
  const kind = role === NETWORK_TERMS.hostInterface ? NETWORK_TERMS.hostInterfaceCompact : role
  return `${kind} ${pif.device || '—'}`
}

export function formatVlanLabel(tag: number | null | undefined): string {
  return tag === null || tag === undefined ? 'VLAN' : `VLAN ${tag}`
}

export function formatBondLabel(devices: string[]): string {
  return devices.length ? `Bond (${devices.join(' + ')})` : 'Bond'
}

export function formatHostInterfaceRole(
  pif: Pick<PifRecord, 'isBondMember' | 'isBondMaster' | 'isVlan' | 'isTunnelAccess' | 'isPhysicalNic'>,
): string {
  if (pif.isBondMaster) return 'Bond Interface'
  if (pif.isVlan) return 'VLAN Interface'
  if (pif.isTunnelAccess) return 'Tunnel Interface'
  if (pif.isPhysicalNic) return NETWORK_TERMS.physicalNic
  return NETWORK_TERMS.hostInterface
}

export function formatHostInterfaceStatuses(
  pif: Pick<PifRecord, 'isBondMember' | 'isPrimaryManagement' | 'isSecondaryManagement' | 'isClusterPif'>,
): string[] {
  const statuses: string[] = []
  if (pif.isBondMember) statuses.push('绑定成员')
  if (pif.isPrimaryManagement) statuses.push('主管理')
  if (pif.isSecondaryManagement) statuses.push('辅助管理')
  if (pif.isClusterPif) statuses.push('Cluster')
  return statuses
}
