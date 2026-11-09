import { describe, expect, it } from 'vitest'
import { formatBondLabel, formatHostInterfaceLabel, formatHostInterfaceRole, formatHostInterfaceStatuses, formatVifLabel, formatVlanLabel, NETWORK_TERMS } from '../../src/renderer/src/lib/networkTerminology'
import type { PifRecord } from '../../src/renderer/src/types/xapi'

function pif(overrides: Partial<PifRecord>): PifRecord {
  return {
    ref: 'OpaqueRef:pif',
    uuid: 'pif',
    device: 'eth0',
    host: 'OpaqueRef:host',
    network: 'OpaqueRef:network',
    IP: '',
    MAC: '00:11:22:33:44:55',
    MTU: 1500,
    speed: 1000,
    vlan: -1,
    physical: false,
    currently_attached: true,
    ip_configuration_mode: 'None',
    management: false,
    ...overrides,
  }
}

describe('network terminology', () => {
  it.each([
    [{ isBondMember: true }, 'Host Interface'],
    [{ isBondMember: true, isPhysicalNic: true }, 'NIC'],
    [{ isBondMaster: true }, 'Bond Interface'],
    [{ isBondMaster: true, isPhysicalNic: true }, 'Bond Interface'],
    [{ isVlan: true }, 'VLAN Interface'],
    [{ isVlan: true, isPhysicalNic: true }, 'VLAN Interface'],
    [{ isTunnelAccess: true }, 'Tunnel Interface'],
    [{ isTunnelAccess: true, isPhysicalNic: true }, 'Tunnel Interface'],
    [{ isPhysicalNic: true }, 'NIC'],
    [{}, 'Host Interface'],
  ] as const)('formats host interface role %#', (flags, expected) => {
    expect(formatHostInterfaceRole(pif(flags))).toBe(expected)
  })

  it('exports the canonical repeated terms', () => {
    expect(NETWORK_TERMS).toEqual({
      physicalNic: 'NIC',
      hostInterface: 'Host Interface',
      hostInterfaceCompact: 'Host Interface',
      virtualNic: 'Virtual Interface',
      bond: 'Bond',
      vlanCarrier: 'Carrier Interface',
    })
  })

  it('labels physical, logical, virtual, VLAN and bond objects by their own identity', () => {
    expect(formatHostInterfaceLabel(pif({ isPhysicalNic: true }))).toBe('NIC 0 (eth0)')
    expect(formatHostInterfaceLabel(pif({ isVlan: true, isPhysicalNic: true }))).toBe('VLAN Interface eth0')
    expect(formatHostInterfaceLabel(pif({ isBondMaster: true, isPhysicalNic: true }))).toBe('Bond Interface eth0')
    expect(formatVifLabel('0')).toBe('Virtual Interface 0')
    expect(formatVlanLabel(100)).toBe('VLAN 100')
    expect(formatBondLabel(['eth0', 'eth1'])).toBe('Bond (eth0 + eth1)')
    expect(formatBondLabel([])).toBe('Bond')
    expect(formatHostInterfaceStatuses(pif({ isBondMember: true, isPrimaryManagement: true }))).toEqual(['绑定成员', '主管理'])
  })
})
