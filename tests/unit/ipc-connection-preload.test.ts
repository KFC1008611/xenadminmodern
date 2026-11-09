import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createConnectionSessionApi } from '../../src/preload/connection-api'

const invoke = vi.fn()

const connectionOptions = {
  host: 'xcp.example.test',
  port: 443,
  scheme: 'https:' as const,
  username: 'root',
  password: 'pool-password',
  allowSelfSigned: true,
  name: 'Production Pool',
}

const connectionInfo = {
  id: 'connection-1',
  name: 'Production Pool',
  host: 'xcp.example.test',
  poolName: 'Pool A',
  poolRef: 'OpaqueRef:pool',
  state: 'connected' as const,
  errorMessage: null,
  connectedAt: 1_785_600_000_000,
}

function callWithUnknownArgs(method: unknown, ...args: unknown[]): Promise<unknown> {
  return (method as (...values: unknown[]) => Promise<unknown>)(...args)
}

describe('connection and session preload IPC contracts', () => {
  beforeEach(() => {
    invoke.mockReset()
  })

  it('routes connection connect through its declared channel', async () => {
    invoke.mockResolvedValueOnce({ id: 'connection-1' })
    const api = createConnectionSessionApi({ invoke })

    expect(Object.keys(api.connection)).toEqual([
      'connect',
      'disconnect',
      'list',
      'reconnect',
      'getInfo',
    ])
    expect(Object.keys(api.session)).toEqual(['connect', 'disconnect', 'status'])
    await expect(api.connection.connect(connectionOptions)).resolves.toEqual({ id: 'connection-1' })
    expect(invoke).toHaveBeenCalledWith('connection:connect', connectionOptions)
  })

  it('rejects malformed connection credentials before sending IPC', async () => {
    const api = createConnectionSessionApi({ invoke })

    await expect(api.connection.connect({
      ...connectionOptions,
      password: '',
    })).rejects.toMatchObject({
      message: 'IPC payload does not match the channel contract',
      code: 'IPC_SCHEMA_INVALID',
    })
    expect(invoke).not.toHaveBeenCalled()
  })

  it('routes the remaining connection and session methods through their declared channels', async () => {
    invoke.mockImplementation(async (channel: string) => {
      const results: Record<string, unknown> = {
        'connection:disconnect': undefined,
        'connection:list': [connectionInfo],
        'connection:reconnect': undefined,
        'connection:getInfo': connectionInfo,
        'session:connect': { id: 'default', connected: true },
        'session:disconnect': undefined,
        'session:status': { connected: false },
      }
      return results[channel]
    })
    const api = createConnectionSessionApi({ invoke })

    await expect(api.connection.disconnect('connection-1')).resolves.toBeUndefined()
    await expect(api.connection.list()).resolves.toEqual([connectionInfo])
    await expect(api.connection.reconnect('connection-1')).resolves.toBeUndefined()
    await expect(api.connection.getInfo('connection-1')).resolves.toEqual(connectionInfo)
    await expect(api.session.connect(connectionOptions)).resolves.toEqual({
      id: 'default',
      connected: true,
    })
    await expect(api.session.disconnect()).resolves.toBeUndefined()
    await expect(api.session.status()).resolves.toEqual({ connected: false })
    expect(invoke.mock.calls).toEqual([
      ['connection:disconnect', 'connection-1'],
      ['connection:list'],
      ['connection:reconnect', 'connection-1'],
      ['connection:getInfo', 'connection-1'],
      ['session:connect', connectionOptions],
      ['session:disconnect'],
      ['session:status'],
    ])
  })

  it('validates arguments for every migrated preload path before sending IPC', async () => {
    const api = createConnectionSessionApi({ invoke })
    const invalidCalls = [
      () => api.connection.connect({ ...connectionOptions, password: '' }),
      () => api.connection.disconnect(''),
      () => callWithUnknownArgs(api.connection.list, 'extra'),
      () => api.connection.reconnect('   '),
      () => api.connection.reconnect('connection-1', ''),
      () => api.connection.getInfo(''),
      () => api.session.connect({ ...connectionOptions, username: '' }),
      () => callWithUnknownArgs(api.session.disconnect, 'extra'),
      () => callWithUnknownArgs(api.session.status, 'extra'),
    ]

    for (const call of invalidCalls) {
      invoke.mockClear()
      await expect(call()).rejects.toMatchObject({ code: 'IPC_SCHEMA_INVALID' })
      expect(invoke).not.toHaveBeenCalled()
    }
  })

  it('passes an explicitly supplied replacement password through the validated reconnect contract', async () => {
    invoke.mockResolvedValue(undefined)
    const api = createConnectionSessionApi({ invoke })
    await api.connection.reconnect('connection-1', 'replacement')
    expect(invoke).toHaveBeenCalledWith('connection:reconnect', 'connection-1', 'replacement')
  })

  it('validates successful results for every migrated preload path', async () => {
    const api = createConnectionSessionApi({ invoke })
    const calls = [
      () => api.connection.connect(connectionOptions),
      () => api.connection.disconnect('connection-1'),
      () => api.connection.list(),
      () => api.connection.reconnect('connection-1'),
      () => api.connection.getInfo('connection-1'),
      () => api.session.connect(connectionOptions),
      () => api.session.disconnect(),
      () => api.session.status(),
    ]

    for (const call of calls) {
      invoke.mockClear()
      invoke.mockResolvedValueOnce(null)
      await expect(call()).rejects.toMatchObject({ code: 'IPC_RESULT_INVALID' })
      expect(invoke).toHaveBeenCalledOnce()
    }
  })

  it('preserves main-process business error code and details', async () => {
    invoke.mockResolvedValueOnce({
      error: true,
      message: 'Connection unavailable',
      code: 'CONNECTION_UNAVAILABLE',
      details: { retryable: true },
    })
    const api = createConnectionSessionApi({ invoke })

    await expect(api.connection.getInfo('connection-1')).rejects.toMatchObject({
      message: 'Connection unavailable',
      code: 'CONNECTION_UNAVAILABLE',
      details: { retryable: true },
    })
  })
})
