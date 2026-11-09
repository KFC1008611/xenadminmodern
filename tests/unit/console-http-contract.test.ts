import { createServer, type Server, type Socket } from 'net'
import { EventEmitter, once } from 'events'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createServer as createTlsServer, type TLSSocket } from 'node:tls'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WebSocket from 'ws'
import { connectionManager } from '../../src/main/xapi/connection-manager'
import {
  closeAllConsoleSessions,
  closeConsoleSession,
  openConsoleSession,
} from '../../src/main/console/console.service'

const netMock = vi.hoisted(() => ({
  actualCreateConnection: undefined as ((...args: any[]) => any) | undefined,
  createConnection: vi.fn(),
}))

vi.mock('net', async (importOriginal) => {
  const actual = await importOriginal<typeof import('net')>()
  netMock.actualCreateConnection = actual.createConnection
  return { ...actual, createConnection: netMock.createConnection }
})

const openServers = new Set<Server>()
const openTcpSockets = new Set<Socket>()
const openSockets = new Set<WebSocket>()
const fixturesDir = resolve(__dirname, '../fixtures')
const testKey = readFileSync(resolve(fixturesDir, 'xapi-http-test-cert.key'))
const testCert = readFileSync(resolve(fixturesDir, 'xapi-http-test-cert.crt'))

beforeEach(() => {
  netMock.createConnection.mockReset()
  netMock.createConnection.mockImplementation((...args: any[]) => {
    if (!netMock.actualCreateConnection) throw new Error('Real net.createConnection is unavailable')
    return netMock.actualCreateConnection(...args)
  })
})

async function listenTcp(
  onConnection: (socket: Socket) => void,
): Promise<{ server: Server; port: number }> {
  const server = createServer((socket) => {
    openTcpSockets.add(socket)
    socket.once('close', () => openTcpSockets.delete(socket))
    onConnection(socket)
  })
  openServers.add(server)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Loopback server has no TCP address')
  return { server, port: address.port }
}

async function listenTls(
  onConnection: (socket: TLSSocket) => void,
  host = '127.0.0.1',
): Promise<{ server: Server; port: number }> {
  const server = createTlsServer({ key: testKey, cert: testCert }, (socket) => {
    openTcpSockets.add(socket)
    socket.once('close', () => openTcpSockets.delete(socket))
    onConnection(socket)
  })
  openServers.add(server)
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(0, host, () => {
      server.off('error', rejectListen)
      resolveListen()
    })
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Loopback server has no TLS address')
  return { server, port: address.port }
}

async function connectWebSocket(url: string): Promise<WebSocket> {
  let lastError: Error | undefined
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const socket = new WebSocket(url)
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once('open', resolve)
        socket.once('error', reject)
      })
      openSockets.add(socket)
      return socket
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      socket.terminate()
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
  }
  throw lastError ?? new Error(`Could not connect to ${url}`)
}

async function withTimeout<T>(promise: Promise<T>, label: string, timeoutMs = 2_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

afterEach(async () => {
  vi.useRealTimers()
  for (const socket of openSockets) socket.terminate()
  openSockets.clear()
  for (const socket of openTcpSockets) socket.destroy()
  openTcpSockets.clear()
  await closeAllConsoleSessions()
  await Promise.all([...openServers].map(async (server) => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    openServers.delete(server)
  }))
  vi.restoreAllMocks()
})

describe('VM console HTTP data-plane contract', () => {
  it('uses the console location with authenticated management trust and closes only the tunnel', async () => {
    let resolveConnectRequest!: (value: string) => void
    const connectRequest = new Promise<string>((resolve) => {
      resolveConnectRequest = resolve
    })
    const upstream = await listenTcp((socket) => {
      let request = Buffer.alloc(0)
      socket.on('data', (chunk) => {
        request = Buffer.concat([request, chunk])
        const headerEnd = request.indexOf('\r\n\r\n')
        if (headerEnd < 0) return
        socket.removeAllListeners('data')
        resolveConnectRequest(request.subarray(0, headerEnd + 4).toString('utf8'))
        socket.write('HTTP/1.0 200 OK\r\n\r\nRFB 003.008\n')
      })
    })

    const callWithSession = vi.fn(async (method: string) => {
      if (method === 'VM.get_consoles') return ['OpaqueRef:console']
      if (method === 'console.get_record') {
        return {
          protocol: 'rfb',
          location: `http://127.0.0.1:${upstream.port}/console?ref=OpaqueRef%3Aconsole&session_id=location-session`,
        }
      }
      throw new Error(`Unexpected XAPI call: ${method}`)
    })
    const getAuthenticatedHttpContext = vi.fn(() => ({
      scheme: 'http:' as const,
      host: 'pool.example.test',
      port: 80,
      tls: null,
      sessionId: 'OpaqueRef:management-session',
    }))
    vi.spyOn(connectionManager, 'getClient').mockReturnValue({
      callWithSession,
      getSessionRef: vi.fn(() => 'OpaqueRef:management-session'),
      getAuthenticatedHttpContext,
    } as never)
    const getConnectionOptions = vi
      .spyOn(connectionManager, 'getConnectionOptions')
      .mockReturnValue({
        scheme: 'https:',
        host: 'stale-profile.test',
        port: 443,
        username: 'root',
        password: 'secret',
        allowSelfSigned: true,
      })

    const session = await openConsoleSession('connection-1', 'OpaqueRef:vm')
    const browserSocket = await connectWebSocket(session.wsUrl)

    await expect(connectRequest).resolves.toBe([
      'CONNECT /console?ref=OpaqueRef%3Aconsole HTTP/1.0',
      `Host: 127.0.0.1:${upstream.port}`,
      'Cookie: session_id=OpaqueRef:management-session',
      'Connection: keep-alive',
      '',
      '',
    ].join('\r\n'))
    expect(getAuthenticatedHttpContext).toHaveBeenCalledTimes(1)
    expect(getConnectionOptions).not.toHaveBeenCalled()
    expect(callWithSession.mock.calls.some(([method]) => String(method).startsWith('task.'))).toBe(false)

    browserSocket.close()
    await once(browserSocket, 'close')
    openSockets.delete(browserSocket)
    await closeConsoleSession(session.sessionId)
  })

  it('uses port 80 when an HTTP console location omits its port', async () => {
    const upstream = Object.assign(new EventEmitter(), {
      destroyed: false,
      writable: true,
      setNoDelay: vi.fn(),
      write: vi.fn(),
      destroy: vi.fn(),
    })
    netMock.createConnection.mockReturnValue(upstream as never)
    const callWithSession = vi.fn(async (method: string) => {
      if (method === 'VM.get_consoles') return ['OpaqueRef:console']
      if (method === 'console.get_record') {
        return {
          protocol: 'rfb',
          location: 'http://console.example.test/console?ref=OpaqueRef%3Aconsole',
        }
      }
      throw new Error(`Unexpected XAPI call: ${method}`)
    })
    vi.spyOn(connectionManager, 'getClient').mockReturnValue({
      callWithSession,
      getAuthenticatedHttpContext: vi.fn(() => ({
        scheme: 'http:' as const,
        host: 'pool.example.test',
        port: 80,
        tls: null,
        sessionId: 'OpaqueRef:management-session',
      })),
    } as never)

    const session = await openConsoleSession('connection-1', 'OpaqueRef:vm')
    const browserSocket = await connectWebSocket(session.wsUrl)

    expect(netMock.createConnection).toHaveBeenCalledWith(
      { host: 'console.example.test', port: 80 },
      expect.any(Function),
    )

    browserSocket.close()
    await once(browserSocket, 'close')
    openSockets.delete(browserSocket)
    await closeConsoleSession(session.sessionId)
  })

  it('rejects unsupported console protocols before creating a tunnel', async () => {
    const callWithSession = vi.fn(async (method: string) => {
      if (method === 'VM.get_consoles') return ['OpaqueRef:console']
      if (method === 'console.get_record') {
        return {
          protocol: 'rfb',
          location: 'ftp://console.example.test/console?ref=OpaqueRef%3Aconsole',
        }
      }
      throw new Error(`Unexpected XAPI call: ${method}`)
    })
    vi.spyOn(connectionManager, 'getClient').mockReturnValue({
      callWithSession,
      getAuthenticatedHttpContext: vi.fn(() => ({
        scheme: 'https:' as const,
        host: 'pool.example.test',
        port: 443,
        tls: { rejectUnauthorized: false },
        sessionId: 'OpaqueRef:management-session',
      })),
    } as never)

    await expect(openConsoleSession('connection-1', 'OpaqueRef:vm'))
      .rejects.toThrow('Unsupported console location protocol: ftp:')
    expect(netMock.createConnection).not.toHaveBeenCalled()
  })

  it('uses authenticated relaxed trust for a real self-signed HTTPS console CONNECT', async () => {
    let resolveConnectRequest!: (value: string) => void
    const connectRequest = new Promise<string>((resolveRequest) => {
      resolveConnectRequest = resolveRequest
    })
    const upstream = await listenTls((socket) => {
      let request = Buffer.alloc(0)
      socket.on('data', (chunk) => {
        request = Buffer.concat([request, chunk])
        const headerEnd = request.indexOf('\r\n\r\n')
        if (headerEnd < 0) return
        socket.removeAllListeners('data')
        resolveConnectRequest(request.subarray(0, headerEnd + 4).toString('utf8'))
        socket.write('HTTP/1.0 200 OK\r\n\r\nRFB 003.008\n')
      })
    })
    const callWithSession = vi.fn(async (method: string) => {
      if (method === 'VM.get_consoles') return ['OpaqueRef:console']
      if (method === 'console.get_record') {
        return {
          protocol: 'rfb',
          location: `https://127.0.0.1:${upstream.port}/console?ref=OpaqueRef%3Aconsole`,
        }
      }
      throw new Error(`Unexpected XAPI call: ${method}`)
    })
    vi.spyOn(connectionManager, 'getClient').mockReturnValue({
      callWithSession,
      getAuthenticatedHttpContext: vi.fn(() => ({
        scheme: 'https:' as const,
        host: 'pool.example.test',
        port: 443,
        tls: { rejectUnauthorized: false },
        sessionId: 'OpaqueRef:management-session',
      })),
    } as never)

    const session = await openConsoleSession('connection-1', 'OpaqueRef:vm')
    const browserSocket = await connectWebSocket(session.wsUrl)

    await expect(connectRequest).resolves.toBe([
      'CONNECT /console?ref=OpaqueRef%3Aconsole HTTP/1.0',
      `Host: 127.0.0.1:${upstream.port}`,
      'Cookie: session_id=OpaqueRef:management-session',
      'Connection: keep-alive',
      '',
      '',
    ].join('\r\n'))

    browserSocket.close()
    await once(browserSocket, 'close')
    openSockets.delete(browserSocket)
    await closeConsoleSession(session.sessionId)
  })

  it('connects to an IPv6 console authority without sending TLS SNI', async () => {
    let observedServername: string | false | undefined
    let resolveConnectRequest!: (value: string) => void
    const connectRequest = new Promise<string>((resolveRequest) => {
      resolveConnectRequest = resolveRequest
    })
    const upstream = await listenTls((socket) => {
      observedServername = socket.servername
      let request = Buffer.alloc(0)
      socket.on('data', (chunk) => {
        request = Buffer.concat([request, chunk])
        const headerEnd = request.indexOf('\r\n\r\n')
        if (headerEnd < 0) return
        socket.removeAllListeners('data')
        resolveConnectRequest(request.subarray(0, headerEnd + 4).toString('utf8'))
        socket.write('HTTP/1.0 200 OK\r\n\r\nRFB 003.008\n')
      })
    }, '::1')
    const callWithSession = vi.fn(async (method: string) => {
      if (method === 'VM.get_consoles') return ['OpaqueRef:console']
      if (method === 'console.get_record') {
        return {
          protocol: 'rfb',
          location: `https://[::1]:${upstream.port}/console?ref=OpaqueRef%3Aconsole`,
        }
      }
      throw new Error(`Unexpected XAPI call: ${method}`)
    })
    vi.spyOn(connectionManager, 'getClient').mockReturnValue({
      callWithSession,
      getAuthenticatedHttpContext: vi.fn(() => ({
        scheme: 'https:' as const,
        host: '::1',
        port: upstream.port,
        tls: { rejectUnauthorized: false },
        sessionId: 'OpaqueRef:management-session',
      })),
    } as never)

    const session = await openConsoleSession('connection-1', 'OpaqueRef:vm')
    const browserSocket = await connectWebSocket(session.wsUrl)

    await expect(connectRequest).resolves.toContain(`Host: [::1]:${upstream.port}`)
    expect(observedServername).toBe(false)

    browserSocket.close()
    await once(browserSocket, 'close')
    openSockets.delete(browserSocket)
    await closeConsoleSession(session.sessionId)
  })

  it('rejects an untrusted self-signed HTTPS console before sending CONNECT bytes', async () => {
    let secureConnections = 0
    let connectBytes = 0
    let resolveTlsFailure!: () => void
    const tlsFailure = new Promise<void>((resolveFailure) => {
      resolveTlsFailure = resolveFailure
    })
    const upstream = await listenTls((socket) => {
      secureConnections += 1
      socket.on('data', (chunk) => {
        connectBytes += chunk.length
      })
    })
    upstream.server.once('tlsClientError', () => resolveTlsFailure())
    const callWithSession = vi.fn(async (method: string) => {
      if (method === 'VM.get_consoles') return ['OpaqueRef:console']
      if (method === 'console.get_record') {
        return {
          protocol: 'rfb',
          location: `https://127.0.0.1:${upstream.port}/console?ref=OpaqueRef%3Aconsole`,
        }
      }
      throw new Error(`Unexpected XAPI call: ${method}`)
    })
    vi.spyOn(connectionManager, 'getClient').mockReturnValue({
      callWithSession,
      getAuthenticatedHttpContext: vi.fn(() => ({
        scheme: 'https:' as const,
        host: 'pool.example.test',
        port: 443,
        tls: { rejectUnauthorized: true },
        sessionId: 'OpaqueRef:management-session',
      })),
    } as never)

    const session = await openConsoleSession('connection-1', 'OpaqueRef:vm')
    const browserSocket = await connectWebSocket(session.wsUrl)

    await Promise.race([
      tlsFailure,
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error('Timed out waiting for TLS rejection')), 1_000)
      }),
    ])
    await vi.waitFor(() => expect(browserSocket.readyState).toBe(WebSocket.CLOSED))
    openSockets.delete(browserSocket)
    expect(secureConnections).toBe(0)
    expect(connectBytes).toBe(0)
    await closeConsoleSession(session.sessionId)
  })

  it('pauses each console source until its destination can accept more data', async () => {
    const upstream = Object.assign(new EventEmitter(), {
      destroyed: false,
      writable: true,
      setNoDelay: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      write: vi.fn()
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(false)
        .mockReturnValue(true),
      destroy: vi.fn(),
    })
    upstream.destroy.mockImplementation(() => {
      upstream.destroyed = true
      upstream.emit('close')
      return upstream
    })
    netMock.createConnection.mockImplementation((_options, onConnect) => {
      queueMicrotask(() => onConnect())
      return upstream as never
    })
    const callWithSession = vi.fn(async (method: string) => {
      if (method === 'VM.get_consoles') return ['OpaqueRef:console']
      if (method === 'console.get_record') {
        return {
          protocol: 'rfb',
          location: 'http://console.example.test/console?ref=OpaqueRef%3Aconsole',
        }
      }
      throw new Error(`Unexpected XAPI call: ${method}`)
    })
    vi.spyOn(connectionManager, 'getClient').mockReturnValue({
      callWithSession,
      getAuthenticatedHttpContext: vi.fn(() => ({
        scheme: 'http:' as const,
        host: 'pool.example.test',
        port: 80,
        tls: null,
        sessionId: 'OpaqueRef:management-session',
      })),
    } as never)

    const session = await openConsoleSession('connection-1', 'OpaqueRef:vm')
    const browserSocket = await connectWebSocket(session.wsUrl)
    await vi.waitFor(() => expect(upstream.write).toHaveBeenCalledTimes(1))

    const firstMessage = once(browserSocket, 'message')
    upstream.emit('data', Buffer.from('HTTP/1.0 200 OK\r\n\r\nRFB 003.008\n'))
    const [rfbBanner] = await firstMessage
    expect(Buffer.from(rfbBanner).toString('utf8')).toBe('RFB 003.008\n')
    expect(upstream.pause).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(upstream.resume).toHaveBeenCalledTimes(1))

    browserSocket.send(Buffer.from('first-input'))
    await vi.waitFor(() => expect(upstream.write).toHaveBeenCalledTimes(2))
    browserSocket.send(Buffer.from('second-input'))
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(upstream.write).toHaveBeenCalledTimes(2)

    upstream.emit('drain')
    await vi.waitFor(() => expect(upstream.write).toHaveBeenCalledTimes(3))
    expect(Buffer.from(upstream.write.mock.calls[1][0]).toString('utf8')).toBe('first-input')
    expect(Buffer.from(upstream.write.mock.calls[2][0]).toString('utf8')).toBe('second-input')

    browserSocket.close()
    await once(browserSocket, 'close')
    openSockets.delete(browserSocket)
    await closeConsoleSession(session.sessionId)
  })

  it('closes both sides when the upstream never returns CONNECT response headers', async () => {
    vi.useFakeTimers()
    let resolveConnectRequest!: () => void
    const connectRequestObserved = new Promise<void>((resolveRequest) => {
      resolveConnectRequest = resolveRequest
    })
    let resolveUpstreamClose!: () => void
    const upstreamClosed = new Promise<void>((resolveClose) => {
      resolveUpstreamClose = resolveClose
    })
    const upstream = await listenTcp((socket) => {
      socket.once('close', resolveUpstreamClose)
      let request = Buffer.alloc(0)
      socket.on('data', (chunk) => {
        request = Buffer.concat([request, chunk])
        if (request.indexOf('\r\n\r\n') >= 0) resolveConnectRequest()
      })
    })
    const callWithSession = vi.fn(async (method: string) => {
      if (method === 'VM.get_consoles') return ['OpaqueRef:console']
      if (method === 'console.get_record') {
        return {
          protocol: 'rfb',
          location: `http://127.0.0.1:${upstream.port}/console?ref=OpaqueRef%3Aconsole`,
        }
      }
      throw new Error(`Unexpected XAPI call: ${method}`)
    })
    vi.spyOn(connectionManager, 'getClient').mockReturnValue({
      callWithSession,
      getAuthenticatedHttpContext: vi.fn(() => ({
        scheme: 'http:' as const,
        host: '127.0.0.1',
        port: upstream.port,
        tls: null,
        sessionId: 'OpaqueRef:management-session',
      })),
    } as never)

    const session = await openConsoleSession('connection-1', 'OpaqueRef:vm')
    const browserSocket = await connectWebSocket(session.wsUrl)
    await withTimeout(connectRequestObserved, 'upstream CONNECT request')
    const browserClosed = once(browserSocket, 'close')

    await vi.advanceTimersByTimeAsync(15_000)
    vi.useRealTimers()
    const [, closeArgs] = await withTimeout(
      Promise.all([upstreamClosed, browserClosed]),
      'CONNECT header deadline cleanup',
    )
    expect(closeArgs[0]).toBe(1013)
    expect(Buffer.from(closeArgs[1]).toString('utf8')).toBe('Console CONNECT timed out')
    openSockets.delete(browserSocket)
    await closeConsoleSession(session.sessionId)
  })
})
