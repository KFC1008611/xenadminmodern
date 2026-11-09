/**
 * Unit tests for XapiClient — verifies session lifecycle and error handling.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock xmlrpc before importing the module under test
vi.mock('xmlrpc', () => ({
  createClient: vi.fn(() => ({
    methodCall: vi.fn((method: string, _params: unknown[], cb: (e: unknown, v: unknown) => void) => {
      if (method === 'session.login_with_password') {
        cb(null, { Status: 'Success', Value: 'OpaqueRef:mock-session' })
      } else if (method === 'session.logout') {
        cb(null, { Status: 'Success', Value: '' })
      } else {
        cb(null, { Status: 'Success', Value: [] })
      }
    }),
  })),
  createSecureClient: vi.fn(() => ({
    methodCall: vi.fn((method: string, _params: unknown[], cb: (e: unknown, v: unknown) => void) => {
      cb(null, { Status: 'Success', Value: 'OpaqueRef:mock-secure-session' })
    }),
  })),
}))

describe('XapiClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should be disconnected initially', async () => {
    const { XapiClient } = await import('../../src/main/xapi/client')
    const client = new XapiClient()
    expect(client.isConnected()).toBe(false)
    expect(client.getSessionRef()).toBeNull()
  })

  it('does not turn a reset event or mutation socket into session invalidation or replay the call', async () => {
    const xmlrpc = await import('xmlrpc')
    const { XapiClient } = await import('../../src/main/xapi/client')
    const client = new XapiClient()
    await client.connect({ host: '192.0.2.1', port: 80, scheme: 'http:', username: 'fixture', password: 'fixture', allowSelfSigned: false })
    const rpc = vi.mocked(xmlrpc.createClient).mock.results.at(-1)!.value
    const connectionFault = vi.fn()
    const requestFault = vi.fn()
    client.on('connection-fault', connectionFault)
    client.on('request-fault', requestFault)
    for (const method of ['event.from', 'VM.start']) {
      rpc.methodCall.mockImplementationOnce((_method: string, _params: unknown[], callback: Function) => callback(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })))
      await expect(client.callWithSession(method, [])).rejects.toMatchObject({ code: 'ECONNRESET', details: { method, kind: 'transport' } })
    }
    expect(connectionFault).not.toHaveBeenCalled()
    expect(requestFault).toHaveBeenCalledTimes(2)
    expect(rpc.methodCall.mock.calls.filter(([method]: [string]) => method === 'VM.start')).toHaveLength(1)
    expect(client.isConnected()).toBe(true)
    rpc.methodCall.mockImplementationOnce((_method: string, _params: unknown[], callback: Function) => callback(null, { Status: 'Failure', ErrorDescription: ['SESSION_INVALID'] }))
    await expect(client.callWithSession('host.get_all', [])).rejects.toMatchObject({ code: 'SESSION_INVALID' })
    expect(connectionFault).toHaveBeenCalledOnce()
    await client.disconnect()
  })

  it('should connect and store the session ref', async () => {
    const { XapiClient } = await import('../../src/main/xapi/client')
    const client = new XapiClient()

    const sessionRef = await client.connect({
      host: '192.168.1.1',
      port: 80,
      scheme: 'http:',
      username: 'root',
      password: 'secret',
      allowSelfSigned: false,
    })

    expect(sessionRef).toBe('OpaqueRef:mock-session')
    expect(client.isConnected()).toBe(true)
    expect(client.getSessionRef()).toBe('OpaqueRef:mock-session')
  })

  it('should use a secure client when the scheme is HTTPS', async () => {
    const xmlrpc = await import('xmlrpc')
    const { XapiClient } = await import('../../src/main/xapi/client')
    const client = new XapiClient()

    await client.connect({
      host: '192.168.1.1',
      port: 443,
      scheme: 'https:',
      username: 'root',
      password: 'secret',
      allowSelfSigned: false,
    })

    expect(xmlrpc.createSecureClient).toHaveBeenCalled()
  })

  it('should reject call when not connected', async () => {
    const { XapiClient } = await import('../../src/main/xapi/client')
    const client = new XapiClient()

    await expect(client.callWithSession('host.get_all', [])).rejects.toThrow('No active session')
  })

  it('should disconnect and clear the session ref', async () => {
    const { XapiClient } = await import('../../src/main/xapi/client')
    const client = new XapiClient()

    await client.connect({
      host: '192.168.1.1',
      port: 80,
      scheme: 'http:',
      username: 'root',
      password: 'secret',
      allowSelfSigned: false,
    })
    expect(client.isConnected()).toBe(true)

    await client.disconnect()
    expect(client.isConnected()).toBe(false)
    expect(client.getSessionRef()).toBeNull()
  })

  it('should reject when XAPI returns a Failure envelope', async () => {
    const xmlrpc = await import('xmlrpc')
    ;(xmlrpc.createClient as any).mockReturnValueOnce({
      methodCall: vi.fn(
        (_method: string, _params: unknown[], cb: (e: unknown, v: unknown) => void) => {
          cb(null, {
            Status: 'Failure',
            ErrorDescription: ['SESSION_AUTHENTICATION_FAILED', 'root'],
          })
        }
      ),
    })

    const { XapiClient } = await import('../../src/main/xapi/client')
    const client = new XapiClient()

    await expect(
      client.connect({
        host: '192.168.1.1',
        port: 80,
        scheme: 'http:',
        username: 'root',
        password: 'wrong',
        allowSelfSigned: false,
      })
    ).rejects.toMatchObject({
      code: 'SESSION_AUTHENTICATION_FAILED',
      message: '用户名或密码不正确，XAPI 拒绝创建登录会话。',
    })
  })

  it('should retry login against the pool master when HOST_IS_SLAVE includes a master address', async () => {
    const xmlrpc = await import('xmlrpc')
    ;(xmlrpc.createClient as any)
      .mockReturnValueOnce({
        methodCall: vi.fn(
          (_method: string, _params: unknown[], cb: (e: unknown, v: unknown) => void) => {
            cb(null, {
              Status: 'Failure',
              ErrorDescription: ['HOST_IS_SLAVE', '10.0.0.10'],
            })
          }
        ),
      })
      .mockReturnValueOnce({
        methodCall: vi.fn(
          (_method: string, _params: unknown[], cb: (e: unknown, v: unknown) => void) => {
            cb(null, { Status: 'Success', Value: 'OpaqueRef:master-session' })
          }
        ),
      })

    const { XapiClient } = await import('../../src/main/xapi/client')
    const client = new XapiClient()

    await expect(
      client.connect({
        host: '10.0.0.11',
        port: 80,
        scheme: 'http:',
        username: 'root',
        password: 'secret',
        allowSelfSigned: false,
      })
    ).resolves.toBe('OpaqueRef:master-session')

    expect(client.getConnectedHost()).toBe('10.0.0.10')
    expect(xmlrpc.createClient).toHaveBeenCalledTimes(2)
  })

  it('should normalize transport errors with a user-facing message', async () => {
    const xmlrpc = await import('xmlrpc')
    const methodCall = vi.fn(
      (_method: string, _params: unknown[], cb: (e: unknown, v: unknown) => void) => {
        const error = new Error('connect ECONNREFUSED 192.168.1.1:80') as Error & { code: string }
        error.code = 'ECONNREFUSED'
        cb(error, null)
      }
    )
    ;(xmlrpc.createClient as any).mockReturnValueOnce({
      methodCall,
    })

    const { XapiClient } = await import('../../src/main/xapi/client')
    const client = new XapiClient()

    await expect(
      client.connect({
        host: '192.168.1.1',
        port: 80,
        scheme: 'http:',
        username: 'root',
        password: 'secret',
        allowSelfSigned: false,
      })
    ).rejects.toMatchObject({
      code: 'ECONNREFUSED',
      message: '目标端口拒绝连接。请检查端口设置及服务器的 XAPI 服务。（ECONNREFUSED）',
    })
    expect(methodCall).toHaveBeenCalledTimes(1)
    expect(methodCall).toHaveBeenCalledWith(
      'session.login_with_password',
      ['root', 'secret', '1.3', 'xenadmin-modern'],
      expect.any(Function),
    )
  })

  it('should not use login compatibility fallback after a timeout', async () => {
    const xmlrpc = await import('xmlrpc')
    const methodCall = vi.fn(
      (_method: string, _params: unknown[], cb: (e: unknown, v: unknown) => void) => {
        const error = new Error('connect ETIMEDOUT 192.168.1.1:80') as Error & { code: string }
        error.code = 'ETIMEDOUT'
        cb(error, null)
      }
    )
    ;(xmlrpc.createClient as any).mockReturnValueOnce({ methodCall })

    const { XapiClient } = await import('../../src/main/xapi/client')
    const client = new XapiClient()

    await expect(
      client.connect({
        host: '192.168.1.1',
        port: 80,
        scheme: 'http:',
        username: 'root',
        password: 'secret',
        allowSelfSigned: false,
      })
    ).rejects.toMatchObject({
      code: 'ETIMEDOUT',
      details: { kind: 'transport' },
      message: '连接服务器超时。请检查网络、防火墙及服务器负载。（ETIMEDOUT）',
    })
    expect(methodCall).toHaveBeenCalledTimes(1)
    expect(methodCall).toHaveBeenCalledWith(
      'session.login_with_password',
      ['root', 'secret', '1.3', 'xenadmin-modern'],
      expect.any(Function),
    )
  })

  it('should not use login compatibility fallback after a TLS certificate error', async () => {
    const xmlrpc = await import('xmlrpc')
    const methodCall = vi.fn(
      (_method: string, _params: unknown[], cb: (e: unknown, v: unknown) => void) => {
        const error = new Error('self-signed certificate') as Error & { code: string }
        error.code = 'DEPTH_ZERO_SELF_SIGNED_CERT'
        cb(error, null)
      }
    )
    ;(xmlrpc.createSecureClient as any).mockReturnValueOnce({ methodCall })

    const { XapiClient } = await import('../../src/main/xapi/client')
    const client = new XapiClient()

    await expect(
      client.connect({
        host: '192.168.1.1',
        port: 443,
        scheme: 'https:',
        username: 'root',
        password: 'secret',
        allowSelfSigned: false,
      })
    ).rejects.toMatchObject({
      code: 'DEPTH_ZERO_SELF_SIGNED_CERT',
      details: { kind: 'transport' },
      message: '服务器使用自签名证书，证书验证未通过。确认服务器可信后，可勾选“允许自签名证书”。（DEPTH_ZERO_SELF_SIGNED_CERT）',
    })
    expect(methodCall).toHaveBeenCalledTimes(1)
    expect(methodCall).toHaveBeenCalledWith(
      'session.login_with_password',
      ['root', 'secret', '1.3', 'xenadmin-modern'],
      expect.any(Function),
    )
  })
})
