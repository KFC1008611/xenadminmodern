/**
 * Unit tests for rrd-client.service.ts
 *
 * Tests the published HTTP wire contract and error handling.
 */
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { connectionManager } from '../../src/main/xapi/connection-manager'
import {
  fetchHostRrd,
  fetchRrdUpdates,
  fetchVmRrd,
  RrdFetchError,
} from '../../src/main/xapi/services/rrd-client.service'

interface CapturedRequest {
  method: string
  url: string
  accept?: string
}

describe('published RRD HTTP data-plane contract', () => {
  let server: Server
  let port: number
  let requests: CapturedRequest[]
  let disconnectRequests: boolean
  let oversizedResponse: boolean
  let holdResponse: boolean
  let authenticatedContext: {
    scheme: 'http:' | 'https:'
    host: string
    port: number
    tls: null | { rejectUnauthorized: boolean }
    sessionId: string
  }
  const callWithSession = vi.fn()
  const getAuthenticatedHttpContext = vi.fn(() => authenticatedContext)

  beforeAll(async () => {
    server = createServer((request, response) => {
      requests.push({
        method: request.method ?? '',
        url: request.url ?? '',
        accept: request.headers.accept,
      })
      if (disconnectRequests) {
        request.socket.destroy()
        return
      }
      response.writeHead(200, { 'content-type': 'application/xml', date: 'Wed, 21 Oct 2026 12:00:00 GMT' })
      if (holdResponse) { response.write('<rrd>'); return }
      response.end(oversizedResponse ? Buffer.alloc(10 * 1024 * 1024 + 1, 'x') : '<rrd/>')
    })

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    port = (server.address() as AddressInfo).port
  })

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
    vi.restoreAllMocks()
  })

  beforeEach(() => {
    requests = []
    disconnectRequests = false
    oversizedResponse = false
    holdResponse = false
    authenticatedContext = {
      scheme: 'http:',
      host: '127.0.0.1',
      port,
      tls: null,
      sessionId: 'OpaqueRef:rrd-session',
    }
    callWithSession.mockReset()
    callWithSession.mockImplementation(async (method: string) => {
      if (method === 'host.get_by_uuid') return 'OpaqueRef:member'
      if (method === 'host.get_address') return '127.0.0.1'
      throw new Error(`Unexpected method ${method}`)
    })
    getAuthenticatedHttpContext.mockClear()
    vi.spyOn(connectionManager, 'getClient').mockReturnValue({
      getAuthenticatedHttpContext,
      callWithSession,
    } as never)
  })

  it('fetches host_rrd without unpublished uuid or json parameters', async () => {
    authenticatedContext.host = 'not-the-member.invalid'
    await expect(fetchHostRrd('connection-1', 'member-uuid')).resolves.toBe('<rrd/>')

    expect(requests).toEqual([
      {
        method: 'GET',
        accept: 'application/xml',
        url: '/host_rrd?session_id=OpaqueRef%3Arrd-session',
      },
    ])
    expect(getAuthenticatedHttpContext).toHaveBeenCalledTimes(1)
  })

  it('routes host incremental requests using the authenticated pool member address', async () => {
    authenticatedContext.host = 'not-the-member.invalid'
    await expect(fetchRrdUpdates('connection-1', 1234, true, 'member-uuid')).resolves.toBe('<rrd/>')
    expect(callWithSession).toHaveBeenCalledWith('host.get_by_uuid', ['member-uuid'])
    expect(callWithSession).toHaveBeenCalledWith('host.get_address', ['OpaqueRef:member'])
    expect(requests[0].url).toContain('/rrd_updates?')
  })

  it('rejects unresolved or malformed pool member addresses before HTTP', async () => {
    callWithSession.mockResolvedValueOnce('OpaqueRef:member').mockResolvedValueOnce('https://outside.invalid')
    await expect(fetchHostRrd('connection-1', 'member-uuid')).rejects.toThrow('Host management address is unavailable')
    expect(requests).toHaveLength(0)
  })

  it('fetches vm_rrd with the authenticated session and VM uuid', async () => {
    await expect(fetchVmRrd('connection-1', 'vm-uuid')).resolves.toBe('<rrd/>')

    expect(requests).toEqual([
      {
        method: 'GET',
        accept: 'application/xml',
        url: '/vm_rrd?session_id=OpaqueRef%3Arrd-session&uuid=vm-uuid',
      },
    ])
    expect(getAuthenticatedHttpContext).toHaveBeenCalledTimes(1)
  })

  it('fetches rrd_updates over HTTP with the published query parameters', async () => {
    await expect(fetchRrdUpdates('connection-1', 1234.9, true)).resolves.toBe('<rrd/>')

    expect(requests).toEqual([
      {
        method: 'GET',
        accept: 'application/xml',
        url: '/rrd_updates?session_id=OpaqueRef%3Arrd-session&start=1234&cf=AVERAGE&interval=5&host=true',
      },
    ])
    expect(callWithSession).not.toHaveBeenCalled()
  })

  it('uses the authenticated HTTPS scheme on a non-443 port', async () => {
    authenticatedContext.scheme = 'https:'
    authenticatedContext.host = 'localhost'
    authenticatedContext.tls = { rejectUnauthorized: true }

    await expect(fetchVmRrd('connection-1', 'vm-uuid')).rejects.toMatchObject({
      endpoint: `https://localhost:${port}/vm_rrd?session_id=%5BREDACTED%5D&uuid=vm-uuid`,
    })
    expect(requests).toEqual([])
  })

  it('does not replay an RRD request after the connection drops', async () => {
    disconnectRequests = true

    await expect(fetchVmRrd('connection-1', 'vm-uuid')).rejects.toMatchObject({
      code: 'NETWORK',
    })
    expect(requests).toHaveLength(1)
  })

  it('identifies oversized archives and retains the server clock without exposing the session', async () => {
    oversizedResponse = true
    const error = await fetchHostRrd('connection-1', 'member-uuid').catch((failure) => failure)
    expect(error).toMatchObject({ code: 'TOO_LARGE', serverTime: Date.parse('2026-10-21T12:00:00Z') })
    expect(error.endpoint).not.toContain('OpaqueRef:rrd-session')
    expect(requests).toHaveLength(1)
  })

  it('does not dispatch HTTP after a collection signal has been aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(fetchVmRrd('connection-1', 'vm', controller.signal)).rejects.toBeInstanceOf(RrdFetchError)
    await expect(fetchHostRrd('connection-1', 'member', controller.signal)).rejects.toBeInstanceOf(RrdFetchError)
    await expect(fetchRrdUpdates('connection-1', 1234, true, 'member', controller.signal)).rejects.toBeInstanceOf(RrdFetchError)
    expect(requests).toEqual([])
  })

  it('interrupts an in-flight RRD response when collection stops', async () => {
    holdResponse = true
    const controller = new AbortController()
    const result = expect(fetchVmRrd('connection-1', 'vm', controller.signal)).rejects.toBeInstanceOf(RrdFetchError)
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    controller.abort()
    await result
  })
})

describe('RrdFetchError', () => {
  it('has correct properties', () => {
    const error = new RrdFetchError('NETWORK', 'https://host:443/host_rrd', 'Connection refused')

    expect(error.name).toBe('RrdFetchError')
    expect(error.code).toBe('NETWORK')
    expect(error.endpoint).toBe('https://host:443/host_rrd')
    expect(error.message).toBe('Connection refused')
  })

  it('preserves cause error', () => {
    const cause = new Error('original error')
    const error = new RrdFetchError('TIMEOUT', 'https://host:443/vm_rrd', 'Timed out', cause)

    expect(error.cause).toBe(cause)
  })

  it('supports all error codes', () => {
    const codes = ['NETWORK', 'AUTH', 'TIMEOUT', 'PARSE', 'NOT_FOUND'] as const
    for (const code of codes) {
      const error = new RrdFetchError(code, '/test', 'msg')
      expect(error.code).toBe(code)
    }
  })
})
