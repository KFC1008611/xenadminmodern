/**
 * @deprecated Use `multiData.store.ts` instead.
 *
 * This store is kept for backward compatibility only.
 * All consumers have been migrated to useMultiDataStore.
 *
 * This file will be removed in a follow-up cleanup.
 */
import { create } from 'zustand'
import type {
  HostRecord,
  VmRecord,
  SrRecord,
  NetworkRecord,
  TaskRecord,
  PoolRecord
} from '../types/xapi'
import { useConnectionManagerStore } from './connectionManager.store'
import { useMultiDataStore } from './multiData.store'

interface DataStore {
  pool: PoolRecord | null
  hosts: HostRecord[]
  vms: VmRecord[]
  srs: SrRecord[]
  networks: NetworkRecord[]
  tasks: TaskRecord[]
  loading: boolean
  error: string | null

  refreshAll: () => Promise<void>
  refreshVms: () => Promise<void>
  refreshHosts: () => Promise<void>
  refreshSrs: () => Promise<void>
  refreshNetworks: () => Promise<void>
  refreshTasks: () => Promise<void>
}

/**
 * @deprecated Use `useMultiDataStore` instead.
 * This legacy store delegates to multiDataStore for backward compatibility.
 */
export const useDataStore = create<DataStore>((set) => ({
  pool: null,
  hosts: [],
  vms: [],
  srs: [],
  networks: [],
  tasks: [],
  loading: false,
  error: null,

  refreshAll: async () => {
    // Delegate to multiDataStore
    await useMultiDataStore.getState().refreshAll()
    // Sync local state from multiDataStore for any remaining direct consumers
    const state = useMultiDataStore.getState()
    const activeConnectionId = useConnectionManagerStore.getState().activeConnectionId
    const pool = state.pools.find(p => p.connectionId === activeConnectionId) || null
    set({
      pool,
      hosts: state.hosts.filter(h => !activeConnectionId || h.connectionId === activeConnectionId) as any,
      vms: state.vms.filter(v => !activeConnectionId || v.connectionId === activeConnectionId) as any,
      srs: state.srs.filter(s => !activeConnectionId || s.connectionId === activeConnectionId) as any,
      networks: state.networks.filter(n => !activeConnectionId || n.connectionId === activeConnectionId) as any,
      tasks: state.tasks.filter(t => !activeConnectionId || t.connectionId === activeConnectionId) as any,
      loading: state.loading,
      error: Object.values(state.errors).join('; ') || null,
    })
  },

  refreshVms: async () => {
    await useMultiDataStore.getState().refreshVms()
  },

  refreshHosts: async () => {
    await useMultiDataStore.getState().refreshHosts()
  },

  refreshSrs: async () => {
    await useMultiDataStore.getState().refreshSrs()
  },

  refreshNetworks: async () => {
    await useMultiDataStore.getState().refreshNetworks()
  },

  refreshTasks: async () => {
    await useMultiDataStore.getState().refreshTasks()
  },
}))
