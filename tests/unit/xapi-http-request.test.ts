import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { PassThrough, Readable } from 'stream'
import { afterEach, describe, expect, it } from 'vitest'
import {
  requestXapiHttp,
  type XapiHttpRequestOptions,
} from '../../src/main/xapi/http-data-plane'
import type { AuthenticatedHttpContext } from '../../src/main/xapi/client'

const openServers = new Set<Server>()

function httpContext(port: number): AuthenticatedHttpContext {
  return {
    scheme: 'http:',
    host: '127.0.0.1',
    port,
    tls: null,
    sessionId: 'OpaqueRef:session',
  }
}

async function listen(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<{ server: Server; port: number }> {
  const server = createServer(handler)
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

async function closeServer(server: Server): Promise<void> {
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  openServers.delete(server)
}

async function responseText(response: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of response) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

async function requestBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}

function redirectWithBackpressure(
  request: IncomingMessage,
  response: ServerResponse,
  location: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    request.once('aborted', () => reject(new Error('Redirect response was not drained')))
    response.once('finish', resolve)
    response.once('error', reject)
    response.writeHead(302, { Location: location })

    const chunk = Buffer.alloc(64 * 1024, 0x72)
    let remaining = 64
    const write = (): void => {
      while (remaining > 0) {
        remaining -= 1
        if (!response.write(chunk)) {
          response.once('drain', write)
          return
        }
      }
      response.end()
    }
    write()
  })
}

afterEach(async () => {
  await Promise.all([...openServers].map(closeServer))
})

describe('requestXapiHttp', () => {
  it('sends the requested method, path, and query to the authenticated HTTP authority', async () => {
    let observed: { method?: string; url?: string } = {}
    const { port } = await listen((request, response) => {
      observed = { method: request.method, url: request.url }
      response.end('rrd-data')
    })

    const response = await requestXapiHttp({
      context: httpContext(port),
      method: 'GET',
      path: '/rrd_updates',
      query: new URLSearchParams([
        ['session_id', 'OpaqueRef:session'],
        ['start', '1722510000'],
        ['cf', 'AVERAGE'],
        ['interval', '5'],
        ['host', 'true'],
      ]),
      timeoutMs: 1_000,
    })

    expect(observed).toEqual({
      method: 'GET',
      url: '/rrd_updates?session_id=OpaqueRef%3Asession&start=1722510000&cf=AVERAGE&interval=5&host=true',
    })
    expect(await responseText(response)).toBe('rrd-data')
  })

  it('rejects a cross-authority 302 before forwarding authenticated query parameters', async () => {
    let sourceRequests = 0
    let targetRequests = 0
    const drainedResponses: Array<Promise<void>> = []
    const target = await listen((_request, response) => {
      targetRequests += 1
      response.end('unexpected')
    })
    const source = await listen((request, response) => {
      sourceRequests += 1
      drainedResponses.push(
        redirectWithBackpressure(
          request,
          response,
          `http://127.0.0.1:${target.port}/disk-hop`,
        ),
      )
    })

    await expect(requestXapiHttp({
      context: httpContext(source.port),
      method: 'GET',
      path: '/export',
      query: new URLSearchParams([
        ['session_id', 'OpaqueRef:session'],
        ['task_id', 'OpaqueRef:task'],
        ['uuid', 'vm-uuid'],
      ]),
      timeoutMs: 2_000,
    })).rejects.toMatchObject({ code: 'REDIRECT_AUTHORITY' })

    await Promise.all(drainedResponses)
    expect({ sourceRequests, targetRequests }).toEqual({ sourceRequests: 1, targetRequests: 0 })
  }, 10_000)

  it('follows relative and absolute same-authority 302 redirects while preserving method and query', async () => {
    const observed: Array<{ method?: string; url?: string }> = []
    const drainedResponses: Array<Promise<void>> = []
    const { port } = await listen((request, response) => {
      observed.push({ method: request.method, url: request.url })
      if (request.url?.startsWith('/export?')) {
        drainedResponses.push(redirectWithBackpressure(request, response, '/member-hop'))
        return
      }
      if (request.url?.startsWith('/member-hop?')) {
        drainedResponses.push(redirectWithBackpressure(
          request,
          response,
          `http://${request.headers.host}/disk-hop`,
        ))
        return
      }
      response.end('complete')
    })

    const response = await requestXapiHttp({
      context: httpContext(port),
      method: 'GET',
      path: '/export',
      query: new URLSearchParams([
        ['session_id', 'OpaqueRef:session'],
        ['task_id', 'OpaqueRef:task'],
        ['uuid', 'vm-uuid'],
      ]),
      timeoutMs: 2_000,
    })

    expect(await responseText(response)).toBe('complete')
    await Promise.all(drainedResponses)
    expect(observed).toEqual([
      {
        method: 'GET',
        url: '/export?session_id=OpaqueRef%3Asession&task_id=OpaqueRef%3Atask&uuid=vm-uuid',
      },
      {
        method: 'GET',
        url: '/member-hop?session_id=OpaqueRef%3Asession&task_id=OpaqueRef%3Atask&uuid=vm-uuid',
      },
      {
        method: 'GET',
        url: '/disk-hop?session_id=OpaqueRef%3Asession&task_id=OpaqueRef%3Atask&uuid=vm-uuid',
      },
    ])
  }, 10_000)

  it('rejects the eleventh redirect without issuing an unbounded request chain', async () => {
    let requestCount = 0
    const { port } = await listen((_request, response) => {
      requestCount += 1
      response.writeHead(302, { Location: '/loop' })
      response.end()
    })

    await expect(requestXapiHttp({
      context: httpContext(port),
      method: 'GET',
      path: '/loop',
      timeoutMs: 1_000,
    })).rejects.toMatchObject({ code: 'REDIRECT_LIMIT' })
    expect(requestCount).toBe(11)
  })

  it('aborts the active redirect hop without issuing another request', async () => {
    const controller = new AbortController()
    let sourceRequests = 0
    let targetRequests = 0
    let targetRequestClosed!: () => void
    const targetClosed = new Promise<void>((resolve) => {
      targetRequestClosed = resolve
    })
    const source = await listen((request, response) => {
      if (request.url === '/export') {
        sourceRequests += 1
        response.writeHead(302, { Location: `http://${request.headers.host}/slow` })
        response.end()
        return
      }
      targetRequests += 1
      request.once('close', targetRequestClosed)
      controller.abort()
    })

    await expect(requestXapiHttp({
      context: httpContext(source.port),
      method: 'GET',
      path: '/export',
      signal: controller.signal,
      timeoutMs: 1_000,
    })).rejects.toMatchObject({ name: 'AbortError' })
    await targetClosed
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect({ sourceRequests, targetRequests }).toEqual({ sourceRequests: 1, targetRequests: 1 })
  })

  it('destroys the active upload stream when the request is aborted', async () => {
    const controller = new AbortController()
    const body = new PassThrough()
    body.write(Buffer.alloc(64 * 1024, 0x61))
    let requestCount = 0
    const { port } = await listen((request) => {
      requestCount += 1
      request.once('data', () => controller.abort())
    })

    await expect(requestXapiHttp({
      context: httpContext(port),
      method: 'PUT',
      path: '/import',
      bodyFactory: () => body,
      timeoutMs: 1_000,
      signal: controller.signal,
    })).rejects.toMatchObject({ name: 'AbortError' })

    expect(body.destroyed).toBe(true)
    expect(requestCount).toBe(1)
  })

  it('continues a PUT after XAPI sends success headers before receiving the body', async () => {
    const body = new PassThrough()
    const first = Buffer.from('xva-first-')
    const tail = Buffer.from('xva-tail')
    body.write(first)
    let received = Buffer.alloc(0)
    const { port } = await listen((request, response) => {
      response.writeHead(200, { Connection: 'close' })
      response.flushHeaders()
      void requestBody(request).then((data) => {
        received = data
        response.end('imported')
      }, () => { /* The client may abort a failing regression run. */ })
    })

    const response = await requestXapiHttp({
      context: httpContext(port), method: 'PUT', path: '/import',
      contentLength: first.length + tail.length, bodyFactory: () => body,
      timeoutMs: 1_000,
    })
    expect(body.destroyed).toBe(false)
    body.end(tail)
    expect(await responseText(response)).toBe('imported')
    expect(received).toEqual(Buffer.concat([first, tail]))
  })

  it('stops a PUT source when XAPI rejects it before receiving the full body', async () => {
    const body = new PassThrough()
    body.write('xva-first')
    const { port } = await listen((_request, response) => {
      response.writeHead(403, { Connection: 'close' })
      response.end('denied')
    })
    const response = await requestXapiHttp({
      context: httpContext(port), method: 'PUT', path: '/import',
      contentLength: 1024, bodyFactory: () => body, timeoutMs: 1_000,
    })
    expect(await responseText(response)).toBe('denied')
    expect(response.statusCode).toBe(403)
    expect(body.destroyed).toBe(true)
  })

  it('aborts both streams when cancelled after early success headers', async () => {
    const controller = new AbortController()
    const body = new PassThrough()
    body.write('xva-first')
    const { port } = await listen((request, response) => {
      response.writeHead(200, { Connection: 'close' })
      response.flushHeaders()
      request.resume()
    })
    const response = await requestXapiHttp({
      context: httpContext(port), method: 'PUT', path: '/import',
      contentLength: 1024, bodyFactory: () => body,
      signal: controller.signal, timeoutMs: 1_000,
    })
    const consumed = expect(responseText(response)).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    await consumed
    expect(body.destroyed).toBe(true)
  })

  it('propagates a source read failure after early success headers to the response', async () => {
    const body = new PassThrough()
    body.write('xva-first')
    const { port } = await listen((request, response) => {
      response.writeHead(200, { Connection: 'close' })
      response.flushHeaders()
      request.resume()
    })
    const response = await requestXapiHttp({
      context: httpContext(port), method: 'PUT', path: '/import',
      contentLength: 1024, bodyFactory: () => body, timeoutMs: 1_000,
    })
    const consumed = expect(responseText(response)).rejects.toMatchObject({
      code: 'NETWORK', cause: expect.objectContaining({ message: 'file read failed' }),
    })
    body.destroy(new Error('file read failed'))
    await consumed
  })

  it('destroys a timed-out request without retrying it', async () => {
    let requestCount = 0
    let requestClosed!: () => void
    const closed = new Promise<void>((resolve) => {
      requestClosed = resolve
    })
    const { port } = await listen((request) => {
      requestCount += 1
      request.once('close', requestClosed)
    })

    await expect(requestXapiHttp({
      context: httpContext(port),
      method: 'GET',
      path: '/slow',
      timeoutMs: 30,
    })).rejects.toMatchObject({ code: 'TIMEOUT' })
    await closed
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(requestCount).toBe(1)
  })

  it.each([false, true])('fails a PUT whose source ends before Content-Length (early headers: %s)', async (earlyHeaders) => {
    const body = new PassThrough()
    body.write('partial')
    const { port } = await listen((request, response) => {
      if (earlyHeaders) { response.writeHead(200); response.flushHeaders() }
      request.resume()
    })
    const options = {
      context: httpContext(port), method: 'PUT', path: '/import',
      contentLength: 1024, bodyFactory: () => body, timeoutMs: 500,
    }
    if (earlyHeaders) {
      const response = await requestXapiHttp(options)
      const consumed = expect(responseText(response)).rejects.toMatchObject({ code: 'BODY_LENGTH_MISMATCH' })
      body.end()
      await consumed
    } else {
      const request = expect(requestXapiHttp(options)).rejects.toMatchObject({ code: 'BODY_LENGTH_MISMATCH' })
      body.end()
      await request
    }
  })

  it('rejects a PUT source that exceeds the declared Content-Length', async () => {
    const { port } = await listen((request) => request.resume())
    await expect(requestXapiHttp({
      context: httpContext(port), method: 'PUT', path: '/import',
      headers: { 'Content-Length': '8' }, bodyFactory: () => Readable.from([Buffer.alloc(1024)]), timeoutMs: 500,
    })).rejects.toMatchObject({ code: 'BODY_LENGTH_MISMATCH' })
  })

  it('propagates a source closed without end or error after early success headers', async () => {
    const body = new PassThrough()
    body.write('partial')
    const { port } = await listen((request, response) => {
      response.writeHead(200); response.flushHeaders()
      request.resume()
    })
    const response = await requestXapiHttp({
      context: httpContext(port), method: 'PUT', path: '/import',
      contentLength: 1024, bodyFactory: () => body, timeoutMs: 500,
    })
    const consumed = expect(responseText(response)).rejects.toMatchObject({ code: 'BODY_STREAM_CLOSED' })
    body.destroy()
    await consumed
  })

  it('does not reset the overall hard deadline after a redirect', async () => {
    let sourceRequests = 0
    let targetRequests = 0
    const source = await listen((request, response) => {
      if (request.url === '/export') {
        sourceRequests += 1
        setTimeout(() => {
          response.writeHead(302, {
            Location: `http://${request.headers.host}/active-download`,
          })
          response.end()
        }, 20)
        return
      }
      targetRequests += 1
      response.write('0')
      let chunk = 0
      const interval = setInterval(() => {
        chunk += 1
        response.write(String(chunk))
      }, 10)
      response.once('close', () => clearInterval(interval))
    })

    const response = await requestXapiHttp({
      context: httpContext(source.port),
      method: 'GET',
      path: '/export',
      timeoutMs: 80,
    })

    await expect(responseText(response)).rejects.toMatchObject({ code: 'TIMEOUT' })
    expect({ sourceRequests, targetRequests }).toEqual({ sourceRequests: 1, targetRequests: 1 })
  })

  it('reopens a streaming PUT body after redirect and preserves its bytes and length', async () => {
    const payload = Buffer.concat([
      Buffer.alloc(128 * 1024, 0x61),
      Buffer.from('xva-tail'),
    ])
    const observedBodies: Buffer[] = []
    const observedLengths: Array<string | undefined> = []
    const source = await listen(async (request, response) => {
      observedLengths.push(request.headers['content-length'])
      observedBodies.push(await requestBody(request))
      if (request.url?.startsWith('/import?')) {
        response.writeHead(302, {
          Location: `http://${request.headers.host}/import-on-member`,
        })
        response.end()
        return
      }
      response.end('uploaded')
    })
    let bodyFactoryCalls = 0
    const options: XapiHttpRequestOptions = {
      context: httpContext(source.port),
      method: 'PUT',
      path: '/import',
      query: new URLSearchParams([
        ['session_id', 'OpaqueRef:session'],
        ['task_id', 'OpaqueRef:task'],
        ['sr_id', 'OpaqueRef:sr'],
      ]),
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(payload.length),
      },
      bodyFactory: () => {
        bodyFactoryCalls += 1
        return Readable.from([
          payload.subarray(0, 64 * 1024),
          payload.subarray(64 * 1024),
        ])
      },
      timeoutMs: 2_000,
    }

    const response = await requestXapiHttp(options)

    expect(await responseText(response)).toBe('uploaded')
    expect(bodyFactoryCalls).toBe(2)
    expect(observedLengths).toEqual([String(payload.length), String(payload.length)])
    expect(observedBodies).toHaveLength(2)
    expect(observedBodies[0].equals(payload)).toBe(true)
    expect(observedBodies[1].equals(payload)).toBe(true)
  })

  it('destroys a partial PUT source before reopening the body for an early redirect', async () => {
    const payload = Buffer.concat([
      Buffer.alloc(128 * 1024, 0x62),
      Buffer.from('redirected-xva-tail'),
    ])
    const firstChunk = payload.subarray(0, 32 * 1024)
    let sourceBytes = 0
    let targetBody = Buffer.alloc(0)
    let firstBody: PassThrough | undefined
    let firstDestroyedBeforeReplay: boolean | undefined
    let bodyFactoryCalls = 0

    const source = await listen(async (request, response) => {
      if (request.url !== '/import') {
        targetBody = await requestBody(request)
        response.end('uploaded')
        return
      }
      request.once('data', (chunk: Buffer) => {
        sourceBytes += chunk.length
        response.writeHead(302, {
          Location: `http://${request.headers.host}/import-on-member`,
          Connection: 'close',
        })
        response.end()
      })
    })

    let response: IncomingMessage | undefined
    try {
      response = await requestXapiHttp({
        context: httpContext(source.port),
        method: 'PUT',
        path: '/import',
        headers: { 'Content-Type': 'application/octet-stream' },
        contentLength: payload.length,
        bodyFactory: () => {
          bodyFactoryCalls += 1
          if (bodyFactoryCalls === 1) {
            firstBody = new PassThrough()
            firstBody.write(firstChunk)
            return firstBody
          }
          firstDestroyedBeforeReplay = firstBody?.destroyed
          return Readable.from([payload])
        },
        timeoutMs: 2_000,
      })
    } finally {
      firstBody?.destroy()
    }

    expect(response).toBeDefined()
    expect(await responseText(response!)).toBe('uploaded')
    expect(bodyFactoryCalls).toBe(2)
    expect(firstDestroyedBeforeReplay).toBe(true)
    // TCP may split the first write; this server redirects on the first data event.
    expect(sourceBytes).toBeGreaterThan(0)
    expect(sourceBytes).toBeLessThanOrEqual(firstChunk.length)
    expect(targetBody.equals(payload)).toBe(true)
  })
})
