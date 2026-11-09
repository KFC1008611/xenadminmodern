import { createServer, type IncomingHttpHeaders } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { XMLParser } from 'fast-xml-parser'
import { XapiClient } from '../../src/main/xapi/client'

interface CapturedRequest {
  headers: IncomingHttpHeaders
  rawBody: string
  method: string
  params: string[]
}

const servers: ReturnType<typeof createServer>[] = []

function xmlValue(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length !== 1) throw new Error(`Unexpected XML-RPC value: ${JSON.stringify(value)}`)
  return entries[0][1]
}

function parseRequest(rawBody: string): Pick<CapturedRequest, 'method' | 'params'> {
  const parsed = new XMLParser().parse(rawBody)
  const call = parsed?.methodCall
  const rawParams = call?.params?.param
  const params = (Array.isArray(rawParams) ? rawParams : [rawParams])
    .filter(Boolean)
    .map((param) => String(xmlValue(param.value)))

  return { method: String(call?.methodName), params }
}

function failureResponse(errorDescription: string[]): string {
  const values = errorDescription
    .map((value) => `<value><string>${value}</string></value>`)
    .join('')
  return `<?xml version="1.0"?>
<methodResponse><params><param><value><struct>
<member><name>Status</name><value><string>Failure</string></value></member>
<member><name>ErrorDescription</name><value><array><data>${values}</data></array></value></member>
</struct></value></param></params></methodResponse>`
}

function successResponse(value: string): string {
  return `<?xml version="1.0"?>
<methodResponse><params><param><value><struct>
<member><name>Status</name><value><string>Success</string></value></member>
<member><name>Value</name><value><string>${value}</string></value></member>
</struct></value></param></params></methodResponse>`
}

async function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  if (!server.listening) return
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(closeServer))
})

describe('Published XML-RPC session contract', () => {
  it('falls back from the four-argument login lifecycle to the three-argument Published form', async () => {
    const requests: CapturedRequest[] = []
    const server = createServer((request, response) => {
      const chunks: Buffer[] = []
      request.on('data', (chunk: Buffer) => chunks.push(chunk))
      request.on('end', () => {
        const rawBody = Buffer.concat(chunks).toString('utf8')
        const parsed = parseRequest(rawBody)
        requests.push({ headers: request.headers, rawBody, ...parsed })

        const body = parsed.params.length === 4
          ? failureResponse([
            'MESSAGE_PARAMETER_COUNT_MISMATCH',
            'session.login_with_password',
            '3',
            '4',
          ])
          : successResponse('OpaqueRef:published-session')
        response.writeHead(200, { 'Content-Type': 'text/xml' })
        response.end(body)
      })
    })
    servers.push(server)
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Loopback server has no TCP port')

    const client = new XapiClient()
    const result = await client.connect({
      host: '127.0.0.1',
      port: address.port,
      scheme: 'http:',
      username: 'root',
      password: 'secret',
      allowSelfSigned: false,
    }).then(
      (session) => ({ session }),
      (error) => ({ error }),
    )

    expect(requests.map(({ method, params }) => ({ method, params }))).toEqual([
      {
        method: 'session.login_with_password',
        params: ['root', 'secret', '1.3', 'xenadmin-modern'],
      },
      {
        method: 'session.login_with_password',
        params: ['root', 'secret', '1.3'],
      },
    ])
    for (const request of requests) {
      expect(request.headers.host).toBe(`127.0.0.1:${address.port}`)
      const orderedWireValues = [request.method, ...request.params]
      let previousIndex = -1
      for (const value of orderedWireValues) {
        const index = request.rawBody.indexOf(value, previousIndex + 1)
        expect(index).toBeGreaterThan(previousIndex)
        previousIndex = index
      }
    }
    expect(result).toEqual({ session: 'OpaqueRef:published-session' })
    expect(client.getSessionRef()).toBe('OpaqueRef:published-session')
  })

  it('falls back through the complete four-to-three-to-two-argument Published login lifecycle', async () => {
    const requests: CapturedRequest[] = []
    const server = createServer((request, response) => {
      const chunks: Buffer[] = []
      request.on('data', (chunk: Buffer) => chunks.push(chunk))
      request.on('end', () => {
        const rawBody = Buffer.concat(chunks).toString('utf8')
        const parsed = parseRequest(rawBody)
        requests.push({ headers: request.headers, rawBody, ...parsed })

        const body = parsed.params.length > 2
          ? failureResponse([
            'MESSAGE_PARAMETER_COUNT_MISMATCH',
            'session.login_with_password',
            String(parsed.params.length - 1),
            String(parsed.params.length),
          ])
          : successResponse('OpaqueRef:legacy-published-session')
        response.writeHead(200, { 'Content-Type': 'text/xml' })
        response.end(body)
      })
    })
    servers.push(server)
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Loopback server has no TCP port')

    const client = new XapiClient()
    const result = await client.connect({
      host: '127.0.0.1',
      port: address.port,
      scheme: 'http:',
      username: 'root',
      password: 'secret',
      allowSelfSigned: false,
    }).then(
      (session) => ({ session }),
      (error) => ({ error }),
    )

    expect(requests.map(({ method, params }) => ({ method, params }))).toEqual([
      {
        method: 'session.login_with_password',
        params: ['root', 'secret', '1.3', 'xenadmin-modern'],
      },
      {
        method: 'session.login_with_password',
        params: ['root', 'secret', '1.3'],
      },
      {
        method: 'session.login_with_password',
        params: ['root', 'secret'],
      },
    ])
    for (const request of requests) {
      expect(request.headers.host).toBe(`127.0.0.1:${address.port}`)
      const orderedWireValues = [request.method, ...request.params]
      let previousIndex = -1
      for (const value of orderedWireValues) {
        const index = request.rawBody.indexOf(value, previousIndex + 1)
        expect(index).toBeGreaterThan(previousIndex)
        previousIndex = index
      }
    }
    expect(result).toEqual({ session: 'OpaqueRef:legacy-published-session' })
    expect(client.getSessionRef()).toBe('OpaqueRef:legacy-published-session')
  })

  it('rejects an unknown XAPI envelope after sending the session as the first parameter', async () => {
    const requests: CapturedRequest[] = []
    const server = createServer((request, response) => {
      const chunks: Buffer[] = []
      request.on('data', (chunk: Buffer) => chunks.push(chunk))
      request.on('end', () => {
        const rawBody = Buffer.concat(chunks).toString('utf8')
        const parsed = parseRequest(rawBody)
        requests.push({ headers: request.headers, rawBody, ...parsed })

        const body = parsed.method === 'session.login_with_password'
          ? successResponse('OpaqueRef:contract-session')
          : `<?xml version="1.0"?>
<methodResponse><params><param><value><struct>
<member><name>Status</name><value><string>Pending</string></value></member>
<member><name>Value</name><value><string>OpaqueRef:untrusted-value</string></value></member>
</struct></value></param></params></methodResponse>`
        response.writeHead(200, { 'Content-Type': 'text/xml' })
        response.end(body)
      })
    })
    servers.push(server)
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Loopback server has no TCP port')

    const client = new XapiClient()
    await client.connect({
      host: '127.0.0.1',
      port: address.port,
      scheme: 'http:',
      username: 'root',
      password: 'secret',
      allowSelfSigned: false,
    })
    const result = await client.callWithSession('pool.get_all', []).then(
      (value) => ({ value }),
      (error) => ({ error }),
    )

    expect(requests.map(({ method, params }) => ({ method, params }))).toEqual([
      {
        method: 'session.login_with_password',
        params: ['root', 'secret', '1.3', 'xenadmin-modern'],
      },
      {
        method: 'pool.get_all',
        params: ['OpaqueRef:contract-session'],
      },
    ])
    const authenticatedRequest = requests[1]
    expect(authenticatedRequest.headers.host).toBe(`127.0.0.1:${address.port}`)
    expect(authenticatedRequest.rawBody.indexOf('pool.get_all'))
      .toBeLessThan(authenticatedRequest.rawBody.indexOf('OpaqueRef:contract-session'))
    expect(result).toMatchObject({
      error: {
        code: 'XAPI_CONTRACT_MISMATCH',
        message: 'XAPI 返回了无法识别的响应格式，无法确认请求结果。',
      },
    })
  })

  it('does not retry a four-argument login rejected by authentication', async () => {
    const requests: CapturedRequest[] = []
    const server = createServer((request, response) => {
      const chunks: Buffer[] = []
      request.on('data', (chunk: Buffer) => chunks.push(chunk))
      request.on('end', () => {
        const rawBody = Buffer.concat(chunks).toString('utf8')
        const parsed = parseRequest(rawBody)
        requests.push({ headers: request.headers, rawBody, ...parsed })
        response.writeHead(200, { 'Content-Type': 'text/xml' })
        response.end(failureResponse(['SESSION_AUTHENTICATION_FAILED', 'root']))
      })
    })
    servers.push(server)
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Loopback server has no TCP port')

    const client = new XapiClient()
    const result = await client.connect({
      host: '127.0.0.1',
      port: address.port,
      scheme: 'http:',
      username: 'root',
      password: 'wrong',
      allowSelfSigned: false,
    }).then(
      (session) => ({ session }),
      (error) => ({ error }),
    )

    expect(requests.map(({ method, params }) => ({ method, params }))).toEqual([{
      method: 'session.login_with_password',
      params: ['root', 'wrong', '1.3', 'xenadmin-modern'],
    }])
    expect(result).toMatchObject({
      error: {
        code: 'SESSION_AUTHENTICATION_FAILED',
        message: '用户名或密码不正确，XAPI 拒绝创建登录会话。',
      },
    })
    expect(client.getSessionRef()).toBeNull()
  })

  it('stops after a three-argument login is rejected by permission', async () => {
    const requests: CapturedRequest[] = []
    const server = createServer((request, response) => {
      const chunks: Buffer[] = []
      request.on('data', (chunk: Buffer) => chunks.push(chunk))
      request.on('end', () => {
        const rawBody = Buffer.concat(chunks).toString('utf8')
        const parsed = parseRequest(rawBody)
        requests.push({ headers: request.headers, rawBody, ...parsed })
        const body = parsed.params.length === 4
          ? failureResponse([
            'MESSAGE_PARAMETER_COUNT_MISMATCH',
            'session.login_with_password',
            '3',
            '4',
          ])
          : failureResponse(['PERMISSION_DENIED', 'session.login_with_password'])
        response.writeHead(200, { 'Content-Type': 'text/xml' })
        response.end(body)
      })
    })
    servers.push(server)
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Loopback server has no TCP port')

    const client = new XapiClient()
    const result = await client.connect({
      host: '127.0.0.1',
      port: address.port,
      scheme: 'http:',
      username: 'root',
      password: 'secret',
      allowSelfSigned: false,
    }).then(
      (session) => ({ session }),
      (error) => ({ error }),
    )

    expect(requests.map(({ method, params }) => ({ method, params }))).toEqual([
      {
        method: 'session.login_with_password',
        params: ['root', 'secret', '1.3', 'xenadmin-modern'],
      },
      {
        method: 'session.login_with_password',
        params: ['root', 'secret', '1.3'],
      },
    ])
    expect(result).toMatchObject({
      error: {
        code: 'PERMISSION_DENIED',
        message: '当前账号没有执行此操作所需的 XAPI 权限。',
      },
    })
    expect(client.getSessionRef()).toBeNull()
  })

  it('opens the pool coordinator and starts a fresh four-argument login after HOST_IS_SLAVE', async () => {
    const memberRequests: CapturedRequest[] = []
    const coordinatorRequests: CapturedRequest[] = []
    const coordinator = createServer((request, response) => {
      const chunks: Buffer[] = []
      request.on('data', (chunk: Buffer) => chunks.push(chunk))
      request.on('end', () => {
        const rawBody = Buffer.concat(chunks).toString('utf8')
        const parsed = parseRequest(rawBody)
        coordinatorRequests.push({ headers: request.headers, rawBody, ...parsed })
        response.writeHead(200, { 'Content-Type': 'text/xml' })
        response.end(successResponse('OpaqueRef:coordinator-session'))
      })
    })
    servers.push(coordinator)
    await new Promise<void>((resolve, reject) => {
      coordinator.once('error', reject)
      coordinator.listen(0, '::1', resolve)
    })
    const coordinatorAddress = coordinator.address()
    if (!coordinatorAddress || typeof coordinatorAddress === 'string') {
      throw new Error('Coordinator server has no TCP port')
    }

    const member = createServer((request, response) => {
      const chunks: Buffer[] = []
      request.on('data', (chunk: Buffer) => chunks.push(chunk))
      request.on('end', () => {
        const rawBody = Buffer.concat(chunks).toString('utf8')
        const parsed = parseRequest(rawBody)
        memberRequests.push({ headers: request.headers, rawBody, ...parsed })
        response.writeHead(200, { 'Content-Type': 'text/xml' })
        response.end(failureResponse(['HOST_IS_SLAVE', '::1']))
      })
    })
    servers.push(member)
    await new Promise<void>((resolve, reject) => {
      member.once('error', reject)
      member.listen(coordinatorAddress.port, '127.0.0.1', resolve)
    })

    const client = new XapiClient()
    await expect(client.connect({
      host: '127.0.0.1',
      port: coordinatorAddress.port,
      scheme: 'http:',
      username: 'root',
      password: 'secret',
      allowSelfSigned: false,
    })).resolves.toBe('OpaqueRef:coordinator-session')

    const expectedLogin = {
      method: 'session.login_with_password',
      params: ['root', 'secret', '1.3', 'xenadmin-modern'],
    }
    expect(memberRequests.map(({ method, params }) => ({ method, params }))).toEqual([
      expectedLogin,
    ])
    expect(coordinatorRequests.map(({ method, params }) => ({ method, params }))).toEqual([
      expectedLogin,
    ])
    expect(memberRequests[0].headers.host).toBe(`127.0.0.1:${coordinatorAddress.port}`)
    expect(coordinatorRequests[0].headers.host).toBe(`[::1]:${coordinatorAddress.port}`)
    expect(client.getConnectedHost()).toBe('::1')
    expect(client.getSessionRef()).toBe('OpaqueRef:coordinator-session')
  })

  it('preserves Published session and object-query wire order with pool record fields', async () => {
    const requests: CapturedRequest[] = []
    const server = createServer((request, response) => {
      const chunks: Buffer[] = []
      request.on('data', (chunk: Buffer) => chunks.push(chunk))
      request.on('end', () => {
        const rawBody = Buffer.concat(chunks).toString('utf8')
        const parsed = parseRequest(rawBody)
        requests.push({ headers: request.headers, rawBody, ...parsed })

        let body: string
        switch (parsed.method) {
          case 'session.login_with_password':
            body = successResponse('OpaqueRef:wire-session')
            break
          case 'session.get_this_host':
            body = successResponse('OpaqueRef:this-host')
            break
          case 'pool.get_all':
            body = `<?xml version="1.0"?>
<methodResponse><params><param><value><struct>
<member><name>Status</name><value><string>Success</string></value></member>
<member><name>Value</name><value><array><data>
<value><string>OpaqueRef:pool-a</string></value>
<value><string>OpaqueRef:pool-b</string></value>
</data></array></value></member>
</struct></value></param></params></methodResponse>`
            break
          case 'pool.get_record':
            body = `<?xml version="1.0"?>
<methodResponse><params><param><value><struct>
<member><name>Status</name><value><string>Success</string></value></member>
<member><name>Value</name><value><struct>
<member><name>name_label</name><value><string>Audited Pool</string></value></member>
<member><name>master</name><value><string>OpaqueRef:master-host</string></value></member>
</struct></value></member>
</struct></value></param></params></methodResponse>`
            break
          case 'host.get_uuid':
            body = successResponse('f45a4748-47b5-4f6e-bd36-92dbf34ef33d')
            break
          case 'session.logout':
            body = successResponse('')
            break
          default:
            body = failureResponse(['MESSAGE_METHOD_UNKNOWN', parsed.method])
        }
        response.writeHead(200, { 'Content-Type': 'text/xml' })
        response.end(body)
      })
    })
    servers.push(server)
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Loopback server has no TCP port')

    const client = new XapiClient()
    await client.connect({
      host: '127.0.0.1',
      port: address.port,
      scheme: 'http:',
      username: 'root',
      password: 'secret',
      allowSelfSigned: false,
    })
    const thisHost = await client.callWithSession('session.get_this_host', [
      'OpaqueRef:target-session',
    ])
    const pools = await client.callWithSession('pool.get_all', [])
    const poolRecord = await client.callWithSession('pool.get_record', ['OpaqueRef:pool'])
    const hostUuid = await client.callWithSession('host.get_uuid', ['OpaqueRef:host'])
    await client.disconnect()

    expect(requests.map(({ method, params }) => ({ method, params }))).toEqual([
      {
        method: 'session.login_with_password',
        params: ['root', 'secret', '1.3', 'xenadmin-modern'],
      },
      {
        method: 'session.get_this_host',
        params: ['OpaqueRef:wire-session', 'OpaqueRef:target-session'],
      },
      {
        method: 'pool.get_all',
        params: ['OpaqueRef:wire-session'],
      },
      {
        method: 'pool.get_record',
        params: ['OpaqueRef:wire-session', 'OpaqueRef:pool'],
      },
      {
        method: 'host.get_uuid',
        params: ['OpaqueRef:wire-session', 'OpaqueRef:host'],
      },
      {
        method: 'session.logout',
        params: ['OpaqueRef:wire-session'],
      },
    ])
    for (const request of requests) {
      const orderedWireValues = [request.method, ...request.params]
      let previousIndex = -1
      for (const value of orderedWireValues) {
        const index = request.rawBody.indexOf(value, previousIndex + 1)
        expect(index).toBeGreaterThan(previousIndex)
        previousIndex = index
      }
    }
    expect(thisHost).toBe('OpaqueRef:this-host')
    expect(pools).toEqual(['OpaqueRef:pool-a', 'OpaqueRef:pool-b'])
    expect(poolRecord).toEqual({
      name_label: 'Audited Pool',
      master: 'OpaqueRef:master-host',
    })
    expect(hostUuid).toBe('f45a4748-47b5-4f6e-bd36-92dbf34ef33d')
    expect(client.getSessionRef()).toBeNull()
  })

  it('does not redirect or replay an authenticated call rejected with HOST_IS_SLAVE', async () => {
    const requests: CapturedRequest[] = []
    const server = createServer((request, response) => {
      const chunks: Buffer[] = []
      request.on('data', (chunk: Buffer) => chunks.push(chunk))
      request.on('end', () => {
        const rawBody = Buffer.concat(chunks).toString('utf8')
        const parsed = parseRequest(rawBody)
        requests.push({ headers: request.headers, rawBody, ...parsed })
        const body = parsed.method === 'session.login_with_password'
          ? successResponse('OpaqueRef:stable-session')
          : failureResponse(['HOST_IS_SLAVE', '127.0.0.2'])
        response.writeHead(200, { 'Content-Type': 'text/xml' })
        response.end(body)
      })
    })
    servers.push(server)
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Loopback server has no TCP port')

    const client = new XapiClient()
    await client.connect({
      host: '127.0.0.1',
      port: address.port,
      scheme: 'http:',
      username: 'root',
      password: 'secret',
      allowSelfSigned: false,
    })
    const result = await client.callWithSession('pool.get_all', []).then(
      (value) => ({ value }),
      (error) => ({ error }),
    )

    expect(requests.map(({ method, params }) => ({ method, params }))).toEqual([
      {
        method: 'session.login_with_password',
        params: ['root', 'secret', '1.3', 'xenadmin-modern'],
      },
      {
        method: 'pool.get_all',
        params: ['OpaqueRef:stable-session'],
      },
    ])
    expect(result).toMatchObject({
      error: {
        code: 'HOST_IS_SLAVE',
        params: ['127.0.0.2'],
      },
    })
    expect(client.getConnectedHost()).toBe('127.0.0.1')
    expect(client.getSessionRef()).toBe('OpaqueRef:stable-session')
  })
})
