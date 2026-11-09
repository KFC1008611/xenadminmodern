import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ poolReadFailure: false, connect: vi.fn(), disconnect: vi.fn(), checkSession: vi.fn(), clients: [] as Array<{ fault?: (error: Error) => void; requestFault?: (error: Error) => void }>, start: vi.fn(), stop: vi.fn() }))
vi.mock('../../src/main/xapi/client', () => ({ XapiClient: vi.fn().mockImplementation(() => {
  const instance = {
    fault: undefined as ((error: Error) => void) | undefined,
    requestFault: undefined as ((error: Error) => void) | undefined,
    checkSession: mock.checkSession,
    connect: mock.connect, disconnect: mock.disconnect,
    on: (event: string, callback: (error: Error) => void) => { if (event === 'connection-fault') instance.fault = callback; else if (event === 'request-fault') instance.requestFault = callback },
    getConnectedHost: () => null, getSessionRef: () => 'OpaqueRef:session',
    callWithSession: async (method: string) => {
      if (method === 'pool.get_all') return ['OpaqueRef:pool']
      if (method === 'pool.get_record' && mock.poolReadFailure) throw new Error('pool metadata unavailable')
      if (method === 'pool.get_record') return { uuid: 'pool-uuid', name_label: 'Pool' }
      if (method === 'session.get_this_host') return 'OpaqueRef:host'
      if (method === 'host.get_uuid') return 'host-uuid'
      throw new Error(`Unexpected mutation replay: ${method}`)
    },
  }
  mock.clients.push(instance)
  return instance
}) }))
vi.mock('../../src/main/xapi/services/vm-event.service', () => ({ startVmEventWatcher: mock.start, stopVmEventWatcher: mock.stop }))
import { ConnectionManager } from '../../src/main/xapi/connection-manager'
const opts = { host: '192.0.2.1', port: 443, scheme: 'https:' as const, username: 'root', password: 'fixture', allowSelfSigned: false }
let manager: ConnectionManager
beforeEach(() => { vi.clearAllMocks(); mock.poolReadFailure = false; mock.clients.length = 0; mock.connect.mockResolvedValue(undefined); mock.disconnect.mockResolvedValue(undefined); mock.checkSession.mockReset().mockResolvedValue(undefined); manager = new ConnectionManager(); vi.useFakeTimers() })
afterEach(() => { manager.disconnectAll(); vi.useRealTimers() })
describe('connection recovery generations', () => {
  it('marks a fault unavailable immediately and rebuilds only the session', async () => {
    await manager.connect(opts, 'saved')
    const oldEpoch = manager.getConnectionInfo('saved')!.epoch!
    mock.clients[0].fault!(new Error('session expired'))
    expect(manager.getConnectionInfo('saved')?.state).toBe('error')
    expect(manager.getClient('saved')).toBeUndefined()
    await vi.advanceTimersByTimeAsync(1000)
    expect(mock.connect).toHaveBeenCalledTimes(2)
    expect(manager.getConnectionInfo('saved')).toMatchObject({ state: 'connected', poolUuid: 'pool-uuid' })
    expect(manager.getConnectionInfo('saved')!.epoch).toBeGreaterThan(oldEpoch)
    mock.clients[0].fault!(new Error('late old error'))
    expect(manager.getConnectionInfo('saved')?.state).toBe('connected')
  })
  it('does not revive a disconnected connection when login completes late', async () => {
    let complete!: () => void
    mock.connect.mockImplementationOnce(() => new Promise<void>((resolve) => { complete = resolve }))
    const pending = manager.connect(opts, 'saved')
    manager.disconnect('saved')
    complete()
    await expect(pending).rejects.toThrow('连接已取消')
    expect(manager.getConnectionInfo('saved')?.state).toBe('disconnected')
    expect(mock.start).not.toHaveBeenCalled()
  })
  it('coalesces simultaneous manual reconnect and cancels pending automatic recovery', async () => {
    await manager.connect(opts, 'saved')
    mock.clients[0].fault!(new Error('offline'))
    await Promise.all([manager.reconnect('saved'), manager.reconnect('saved')])
    await vi.advanceTimersByTimeAsync(5000)
    expect(mock.connect).toHaveBeenCalledTimes(2)
    expect(mock.start).toHaveBeenCalledTimes(2)
  })
  it('does not reuse old pool identity if metadata cannot be read after reconnect', async () => {
    await manager.connect(opts, 'saved')
    expect(manager.getConnectionInfo('saved')?.poolUuid).toBe('pool-uuid')
    mock.poolReadFailure = true
    await manager.reconnect('saved')
    expect(manager.getConnectionInfo('saved')).toMatchObject({ state: 'connected', poolRef: null, poolName: null })
    expect(manager.getConnectionInfo('saved')?.poolUuid).toBeUndefined()
  })
  it('keeps the epoch and session when an event socket fails but the session probe succeeds', async () => {
    await manager.connect(opts, 'saved')
    const epoch = manager.getConnectionInfo('saved')!.epoch
    mock.clients[0].requestFault!(new Error('event.from socket reset'))
    mock.clients[0].requestFault!(new Error('simultaneous read reset'))
    await vi.advanceTimersByTimeAsync(6000)
    expect(mock.checkSession).toHaveBeenCalledTimes(1)
    expect(mock.connect).toHaveBeenCalledTimes(1)
    expect(manager.getConnectionInfo('saved')).toMatchObject({ state: 'connected', epoch })
  })
  it('recovers only after the independent existing-session probe also fails', async () => {
    await manager.connect(opts, 'saved')
    mock.checkSession.mockRejectedValueOnce(Object.assign(new Error('unreachable'), { code: 'ECONNREFUSED' }))
    mock.clients[0].requestFault!(new Error('read reset'))
    await vi.advanceTimersByTimeAsync(0)
    expect(manager.getConnectionInfo('saved')?.state).toBe('error')
    await vi.advanceTimersByTimeAsync(1000)
    expect(mock.connect).toHaveBeenCalledTimes(2)
  })
  it('bounds a stalled health probe and ignores failures after an explicit disconnect', async () => {
    await manager.connect(opts, 'saved')
    mock.checkSession.mockReturnValueOnce(new Promise(() => {}))
    mock.clients[0].requestFault!(new Error('read stalled'))
    await vi.advanceTimersByTimeAsync(5000)
    expect(manager.getConnectionInfo('saved')?.state).toBe('error')
    manager.disconnect('saved')
    await vi.advanceTimersByTimeAsync(10000)
    expect(manager.getConnectionInfo('saved')?.state).toBe('disconnected')
    expect(mock.connect).toHaveBeenCalledTimes(1)
  })
  it('does not report a denied health probe as session loss or reconnect', async () => {
    await manager.connect(opts, 'saved')
    mock.checkSession.mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'RBAC_PERMISSION_DENIED' }))
    mock.clients[0].requestFault!(new Error('read reset'))
    await vi.advanceTimersByTimeAsync(6000)
    expect(manager.getConnectionInfo('saved')).toMatchObject({ state: 'connected', lastRequestFailure: { sessionAvailable: null } })
    expect(mock.connect).toHaveBeenCalledTimes(1)
  })

  it('does not undo a manual disconnect when an in-flight reconnect completes', async () => {
    await manager.connect(opts, 'saved')
    let complete!: () => void
    mock.connect.mockImplementationOnce(() => new Promise<void>((resolve) => { complete = resolve }))
    const pending = manager.reconnect('saved')
    const rejected = expect(pending).rejects.toThrow('连接已取消')
    await vi.advanceTimersByTimeAsync(0)
    manager.disconnect('saved')
    complete()
    await rejected
    await vi.advanceTimersByTimeAsync(30000)
    expect(manager.getConnectionInfo('saved')?.state).toBe('disconnected')
    expect(manager.getClient('saved')).toBeUndefined()
    expect(mock.start).toHaveBeenCalledOnce()
  })

  it('uses a replacement password on the same connection and retains it only in the main process', async () => {
    await manager.connect(opts, 'saved')
    manager.disconnect('saved')
    await manager.reconnect('saved', 'replacement')
    expect(mock.connect).toHaveBeenLastCalledWith({ ...opts, password: 'replacement' })
    expect(manager.getConnectionInfo('saved')).toMatchObject({ id: 'saved', state: 'connected' })
    expect(JSON.stringify(manager.listConnections())).not.toContain('replacement')
    manager.disconnect('saved')
    await manager.reconnect('saved')
    expect(mock.connect).toHaveBeenLastCalledWith({ ...opts, password: 'replacement' })
  })

  it('stops automatic retries after authentication is explicitly rejected', async () => {
    await manager.connect(opts, 'saved')
    mock.connect.mockRejectedValue(Object.assign(new Error('login rejected'), { code: 'SESSION_AUTHENTICATION_FAILED' }))
    mock.clients[0].fault!(new Error('offline'))
    await vi.advanceTimersByTimeAsync(60000)
    expect(mock.connect).toHaveBeenCalledTimes(2)
    expect(manager.getConnectionInfo('saved')).toMatchObject({ state: 'error', errorMessage: 'login rejected' })
  })
})
