import * as Ch from '../channels'
import { defineInvokeContract, type IpcRuntimeSchema } from '../ipc-contract'
import {
  invalid,
  requireArray,
  requireBoolean,
  requireExactKeys,
  requireNonBlankString,
  requireNonNegativeNumber,
  requirePlainObject,
  requireRef,
  requireString,
  requireStringArray,
  requireTuple,
  voidResultSchema,
} from './runtime-schema'

export interface ConnectedPatchRecord {
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

export interface PatchApplyHostResult {
  hostRef: string
  hostName: string
  success: boolean
  error?: string
}

export interface PatchApplyResult {
  patchRef: string
  success: boolean
  hostResults: PatchApplyHostResult[]
}

export interface PatchIncompatibility {
  hostRef: string
  hostName: string
  reason: string
}

export interface PatchCompatibilityInfo {
  patchRef: string
  patchName: string
  compatible: boolean
  incompatibilities: PatchIncompatibility[]
  afterApplyGuides: string[]
}

export interface PatchBatchResult {
  patchRef: string
  result: PatchApplyResult
}

const invokeBoundary = {
  errorShape: 'ipc-error-response-v1' as const,
  callerPolicy: 'app-window-main-frame' as const,
  redaction: ['none'] as const,
}

function connectionId(value: unknown): string {
  return requireNonBlankString(value, 'connection identity')
}

function requireDate(value: unknown, label: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) invalid(label)
  return value
}

function parseRefs(value: unknown, label: string): string[] {
  return requireArray(value, label).map((entry) => requireRef(entry, label))
}

const connectionArgsSchema: IpcRuntimeSchema<[string]> = {
  parse(value: unknown): [string] {
    const [rawConnectionId] = requireTuple(value, 1, 'patch connection arguments')
    return [connectionId(rawConnectionId)]
  },
}

const connectionRefArgsSchema: IpcRuntimeSchema<[string, string]> = {
  parse(value: unknown): [string, string] {
    const [rawConnectionId, patchRef] = requireTuple(value, 2, 'patch reference arguments')
    return [connectionId(rawConnectionId), requireRef(patchRef, 'patch reference')]
  },
}

const connectionHostArgsSchema: IpcRuntimeSchema<[string, string]> = {
  parse(value: unknown): [string, string] {
    const [rawConnectionId, hostRef] = requireTuple(value, 2, 'host patch arguments')
    return [connectionId(rawConnectionId), requireRef(hostRef, 'host reference')]
  },
}

const uploadArgsSchema: IpcRuntimeSchema<[string, string]> = {
  parse(value: unknown): [string, string] {
    const [rawConnectionId, filePath] = requireTuple(value, 2, 'patch upload arguments')
    return [connectionId(rawConnectionId), requireNonBlankString(filePath, 'patch file path')]
  },
}

const hostPatchArgsSchema: IpcRuntimeSchema<[string, string, string]> = {
  parse(value: unknown): [string, string, string] {
    const [rawConnectionId, hostRef, patchRef] = requireTuple(
      value,
      3,
      'host patch mutation arguments',
    )
    return [
      connectionId(rawConnectionId),
      requireRef(hostRef, 'host reference'),
      requireRef(patchRef, 'patch reference'),
    ]
  },
}

const applyBatchArgsSchema: IpcRuntimeSchema<[string, string[]]> = {
  parse(value: unknown): [string, string[]] {
    const [rawConnectionId, patchRefs] = requireTuple(value, 2, 'patch batch arguments')
    return [connectionId(rawConnectionId), parseRefs(patchRefs, 'patch references')]
  },
}

function parsePatchRecord(value: unknown): ConnectedPatchRecord {
  const patch = requirePlainObject(value, 'patch record')
  requireExactKeys(
    patch,
    [
      'ref',
      'uuid',
      'name_label',
      'name_description',
      'size',
      'version',
      'update_url',
      'applied',
      'after_apply_guides',
      'upload_date',
      'connectionId',
      'poolName',
    ],
    ['hosts'],
    'patch record',
  )
  requireRef(patch.ref, 'patch reference')
  requireString(patch.uuid, 'patch UUID')
  requireString(patch.name_label, 'patch name')
  requireString(patch.name_description, 'patch description')
  requireNonNegativeNumber(patch.size, 'patch size')
  requireString(patch.version, 'patch version')
  requireString(patch.update_url, 'patch update URL')
  requireBoolean(patch.applied, 'patch applied state')
  requireStringArray(patch.after_apply_guides, 'patch after-apply guides')
  if (patch.upload_date !== null) requireDate(patch.upload_date, 'patch upload date')
  connectionId(patch.connectionId)
  requireString(patch.poolName, 'patch resource pool name')
  if (patch.hosts !== undefined) parseRefs(patch.hosts, 'patch host references')
  return value as ConnectedPatchRecord
}

const patchListResultSchema: IpcRuntimeSchema<ConnectedPatchRecord[]> = {
  parse(value: unknown): ConnectedPatchRecord[] {
    return requireArray(value, 'patch list').map(parsePatchRecord)
  },
}

const patchRecordResultSchema: IpcRuntimeSchema<ConnectedPatchRecord | null> = {
  parse(value: unknown): ConnectedPatchRecord | null {
    return value === null ? null : parsePatchRecord(value)
  },
}

function parseHostPatchStatus(value: unknown): HostPatchStatus {
  const status = requirePlainObject(value, 'host patch status')
  requireExactKeys(
    status,
    ['hostRef', 'hostName', 'patchRef', 'patchName', 'applied'],
    ['appliedTimestamp'],
    'host patch status',
  )
  requireRef(status.hostRef, 'host reference')
  requireString(status.hostName, 'host name')
  requireRef(status.patchRef, 'patch reference')
  requireString(status.patchName, 'patch name')
  requireBoolean(status.applied, 'host patch applied state')
  if (status.appliedTimestamp !== undefined) {
    requireDate(status.appliedTimestamp, 'host patch applied timestamp')
  }
  return value as HostPatchStatus
}

const hostStatusResultSchema: IpcRuntimeSchema<HostPatchStatus[]> = {
  parse(value: unknown): HostPatchStatus[] {
    return requireArray(value, 'host patch statuses').map(parseHostPatchStatus)
  },
}

const uploadResultSchema: IpcRuntimeSchema<PatchUploadResult> = {
  parse(value: unknown): PatchUploadResult {
    const result = requirePlainObject(value, 'patch upload result')
    requireExactKeys(result, ['patchRef', 'uuid', 'nameLabel'], [], 'patch upload result')
    return {
      patchRef: requireRef(result.patchRef, 'uploaded patch reference'),
      uuid: requireString(result.uuid, 'uploaded patch UUID'),
      nameLabel: requireString(result.nameLabel, 'uploaded patch name'),
    }
  },
}

function parsePatchApplyResult(value: unknown): PatchApplyResult {
  const result = requirePlainObject(value, 'patch apply result')
  requireExactKeys(result, ['patchRef', 'success', 'hostResults'], [], 'patch apply result')
  const hostResults = requireArray(result.hostResults, 'patch host apply results').map((entry) => {
    const hostResult = requirePlainObject(entry, 'patch host apply result')
    requireExactKeys(
      hostResult,
      ['hostRef', 'hostName', 'success'],
      ['error'],
      'patch host apply result',
    )
    const parsed: PatchApplyHostResult = {
      hostRef: requireRef(hostResult.hostRef, 'patch host reference'),
      hostName: requireString(hostResult.hostName, 'patch host name'),
      success: requireBoolean(hostResult.success, 'patch host success state'),
    }
    if (hostResult.error !== undefined) {
      parsed.error = requireString(hostResult.error, 'patch host error')
    }
    return parsed
  })
  return {
    patchRef: requireRef(result.patchRef, 'applied patch reference'),
    success: requireBoolean(result.success, 'patch apply success state'),
    hostResults,
  }
}

const applyResultSchema: IpcRuntimeSchema<PatchApplyResult> = {
  parse: parsePatchApplyResult,
}

const precheckResultSchema: IpcRuntimeSchema<PatchCompatibilityInfo> = {
  parse(value: unknown): PatchCompatibilityInfo {
    const result = requirePlainObject(value, 'patch compatibility result')
    requireExactKeys(
      result,
      ['patchRef', 'patchName', 'compatible', 'incompatibilities', 'afterApplyGuides'],
      [],
      'patch compatibility result',
    )
    const incompatibilities = requireArray(
      result.incompatibilities,
      'patch incompatibilities',
    ).map((entry) => {
      const incompatibility = requirePlainObject(entry, 'patch incompatibility')
      requireExactKeys(
        incompatibility,
        ['hostRef', 'hostName', 'reason'],
        [],
        'patch incompatibility',
      )
      return {
        hostRef: requireRef(incompatibility.hostRef, 'incompatible host reference'),
        hostName: requireString(incompatibility.hostName, 'incompatible host name'),
        reason: requireString(incompatibility.reason, 'patch incompatibility reason'),
      }
    })
    return {
      patchRef: requireRef(result.patchRef, 'prechecked patch reference'),
      patchName: requireString(result.patchName, 'prechecked patch name'),
      compatible: requireBoolean(result.compatible, 'patch compatibility state'),
      incompatibilities,
      afterApplyGuides: requireStringArray(
        result.afterApplyGuides,
        'patch compatibility after-apply guides',
      ),
    }
  },
}

const batchResultSchema: IpcRuntimeSchema<PatchBatchResult[]> = {
  parse(value: unknown): PatchBatchResult[] {
    return requireArray(value, 'patch batch result').map((entry) => {
      const result = requirePlainObject(entry, 'patch batch item result')
      requireExactKeys(result, ['patchRef', 'result'], [], 'patch batch item result')
      return {
        patchRef: requireRef(result.patchRef, 'patch batch item reference'),
        result: parsePatchApplyResult(result.result),
      }
    })
  },
}

export const patchListContract = defineInvokeContract({
  channel: Ch.PATCH_LIST,
  argsSchema: connectionArgsSchema,
  resultSchema: patchListResultSchema,
  ...invokeBoundary,
})

export const patchGetRecordContract = defineInvokeContract({
  channel: Ch.PATCH_GET_RECORD,
  argsSchema: connectionRefArgsSchema,
  resultSchema: patchRecordResultSchema,
  ...invokeBoundary,
})

export const patchGetHostStatusContract = defineInvokeContract({
  channel: Ch.PATCH_GET_HOST_STATUS,
  argsSchema: connectionArgsSchema,
  resultSchema: hostStatusResultSchema,
  ...invokeBoundary,
})

export const patchGetMissingContract = defineInvokeContract({
  channel: Ch.PATCH_GET_MISSING,
  argsSchema: connectionHostArgsSchema,
  resultSchema: patchListResultSchema,
  ...invokeBoundary,
})

export const patchUploadContract = defineInvokeContract({
  channel: Ch.PATCH_UPLOAD,
  argsSchema: uploadArgsSchema,
  resultSchema: uploadResultSchema,
  ...invokeBoundary,
  redaction: ['storage-secret'],
})

export const patchPrecheckContract = defineInvokeContract({
  channel: Ch.PATCH_PRECHECK,
  argsSchema: connectionRefArgsSchema,
  resultSchema: precheckResultSchema,
  ...invokeBoundary,
})

export const patchApplyContract = defineInvokeContract({
  channel: Ch.PATCH_APPLY,
  argsSchema: connectionRefArgsSchema,
  resultSchema: applyResultSchema,
  ...invokeBoundary,
})

export const patchApplyToHostContract = defineInvokeContract({
  channel: Ch.PATCH_APPLY_TO_HOST,
  argsSchema: hostPatchArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const patchCleanContract = defineInvokeContract({
  channel: Ch.PATCH_CLEAN,
  argsSchema: connectionRefArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const patchDestroyContract = defineInvokeContract({
  channel: Ch.PATCH_DESTROY,
  argsSchema: connectionRefArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const patchDestroyFromHostContract = defineInvokeContract({
  channel: Ch.PATCH_DESTROY_FROM_HOST,
  argsSchema: hostPatchArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const patchApplyBatchContract = defineInvokeContract({
  channel: Ch.PATCH_APPLY_BATCH,
  argsSchema: applyBatchArgsSchema,
  resultSchema: batchResultSchema,
  ...invokeBoundary,
})

export const patchGovernanceContracts = Object.freeze([
  patchListContract,
  patchGetRecordContract,
  patchGetHostStatusContract,
  patchGetMissingContract,
  patchUploadContract,
  patchPrecheckContract,
  patchApplyContract,
  patchApplyToHostContract,
  patchCleanContract,
  patchDestroyContract,
  patchDestroyFromHostContract,
  patchApplyBatchContract,
] as const)
