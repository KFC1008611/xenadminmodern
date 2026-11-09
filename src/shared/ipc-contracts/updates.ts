import * as Ch from '../channels'
import { defineInvokeContract, type IpcRuntimeSchema } from '../ipc-contract'
import { noArgsSchema, requireBoolean, requireEnum, requireExactKeys, requireNonNegativeNumber, requirePlainObject, requireString, requireTuple } from './runtime-schema'

export interface UpdateState {
  currentVersion: string
  enabled: boolean
  supported: boolean
  status: 'idle' | 'checking' | 'available' | 'current' | 'downloading' | 'downloaded' | 'installing' | 'error'
  version: string | null
  progress: number
  checkedAt: number | null
  message: string
}

const statuses = new Set<UpdateState['status']>(['idle', 'checking', 'available', 'current', 'downloading', 'downloaded', 'installing', 'error'])
export const updateStateSchema: IpcRuntimeSchema<UpdateState> = {
  parse(value) {
    const state = requirePlainObject(value, 'update state')
    requireExactKeys(state, ['currentVersion', 'enabled', 'supported', 'status', 'version', 'progress', 'checkedAt', 'message'], [], 'update state')
    const progress = requireNonNegativeNumber(state.progress, 'update progress')
    if (progress > 100) throw new Error('Invalid update progress')
    return {
      currentVersion: requireString(state.currentVersion, 'current version'),
      enabled: requireBoolean(state.enabled, 'automatic updates'),
      supported: requireBoolean(state.supported, 'update support'),
      status: requireEnum(state.status, statuses, 'update status'),
      version: state.version === null ? null : requireString(state.version, 'update version'),
      progress,
      checkedAt: state.checkedAt === null ? null : requireNonNegativeNumber(state.checkedAt, 'update check time'),
      message: requireString(state.message, 'update message'),
    }
  },
}
const boundary = { callerPolicy: 'app-window-main-frame', redaction: ['none'], errorShape: 'ipc-error-response-v1' } as const
export const updateGetStateContract = defineInvokeContract({ channel: Ch.UPDATE_GET_STATE, argsSchema: noArgsSchema, resultSchema: updateStateSchema, ...boundary })
export const updateSetEnabledContract = defineInvokeContract({
  channel: Ch.UPDATE_SET_ENABLED,
  argsSchema: { parse(value: unknown): [boolean] { const [enabled] = requireTuple(value, 1, 'update preference'); return [requireBoolean(enabled, 'automatic updates')] } },
  resultSchema: updateStateSchema, ...boundary,
})
export const updateCheckContract = defineInvokeContract({ channel: Ch.UPDATE_CHECK, argsSchema: noArgsSchema, resultSchema: updateStateSchema, ...boundary })
export const updateDownloadContract = defineInvokeContract({ channel: Ch.UPDATE_DOWNLOAD, argsSchema: noArgsSchema, resultSchema: updateStateSchema, ...boundary })
export const updateInstallContract = defineInvokeContract({ channel: Ch.UPDATE_INSTALL, argsSchema: noArgsSchema, resultSchema: updateStateSchema, ...boundary })
export const updateContracts = [updateGetStateContract, updateSetEnabledContract, updateCheckContract, updateDownloadContract, updateInstallContract] as const
