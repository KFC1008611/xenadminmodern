import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { XapiConnectionOptions } from '../../src/shared/types/xapi'

const registeredHandlers = new Map<string, (...args: unknown[]) => unknown>()
const mockIpcMainHandle = vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
  registeredHandlers.set(channel, handler)
})

vi.mock('electron', () => ({
  ipcMain: { handle: mockIpcMainHandle },
}))

const mockConnect = vi.fn()
const mockDisconnect = vi.fn()
const mockListConnections = vi.fn()
const mockReconnect = vi.fn()
const mockGetConnectionInfo = vi.fn()

vi.mock('../../src/main/xapi/connection-manager', () => ({
  connectionManager: {
    connect: mockConnect,
    disconnect: mockDisconnect,
    listConnections: mockListConnections,
    reconnect: mockReconnect,
    getConnectionInfo: mockGetConnectionInfo,
  },
}))

const mockDebug = vi.fn()
const mockError = vi.fn()
const mockInfo = vi.fn()

vi.mock('../../src/main/logger', () => ({
  createLogger: () => ({
    debug: mockDebug,
    error: mockError,
    info: mockInfo,
    warn: vi.fn(),
  }),
}))

const trustedUrl = 'file:///Applications/XenAdmin/index.html'

function createOwner(url = trustedUrl) {
  let currentUrl = url
  const mainFrame = { url }
  const webContents = {
    mainFrame,
    getURL: () => currentUrl,
    isDestroyed: () => false,
  }
  return {
    owner: { webContents, isDestroyed: () => false },
    event: { sender: webContents, senderFrame: mainFrame },
    navigate(nextUrl: string) {
      currentUrl = nextUrl
      mainFrame.url = nextUrl
    },
  }
}

const validOptions: XapiConnectionOptions = {
  host: 'xcp.example.test',
  port: 443,
  scheme: 'https:',
  username: 'root',
  password: 'pool-password',
  allowSelfSigned: true,
  name: 'Primary pool',
}

const completeConnection = {
  id: 'pool-1',
  name: 'Primary pool',
  host: 'xcp.example.test',
  poolName: 'Lab',
  poolRef: 'OpaqueRef:pool',
  state: 'connected' as const,
  errorMessage: null,
  connectedAt: 123,
}

async function setup() {
  const owner = createOwner()
  const utils = await import('../../src/main/ipc/handlers/utils')
  const { registerConnectionHandlers } = await import('../../src/main/ipc/handlers/connection')
  utils.rebindIpcOwner(owner.owner as never, trustedUrl)
  registerConnectionHandlers()
  return { owner, utils }
}

describe('connection/session IPC contract tracer', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    registeredHandlers.clear()
  })

  it('registers the exact eight shared invoke descriptors', async () => {
    const { utils } = await setup()

    expect(utils.getIpcRegistrationInventory().contracts.map(({ channel, direction }) => ({
      channel,
      direction,
    }))).toEqual([
      { channel: 'connection:connect', direction: 'invoke' },
      { channel: 'connection:disconnect', direction: 'invoke' },
      { channel: 'connection:list', direction: 'invoke' },
      { channel: 'connection:reconnect', direction: 'invoke' },
      { channel: 'connection:getInfo', direction: 'invoke' },
      { channel: 'session:connect', direction: 'invoke' },
      { channel: 'session:disconnect', direction: 'invoke' },
      { channel: 'session:status', direction: 'invoke' },
    ])
  })

  it('allows the current main frame to perform the connection mutation tracer', async () => {
    mockConnect.mockResolvedValueOnce('pool-1')
    const { owner } = await setup()

    await expect(registeredHandlers.get('connection:connect')?.(owner.event, validOptions))
      .resolves.toEqual({ id: 'pool-1' })
    expect(mockConnect).toHaveBeenCalledWith(validOptions)
  })

  it('rejects malformed credentials before manager calls without echoing the password', async () => {
    const { owner } = await setup()
    const malformed = { ...validOptions, password: 'never-log-me', unexpected: true }

    const result = await registeredHandlers.get('connection:connect')?.(owner.event, malformed)

    expect(result).toMatchObject({ error: true, code: 'IPC_SCHEMA_INVALID' })
    expect(JSON.stringify(result)).not.toContain('never-log-me')
    expect(JSON.stringify(mockDebug.mock.calls)).not.toContain('never-log-me')
    expect(JSON.stringify(mockError.mock.calls)).not.toContain('never-log-me')
    expect(mockConnect).not.toHaveBeenCalled()
  })

  it('redacts a positional reconnect password from errors and IPC logs', async () => {
    mockReconnect.mockRejectedValueOnce(new Error('login rejected for never-log-reconnect'))
    const { owner } = await setup()
    const result = await registeredHandlers.get('connection:reconnect')?.(owner.event, 'pool-1', 'never-log-reconnect')
    expect(mockReconnect).toHaveBeenCalledWith('pool-1', 'never-log-reconnect')
    expect(result).toMatchObject({ error: true })
    expect(JSON.stringify([result, mockDebug.mock.calls, mockError.mock.calls, mockInfo.mock.calls])).not.toContain('never-log-reconnect')
  })

  it('preserves readable transport guidance through connect, legacy login and reconnect redaction', async () => {
    const { owner } = await setup()
    const { describeTransportError } = await import('../../src/main/xapi/errors')
    const failure = describeTransportError({
      code: 'EHOSTUNREACH',
      message: `connect EHOSTUNREACH ${validOptions.host}:443 password=${validOptions.password}`,
    })
    mockConnect.mockRejectedValueOnce(failure).mockRejectedValueOnce(failure)
    mockReconnect.mockRejectedValueOnce(failure)

    for (const [channel, args] of [
      ['connection:connect', [validOptions]],
      ['session:connect', [validOptions]],
      ['connection:reconnect', ['pool-1', validOptions.password]],
    ] as const) {
      const result = await registeredHandlers.get(channel)?.(owner.event, ...args)
      expect(result).toMatchObject({ error: true, code: 'EHOSTUNREACH', message: failure.message })
      expect((result as { message: string }).message).not.toContain('[REDACTED]')
      expect(JSON.stringify(result)).not.toContain(validOptions.password)
    }
    expect(JSON.stringify([mockDebug.mock.calls, mockError.mock.calls])).not.toContain(validOptions.password)
  })

  it('rejects child frames, external documents, and forged events before manager calls', async () => {
    const { owner } = await setup()

    const handler = registeredHandlers.get('connection:connect')
    const childFrameResult = await handler?.({
      sender: owner.owner.webContents,
      senderFrame: { url: trustedUrl },
    }, validOptions)
    const forgedResult = await handler?.({}, validOptions)
    owner.navigate('https://external.example.test/')
    const externalResult = await handler?.(owner.event, validOptions)

    for (const result of [childFrameResult, forgedResult, externalResult]) {
      expect(result).toMatchObject({ error: true, code: 'IPC_UNTRUSTED_SENDER' })
    }
    expect(mockConnect).not.toHaveBeenCalled()
    expect(mockDebug).not.toHaveBeenCalled()
    expect(owner.event.sender).toBe(owner.owner.webContents)
  })

  it('validates the read tracer result before returning it', async () => {
    mockListConnections.mockReturnValueOnce([completeConnection])
    const { owner } = await setup()

    await expect(registeredHandlers.get('connection:list')?.(owner.event))
      .resolves.toEqual([completeConnection])

    mockListConnections.mockReturnValueOnce([{ id: 'incomplete' }])
    await expect(registeredHandlers.get('connection:list')?.(owner.event))
      .resolves.toMatchObject({ error: true, code: 'IPC_RESULT_INVALID' })
  })

  it('accepts a rebound owner and rejects the previous owner immediately', async () => {
    mockGetConnectionInfo.mockReturnValue(completeConnection)
    const { owner: previous, utils } = await setup()
    const current = createOwner()

    utils.rebindIpcOwner(current.owner as never, trustedUrl)

    await expect(registeredHandlers.get('connection:getInfo')?.(previous.event, 'pool-1'))
      .resolves.toMatchObject({ error: true, code: 'IPC_UNTRUSTED_SENDER' })
    await expect(registeredHandlers.get('connection:getInfo')?.(current.event, 'pool-1'))
      .resolves.toEqual(completeConnection)
    expect(mockGetConnectionInfo).toHaveBeenCalledTimes(1)
    expect(mockGetConnectionInfo).toHaveBeenCalledWith('pool-1')
  })

  it('preserves the legacy session identity and success shapes', async () => {
    mockConnect.mockResolvedValueOnce('default')
    mockGetConnectionInfo.mockReturnValueOnce(completeConnection)
    const { owner } = await setup()

    await expect(registeredHandlers.get('session:connect')?.(owner.event, validOptions))
      .resolves.toEqual({ id: 'default', connected: true })
    expect(mockConnect).toHaveBeenCalledWith(validOptions, 'default')
    await expect(registeredHandlers.get('session:status')?.(owner.event))
      .resolves.toEqual({ connected: true })
  })
})
