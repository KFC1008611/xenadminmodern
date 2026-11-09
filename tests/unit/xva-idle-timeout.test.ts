import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import { createServer as createTcpServer, type Socket } from 'node:net'
import { afterEach, expect, it } from 'vitest'
import { requestXapiHttp } from '../../src/main/xapi/http-data-plane'
const servers: Server[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }))
})
async function server(handler: (request: IncomingMessage, response: ServerResponse) => void) {
  const instance = createServer(handler); servers.push(instance)
  await new Promise<void>((resolve) => instance.listen(0, '127.0.0.1', resolve))
  const address = instance.address()
  if (!address || typeof address === 'string') throw new Error('No address')
  return { context: { scheme: 'http:' as const, host: '127.0.0.1', port: address.port, sessionId: 'fixture', tls: null }, method: 'GET', path: '/transfer', timeoutMs: 0, idleTimeoutMs: 120 }
}
it('bounds a server that never returns headers', async () => {
  const options = await server(() => {})
  await expect(requestXapiHttp(options)).rejects.toMatchObject({ code: 'IDLE_TIMEOUT' })
})
it('destroys a response that stalls after headers', async () => {
  const options = await server((_request, response) => { response.writeHead(200); response.flushHeaders() })
  const response = await requestXapiHttp(options)
  await expect((async () => { for await (const _chunk of response) { /* consume */ } })()).rejects.toMatchObject({ code: 'IDLE_TIMEOUT' })
})
it('does not apply the idle interval as a total duration limit to a progressing transfer', async () => {
  const options = await server((_request, response) => {
    let count = 0
    const interval = setInterval(() => { response.write('chunk'); if (++count === 8) { clearInterval(interval); response.end() } }, 40)
    response.once('close', () => clearInterval(interval))
  })
  const response = await requestXapiHttp(options)
  let bytes = 0
  for await (const chunk of response) bytes += chunk.length
  expect(bytes).toBe(40)
})
it('bounds an HTTPS connection whose TCP peer never completes the TLS handshake', async () => {
  const sockets = new Set<Socket>()
  const tcp = createTcpServer((socket) => { sockets.add(socket); socket.resume() })
  await new Promise<void>((resolve) => tcp.listen(0, '127.0.0.1', resolve))
  const address = tcp.address()
  if (!address || typeof address === 'string') throw new Error('No address')
  const controller = new AbortController()
  const safety = setTimeout(() => controller.abort(), 600)
  try {
    await expect(requestXapiHttp({
      context: { scheme: 'https:', host: '127.0.0.1', port: address.port, sessionId: 'fixture', tls: { rejectUnauthorized: true } },
      method: 'PUT', path: '/import', timeoutMs: 0, idleTimeoutMs: 100, signal: controller.signal,
    })).rejects.toMatchObject({ code: 'IDLE_TIMEOUT' })
  } finally {
    clearTimeout(safety)
    for (const socket of sockets) socket.destroy()
    await new Promise<void>((resolve) => tcp.close(() => resolve()))
  }
})
