import { describe, expect, it } from 'vitest'
import { findDuplicateVlan, normalizeNetworks, normalizePifs, normalizeVlans } from '../../src/main/xapi/services/network-domain'

describe('network-domain normalization', () => {
  it('derives VLAN network from the untagged PIF using the actual XAPI record shape', () => {
    const pifs = normalizePifs({ networkRecords: {}, pifRecords: {
      tagged: { device: 'eth0', host: 'host1', network: 'transport', VLAN: -1 },
      untagged: { device: 'eth0', host: 'host1', network: 'guest', VLAN: 100 },
    } })
    const [vlan] = normalizeVlans({ pifs, vlanRecords: {
      vlan1: { uuid: 'vlan1', tag: 100, tagged_PIF: 'tagged', untagged_PIF: 'untagged' },
    } })
    expect(vlan).toMatchObject({ network: 'guest', host: 'host1', taggedDevice: 'eth0' })
    expect(normalizeVlans({ pifs, vlanRecords: {
      orphan: { tag: 100, tagged_PIF: 'tagged', untagged_PIF: 'missing', network: 'invented' },
    } })[0].network).toBe('')
  })

  it('keeps missing carrier and tunnel status unknown instead of reporting a failed link', () => {
    const pifs = normalizePifs({ networkRecords: {}, pifRecords: {
      physical: { metrics: 'metrics', device: 'eth0' },
      tunnel: { tunnel_access_PIF_of: ['tunnel1'], device: 'xapi0' },
    }, metricsRecords: { metrics: { speed: 1000 } } })
    expect(pifs.map(({ carrier, linkState }) => ({ carrier, linkState }))).toEqual([
      { carrier: null, linkState: 'unknown' }, { carrier: null, linkState: 'unknown' },
    ])
  })

  it('matches occupied VLAN tags on the same host and carrier device only', () => {
    const pifs = normalizePifs({ networkRecords: {}, pifRecords: {
      tagged: { host: 'host1', device: 'eth0', VLAN: -1 },
      otherHost: { host: 'host2', device: 'eth0', VLAN: 100 },
      otherDevice: { host: 'host1', device: 'eth1', VLAN: 100 },
    } })
    expect(findDuplicateVlan(pifs, 'tagged', 100)).toBeUndefined()
  })

  it('keeps a physical transport network distinct from its tunnel access network', () => {
    const pifs = normalizePifs({ networkRecords: {}, pifRecords: {
      transport: { network: 'physical-network', physical: true, VLAN: -1, tunnel_transport_PIF_of: ['tunnel'] },
      access: { network: 'overlay-network', VLAN: -1, tunnel_access_PIF_of: ['tunnel'] },
    } })
    const networks = normalizeNetworks({ pifs, networkRecords: { 'physical-network': {}, 'overlay-network': {} } })
    expect(networks.find((record) => record.ref === 'physical-network')).toMatchObject({ kind: 'external', isTunnel: false })
    expect(networks.find((record) => record.ref === 'overlay-network')).toMatchObject({ kind: 'tunnel', isTunnel: true })
  })
  it('classifies PIF roles and link state from XAPI records', () => {
    const networkRecords = {
      'OpaqueRef:net-mgmt': { name_label: 'Management', PIFs: ['OpaqueRef:pif-mgmt'], VIFs: [], MTU: 1500 },
      'OpaqueRef:net-guest': { name_label: 'Guest', other_config: { is_guest_installer_network: 'true' }, PIFs: [], VIFs: [], MTU: 1500 },
      'OpaqueRef:net-vlan': { name_label: 'VLAN 100', PIFs: ['OpaqueRef:pif-vlan'], VIFs: [], MTU: 1500 },
      'OpaqueRef:net-bond-member': { name_label: 'eth1', PIFs: ['OpaqueRef:pif-bond-member'], VIFs: [], MTU: 1500 },
      'OpaqueRef:net-tunnel': { name_label: 'Tunnel', PIFs: ['OpaqueRef:pif-tunnel'], VIFs: [], MTU: 1500 },
    }
    const pifs = normalizePifs({
      networkRecords,
      pifRecords: {
        'OpaqueRef:pif-mgmt': {
          uuid: 'pif-mgmt',
          device: 'eth0',
          host: 'OpaqueRef:host1',
          network: 'OpaqueRef:net-mgmt',
          IP: '192.168.1.10',
          MAC: '00:11:22:33:44:55',
          MTU: 1500,
          VLAN: -1,
          physical: true,
          management: true,
          ip_configuration_mode: 'Static',
          metrics: 'OpaqueRef:metrics-down',
        },
        'OpaqueRef:pif-secondary': {
          uuid: 'pif-secondary',
          device: 'eth2',
          host: 'OpaqueRef:host1',
          network: 'OpaqueRef:net-mgmt',
          IP: '10.0.0.10',
          MAC: '00:11:22:33:44:66',
          MTU: 1500,
          VLAN: -1,
          physical: true,
          management: false,
          ip_configuration_mode: 'Static',
          metrics: 'OpaqueRef:metrics-up',
        },
        'OpaqueRef:pif-vlan': {
          uuid: 'pif-vlan',
          device: 'eth0',
          host: 'OpaqueRef:host1',
          network: 'OpaqueRef:net-vlan',
          IP: '',
          MAC: '00:11:22:33:44:77',
          MTU: 1500,
          VLAN: 100,
          physical: false,
          management: false,
          ip_configuration_mode: 'None',
        },
        'OpaqueRef:pif-bond-member': {
          uuid: 'pif-bond-member',
          device: 'eth1',
          host: 'OpaqueRef:host1',
          network: 'OpaqueRef:net-bond-member',
          IP: '',
          MAC: '00:11:22:33:44:88',
          MTU: 1500,
          VLAN: -1,
          physical: true,
          management: false,
          ip_configuration_mode: 'None',
          bond_slave_of: 'OpaqueRef:bond1',
        },
        'OpaqueRef:pif-tunnel': {
          uuid: 'pif-tunnel',
          device: 'xapi0',
          host: 'OpaqueRef:host1',
          network: 'OpaqueRef:net-tunnel',
          IP: '',
          MAC: '00:11:22:33:44:99',
          MTU: 1500,
          VLAN: -1,
          physical: false,
          management: false,
          ip_configuration_mode: 'None',
          tunnel_access_PIF_of: ['OpaqueRef:tunnel1'],
        },
      },
      metricsRecords: {
        'OpaqueRef:metrics-down': { carrier: false, speed: 1000, duplex: true },
        'OpaqueRef:metrics-up': { carrier: true, speed: 10000, duplex: true },
      },
      tunnelRecords: {
        'OpaqueRef:tunnel1': { access_PIF: 'OpaqueRef:pif-tunnel', status: { active: 'true' } },
      },
      clusterPifRefs: new Set(['OpaqueRef:pif-secondary']),
    })

    const byRef = new Map(pifs.map((pif) => [pif.ref, pif]))
    expect(byRef.get('OpaqueRef:pif-mgmt')?.linkState).toBe('disconnected')
    expect(byRef.get('OpaqueRef:pif-mgmt')?.isPrimaryManagement).toBe(true)
    expect(byRef.get('OpaqueRef:pif-secondary')?.isSecondaryManagement).toBe(true)
    expect(byRef.get('OpaqueRef:pif-secondary')?.isClusterPif).toBe(true)
    expect(byRef.get('OpaqueRef:pif-vlan')?.isVlan).toBe(true)
    expect(byRef.get('OpaqueRef:pif-bond-member')?.isBondMember).toBe(true)
    expect(byRef.get('OpaqueRef:pif-bond-member')?.isBondCandidate).toBe(false)
    expect(byRef.get('OpaqueRef:pif-tunnel')?.isTunnelAccess).toBe(true)
    expect(byRef.get('OpaqueRef:pif-tunnel')?.linkState).toBe('connected')
  })

  it('derives network visibility and action rules', () => {
    const pifs = normalizePifs({
      networkRecords: {
        'OpaqueRef:net-visible': { name_label: 'Visible', PIFs: ['OpaqueRef:pif-visible'], VIFs: [], MTU: 1500 },
        'OpaqueRef:net-hidden': { name_label: 'Hidden', other_config: { HideFromXenCenter: 'true' }, PIFs: ['OpaqueRef:pif-hidden'], VIFs: [], MTU: 1500 },
        'OpaqueRef:net-guest': { name_label: 'Guest', other_config: { is_guest_installer_network: 'true' }, PIFs: [], VIFs: [], MTU: 1500 },
        'OpaqueRef:net-bond-member': { name_label: 'Bond member', PIFs: ['OpaqueRef:pif-bond-member'], VIFs: [], MTU: 1500 },
      },
      pifRecords: {
        'OpaqueRef:pif-visible': { uuid: 'pif-visible', device: 'eth0', host: 'OpaqueRef:host1', network: 'OpaqueRef:net-visible', IP: '', MAC: '', MTU: 1500, VLAN: -1, physical: true },
        'OpaqueRef:pif-hidden': { uuid: 'pif-hidden', device: 'eth9', host: 'OpaqueRef:host1', network: 'OpaqueRef:net-hidden', IP: '', MAC: '', MTU: 1500, VLAN: -1, physical: true },
        'OpaqueRef:pif-bond-member': { uuid: 'pif-bond-member', device: 'eth1', host: 'OpaqueRef:host1', network: 'OpaqueRef:net-bond-member', IP: '', MAC: '', MTU: 1500, VLAN: -1, physical: true, bond_slave_of: 'OpaqueRef:bond1' },
      },
    })

    const networks = normalizeNetworks({
      pifs,
      networkRecords: {
        'OpaqueRef:net-visible': { name_label: 'Visible', PIFs: ['OpaqueRef:pif-visible'], VIFs: [], MTU: 1500 },
        'OpaqueRef:net-hidden': { name_label: 'Hidden', other_config: { HideFromXenCenter: 'true' }, PIFs: ['OpaqueRef:pif-hidden'], VIFs: [], MTU: 1500 },
        'OpaqueRef:net-guest': { name_label: 'Guest', other_config: { is_guest_installer_network: 'true' }, PIFs: [], VIFs: [], MTU: 1500 },
        'OpaqueRef:net-bond-member': { name_label: 'Bond member', PIFs: ['OpaqueRef:pif-bond-member'], VIFs: [], MTU: 1500 },
      },
    })

    expect(pifs.find((pif) => pif.ref === 'OpaqueRef:pif-hidden')?.isHidden).toBe(true)
    expect(pifs.find((pif) => pif.ref === 'OpaqueRef:pif-hidden')?.isBondCandidate).toBe(false)
    expect(networks.find((network) => network.ref === 'OpaqueRef:net-hidden')?.visible).toBe(false)
    expect(networks.find((network) => network.ref === 'OpaqueRef:net-guest')?.visible).toBe(false)
    expect(networks.find((network) => network.ref === 'OpaqueRef:net-bond-member')?.visible).toBe(false)
    expect(networks.find((network) => network.ref === 'OpaqueRef:net-visible')?.allowedActions.destroy).toBe(false)
  })

  it('detects occupied VLAN tags by device', () => {
    const pifs = normalizePifs({
      networkRecords: {
        'OpaqueRef:net-eth0': { name_label: 'eth0', PIFs: ['OpaqueRef:pif-eth0'], VIFs: [], MTU: 1500 },
        'OpaqueRef:net-vlan': { name_label: 'VLAN 100', PIFs: ['OpaqueRef:pif-vlan100'], VIFs: [], MTU: 1500 },
      },
      pifRecords: {
        'OpaqueRef:pif-eth0': { uuid: 'pif-eth0', device: 'eth0', host: 'OpaqueRef:host1', network: 'OpaqueRef:net-eth0', IP: '', MAC: '', MTU: 1500, VLAN: -1, physical: true },
        'OpaqueRef:pif-vlan100': { uuid: 'pif-vlan100', device: 'eth0', host: 'OpaqueRef:host1', network: 'OpaqueRef:net-vlan', IP: '', MAC: '', MTU: 1500, VLAN: 100, physical: false },
      },
    })

    expect(findDuplicateVlan(pifs, 'OpaqueRef:pif-eth0', 100)?.ref).toBe('OpaqueRef:pif-vlan100')
    expect(findDuplicateVlan(pifs, 'OpaqueRef:pif-eth0', 101)).toBeUndefined()
  })
})
