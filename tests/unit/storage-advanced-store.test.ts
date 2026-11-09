import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useConnectionManagerStore } from '../../src/renderer/src/store/connectionManager.store'
import { useStorageAdvancedStore, isoResourceKey } from '../../src/renderer/src/store/storage-advanced.store'

const mockXapi = {
  pbd: {
    list: vi.fn(),
    create: vi.fn(),
    plug: vi.fn(),
    unplug: vi.fn(),
    destroy: vi.fn(),
  },
  sr: {
    getThinStats: vi.fn(),
  },
  storage: {
    cloneVdi: vi.fn(),
    snapshotVdi: vi.fn(),
    copyVdi: vi.fn(),
    setVdiNameLabel: vi.fn(),
    setVdiNameDescription: vi.fn(),
    addVdiTag: vi.fn(),
    removeVdiTag: vi.fn(),
  },
  iso: {
    list: vi.fn(),
    delete: vi.fn(),
  },
}

describe('storage advanced store connection scoping', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(globalThis as any).window = { xapi: mockXapi }
    useConnectionManagerStore.setState({
      connections: [],
      activeConnectionId: 'conn-a',
    })
    useStorageAdvancedStore.setState({
      pbds: [],
      pbdStates: {},
      pbdsLoading: false,
      pbdsError: null,
      isoStates: {},
      isos: [],
      isosLoading: false,
      isosError: null,
      thinStats: {},
    })
    mockXapi.pbd.list.mockResolvedValue([])
  })

  it('loads and mutates PBDs with the explicit connection id', async () => {
    await useStorageAdvancedStore.getState().loadPbds('conn-b')
    await useStorageAdvancedStore.getState().plugPbd('OpaqueRef:pbd', 'conn-b')
    await useStorageAdvancedStore.getState().unplugPbd('OpaqueRef:pbd', 'conn-b')
    await useStorageAdvancedStore.getState().destroyPbd('OpaqueRef:pbd', 'conn-b')

    expect(mockXapi.pbd.list).toHaveBeenCalledWith('conn-b')
    expect(mockXapi.pbd.plug).toHaveBeenCalledWith('conn-b', 'OpaqueRef:pbd')
    expect(mockXapi.pbd.unplug).toHaveBeenCalledWith('conn-b', 'OpaqueRef:pbd')
    expect(mockXapi.pbd.destroy).toHaveBeenCalledWith('conn-b', 'OpaqueRef:pbd')
  })

  it('loads thin provisioning stats with the explicit connection and scoped cache key', async () => {
    const stats = {
      physicalSize: 100,
      physicalUtilisation: 20,
      virtualAllocation: 40,
      overprovisionRatio: 0.4,
    }
    mockXapi.sr.getThinStats.mockResolvedValue(stats)

    await useStorageAdvancedStore.getState().getThinStats('OpaqueRef:sr', 'conn-b')

    expect(mockXapi.sr.getThinStats).toHaveBeenCalledWith('conn-b', 'OpaqueRef:sr')
    expect(useStorageAdvancedStore.getState().thinStats['conn-b:OpaqueRef:sr']).toEqual(stats)
  })
  it('keeps same-ref ISO lists isolated by explicit connection', async () => {
    mockXapi.iso.list.mockImplementation(async (connectionId: string) => [{ ref: 'same-iso', nameLabel: connectionId }])
    await Promise.all(['conn-a', 'conn-b'].map((id) => useStorageAdvancedStore.getState().loadIsos(id, 'same-sr')))
    const states = useStorageAdvancedStore.getState().isoStates
    expect(states[isoResourceKey('conn-a', 'same-sr')].items[0].nameLabel).toBe('conn-a')
    expect(states[isoResourceKey('conn-b', 'same-sr')].items[0].nameLabel).toBe('conn-b')
    await useStorageAdvancedStore.getState().deleteIso('conn-b', 'same-iso')
    expect(mockXapi.iso.delete).toHaveBeenCalledWith('conn-b', 'same-iso')
  })

  it('ignores older ISO responses and clears rows on the latest read failure', async () => {
    let oldResolve!: (value: any[]) => void
    mockXapi.iso.list.mockImplementationOnce(() => new Promise((resolve) => { oldResolve = resolve }))
      .mockRejectedValueOnce(new Error('offline'))
    const first = useStorageAdvancedStore.getState().loadIsos('conn-a', 'sr')
    await useStorageAdvancedStore.getState().loadIsos('conn-a', 'sr')
    oldResolve([{ ref: 'stale' }]); await first
    expect(useStorageAdvancedStore.getState().isoStates[isoResourceKey('conn-a', 'sr')]).toEqual({ items: [], loading: false, error: 'offline' })
  })

  it('retains the last successful ISO list when refreshing fails', async () => {
    mockXapi.iso.list.mockResolvedValueOnce([{ ref: 'known' }]).mockRejectedValueOnce(new Error('offline'))
    await useStorageAdvancedStore.getState().loadIsos('conn-a', 'sr')
    await useStorageAdvancedStore.getState().loadIsos('conn-a', 'sr')
    expect(useStorageAdvancedStore.getState().isoStates[isoResourceKey('conn-a', 'sr')])
      .toEqual({ items: [{ ref: 'known' }], loading: false, error: 'offline' })
  })

  it('keeps concurrent same-ref PBD lists in their own pools and ignores an older refresh', async () => {
    let oldResolve!: (value: any[]) => void
    mockXapi.pbd.list.mockImplementationOnce(() => new Promise((resolve) => { oldResolve = resolve }))
      .mockResolvedValueOnce([{ ref: 'same', connectionId: 'conn-b' }])
      .mockResolvedValueOnce([{ ref: 'same', connectionId: 'conn-a', currently_attached: true }])
    const first = useStorageAdvancedStore.getState().loadPbds('conn-a')
    await useStorageAdvancedStore.getState().loadPbds('conn-b')
    await useStorageAdvancedStore.getState().loadPbds('conn-a')
    oldResolve([{ ref: 'outdated', connectionId: 'conn-a' }]); await first
    expect(useStorageAdvancedStore.getState().pbdStates['conn-a'].items).toEqual([{ ref: 'same', connectionId: 'conn-a', currently_attached: true }])
    expect(useStorageAdvancedStore.getState().pbdStates['conn-b'].items).toEqual([{ ref: 'same', connectionId: 'conn-b' }])
  })

  it('keeps failed PBD reads scoped and refreshes after a plug error', async () => {
    mockXapi.pbd.list.mockResolvedValueOnce([{ ref: 'a', connectionId: 'conn-a' }])
      .mockRejectedValueOnce(new Error('permission denied'))
    await useStorageAdvancedStore.getState().loadPbds('conn-a')
    mockXapi.pbd.plug.mockRejectedValueOnce(new Error('response lost'))
    await expect(useStorageAdvancedStore.getState().plugPbd('a', 'conn-a')).rejects.toThrow('response lost')
    expect(useStorageAdvancedStore.getState().pbdStates['conn-a']).toEqual({
      items: [{ ref: 'a', connectionId: 'conn-a' }], loading: false, error: 'permission denied',
    })
    expect(mockXapi.pbd.plug).toHaveBeenCalledTimes(1)
  })

  it('invalidates in-flight PBD and ISO reads when a connection generation changes', async () => {
    useConnectionManagerStore.setState({ connections: [{ id: 'conn-a', state: 'connected', epoch: 1 }] as any })
    let resolvePbd!: (value: any[]) => void
    let resolveIso!: (value: any[]) => void
    mockXapi.pbd.list.mockImplementationOnce(() => new Promise((resolve) => { resolvePbd = resolve }))
    mockXapi.iso.list.mockImplementationOnce(() => new Promise((resolve) => { resolveIso = resolve }))
    const reads = [useStorageAdvancedStore.getState().loadPbds('conn-a'), useStorageAdvancedStore.getState().loadIsos('conn-a', 'sr')]
    useConnectionManagerStore.setState({ connections: [{ id: 'conn-a', state: 'connected', epoch: 2 }] as any })
    resolvePbd([{ ref: 'old-pbd' }]); resolveIso([{ ref: 'old-iso' }]); await Promise.all(reads)
    expect(useStorageAdvancedStore.getState().pbdStates['conn-a']).toBeUndefined()
    expect(useStorageAdvancedStore.getState().isoStates[isoResourceKey('conn-a', 'sr')]).toBeUndefined()
  })

})
