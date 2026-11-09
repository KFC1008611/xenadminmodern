import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useConnectionManagerStore } from '../../src/renderer/src/store/connectionManager.store'
import { useMultiDataStore } from '../../src/renderer/src/store/multiData.store'

const mockXapi = {
  vm: { list: vi.fn().mockResolvedValue([]) },
  host: { list: vi.fn().mockResolvedValue([]) },
  storage: { listSrs: vi.fn().mockResolvedValue([]) },
  network: { list: vi.fn().mockResolvedValue([]) },
  tasks: { list: vi.fn().mockResolvedValue([]) },
  pool: { get: vi.fn().mockResolvedValue(null) },
}

function vmRecord(ref: string, overrides: Record<string, unknown> = {}) {
  return {
    ref,
    uuid: ref,
    name_label: ref,
    name_description: '',
    power_state: 'Halted',
    resident_on: 'OpaqueRef:NULL',
    VCPUs_max: 1,
    VCPUs_at_startup: 1,
    memory_static_max: 1024,
    memory_dynamic_max: 1024,
    is_a_template: false,
    is_a_snapshot: false,
    is_control_domain: false,
    VBDs: [],
    VIFs: [],
    metrics: 'OpaqueRef:NULL',
    guest_metrics: 'OpaqueRef:NULL',
    consoles: [],
    connectionId: 'conn-1',
    poolName: 'Pool A',
    ...overrides,
  } as any
}

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('multiData VM change events', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    ;(globalThis as any).window = { xapi: mockXapi }
    useConnectionManagerStore.setState({
      connections: [{
        id: 'conn-1',
        name: 'Pool A',
        host: '10.0.0.1',
        poolName: 'Pool A',
        poolRef: 'OpaqueRef:pool1',
        state: 'connected',
        errorMessage: null,
        connectedAt: Date.now(),
      }],
      activeConnectionId: 'conn-1',
    })
    useMultiDataStore.setState({
      vms: [],
      hosts: [],
      srs: [],
      networks: [],
      tasks: [],
      pools: [],
      loading: false,
      loadingConnections: [],
      errors: {},
      lastRefresh: null,
    })
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('applies deletion and complete VM snapshots without reading the inventory again', async () => {
    useMultiDataStore.setState({
      vms: [
        vmRecord('OpaqueRef:vm1'),
        vmRecord('OpaqueRef:vm2'),
      ],
    })

    const { handleVmChangeEvent } = useMultiDataStore.getState()
    handleVmChangeEvent({
      connectionId: 'conn-1',
      operation: 'del',
      ref: 'OpaqueRef:vm1',
      receivedAt: Date.now(),
    })
    handleVmChangeEvent({
      connectionId: 'conn-1',
      operation: 'mod',
      ref: 'OpaqueRef:vm2',
      snapshot: vmRecord('OpaqueRef:vm2', { power_state: 'Running' }),
      receivedAt: Date.now(),
    })

    expect(useMultiDataStore.getState().vms.map((vm) => vm.ref)).toEqual(['OpaqueRef:vm2'])

    await vi.advanceTimersByTimeAsync(750)
    await flushPromises()

    expect(mockXapi.vm.list).not.toHaveBeenCalled()
    expect(mockXapi.host.list).not.toHaveBeenCalled()
    expect(mockXapi.storage.listSrs).not.toHaveBeenCalled()
    expect(mockXapi.network.list).not.toHaveBeenCalled()
    expect(mockXapi.tasks.list).not.toHaveBeenCalled()
    expect(mockXapi.pool.get).not.toHaveBeenCalled()
  })

  it('serially reconciles an event that supersedes a pending snapshot and finishes loading', async () => {
    let finish!: (rows: object[]) => void
    mockXapi.vm.list.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const pending = useMultiDataStore.getState().refreshVms()
    useMultiDataStore.getState().handleVmChangeEvent({ connectionId: 'conn-1', operation: 'del', ref: 'OpaqueRef:vm1', receivedAt: Date.now() })
    await vi.advanceTimersByTimeAsync(750)
    expect(mockXapi.vm.list).toHaveBeenCalledTimes(1)
    finish([vmRecord('OpaqueRef:vm1')])
    await pending
    expect(mockXapi.vm.list).toHaveBeenCalledTimes(2)
    expect(useMultiDataStore.getState().vms).toEqual([])
    expect(useMultiDataStore.getState().domainStates['conn-1'].vms?.loading).toBe(false)
  })

  it('does not amplify a continuous stream of complete snapshots into inventory reads', async () => {
    const revision = useMultiDataStore.getState().templateRevision
    for (let i = 0; i < 600; i++) {
      useMultiDataStore.getState().handleVmChangeEvent({ connectionId: 'conn-1', operation: 'mod', ref: 'vm',
        snapshot: vmRecord('vm', { name_label: `Update ${i}` }), receivedAt: Date.now() })
      await vi.advanceTimersByTimeAsync(100)
    }
    await vi.advanceTimersByTimeAsync(1000)
    expect(mockXapi.vm.list).not.toHaveBeenCalled()
    expect(useMultiDataStore.getState().vms[0].name_label).toBe('Update 599')
    expect(useMultiDataStore.getState().templateRevision).toBe(revision + 1)
  })

  it('invalidates cached templates when a provisioned clone first becomes a VM', () => {
    const { handleVmChangeEvent } = useMultiDataStore.getState()
    handleVmChangeEvent({ connectionId: 'conn-1', operation: 'add', ref: 'clone',
      snapshot: vmRecord('clone', { is_a_template: true }), receivedAt: Date.now() })
    expect(useMultiDataStore.getState().vms).toEqual([])
    const revision = useMultiDataStore.getState().templateRevision
    handleVmChangeEvent({ connectionId: 'conn-1', operation: 'mod', ref: 'clone',
      snapshot: vmRecord('clone'), receivedAt: Date.now() })
    expect(useMultiDataStore.getState().templateRevision).toBe(revision + 1)
    expect(useMultiDataStore.getState().vms).toHaveLength(1)
  })

  it('coalesces readback for missing guest IP data and skips it once the same guest is complete', async () => {
    const record = vmRecord('vm', { power_state: 'Running', guest_metrics: 'guest', networks: { '0/ip': '192.0.2.5' } })
    mockXapi.vm.list.mockResolvedValueOnce([record])
    const event = () => useMultiDataStore.getState().handleVmChangeEvent({ connectionId: 'conn-1', operation: 'mod', ref: 'vm',
      snapshot: vmRecord('vm', { power_state: 'Running', guest_metrics: 'guest' }), receivedAt: Date.now() })
    event(); event(); event()
    await vi.advanceTimersByTimeAsync(750)
    expect(mockXapi.vm.list).toHaveBeenCalledTimes(1)
    expect(useMultiDataStore.getState().vms[0].networks).toEqual(record.networks)
    event()
    await vi.advanceTimersByTimeAsync(1000)
    expect(mockXapi.vm.list).toHaveBeenCalledTimes(1)
  })

  it('reads back events whose snapshot is missing', async () => {
    useMultiDataStore.getState().handleVmChangeEvent({ connectionId: 'conn-1', operation: 'mod', ref: 'vm', receivedAt: Date.now() })
    await vi.advanceTimersByTimeAsync(750)
    expect(mockXapi.vm.list).toHaveBeenCalledTimes(1)
  })

  it('retains the last complete record and reads back an incomplete snapshot', async () => {
    const previous = vmRecord('vm')
    useMultiDataStore.setState({ vms: [previous] })
    mockXapi.vm.list.mockResolvedValueOnce([vmRecord('vm', { name_label: 'Read back' })])
    useMultiDataStore.getState().handleVmChangeEvent({ connectionId: 'conn-1', operation: 'mod', ref: 'vm',
      snapshot: { power_state: 'Running' }, receivedAt: Date.now() })
    expect(useMultiDataStore.getState().vms[0]).toBe(previous)
    await vi.advanceTimersByTimeAsync(750)
    expect(mockXapi.vm.list).toHaveBeenCalledTimes(1)
    expect(useMultiDataStore.getState().vms[0].name_label).toBe('Read back')
  })

  it('keeps guest IPs through VM updates and clears them after guest replacement or shutdown', () => {
    const initial = vmRecord('OpaqueRef:vm1', { power_state: 'Running', guest_metrics: 'OpaqueRef:guest', networks: { '0/ip': '192.0.2.10' } })
    useMultiDataStore.setState({ vms: [initial, { ...initial, connectionId: 'other-pool', networks: { '0/ip': '192.0.2.20' } }] })
    const update = (overrides: Record<string, unknown>) => useMultiDataStore.getState().handleVmChangeEvent({ connectionId: 'conn-1', operation: 'mod', ref: initial.ref,
      snapshot: vmRecord(initial.ref, { power_state: 'Running', guest_metrics: initial.guest_metrics, ...overrides }), receivedAt: Date.now() })
    update({ name_label: 'Renamed VM' })
    expect(useMultiDataStore.getState().vms[0].networks).toEqual(initial.networks)
    expect(useMultiDataStore.getState().vms[1].networks).toEqual({ '0/ip': '192.0.2.20' })
    update({ guest_metrics: 'OpaqueRef:new-guest' })
    expect(useMultiDataStore.getState().vms[0].networks).toBeUndefined()
    useMultiDataStore.setState({ vms: [initial] })
    update({ power_state: 'Halted' })
    expect(useMultiDataStore.getState().vms[0].networks).toBeUndefined()
  })

  it('upserts visible VM snapshots and filters templates, snapshots, and control domains', () => {
    const { handleVmChangeEvent } = useMultiDataStore.getState()

    handleVmChangeEvent({
      connectionId: 'conn-1',
      operation: 'mod',
      ref: 'OpaqueRef:vm1',
      snapshot: vmRecord('OpaqueRef:vm1', { power_state: 'Running' }),
      receivedAt: Date.now(),
    })

    expect(useMultiDataStore.getState().vms).toHaveLength(1)
    expect(useMultiDataStore.getState().vms[0]).toMatchObject({
      ref: 'OpaqueRef:vm1',
      power_state: 'Running',
      poolName: 'Pool A',
    })

    handleVmChangeEvent({
      connectionId: 'conn-1',
      operation: 'mod',
      ref: 'OpaqueRef:vm1',
      snapshot: vmRecord('OpaqueRef:vm1', { is_a_template: true }),
      receivedAt: Date.now(),
    })
    handleVmChangeEvent({
      connectionId: 'conn-1',
      operation: 'add',
      ref: 'OpaqueRef:snapshot',
      snapshot: vmRecord('OpaqueRef:snapshot', { is_a_snapshot: true }),
      receivedAt: Date.now(),
    })
    handleVmChangeEvent({
      connectionId: 'conn-1',
      operation: 'add',
      ref: 'OpaqueRef:dom0',
      snapshot: vmRecord('OpaqueRef:dom0', { is_control_domain: true }),
      receivedAt: Date.now(),
    })

    expect(useMultiDataStore.getState().vms).toEqual([])
  })

  it('settles joined refreshes during continuous events without applying obsolete snapshots', async () => {
    let finishFirst!: (rows: object[]) => void
    let finishSecond!: (rows: object[]) => void
    mockXapi.vm.list
      .mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve }))
      .mockImplementationOnce(() => new Promise((resolve) => { finishSecond = resolve }))
      .mockResolvedValue([])
    const pending = useMultiDataStore.getState().refreshVms()
    const joined = useMultiDataStore.getState().refreshVms()
    const event = () => useMultiDataStore.getState().handleVmChangeEvent({ connectionId: 'conn-1', operation: 'mod', ref: 'OpaqueRef:vm1', snapshot: vmRecord('OpaqueRef:vm1', { power_state: 'Running' }), receivedAt: Date.now() })
    event()
    finishFirst([vmRecord('OpaqueRef:vm1')])
    await flushPromises()
    expect(mockXapi.vm.list).toHaveBeenCalledTimes(2)
    event()
    await vi.advanceTimersByTimeAsync(750)
    finishSecond([vmRecord('OpaqueRef:vm1')])
    await Promise.all([pending, joined])
    expect(mockXapi.vm.list).toHaveBeenCalledTimes(2)
    expect(useMultiDataStore.getState().vms[0].power_state).toBe('Running')
    expect(useMultiDataStore.getState().domainStates['conn-1'].vms?.loading).toBe(false)
    await vi.advanceTimersByTimeAsync(750)
    expect(mockXapi.vm.list).toHaveBeenCalledTimes(3)
  })
})
