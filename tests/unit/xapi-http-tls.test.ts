import { readFileSync } from 'node:fs'
import { createServer as createHttpServer, type IncomingMessage } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { resolve } from 'node:path'
import type { TLSSocket } from 'node:tls'
import { afterEach, describe, expect, it } from 'vitest'
import {
  requestXapiHttp,
  type XapiHttpRequestError,
} from '../../src/main/xapi/http-data-plane'
import type { AuthenticatedHttpContext } from '../../src/main/xapi/client'

type LoopbackServer =
  | ReturnType<typeof createHttpServer>
  | ReturnType<typeof createHttpsServer>

const fixturesDir = resolve(__dirname, '../fixtures')
const testKey = readFileSync(resolve(fixturesDir, 'xapi-http-test-cert.key'))
const testCert = readFileSync(resolve(fixturesDir, 'xapi-http-test-cert.crt'))
const openServers = new Set<LoopbackServer>()

function httpsContext(
  port: number,
  rejectUnauthorized: boolean,
  host = '127.0.0.1',
): AuthenticatedHttpContext {
  return {
    scheme: 'https:',
    host,
    port,
    tls: { rejectUnauthorized },
    sessionId: 'OpaqueRef:session',
  }
}

async function listen(server: LoopbackServer, host = '127.0.0.1'): Promise<number> {
  openServers.add(server)
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(0, host, () => {
      server.off('error', rejectListen)
      resolveListen()
    })
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Loopback server has no TCP address')
  return address.port
}

async function closeServer(server: LoopbackServer): Promise<void> {
  server.closeAllConnections()
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()))
  openServers.delete(server)
}

async function responseText(response: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of response) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

async function captureError(request: Promise<IncomingMessage>): Promise<XapiHttpRequestError> {
  try {
    const response = await request
    response.destroy()
    throw new Error('Expected XAPI HTTP request to fail')
  } catch (error) {
    return error as XapiHttpRequestError
  }
}

afterEach(async () => {
  await Promise.all([...openServers].map(closeServer))
})

describe('requestXapiHttp TLS and failure injection', () => {
  it('rejects an untrusted self-signed HTTPS endpoint before an HTTP request is delivered', async () => {
    let requestCount = 0
    const server = createHttpsServer({ key: testKey, cert: testCert }, (_request, response) => {
      requestCount += 1
      response.end('unexpected')
    })
    const port = await listen(server)

    const error = await captureError(requestXapiHttp({
      context: httpsContext(port, true),
      method: 'GET',
      path: '/host_rrd',
      timeoutMs: 1_000,
    }))

    expect(error).toMatchObject({ code: 'NETWORK' })
    expect((error.cause as { code?: string } | undefined)?.code).toMatch(/SELF_SIGNED/)
    expect(requestCount).toBe(0)
  })

  it('uses the authenticated self-signed trust policy for a real HTTPS request', async () => {
    let requestCount = 0
    const server = createHttpsServer({ key: testKey, cert: testCert }, (_request, response) => {
      requestCount += 1
      response.end('rrd-over-tls')
    })
    const port = await listen(server)

    const response = await requestXapiHttp({
      context: httpsContext(port, false),
      method: 'GET',
      path: '/host_rrd',
      timeoutMs: 1_000,
    })

    expect(await responseText(response)).toBe('rrd-over-tls')
    expect(requestCount).toBe(1)
  })

  it('does not send TLS SNI when the authenticated authority is an IPv6 literal', async () => {
    let observedServername: string | false | undefined
    const server = createHttpsServer({ key: testKey, cert: testCert }, (request, response) => {
      observedServername = (request.socket as TLSSocket).servername
      response.end('rrd-over-ipv6')
    })
    const port = await listen(server, '::1')

    const response = await requestXapiHttp({
      context: httpsContext(port, false, '::1'),
      method: 'GET',
      path: '/host_rrd',
      timeoutMs: 1_000,
    })

    expect(await responseText(response)).toBe('rrd-over-ipv6')
    expect(observedServername).toBe(false)
  })

  it('rejects an HTTPS to HTTP redirect before contacting the downgrade target', async () => {
    let sourceRequests = 0
    let targetRequests = 0
    const target = createHttpServer((_request, response) => {
      targetRequests += 1
      response.end('downgraded')
    })
    const targetPort = await listen(target)
    const source = createHttpsServer({ key: testKey, cert: testCert }, (_request, response) => {
      sourceRequests += 1
      response.writeHead(302, {
        Location: `http://127.0.0.1:${targetPort}/export`,
      })
      response.end()
    })
    const sourcePort = await listen(source)

    await expect(requestXapiHttp({
      context: httpsContext(sourcePort, false),
      method: 'GET',
      path: '/export',
      query: new URLSearchParams([
        ['session_id', 'OpaqueRef:session'],
        ['task_id', 'OpaqueRef:task'],
      ]),
      timeoutMs: 1_000,
    })).rejects.toMatchObject({ code: 'TLS_DOWNGRADE' })

    expect({ sourceRequests, targetRequests }).toEqual({
      sourceRequests: 1,
      targetRequests: 0,
    })
  })

  it.each(['session_id', 'task_id', 'uuid'])(
    'rejects a redirect with a conflicting %s before issuing the redirected request',
    async (protectedName) => {
      let sourceRequests = 0
      let targetRequests = 0
      const source = createHttpsServer({ key: testKey, cert: testCert }, (request, response) => {
        if (!request.url?.startsWith('/export?')) {
          targetRequests += 1
          response.end('unexpected')
          return
        }
        sourceRequests += 1
        response.writeHead(302, {
          Location: `https://${request.headers.host}/next?${protectedName}=conflict`,
        })
        response.end()
      })
      const sourcePort = await listen(source)

      const error = await captureError(requestXapiHttp({
        context: httpsContext(sourcePort, false),
        method: 'GET',
        path: '/export',
        query: new URLSearchParams([
          ['session_id', 'OpaqueRef:session'],
          ['task_id', 'OpaqueRef:task'],
          ['uuid', 'vm-uuid'],
        ]),
        timeoutMs: 1_000,
      }))

      expect(error).toMatchObject({ code: 'REDIRECT_CONFLICT' })

      expect({ sourceRequests, targetRequests }).toEqual({
        sourceRequests: 1,
        targetRequests: 0,
      })
    },
  )

  it('does not retry after the HTTPS peer disconnects before a response', async () => {
    let requestCount = 0
    const server = createHttpsServer({ key: testKey, cert: testCert }, (request) => {
      requestCount += 1
      request.socket.destroy()
    })
    const port = await listen(server)

    await expect(requestXapiHttp({
      context: httpsContext(port, false),
      method: 'GET',
      path: '/rrd_updates',
      timeoutMs: 1_000,
    })).rejects.toMatchObject({ code: 'NETWORK' })

    await new Promise((resolveWait) => setTimeout(resolveWait, 50))
    expect(requestCount).toBe(1)
  })

  it('times out a stalled HTTPS response body without replaying the request', async () => {
    let requestCount = 0
    const server = createHttpsServer({ key: testKey, cert: testCert }, (_request, response) => {
      requestCount += 1
      response.writeHead(200, { 'Content-Type': 'application/octet-stream' })
      response.write('partial-body')
    })
    const port = await listen(server)

    const response = await requestXapiHttp({
      context: httpsContext(port, false),
      method: 'GET',
      path: '/export',
      timeoutMs: 30,
    })

    await expect(responseText(response)).rejects.toMatchObject({ code: 'TIMEOUT' })
    await new Promise((resolveWait) => setTimeout(resolveWait, 50))
    expect(requestCount).toBe(1)
  })

  it('enforces the timeout as a hard deadline while the HTTPS response body keeps dripping', async () => {
    let requestCount = 0
    const server = createHttpsServer({ key: testKey, cert: testCert }, (_request, response) => {
      requestCount += 1
      response.writeHead(200, { 'Content-Type': 'application/octet-stream' })
      response.write('drip')
      const drip = setInterval(() => response.write('drip'), 10)
      const safetyDisconnect = setTimeout(() => response.socket?.destroy(), 160)
      response.once('close', () => {
        clearInterval(drip)
        clearTimeout(safetyDisconnect)
      })
    })
    const port = await listen(server)

    const response = await requestXapiHttp({
      context: httpsContext(port, false),
      method: 'GET',
      path: '/rrd_updates',
      timeoutMs: 40,
    })

    await expect(responseText(response)).rejects.toMatchObject({ code: 'TIMEOUT' })
    expect(requestCount).toBe(1)
  })

  it('keeps TLS test fixtures outside the packaged application inputs', () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'),
    ) as { build?: { files?: string[] } }
    const packageInputs = packageJson.build?.files ?? []
    const positiveInputs = packageInputs.filter((entry) => !entry.startsWith('!'))

    expect(positiveInputs).toEqual(['out/**/*', 'package.json'])
    expect(packageInputs.some((entry) => entry.includes('tests/fixtures'))).toBe(false)
  })
})
