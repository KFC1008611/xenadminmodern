/**
 * VM Advanced store — manages VM affinity, anti-affinity, protection, VCPU hotplug,
 * boot order, platform settings, and other advanced VM configurations.
 * v9: New store for VM advanced features.
 */
import { create } from 'zustand'
import { useConnectionManagerStore } from './connectionManager.store'
import type { VmAdvancedConfig, VmAffinityConfig } from '../types/xapi'

// ============================================================================
// Types
// ============================================================================

export interface VmAdvancedState {
  // VM advanced config
  vmConfigs: Record<string, VmAdvancedConfig>
  vmConfigReads: Record<string, { loading: boolean; error: string | null }>
  vmConfigsLoading: boolean
  vmConfigsError: string | null

  // Affinity config
  affinityConfig: VmAffinityConfig | null
  affinityConfigKey: string | null
  affinityConfigLoading: boolean
  affinityConfigError: string | null

  // All VM configs (for pool-wide view)
  allVmConfigs: VmAdvancedConfig[]
  allVmConfigsLoading: boolean
  allVmConfigsError: string | null

  // Actions
  loadVmConfig: (connectionId: string, vmRef?: string) => Promise<void>
  loadAllVmConfigs: (connectionId?: string) => Promise<void>
  loadAffinityConfig: (connectionId: string, vmRef?: string) => Promise<void>

  // Affinity actions
  setVmAffinity: (connectionId: string, vmRef: string, hostRef?: string | null) => Promise<void>
  setVmAntiAffinity: (connectionId: string, vmRef: string, vmRefs?: string[]) => Promise<void>
  addVmAntiAffinity: (connectionId: string, vmRef: string, antiAffinityVmRef?: string) => Promise<void>
  removeVmAntiAffinity: (connectionId: string, vmRef: string, antiAffinityVmRef?: string) => Promise<void>

  // Protection actions
  enableVmProtection: (connectionId: string, vmRef?: string) => Promise<void>
  disableVmProtection: (connectionId: string, vmRef?: string) => Promise<void>

  // VCPU actions
  setVmVcpuHotplug: (connectionId: string, vmRef: string, maxVcpus?: number) => Promise<void>
  setVmVcpusNumber: (connectionId: string, vmRef: string, vcpus?: number) => Promise<void>

  // Boot order actions
  setVmStartDelay: (connectionId: string, vmRef: string, delaySeconds?: number) => Promise<void>
  setVmBootOrder: (connectionId: string, vmRef: string, order?: string) => Promise<void>
  setVmHvmBootParams: (connectionId: string, vmRef: string, params?: Record<string, string>) => Promise<void>

  // Platform actions
  setVmPlatformParam: (connectionId: string, vmRef: string, key: string, value?: string) => Promise<void>
  setVmViridian: (connectionId: string, vmRef: string, enabled?: boolean) => Promise<void>

  // Other config and tags
  setVmOtherConfig: (connectionId: string, vmRef: string, key: string, value?: string) => Promise<void>
  addVmTag: (connectionId: string, vmRef: string, tag?: string) => Promise<void>
  removeVmTag: (connectionId: string, vmRef: string, tag?: string) => Promise<void>

  // Pool VM start order
  setPoolVmStartOrder: (connectionId: string, vmStartConfigs?: Array<{ vmRef: string; startDelay: number; order: number }>) => Promise<void>
}

function resolveConnectionId(connectionId?: string): string {
  return connectionId || useConnectionManagerStore.getState().activeConnectionId || ''
}

export function vmAdvancedKey(connectionId: string, vmRef: string): string {
  return `${connectionId}:${vmRef}`
}

function resolveVmRefArgs(connectionIdOrVmRef: string, vmRef?: string): { connectionId: string; vmRef: string } {
  if (vmRef === undefined) {
    return { connectionId: resolveConnectionId(), vmRef: connectionIdOrVmRef }
  }
  return { connectionId: resolveConnectionId(connectionIdOrVmRef), vmRef }
}

function resolveVmValueArgs<T>(
  connectionIdOrVmRef: string,
  vmRefOrValue: string | T,
  value?: T,
): { connectionId: string; vmRef: string; value: T } {
  if (value === undefined) {
    return {
      connectionId: resolveConnectionId(),
      vmRef: connectionIdOrVmRef,
      value: vmRefOrValue as T,
    }
  }
  return {
    connectionId: resolveConnectionId(connectionIdOrVmRef),
    vmRef: vmRefOrValue as string,
    value,
  }
}

const configReadGenerations = new Map<string, number>()
let affinityReadGeneration = 0

export const useVmAdvancedStore = create<VmAdvancedState>((set, get) => ({
  // Initial state
  vmConfigs: {},
  vmConfigReads: {},
  vmConfigsLoading: false,
  vmConfigsError: null,
  affinityConfig: null,
  affinityConfigKey: null,
  affinityConfigLoading: false,
  affinityConfigError: null,
  allVmConfigs: [],
  allVmConfigsLoading: false,
  allVmConfigsError: null,

  // Load single VM config
  loadVmConfig: async (connectionIdOrVmRef: string, vmRefArg?: string) => {
    const { connectionId, vmRef } = resolveVmRefArgs(connectionIdOrVmRef, vmRefArg)
    if (!connectionId) return
    const key = vmAdvancedKey(connectionId, vmRef)
    const generation = (configReadGenerations.get(key) ?? 0) + 1
    configReadGenerations.set(key, generation)

    set((state) => ({
      vmConfigsLoading: true,
      vmConfigsError: null,
      vmConfigReads: { ...state.vmConfigReads, [key]: { loading: true, error: null } },
      vmConfigs: { ...state.vmConfigs, [key]: state.vmConfigs[key] || (null as any) },
    }))
    try {
      const config = await window.xapi.vmAdvanced.getConfig(connectionId, vmRef)
      if (configReadGenerations.get(key) !== generation) return
      set((state) => ({
        vmConfigs: { ...state.vmConfigs, [key]: config },
        vmConfigReads: { ...state.vmConfigReads, [key]: { loading: false, error: null } },
        vmConfigsLoading: false,
      }))
    } catch (err: any) {
      if (configReadGenerations.get(key) !== generation) return
      set((state) => ({ vmConfigsError: err.message, vmConfigsLoading: false, vmConfigReads: { ...state.vmConfigReads, [key]: { loading: false, error: err?.message || String(err) } } }))
    }
  },

  // Load all VM configs
  loadAllVmConfigs: async (connectionIdArg?: string) => {
    const connectionId = resolveConnectionId(connectionIdArg)
    if (!connectionId) return

    set({ allVmConfigsLoading: true, allVmConfigsError: null })
    try {
      const allVmConfigs = await window.xapi.vmAdvanced.getAllConfigs(connectionId)
      set({ allVmConfigs, allVmConfigsLoading: false })
    } catch (err: any) {
      set({ allVmConfigsError: err.message, allVmConfigsLoading: false })
    }
  },

  // Load affinity config
  loadAffinityConfig: async (connectionIdOrVmRef: string, vmRefArg?: string) => {
    const { connectionId, vmRef } = resolveVmRefArgs(connectionIdOrVmRef, vmRefArg)
    if (!connectionId) return

    const key = vmAdvancedKey(connectionId, vmRef)
    const generation = ++affinityReadGeneration
    set({ affinityConfig: null, affinityConfigKey: key, affinityConfigLoading: true, affinityConfigError: null })
    try {
      const affinityConfig = await window.xapi.vmAdvanced.getAffinity(connectionId, vmRef)
      if (generation !== affinityReadGeneration) return
      if (affinityConfig.vmRef !== vmRef) throw new Error('亲和配置不属于当前虚拟机')
      set({ affinityConfig, affinityConfigLoading: false })
    } catch (err: any) {
      if (generation !== affinityReadGeneration) return
      set({ affinityConfigError: err.message, affinityConfigLoading: false })
    }
  },

  // Set VM affinity
  setVmAffinity: async (connectionIdOrVmRef: string, vmRefOrHostRef: string | null, hostRefArg?: string | null) => {
    const { connectionId, vmRef, value: hostRef } = resolveVmValueArgs<string | null>(
      connectionIdOrVmRef,
      vmRefOrHostRef,
      hostRefArg,
    )
    if (!connectionId) throw new Error('No active connection')

    await window.xapi.vmAdvanced.setAffinity(connectionId, vmRef, hostRef)
    await get().loadVmConfig(connectionId, vmRef)
    await get().loadAffinityConfig(connectionId, vmRef)
  },

  // Set VM anti-affinity
  setVmAntiAffinity: async (connectionIdOrVmRef: string, vmRefOrVmRefs: string | string[], vmRefsArg?: string[]) => {
    const { connectionId, vmRef, value: vmRefs } = resolveVmValueArgs<string[]>(
      connectionIdOrVmRef,
      vmRefOrVmRefs,
      vmRefsArg,
    )
    if (!connectionId) throw new Error('No active connection')

    await window.xapi.vmAdvanced.setAntiAffinity(connectionId, vmRef, vmRefs)
    await get().loadVmConfig(connectionId, vmRef)
    await get().loadAffinityConfig(connectionId, vmRef)
  },

  // Add VM anti-affinity
  addVmAntiAffinity: async (connectionIdOrVmRef: string, vmRefOrAntiAffinityVmRef: string, antiAffinityVmRefArg?: string) => {
    const { connectionId, vmRef, value: antiAffinityVmRef } = resolveVmValueArgs<string>(
      connectionIdOrVmRef,
      vmRefOrAntiAffinityVmRef,
      antiAffinityVmRefArg,
    )
    if (!connectionId) throw new Error('No active connection')

    await window.xapi.vmAdvanced.addAntiAffinity(connectionId, vmRef, antiAffinityVmRef)
    await get().loadVmConfig(connectionId, vmRef)
    await get().loadAffinityConfig(connectionId, vmRef)
  },

  // Remove VM anti-affinity
  removeVmAntiAffinity: async (connectionIdOrVmRef: string, vmRefOrAntiAffinityVmRef: string, antiAffinityVmRefArg?: string) => {
    const { connectionId, vmRef, value: antiAffinityVmRef } = resolveVmValueArgs<string>(
      connectionIdOrVmRef,
      vmRefOrAntiAffinityVmRef,
      antiAffinityVmRefArg,
    )
    if (!connectionId) throw new Error('No active connection')

    await window.xapi.vmAdvanced.removeAntiAffinity(connectionId, vmRef, antiAffinityVmRef)
    await get().loadVmConfig(connectionId, vmRef)
    await get().loadAffinityConfig(connectionId, vmRef)
  },

  // Enable VM protection
  enableVmProtection: async (connectionIdOrVmRef: string, vmRefArg?: string) => {
    const { connectionId, vmRef } = resolveVmRefArgs(connectionIdOrVmRef, vmRefArg)
    if (!connectionId) throw new Error('No active connection')

    await window.xapi.vmAdvanced.enableProtection(connectionId, vmRef)
    await get().loadVmConfig(connectionId, vmRef)
  },

  // Disable VM protection
  disableVmProtection: async (connectionIdOrVmRef: string, vmRefArg?: string) => {
    const { connectionId, vmRef } = resolveVmRefArgs(connectionIdOrVmRef, vmRefArg)
    if (!connectionId) throw new Error('No active connection')

    await window.xapi.vmAdvanced.disableProtection(connectionId, vmRef)
    await get().loadVmConfig(connectionId, vmRef)
  },

  // Set VCPU hotplug
  setVmVcpuHotplug: async (connectionIdOrVmRef: string, vmRefOrMaxVcpus: string | number, maxVcpusArg?: number) => {
    const { connectionId, vmRef, value: maxVcpus } = resolveVmValueArgs<number>(
      connectionIdOrVmRef,
      vmRefOrMaxVcpus,
      maxVcpusArg,
    )
    if (!connectionId) throw new Error('No active connection')

    await window.xapi.vmAdvanced.setVcpuHotplug(connectionId, vmRef, maxVcpus)
    await get().loadVmConfig(connectionId, vmRef)
  },

  // Set VCPUs number
  setVmVcpusNumber: async (connectionIdOrVmRef: string, vmRefOrVcpus: string | number, vcpusArg?: number) => {
    const { connectionId, vmRef, value: vcpus } = resolveVmValueArgs<number>(
      connectionIdOrVmRef,
      vmRefOrVcpus,
      vcpusArg,
    )
    if (!connectionId) throw new Error('No active connection')

    await window.xapi.vmAdvanced.setVcpusNumber(connectionId, vmRef, vcpus)
    await get().loadVmConfig(connectionId, vmRef)
  },

  // Set VM start delay
  setVmStartDelay: async (connectionIdOrVmRef: string, vmRefOrDelaySeconds: string | number, delaySecondsArg?: number) => {
    const { connectionId, vmRef, value: delaySeconds } = resolveVmValueArgs<number>(
      connectionIdOrVmRef,
      vmRefOrDelaySeconds,
      delaySecondsArg,
    )
    if (!connectionId) throw new Error('No active connection')

    await window.xapi.vmAdvanced.setStartDelay(connectionId, vmRef, delaySeconds)
    await get().loadVmConfig(connectionId, vmRef)
  },

  // Set VM boot order
  setVmBootOrder: async (connectionIdOrVmRef: string, vmRefOrOrder: string, orderArg?: string) => {
    const { connectionId, vmRef, value: order } = resolveVmValueArgs<string>(
      connectionIdOrVmRef,
      vmRefOrOrder,
      orderArg,
    )
    if (!connectionId) throw new Error('No active connection')

    await window.xapi.vmAdvanced.setBootOrder(connectionId, vmRef, order)
    await get().loadVmConfig(connectionId, vmRef)
  },

  // Set HVM boot params
  setVmHvmBootParams: async (connectionIdOrVmRef: string, vmRefOrParams: string | Record<string, string>, paramsArg?: Record<string, string>) => {
    const { connectionId, vmRef, value: params } = resolveVmValueArgs<Record<string, string>>(
      connectionIdOrVmRef,
      vmRefOrParams,
      paramsArg,
    )
    if (!connectionId) throw new Error('No active connection')

    await window.xapi.vmAdvanced.setHvmBootParams(connectionId, vmRef, params)
    await get().loadVmConfig(connectionId, vmRef)
  },

  // Set platform param
  setVmPlatformParam: async (connectionIdOrVmRef: string, vmRefOrKey: string, keyOrValue: string, valueArg?: string) => {
    const connectionId = valueArg === undefined ? resolveConnectionId() : resolveConnectionId(connectionIdOrVmRef)
    const vmRef = valueArg === undefined ? connectionIdOrVmRef : vmRefOrKey
    const key = valueArg === undefined ? vmRefOrKey : keyOrValue
    const value = valueArg === undefined ? keyOrValue : valueArg
    if (!connectionId) throw new Error('No active connection')

    await window.xapi.vmAdvanced.setPlatformParam(connectionId, vmRef, key, value)
    await get().loadVmConfig(connectionId, vmRef)
  },

  // Set Viridian
  setVmViridian: async (connectionIdOrVmRef: string, vmRefOrEnabled: string | boolean, enabledArg?: boolean) => {
    const { connectionId, vmRef, value: enabled } = resolveVmValueArgs<boolean>(
      connectionIdOrVmRef,
      vmRefOrEnabled,
      enabledArg,
    )
    if (!connectionId) throw new Error('No active connection')

    await window.xapi.vmAdvanced.setViridian(connectionId, vmRef, enabled)
    await get().loadVmConfig(connectionId, vmRef)
  },

  // Set other config
  setVmOtherConfig: async (connectionIdOrVmRef: string, vmRefOrKey: string, keyOrValue: string, valueArg?: string) => {
    const connectionId = valueArg === undefined ? resolveConnectionId() : resolveConnectionId(connectionIdOrVmRef)
    const vmRef = valueArg === undefined ? connectionIdOrVmRef : vmRefOrKey
    const key = valueArg === undefined ? vmRefOrKey : keyOrValue
    const value = valueArg === undefined ? keyOrValue : valueArg
    if (!connectionId) throw new Error('No active connection')

    await window.xapi.vmAdvanced.setOtherConfig(connectionId, vmRef, key, value)
    await get().loadVmConfig(connectionId, vmRef)
  },

  // Add VM tag
  addVmTag: async (connectionIdOrVmRef: string, vmRefOrTag: string, tagArg?: string) => {
    const { connectionId, vmRef, value: tag } = resolveVmValueArgs<string>(
      connectionIdOrVmRef,
      vmRefOrTag,
      tagArg,
    )
    if (!connectionId) throw new Error('No active connection')

    await window.xapi.vmAdvanced.addTag(connectionId, vmRef, tag)
    await get().loadVmConfig(connectionId, vmRef)
  },

  // Remove VM tag
  removeVmTag: async (connectionIdOrVmRef: string, vmRefOrTag: string, tagArg?: string) => {
    const { connectionId, vmRef, value: tag } = resolveVmValueArgs<string>(
      connectionIdOrVmRef,
      vmRefOrTag,
      tagArg,
    )
    if (!connectionId) throw new Error('No active connection')

    await window.xapi.vmAdvanced.removeTag(connectionId, vmRef, tag)
    await get().loadVmConfig(connectionId, vmRef)
  },

  // Set pool VM start order
  setPoolVmStartOrder: async (
    connectionIdOrVmStartConfigs: string | Array<{ vmRef: string; startDelay: number; order: number }>,
    vmStartConfigsArg?: Array<{ vmRef: string; startDelay: number; order: number }>,
  ) => {
    const connectionId = Array.isArray(connectionIdOrVmStartConfigs)
      ? resolveConnectionId()
      : resolveConnectionId(connectionIdOrVmStartConfigs)
    const vmStartConfigs = Array.isArray(connectionIdOrVmStartConfigs)
      ? connectionIdOrVmStartConfigs
      : vmStartConfigsArg || []
    if (!connectionId) throw new Error('No active connection')

    await window.xapi.vmAdvanced.setStartOrder(connectionId, vmStartConfigs)
    await get().loadAllVmConfigs(connectionId)
  },
}))
