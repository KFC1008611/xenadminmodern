/**
 * PoolManager store — manages pool join/eject and master transfer operations
 * v6: Manages resource pool management UI state
 */
import { create } from 'zustand'

export interface PoolManagerState {
  // Join dialog state
  joinDialogOpen: boolean
  joinParams: {
    targetHost: string
    username: string
    password: string
    masterAddress: string
    forceJoin: boolean
  }
  joinValidating: boolean
  joinValidationResult: {
    valid: boolean
    version?: string
    compatible?: boolean
    error?: string
  } | null
  joinError: string | null
  joinProgress: number

  // Eject dialog state
  ejectDialogOpen: boolean
  ejectHostRef: string
  ejectHostName: string
  ejectEvacuating: boolean
  ejectProgress: number
  ejectTaskRef: string | null
  ejectError: string | null

  // Transfer dialog state
  transferDialogOpen: boolean
  transferCandidates: Array<{ ref: string; name: string; enabled: boolean }>
  transferring: boolean
  transferProgress: number
  transferError: string | null

  // Actions
  openJoinDialog: () => void
  closeJoinDialog: () => void
  setJoinParam: (key: keyof PoolManagerState['joinParams'], value: string | boolean) => void
  validateJoinHost: (connectionId: string) => Promise<void>
  executeJoin: (connectionId: string) => Promise<string | null>
  openEjectDialog: (hostRef: string, hostName: string) => void
  closeEjectDialog: () => void
  executeEject: (connectionId: string) => Promise<string | null>
  openTransferDialog: (candidates: Array<{ ref: string; name: string; enabled: boolean }>) => void
  closeTransferDialog: () => void
  executeTransfer: (connectionId: string, newMasterRef: string) => Promise<string | null>
  resetJoinState: () => void
  resetEjectState: () => void
  resetTransferState: () => void
}

const initialJoinParams = {
  targetHost: '',
  username: '',
  password: '',
  masterAddress: '',
  forceJoin: false,
}

export const usePoolManagerStore = create<PoolManagerState>((set, get) => ({
  joinDialogOpen: false,
  joinParams: { ...initialJoinParams },
  joinValidating: false,
  joinValidationResult: null,
  joinError: null,
  joinProgress: 0,

  ejectDialogOpen: false,
  ejectHostRef: '',
  ejectHostName: '',
  ejectEvacuating: false,
  ejectProgress: 0,
  ejectTaskRef: null,
  ejectError: null,

  transferDialogOpen: false,
  transferCandidates: [],
  transferring: false,
  transferProgress: 0,
  transferError: null,

  openJoinDialog: () => set({ joinDialogOpen: true, joinError: null }),

  closeJoinDialog: () => set({ joinDialogOpen: false }),

  setJoinParam: (key, value) =>
    set((state) => ({
      joinParams: { ...state.joinParams, [key]: value },
    })),

  validateJoinHost: async (_connectionId: string) => {
    const { joinParams } = get()
    const valid = Boolean(joinParams.targetHost.trim() && joinParams.masterAddress.trim() && joinParams.username.trim() && joinParams.password)
    set({ joinValidating: false, joinError: null,
      joinValidationResult: valid
        ? { valid: true, version: '表单完整；尚未验证连接、版本或加入条件' }
        : { valid: false, error: '请填写目标主机、协调节点地址和登录凭据' } })
  },

  executeJoin: async (connectionId: string): Promise<string | null> => {
    const { joinParams } = get()
    set({ joinProgress: 0, joinError: null })

    try {
      const taskRef = await window.xapi.pool.addHost(connectionId, {
        targetHost: joinParams.targetHost,
        username: joinParams.username,
        password: joinParams.password,
        masterAddress: joinParams.masterAddress,
        forceJoin: joinParams.forceJoin,
      })
      return taskRef
    } catch (e: any) {
      set({ joinError: e?.message || '加入资源池失败' })
      return null
    }
  },

  openEjectDialog: (hostRef: string, hostName: string) =>
    set({
      ejectDialogOpen: true,
      ejectHostRef: hostRef,
      ejectHostName: hostName,
      ejectError: null,
      ejectTaskRef: null,
    }),

  closeEjectDialog: () => set({ ejectDialogOpen: false }),

  executeEject: async (connectionId: string): Promise<string | null> => {
    const { ejectHostRef } = get()
    set({ ejectEvacuating: true, ejectProgress: 0, ejectError: null })

    try {
      const taskRef = await window.xapi.pool.removeHost(connectionId, ejectHostRef)
      set({
        ejectTaskRef: taskRef,
        ejectProgress: 100,
      })
      return taskRef
    } catch (e: any) {
      set({ ejectError: e?.message || '移出资源池失败' })
      return null
    } finally {
      set({ ejectEvacuating: false })
    }
  },

  openTransferDialog: (candidates) =>
    set({
      transferDialogOpen: true,
      transferCandidates: candidates,
      transferError: null,
    }),

  closeTransferDialog: () => set({ transferDialogOpen: false }),

  executeTransfer: async (connectionId: string, newMasterRef: string): Promise<string | null> => {
    set({ transferring: true, transferProgress: 0, transferError: null })

    try {
      const taskRef = await window.xapi.pool.transferMaster(connectionId, newMasterRef)
      set({ transferProgress: 100 })
      return taskRef
    } catch (e: any) {
      set({ transferError: e?.message || '主节点转移失败' })
      return null
    } finally {
      set({ transferring: false })
    }
  },

  resetJoinState: () =>
    set({
      joinParams: { ...initialJoinParams },
      joinValidating: false,
      joinValidationResult: null,
      joinError: null,
      joinProgress: 0,
    }),

  resetEjectState: () =>
    set({
      ejectHostRef: '',
      ejectHostName: '',
      ejectEvacuating: false,
      ejectProgress: 0,
      ejectTaskRef: null,
      ejectError: null,
    }),

  resetTransferState: () =>
    set({
      transferCandidates: [],
      transferring: false,
      transferProgress: 0,
      transferError: null,
    }),
}))
