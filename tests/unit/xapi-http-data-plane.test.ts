import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as xmlrpc from 'xmlrpc'
import { XapiClient } from '../../src/main/xapi/client'

vi.mock('xmlrpc', () => {
  const rpcClient = (sessionRef: string) => ({
    methodCall: vi.fn((
      method: string,
      _params: unknown[],
      callback: (error: unknown, value: unknown) => void,
    ) => {
      callback(null, {
        Status: 'Success',
        Value: method === 'session.login_with_password' ? sessionRef : '',
      })
    }),
  })

  return {
    createClient: vi.fn(() => rpcClient('OpaqueRef:http-session')),
    createSecureClient: vi.fn(() => rpcClient('OpaqueRef:https-session')),
  }
})

describe('XapiClient authenticated HTTP context', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the actual HTTP authority and authenticated session', async () => {
    const client = new XapiClient()

    await client.connect({
      host: 'pool.example.test',
      port: 443,
      scheme: 'http:',
      username: 'root',
      password: 'secret',
      allowSelfSigned: true,
    })

    expect(client.getAuthenticatedHttpContext()).toEqual({
      scheme: 'http:',
      host: 'pool.example.test',
      port: 443,
      tls: null,
      sessionId: 'OpaqueRef:http-session',
    })
    expect(xmlrpc.createClient).toHaveBeenCalledWith({
      host: 'pool.example.test',
      port: 443,
      path: '/',
      timeout: 45_000,
      agent: expect.objectContaining({ keepAlive: true, options: expect.objectContaining({ timeout: 30000 }) }),
    })
    expect(xmlrpc.createSecureClient).not.toHaveBeenCalled()
  })

  it('retains non-default-port HTTPS and its self-signed trust policy', async () => {
    const client = new XapiClient()

    await client.connect({
      host: 'pool.example.test',
      port: 8443,
      scheme: 'https:',
      username: 'root',
      password: 'secret',
      allowSelfSigned: true,
    })

    expect(client.getAuthenticatedHttpContext()).toEqual({
      scheme: 'https:',
      host: 'pool.example.test',
      port: 8443,
      tls: { rejectUnauthorized: false },
      sessionId: 'OpaqueRef:https-session',
    })
    expect(xmlrpc.createSecureClient).toHaveBeenCalledWith({
      host: 'pool.example.test',
      port: 8443,
      path: '/',
      timeout: 45_000,
      agent: expect.objectContaining({ keepAlive: true, options: expect.objectContaining({ timeout: 30000 }) }),
      rejectUnauthorized: false,
    })
    expect(xmlrpc.createClient).not.toHaveBeenCalled()
  })

  it('retains strict TLS verification for HTTPS on a non-default port', async () => {
    const client = new XapiClient()

    await client.connect({
      host: 'pool.example.test',
      port: 8443,
      scheme: 'https:',
      username: 'root',
      password: 'secret',
      allowSelfSigned: false,
    })

    expect(client.getAuthenticatedHttpContext()).toEqual({
      scheme: 'https:',
      host: 'pool.example.test',
      port: 8443,
      tls: { rejectUnauthorized: true },
      sessionId: 'OpaqueRef:https-session',
    })
    expect(xmlrpc.createSecureClient).toHaveBeenCalledWith({
      host: 'pool.example.test',
      port: 8443,
      path: '/',
      timeout: 45_000,
      agent: expect.objectContaining({ keepAlive: true, options: expect.objectContaining({ timeout: 30000 }) }),
      rejectUnauthorized: true,
    })
  })

  it('does not expose an authenticated HTTP context before login or after logout', async () => {
    const client = new XapiClient()

    expect(client.getAuthenticatedHttpContext()).toBeNull()

    await client.connect({
      host: 'pool.example.test',
      port: 8080,
      scheme: 'http:',
      username: 'root',
      password: 'secret',
      allowSelfSigned: false,
    })
    await client.disconnect()

    expect(client.getAuthenticatedHttpContext()).toBeNull()
  })

  it('updates the HTTP authority after login redirects to the resource pool master', async () => {
    ;(xmlrpc.createClient as any).mockReturnValueOnce({
      methodCall: vi.fn((
        _method: string,
        _params: unknown[],
        callback: (error: unknown, value: unknown) => void,
      ) => {
        callback(null, {
          Status: 'Failure',
          ErrorDescription: ['HOST_IS_SLAVE', 'master.example.test'],
        })
      }),
    })

    const client = new XapiClient()
    await client.connect({
      host: 'member.example.test',
      port: 8080,
      scheme: 'http:',
      username: 'root',
      password: 'secret',
      allowSelfSigned: false,
    })

    expect(client.getAuthenticatedHttpContext()).toEqual({
      scheme: 'http:',
      host: 'master.example.test',
      port: 8080,
      tls: null,
      sessionId: 'OpaqueRef:http-session',
    })
    expect(xmlrpc.createClient).toHaveBeenNthCalledWith(2, {
      host: 'master.example.test',
      port: 8080,
      path: '/',
      timeout: 45_000,
      agent: expect.objectContaining({ keepAlive: true, options: expect.objectContaining({ timeout: 30000 }) }),
    })
  })
})
