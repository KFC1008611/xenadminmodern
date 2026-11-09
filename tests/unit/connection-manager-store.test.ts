import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useConnectionManagerStore } from '../../src/renderer/src/store/connectionManager.store'
import type { ConnectionInfo } from '../../src/renderer/src/types/xapi'

const mockXapi = {
  connection: {
    connect: vi.fn(),
    disconnect: vi.fn(),
    reconnect: vi.fn(),
    list: vi.fn(),
  },
  profiles: {
    list: vi.fn(),
    connect: vi.fn(),
  },
}

function connection(id: string, state: ConnectionInfo['state']): ConnectionInfo {
  return {
    id,
    name: id,
    host: `${id}.example.test`,
    poolName: state === 'connected' ? id : null,
    poolRef: state === 'connected' ? `OpaqueRef:${id}` : null,
    state,
    errorMessage: state === 'error' ? 'failed' : null,
    connectedAt: state === 'connected' ? 1 : null,
  }
}

describe('connection manager store active connection selection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(globalThis as any).window = { xapi: mockXapi }
    useConnectionManagerStore.setState({
      connections: [],
      activeConnectionId: null,
      isLoading: false,
      error: null,
    })
  })

  it('disconnect(active) switches active to the next connected connection', async () => {
    useConnectionManagerStore.setState({
      connections: [
        connection('conn-a', 'connected'),
        connection('conn-b', 'error'),
        connection('conn-c', 'connected'),
      ],
      activeConnectionId: 'conn-a',
    })
    mockXapi.connection.disconnect.mockResolvedValue(undefined)
    mockXapi.connection.list.mockResolvedValue([
      connection('conn-a', 'disconnected'),
      connection('conn-b', 'error'),
      connection('conn-c', 'connected'),
    ])

    await useConnectionManagerStore.getState().disconnect('conn-a')

    expect(useConnectionManagerStore.getState().activeConnectionId).toBe('conn-c')
  })

  it('refreshConnections falls back when active is no longer connected', async () => {
    useConnectionManagerStore.setState({
      connections: [
        connection('conn-a', 'connected'),
        connection('conn-b', 'connected'),
      ],
      activeConnectionId: 'conn-a',
    })
    mockXapi.connection.list.mockResolvedValue([
      connection('conn-a', 'error'),
      connection('conn-b', 'connected'),
    ])

    await useConnectionManagerStore.getState().refreshConnections()

    expect(useConnectionManagerStore.getState().activeConnectionId).toBe('conn-b')
  })

  it('refreshConnections clears active when no connected connections remain', async () => {
    useConnectionManagerStore.setState({
      connections: [connection('conn-a', 'connected')],
      activeConnectionId: 'conn-a',
    })
    mockXapi.connection.list.mockResolvedValue([
      connection('conn-a', 'disconnected'),
      connection('conn-b', 'error'),
    ])

    await useConnectionManagerStore.getState().refreshConnections()

    expect(useConnectionManagerStore.getState().activeConnectionId).toBeNull()
  })

  it('setActiveConnection does not select a non-connected id', () => {
    useConnectionManagerStore.setState({
      connections: [
        connection('conn-a', 'connected'),
        connection('conn-b', 'error'),
      ],
      activeConnectionId: 'conn-a',
    })

    useConnectionManagerStore.getState().setActiveConnection('conn-b')

    expect(useConnectionManagerStore.getState().activeConnectionId).toBe('conn-a')
  })

  it('removeConnection(active) applies the same connected-only rule', () => {
    useConnectionManagerStore.setState({
      connections: [
        connection('conn-a', 'connected'),
        connection('conn-b', 'error'),
        connection('conn-c', 'connected'),
      ],
      activeConnectionId: 'conn-a',
    })

    useConnectionManagerStore.getState().removeConnection('conn-a')

    expect(useConnectionManagerStore.getState().activeConnectionId).toBe('conn-c')
  })
  it('auto-connects saved profiles through main without retrieving secrets', async () => {
    mockXapi.profiles.list.mockResolvedValue([{ id: 'saved', name: 'Saved', host: 'saved.test', autoConnect: true }])
    mockXapi.profiles.connect.mockResolvedValue({ id: 'saved' })
    mockXapi.connection.list.mockResolvedValue([connection('saved', 'connected')])
    await useConnectionManagerStore.getState().loadSavedConnections()
    expect(mockXapi.profiles.connect).toHaveBeenCalledWith('saved', undefined)
    expect(mockXapi.connection.connect).not.toHaveBeenCalled()
    expect(useConnectionManagerStore.getState().activeConnectionId).toBe('saved')
  })

  it('lets a second saved server connect while the first credential access is still pending', async () => {
    const pending = deferred<{ id: string }>()
    mockXapi.profiles.list.mockResolvedValue([{ id: 'slow', name: 'Slow', autoConnect: true }, { id: 'fast', name: 'Fast', autoConnect: true }])
    mockXapi.profiles.connect.mockImplementation((id: string) => id === 'slow' ? pending.promise : Promise.resolve({ id }))
    mockXapi.connection.list.mockResolvedValue([connection('fast', 'connected')])
    const restoring = useConnectionManagerStore.getState().loadSavedConnections()
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    expect(mockXapi.profiles.connect).toHaveBeenCalledWith('fast', undefined)
    pending.resolve({ id: 'slow' })
    await restoring
  })

  it('retains auto-connect failures for the connection page', async () => {
    mockXapi.profiles.list.mockResolvedValue([{ id: 'saved', name: 'Saved', autoConnect: true }])
    mockXapi.profiles.connect.mockRejectedValue(new Error('密码已失效'))
    await useConnectionManagerStore.getState().loadSavedConnections()
    expect(useConnectionManagerStore.getState().error).toBe('Saved: 密码已失效')
  })

})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail })
  return { promise, resolve, reject }
}

describe('connection list response ordering', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    ;(globalThis as any).window = { xapi: mockXapi }
    useConnectionManagerStore.setState({ connections: [], activeConnectionId: null, isLoading: false, error: null })
  })

  it('ignores an older connected list after the disconnect readback', async () => {
    const oldList = deferred<ConnectionInfo[]>()
    mockXapi.connection.list.mockReturnValueOnce(oldList.promise).mockResolvedValueOnce([connection('a', 'disconnected')])
    mockXapi.connection.disconnect.mockResolvedValue(undefined)
    const refreshing = useConnectionManagerStore.getState().refreshConnections()
    await useConnectionManagerStore.getState().disconnect('a')
    oldList.resolve([connection('a', 'connected')])
    await refreshing
    expect(useConnectionManagerStore.getState().connections[0].state).toBe('disconnected')
    expect(useConnectionManagerStore.getState().activeConnectionId).toBeNull()
  })

  it('invalidates an outstanding list as soon as a mutation begins', async () => {
    const oldList = deferred<ConnectionInfo[]>()
    const disconnecting = deferred<void>()
    mockXapi.connection.list.mockReturnValueOnce(oldList.promise).mockResolvedValueOnce([])
    mockXapi.connection.disconnect.mockReturnValue(disconnecting.promise)
    const refreshing = useConnectionManagerStore.getState().refreshConnections()
    const mutation = useConnectionManagerStore.getState().disconnect('a')
    oldList.resolve([connection('a', 'connected')])
    await refreshing
    expect(useConnectionManagerStore.getState().connections).toEqual([])
    disconnecting.resolve()
    await mutation
  })

  it('ignores an older list error after a newer successful list', async () => {
    const oldList = deferred<ConnectionInfo[]>()
    mockXapi.connection.list.mockReturnValueOnce(oldList.promise).mockResolvedValueOnce([connection('b', 'connected')])
    const refreshing = useConnectionManagerStore.getState().refreshConnections()
    await useConnectionManagerStore.getState().refreshConnections()
    oldList.reject(new Error('stale failure'))
    await refreshing
    expect(useConnectionManagerStore.getState().error).toBeNull()
    expect(useConnectionManagerStore.getState().activeConnectionId).toBe('b')
  })

  it('coalesces concurrent saved connection restoration', async () => {
    const profiles = deferred<any[]>()
    mockXapi.profiles.list.mockReturnValue(profiles.promise)
    mockXapi.profiles.connect.mockResolvedValue({ id: 'saved' })
    mockXapi.connection.list.mockResolvedValue([connection('saved', 'connected')])
    const first = useConnectionManagerStore.getState().loadSavedConnections()
    const second = useConnectionManagerStore.getState().loadSavedConnections()
    profiles.resolve([{ id: 'saved', name: 'Saved', autoConnect: true }])
    await Promise.all([first, second])
    expect(mockXapi.profiles.list).toHaveBeenCalledTimes(1)
    expect(mockXapi.profiles.connect).toHaveBeenCalledTimes(1)
  })
})
