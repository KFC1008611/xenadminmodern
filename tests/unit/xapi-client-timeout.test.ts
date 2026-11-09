import { readFileSync } from 'node:fs'
import { createServer as createHttpServer, type RequestListener } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { Socket } from 'node:net'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { XapiClient } from '../../src/main/xapi/client'

function successResponse(value: string): string {
  return `<?xml version="1.0"?><methodResponse><params><param><value><struct>
<member><name>Status</name><value><string>Success</string></value></member>
<member><name>Value</name><value><string>${value}</string></value></member>
</struct></value></param></params></methodResponse>`
}

async function withRpcServer(
  scheme: 'http:' | 'https:',
  delayMs: (method: string) => number,
  check: (fixture: {
    client: XapiClient
    requests: { method: string; socket: unknown }[]
    requestFault: ReturnType<typeof vi.fn>
  }) => Promise<void>,
): Promise<void> {
  const requests: { method: string; socket: unknown }[] = []
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const handler: RequestListener = (request, response) => {
    let body = ''
    request.on('data', (chunk) => { body += chunk })
    request.on('end', () => {
      const method = /<methodName>(.*?)<\/methodName>/.exec(body)![1]
      requests.push({ method, socket: request.socket })
      response.setHeader('Content-Type', 'text/xml')
      // Node subtracts its one-second buffer, leaving a one-second idle
      // timeout. Neither active request may inherit that idle timeout.
      response.setHeader('Keep-Alive', 'timeout=2')
      const delay = delayMs(method)
      if (delay > 0) {
        const timer = setTimeout(() => {
          timers.delete(timer)
          response.end(successResponse(`${method}-complete`))
        }, delay)
        timers.add(timer)
      } else {
        response.end(successResponse('OpaqueRef:session'))
      }
    })
  }
  const server = scheme === 'http:' ? createHttpServer(handler) : createHttpsServer({
    key: readFileSync(resolve(__dirname, '../fixtures/xapi-http-test-cert.key')),
    cert: readFileSync(resolve(__dirname, '../fixtures/xapi-http-test-cert.crt')),
  }, handler)
  const client = new XapiClient()
  const requestFault = vi.fn()
  client.on('request-fault', requestFault)
  try {
    await new Promise<void>((resolveListen, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolveListen)
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('No loopback port')
    await client.connect({ host: '127.0.0.1', port: address.port, scheme,
      username: 'fixture', password: 'fixture', allowSelfSigned: true })
    await check({ client, requests, requestFault })
  } finally {
    for (const timer of timers) clearTimeout(timer)
    await client.disconnect()
    server.closeAllConnections()
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()))
  }
}

describe('XML-RPC request timeout on reused connections', () => {
  it.each(['http:', 'https:'] as const)('keeps long polls and synchronous mutations alive over %s', async (scheme) => {
    await withRpcServer(scheme, (method) => ['event.from', 'VM.copy'].includes(method) ? 1500 : 0,
      async ({ client, requests, requestFault }) => {
        await expect(client.callWithSession('event.from', [['VM'], '', 30])).resolves.toBe('event.from-complete')
        await expect(client.callWithSession('VM.copy', ['OpaqueRef:vm', 'Copy', 'OpaqueRef:sr'])).resolves.toBe('VM.copy-complete')
        expect(requests.map(({ method }) => method)).toEqual(['session.login_with_password', 'event.from', 'VM.copy'])
        expect(requests.every(({ socket }) => socket === requests[0].socket)).toBe(true)
        expect(requestFault).not.toHaveBeenCalled()
      })
  }, 10_000)

  it.each(['http:', 'https:'] as const)('waits for synchronous results while bounding concurrent and subsequent reads over %s', async (scheme) => {
    // Exercise the real socket timers, compressing only the 45-second limit.
    // Fake JS timers would not advance the underlying network socket timeout.
    const originalSetTimeout = Socket.prototype.setTimeout
    const timeoutSpy = vi.spyOn(Socket.prototype, 'setTimeout').mockImplementation(function (this: Socket, ms, callback) {
      return originalSetTimeout.call(this, ms === 45_000 ? 200 : ms, callback)
    })
    const operations = ['VM.copy', 'VM.clone', 'VM.provision', 'VDI.copy', 'SR.scan', 'SR.probe']
    const bounded = ['host.get_all', 'VM.get_record', 'Async.VM.copy', 'session.get_this_host', 'event.from', 'task.get_record']
    try {
      await withRpcServer(scheme, (method) => [...operations, ...bounded].includes(method) ? 600 : 0,
        async ({ client, requests, requestFault }) => {
          const jobs = Promise.all(operations.map((method) => client.callWithSession(method, [])))
          await Promise.all([
            expect(client.callWithSession('host.get_all', [])).rejects.toMatchObject({ code: 'ETIMEDOUT' }),
            expect(jobs).resolves.toEqual(operations.map((method) => `${method}-complete`)),
          ])
          const copy = requests.find(({ method }) => method === 'VM.copy')!
          expect(copy.socket).toBe(requests[0].socket)
          // Reads reusing an operation's socket must restore their timeout.
          for (const method of bounded.slice(1)) {
            await expect(client.callWithSession(method, [])).rejects.toMatchObject({ code: 'ETIMEDOUT' })
          }
          const reusedRead = requests.find(({ method }) => method === 'VM.get_record')!
          expect(requests.some(({ method, socket }) => operations.includes(method) && socket === reusedRead.socket)).toBe(true)
          expect(operations.every((method) => requests.filter((request) => request.method === method).length === 1)).toBe(true)
          expect(requestFault).toHaveBeenCalledTimes(bounded.length)
        })
    } finally {
      timeoutSpy.mockRestore()
    }
  }, 10_000)

  it.each(['http:', 'https:'] as const)('disconnects a pending synchronous operation without replay over %s', async (scheme) => {
    await withRpcServer(scheme, (method) => method === 'VM.copy' ? 5000 : 0,
      async ({ client, requests, requestFault }) => {
        const pending = expect(client.callWithSession('VM.copy', [])).rejects.toMatchObject({ code: 'ECONNRESET' })
        await vi.waitFor(() => expect(requests.some(({ method }) => method === 'VM.copy')).toBe(true))
        await client.disconnect()
        await pending
        expect(requests.filter(({ method }) => method === 'VM.copy')).toHaveLength(1)
        expect(requestFault).toHaveBeenCalledOnce()
      })
  })
})
