import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { VmImportOperation, VmImportOperationStatus, VmImportPreview } from '../types/xapi'
import { isTransferTerminal, missingTransferRecordMessage } from '../lib/transferTracking'

export interface ImportHistoryItem {
  connectionId: string
  poolUuid?: string
  name: string
  isTemplate: boolean
  filePath?: string
  operation: VmImportOperation
  recordMissing?: boolean
}

export interface ImportWizardState {
  history: ImportHistoryItem[]
  dialogOpen: boolean
  draftScope: string | null
  newDraft: () => void
  removeRecord: (operationId: string) => void
  markRecordMissing: (operationId: string) => void
  bindScope: (scope: string) => void
  currentStep: number
  filePath: string
  preview: VmImportPreview | null
  targetSrRef: string
  homeServerRef: string
  vifMappings: Record<string, string>
  importing: boolean
  progress: number
  validation?: VmImportOperation['validation']
  transfer?: VmImportOperation['transfer']
  importError: string | null
  operationId: string | null
  operationRecordMissing: boolean
  operationPoolUuid?: string
  operationConnectionId: string | null
  operationStatus: VmImportOperationStatus | null
  operationMessage: string
  vmRef?: string
  warnings: string[]
  setStep: (step: number) => void
  selectFile: (path: string) => void
  loadPreview: () => Promise<void>
  setTargetSr: (ref: string) => void
  setHomeServer: (ref: string) => void
  setVifMappings: (mappings: Record<string, string>) => void
  startImport: (connectionId: string) => Promise<string | null>
  applyOperation: (operation: VmImportOperation) => void
  reset: () => void
}

const initialState = {
  history: [] as ImportHistoryItem[], dialogOpen: false, draftScope: null as string | null,
  currentStep: 1,
  filePath: '',
  preview: null,
  targetSrRef: '',
  homeServerRef: '',
  vifMappings: {},
  importing: false,
  progress: 0,
  validation: undefined,
  transfer: undefined,
  importError: null,
  operationId: null,
  operationRecordMissing: false,
  operationConnectionId: null, operationPoolUuid: undefined,
  operationStatus: null,
  operationMessage: '',
  vmRef: undefined,
  warnings: [],
}

let previewRequest = 0

export const useImportWizardStore = create<ImportWizardState>()(persist((set, get) => ({
  ...initialState,
  newDraft: () => {
    const state = get()
    if (state.importing && !state.operationId) return
    previewRequest++
    set({ ...initialState, history: state.history, dialogOpen: state.dialogOpen })
  },
  removeRecord: (operationId) => {
    const state = get()
    const item = state.history.find((item) => item.operation.operationId === operationId)
    if (!item || !isTransferTerminal(item.operation.status) && !item.recordMissing) return
    const history = state.history.filter((entry) => entry.operation.operationId !== operationId)
    if (state.operationId === operationId) {
      previewRequest++
      set({ ...initialState, history, dialogOpen: state.dialogOpen })
    } else set({ history })
  },
  markRecordMissing: (operationId) => set((state) => {
    const message = missingTransferRecordMessage('import')
    return {
      history: state.history.map((item) => item.operation.operationId === operationId && !isTransferTerminal(item.operation.status)
        ? { ...item, recordMissing: true, operation: { ...item.operation, status: 'unknown' as const, message } } : item),
      ...(state.operationId === operationId && !isTransferTerminal(state.operationStatus)
        ? { operationRecordMissing: true, importing: false, operationStatus: 'unknown' as const, operationMessage: message, importError: null } : {}),
    }
  }),
  bindScope: (scope) => {
    const state = get()
    if (state.operationId || state.importing) return
    if (state.draftScope && state.draftScope !== scope) set({ targetSrRef: '', homeServerRef: '', vifMappings: {}, currentStep: Math.min(state.currentStep, 2), importError: '资源池连接已变化，请重新选择存储与网络' })
    set({ draftScope: scope })
  },
  setStep: (currentStep) => set({ currentStep }),
  selectFile: (filePath) => {
    if (filePath && !filePath.toLowerCase().endsWith('.xva')) {
      set({ filePath: '', preview: null, importError: '仅支持未压缩的 .xva 文件' })
      return
    }
    set({ filePath, preview: null, importError: null, vifMappings: {} })
    if (filePath) void get().loadPreview()
  },
  loadPreview: async () => {
    const request = ++previewRequest
    const requestedPath = get().filePath
    if (!requestedPath) return
    try {
      const preview = await window.xapi.vm.importGetPreview(requestedPath)
      if (request !== previewRequest || get().filePath !== requestedPath) return
      set({ preview })
    } catch (error: any) {
      if (request !== previewRequest || get().filePath !== requestedPath) return
      set({ preview: null, importError: error?.message || '无法加载 XVA 预览' })
    }
  },
  setTargetSr: (targetSrRef) => set({ targetSrRef }),
  setHomeServer: (homeServerRef) => set({ homeServerRef }),
  setVifMappings: (vifMappings) => set({ vifMappings }),
  startImport: async (connectionId) => {
    const state = get()
    if (state.importing || state.operationId || state.operationStatus === 'unknown') return null
    if (!state.filePath.toLowerCase().endsWith('.xva')) {
      set({ importError: '仅支持未压缩的 .xva 文件' })
      return null
    }
    if (!state.targetSrRef) {
      set({ importError: '请选择目标存储' })
      return null
    }
    if (!state.preview || state.preview.vifs.some((vif) => !state.vifMappings[vif.device])) {
      set({ importError: '请为每块虚拟接口选择目标网络' })
      return null
    }
    set({ importing: true, progress: 0, importError: null, operationStatus: 'pending', operationMessage: '准备导入 XVA' })
    try {
      const scope: { connectionId?: string; poolUuid?: string; epoch?: number } = state.draftScope ? JSON.parse(state.draftScope) : {}
      if (scope.connectionId && scope.connectionId !== connectionId) throw new Error('导入草稿属于其他资源池，请重新选择目标')
      const operationId = await window.xapi.vm.import(connectionId, {
        ...(scope.poolUuid ? { originPoolUuid: scope.poolUuid } : {}),
        ...(scope.epoch !== undefined ? { originEpoch: scope.epoch } : {}),
        filePath: state.filePath,
        srRef: state.targetSrRef,
        vifMappings: Object.fromEntries(Object.entries(state.vifMappings).filter(([, ref]) => !!ref)),
        homeServerRef: state.homeServerRef || null,
      })
      const operation: VmImportOperation = { operationId, taskRef: null, status: 'pending', progress: 0, message: '准备导入 XVA', lastUpdatedAt: Date.now() }
      set({ operationId, operationConnectionId: connectionId, operationPoolUuid: scope.poolUuid,
        history: [...get().history, { connectionId, poolUuid: scope.poolUuid, filePath: state.filePath, name: state.preview!.vmName, isTemplate: state.preview!.isTemplate, operation }] })
      return operationId
    } catch (error: any) {
      set({ importing: false, operationStatus: 'failed', importError: error?.message || '导入失败' })
      return null
    }
  },
  applyOperation: (operation) => set((state) => {
    const existing = state.history.find((item) => item.operation.operationId === operation.operationId)
    if (existing?.recordMissing && !isTransferTerminal(operation.status)
      || isTransferTerminal(existing?.operation.status) && operation.status !== existing?.operation.status
      || state.operationId === operation.operationId && isTransferTerminal(state.operationStatus) && operation.status !== state.operationStatus) return state
    return {
      history: state.history.map((item) => item.operation.operationId === operation.operationId
        ? { ...item, recordMissing: false, connectionId: operation.connectionId ?? item.connectionId, poolUuid: operation.poolUuid ?? item.poolUuid, operation } : item),
      ...(state.operationId !== operation.operationId ? {} : {
        operationId: operation.operationId,
        operationRecordMissing: false,
        operationPoolUuid: operation.poolUuid ?? state.operationPoolUuid,
        operationConnectionId: operation.connectionId ?? state.operationConnectionId,
        operationStatus: operation.status,
        operationMessage: operation.message,
        progress: operation.progress,
        validation: operation.validation,
        transfer: operation.transfer,
        importing: !['completed', 'failed', 'cancelled', 'unknown'].includes(operation.status),
        importError: operation.status === 'failed' ? operation.message : null,
        vmRef: operation.vmRef,
        warnings: operation.warnings ?? [],
      }),
    }
  }),
  reset: () => { previewRequest++; set(initialState) },
}), {
  name: 'xenadmin-import-operation',
  partialize: (state) => Object.fromEntries(Object.entries(state).filter(([key, value]) => typeof value !== 'function' && !['dialogOpen', 'importing'].includes(key))),
  merge: (persisted, current) => {
    const saved = persisted as Partial<ImportWizardState>
    if (saved.operationId && !saved.history?.some((item) => item.operation.operationId === saved.operationId)) saved.history = [...(saved.history ?? []), { connectionId: saved.operationConnectionId ?? '', poolUuid: saved.operationPoolUuid, filePath: saved.filePath, recordMissing: saved.operationRecordMissing, name: saved.preview?.vmName ?? 'XVA 导入', isTemplate: saved.preview?.isTemplate ?? false, operation: { operationId: saved.operationId, taskRef: null, status: saved.operationStatus ?? 'unknown', message: saved.operationMessage ?? '', progress: saved.progress ?? 0, vmRef: saved.vmRef, warnings: saved.warnings, lastUpdatedAt: Date.now() } }]
    const history = (saved.history ?? []).map((item) => isTransferTerminal(item.operation.status) ? item : { ...item, operation: { ...item.operation, status: 'unknown' as const } })
    const releaseDraft = Boolean(saved.operationId && (isTransferTerminal(saved.operationStatus) || saved.operationRecordMissing))
    return { ...current, ...saved, ...(releaseDraft ? initialState : {}), dialogOpen: false, history,
      ...(saved.operationId && !releaseDraft
        ? { importing: false, operationStatus: 'unknown' as const, operationMessage: '等待重新连接资源池核对原导入任务', currentStep: 4 }
        : { importing: false }) }
  },
}))
