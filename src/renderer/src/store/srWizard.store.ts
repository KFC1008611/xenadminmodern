/**
 * SR Wizard store — manages the state for the Storage Repository creation wizard.
 * v5: 5-step wizard for creating EXT, NFS, iSCSI, or HBA type SRs.
 */
import { create } from 'zustand'
import type { NfsTarget, IscsiTarget, IscsiLun, SrCreateParams } from '../types/xapi'

type SrType = 'ext' | 'nfs' | 'iscsi' | 'hba' | 'iso' | ''

interface SrWizardState {
  currentStep: number // 1-5
  srType: SrType

  // Connection params
  nfsServer: string
  nfsPath: string
  iscsiTarget: string
  iscsiPort: string
  iscsiIqn: string
  iscsiLun: string
  chapUser: string
  chapPassword: string

  // Scan results
  availableNfsTargets: NfsTarget[]
  availableIscsiTargets: IscsiTarget[]
  availableIscsiLuns: IscsiLun[]
  scanning: boolean
  scanCompleted: boolean
  scanError: string | null

  // Naming
  nameLabel: string
  nameDescription: string

  // Submit
  isSubmitting: boolean
  submitError: string | null
  submitBlocked: boolean
  existingSrUuids: string[]
  existingSrUuid: string

  // Actions
  setStep: (step: number) => void
  setSrType: (type: SrType) => void
  setField: (field: string, value: string) => void
  selectIscsiTarget: (target: IscsiTarget) => void
  invalidateDiscovery: () => void
  scanNfs: (connectionId: string, hostRef: string) => Promise<void>
  scanIscsi: (connectionId: string, hostRef: string) => Promise<void>
  scanIscsiLuns: (connectionId: string, hostRef: string) => Promise<void>
  createSr: (connectionId: string, hostRef: string) => Promise<string>
  reset: () => void
}

const INITIAL_STATE = {
  currentStep: 1,
  srType: '' as SrType,

  nfsServer: '',
  nfsPath: '',
  iscsiTarget: '',
  iscsiPort: '3260',
  iscsiIqn: '',
  iscsiLun: '',
  chapUser: '',
  chapPassword: '',

  availableNfsTargets: [],
  availableIscsiTargets: [],
  availableIscsiLuns: [],
  scanning: false,
  scanCompleted: false,
  scanError: null,

  nameLabel: '',
  nameDescription: '',

  isSubmitting: false,
  submitError: null,
  submitBlocked: false,
  existingSrUuids: [] as string[],
  existingSrUuid: '',
}

let scanGeneration = 0

export const useSrWizardStore = create<SrWizardState>((set, get) => ({
  ...INITIAL_STATE,

  setStep: (step: number) => {
    if (step < 1 || step > 5) return
    set({ currentStep: step })
  },

  setSrType: (type: SrType) => {
    scanGeneration++
    set({
      srType: type,
      existingSrUuids: [], existingSrUuid: '',
      // Reset connection params and scan results when SR type changes
      nfsServer: '',
      nfsPath: '',
      iscsiTarget: '',
      iscsiPort: '3260',
      iscsiIqn: '',
      iscsiLun: '',
      chapUser: '',
      chapPassword: '',
      availableNfsTargets: [],
      availableIscsiTargets: [],
      availableIscsiLuns: [],
      scanError: null,
      scanning: false,
      scanCompleted: false,
    })
  },

  setField: (field: string, value: string) => {
    if (['nfsServer', 'nfsPath', 'iscsiTarget', 'iscsiPort', 'iscsiIqn', 'iscsiLun', 'chapUser', 'chapPassword'].includes(field)) {
      set({ existingSrUuids: [], existingSrUuid: '' })
      scanGeneration++
      set({ scanning: false, scanCompleted: false, scanError: null, availableIscsiLuns: [],
        ...(['iscsiTarget', 'iscsiPort'].includes(field) ? { iscsiIqn: '', iscsiLun: '', availableIscsiTargets: [] } : {}),
        ...(field === 'iscsiIqn' ? { iscsiLun: '' } : {}),
        ...(field === 'nfsServer' ? { availableNfsTargets: [] } : {}),
      })
    }
    set({ [field]: value })
  },

  selectIscsiTarget: (target) => {
    scanGeneration++
    set({ existingSrUuids: [], existingSrUuid: '', iscsiTarget: target.address, iscsiPort: String(target.port), iscsiIqn: target.iqn,
      iscsiLun: '', availableIscsiLuns: [], scanning: false, scanCompleted: false, scanError: null })
  },

  invalidateDiscovery: () => {
    scanGeneration++
    set({ availableNfsTargets: [], availableIscsiTargets: [], availableIscsiLuns: [], scanning: false, scanCompleted: false, scanError: null })
  },

  scanNfs: async (connectionId: string, hostRef: string) => {
    const { nfsServer } = get()
    const generation = ++scanGeneration
    set({ scanning: true, scanCompleted: false, scanError: null, availableNfsTargets: [] })

    try {
      const targets = await window.xapi.sr.probeNfs(connectionId, hostRef, nfsServer)
      if (generation !== scanGeneration) return
      set({ availableNfsTargets: targets, scanning: false, scanCompleted: true })
    } catch (e: any) {
      if (generation !== scanGeneration) return
      set({
        scanning: false,
        scanError: e?.message || '扫描 NFS 共享目录失败',
        availableNfsTargets: [],
      })
    }
  },

  scanIscsi: async (connectionId: string, hostRef: string) => {
    const { iscsiTarget, iscsiPort, chapUser, chapPassword } = get()
    const generation = ++scanGeneration
    set({ scanning: true, scanCompleted: false, scanError: null, availableIscsiTargets: [] })

    try {
      const targets = await window.xapi.sr.probeIscsi(connectionId, hostRef, iscsiTarget, { port: Number(iscsiPort), chapUser, chapPassword })
      if (generation !== scanGeneration) return
      set({ availableIscsiTargets: targets, scanning: false, scanCompleted: true })
    } catch (e: any) {
      if (generation !== scanGeneration) return
      set({
        scanning: false,
        scanError: e?.message || '扫描 iSCSI 目标失败',
        availableIscsiTargets: [],
      })
    }
  },

  scanIscsiLuns: async (connectionId: string, hostRef: string) => {
    const { iscsiTarget, iscsiPort, iscsiIqn, chapUser, chapPassword } = get()
    if (!iscsiTarget || !iscsiIqn) return
    const generation = ++scanGeneration
    set({ scanning: true, scanCompleted: false, scanError: null, availableIscsiLuns: [] })
    try {
      const targets = await window.xapi.sr.probeIscsi(connectionId, hostRef, iscsiTarget,
        { iqn: iscsiIqn, port: Number(iscsiPort), chapUser, chapPassword })
      if (generation !== scanGeneration) return
      set({ availableIscsiLuns: targets.flatMap((item) => item.luns ?? []), scanning: false, scanCompleted: true })
    } catch (error: any) {
      if (generation !== scanGeneration) return
      set({ scanning: false, scanError: error.message || '发现 iSCSI LUN 失败' })
    }
  },

  createSr: async (connectionId: string, hostRef: string) => {
    const state = get()
    if (state.isSubmitting) throw new Error('创建请求正在提交，请等待结果')
    if (state.submitBlocked) throw new Error('无法获取上次创建结果，已阻止重复提交')
    set({ isSubmitting: true, submitError: null })

    const params: SrCreateParams = {
      type: state.srType as Exclude<SrType, ''>,
      nameLabel: state.nameLabel,
      nameDescription: state.nameDescription,
    }

    // Populate type-specific fields
    if (state.srType === 'nfs' || state.srType === 'iso') {
      params.nfsServer = state.nfsServer
      params.nfsPath = state.nfsPath
    } else if (state.srType === 'iscsi') {
      if (state.existingSrUuid) params.existingSrUuid = state.existingSrUuid
      params.iscsiTarget = state.iscsiTarget
      params.iscsiPort = Number(state.iscsiPort)
      params.iscsiIqn = state.iscsiIqn
      params.iscsiLun = state.iscsiLun
      if (state.chapUser) {
        params.chapUser = state.chapUser
        params.chapPassword = state.chapPassword
      }
    }

    try {
      const srRef = await window.xapi.sr.create(connectionId, hostRef, params)
      set({ isSubmitting: false })
      return srRef
    } catch (e: any) {
      set({
        isSubmitting: false,
        submitError: e?.message || '创建存储仓库失败',
        submitBlocked: ['SR_CREATE_OUTCOME_UNKNOWN', 'SR_CREATED_INCOMPLETE'].includes(e?.code),
        ...(e?.code === 'SR_ALREADY_EXISTS_ON_DEVICE' && Array.isArray(e?.details?.srUuids)
          ? { existingSrUuids: e.details.srUuids.filter((uuid: unknown) => typeof uuid === 'string' && uuid), existingSrUuid: '' } : {}),
      })
      throw e
    }
  },

  reset: () => {
    scanGeneration++
    set({ ...INITIAL_STATE })
  },
}))
