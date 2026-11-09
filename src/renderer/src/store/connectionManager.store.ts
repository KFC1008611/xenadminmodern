/**
 * ConnectionManager store — manages all XAPI connections and their states.
 * v4: Replaces the single-connection model with a multi-connection model.
 */
import { create } from 'zustand'
import type { ConnectionInfo, XapiConnectionOptions } from '../types/xapi'

interface ConnectionManagerStore {
  connections: ConnectionInfo[]
  activeConnectionId: string | null
  isLoading: boolean
  reconnectingIds: string[]
  error: string | null

  // Actions
  connect: (opts: XapiConnectionOptions) => Promise<string>
  connectProfile: (id: string, password?: string) => Promise<string>
  disconnect: (id: string) => Promise<void>
  reconnect: (id: string, password?: string) => Promise<void>
  setActiveConnection: (id: string | null) => void
  refreshConnections: () => Promise<void>
  loadSavedConnections: () => Promise<void>
  removeConnection: (id: string) => void
}

function resolveActiveConnectionId(
  connections: ConnectionInfo[],
  preferredId: string | null
): string | null {
  const connected = connections.filter((c) => c.state === 'connected')
  if (preferredId && connected.some((c) => c.id === preferredId)) {
    return preferredId
  }
  return connected[0]?.id ?? null
}

export const useConnectionManagerStore = create<ConnectionManagerStore>((set, get) => {
  let listGeneration = 0
  let pendingConnects = 0
  let restoring: Promise<void> | null = null
  const reconnects = new Map<string, Promise<void>>()

  // Every reader, including mutation readback, shares one ordering boundary.
  const refresh = async (preferred?: string | null) => {
    const generation = ++listGeneration
    try {
      const connections = await window.xapi.connection.list()
      if (generation !== listGeneration) return
      set({ connections, activeConnectionId: resolveActiveConnectionId(
        connections, preferred === undefined ? get().activeConnectionId : preferred,
      ) })
    } catch (error: any) {
      if (generation !== listGeneration) return
      set({ error: error?.message || '读取连接状态失败' })
      throw error
    }
  }
  const connecting = async (operation: () => Promise<{ id: string }>) => {
    ++listGeneration
    ++pendingConnects
    set({ isLoading: true, error: null })
    try {
      const { id } = await operation()
      await refresh(id)
      return id
    } catch (error: any) {
      set({ error: error?.message || '连接失败' })
      throw error
    } finally {
      --pendingConnects
      set({ isLoading: pendingConnects > 0 })
    }
  }

  return {
    connections: [],
    activeConnectionId: null,
    isLoading: false,
    reconnectingIds: [],
    error: null,

    connect: (opts: XapiConnectionOptions) => connecting(() => window.xapi.connection.connect(opts)),

    connectProfile: (profileId: string, password?: string) => connecting(
      () => window.xapi.profiles.connect(profileId, password),
    ),

    disconnect: async (id: string) => {
      ++listGeneration
      try {
        await window.xapi.connection.disconnect(id)
        await refresh(get().activeConnectionId === id ? null : get().activeConnectionId)
      } catch (e: any) {
        console.error('Disconnect failed:', e?.message || e)
        throw e
      }
    },

    reconnect: (id: string, password?: string) => {
      const pending = reconnects.get(id)
      if (pending) return pending
      ++listGeneration
      set((state) => ({ error: null, reconnectingIds: [...state.reconnectingIds, id] }))
      const operation = (async () => {
        try {
          if (password === undefined) await window.xapi.connection.reconnect(id)
          else await window.xapi.connection.reconnect(id, password)
          await refresh(id)
        } catch (e: any) {
          set({ error: e?.message || '重新连接失败' })
          await refresh().catch(() => undefined)
          throw e
        } finally {
          reconnects.delete(id)
          set((state) => ({ reconnectingIds: state.reconnectingIds.filter((entry) => entry !== id) }))
        }
      })()
      reconnects.set(id, operation)
      return operation
    },

    setActiveConnection: (id: string | null) => {
      set((state) => ({
        activeConnectionId: resolveActiveConnectionId(state.connections, id),
      }))
    },

    refreshConnections: () => refresh(),

    loadSavedConnections: () => {
      if (restoring) return restoring
      restoring = (async () => {
        const failures: string[] = []
        try {
          const profiles = await window.xapi.profiles.list()
          await Promise.all(profiles.filter((p) => p.autoConnect).map(async (profile) => {
            if (get().connections.some((c) => c.state === 'connected' &&
              (c.id === profile.id || c.host === profile.host))) return
            try {
              await get().connectProfile(profile.id)
            } catch (error: any) {
              failures.push(`${profile.name}: ${error?.message || '自动连接失败'}`)
            }
          }))
        } catch (error: any) {
          failures.push(error?.message || '读取保存的服务器失败')
        }
        if (failures.length) set({ error: failures.join('；') })
      })().finally(() => { restoring = null })
      return restoring
    },

    removeConnection: (id: string) => {
      ++listGeneration
      const { connections, activeConnectionId } = get()
      const updated = connections.filter((c) => c.id !== id)
      const preferredId = activeConnectionId === id ? null : activeConnectionId
      set({
        connections: updated,
        activeConnectionId: resolveActiveConnectionId(updated, preferredId),
      })
    },
  }
})
