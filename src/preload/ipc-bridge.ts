import type { IpcBridgeApi, IpcBridgeResult } from '../shared/ipc-bridge'
import { bindIpcContractAlias, getIpcContractBinding } from './ipc-contract-client'

export function createIpcBridgeApi<T extends object>(api: T): IpcBridgeApi<T> {
  function visit(value: unknown): unknown {
    if (typeof value === 'function') {
      const contract = getIpcContractBinding(value)
      if (!contract) throw new Error('Unregistered contextBridge function')
      if (contract.direction === 'push') return value
      return bindIpcContractAlias(value, async (...args: unknown[]): Promise<IpcBridgeResult<unknown>> => {
        try {
          return { ok: true, value: await value(...args) }
        } catch (error) {
          const failure = error as { message?: string; code?: string; details?: unknown }
          return { ok: false, failure: {
            error: true,
            message: typeof failure?.message === 'string' ? failure.message : 'IPC request failed',
            code: typeof failure?.code === 'string' ? failure.code : 'IPC_TRANSPORT_ERROR',
            details: failure?.details,
          } }
        }
      })
    }
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, visit(child)]))
    }
    return value
  }
  return visit(api) as IpcBridgeApi<T>
}
