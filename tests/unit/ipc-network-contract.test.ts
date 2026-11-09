import { describe, expect, it } from 'vitest'
import {
  bondCreateContract,
  bondDestroyContract,
  bondDestroyGroupContract,
  bondGetRecordContract,
  bondListContract,
  networkContracts,
  networkCreateContract,
  networkListContract,
  networkUpdateOtherConfigContract,
  pifListContract,
  pifReconfigureIpContract,
  tunnelListContract,
  vifCreateContract,
  vifSetQosContract,
  vlanCreateContract,
  vlanDestroyNetworkContract,
} from '../../src/shared/ipc-contracts/network'

const connectedNetwork = {
  ref: 'OpaqueRef:network',
  uuid: 'network-uuid',
  name_label: 'Guest network',
  name_description: '',
  bridge: 'xenbr0',
  VIFs: ['OpaqueRef:vif'],
  PIFs: ['OpaqueRef:pif'],
  MTU: 1500,
  other_config: {},
  tags: [],
  managed: true,
  kind: 'external' as const,
  linkState: 'connected' as const,
  linkStatus: 'connected' as const,
  vlan: null,
  device: 'eth0',
  pifRefs: ['OpaqueRef:pif'],
  isHidden: false,
  isGuestInstallerNetwork: false,
  isBond: false,
  isBondMember: false,
  isVlan: false,
  isSriov: false,
  isTunnel: false,
  canUseJumboFrames: true,
  visible: true,
  allowedActions: { rename: true, destroy: false },
  connectionId: 'pool-1',
  poolName: 'Lab Pool',
  xapi_extension: { generation: 7 },
}

const connectedPif = {
  ref: 'OpaqueRef:pif',
  uuid: 'pif-uuid',
  device: 'eth0',
  host: 'OpaqueRef:host',
  network: 'OpaqueRef:network',
  IP: '192.0.2.10',
  MAC: '00:16:3e:00:00:01',
  MTU: 1500,
  speed: 1_000,
  duplex: true,
  vlan: -1,
  physical: true,
  managed: true,
  management: false,
  currently_attached: true,
  ip_configuration_mode: 'DHCP',
  netmask: '',
  gateway: '',
  DNS: '',
  metrics: 'OpaqueRef:pif-metrics',
  bond_master_of: [],
  bond_slave_of: '',
  VLAN_master_of: '',
  tunnel_access_PIF_of: [],
  tunnel_transport_PIF_of: [],
  sriov_logical_PIF_of: [],
  sriov_physical_PIF_of: [],
  other_config: {},
  disallow_unplug: false,
  carrier: true,
  linkState: 'connected' as const,
  isPhysicalNic: true,
  isBondMaster: false,
  isBondMember: false,
  isVlan: false,
  isPrimaryManagement: false,
  isSecondaryManagement: true,
  isManagementInterface: true,
  isHidden: false,
  isTunnelAccess: false,
  isTunnelTransport: false,
  isSriovLogical: false,
  isSriovPhysical: false,
  isClusterPif: false,
  isBondCandidate: true,
  isVlanCandidate: true,
  connectionId: 'pool-1',
  poolName: 'Lab Pool',
}

const connectedBond = {
  ref: 'OpaqueRef:bond',
  uuid: 'bond-uuid',
  master: 'OpaqueRef:pif-master',
  slaves: ['OpaqueRef:pif-1', 'OpaqueRef:pif-2'],
  mode: 'active-backup',
  properties: {},
  other_config: {},
  links_up: 2,
  network: 'OpaqueRef:network',
  devices: ['eth0', 'eth1'],
  masterDevice: 'bond0',
  hasManagement: false,
  hasPrimaryManagement: false,
  hasSecondaryManagement: false,
  hasClusterPif: false,
  connectionId: 'pool-1',
  poolName: 'Lab Pool',
}

const connectedVlan = {
  ref: 'OpaqueRef:vlan',
  uuid: 'vlan-uuid',
  tag: 0,
  tagged_PIF: 'OpaqueRef:pif',
  untagged_PIF: 'OpaqueRef:pif-vlan',
  network: 'OpaqueRef:network',
  taggedDevice: 'eth0',
  host: 'OpaqueRef:host',
  connectionId: 'pool-1',
  poolName: 'Lab Pool',
}

describe('network IPC contracts', () => {
  it('declares the exact 32-channel network inventory once', () => {
    expect(networkContracts.map(({ channel }) => channel)).toEqual([
      'network:list',
      'network:create',
      'network:destroy',
      'network:rename',
      'network:getAllowedOps',
      'network:addTag',
      'network:removeTag',
      'network:updateOtherConfig',
      'pif:list',
      'pif:reconfigureIp',
      'pif:scan',
      'pif:getForHost',
      'vif:create',
      'vif:destroy',
      'vif:plug',
      'vif:unplug',
      'vif:move',
      'vif:setQos',
      'vif:clearQos',
      'bond:list',
      'bond:create',
      'bond:destroy',
      'bond:destroyGroup',
      'bond:getRecord',
      'vlan:list',
      'vlan:create',
      'vlan:destroy',
      'vlan:destroyNetwork',
      'vlan:getRecord',
      'tunnel:list',
      'tunnel:create',
      'tunnel:destroy',
    ])
    expect(new Set(networkContracts.map(({ channel }) => channel))).toHaveLength(32)
    for (const contract of networkContracts) {
      expect(contract).toMatchObject({
        direction: 'invoke',
        callerPolicy: 'app-window-main-frame',
        errorShape: 'ipc-error-response-v1',
      })
    }
    expect(networkUpdateOtherConfigContract.redaction).toEqual(['credentials'])
  })

  it('validates strict connection/ref tuples and stable normalized read results', () => {
    expect(networkListContract.argsSchema.parse(['pool-1'])).toEqual(['pool-1'])
    expect(networkListContract.resultSchema.parse([connectedNetwork])).toEqual([connectedNetwork])
    expect(pifListContract.resultSchema.parse([connectedPif])).toEqual([connectedPif])
    expect(bondListContract.resultSchema.parse([connectedBond])).toEqual([connectedBond])
    expect(bondGetRecordContract.resultSchema.parse(connectedBond)).toEqual(connectedBond)
    expect(tunnelListContract.resultSchema.parse([{
      ref: 'OpaqueRef:tunnel',
      uuid: 'tunnel-uuid',
      access_PIF: 'OpaqueRef:pif-access',
      transport_PIF: 'OpaqueRef:pif-transport',
      connectionId: 'pool-1',
      poolName: 'Lab Pool',
      xapi_extension: true,
    }])).toHaveLength(1)

    for (const args of [[], [''], ['pool-1', 'extra']]) {
      expect(() => networkListContract.argsSchema.parse(args)).toThrow()
    }
    expect(() => bondDestroyContract.argsSchema.parse([
      'pool-1', 'OpaqueRef:NULL',
    ])).toThrow()
    expect(() => networkListContract.resultSchema.parse([{
      ...connectedNetwork, MTU: '1500',
    }])).toThrow()
    expect(() => pifListContract.resultSchema.parse([{
      ...connectedPif, connectionId: '',
    }])).toThrow()
    expect(() => tunnelListContract.resultSchema.parse([{
      ref: 'OpaqueRef:tunnel', uuid: 'uuid', access_PIF: 'OpaqueRef:NULL',
      transport_PIF: 'OpaqueRef:pif', connectionId: 'pool-1', poolName: 'Pool',
    }])).toThrow()
  })

  it('enforces PIF IP mode discriminators before service delegation', () => {
    const staticConfig = {
      mode: 'Static' as const,
      ip: '192.0.2.10',
      netmask: '255.255.255.0',
      gateway: '',
      dns: '192.0.2.1',
    }
    expect(pifReconfigureIpContract.argsSchema.parse([
      'pool-1', 'OpaqueRef:pif', staticConfig,
    ])).toEqual(['pool-1', 'OpaqueRef:pif', staticConfig])
    expect(pifReconfigureIpContract.argsSchema.parse([
      'pool-1', 'OpaqueRef:pif', { mode: 'DHCP' },
    ])).toEqual(['pool-1', 'OpaqueRef:pif', { mode: 'DHCP' }])
    expect(pifReconfigureIpContract.argsSchema.parse([
      'pool-1', 'OpaqueRef:pif', {
        mode: 'None', ip: '', netmask: '', gateway: '', dns: '',
      },
    ])).toEqual(['pool-1', 'OpaqueRef:pif', {
      mode: 'None', ip: '', netmask: '', gateway: '', dns: '',
    }])

    for (const config of [
      { mode: 'Static', ip: '192.0.2.10' },
      { mode: 'Static', ip: '', netmask: '255.255.255.0' },
      { mode: 'DHCP', ip: '192.0.2.10' },
      { mode: 'None', gateway: '192.0.2.1' },
      { mode: 'DHCP', unexpected: true },
      { mode: 'invalid' },
    ]) expect(() => pifReconfigureIpContract.argsSchema.parse([
      'pool-1', 'OpaqueRef:pif', config,
    ])).toThrow()
  })

  it('validates VIF create and QoS objects without narrowing supported algorithms', () => {
    expect(vifCreateContract.argsSchema.parse(['pool-1', {
      vmRef: 'OpaqueRef:vm', networkRef: 'OpaqueRef:network', mac: '', mtu: 9000,
    }])).toHaveLength(2)
    expect(vifCreateContract.resultSchema.parse({ vifRef: 'OpaqueRef:vif', plugged: false }))
      .toEqual({ vifRef: 'OpaqueRef:vif', plugged: false })
    expect(vifSetQosContract.argsSchema.parse(['pool-1', 'OpaqueRef:vif', {
      algorithmType: 'vendor-supported-algorithm',
      algorithmParams: { kbits: '1000000' },
    }])).toHaveLength(3)

    for (const params of [
      { vmRef: 'OpaqueRef:vm', networkRef: 'OpaqueRef:NULL' },
      { vmRef: 'OpaqueRef:vm', networkRef: 'OpaqueRef:network', mtu: 0 },
      { vmRef: 'OpaqueRef:vm', networkRef: 'OpaqueRef:network', extra: true },
    ]) expect(() => vifCreateContract.argsSchema.parse(['pool-1', params])).toThrow()
    expect(() => vifSetQosContract.argsSchema.parse(['pool-1', 'OpaqueRef:vif', {
      algorithmType: ' ', algorithmParams: {},
    }])).toThrow()
    expect(() => vifSetQosContract.argsSchema.parse(['pool-1', 'OpaqueRef:vif', {
      algorithmType: 'ratelimit', algorithmParams: { kbits: 1000 },
    }])).toThrow()
  })

  it('validates Bond creation and preserves single-destroy void semantics', () => {
    expect(bondCreateContract.argsSchema.parse(['pool-1', {
      pifRefs: ['OpaqueRef:pif-1', 'OpaqueRef:pif-2'],
      mode: 'lacp',
      nameLabel: 'Bond',
      nameDescription: '',
      mtu: 9000,
      confirmManagementDisruption: true,
    }])).toHaveLength(2)
    expect(bondCreateContract.resultSchema.parse([
      'OpaqueRef:bond-1', 'OpaqueRef:bond-2',
    ])).toHaveLength(2)
    expect(bondDestroyContract.resultSchema.parse(undefined)).toBeUndefined()
    expect(bondDestroyGroupContract.resultSchema.parse([
      'OpaqueRef:bond-1', 'OpaqueRef:bond-2',
    ])).toHaveLength(2)

    for (const params of [
      { pifRefs: ['OpaqueRef:pif-1'] },
      { pifRefs: ['OpaqueRef:pif-1', 'OpaqueRef:pif-1'] },
      { pifRefs: ['OpaqueRef:pif-1', 'OpaqueRef:NULL'] },
      { pifRefs: ['OpaqueRef:pif-1', 'OpaqueRef:pif-2'], mode: 'round-robin' },
      { pifRefs: ['OpaqueRef:pif-1', 'OpaqueRef:pif-2'], networkRef: 'OpaqueRef:network', mtu: 9000 },
      { pifRefs: ['OpaqueRef:pif-1', 'OpaqueRef:pif-2'], unexpected: true },
    ]) expect(() => bondCreateContract.argsSchema.parse(['pool-1', params])).toThrow()
  })

  it('accepts VLAN tags 0 through 4094 and rejects contradictory network fields', () => {
    expect(vlanCreateContract.argsSchema.parse(['pool-1', {
      taggedPifRef: 'OpaqueRef:pif', vlanTag: 0, nameLabel: 'VLAN 0',
    }])).toHaveLength(2)
    expect(vlanCreateContract.argsSchema.parse(['pool-1', {
      taggedPifRef: 'OpaqueRef:pif', vlanTag: 4094,
    }])).toHaveLength(2)
    expect(vlanCreateContract.resultSchema.parse(['OpaqueRef:vlan'])).toEqual(['OpaqueRef:vlan'])

    for (const params of [
      { taggedPifRef: 'OpaqueRef:pif', vlanTag: -1 },
      { taggedPifRef: 'OpaqueRef:pif', vlanTag: 4095 },
      { taggedPifRef: 'OpaqueRef:pif', vlanTag: 1.5 },
      { taggedPifRef: 'OpaqueRef:NULL', vlanTag: 100 },
      { taggedPifRef: 'OpaqueRef:pif', vlanTag: 100, networkRef: 'OpaqueRef:network', nameLabel: 'ignored' },
      { taggedPifRef: 'OpaqueRef:pif', vlanTag: 100, extra: true },
    ]) expect(() => vlanCreateContract.argsSchema.parse(['pool-1', params])).toThrow()

    expect(vlanDestroyNetworkContract.argsSchema.parse([
      'pool-1', 'OpaqueRef:network', { confirmManagementDisruption: true },
    ])).toHaveLength(3)
    expect(vlanDestroyNetworkContract.argsSchema.parse([
      'pool-1', 'OpaqueRef:network', undefined,
    ])).toHaveLength(3)
    expect(() => vlanDestroyNetworkContract.argsSchema.parse([
      'pool-1', 'OpaqueRef:network', { unexpected: true },
    ])).toThrow()
  })

  it('keeps create/reference/void result shapes exact', () => {
    expect(networkCreateContract.resultSchema.parse('OpaqueRef:network')).toBe('OpaqueRef:network')
    expect(() => networkCreateContract.resultSchema.parse('OpaqueRef:NULL')).toThrow()
    expect(() => bondCreateContract.resultSchema.parse('OpaqueRef:bond')).toThrow()
    expect(() => bondDestroyContract.resultSchema.parse([])).toThrow()
    expect(() => vlanCreateContract.resultSchema.parse(['OpaqueRef:NULL'])).toThrow()
    expect(() => bondGetRecordContract.resultSchema.parse({
      ...connectedBond, connectionId: undefined,
    })).toThrow()
    expect(() => vlanDestroyNetworkContract.resultSchema.parse(undefined)).toThrow()
  })
})
