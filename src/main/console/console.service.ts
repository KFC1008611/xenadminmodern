/**
 * VNC Console Service — WebSocket-to-TCP proxy for XCP-ng VM consoles.
 *
 * Each open console gets its own ws.Server bound to 127.0.0.1 on a random port.
 * The renderer connects noVNC to ws://127.0.0.1:<port>, the main process forwards
 * all binary frames to/from the XCP-ng VNC TCP socket.
 *
 * Security: The WebSocket server is bound exclusively to the loopback interface,
 * so it is never reachable from outside the local machine.
 *
 * v4: All functions accept connectionId as the first parameter for multi-connection support.
 */
import * as net from 'net'
import * as tls from 'tls'
import { URL } from 'url'
import { WebSocketServer, WebSocket } from 'ws'
import { randomUUID } from 'crypto'
import { connectionManager } from '../xapi/connection-manager'
import { createLogger } from '../logger'

type UpstreamSocket = net.Socket | tls.TLSSocket

interface ConsoleSession {
  sessionId: string
  wss: WebSocketServer
  port: number
  clients: Set<WebSocket>
  upstreamSockets: Set<UpstreamSocket>
}

const log = createLogger('ConsoleService')
const CONSOLE_CONNECT_TIMEOUT_MS = 15_000

const sessions = new Map<string, ConsoleSession>()

/**
 * Find an available TCP port on the loopback interface.
 */
async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (!addr || typeof addr === 'string') {
        server.close()
        reject(new Error('Could not determine free port'))
        return
      }
      const port = addr.port
      server.close(() => resolve(port))
    })
    server.on('error', reject)
  })
}

/**
 * Retrieve the VNC console URL for a VM from XAPI using the given connectionId.
 * Returns the raw console location URL and the current XAPI session ref.
 */
async function getConsoleLocation(
  connectionId: string,
  vmRef: string
): Promise<{ locationUrl: string; sessionRef: string; rejectUnauthorized: boolean }> {
  log.debug('getConsoleLocation called', { connectionId, vmRef })
  const client = connectionManager.getClient(connectionId)
  if (!client) {
    log.error(`No client found for connectionId: ${connectionId}`)
    throw new Error(`No connection found for connectionId: ${connectionId}`)
  }

  const consoleRefs: string[] = await client.callWithSession('VM.get_consoles', [vmRef])
  log.debug('VM.get_consoles returned', consoleRefs)
  if (consoleRefs.length === 0) {
    throw new Error('No console available for this VM')
  }
  // Prefer the VNC console (protocol=rfb)
  let consoleRef = consoleRefs[0]
  for (const ref of consoleRefs) {
    const rec = await client.callWithSession('console.get_record', [ref])
    if (rec.protocol === 'rfb') {
      consoleRef = ref
      break
    }
  }
  const record = await client.callWithSession('console.get_record', [consoleRef])

  const httpContext = client.getAuthenticatedHttpContext()
  if (!httpContext) {
    throw new Error('No active XAPI session for console proxy')
  }

  const location: string = record.location || ''
  if (!location) {
    throw new Error('No console location returned by XAPI')
  }

  return {
    locationUrl: location,
    sessionRef: httpContext.sessionId,
    rejectUnauthorized: httpContext.tls?.rejectUnauthorized ?? true,
  }
}

function buildConnectPath(parsed: URL): string {
  const query = new URLSearchParams(parsed.searchParams)
  // session_id must be sent in Cookie for HTTP CONNECT; strip from URL if present.
  query.delete('session_id')
  const queryString = query.toString()
  return queryString ? `${parsed.pathname}?${queryString}` : parsed.pathname
}

/**
 * Open a console session for the given VM.
 * Returns { wsUrl, sessionId } to hand back to the renderer.
 */
export async function openConsoleSession(
  connectionId: string,
  vmRef: string
): Promise<{ wsUrl: string; sessionId: string }> {
  log.debug('openConsoleSession called', { connectionId, vmRef })
  const { locationUrl, sessionRef, rejectUnauthorized } = await getConsoleLocation(connectionId, vmRef)
  const parsed = new URL(locationUrl)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unsupported console location protocol: ${parsed.protocol}`)
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, '')
  const port = parsed.port
    ? parseInt(parsed.port, 10)
    : parsed.protocol === 'https:' ? 443 : 80
  const connectPath = buildConnectPath(parsed)

  log.debug('parsed', {
    host,
    port,
    pathname: parsed.pathname,
    protocol: parsed.protocol,
  })

  const sessionId = randomUUID()
  const wsPort = await findFreePort()

  const wss = new WebSocketServer({ host: '127.0.0.1', port: wsPort })
  const session: ConsoleSession = {
    sessionId,
    wss,
    port: wsPort,
    clients: new Set(),
    upstreamSockets: new Set(),
  }

  sessions.set(sessionId, session)

  wss.on('connection', (ws: WebSocket) => {
    if (session.clients.size > 0) {
      log.warn('Rejecting extra client for single-use console session')
      ws.close()
      return
    }

    session.clients.add(ws)
    log.debug('WebSocket client connected')

    let handshakeDone = false
    let headerBuffer = Buffer.alloc(0)
    let connectTimer: ReturnType<typeof setTimeout> | undefined

    const clearConnectTimer = (): void => {
      if (!connectTimer) return
      clearTimeout(connectTimer)
      connectTimer = undefined
    }

    const startTunnel = () => {
      // Citrix/XenServer documents console access as:
      // CONNECT /console?... with Cookie: session_id=<session_ref>.
      const connectRequest = [
        `CONNECT ${connectPath} HTTP/1.0`,
        `Host: ${parsed.host}`,
        `Cookie: session_id=${sessionRef}`,
        'Connection: keep-alive',
        '',
        '',
      ].join('\r\n')
      upstreamSocket.write(connectRequest)
    }

    const upstreamSocket: UpstreamSocket =
      parsed.protocol === 'https:'
        ? tls.connect(
            {
              host,
              port,
              rejectUnauthorized,
              servername: net.isIP(host) ? undefined : host,
            },
            startTunnel
          )
        : net.createConnection({ host, port }, startTunnel)

    session.upstreamSockets.add(upstreamSocket)
    upstreamSocket.setNoDelay(true)
    connectTimer = setTimeout(() => {
      if (handshakeDone) return
      log.warn('Console CONNECT timed out')
      if (ws.readyState === WebSocket.OPEN) {
        ws.close(1013, 'Console CONNECT timed out')
      }
      upstreamSocket.destroy(new Error('Console CONNECT timed out'))
    }, CONSOLE_CONNECT_TIMEOUT_MS)
    connectTimer.unref?.()

    const sendToRenderer = (data: Buffer): void => {
      if (ws.readyState !== WebSocket.OPEN) return
      upstreamSocket.pause()
      ws.send(data, (error) => {
        if (error) {
          upstreamSocket.destroy(error)
          return
        }
        if (!upstreamSocket.destroyed) upstreamSocket.resume()
      })
    }

    upstreamSocket.on('data', (data: Buffer) => {
      if (!handshakeDone) {
        headerBuffer = Buffer.concat([headerBuffer, data])
        const headerEnd = headerBuffer.indexOf('\r\n\r\n')
        if (headerEnd === -1) return

        const headerText = headerBuffer.slice(0, headerEnd).toString('utf8')
        const statusLine = headerText.split('\r\n', 1)[0] || ''
        const statusMatch = statusLine.match(/^HTTP\/\d\.\d\s+(\d{3})/)
        const statusCode = statusMatch ? Number(statusMatch[1]) : NaN

        if (statusCode !== 200) {
          clearConnectTimer()
          log.error(`Upstream CONNECT failed: ${statusLine}`)
          if (ws.readyState === WebSocket.OPEN) ws.close()
          upstreamSocket.destroy()
          return
        }

        handshakeDone = true
        clearConnectTimer()
        const remaining = headerBuffer.slice(headerEnd + 4)
        headerBuffer = Buffer.alloc(0)
        if (remaining.length > 0) sendToRenderer(remaining)
        return
      }

      sendToRenderer(data)
    })

    ws.on('message', (data) => {
      if (!upstreamSocket.writable) return

      let payload: Buffer | string
      if (typeof data === 'string') {
        payload = data
      } else if (Array.isArray(data)) {
        payload = Buffer.concat(data)
      } else if (data instanceof ArrayBuffer) {
        payload = Buffer.from(new Uint8Array(data))
      } else {
        payload = data
      }
      if (!upstreamSocket.write(payload)) ws.pause()
    })

    upstreamSocket.on('drain', () => ws.resume())

    ws.on('close', () => {
      clearConnectTimer()
      session.clients.delete(ws)
      if (!upstreamSocket.destroyed) {
        upstreamSocket.destroy()
      }
      void closeConsoleSession(session.sessionId)
    })

    upstreamSocket.on('close', () => {
      clearConnectTimer()
      session.upstreamSockets.delete(upstreamSocket)
      if (ws.readyState === WebSocket.OPEN) {
        ws.close()
      }
    })

    upstreamSocket.on('error', (err: Error) => {
      clearConnectTimer()
      log.error('Upstream socket error', err)
      if (ws.readyState === WebSocket.OPEN) {
        ws.close()
      }
    })

    ws.on('error', (err: Error) => {
      log.error('WebSocket error', err)
      if (!upstreamSocket.destroyed) {
        upstreamSocket.destroy()
      }
    })
  })

  wss.on('error', (err) => {
    log.error('WebSocket server error', err)
  })

  const result = { wsUrl: `ws://127.0.0.1:${wsPort}`, sessionId }
  log.debug('returning', result)
  return result
}

/**
 * Close a console session by sessionId.
 */
export async function closeConsoleSession(sessionId: string): Promise<void> {
  const session = sessions.get(sessionId)
  if (!session) return

  sessions.delete(sessionId)

  for (const ws of session.clients) {
    try {
      ws.terminate()
    } catch {
      // Ignore client close errors during cleanup
    }
  }
  session.clients.clear()

  for (const upstreamSocket of session.upstreamSockets) {
    if (!upstreamSocket.destroyed) {
      upstreamSocket.destroy()
    }
  }
  session.upstreamSockets.clear()

  await new Promise<void>((resolve) => {
    session.wss.close(() => resolve())
  })
}

/**
 * Close all active console sessions. Call on app quit.
 */
export async function closeAllConsoleSessions(): Promise<void> {
  const ids = Array.from(sessions.keys())
  await Promise.all(ids.map(closeConsoleSession))
}
