import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useConnectionManagerStore } from '../../src/renderer/src/store/connectionManager.store'
import { useNetworkAdvancedStore } from '../../src/renderer/src/store/network-advanced.store'

const mockXapi = {
  bond: {
    list: vi.fn(),
    create: vi.fn(),
    destroy: vi.fn(),
    destroyGroup: vi.fn(),
  },
  tunnel: { list: vi.fn(), create: vi.fn(), destroy: vi.fn() },
  vif: { setQos: vi.fn(), clearQos: vi.fn() },
  vlan: {
    list: vi.fn(),
    create: vi.fn(),
    destroy: vi.fn(),
    destroyNetwork: vi.fn(),
  },
}

describe('network advanced store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(globalThis as any).window = { xapi: mockXapi }
    useConnectionManagerStore.setState({
      connections: [],
      activeConnectionId: 'conn-active',
    })
    useNetworkAdvancedStore.setState({
      bonds: [],
      bondsConnectionId: null,
      bondsLoading: false,
      bondsError: null,
      vlans: [],
      vlansConnectionId: null,
      vlansLoading: false,
      vlansError: null,
      tunnels: [],
      tunnelsConnectionId: null,
      tunnelsLoading: false,
      tunnelsError: null,
    })
  })


  it.each([
    ['bonds', 'bond', 'loadBonds'], ['vlans', 'vlan', 'loadVlans'], ['tunnels', 'tunnel', 'loadTunnels'],
  ] as const)('isolates %s across out-of-order resource pool responses and preserves failed refresh data', async (domain, api, loader) => {
    let finishOld!: (value: any[]) => void
    mockXapi[api].list.mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve }))
    const oldRead = useNetworkAdvancedStore.getState()[loader]('conn-old')
    mockXapi[api].list.mockResolvedValueOnce([{ ref: 'same-ref', connectionId: 'conn-new' }])
    await useNetworkAdvancedStore.getState()[loader]('conn-new')
    finishOld([{ ref: 'same-ref', connectionId: 'conn-old' }])
    await oldRead
    expect(useNetworkAdvancedStore.getState()[domain]).toEqual([{ ref: 'same-ref', connectionId: 'conn-new' }])
    mockXapi[api].list.mockRejectedValueOnce(new Error('PERMISSION_DENIED'))
    await useNetworkAdvancedStore.getState()[loader]('conn-new')
    expect(useNetworkAdvancedStore.getState()[domain]).toEqual([{ ref: 'same-ref', connectionId: 'conn-new' }])
    expect(useNetworkAdvancedStore.getState()[`${domain}Error`]).toBe('PERMISSION_DENIED')
    mockXapi[api].list.mockRejectedValueOnce(new Error('OTHER_POOL_FAILED'))
    await useNetworkAdvancedStore.getState()[loader]('conn-other')
    expect(useNetworkAdvancedStore.getState()[domain]).toEqual([])
  })

  it('discards a read from an earlier connection epoch, even after reconnecting to the same pool', async () => {
    useConnectionManagerStore.setState({ connections: [{ id: 'conn-1', state: 'connected', epoch: 1, poolUuid: 'pool' } as any] })
    let finish!: (value: any[]) => void
    mockXapi.bond.list.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const reading = useNetworkAdvancedStore.getState().loadBonds('conn-1')
    useConnectionManagerStore.setState({ connections: [{ id: 'conn-1', state: 'disconnected', epoch: 1, poolUuid: 'pool' } as any] })
    useConnectionManagerStore.setState({ connections: [{ id: 'conn-1', state: 'connected', epoch: 2, poolUuid: 'pool' } as any] })
    finish([{ ref: 'old-bond' }])
    await reading
    expect(useNetworkAdvancedStore.getState().bonds).toEqual([])
    expect(useNetworkAdvancedStore.getState().bondsLoading).toBe(false)
  })

  it('keeps Tunnel mutation readback and QoS writes in the explicitly selected pool', async () => {
    mockXapi.tunnel.create.mockImplementationOnce(async () => {
      useConnectionManagerStore.setState({ activeConnectionId: 'conn-other' })
      return 'tunnel'
    })
    mockXapi.tunnel.list.mockResolvedValue([])
    await useNetworkAdvancedStore.getState().createTunnel('pif', 'network', 'conn-selected')
    await useNetworkAdvancedStore.getState().setVifQos('vif', { algorithmType: 'ratelimit', algorithmParams: {} }, 'conn-selected')
    await useNetworkAdvancedStore.getState().clearVifQos('vif', 'conn-selected')
    expect(mockXapi.tunnel.create).toHaveBeenCalledWith('conn-selected', 'pif', 'network')
    expect(mockXapi.tunnel.list).toHaveBeenCalledWith('conn-selected')
    expect(mockXapi.vif.setQos).toHaveBeenCalledWith('conn-selected', 'vif', { algorithmType: 'ratelimit', algorithmParams: {} })
    expect(mockXapi.vif.clearQos).toHaveBeenCalledWith('conn-selected', 'vif')
  })

  it('loads bonds and VLANs with the explicit connection id', async () => {
    mockXapi.bond.list.mockResolvedValueOnce([{ ref: 'OpaqueRef:bond1' }])
    mockXapi.vlan.list.mockResolvedValueOnce([{ ref: 'OpaqueRef:vlan1' }])

    await useNetworkAdvancedStore.getState().loadBonds('conn-scoped')
    await useNetworkAdvancedStore.getState().loadVlans('conn-scoped')

    expect(mockXapi.bond.list).toHaveBeenCalledWith('conn-scoped')
    expect(mockXapi.vlan.list).toHaveBeenCalledWith('conn-scoped')
  })

  it('creates and destroys bonds with the explicit connection id', async () => {
    mockXapi.bond.create.mockResolvedValueOnce(['OpaqueRef:new-bond'])
    mockXapi.bond.list.mockResolvedValue([])
    mockXapi.bond.destroyGroup.mockResolvedValueOnce(['OpaqueRef:bond1'])

    await useNetworkAdvancedStore.getState().createBond({
      pifRefs: ['OpaqueRef:pif1', 'OpaqueRef:pif2'],
      mode: 'active-backup',
    }, 'conn-scoped')
    await useNetworkAdvancedStore.getState().destroyBond('OpaqueRef:bond1', 'conn-scoped')

    expect(mockXapi.bond.create).toHaveBeenCalledWith('conn-scoped', {
      pifRefs: ['OpaqueRef:pif1', 'OpaqueRef:pif2'],
      mode: 'active-backup',
    })
    expect(mockXapi.bond.destroyGroup).toHaveBeenCalledWith('conn-scoped', 'OpaqueRef:bond1')
  })

  it('creates and destroys VLANs with the explicit connection id', async () => {
    mockXapi.vlan.create.mockResolvedValueOnce(['OpaqueRef:vlan-pif1'])
    mockXapi.vlan.list.mockResolvedValue([])
    mockXapi.vlan.destroy.mockResolvedValueOnce(undefined)
    mockXapi.vlan.destroyNetwork.mockResolvedValueOnce(['OpaqueRef:vlan1'])

    await useNetworkAdvancedStore.getState().createVlan({
      taggedPifRef: 'OpaqueRef:pif1',
      vlanTag: 100,
      nameLabel: 'VLAN 100',
    }, 'conn-scoped')
    await useNetworkAdvancedStore.getState().destroyVlan('OpaqueRef:vlan1', 'conn-scoped')
    await useNetworkAdvancedStore.getState().destroyVlanNetwork('OpaqueRef:net-vlan100', 'conn-scoped')

    expect(mockXapi.vlan.create).toHaveBeenCalledWith('conn-scoped', {
      taggedPifRef: 'OpaqueRef:pif1',
      vlanTag: 100,
      nameLabel: 'VLAN 100',
    })
    expect(mockXapi.vlan.destroy).toHaveBeenCalledWith('conn-scoped', 'OpaqueRef:vlan1')
    expect(mockXapi.vlan.destroyNetwork).toHaveBeenCalledWith('conn-scoped', 'OpaqueRef:net-vlan100', undefined)
  })
})
