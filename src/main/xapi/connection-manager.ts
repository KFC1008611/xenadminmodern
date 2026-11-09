/**
 * ConnectionManager — manages multiple simultaneous XAPI connections.
 * Each connection is identified by a UUID and has its own XapiClient instance.
 */
import { randomUUID } from 'crypto'
import { XapiClient } from './client'
import { normalizeUnknownError } from './errors'
import type { XapiConnectionOptions, ConnectionInfo } from '../../shared/types/xapi'
import { createLogger } from '../logger'
import {
  startVmEventWatcher,
  stopVmEventWatcher,
} from './services/vm-event.service'

const log = createLogger('ConnectionManager')

// Re-export shared types for backward compatibility
export type { XapiConnectionOptions, ConnectionInfo }

function normalizeConnectionHost(host: string): string {
  return host.trim().toLowerCase().replace(/\.+$/, '')
}

interface HostIdentity {
  hostRef: string
  hostUuid: string
}

export interface XapiConnection {
  client: XapiClient
  info: ConnectionInfo
  opts: XapiConnectionOptions
  hostIdentity: HostIdentity | null
}

export class ConnectionManager {
  private connections = new Map<string, XapiConnection>()
  private epoch = 0
  private reconnecting = new Map<string, Promise<void>>()
  private readyHandler: ((id: string) => void) | null = null

  onConnectionReady(handler: (id: string) => void): void { this.readyHandler = handler }
  private recoveryTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private healthChecks = new Map<string, XapiClient>()

  private observeClient(id: string, client: XapiClient): void {
    client.on?.('connection-fault', (error: Error) => {
      this.markUnavailable(id, client, error)
    })
    client.on?.('request-fault', (error: Error) => {
      void this.checkAfterRequestFailure(id, client, error)
    })
  }

  private markUnavailable(id: string, client: XapiClient, error: Error): void {
    const conn = this.connections.get(id)
    if (!conn || conn.client !== client || conn.info.state !== 'connected') return
    conn.info.state = 'error'
    conn.info.errorMessage = error.message
    conn.info.epoch = ++this.epoch
    stopVmEventWatcher(id)
    this.scheduleRecovery(id)
  }

  private async checkAfterRequestFailure(id: string, client: XapiClient, error: Error): Promise<void> {
    const conn = this.connections.get(id)
    if (!conn || conn.client !== client || conn.info.state !== 'connected' || this.healthChecks.get(id) === client) return
    this.healthChecks.set(id, client)
    const details = normalizeUnknownError(error).details
    const diagnostic = { method: details.method ?? 'unknown', code: details.code, durationMs: details.durationMs ?? 0, occurredAt: Date.now(), sessionAvailable: null as boolean | null }
    conn.info.lastRequestFailure = diagnostic
    log.warn('Request failed; checking existing session', { connectionId: id, ...details })
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        client.checkSession(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(Object.assign(new Error('管理连接健康检查超时'), { code: 'ETIMEDOUT' })), 5000)
          timer.unref?.()
        }),
      ])
      diagnostic.sessionAvailable = true
    } catch (failure) {
      const normalized = normalizeUnknownError(failure)
      // A denied probe is not proof of a lost session, either.
      if (!['RBAC_PERMISSION_DENIED', 'PERMISSION_DENIED'].includes(normalized.code)) {
        diagnostic.sessionAvailable = false
        this.markUnavailable(id, client, normalized)
      }
    } finally {
      if (timer) clearTimeout(timer)
      if (this.healthChecks.get(id) === client) this.healthChecks.delete(id)
    }
  }

  private scheduleRecovery(id: string, attempt = 0): void {
    if (this.recoveryTimers.has(id) || attempt >= 3 || this.connections.get(id)?.info.state !== 'error') return
    const timer = setTimeout(async () => {
      this.recoveryTimers.delete(id)
      if (!this.connections.has(id)) return
      try { await this.reconnect(id) }
      catch (error) {
        if (normalizeUnknownError(error).code !== 'SESSION_AUTHENTICATION_FAILED') this.scheduleRecovery(id, attempt + 1)
      }
    }, 1000 * 2 ** attempt)
    timer.unref?.()
    this.recoveryTimers.set(id, timer)
  }


  private findConnectionByEndpoint(host: string, excludeId?: string): [string, XapiConnection] | undefined {
    const normalizedHost = normalizeConnectionHost(host)
    for (const [id, conn] of this.connections.entries()) {
      if (id === excludeId) continue
      if (normalizeConnectionHost(conn.info.host) === normalizedHost) {
        return [id, conn]
      }
    }
    return undefined
  }

  private findConnectionByHostUuid(hostUuid: string, excludeId?: string): [string, XapiConnection] | undefined {
    for (const [id, conn] of this.connections.entries()) {
      if (id === excludeId) continue
      if (conn.hostIdentity?.hostUuid === hostUuid) {
        return [id, conn]
      }
    }
    return undefined
  }

  private rejectOrReplaceDuplicate(
    duplicate: [string, XapiConnection] | undefined,
    connectedLabel: string,
  ): void {
    if (!duplicate) return

    const [duplicateId, duplicateConn] = duplicate
    if (duplicateConn.info.state === 'connected' || duplicateConn.info.state === 'connecting') {
      const label = duplicateConn.info.name || duplicateConn.info.host || connectedLabel
      throw new Error(`服务器 ${label} 已连接，请勿重复连接同一主机。`)
    }

    this.disconnect(duplicateId, true)
  }

  private ensureEndpointCanConnect(host: string, currentId: string): void {
    this.rejectOrReplaceDuplicate(
      this.findConnectionByEndpoint(host, currentId),
      host,
    )
  }

  private ensureHostIdentityCanConnect(identity: HostIdentity, currentId: string): void {
    this.rejectOrReplaceDuplicate(
      this.findConnectionByHostUuid(identity.hostUuid, currentId),
      identity.hostUuid,
    )
  }

  private async fetchHostIdentity(client: XapiClient): Promise<HostIdentity> {
    const sessionRef = client.getSessionRef()
    if (!sessionRef) {
      throw new Error('No active session')
    }

    const hostRef = await client.callWithSession('session.get_this_host', [sessionRef])
    if (typeof hostRef !== 'string' || !hostRef) {
      throw new Error('session.get_this_host returned an invalid host ref')
    }

    const hostUuid = await client.callWithSession('host.get_uuid', [hostRef])
    if (typeof hostUuid !== 'string' || !hostUuid) {
      throw new Error('host.get_uuid returned an invalid UUID')
    }

    return { hostRef, hostUuid }
  }

  private async closeRejectedConnection(id: string, client: XapiClient): Promise<void> {
    if (this.connections.get(id)?.client === client) this.connections.delete(id)
    try {
      await client.disconnect()
    } catch {
      // Ignore logout errors while rejecting a duplicate effective host.
    }
  }

  /**
   * Create a new connection with the given options.
   * Generates a UUID if id is not provided (callers may pass a stable id for reconnect).
   */
  async connect(opts: XapiConnectionOptions & { name?: string }, id?: string): Promise<string> {
    opts = { ...opts, host: opts.host.trim() }
    const connectionId = id ?? randomUUID()

    log.info(`connect() id=${connectionId} host=${opts.host}`)

    this.ensureEndpointCanConnect(opts.host, connectionId)

    // If an existing connection with this id exists, disconnect it first
    if (this.connections.has(connectionId)) {
      this.disconnect(connectionId, true)
    }

    const info: ConnectionInfo = {
      id: connectionId,
      name: opts.name ?? opts.host,
      host: opts.host,
      poolName: null,
      poolRef: null,
      state: 'connecting',
      errorMessage: null,
      connectedAt: null,
      epoch: ++this.epoch,
    }

    const client = new XapiClient()
    const epoch = info.epoch
    this.observeClient(connectionId, client)
    this.connections.set(connectionId, { client, info, opts, hostIdentity: null })

    try {
      await client.connect(opts)
      if (this.connections.get(connectionId)?.client !== client || info.epoch !== epoch) throw new Error('连接已取消或被替换')
      const connectedHost = client.getConnectedHost()
      if (connectedHost && connectedHost !== info.host) {
        try {
          this.ensureEndpointCanConnect(connectedHost, connectionId)
        } catch (duplicateErr) {
          await this.closeRejectedConnection(connectionId, client)
          throw duplicateErr
        }
        info.host = connectedHost
        if (!opts.name) {
          info.name = connectedHost
        }
        opts = { ...opts, host: connectedHost }
        const conn = this.connections.get(connectionId)
        if (conn) {
          conn.opts = opts
        }
      }

      // Try to fetch pool name for display purposes
      try {
        const poolRefs: string[] = await client.callWithSession('pool.get_all', [])
        if (poolRefs.length > 0) {
          const poolRecord = await client.callWithSession('pool.get_record', [poolRefs[0]])
          info.poolName = poolRecord.name_label || opts.host
          info.poolRef = poolRefs[0]
          if (typeof poolRecord.uuid === 'string') info.poolUuid = poolRecord.uuid
        }
      } catch (poolErr: any) {
        log.warn(`Could not fetch pool name for ${connectionId}: ${poolErr?.message}`)
      }

      const identity = await this.fetchHostIdentity(client)
      const conn = this.connections.get(connectionId)
      if (conn?.client === client) {
        conn.hostIdentity = identity
      }
      try {
        this.ensureHostIdentityCanConnect(identity, connectionId)
      } catch (duplicateErr) {
        await this.closeRejectedConnection(connectionId, client)
        throw duplicateErr
      }

      if (this.connections.get(connectionId)?.client !== client || info.epoch !== epoch) throw new Error('连接已取消或被替换')
      info.state = 'connected'
      info.connectedAt = Date.now()
      log.info(`connected id=${connectionId} poolName=${info.poolName}`)
      startVmEventWatcher(connectionId, client)
      this.readyHandler?.(connectionId)
    } catch (err: any) {
      const normalized = normalizeUnknownError(err)
      if (info.epoch === epoch) {
        info.state = 'error'
        info.errorMessage = normalized.message
      }
      if (this.connections.get(connectionId)?.client === client) stopVmEventWatcher(connectionId)
      try {
        await client.disconnect()
      } catch {
        // Ignore logout errors after a failed connection setup.
      }
      log.error(`connect failed id=${connectionId}: ${normalized.message}`)
      throw normalized
    }

    return connectionId
  }

  /**
   * Keep manually disconnected sessions available for reconnect until app exit.
   */
  disconnect(id: string, remove = false): void {
    const recovery = this.recoveryTimers.get(id)
    if (recovery) clearTimeout(recovery)
    this.recoveryTimers.delete(id)
    const conn = this.connections.get(id)
    if (!conn) {
      log.warn(`disconnect() called for unknown id=${id}`)
      return
    }

    log.info(`disconnect() id=${id}`)
    conn.info.state = 'disconnected'
    conn.info.epoch = ++this.epoch
    conn.info.errorMessage = null
    stopVmEventWatcher(id)

    // Fire-and-forget XAPI logout; don't wait for it
    try {
      Promise.resolve(conn.client.disconnect()).catch((err: any) => {
        log.warn(`logout error for id=${id}: ${err?.message}`)
      })
    } catch {
      // Ignore synchronous errors from disconnect
    }

    if (remove) this.connections.delete(id)
  }

  /**
   * Get the XapiClient for the given connectionId.
   * Returns undefined if the connection does not exist.
   */
  getClient(id: string): XapiClient | undefined {
    const conn = this.connections.get(id)
    return conn?.info.state === 'connected' ? conn.client : undefined
  }

  /**
   * Get a copy of the ConnectionInfo for the given connectionId.
   * Returns undefined if the connection does not exist.
   */
  getConnectionInfo(id: string): ConnectionInfo | undefined {
    const conn = this.connections.get(id)
    return conn ? { ...conn.info, ...(conn.info.lastRequestFailure ? { lastRequestFailure: { ...conn.info.lastRequestFailure } } : {}) } : undefined
  }

  /**
   * Get a copy of the connection options for the given connectionId.
   * Used by services that need transport-level settings (for example TLS policy).
   */
  getConnectionOptions(id: string): XapiConnectionOptions | undefined {
    const conn = this.connections.get(id)
    return conn ? { ...conn.opts } : undefined
  }

  /**
   * List all active connections.
   */
  listConnections(): ConnectionInfo[] {
    return Array.from(this.connections.keys()).map((id) => this.getConnectionInfo(id)!)
  }

  /**
   * Reconnect by disconnecting and connecting again with the stored options.
   */
  async reconnect(id: string, password?: string): Promise<void> {
    const pending = this.reconnecting.get(id)
    if (pending) {
      if (password === undefined) return pending
      const epoch = this.connections.get(id)?.info.epoch
      await pending.catch(() => undefined)
      if (this.connections.get(id)?.info.epoch !== epoch) throw new Error('连接已取消或被替换')
    }
    const timer = this.recoveryTimers.get(id)
    if (timer) clearTimeout(timer)
    this.recoveryTimers.delete(id)
    const operation = this.reconnectOnce(id, password)
    this.reconnecting.set(id, operation)
    try { await operation } finally { this.reconnecting.delete(id) }
  }

  private async reconnectOnce(id: string, password?: string): Promise<void> {
    const conn = this.connections.get(id)
    if (!conn) {
      throw new Error(`Connection not found: ${id}`)
    }

    log.info(`reconnect() id=${id}`)
    const opts = password === undefined ? conn.opts : { ...conn.opts, password }
    stopVmEventWatcher(id)

    // Disconnect existing without removing from map to preserve id
    conn.info.state = 'connecting'
    conn.info.epoch = ++this.epoch
    const epoch = conn.info.epoch
    conn.info.errorMessage = null
    conn.info.poolUuid = undefined
    conn.info.poolRef = null
    conn.info.poolName = null
    try {
      await conn.client.disconnect()
    } catch {
      // Ignore errors on disconnect during reconnect
    }

    if (this.connections.get(id) !== conn || conn.info.epoch !== epoch) throw new Error('连接已取消或被替换')

    // Re-create client (old one may be in bad state)
    const newClient = new XapiClient()
    this.observeClient(id, newClient)
    conn.client = newClient

    try {
      await newClient.connect(opts)
      if (this.connections.get(id) !== conn || conn.info.epoch !== epoch) throw new Error('连接已取消或被替换')
      conn.opts = opts
      const connectedHost = newClient.getConnectedHost()
      if (connectedHost && connectedHost !== conn.info.host) {
        this.ensureEndpointCanConnect(connectedHost, id)
        conn.info.host = connectedHost
        if (!opts.name) {
          conn.info.name = connectedHost
        }
        conn.opts = { ...opts, host: connectedHost }
      }

      try {
        const poolRefs: string[] = await newClient.callWithSession('pool.get_all', [])
        if (poolRefs.length > 0) {
          const poolRecord = await newClient.callWithSession('pool.get_record', [poolRefs[0]])
          conn.info.poolName = poolRecord.name_label || opts.host
          conn.info.poolRef = poolRefs[0]
          if (typeof poolRecord.uuid === 'string') conn.info.poolUuid = poolRecord.uuid
        }
      } catch {
        // Pool name refresh is best-effort
      }

      const identity = await this.fetchHostIdentity(newClient)
      conn.hostIdentity = identity
      this.ensureHostIdentityCanConnect(identity, id)

      if (this.connections.get(id) !== conn || conn.info.epoch !== epoch) throw new Error('连接已取消或被替换')
      conn.info.state = 'connected'
      conn.info.connectedAt = Date.now()
      log.info(`reconnected id=${id}`)
      startVmEventWatcher(id, newClient)
      this.readyHandler?.(id)
    } catch (err: any) {
      const normalized = normalizeUnknownError(err)
      if (conn.info.epoch === epoch) {
        conn.info.state = 'error'
        conn.info.errorMessage = normalized.message
      }
      if (this.connections.get(id) === conn) stopVmEventWatcher(id)
      try { await newClient.disconnect() } catch { /* Session cleanup is best effort. */ }
      log.error(`reconnect failed id=${id}: ${normalized.message}`)
      throw normalized
    }
  }

  /**
   * Disconnect all active connections. Called on app quit.
   */
  disconnectAll(): void {
    const ids = Array.from(this.connections.keys())
    for (const id of ids) {
      this.disconnect(id, true)
    }
  }
}

export const connectionManager = new ConnectionManager()
