import { describe, expect, it, vi } from 'vitest'
import { createNetworkApi } from '../../src/preload/network-api'

describe('network preload IPC contracts', () => {
  it('exposes PIF_LIST only as network.listPifs', () => {
    const api = createNetworkApi({ invoke: vi.fn() })

    expect(Object.keys(api.pif)).toEqual(['reconfigureIp', 'scan', 'getForHost'])
    expect(Object.keys(api.network)).toEqual([
      'list', 'listPifs', 'create', 'destroy', 'rename',
      'getAllowedOps', 'addTag', 'removeTag', 'updateOtherConfig',
    ])
  })

  it('pairs all 32 network methods with their descriptors', async () => {
    const invoke = vi.fn()
    const api = createNetworkApi({ invoke })
    const cases: Array<{
      method: (...args: never[]) => Promise<unknown>
      channel: string
      args: unknown[]
      result: unknown
    }> = [
      { method: api.network.list, channel: 'network:list', args: ['pool-1'], result: [] },
      { method: api.network.create, channel: 'network:create', args: ['pool-1', 'Guest', ''], result: 'OpaqueRef:network' },
      { method: api.network.destroy, channel: 'network:destroy', args: ['pool-1', 'OpaqueRef:network'], result: undefined },
      { method: api.network.rename, channel: 'network:rename', args: ['pool-1', 'OpaqueRef:network', 'Renamed'], result: undefined },
      { method: api.network.getAllowedOps, channel: 'network:getAllowedOps', args: ['pool-1', 'OpaqueRef:network'], result: ['destroy'] },
      { method: api.network.addTag, channel: 'network:addTag', args: ['pool-1', 'OpaqueRef:network', 'production'], result: undefined },
      { method: api.network.removeTag, channel: 'network:removeTag', args: ['pool-1', 'OpaqueRef:network', 'production'], result: undefined },
      { method: api.network.updateOtherConfig, channel: 'network:updateOtherConfig', args: ['pool-1', 'OpaqueRef:network', 'purpose', 'guest'], result: undefined },
      { method: api.network.listPifs, channel: 'pif:list', args: ['pool-1'], result: [] },
      { method: api.pif.reconfigureIp, channel: 'pif:reconfigureIp', args: ['pool-1', 'OpaqueRef:pif', { mode: 'DHCP' }], result: undefined },
      { method: api.pif.scan, channel: 'pif:scan', args: ['pool-1', 'OpaqueRef:host'], result: undefined },
      { method: api.pif.getForHost, channel: 'pif:getForHost', args: ['pool-1', 'OpaqueRef:host'], result: [] },
      { method: api.vif.create, channel: 'vif:create', args: ['pool-1', { vmRef: 'OpaqueRef:vm', networkRef: 'OpaqueRef:network' }], result: { vifRef: 'OpaqueRef:vif', plugged: true } },
      { method: api.vif.destroy, channel: 'vif:destroy', args: ['pool-1', 'OpaqueRef:vif'], result: undefined },
      { method: api.vif.plug, channel: 'vif:plug', args: ['pool-1', 'OpaqueRef:vif'], result: undefined },
      { method: api.vif.unplug, channel: 'vif:unplug', args: ['pool-1', 'OpaqueRef:vif'], result: undefined },
      { method: api.vif.move, channel: 'vif:move', args: ['pool-1', 'OpaqueRef:vif', 'OpaqueRef:network'], result: undefined },
      { method: api.vif.setQos, channel: 'vif:setQos', args: ['pool-1', 'OpaqueRef:vif', { algorithmType: 'ratelimit', algorithmParams: { kbits: '1000' } }], result: undefined },
      { method: api.vif.clearQos, channel: 'vif:clearQos', args: ['pool-1', 'OpaqueRef:vif'], result: undefined },
      { method: api.bond.list, channel: 'bond:list', args: ['pool-1'], result: [] },
      { method: api.bond.create, channel: 'bond:create', args: ['pool-1', { pifRefs: ['OpaqueRef:pif-1', 'OpaqueRef:pif-2'] }], result: ['OpaqueRef:bond'] },
      { method: api.bond.destroy, channel: 'bond:destroy', args: ['pool-1', 'OpaqueRef:bond'], result: undefined },
      { method: api.bond.destroyGroup, channel: 'bond:destroyGroup', args: ['pool-1', 'OpaqueRef:bond'], result: ['OpaqueRef:bond'] },
      { method: api.bond.getRecord, channel: 'bond:getRecord', args: ['pool-1', 'OpaqueRef:bond'], result: {
        ref: 'OpaqueRef:bond', uuid: 'bond-uuid', master: 'OpaqueRef:pif-master',
        slaves: ['OpaqueRef:pif-1', 'OpaqueRef:pif-2'], mode: 'active-backup',
        properties: {}, other_config: {}, links_up: 2, network: 'OpaqueRef:network',
        devices: ['eth0', 'eth1'], masterDevice: 'bond0', hasManagement: false,
        hasPrimaryManagement: false, hasSecondaryManagement: false, hasClusterPif: false,
        connectionId: 'pool-1', poolName: 'Lab Pool',
      } },
      { method: api.vlan.list, channel: 'vlan:list', args: ['pool-1'], result: [] },
      { method: api.vlan.create, channel: 'vlan:create', args: ['pool-1', { taggedPifRef: 'OpaqueRef:pif', vlanTag: 0 }], result: ['OpaqueRef:vlan'] },
      { method: api.vlan.destroy, channel: 'vlan:destroy', args: ['pool-1', 'OpaqueRef:vlan'], result: undefined },
      { method: api.vlan.destroyNetwork, channel: 'vlan:destroyNetwork', args: ['pool-1', 'OpaqueRef:network'], result: ['OpaqueRef:vlan'] },
      { method: api.vlan.getRecord, channel: 'vlan:getRecord', args: ['pool-1', 'OpaqueRef:vlan'], result: {
        ref: 'OpaqueRef:vlan', uuid: 'vlan-uuid', tag: 0,
        tagged_PIF: 'OpaqueRef:pif', untagged_PIF: 'OpaqueRef:pif-vlan',
        network: 'OpaqueRef:network', taggedDevice: 'eth0', host: 'OpaqueRef:host',
        connectionId: 'pool-1', poolName: 'Lab Pool',
      } },
      { method: api.tunnel.list, channel: 'tunnel:list', args: ['pool-1'], result: [] },
      { method: api.tunnel.create, channel: 'tunnel:create', args: ['pool-1', 'OpaqueRef:pif', 'OpaqueRef:network'], result: 'OpaqueRef:tunnel' },
      { method: api.tunnel.destroy, channel: 'tunnel:destroy', args: ['pool-1', 'OpaqueRef:tunnel'], result: undefined },
    ]

    for (const testCase of cases) {
      invoke.mockResolvedValueOnce(testCase.result)
      await expect(testCase.method(...testCase.args as never[])).resolves.toEqual(testCase.result)
    }
    expect(invoke.mock.calls).toEqual(cases.map(({ channel, args }) => [channel, ...args]))
  })

  it('rejects malformed payloads and results before they escape the preload boundary', async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce('OpaqueRef:NULL')
      .mockResolvedValueOnce({
        error: true,
        message: 'network creation unavailable',
        code: 'NETWORK_UNAVAILABLE',
        details: { retryable: true },
      })
    const api = createNetworkApi({ invoke })

    await expect(api.vlan.create('pool-1', {
      taggedPifRef: 'OpaqueRef:pif', vlanTag: 4095,
    })).rejects.toMatchObject({ code: 'IPC_SCHEMA_INVALID' })
    expect(invoke).not.toHaveBeenCalled()

    await expect(api.network.create('pool-1', 'Guest', ''))
      .rejects.toMatchObject({ code: 'IPC_RESULT_INVALID' })
    await expect(api.network.create('pool-1', 'Guest', ''))
      .rejects.toMatchObject({
        message: 'network creation unavailable',
        code: 'NETWORK_UNAVAILABLE',
        details: { retryable: true },
      })
  })
})
