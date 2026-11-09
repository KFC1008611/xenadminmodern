/**
 * Connection & legacy session IPC handlers.
 */
import { handleContract } from './utils'
import {
  connectionConnectContract,
  connectionDisconnectContract,
  connectionGetInfoContract,
  connectionListContract,
  connectionReconnectContract,
  sessionConnectContract,
  sessionDisconnectContract,
  sessionStatusContract,
} from '../../../shared/ipc-contracts/connection'
import { connectionManager } from '../../xapi/connection-manager'
import { createLogger } from '../../logger'
import { listProfiles, saveProfile } from '../../profiles/profile.service'

const log = createLogger('IpcConnection')

export function registerConnectionHandlers(): void {
  // Connection management (v4)
  handleContract(connectionConnectContract, async (opts) => {
    log.info(`connection:connect host=${opts?.host}`)
    const id = await connectionManager.connect(opts)
    return { id }
  })

  handleContract(connectionDisconnectContract, async (connectionId) => {
    connectionManager.disconnect(connectionId)
  })

  handleContract(connectionListContract, async () => {
    return connectionManager.listConnections()
  })

  handleContract(connectionReconnectContract, async (connectionId, password?: string) => {
    if (password === undefined) await connectionManager.reconnect(connectionId)
    else await connectionManager.reconnect(connectionId, password)
    if (password !== undefined) {
      try {
        const profile = (await listProfiles()).find((entry) => entry.id === connectionId)
        if (profile) await saveProfile({ ...profile, lastConnected: new Date().toISOString() }, password)
      } catch { log.warn('连接成功，但保存服务器密码失败') }
    }
  })

  handleContract(connectionGetInfoContract, async (connectionId) => {
    const info = connectionManager.getConnectionInfo(connectionId)
    if (!info) {
      throw new Error(`Connection not found: ${connectionId}`)
    }
    return info
  })

  // Legacy session handlers — kept for backwards compatibility during migration.
  handleContract(sessionConnectContract, async (opts) => {
    log.info(`session:connect (legacy) host=${opts?.host}`)
    const id = await connectionManager.connect(opts, 'default')
    return { id, connected: true as const }
  })

  handleContract(sessionDisconnectContract, async () => {
    connectionManager.disconnect('default')
  })

  handleContract(sessionStatusContract, () => {
    const info = connectionManager.getConnectionInfo('default')
    return { connected: info?.state === 'connected' }
  })
}
