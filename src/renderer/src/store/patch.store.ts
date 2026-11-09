/**
 * Patch management store — manages patch listing, upload, apply, and removal state.
 * v9: New store for patch management.
 */
import { create } from 'zustand'
import { useConnectionManagerStore } from './connectionManager.store'

// ============================================================================
// Types
// ============================================================================

export interface PatchRecord {
  ref: string
  uuid: string
  name_label: string
  name_description: string
  size: number
  version: string
  update_url: string
  applied: boolean
  after_apply_guides: string[]
  upload_date: Date | null
  hosts?: string[]
  connectionId: string
  poolName: string
}

export interface HostPatchStatus {
  hostRef: string
  hostName: string
  patchRef: string
  patchName: string
  applied: boolean
  appliedTimestamp?: Date
}

export interface PatchUploadResult {
  patchRef: string
  uuid: string
  nameLabel: string
}

export interface PatchApplyResult {
  patchRef: string
  success: boolean
  hostResults: Array<{
    hostRef: string
    hostName: string
    success: boolean
    error?: string
  }>
}

export interface PatchCompatibilityInfo {
  patchRef: string
  patchName: string
  compatible: boolean
  incompatibilities: Array<{
    hostRef: string
    hostName: string
    reason: string
  }>
  afterApplyGuides: string[]
}

// ============================================================================
// Store
// ============================================================================

interface PatchState {
  // Patch list
  patches: PatchRecord[]
  patchesLoading: boolean
  patchesError: string | null

  // Host patch status
  hostPatchStatus: HostPatchStatus[]
  hostPatchStatusLoading: boolean
  hostPatchStatusError: string | null

  // Upload state
  uploadLoading: boolean
  uploadError: string | null

  // Apply state
  applyLoading: boolean
  applyError: string | null
  applyResults: Record<string, PatchApplyResult>

  // Actions - Listing
  loadPatches: (connectionId?: string) => Promise<void>
  loadHostPatchStatus: (connectionId?: string) => Promise<void>
  getMissingPatches: (hostRef: string, connectionId?: string) => Promise<PatchRecord[]>

  // Actions - Upload
  uploadPatch: (filePath: string, connectionId?: string) => Promise<PatchUploadResult>

  // Actions - Precheck
  precheckPatch: (patchRef: string, connectionId?: string) => Promise<PatchCompatibilityInfo>

  // Actions - Apply
  applyPatch: (patchRef: string, connectionId?: string) => Promise<PatchApplyResult>
  applyPatchToHost: (hostRef: string, patchRef: string, connectionId?: string) => Promise<void>
  applyPatchesBatch: (patchRefs: string[], connectionId?: string) => Promise<Array<{ patchRef: string; result: PatchApplyResult }>>

  // Actions - Cleanup
  cleanPatch: (patchRef: string, connectionId?: string) => Promise<void>

  // Actions - Removal
  destroyPatch: (patchRef: string, connectionId?: string) => Promise<void>
  destroyPatchFromHost: (hostRef: string, patchRef: string, connectionId?: string) => Promise<void>
}

function getConnectionId(connectionId?: string): string {
  return connectionId || useConnectionManagerStore.getState().activeConnectionId || ''
}

const requestVersions: Record<string, number> = {}

export const usePatchStore = create<PatchState>((set, get) => ({
  // Initial state
  patches: [],
  patchesLoading: false,
  patchesError: null,
  hostPatchStatus: [],
  hostPatchStatusLoading: false,
  hostPatchStatusError: null,
  uploadLoading: false,
  uploadError: null,
  applyLoading: false,
  applyError: null,
  applyResults: {},

  // Patch listing actions
  loadPatches: async (connectionIdArg?: string) => {
    const connectionId = getConnectionId(connectionIdArg)
    const version = requestVersions.loadPatches = (requestVersions.loadPatches || 0) + 1
    if (!connectionId) return

    set({ patches: [], patchesLoading: true, patchesError: null })
    try {
      const patches = await window.xapi.patch.list(connectionId)
      if (version !== requestVersions.loadPatches) return
      set({ patches, patchesLoading: false })
    } catch (err: any) {
      if (version !== requestVersions.loadPatches) return
      set({ patchesError: err.message, patchesLoading: false })
    }
  },

  loadHostPatchStatus: async (connectionIdArg?: string) => {
    const connectionId = getConnectionId(connectionIdArg)
    const version = requestVersions.loadHostPatchStatus = (requestVersions.loadHostPatchStatus || 0) + 1
    if (!connectionId) return

    set({ hostPatchStatus: [], hostPatchStatusLoading: true, hostPatchStatusError: null })
    try {
      const hostPatchStatus = await window.xapi.patch.getHostStatus(connectionId)
      if (version !== requestVersions.loadHostPatchStatus) return
      set({ hostPatchStatus, hostPatchStatusLoading: false })
    } catch (err: any) {
      if (version !== requestVersions.loadHostPatchStatus) return
      set({ hostPatchStatusError: err.message, hostPatchStatusLoading: false })
    }
  },

  getMissingPatches: async (hostRef: string, connectionIdArg?: string) => {
    const connectionId = getConnectionId(connectionIdArg)
    if (!connectionId) throw new Error('No active connection')

    return await window.xapi.patch.getMissing(connectionId, hostRef)
  },

  // Upload actions
  uploadPatch: async (filePath: string, connectionIdArg?: string) => {
    const connectionId = getConnectionId(connectionIdArg)
    if (!connectionId) throw new Error('No active connection')

    set({ uploadLoading: true, uploadError: null })
    try {
      const result = await window.xapi.patch.upload(connectionId, filePath)
      set({ uploadLoading: false })
      await get().loadPatches(connectionId)
      return result
    } catch (err: any) {
      set({ uploadError: err.message, uploadLoading: false })
      throw err
    }
  },

  // Precheck action
  precheckPatch: async (patchRef: string, connectionIdArg?: string) => {
    const connectionId = getConnectionId(connectionIdArg)
    if (!connectionId) throw new Error('No active connection')

    return await window.xapi.patch.precheck(connectionId, patchRef)
  },

  // Apply actions
  applyPatch: async (patchRef: string, connectionIdArg?: string) => {
    const connectionId = getConnectionId(connectionIdArg)
    if (!connectionId) throw new Error('No active connection')

    set({ applyLoading: true, applyError: null })
    try {
      const result = await window.xapi.patch.apply(connectionId, patchRef)
      set((state) => ({
        applyLoading: false,
        applyResults: { ...state.applyResults, [patchRef]: result },
      }))
      await get().loadPatches(connectionId)
      await get().loadHostPatchStatus(connectionId)
      return result
    } catch (err: any) {
      set({ applyError: err.message, applyLoading: false })
      throw err
    }
  },

  applyPatchToHost: async (hostRef: string, patchRef: string, connectionIdArg?: string) => {
    const connectionId = getConnectionId(connectionIdArg)
    if (!connectionId) throw new Error('No active connection')

    await window.xapi.patch.applyToHost(connectionId, hostRef, patchRef)
    await get().loadPatches(connectionId)
    await get().loadHostPatchStatus(connectionId)
  },

  applyPatchesBatch: async (patchRefs: string[], connectionIdArg?: string) => {
    const connectionId = getConnectionId(connectionIdArg)
    if (!connectionId) throw new Error('No active connection')

    set({ applyLoading: true, applyError: null })
    try {
      const results = await window.xapi.patch.applyBatch(connectionId, patchRefs)
      set({ applyLoading: false })
      await get().loadPatches(connectionId)
      await get().loadHostPatchStatus(connectionId)
      return results
    } catch (err: any) {
      set({ applyError: err.message, applyLoading: false })
      throw err
    }
  },

  // Cleanup action
  cleanPatch: async (patchRef: string, connectionIdArg?: string) => {
    const connectionId = getConnectionId(connectionIdArg)
    if (!connectionId) throw new Error('No active connection')

    await window.xapi.patch.clean(connectionId, patchRef)
  },

  // Removal actions
  destroyPatch: async (patchRef: string, connectionIdArg?: string) => {
    const connectionId = getConnectionId(connectionIdArg)
    if (!connectionId) throw new Error('No active connection')

    await window.xapi.patch.destroy(connectionId, patchRef)
    await get().loadPatches(connectionId)
  },

  destroyPatchFromHost: async (hostRef: string, patchRef: string, connectionIdArg?: string) => {
    const connectionId = getConnectionId(connectionIdArg)
    if (!connectionId) throw new Error('No active connection')

    await window.xapi.patch.destroyFromHost(connectionId, hostRef, patchRef)
    await get().loadPatches(connectionId)
    await get().loadHostPatchStatus(connectionId)
  },
}))
