/**
 * Storage advanced store — manages PBD, VDI clone/snapshot, ISO, and SR advanced state.
 * v9: New store for advanced storage features.
 */
import { create } from 'zustand'
import { useConnectionManagerStore } from './connectionManager.store'
import type {
  ConnectedPbdRecord,
  SrIntroduceParams,
  ThinProvisioningStats,
  VdiCloneParams,
  VdiCopyParams,
} from '../types/xapi'

export type { ThinProvisioningStats } from '../types/xapi'

// ============================================================================
// Types
// ============================================================================

// ============================================================================
// Store
// ============================================================================

interface StorageAdvancedState {
  // PBD state
  pbds: ConnectedPbdRecord[]
  pbdsLoading: boolean
  pbdsError: string | null
  pbdStates: Record<string, { items: ConnectedPbdRecord[]; loading: boolean; error: string | null }>

  // ISO state
  isos: any[]
  isosLoading: boolean
  isosError: string | null
  isoStates: Record<string, { items: any[]; loading: boolean; error: string | null }>

  // Thin provisioning stats
  thinStats: Record<string, ThinProvisioningStats>

  // Actions - PBD
  loadPbds: (connectionId?: string) => Promise<void>
  createPbd: (hostRef: string, srRef: string, deviceConfig?: Record<string, string>, connectionId?: string) => Promise<string>
  plugPbd: (pbdRef: string, connectionId?: string) => Promise<void>
  unplugPbd: (pbdRef: string, connectionId?: string) => Promise<void>
  destroyPbd: (pbdRef: string, connectionId?: string) => Promise<void>

  // Actions - VDI clone/snapshot/copy
  cloneVdi: (params: VdiCloneParams) => Promise<string>
  snapshotVdi: (vdiRef: string, nameLabel?: string) => Promise<string>
  copyVdi: (params: VdiCopyParams) => Promise<string>
  setVdiNameLabel: (vdiRef: string, name: string) => Promise<void>
  setVdiNameDescription: (vdiRef: string, description: string) => Promise<void>
  addVdiTag: (vdiRef: string, tag: string) => Promise<void>
  removeVdiTag: (vdiRef: string, tag: string) => Promise<void>

  // Actions - ISO
  loadIsos: (connectionId: string, srRef: string) => Promise<void>
  deleteIso: (connectionId: string, vdiRef: string) => Promise<void>

  // Actions - SR advanced
  introduceSr: (params: SrIntroduceParams) => Promise<string>
  forgetSr: (srRef: string) => Promise<void>
  setSrShared: (srRef: string, shared: boolean) => Promise<void>
  getThinStats: (srRef: string, connectionId?: string) => Promise<ThinProvisioningStats>
}

function resolveConnectionId(connectionId?: string): string {
  return connectionId || useConnectionManagerStore.getState().activeConnectionId || ''
}

function resourceKey(connectionId: string, ref: string): string {
  return `${connectionId}:${ref}`
}

const isoRequests = new Map<string, number>()
const pbdRequests = new Map<string, number>()
const thinRequests = new Map<string, number>()
export const isoResourceKey = (connectionId: string, ref: string): string => JSON.stringify([connectionId, ref])

export const useStorageAdvancedStore = create<StorageAdvancedState>((set, get) => ({
  // Initial state
  pbds: [],
  pbdsLoading: false,
  pbdsError: null,
  pbdStates: {},
  isos: [],
  isosLoading: false,
  isosError: null,
  isoStates: {},
  thinStats: {},

  // PBD actions
  loadPbds: async (connectionIdArg?: string) => {
    const connectionId = resolveConnectionId(connectionIdArg)
    if (!connectionId) return

    const request = (pbdRequests.get(connectionId) ?? 0) + 1
    pbdRequests.set(connectionId, request)
    set((state) => ({ pbdStates: { ...state.pbdStates, [connectionId]: {
      items: state.pbdStates[connectionId]?.items ?? [], loading: true, error: null,
    } }, pbdsLoading: true, pbdsError: null }))
    try {
      const pbds = await window.xapi.pbd.list(connectionId)
      if (pbdRequests.get(connectionId) !== request) return
      set((state) => {
        const pbdStates = { ...state.pbdStates, [connectionId]: { items: pbds, loading: false, error: null } }
        return { pbdStates, pbds: Object.values(pbdStates).flatMap((entry) => entry.items),
          pbdsLoading: Object.values(pbdStates).some((entry) => entry.loading) }
      })
    } catch (err: any) {
      if (pbdRequests.get(connectionId) !== request) return
      set((state) => {
        const error = err?.message || '读取物理存储连接失败'
        const pbdStates = { ...state.pbdStates, [connectionId]: {
          items: state.pbdStates[connectionId]?.items ?? [], loading: false, error,
        } }
        return { pbdStates, pbdsError: error, pbdsLoading: Object.values(pbdStates).some((entry) => entry.loading) }
      })
    }
  },

  createPbd: async (hostRef: string, srRef: string, deviceConfig?: Record<string, string>, connectionIdArg?: string) => {
    const connectionId = resolveConnectionId(connectionIdArg)
    if (!connectionId) throw new Error('No active connection')

    const pbdRef = await window.xapi.pbd.create(connectionId, hostRef, srRef, deviceConfig)
    await get().loadPbds(connectionId)
    return pbdRef
  },

  plugPbd: async (pbdRef: string, connectionIdArg?: string) => {
    const connectionId = resolveConnectionId(connectionIdArg)
    if (!connectionId) throw new Error('No active connection')

    try { await window.xapi.pbd.plug(connectionId, pbdRef) }
    finally { await get().loadPbds(connectionId) }
  },

  unplugPbd: async (pbdRef: string, connectionIdArg?: string) => {
    const connectionId = resolveConnectionId(connectionIdArg)
    if (!connectionId) throw new Error('No active connection')

    await window.xapi.pbd.unplug(connectionId, pbdRef)
    await get().loadPbds(connectionId)
  },

  destroyPbd: async (pbdRef: string, connectionIdArg?: string) => {
    const connectionId = resolveConnectionId(connectionIdArg)
    if (!connectionId) throw new Error('No active connection')

    await window.xapi.pbd.destroy(connectionId, pbdRef)
    await get().loadPbds(connectionId)
  },

  // VDI clone/snapshot/copy actions
  cloneVdi: async (params: VdiCloneParams) => {
    const connectionId = resolveConnectionId()
    if (!connectionId) throw new Error('No active connection')

    return await window.xapi.storage.cloneVdi(connectionId, params)
  },

  snapshotVdi: async (vdiRef: string, nameLabel?: string) => {
    const connectionId = resolveConnectionId()
    if (!connectionId) throw new Error('No active connection')

    return await window.xapi.storage.snapshotVdi(connectionId, vdiRef, nameLabel)
  },

  copyVdi: async (params: VdiCopyParams) => {
    const connectionId = resolveConnectionId()
    if (!connectionId) throw new Error('No active connection')

    return await window.xapi.storage.copyVdi(connectionId, params)
  },

  setVdiNameLabel: async (vdiRef: string, name: string) => {
    const connectionId = resolveConnectionId()
    if (!connectionId) throw new Error('No active connection')

    await window.xapi.storage.setVdiNameLabel(connectionId, vdiRef, name)
  },

  setVdiNameDescription: async (vdiRef: string, description: string) => {
    const connectionId = resolveConnectionId()
    if (!connectionId) throw new Error('No active connection')

    await window.xapi.storage.setVdiNameDescription(connectionId, vdiRef, description)
  },

  addVdiTag: async (vdiRef: string, tag: string) => {
    const connectionId = resolveConnectionId()
    if (!connectionId) throw new Error('No active connection')

    await window.xapi.storage.addVdiTag(connectionId, vdiRef, tag)
  },

  removeVdiTag: async (vdiRef: string, tag: string) => {
    const connectionId = resolveConnectionId()
    if (!connectionId) throw new Error('No active connection')

    await window.xapi.storage.removeVdiTag(connectionId, vdiRef, tag)
  },

  // ISO actions
  loadIsos: async (connectionId: string, srRef: string) => {
    if (!connectionId || !srRef) throw new Error('ISO 查询必须指定资源池与存储仓库')
    const key = isoResourceKey(connectionId, srRef)
    const request = (isoRequests.get(key) ?? 0) + 1
    isoRequests.set(key, request)
    set((state) => ({ isoStates: { ...state.isoStates, [key]: { items: state.isoStates[key]?.items ?? [], loading: true, error: null } } }))
    try {
      const isos = await window.xapi.iso.list(connectionId, srRef)
      if (isoRequests.get(key) !== request) return
      set((state) => ({ isoStates: { ...state.isoStates, [key]: { items: isos, loading: false, error: null } } }))
    } catch (err: any) {
      if (isoRequests.get(key) !== request) return
      set((state) => ({ isoStates: { ...state.isoStates, [key]: { items: state.isoStates[key]?.items ?? [], loading: false, error: err.message || 'ISO 查询失败' } } }))
    }
  },

  deleteIso: async (connectionId: string, vdiRef: string) => {
    if (!connectionId) throw new Error('No active connection')

    await window.xapi.iso.delete(connectionId, vdiRef)
  },

  // SR advanced actions
  introduceSr: async (params: SrIntroduceParams) => {
    const connectionId = resolveConnectionId()
    if (!connectionId) throw new Error('No active connection')

    return await window.xapi.sr.introduce(connectionId, params)
  },

  forgetSr: async (srRef: string) => {
    const connectionId = resolveConnectionId()
    if (!connectionId) throw new Error('No active connection')

    await window.xapi.sr.forget(connectionId, srRef)
  },

  setSrShared: async (srRef: string, shared: boolean) => {
    const connectionId = resolveConnectionId()
    if (!connectionId) throw new Error('No active connection')

    await window.xapi.sr.setShared(connectionId, srRef, shared)
  },

  getThinStats: async (srRef: string, connectionIdArg?: string) => {
    const connectionId = resolveConnectionId(connectionIdArg)
    if (!connectionId) throw new Error('No active connection')

    const key = resourceKey(connectionId, srRef)
    const request = (thinRequests.get(key) ?? 0) + 1
    thinRequests.set(key, request)
    const stats = await window.xapi.sr.getThinStats(connectionId, srRef)
    if (thinRequests.get(key) !== request) return stats
    set((state) => ({
      thinStats: { ...state.thinStats, [resourceKey(connectionId, srRef)]: stats },
    }))
    return stats
  },
}))

// References and outstanding reads belong to a connection generation, not just a saved endpoint.
useConnectionManagerStore.subscribe((next, previous) => {
  for (const old of previous.connections) {
    const current = next.connections.find((connection) => connection.id === old.id)
    if (current && current.state === old.state && current.epoch === old.epoch
      && current.connectedAt === old.connectedAt && current.poolUuid === old.poolUuid) continue
    pbdRequests.set(old.id, (pbdRequests.get(old.id) ?? 0) + 1)
    for (const key of isoRequests.keys()) {
      if (JSON.parse(key)[0] === old.id) isoRequests.set(key, (isoRequests.get(key) ?? 0) + 1)
    }
    for (const key of thinRequests.keys()) {
      if (key.startsWith(`${old.id}:`)) thinRequests.set(key, (thinRequests.get(key) ?? 0) + 1)
    }
    useStorageAdvancedStore.setState((state) => {
      const pbdStates = Object.fromEntries(Object.entries(state.pbdStates).filter(([id]) => id !== old.id))
      return {
        pbdStates,
        pbds: Object.values(pbdStates).flatMap((entry) => entry.items),
        pbdsLoading: Object.values(pbdStates).some((entry) => entry.loading),
        isoStates: Object.fromEntries(Object.entries(state.isoStates).filter(([key]) => JSON.parse(key)[0] !== old.id)),
        thinStats: Object.fromEntries(Object.entries(state.thinStats).filter(([key]) => !key.startsWith(`${old.id}:`))),
      }
    })
  }
})
