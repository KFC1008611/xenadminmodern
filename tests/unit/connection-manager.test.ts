/**
 * Unit tests for ConnectionManager — verifies multi-connection lifecycle management.
 * TB-001: Create ConnectionManager
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock XapiClient so we don't need a real XAPI server
const mockConnect = vi.fn()
const mockDisconnect = vi.fn()
const mockCallWithSession = vi.fn()
const mockGetSessionRef = vi.fn(() => 'OpaqueRef:mock-session')
const mockIsConnected = vi.fn(() => true)
const mockGetConnectedHost = vi.fn(() => null)
const mockGetConnectedPort = vi.fn(() => null)

vi.mock('../../src/main/xapi/client', () => ({
  XapiClient: vi.fn().mockImplementation(() => ({
    connect: mockConnect,
    disconnect: mockDisconnect,
    callWithSession: mockCallWithSession,
    getSessionRef: mockGetSessionRef,
    isConnected: mockIsConnected,
    getConnectedHost: mockGetConnectedHost,
    getConnectedPort: mockGetConnectedPort,
  })),
}))

vi.mock('../../src/main/xapi/services/vm-event.service', () => ({
  startVmEventWatcher: vi.fn(),
  stopVmEventWatcher: vi.fn(),
}))

const defaultOpts = {
  host: '192.168.1.1',
  port: 80,
  scheme: 'http:' as const,
  username: 'root',
  password: 'secret',
  allowSelfSigned: false,
}

function mockXapiRecords(options: {
  poolName?: string
  hostUuids?: string[]
} = {}) {
  let hostUuidIndex = 0
  mockCallWithSession.mockImplementation(async (method: string) => {
    if (method === 'pool.get_all') {
      return options.poolName ? ['OpaqueRef:pool1'] : []
    }
    if (method === 'pool.get_record') {
      return { name_label: options.poolName }
    }
    if (method === 'session.get_this_host') {
      return 'OpaqueRef:host1'
    }
    if (method === 'host.get_uuid') {
      const uuids = options.hostUuids ?? ['host-uuid-1']
      const uuid = uuids[Math.min(hostUuidIndex, uuids.length - 1)]
      hostUuidIndex += 1
      return uuid
    }
    return null
  })
}

describe('ConnectionManager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    mockGetConnectedHost.mockReturnValue(null)
    mockGetConnectedPort.mockReturnValue(null)
    mockXapiRecords()
  })

  it('connect() returns a UUID connection id', async () => {
    mockConnect.mockResolvedValueOnce('OpaqueRef:session1')
    mockXapiRecords({ poolName: 'Pool A' })

    const { ConnectionManager } = await import('../../src/main/xapi/connection-manager')
    const mgr = new ConnectionManager()
    const id = await mgr.connect(defaultOpts)

    expect(id).toMatch(/^[0-9a-f-]{36}$/) // UUID format
    expect(mockConnect).toHaveBeenCalledWith(defaultOpts)
  })

  it('connect() with explicit id stores that id', async () => {
    mockConnect.mockResolvedValueOnce('OpaqueRef:session1')

    const { ConnectionManager } = await import('../../src/main/xapi/connection-manager')
    const mgr = new ConnectionManager()
    const id = await mgr.connect(defaultOpts, 'my-stable-id')

    expect(id).toBe('my-stable-id')
  })

  it('connect() sets state to connected and records connectedAt', async () => {
    mockConnect.mockResolvedValueOnce('OpaqueRef:session1')
    mockXapiRecords({ poolName: 'Test Pool' })

    const { ConnectionManager } = await import('../../src/main/xapi/connection-manager')
    const mgr = new ConnectionManager()
    const id = await mgr.connect(defaultOpts)
    const info = mgr.getConnectionInfo(id)

    expect(info?.state).toBe('connected')
    expect(info?.connectedAt).toBeTypeOf('number')
    expect(info?.host).toBe('192.168.1.1')
  })

  it('connect() fetches pool name and stores it in ConnectionInfo', async () => {
    mockConnect.mockResolvedValueOnce('OpaqueRef:session1')
    mockXapiRecords({ poolName: 'Production Pool' })

    const { ConnectionManager } = await import('../../src/main/xapi/connection-manager')
    const mgr = new ConnectionManager()
    const id = await mgr.connect(defaultOpts)
    const info = mgr.getConnectionInfo(id)

    expect(info?.poolName).toBe('Production Pool')
    expect(info?.poolRef).toBe('OpaqueRef:pool1')
  })

  it('connect() sets state to error when XAPI connect fails', async () => {
    mockConnect.mockRejectedValueOnce(new Error('Connection refused'))

    const { ConnectionManager } = await import('../../src/main/xapi/connection-manager')
    const mgr = new ConnectionManager()

    await expect(mgr.connect(defaultOpts)).rejects.toThrow('Connection refused')

    // The manager should not retain a connection after failure
    const connections = mgr.listConnections()
    // State should reflect error even if listed (implementation may vary)
    if (connections.length > 0) {
      expect(connections[0].state).toBe('error')
    }
  })

  it('connect() replaces existing connection with same id', async () => {
    mockConnect.mockResolvedValue('OpaqueRef:session1')

    const { ConnectionManager } = await import('../../src/main/xapi/connection-manager')
    const mgr = new ConnectionManager()

    await mgr.connect(defaultOpts, 'stable-id')
    await mgr.connect({ ...defaultOpts, host: '192.168.1.2' }, 'stable-id')

    const info = mgr.getConnectionInfo('stable-id')
    expect(info?.host).toBe('192.168.1.2')
    // connect should have been called twice
    expect(mockConnect).toHaveBeenCalledTimes(2)
  })

  it('connect() rejects a duplicate active host endpoint', async () => {
    mockConnect.mockResolvedValue('OpaqueRef:session1')

    const { ConnectionManager } = await import('../../src/main/xapi/connection-manager')
    const mgr = new ConnectionManager()

    await mgr.connect(defaultOpts)
    await expect(mgr.connect({ ...defaultOpts, password: 'changed' })).rejects.toThrow('同一主机')

    expect(mgr.listConnections()).toHaveLength(1)
    expect(mockConnect).toHaveBeenCalledTimes(1)
  })

  it('connect() rejects the same XAPI host reached through different endpoints', async () => {
    mockConnect.mockResolvedValue('OpaqueRef:session1')

    const { ConnectionManager } = await import('../../src/main/xapi/connection-manager')
    const mgr = new ConnectionManager()

    const id = await mgr.connect(defaultOpts)
    await expect(mgr.connect({ ...defaultOpts, host: 'xcp-master.local' })).rejects.toThrow('同一主机')

    const connections = mgr.listConnections()
    expect(connections).toHaveLength(1)
    expect(connections[0]).toMatchObject({
      id,
      host: '192.168.1.1',
      state: 'connected',
    })
    expect(mockConnect).toHaveBeenCalledTimes(2)
  })

  it('connect() passes the current session ref when resolving host identity', async () => {
    mockConnect.mockResolvedValueOnce('OpaqueRef:session1')

    const { ConnectionManager } = await import('../../src/main/xapi/connection-manager')
    const mgr = new ConnectionManager()

    await mgr.connect(defaultOpts)

    expect(mockCallWithSession).toHaveBeenCalledWith(
      'session.get_this_host',
      ['OpaqueRef:mock-session'],
    )
    expect(mockCallWithSession).toHaveBeenCalledWith(
      'host.get_uuid',
      ['OpaqueRef:host1'],
    )
  })

  it('connect() removes stale failed connections before retrying the same host', async () => {
    mockConnect
      .mockRejectedValueOnce(new Error('Connection refused'))
      .mockResolvedValueOnce('OpaqueRef:session1')

    const { ConnectionManager } = await import('../../src/main/xapi/connection-manager')
    const mgr = new ConnectionManager()

    await expect(mgr.connect(defaultOpts)).rejects.toThrow('Connection refused')

    const id = await mgr.connect(defaultOpts)
    const connections = mgr.listConnections()

    expect(connections).toHaveLength(1)
    expect(connections[0]).toMatchObject({
      id,
      host: '192.168.1.1',
      state: 'connected',
    })
    expect(mockConnect).toHaveBeenCalledTimes(2)
  })

  it('connect() rejects a duplicate effective host after XAPI redirects to master', async () => {
    mockConnect.mockResolvedValue('OpaqueRef:session1')
    mockGetConnectedHost
      .mockReturnValueOnce(null)
      .mockReturnValueOnce('192.168.1.1')

    const { ConnectionManager } = await import('../../src/main/xapi/connection-manager')
    const mgr = new ConnectionManager()

    const id = await mgr.connect(defaultOpts)
    await expect(mgr.connect({ ...defaultOpts, host: '192.168.1.2' })).rejects.toThrow('同一主机')

    const connections = mgr.listConnections()
    expect(connections).toHaveLength(1)
    expect(connections[0]).toMatchObject({
      id,
      host: '192.168.1.1',
      state: 'connected',
    })
    expect(mockConnect).toHaveBeenCalledTimes(2)
  })

  it('getClient() returns the XapiClient for a known connectionId', async () => {
    mockConnect.mockResolvedValueOnce('OpaqueRef:session1')

    const { ConnectionManager } = await import('../../src/main/xapi/connection-manager')
    const mgr = new ConnectionManager()
    const id = await mgr.connect(defaultOpts)

    const client = mgr.getClient(id)
    expect(client).toBeDefined()
  })

  it('getClient() returns undefined for unknown connectionId', async () => {
    const { ConnectionManager } = await import('../../src/main/xapi/connection-manager')
    const mgr = new ConnectionManager()

    expect(mgr.getClient('non-existent')).toBeUndefined()
  })

  it('getConnectionInfo() returns undefined for unknown connectionId', async () => {
    const { ConnectionManager } = await import('../../src/main/xapi/connection-manager')
    const mgr = new ConnectionManager()

    expect(mgr.getConnectionInfo('non-existent')).toBeUndefined()
  })

  it('disconnect() retains a session for reconnect but makes its client unavailable', async () => {
    mockConnect.mockResolvedValueOnce('OpaqueRef:session1')
    mockDisconnect.mockResolvedValueOnce(undefined)

    const { ConnectionManager } = await import('../../src/main/xapi/connection-manager')
    const mgr = new ConnectionManager()
    const id = await mgr.connect(defaultOpts)

    expect(mgr.getClient(id)).toBeDefined()
    mgr.disconnect(id)
    expect(mgr.getClient(id)).toBeUndefined()
    expect(mgr.getConnectionInfo(id)?.state).toBe('disconnected')
    await mgr.reconnect(id)
    expect(mgr.getConnectionInfo(id)?.state).toBe('connected')
    expect(mockConnect).toHaveBeenLastCalledWith(defaultOpts)
  })

  it('disconnect() for unknown id does not throw', async () => {
    const { ConnectionManager } = await import('../../src/main/xapi/connection-manager')
    const mgr = new ConnectionManager()

    // Should not throw for unknown connection
    expect(() => mgr.disconnect('unknown-id')).not.toThrow()
  })

  it('listConnections() returns array of ConnectionInfo', async () => {
    mockConnect.mockResolvedValue('OpaqueRef:session1')
    mockXapiRecords({ hostUuids: ['host-uuid-1', 'host-uuid-2'] })

    const { ConnectionManager } = await import('../../src/main/xapi/connection-manager')
    const mgr = new ConnectionManager()

    const id1 = await mgr.connect(defaultOpts)
    const id2 = await mgr.connect({ ...defaultOpts, host: '192.168.1.2' })

    const connections = mgr.listConnections()
    expect(connections).toHaveLength(2)
    const ids = connections.map((c) => c.id)
    expect(ids).toContain(id1)
    expect(ids).toContain(id2)
  })

  it('listConnections() returns empty array when no connections', async () => {
    const { ConnectionManager } = await import('../../src/main/xapi/connection-manager')
    const mgr = new ConnectionManager()

    expect(mgr.listConnections()).toEqual([])
  })

  it('reconnect() fails for unknown connectionId', async () => {
    const { ConnectionManager } = await import('../../src/main/xapi/connection-manager')
    const mgr = new ConnectionManager()

    await expect(mgr.reconnect('does-not-exist')).rejects.toThrow('Connection not found')
  })

  it('reconnect() re-creates connection with stored opts', async () => {
    mockConnect.mockResolvedValue('OpaqueRef:session1')
    mockDisconnect.mockResolvedValue(undefined)

    const { ConnectionManager } = await import('../../src/main/xapi/connection-manager')
    const mgr = new ConnectionManager()

    const id = await mgr.connect(defaultOpts)
    expect(mockConnect).toHaveBeenCalledTimes(1)

    await mgr.reconnect(id)
    // connect should have been called a second time for reconnect
    expect(mockConnect).toHaveBeenCalledTimes(2)
    // Connection should still be accessible
    expect(mgr.getClient(id)).toBeDefined()
    expect(mgr.getConnectionInfo(id)?.state).toBe('connected')
  })

  it('reconnect() sets state to error when reconnect fails', async () => {
    mockConnect
      .mockResolvedValueOnce('OpaqueRef:session1') // initial connect
      .mockRejectedValueOnce(new Error('Reconnect failed')) // reconnect fails
    mockDisconnect.mockResolvedValue(undefined)

    const { ConnectionManager } = await import('../../src/main/xapi/connection-manager')
    const mgr = new ConnectionManager()
    const id = await mgr.connect(defaultOpts)

    await expect(mgr.reconnect(id)).rejects.toThrow('Reconnect failed')
    const info = mgr.getConnectionInfo(id)
    expect(info?.state).toBe('error')
  })

  it('disconnectAll() clears all connections', async () => {
    mockConnect.mockResolvedValue('OpaqueRef:session1')
    mockXapiRecords({ hostUuids: ['host-uuid-1', 'host-uuid-2'] })
    mockDisconnect.mockResolvedValue(undefined)

    const { ConnectionManager } = await import('../../src/main/xapi/connection-manager')
    const mgr = new ConnectionManager()

    await mgr.connect(defaultOpts)
    await mgr.connect({ ...defaultOpts, host: '10.0.0.1' })
    expect(mgr.listConnections()).toHaveLength(2)

    mgr.disconnectAll()
    expect(mgr.listConnections()).toHaveLength(0)
  })

  it('connectionManager singleton is exported', async () => {
    const { connectionManager } = await import('../../src/main/xapi/connection-manager')
    expect(connectionManager).toBeDefined()
    expect(typeof connectionManager.connect).toBe('function')
    expect(typeof connectionManager.disconnect).toBe('function')
    expect(typeof connectionManager.getClient).toBe('function')
    expect(typeof connectionManager.listConnections).toBe('function')
    expect(typeof connectionManager.reconnect).toBe('function')
  })

  it('connect() uses optional display name when provided', async () => {
    mockConnect.mockResolvedValueOnce('OpaqueRef:session1')

    const { ConnectionManager } = await import('../../src/main/xapi/connection-manager')
    const mgr = new ConnectionManager()
    const id = await mgr.connect({ ...defaultOpts, name: 'My Production Pool' })
    const info = mgr.getConnectionInfo(id)

    expect(info?.name).toBe('My Production Pool')
  })

  it('connect() uses host as display name when name not provided', async () => {
    mockConnect.mockResolvedValueOnce('OpaqueRef:session1')

    const { ConnectionManager } = await import('../../src/main/xapi/connection-manager')
    const mgr = new ConnectionManager()
    const id = await mgr.connect(defaultOpts)
    const info = mgr.getConnectionInfo(id)

    expect(info?.name).toBe('192.168.1.1')
  })

  it('getConnectionInfo() returns a copy, not a reference', async () => {
    mockConnect.mockResolvedValueOnce('OpaqueRef:session1')

    const { ConnectionManager } = await import('../../src/main/xapi/connection-manager')
    const mgr = new ConnectionManager()
    const id = await mgr.connect(defaultOpts)

    const info1 = mgr.getConnectionInfo(id)
    const info2 = mgr.getConnectionInfo(id)

    // Should be equal in value but not the same reference
    expect(info1).toEqual(info2)
    expect(info1).not.toBe(info2)
  })
})
