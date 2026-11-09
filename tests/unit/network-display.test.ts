import { describe, expect, it } from 'vitest'
import {
  formatNetworkAttachment,
  formatNetworkName,
  formatNetworkOptionLabel,
  formatNetworkTypeLabel,
  formatRawNetworkName,
  formatVifNetworkName,
  getGuestIpAddresses,
  isNameOnlyVlanNetwork,
} from '../../src/renderer/src/lib/networkDisplay'
import type { NetworkRecord, VIFRecord } from '../../src/renderer/src/types/xapi'

function network(record: Partial<NetworkRecord>): NetworkRecord {
  return {
    ref: 'OpaqueRef:net1',
    uuid: 'net1',
    name_label: '',
    name_description: '',
    bridge: '',
    VIFs: [],
    PIFs: [],
    MTU: 1500,
    ...record,
  }
}

describe('networkDisplay', () => {
  it('groups guest reported IPv4 and IPv6 by VIF device without duplicate legacy addresses', () => {
    expect(getGuestIpAddresses({
      '0/ip': '10.0.0.2',
      '0/ipv4/0': '10.0.0.2',
      '0/ipv4/1': '10.0.0.3',
      '0/ipv4/1/prefix': '24',
      '0/ipv6/0': '2001:db8::2',
      '1/ipv4/0': '172.16.0.4',
      '10/ipv4/0': '192.0.2.10',
      '0/mac/0': 'AA:BB:CC:DD:EE:FF',
    })).toEqual([
      { device: '0', family: 'IPv4', address: '10.0.0.2' },
      { device: '0', family: 'IPv4', address: '10.0.0.3' },
      { device: '0', family: 'IPv6', address: '2001:db8::2' },
      { device: '1', family: 'IPv4', address: '172.16.0.4' },
      { device: '10', family: 'IPv4', address: '192.0.2.10' },
    ])
  })

  it('keeps multiple addresses in an older guest agent field and ignores empty reports', () => {
    expect(getGuestIpAddresses({
      '2/ip': '10.44.254.253 10.44.254.254',
      '2/ipv4/0': '10.44.254.253 10.44.254.254',
      '2/ipv6/0': '   ',
    })).toEqual([
      { device: '2', family: 'IPv4', address: '10.44.254.253' },
      { device: '2', family: 'IPv4', address: '10.44.254.254' },
    ])
  })

  it('uses a XenAdmin-style network name and a separate host-interface relation', () => {
    const net = network({
      name_label: 'Pool-wide network associated with eth0',
      kind: 'external',
      device: 'eth0',
      bridge: 'xenbr0',
    })

    expect(formatNetworkName(net)).toBe('Network 0')
    expect(formatNetworkAttachment(net)).toBe('Host Interface eth0')
    expect(formatNetworkOptionLabel(net)).toBe('Network 0 (外部网络, Host Interface eth0)')
    expect(net.name_label).toBe('Pool-wide network associated with eth0')
    expect(formatRawNetworkName('Network associated with eth1')).toBe('Network 1')
    expect(formatNetworkName(network({ ...net, device: 'eth1', PIFs: ['OpaqueRef:pif'] }))).toBe('Network 1')
  })

  it('marks vlan-named internal networks without PIFs as not bound VLANs', () => {
    const net = network({
      name_label: 'vlan201',
      kind: 'internal',
      bridge: 'xapi69',
      PIFs: [],
      pifRefs: [],
    })

    expect(isNameOnlyVlanNetwork(net)).toBe(true)
    expect(formatNetworkTypeLabel(net)).toBe('内部网络')
    expect(formatNetworkAttachment(net)).toBe('名称像 VLAN，未配置 VLAN 接口')
    expect(formatNetworkOptionLabel(net)).toBe('vlan201 (内部网络, 名称像 VLAN，未配置 VLAN 接口)')
  })

  it('distinguishes a bond network from the bond interface', () => {
    const net = network({
      name_label: 'Bond 0',
      kind: 'bond',
    })

    expect(formatNetworkTypeLabel(net)).toBe('绑定网络')
  })

  it('preserves custom network names and does not invent missing relationships', () => {
    const net = network({ name_label: '生产业务', kind: 'internal', bridge: 'xapi42' })
    expect(formatNetworkName(net)).toBe('生产业务')
    expect(formatNetworkAttachment(net)).toBe('—')
    expect(formatNetworkOptionLabel(net)).toBe('生产业务 (内部网络)')
  })

  it('shows actual VLAN topology using its interface and tag without treating a name as topology', () => {
    const net = network({ name_label: 'Pool-wide network associated with eth0', kind: 'vlan', isVlan: true, vlan: 100, device: 'eth0', PIFs: ['OpaqueRef:pif'] })
    expect(formatNetworkName(net)).toBe('Network 0 · VLAN 100')
    expect(formatNetworkTypeLabel(net)).toBe('VLAN 网络')
    expect(formatNetworkAttachment(net)).toBe('Host Interface eth0 · VLAN 100')
    expect(isNameOnlyVlanNetwork(net)).toBe(false)
    expect(isNameOnlyVlanNetwork(network({ name_label: 'vlan100', pifRefs: [], PIFs: ['OpaqueRef:pif'] }))).toBe(false)
  })

  it('formats VM VIF networks using the same network records when available', () => {
    const net = network({
      ref: 'OpaqueRef:net-eth1',
      name_label: 'Pool-wide network associated with eth1',
      kind: 'external',
      device: 'eth1',
    })
    const vif = {
      ref: 'OpaqueRef:vif1',
      device: '0',
      MAC: '00:11:22:33:44:55',
      network: 'OpaqueRef:net-eth1',
      networkName: 'Pool-wide network associated with eth1',
      MTU: 1500,
    } as VIFRecord

    expect(formatVifNetworkName(vif, [net])).toBe('Network 1')
    expect(formatVifNetworkName(vif, [])).toBe('Network 1')
  })
})
