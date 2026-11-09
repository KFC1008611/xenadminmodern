/**
 * HA (High Availability) store — manages HA configuration, VM priorities, and emergency operations.
 * v9: New store for HA system.
 */
import { create } from 'zustand'
import { useConnectionManagerStore } from './connectionManager.store'
import type {
  ConnectedHaConfiguration,
  HaComputeResult,
  HaFailoverPlan,
  HaVmConfig,
  HaRestartPriority,
} from '../types/xapi'

// ============================================================================
// Store
// ============================================================================

interface HaState {
  // HA configuration
  haConfig: ConnectedHaConfiguration | null
  haConfigLoading: boolean
  haConfigError: string | null

  // VM HA configs
  vmConfigs: HaVmConfig[]
  vmConfigsLoading: boolean
  vmConfigsError: string | null

  // HA compute result
  computeResult: HaComputeResult | null
  computeResultLoading: boolean
  computeResultError: string | null

  // Failover plan
  failoverPlan: HaFailoverPlan | null
  failoverPlanLoading: boolean
  failoverPlanError: string | null

  // Actions - Configuration
  loadHaConfig: (connectionId?: string) => Promise<void>
  enableHa: (params: { heartbeatSRs: string[]; allowOvercommit?: boolean }, connectionId?: string) => Promise<void>
  disableHa: (connectionId?: string) => Promise<void>

  // Actions - VM configs
  loadVmConfigs: (connectionId?: string) => Promise<void>
  setVmRestartPriority: (vmRef: string, priority: HaRestartPriority, connectionId?: string) => Promise<void>
  setVmAlwaysRun: (vmRef: string, alwaysRun: boolean, connectionId?: string) => Promise<void>

  // Actions - Compute
  computeHaTolerance: (connectionId?: string) => Promise<void>
  preventHaRestarts: (seconds: number, connectionId?: string) => Promise<void>
  haAlwaysRestart: (connectionId?: string) => Promise<void>

  // Actions - Failover plan
  loadFailoverPlan: (connectionId?: string) => Promise<void>

  // Actions - Emergency
  emergencyTransitionToMaster: (connectionId?: string) => Promise<void>
  recoverHaSlaves: (connectionId?: string) => Promise<void>
}

function getConnectionId(connectionId?: string): string {
  return connectionId || useConnectionManagerStore.getState().activeConnectionId || ''
}

const requestVersions = { config: 0, vms: 0, compute: 0, plan: 0 }

export const useHaStore = create<HaState>((set, get) => ({
  // Initial state
  haConfig: null,
  haConfigLoading: false,
  haConfigError: null,
  vmConfigs: [],
  vmConfigsLoading: false,
  vmConfigsError: null,
  computeResult: null,
  computeResultLoading: false,
  computeResultError: null,
  failoverPlan: null,
  failoverPlanLoading: false,
  failoverPlanError: null,

  // HA configuration actions
  loadHaConfig: async (connectionIdArg?: string) => {
    const connectionId = getConnectionId(connectionIdArg)
    const version = ++requestVersions.config
    if (!connectionId) return

    set({ haConfig: null, haConfigError: null, haConfigLoading: true })
    try {
      const haConfig = await window.xapi.ha.getConfig(connectionId)
      if (version !== requestVersions.config) return
      set({ haConfig, haConfigLoading: false })
    } catch (err: any) {
      if (version !== requestVersions.config) return
      if (version !== requestVersions.config) return
      set({ haConfigError: err.message, haConfigLoading: false })
    }
  },

  enableHa: async (params, connectionIdArg?: string) => {
    const connectionId = getConnectionId(connectionIdArg)
    if (!connectionId) throw new Error('No active connection')

    await window.xapi.ha.enable(connectionId, params)
    await get().loadHaConfig(connectionId)
  },

  disableHa: async (connectionIdArg?: string) => {
    const connectionId = getConnectionId(connectionIdArg)
    if (!connectionId) throw new Error('No active connection')

    await window.xapi.ha.disable(connectionId)
    await get().loadHaConfig(connectionId)
  },

  // VM config actions
  loadVmConfigs: async (connectionIdArg?: string) => {
    const connectionId = getConnectionId(connectionIdArg)
    const version = ++requestVersions.vms
    if (!connectionId) return

    set({ vmConfigs: [], vmConfigsError: null, vmConfigsLoading: true })
    try {
      const vmConfigs = await window.xapi.ha.getVmConfigs(connectionId)
      if (version !== requestVersions.vms) return
      set({ vmConfigs, vmConfigsLoading: false })
    } catch (err: any) {
      if (version !== requestVersions.vms) return
      if (version !== requestVersions.vms) return
      set({ vmConfigsError: err.message, vmConfigsLoading: false })
    }
  },

  setVmRestartPriority: async (vmRef: string, priority: HaRestartPriority, connectionIdArg?: string) => {
    const connectionId = getConnectionId(connectionIdArg)
    if (!connectionId) throw new Error('No active connection')

    await window.xapi.ha.setVmPriority(connectionId, vmRef, priority)
    await get().loadVmConfigs(connectionId)
  },

  setVmAlwaysRun: async (vmRef: string, alwaysRun: boolean, connectionIdArg?: string) => {
    const connectionId = getConnectionId(connectionIdArg)
    if (!connectionId) throw new Error('No active connection')

    await window.xapi.ha.setVmAlwaysRun(connectionId, vmRef, alwaysRun)
    await get().loadVmConfigs(connectionId)
  },

  // Compute actions
  computeHaTolerance: async (connectionIdArg?: string) => {
    const connectionId = getConnectionId(connectionIdArg)
    const version = ++requestVersions.compute
    if (!connectionId) return

    set({ computeResult: null, computeResultError: null, computeResultLoading: true })
    try {
      const computeResult = await window.xapi.ha.computeTolerance(connectionId)
      if (version !== requestVersions.compute) return
      set({ computeResult, computeResultLoading: false })
    } catch (err: any) {
      if (version !== requestVersions.compute) return
      if (version !== requestVersions.compute) return
      set({ computeResultError: err.message, computeResultLoading: false })
    }
  },

  preventHaRestarts: async (seconds: number, connectionIdArg?: string) => {
    const connectionId = getConnectionId(connectionIdArg)
    if (!connectionId) throw new Error('No active connection')

    await window.xapi.ha.preventRestarts(connectionId, seconds)
  },

  haAlwaysRestart: async (connectionIdArg?: string) => {
    const connectionId = getConnectionId(connectionIdArg)
    if (!connectionId) throw new Error('No active connection')

    // Resume the HA restart policy; this does not force every VM to restart.
    await window.xapi.ha.preventRestarts(connectionId, 0)
  },

  // Failover plan actions
  loadFailoverPlan: async (connectionIdArg?: string) => {
    const connectionId = getConnectionId(connectionIdArg)
    const version = ++requestVersions.plan
    if (!connectionId) return

    set({ failoverPlan: null, failoverPlanError: null, failoverPlanLoading: true })
    try {
      const failoverPlan = await window.xapi.ha.getFailoverPlan(connectionId)
      if (version !== requestVersions.plan) return
      set({ failoverPlan, failoverPlanLoading: false })
    } catch (err: any) {
      if (version !== requestVersions.plan) return
      if (version !== requestVersions.plan) return
      set({ failoverPlanError: err.message, failoverPlanLoading: false })
    }
  },

  // Emergency actions
  emergencyTransitionToMaster: async (connectionIdArg?: string) => {
    const connectionId = getConnectionId(connectionIdArg)
    if (!connectionId) throw new Error('No active connection')

    await window.xapi.ha.emergencyMaster(connectionId)
  },

  recoverHaSlaves: async (connectionIdArg?: string) => {
    const connectionId = getConnectionId(connectionIdArg)
    if (!connectionId) throw new Error('No active connection')

    await window.xapi.ha.recoverSlaves(connectionId)
  },
}))
