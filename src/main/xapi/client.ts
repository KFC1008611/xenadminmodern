/**
 * XapiClient — core XML-RPC wrapper for XCP-ng XAPI.
 * Manages connection lifecycle and session authentication.
 */
import * as xmlrpc from 'xmlrpc'
import { EventEmitter } from 'events'
import { Agent as HttpAgent } from 'node:http'
import { Agent as HttpsAgent } from 'node:https'
import type { XapiConnectionOptions, XapiTransportScheme } from '../../shared/types/xapi'
import {
  createXapiContractMismatchError,
  createXapiFailureError,
  describeTransportError,
  isXapiFailureEnvelope,
  isXapiSuccessEnvelope,
  normalizeUnknownError,
} from './errors'

// Re-export shared type for backward compatibility
export type { XapiConnectionOptions, XapiTransportScheme }

export interface XapiError {
  code: string
  params: string[]
}

export type AuthenticatedHttpContext = {
  scheme: 'http:'
  host: string
  port: number
  tls: null
  sessionId: string
} | {
  scheme: 'https:'
  host: string
  port: number
  tls: { rejectUnauthorized: boolean }
  sessionId: string
}

function requestTimeout(method: string): number {
  // Synchronous operations (copy, provision, storage scans, etc.) return only
  // after the server finishes. Silence on that socket is not a failed job.
  // Keep bounded waits for reads, session checks, long polls and task requests.
  const bounded = /^(?:Async\.|session\.|task\.)/.test(method)
    || /^[^.]+\.get_/.test(method)
    || method === 'event.from'
  return bounded ? 45_000 : 0
}

export class XapiClient extends EventEmitter {
  private client: xmlrpc.Client | null = null
  private sessionRef: string | null = null
  private host: string | null = null
  private port: number | null = null
  private scheme: XapiTransportScheme | null = null
  private rejectUnauthorized: boolean | null = null
  private agent: HttpAgent | HttpsAgent | null = null

  async connect(opts: XapiConnectionOptions): Promise<string> {
    this.createRpcClient(opts)

    try {
      return await this.login(opts)
    } catch (err: any) {
      const normalized = normalizeUnknownError(err)
      const retryHost = normalized.details.retryHost

      if (retryHost && retryHost !== opts.host) {
        const retryOpts = { ...opts, host: retryHost }
        this.createRpcClient(retryOpts)
        return this.login(retryOpts)
      }

      throw normalized
    }
  }

  private createRpcClient(opts: XapiConnectionOptions): void {
    const clientOptions: {
      host: string
      port: number
      path: string
      timeout: number
      rejectUnauthorized?: boolean
      agent: HttpAgent | HttpsAgent
    } = {
      host: opts.host,
      port: opts.port,
      path: '/',
      // The per-call timeout (45 seconds or disabled for synchronous operations)
      // must differ from the agent's idle timeout so Node resets reused sockets
      // even after a server Keep-Alive hint shortened their idle timeout.
      timeout: 45_000,
      // Own sockets per connection; an event retry or another pool must never
      // tear down this session through the process-wide agent.
      agent: opts.scheme === 'http:'
        ? new HttpAgent({ keepAlive: true, timeout: 30_000 })
        : new HttpsAgent({ keepAlive: true, timeout: 30_000 }),
    }
    this.agent?.destroy()
    this.agent = clientOptions.agent
    const agent = this.agent
    const createConnection = agent.createConnection.bind(agent)
    agent.createConnection = (...args: Parameters<typeof createConnection>) => {
      const socket = Reflect.apply(createConnection, agent, args) as ReturnType<typeof createConnection>
      socket?.on('timeout', () => socket.destroy(Object.assign(new Error('XAPI socket timed out'), { code: 'ETIMEDOUT' })))
      return socket
    }

    if (opts.scheme === 'http:') {
      this.client = xmlrpc.createClient(clientOptions)
      this.scheme = 'http:'
      this.rejectUnauthorized = null
    } else {
      // Use HTTPS with per-agent rejectUnauthorized — NEVER modify
      // process.env.NODE_TLS_REJECT_UNAUTHORIZED as that affects ALL
      // TLS connections in the process (a security risk).
      clientOptions.rejectUnauthorized = !opts.allowSelfSigned
      this.client = xmlrpc.createSecureClient(clientOptions)
      this.scheme = 'https:'
      this.rejectUnauthorized = clientOptions.rejectUnauthorized
    }
    this.host = opts.host
    this.port = opts.port
  }

  private async login(opts: XapiConnectionOptions): Promise<string> {
    const loginParams = [
      opts.username,
      opts.password,
      '1.3',
      'xenadmin-modern'
    ]
    let sessionRef: string

    try {
      sessionRef = await this.call('session.login_with_password', loginParams)
    } catch (err) {
      const normalized = normalizeUnknownError(err)
      if (
        normalized.details.kind !== 'xapi'
        || normalized.code !== 'MESSAGE_PARAMETER_COUNT_MISMATCH'
      ) throw normalized

      try {
        sessionRef = await this.call('session.login_with_password', loginParams.slice(0, 3))
      } catch (fallbackErr) {
        const fallbackNormalized = normalizeUnknownError(fallbackErr)
        if (
          fallbackNormalized.details.kind !== 'xapi'
          || fallbackNormalized.code !== 'MESSAGE_PARAMETER_COUNT_MISMATCH'
        ) throw fallbackNormalized

        sessionRef = await this.call('session.login_with_password', loginParams.slice(0, 2))
      }
    }

    this.sessionRef = sessionRef
    return sessionRef
  }

  async disconnect(): Promise<void> {
    const agent = this.agent
    const logout = this.sessionRef && this.client ? this.call('session.logout', [this.sessionRef]).catch(() => undefined) : Promise.resolve()
    this.sessionRef = null
    this.client = null
    this.agent = null
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([logout, new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 1000)
        timer.unref?.()
      })])
    } finally {
      if (timer) clearTimeout(timer)
      agent?.destroy()
    }
  }

  /**
   * Make a raw XML-RPC call. Handles the XAPI {Status, Value} envelope.
   */
  async call(method: string, params: unknown[]): Promise<any> {
    const startedAt = Date.now()
    return new Promise((resolve, reject) => {
      if (!this.client) {
        reject(new Error('Not connected'))
        return
      }

      // xmlrpc reads this.options when starting a call. A per-call view keeps
      // concurrent reads and synchronous operations from sharing timeout/header
      // mutations, while retaining this connection's transport and agent.
      const requestClient: xmlrpc.Client = Object.create(this.client)
      const options = {
        ...this.client.options,
        headers: { ...this.client.options?.headers },
        timeout: requestTimeout(method),
      }
      requestClient.options = options
      requestClient.methodCall(method, params, (error, value) => {
        if (error) {
          const failure = describeTransportError(error)
          failure.details.method = method
          failure.details.durationMs = Date.now() - startedAt
          reject(failure)
          return
        }

        if (isXapiFailureEnvelope(value)) {
          reject(createXapiFailureError(value.ErrorDescription))
          return
        }

        if (isXapiSuccessEnvelope(value)) {
          resolve(value.Value)
          return
        }

        reject(createXapiContractMismatchError())
      })
    })
  }

  /**
   * Make an authenticated call, prepending the session ref as the first parameter.
   */
  async callWithSession(method: string, params: unknown[]): Promise<any> {
    if (!this.sessionRef) throw new Error('No active session')
    try {
      return await this.call(method, [this.sessionRef, ...params])
    } catch (error) {
      const normalized = normalizeUnknownError(error)
      if (['SESSION_INVALID', 'SESSION_NOT_REGISTERED', 'HOST_IS_SLAVE', 'HOST_IS_SLAVE_EMERGENCY_MODE'].includes(normalized.code)) {
        this.emit('connection-fault', normalized)
      } else if (normalized.details.kind === 'transport') {
        // A reset of a long poll/HTTP socket does not establish session loss.
        // The manager independently probes the existing session before recovery.
        this.emit('request-fault', normalized)
      }
      // Re-establishing a session must never replay this request: a mutation may have taken effect.
      throw normalized
    }
  }

  getSessionRef(): string | null {
    return this.sessionRef
  }

  async checkSession(): Promise<void> {
    const session = this.sessionRef
    if (!session) throw new Error('No active session')
    await this.call('session.get_this_host', [session, session])
  }

  isConnected(): boolean {
    return this.sessionRef !== null
  }

  getConnectedHost(): string | null {
    return this.host
  }

  getConnectedPort(): number | null {
    return this.port
  }

  getAuthenticatedHttpContext(): AuthenticatedHttpContext | null {
    if (!this.sessionRef || !this.host || this.port === null || !this.scheme) return null
    if (this.scheme === 'http:') {
      return {
        scheme: this.scheme,
        host: this.host,
        port: this.port,
        tls: null,
        sessionId: this.sessionRef,
      }
    }
    return {
      scheme: this.scheme,
      host: this.host,
      port: this.port,
      tls: { rejectUnauthorized: this.rejectUnauthorized ?? true },
      sessionId: this.sessionRef,
    }
  }
}

// Singleton removed in v4. Instances are now managed by ConnectionManager.
// See src/main/xapi/connection-manager.ts
