/**
 * Network advanced store — manages Bond, VLAN, Tunnel, and QoS state.
 * v9: New store for advanced network features.
 */
import { create } from 'zustand'
import { useConnectionManagerStore } from './connectionManager.store'
import type {
  BondCreateParams,
  BondRecord,
  ConnectedTunnelRecord,
  VifQosParams,
  VlanCreateParams,
  VlanRecord,
} from '../types/xapi'

// ============================================================================
// Types
// ============================================================================

// ============================================================================
// Store
// ============================================================================

interface NetworkAdvancedState {
  // Bond state
  bonds: BondRecord[]
  bondsConnectionId: string | null
  bondsLoading: boolean
  bondsError: string | null

  // VLAN state
  vlans: VlanRecord[]
  vlansConnectionId: string | null
  vlansLoading: boolean
  vlansError: string | null

  // Tunnel state
  tunnels: ConnectedTunnelRecord[]
  tunnelsConnectionId: string | null
  tunnelsLoading: boolean
  tunnelsError: string | null

  // Actions - Bond
  loadBonds: (connectionId?: string) => Promise<void>
  createBond: (params: BondCreateParams, connectionId?: string) => Promise<string[]>
  destroyBond: (bondRef: string, connectionId?: string) => Promise<void>
  destroyBondGroup: (bondRef: string, connectionId?: string) => Promise<void>

  // Actions - VLAN
  loadVlans: (connectionId?: string) => Promise<void>
  createVlan: (params: VlanCreateParams, connectionId?: string) => Promise<string[]>
  destroyVlan: (vlanRef: string, connectionId?: string) => Promise<void>
  destroyVlanNetwork: (networkRef: string, connectionId?: string, options?: { confirmManagementDisruption?: boolean }) => Promise<void>

  // Actions - Tunnel
  loadTunnels: (connectionId?: string) => Promise<void>
  createTunnel: (accessPifRef: string, networkRef: string, connectionId?: string) => Promise<string>
  destroyTunnel: (tunnelRef: string, connectionId?: string) => Promise<void>

  // Actions - QoS
  setVifQos: (vifRef: string, params: VifQosParams, connectionId?: string) => Promise<void>
  clearVifQos: (vifRef: string, connectionId?: string) => Promise<void>
}

function resolveConnectionId(connectionId?: string): string {
  return connectionId || useConnectionManagerStore.getState().activeConnectionId || ''
}

type TopologyDomain = 'bonds' | 'vlans' | 'tunnels'
const requestGenerations: Record<TopologyDomain, number> = { bonds: 0, vlans: 0, tunnels: 0 }
const connectionFingerprint = (id: string) => {
  const connection = useConnectionManagerStore.getState().connections.find((item) => item.id === id)
  return JSON.stringify([connection?.state, connection?.connectedAt, connection?.epoch, connection?.poolUuid])
}

export const useNetworkAdvancedStore = create<NetworkAdvancedState>((set, get) => {
  const load = async (domain: TopologyDomain, connectionId?: string) => {
    const id = resolveConnectionId(connectionId)
    const generation = ++requestGenerations[domain]
    const scopeKey = `${domain}ConnectionId` as const
    const loadingKey = `${domain}Loading` as const
    const errorKey = `${domain}Error` as const
    const connection = useConnectionManagerStore.getState().connections.find((item) => item.id === id)
    if (!id || (connection && connection.state !== 'connected')) {
      set({ [domain]: [], [scopeKey]: id || null, [loadingKey]: false, [errorKey]: connection ? '管理连接未连接' : null })
      return
    }
    const fingerprint = connectionFingerprint(id)
    set({
      ...(get()[scopeKey] !== id ? { [domain]: [] } : {}),
      [scopeKey]: id, [loadingKey]: true, [errorKey]: null,
    })
    const current = () => generation === requestGenerations[domain] && get()[scopeKey] === id && connectionFingerprint(id) === fingerprint
    try {
      const records = await ({ bonds: window.xapi.bond, vlans: window.xapi.vlan, tunnels: window.xapi.tunnel })[domain].list(id)
      if (current()) set({ [domain]: records, [loadingKey]: false })
    } catch (error: any) {
      if (current()) set({ [errorKey]: error?.message || String(error), [loadingKey]: false })
    }
  }
  return {
    // Initial state
    bonds: [],
    bondsConnectionId: null,
    bondsLoading: false,
    bondsError: null,
    vlans: [],
    vlansConnectionId: null,
    vlansLoading: false,
    vlansError: null,
    tunnels: [],
    tunnelsConnectionId: null,
    tunnelsLoading: false,
    tunnelsError: null,

    // Bond actions
    loadBonds: (connectionId) => load('bonds', connectionId),

    createBond: async (params, connectionId) => {
      const id = resolveConnectionId(connectionId)
      if (!id) throw new Error('No active connection')

      const bondRef = await window.xapi.bond.create(id, params)
      await get().loadBonds(id)
      return bondRef
    },

    destroyBond: async (bondRef: string, connectionId) => {
      const id = resolveConnectionId(connectionId)
      if (!id) throw new Error('No active connection')

      await window.xapi.bond.destroyGroup(id, bondRef)
      await get().loadBonds(id)
    },

    destroyBondGroup: async (bondRef: string, connectionId) => {
      const id = resolveConnectionId(connectionId)
      if (!id) throw new Error('No active connection')

      await window.xapi.bond.destroyGroup(id, bondRef)
      await get().loadBonds(id)
    },

    // VLAN actions
    loadVlans: (connectionId) => load('vlans', connectionId),

    createVlan: async (params, connectionId) => {
      const id = resolveConnectionId(connectionId)
      if (!id) throw new Error('No active connection')

      const vlanRef = await window.xapi.vlan.create(id, params)
      await get().loadVlans(id)
      return vlanRef
    },

    destroyVlan: async (vlanRef: string, connectionId) => {
      const id = resolveConnectionId(connectionId)
      if (!id) throw new Error('No active connection')

      await window.xapi.vlan.destroy(id, vlanRef)
      await get().loadVlans(id)
    },

    destroyVlanNetwork: async (networkRef: string, connectionId, options) => {
      const id = resolveConnectionId(connectionId)
      if (!id) throw new Error('No active connection')

      await window.xapi.vlan.destroyNetwork(id, networkRef, options)
      await get().loadVlans(id)
    },

    // Tunnel actions
    loadTunnels: (connectionId) => load('tunnels', connectionId),

    createTunnel: async (accessPifRef: string, networkRef: string, explicitConnectionId) => {
      const connectionId = resolveConnectionId(explicitConnectionId)
      if (!connectionId) throw new Error('No active connection')

      const tunnelRef = await window.xapi.tunnel.create(connectionId, accessPifRef, networkRef)
      await get().loadTunnels(connectionId)
      return tunnelRef
    },

    destroyTunnel: async (tunnelRef: string, explicitConnectionId) => {
      const connectionId = resolveConnectionId(explicitConnectionId)
      if (!connectionId) throw new Error('No active connection')

      await window.xapi.tunnel.destroy(connectionId, tunnelRef)
      await get().loadTunnels(connectionId)
    },

    // QoS actions
    setVifQos: async (vifRef: string, params: VifQosParams, explicitConnectionId) => {
      const connectionId = resolveConnectionId(explicitConnectionId)
      if (!connectionId) throw new Error('No active connection')

      await window.xapi.vif.setQos(connectionId, vifRef, params)
    },

    clearVifQos: async (vifRef: string, explicitConnectionId) => {
      const connectionId = resolveConnectionId(explicitConnectionId)
      if (!connectionId) throw new Error('No active connection')

      await window.xapi.vif.clearQos(connectionId, vifRef)
    },
  }
})

// Invalidate in-flight topology reads on disconnect/reconnect and pool identity
// changes, including a disconnect followed by reconnect before the read returns.
useConnectionManagerStore.subscribe((state, previous) => {
  for (const domain of ['bonds', 'vlans', 'tunnels'] as const) {
    const id = useNetworkAdvancedStore.getState()[`${domain}ConnectionId`]
    if (!id) continue
    const oldConnection = previous.connections.find((item) => item.id === id)
    const connection = state.connections.find((item) => item.id === id)
    const identity = (item: typeof connection) => JSON.stringify([item?.state, item?.connectedAt, item?.epoch, item?.poolUuid])
    if (identity(oldConnection) === identity(connection)) continue
    ++requestGenerations[domain]
    useNetworkAdvancedStore.setState({
      [domain]: [], [`${domain}Loading`]: false,
      [`${domain}Error`]: connection?.state === 'connected' ? null : '管理连接未连接',
    })
  }
})
