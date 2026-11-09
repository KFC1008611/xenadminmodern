/**
 * Connection store — UI-facing session state derived from ConnectionManagerStore.
 *
 * Simplified: connect/disconnect methods removed (use ConnectionManagerStore).
 * isConnected is now derived from whether any connection in ConnectionManagerStore
 * is in 'connected' state.
 *
 * This store is kept as a thin adapter so that App.tsx route guarding and
 * TopBar display continue to work without pulling the full connections array.
 */
import { create } from 'zustand'
import { useConnectionManagerStore } from './connectionManager.store'

interface ConnectionStore {
  isConnected: boolean
  /** Display name shown in TopBar — derived from active connection */
  poolName: string | null
  /** Host address shown in TopBar — derived from active connection */
  host: string | null

  // Actions — called by connection components after a successful connect/disconnect
  syncFromManager: () => void
  /** @deprecated Use syncFromManager() instead — kept for migration compatibility */
  setPoolInfo: (poolName: string, masterHostName: string) => void
  /** @deprecated Use syncFromManager() instead — kept for migration compatibility */
  setConnected: (host: string) => void
  /** @deprecated Use syncFromManager() instead — kept for migration compatibility */
  setDisconnected: () => void
}

export const useConnectionStore = create<ConnectionStore>((set) => ({
  isConnected: false,
  poolName: null,
  host: null,

  /**
   * Derive UI state from ConnectionManagerStore.
   * Call this after any connect/disconnect/reconnect/remove operation.
   * Only triggers re-render if values actually changed.
   */
  syncFromManager: () => {
    const { connections, activeConnectionId } = useConnectionManagerStore.getState()
    const active = connections.find((c) => c.id === activeConnectionId)
    const hasAnyConnected = connections.some((c) => c.state === 'connected')

    const newIsConnected = hasAnyConnected
    const newPoolName = active?.poolName || active?.name || null
    const newHost = active?.host || null

    // Only set if something actually changed (prevents infinite loops)
    const current = useConnectionStore.getState()
    if (
      current.isConnected === newIsConnected &&
      current.poolName === newPoolName &&
      current.host === newHost
    ) {
      return
    }

    set({
      isConnected: newIsConnected,
      poolName: newPoolName,
      host: newHost,
    })
  },

  // Legacy adapters — will be removed in a follow-up
  setPoolInfo: (poolName, _masterHostName) => set({ poolName }),
  setConnected: (host) => set({ isConnected: true, host }),
  setDisconnected: () => set({ isConnected: false, host: null, poolName: null }),
}))
