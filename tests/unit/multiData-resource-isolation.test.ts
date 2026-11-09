import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useConnectionManagerStore } from '../../src/renderer/src/store/connectionManager.store'
import { useMultiDataStore } from '../../src/renderer/src/store/multiData.store'

const mockXapi = {
  vm: { list: vi.fn() },
  host: { list: vi.fn() },
  storage: { listSrs: vi.fn() },
  network: { list: vi.fn() },
  tasks: { list: vi.fn() },
  pool: { get: vi.fn() },
}

describe('unified resource refresh', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubGlobal('window', { xapi: mockXapi })
    mockXapi.vm.list.mockResolvedValue([{ ref: 'OpaqueRef:vm' }])
    mockXapi.host.list.mockResolvedValue([{ ref: 'OpaqueRef:host' }])
    mockXapi.storage.listSrs.mockResolvedValue([{ ref: 'OpaqueRef:sr' }])
    mockXapi.network.list.mockResolvedValue([{ ref: 'OpaqueRef:network' }])
    mockXapi.tasks.list.mockRejectedValue(new Error('IPC_RESULT_INVALID'))
    mockXapi.pool.get.mockResolvedValue({ ref: 'OpaqueRef:pool' })
    useConnectionManagerStore.setState({
      connections: [{
        id: 'conn-1',
        name: 'Pool A',
        host: '192.0.2.1',
        poolName: 'Pool A',
        poolRef: 'OpaqueRef:pool',
        state: 'connected',
        errorMessage: null,
        connectedAt: 1,
      }],
      activeConnectionId: 'conn-1',
    })
    useMultiDataStore.setState({
      vms: [], hosts: [], srs: [], networks: [], tasks: [], pools: [],
      loading: false, loadingConnections: [], errors: {}, lastRefresh: null, domainStates: {},
    })
  })

  afterEach(() => {
    useConnectionManagerStore.setState({ connections: [] })
    vi.unstubAllGlobals()
  })

  it('keeps successful resource lists available and reports a failed task read', async () => {
    await useMultiDataStore.getState().refreshAll()

    const state = useMultiDataStore.getState()
    expect(state.vms[0]).toMatchObject({ ref: 'OpaqueRef:vm', connectionId: 'conn-1' })
    expect(state.hosts[0]).toMatchObject({ ref: 'OpaqueRef:host', poolName: 'Pool A' })
    expect(state.srs).toHaveLength(1)
    expect(state.networks).toHaveLength(1)
    expect(state.pools).toHaveLength(1)
    expect(state.tasks).toEqual([])
    expect(state.errors['conn-1']).toContain('任务：IPC_RESULT_INVALID')
  })

  it('preserves resource array identities when connection status polling removes no connection', async () => {
    await useMultiDataStore.getState().refreshVms()
    const previous = useMultiDataStore.getState()
    useConnectionManagerStore.setState((state) => ({ connections: state.connections.map((connection) => ({ ...connection })) }))
    const next = useMultiDataStore.getState()
    expect(next.vms).toBe(previous.vms)
    expect(next.hosts).toBe(previous.hosts)
    expect(next.networks).toBe(previous.networks)
    expect(next.domainStates).toBe(previous.domainStates)
  })

  it('refreshes a connection independently and clears the error after recovery', async () => {
    await useMultiDataStore.getState().refreshAll()
    mockXapi.tasks.list.mockResolvedValue([{ ref: 'OpaqueRef:task' }])

    await useMultiDataStore.getState().refreshConnection('conn-1')

    const state = useMultiDataStore.getState()
    expect(state.tasks[0]).toMatchObject({ ref: 'OpaqueRef:task', connectionId: 'conn-1' })
    expect(state.vms).toHaveLength(1)
    expect(state.errors).toEqual({})
  })
  it('retains last successful rows and timestamp when a later domain read fails', async () => {
    await useMultiDataStore.getState().refreshVms()
    const previous = useMultiDataStore.getState().domainStates['conn-1'].vms!.lastSuccessAt
    mockXapi.vm.list.mockRejectedValueOnce(new Error('offline'))
    await useMultiDataStore.getState().refreshVms()
    expect(useMultiDataStore.getState().vms).toHaveLength(1)
    expect(useMultiDataStore.getState().domainStates['conn-1'].vms).toEqual({ loading: false, error: 'offline', lastSuccessAt: previous })
  })

  it('coalesces concurrent refreshes of the same domain and connection', async () => {
    let finish!: (rows: object[]) => void
    mockXapi.vm.list.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const first = useMultiDataStore.getState().refreshVms()
    const second = useMultiDataStore.getState().refreshVms()
    expect(mockXapi.vm.list).toHaveBeenCalledTimes(1)
    finish([{ ref: 'OpaqueRef:new' }])
    await Promise.all([first, second])
    expect(useMultiDataStore.getState().vms.map((vm) => vm.ref)).toEqual(['OpaqueRef:new'])
  })

  it.each(['rename', 'delete'] as const)('rereads serially after network %s and never publishes the older response', async (operation) => {
    const oldNetwork = { ref: 'OpaqueRef:network', name_label: 'Old name', connectionId: 'conn-1' }
    useMultiDataStore.setState({ networks: [oldNetwork] as any,
      domainStates: { 'conn-1': { networks: { loading: false, error: null, lastSuccessAt: 10 } } } })
    let finishOld!: (rows: object[]) => void
    let finishNew!: (rows: object[]) => void
    mockXapi.network.list
      .mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve }))
      .mockImplementationOnce(() => new Promise((resolve) => { finishNew = resolve }))
    const background = useMultiDataStore.getState().refreshNetworks()
    const afterMutation = useMultiDataStore.getState().refreshNetworks({ afterMutation: true, connectionId: 'conn-1' })
    const joined = useMultiDataStore.getState().refreshNetworks({ afterMutation: true, connectionId: 'conn-1' })
    expect(mockXapi.network.list).toHaveBeenCalledTimes(1)
    finishOld([{ ...oldNetwork, name_label: 'Obsolete response' }])
    await vi.waitFor(() => expect(mockXapi.network.list).toHaveBeenCalledTimes(2))
    expect(useMultiDataStore.getState().networks[0].name_label).toBe('Old name')
    expect(useMultiDataStore.getState().domainStates['conn-1'].networks).toEqual({ loading: true, error: null, lastSuccessAt: 10 })
    finishNew(operation === 'rename' ? [{ ...oldNetwork, name_label: 'New name' }] : [])
    await Promise.all([background, afterMutation, joined])
    expect(useMultiDataStore.getState().networks.map((row) => row.name_label)).toEqual(operation === 'rename' ? ['New name'] : [])
    expect(useMultiDataStore.getState().domainStates['conn-1'].networks?.loading).toBe(false)
    expect(mockXapi.network.list).toHaveBeenCalledTimes(2)
  })

  it('retains previous data and freshness when the post-mutation read fails', async () => {
    await useMultiDataStore.getState().refreshNetworks()
    const previousRows = useMultiDataStore.getState().networks
    const previousSuccess = useMultiDataStore.getState().domainStates['conn-1'].networks!.lastSuccessAt
    let finish!: (rows: object[]) => void
    mockXapi.network.list
      .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
      .mockRejectedValueOnce(new Error('network read unavailable'))
    const background = useMultiDataStore.getState().refreshNetworks()
    const mutationRefresh = useMultiDataStore.getState().refreshNetworks({ afterMutation: true })
    finish([{ ref: 'OpaqueRef:obsolete' }])
    await Promise.all([background, mutationRefresh])
    expect(useMultiDataStore.getState().networks).toEqual(previousRows)
    expect(useMultiDataStore.getState().domainStates['conn-1'].networks).toEqual({
      loading: false, error: 'network read unavailable', lastSuccessAt: previousSuccess,
    })
  })

  it('queues another read when a second mutation finishes during the follow-up', async () => {
    let finishFirst!: (rows: object[]) => void
    let finishSecond!: (rows: object[]) => void
    mockXapi.network.list
      .mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve }))
      .mockImplementationOnce(() => new Promise((resolve) => { finishSecond = resolve }))
      .mockResolvedValueOnce([{ ref: 'OpaqueRef:network', name_label: 'Final name' }])
    const background = useMultiDataStore.getState().refreshNetworks()
    const firstMutation = useMultiDataStore.getState().refreshNetworks({ afterMutation: true })
    finishFirst([{ ref: 'OpaqueRef:network', name_label: 'Old name' }])
    await vi.waitFor(() => expect(mockXapi.network.list).toHaveBeenCalledTimes(2))
    const secondMutation = useMultiDataStore.getState().refreshNetworks({ afterMutation: true })
    finishSecond([{ ref: 'OpaqueRef:network', name_label: 'Intermediate name' }])
    await Promise.all([background, firstMutation, secondMutation])
    expect(mockXapi.network.list).toHaveBeenCalledTimes(3)
    expect(useMultiDataStore.getState().networks[0].name_label).toBe('Final name')
  })

  it('invalidates only the mutation pool while sharing ordinary reads in the other pool', async () => {
    const connection = useConnectionManagerStore.getState().connections[0]
    useConnectionManagerStore.setState({ connections: [connection, { ...connection, id: 'conn-2' }] })
    const finishes = new Map<string, (rows: object[]) => void>()
    mockXapi.network.list.mockImplementation((id: string) => new Promise((resolve) => { finishes.set(id, resolve) }))
    const background = useMultiDataStore.getState().refreshNetworks()
    const mutationRefresh = useMultiDataStore.getState().refreshNetworks({ afterMutation: true, connectionId: 'conn-1' })
    expect(mockXapi.network.list).toHaveBeenCalledTimes(2)
    finishes.get('conn-2')!([{ ref: 'OpaqueRef:other', name_label: 'Other pool' }])
    finishes.get('conn-1')!([{ ref: 'OpaqueRef:old' }])
    await vi.waitFor(() => expect(mockXapi.network.list).toHaveBeenCalledTimes(3))
    finishes.get('conn-1')!([{ ref: 'OpaqueRef:new', name_label: 'Updated pool' }])
    await Promise.all([background, mutationRefresh])
    expect(mockXapi.network.list.mock.calls.map(([id]) => id)).toEqual(['conn-1', 'conn-2', 'conn-1'])
    expect(useMultiDataStore.getState().networks.map((row) => row.name_label)).toEqual(['Updated pool', 'Other pool'])
  })

  it('discards a queued mutation refresh after the connection epoch changes', async () => {
    let finish!: (rows: object[]) => void
    mockXapi.network.list.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const background = useMultiDataStore.getState().refreshNetworks()
    const mutationRefresh = useMultiDataStore.getState().refreshNetworks({ afterMutation: true })
    useConnectionManagerStore.setState((state) => ({ connections: state.connections.map((c) => ({ ...c, epoch: 2 })) }))
    await useMultiDataStore.getState().refreshNetworks()
    finish([{ ref: 'OpaqueRef:old-session' }])
    await Promise.all([background, mutationRefresh])
    expect(mockXapi.network.list).toHaveBeenCalledTimes(2)
    expect(useMultiDataStore.getState().networks.map((row) => row.ref)).toEqual(['OpaqueRef:network'])
    expect(useMultiDataStore.getState().loading).toBe(false)
  })

  it('invalidates reads across reconnect epochs and clears pending state', async () => {
    let finish!: (rows: object[]) => void
    mockXapi.vm.list.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const pending = useMultiDataStore.getState().refreshVms()
    useConnectionManagerStore.setState((state) => ({ connections: state.connections.map((c) => ({ ...c, epoch: 2 })) }))
    finish([{ ref: 'OpaqueRef:old-session' }])
    await pending
    expect(useMultiDataStore.getState().vms).toEqual([])
    expect(useMultiDataStore.getState().loading).toBe(false)
  })

  it('does not restore removed connection records from an in-flight response', async () => {
    let finish!: (rows: object[]) => void
    mockXapi.vm.list.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const pending = useMultiDataStore.getState().refreshVms()
    useConnectionManagerStore.setState({ connections: [] })
    finish([{ ref: 'OpaqueRef:removed' }])
    await pending
    expect(useMultiDataStore.getState().vms).toEqual([])
    expect(useMultiDataStore.getState().domainStates).toEqual({})
  })

  it('drops previous pool rows when a saved connection resolves to a different pool identity', async () => {
    useConnectionManagerStore.setState((state) => ({ connections: state.connections.map((c) => ({ ...c, poolUuid: 'pool-a' })) }))
    await useMultiDataStore.getState().refreshAll()
    useConnectionManagerStore.setState((state) => ({ connections: state.connections.map((c) => ({ ...c, epoch: 2, poolUuid: 'pool-b' })) }))
    const state = useMultiDataStore.getState()
    expect(state.vms).toEqual([])
    expect(state.srs).toEqual([])
    expect(state.networks).toEqual([])
    expect(state.domainStates['conn-1']).toBeUndefined()
  })

  it('retains data while a reconnect has no pool UUID, then rejects a confirmed replacement pool', async () => {
    useConnectionManagerStore.setState((state) => ({ connections: state.connections.map((c) => ({ ...c, poolUuid: 'pool-a' })) }))
    await useMultiDataStore.getState().refreshVms()
    useConnectionManagerStore.setState((state) => ({ connections: state.connections.map((c) => ({ ...c, state: 'connecting', poolUuid: undefined, epoch: 2 })) }))
    expect(useMultiDataStore.getState().vms).toHaveLength(1)
    useConnectionManagerStore.setState((state) => ({ connections: state.connections.map((c) => ({ ...c, state: 'connected', poolUuid: 'pool-b', epoch: 3 })) }))
    expect(useMultiDataStore.getState().vms).toEqual([])
  })

  it('ignores queued VM events from before the new authenticated connection', () => {
    useConnectionManagerStore.setState((state) => ({ connections: state.connections.map((c) => ({ ...c, connectedAt: 100 })) }))
    useMultiDataStore.getState().handleVmChangeEvent({ connectionId: 'conn-1', operation: 'add', ref: 'OpaqueRef:old', receivedAt: 99,
      snapshot: { is_a_template: false, is_a_snapshot: false, is_control_domain: false } as any })
    expect(useMultiDataStore.getState().vms).toEqual([])
  })

})
