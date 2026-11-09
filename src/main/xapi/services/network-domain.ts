export type LinkState = 'connected' | 'disconnected' | 'unknown'
export type NetworkKind = 'internal' | 'external' | 'bond' | 'vlan' | 'tunnel' | 'sriov'

export interface PifMetricsRecord {
  ref: string
  uuid?: string
  carrier?: boolean
  speed?: number
  duplex?: boolean
  vendor_name?: string
  device_name?: string
  pci_bus_path?: string
}

export interface NormalizedPifRecord {
  ref: string
  uuid: string
  device: string
  host: string
  network: string
  IP: string
  MAC: string
  MTU: number
  speed: number
  duplex: boolean | null
  vlan: number
  physical: boolean
  managed: boolean
  management: boolean
  currently_attached: boolean
  ip_configuration_mode: string
  netmask: string
  gateway: string
  DNS: string
  metrics: string
  bond_master_of: string[]
  bond_slave_of: string
  VLAN_master_of: string
  tunnel_access_PIF_of: string[]
  tunnel_transport_PIF_of: string[]
  sriov_logical_PIF_of: string[]
  sriov_physical_PIF_of: string[]
  other_config: Record<string, string>
  disallow_unplug: boolean
  carrier: boolean | null
  linkState: LinkState
  isPhysicalNic: boolean
  isBondMaster: boolean
  isBondMember: boolean
  isVlan: boolean
  isPrimaryManagement: boolean
  isSecondaryManagement: boolean
  isManagementInterface: boolean
  isHidden: boolean
  isTunnelAccess: boolean
  isTunnelTransport: boolean
  isSriovLogical: boolean
  isSriovPhysical: boolean
  isClusterPif: boolean
  isBondCandidate: boolean
  isVlanCandidate: boolean
  connectionId?: string
  poolName?: string
}

export interface NormalizedNetworkRecord {
  ref: string
  uuid: string
  name_label: string
  name_description: string
  bridge: string
  VIFs: string[]
  PIFs: string[]
  MTU: number
  other_config: Record<string, string>
  tags: string[]
  managed: boolean
  kind: NetworkKind
  linkState: LinkState
  linkStatus: 'connected' | 'disconnected' | 'partial' | 'unknown' | 'none'
  vlan: number | null
  device: string | null
  pifRefs: string[]
  isHidden: boolean
  isGuestInstallerNetwork: boolean
  isBond: boolean
  isBondMember: boolean
  isVlan: boolean
  isSriov: boolean
  isTunnel: boolean
  canUseJumboFrames: boolean
  visible: boolean
  allowedActions: {
    rename: boolean
    destroy: boolean
  }
  connectionId?: string
  poolName?: string
}

export interface NormalizedBondRecord {
  ref: string
  uuid: string
  master: string
  slaves: string[]
  mode: string
  properties: Record<string, string>
  other_config: Record<string, string>
  links_up: number
  network: string
  devices: string[]
  masterDevice: string | null
  hasManagement: boolean
  hasPrimaryManagement: boolean
  hasSecondaryManagement: boolean
  hasClusterPif: boolean
  connectionId?: string
  poolName?: string
}

export interface NormalizedVlanRecord {
  ref: string
  uuid: string
  tag: number
  tagged_PIF: string
  untagged_PIF: string
  network: string
  taggedDevice: string | null
  host: string | null
  connectionId?: string
  poolName?: string
}

export interface NetworkTopology {
  pifs: NormalizedPifRecord[]
  networks: NormalizedNetworkRecord[]
  bonds: NormalizedBondRecord[]
  vlans: NormalizedVlanRecord[]
  clusterStatusKnown: boolean
}

function refList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter(isRealRef)
  if (isRealRef(value)) return [String(value)]
  return []
}

function refValue(value: unknown): string {
  return isRealRef(value) ? String(value) : ''
}

function isRealRef(value: unknown): boolean {
  return typeof value === 'string' && value.length > 0 && value !== 'OpaqueRef:NULL'
}

function boolKey(map: Record<string, string> | undefined, key: string): boolean {
  return String(map?.[key] ?? '').toLowerCase() === 'true'
}

function numberValue(value: unknown, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function getNetworkRecord(networkRecords: Record<string, any>, ref: string): any {
  return networkRecords[ref] || {}
}

function isGuestInstallerNetwork(record: any): boolean {
  return boolKey(record?.other_config, 'is_guest_installer_network')
}

function isRawNetworkHidden(record: any): boolean {
  return record?.managed === false || boolKey(record?.other_config, 'HideFromXenCenter')
}

function networkShowsForManagement(record: any): boolean {
  return !isGuestInstallerNetwork(record) && !isRawNetworkHidden(record)
}

function linkFromTunnel(record: any): LinkState {
  if (record?.status?.active === 'true') return 'connected'
  if (record?.status?.active === 'false') return 'disconnected'
  return 'unknown'
}

function aggregateLinkState(states: LinkState[]): NormalizedNetworkRecord['linkStatus'] {
  if (states.length === 0) return 'none'
  const connected = states.includes('connected')
  const disconnected = states.includes('disconnected')
  const unknown = states.includes('unknown')
  if (connected && (disconnected || unknown)) return 'partial'
  if (connected) return 'connected'
  if (disconnected && unknown) return 'unknown'
  if (disconnected) return 'disconnected'
  return 'unknown'
}

function networkKindForPifs(pifs: NormalizedPifRecord[]): NetworkKind {
  if (pifs.some((p) => p.isTunnelAccess)) return 'tunnel'
  if (pifs.some((p) => p.isBondMaster)) return 'bond'
  if (pifs.some((p) => p.isVlan)) return 'vlan'
  if (pifs.some((p) => p.isSriovLogical || p.isSriovPhysical)) return 'sriov'
  if (pifs.some((p) => p.isPhysicalNic)) return 'external'
  return 'internal'
}

export function normalizePifs(input: {
  pifRecords: Record<string, any>
  networkRecords: Record<string, any>
  metricsRecords?: Record<string, any>
  tunnelRecords?: Record<string, any>
  clusterPifRefs?: Set<string>
}): NormalizedPifRecord[] {
  const metricsRecords = input.metricsRecords || {}
  const tunnelRecords = input.tunnelRecords || {}
  const clusterPifRefs = input.clusterPifRefs || new Set<string>()

  return Object.entries(input.pifRecords).map(([ref, record]) => {
    const network = getNetworkRecord(input.networkRecords, record.network)
    const vlan = numberValue(record.vlan ?? record.VLAN, -1)
    const metricsRef = refValue(record.metrics)
    const metrics = metricsRef ? metricsRecords[metricsRef] : null
    const tunnelAccessRefs = refList(record.tunnel_access_PIF_of)
    const tunnelTransportRefs = refList(record.tunnel_transport_PIF_of)
    const isTunnelAccess = tunnelAccessRefs.length > 0
    const isTunnelTransport = tunnelTransportRefs.length > 0
    const isSriovLogical = refList(record.sriov_logical_PIF_of).length > 0
    const isSriovPhysical = refList(record.sriov_physical_PIF_of).length > 0
    const isBondMaster = refList(record.bond_master_of).length > 0
    const isBondMember = isRealRef(record.bond_slave_of)
    const physical = Boolean(record.physical)
    const managed = record.managed !== false
    const isPhysicalNic = vlan === -1 && !isTunnelAccess && !isSriovLogical && physical
    const ipMode = String(record.ip_configuration_mode ?? 'None')
    const isPrimaryManagement = Boolean(record.management) && !isGuestInstallerNetwork(network)
    const hasIpConfiguration = ipMode !== 'None' && ipMode !== 'unknown' && ipMode !== ''
    const isSecondaryManagement = !record.management && hasIpConfiguration && networkShowsForManagement(network)
    const hidden = !managed || boolKey(record.other_config, 'HideFromXenCenter') || isRawNetworkHidden(network) || isGuestInstallerNetwork(network)
    const tunnel = Object.values(tunnelRecords).find((t: any) => t.access_PIF === ref)

    let carrier: boolean | null = null
    let linkState: LinkState = 'unknown'
    if (isTunnelAccess) {
      linkState = linkFromTunnel(tunnel)
      carrier = linkState === 'unknown' ? null : linkState === 'connected'
    } else if (typeof metrics?.carrier === 'boolean') {
      carrier = metrics.carrier
      linkState = carrier ? 'connected' : 'disconnected'
    }

    return {
      ref,
      uuid: String(record.uuid ?? ''),
      device: String(record.device ?? ''),
      host: refValue(record.host),
      network: refValue(record.network),
      IP: String(record.IP ?? ''),
      MAC: String(record.MAC ?? ''),
      MTU: numberValue(record.MTU, 1500),
      speed: numberValue(metrics?.speed ?? record.speed, 0),
      duplex: typeof metrics?.duplex === 'boolean'
        ? metrics.duplex
        : typeof record.duplex === 'boolean'
          ? record.duplex
          : null,
      vlan,
      physical,
      managed,
      management: Boolean(record.management),
      currently_attached: Boolean(record.currently_attached),
      ip_configuration_mode: ipMode,
      netmask: String(record.netmask ?? ''),
      gateway: String(record.gateway ?? ''),
      DNS: String(record.DNS ?? ''),
      metrics: metricsRef,
      bond_master_of: refList(record.bond_master_of),
      bond_slave_of: refValue(record.bond_slave_of),
      VLAN_master_of: refValue(record.VLAN_master_of),
      tunnel_access_PIF_of: tunnelAccessRefs,
      tunnel_transport_PIF_of: tunnelTransportRefs,
      sriov_logical_PIF_of: refList(record.sriov_logical_PIF_of),
      sriov_physical_PIF_of: refList(record.sriov_physical_PIF_of),
      other_config: record.other_config || {},
      disallow_unplug: Boolean(record.disallow_unplug),
      carrier,
      linkState,
      isPhysicalNic,
      isBondMaster,
      isBondMember,
      isVlan: vlan >= 0,
      isPrimaryManagement,
      isSecondaryManagement,
      isManagementInterface: isPrimaryManagement || isSecondaryManagement,
      isHidden: hidden,
      isTunnelAccess,
      isTunnelTransport,
      isSriovLogical,
      isSriovPhysical,
      isClusterPif: clusterPifRefs.has(ref),
      isBondCandidate: isPhysicalNic && !isBondMaster && !isBondMember && !hidden,
      isVlanCandidate: (isPhysicalNic || isBondMaster) && !isBondMember && !isTunnelAccess && !hidden,
    }
  }).sort((a, b) => a.device.localeCompare(b.device) || a.host.localeCompare(b.host))
}

export function normalizeNetworks(input: {
  networkRecords: Record<string, any>
  pifs: NormalizedPifRecord[]
}): NormalizedNetworkRecord[] {
  return Object.entries(input.networkRecords).map(([ref, record]) => {
    const pifs = input.pifs.filter((p) => p.network === ref)
    const guestInstaller = isGuestInstallerNetwork(record)
    const hidden = isRawNetworkHidden(record)
    const isBondMember = pifs.some((p) => p.isBondMember)
    const isBond = pifs.some((p) => p.isBondMaster)
    const isVlan = pifs.some((p) => p.isVlan)
    const isTunnel = pifs.some((p) => p.isTunnelAccess)
    const isSriov = pifs.some((p) => p.isSriovLogical || p.isSriovPhysical)
    const linkStatus = aggregateLinkState(pifs.map((p) => p.linkState))
    const linkState: LinkState = linkStatus === 'connected'
      ? 'connected'
      : linkStatus === 'disconnected'
        ? 'disconnected'
        : 'unknown'
    const kind = networkKindForPifs(pifs)
    const physicalNonBondNic = pifs.some((p) => p.isPhysicalNic && !p.isBondMaster)
    const createInProgress = boolKey(record.other_config, 'XenCenterCreateInProgress')
    const visible = !guestInstaller && !hidden && !isBondMember && pifs.every((p) => !p.isHidden)
    const firstPif = pifs[0]
    const firstVlanPif = pifs.find((p) => p.isVlan)

    return {
      ref,
      uuid: String(record.uuid ?? ''),
      name_label: String(record.name_label ?? ''),
      name_description: String(record.name_description ?? ''),
      bridge: String(record.bridge ?? ''),
      VIFs: refList(record.VIFs),
      PIFs: refList(record.PIFs),
      MTU: numberValue(record.MTU, 1500),
      other_config: record.other_config || {},
      tags: Array.isArray(record.tags) ? record.tags : [],
      managed: record.managed !== false,
      kind,
      linkState,
      linkStatus,
      vlan: firstVlanPif ? firstVlanPif.vlan : null,
      device: firstPif?.device || null,
      pifRefs: pifs.map((p) => p.ref),
      isHidden: hidden,
      isGuestInstallerNetwork: guestInstaller,
      isBond,
      isBondMember,
      isVlan,
      isSriov,
      isTunnel,
      canUseJumboFrames: !isTunnel,
      visible,
      allowedActions: {
        rename: !isBondMember && !createInProgress && !guestInstaller,
        destroy: !isBondMember && !createInProgress && !guestInstaller && !physicalNonBondNic
          && refList(record.VIFs).length === 0 && refList(record.PIFs).length === 0,
      },
    }
  }).sort((a, b) => a.name_label.localeCompare(b.name_label))
}

export function normalizeBonds(input: {
  bondRecords: Record<string, any>
  pifs: NormalizedPifRecord[]
}): NormalizedBondRecord[] {
  const pifByRef = new Map(input.pifs.map((p) => [p.ref, p]))
  return Object.entries(input.bondRecords).map(([ref, record]) => {
    const master = pifByRef.get(refValue(record.master))
    const slaves = refList(record.slaves)
    const slavePifs = slaves.map((slaveRef) => pifByRef.get(slaveRef)).filter(Boolean) as NormalizedPifRecord[]
    const relatedPifs = [master, ...slavePifs].filter(Boolean) as NormalizedPifRecord[]
    return {
      ref,
      uuid: String(record.uuid ?? ''),
      master: refValue(record.master),
      slaves,
      mode: String(record.mode ?? ''),
      properties: record.properties || {},
      other_config: record.other_config || {},
      links_up: numberValue(record.links_up, 0),
      network: master?.network || '',
      devices: slavePifs.map((p) => p.device).sort(),
      masterDevice: master?.device || null,
      hasManagement: relatedPifs.some((p) => p.isManagementInterface),
      hasPrimaryManagement: relatedPifs.some((p) => p.isPrimaryManagement),
      hasSecondaryManagement: relatedPifs.some((p) => p.isSecondaryManagement),
      hasClusterPif: relatedPifs.some((p) => p.isClusterPif),
    }
  }).sort((a, b) => a.devices.join('+').localeCompare(b.devices.join('+')) || a.ref.localeCompare(b.ref))
}

export function normalizeVlans(input: {
  vlanRecords: Record<string, any>
  pifs: NormalizedPifRecord[]
}): NormalizedVlanRecord[] {
  const pifByRef = new Map(input.pifs.map((p) => [p.ref, p]))
  return Object.entries(input.vlanRecords).map(([ref, record]) => {
    const taggedPif = pifByRef.get(refValue(record.tagged_PIF))
    const untaggedPif = pifByRef.get(refValue(record.untagged_PIF))
    return {
      ref,
      uuid: String(record.uuid ?? ''),
      tag: numberValue(record.tag, -1),
      tagged_PIF: refValue(record.tagged_PIF),
      untagged_PIF: refValue(record.untagged_PIF),
      // VLAN records contain PIF references, not a network field. The network
      // receiving untagged traffic belongs to the logical (untagged) PIF.
      network: untaggedPif?.network || '',
      taggedDevice: taggedPif?.device || null,
      host: taggedPif?.host || null,
    }
  }).sort((a, b) => a.tag - b.tag || String(a.taggedDevice).localeCompare(String(b.taggedDevice)))
}

export function findDuplicateVlan(
  pifs: NormalizedPifRecord[],
  taggedPifRef: string,
  vlanTag: number,
): NormalizedPifRecord | undefined {
  const taggedPif = pifs.find((p) => p.ref === taggedPifRef)
  if (!taggedPif) return undefined
  return pifs.find((p) => p.ref !== taggedPifRef && p.host === taggedPif.host && p.device === taggedPif.device && p.vlan === vlanTag)
}

export function bondDeviceSignature(devices: string[]): string {
  return [...new Set(devices)].sort().join('|')
}

export function getBondDevicesFromRefs(pifs: NormalizedPifRecord[], pifRefs: string[]): string[] {
  return [...new Set(
    pifRefs
      .map((ref) => pifs.find((p) => p.ref === ref)?.device)
      .filter((device): device is string => Boolean(device))
  )].sort()
}

export function groupPifsByHostForDevices(
  pifs: NormalizedPifRecord[],
  hostRefs: string[],
  devices: string[],
): Map<string, NormalizedPifRecord[]> {
  const deviceSet = new Set(devices)
  const result = new Map<string, NormalizedPifRecord[]>()
  for (const hostRef of hostRefs) {
    result.set(
      hostRef,
      pifs
        .filter((p) => p.host === hostRef && deviceSet.has(p.device) && p.isBondCandidate)
        .sort((a, b) => devices.indexOf(a.device) - devices.indexOf(b.device)),
    )
  }
  return result
}
