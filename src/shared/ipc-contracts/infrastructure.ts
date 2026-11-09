import { parseVmPowerIntent } from './vm-power-intent'
import { batchOperationBlockReason, batchTargetIdentityReason } from '../batch-policy'
import * as Ch from '../channels'
import {
  defineInvokeContract,
  definePushContract,
  type IpcRuntimeSchema,
} from '../ipc-contract'
import type {
  BatchItemStatus,
  BatchOperationInput,
  BatchOperationResult,
  BatchOperationType,
  BatchProgressEvent,
  BatchSubmitResult,
  BatchRetryConfirmation,
  BatchTask,
  BatchTaskItem,
  BatchTaskOptions,
  BatchTaskProgress,
  BatchTaskStatus,
  BatchTaskTarget,
  BatchTaskWithItems,
  ConnectedPoolRecord,
  ConnectedTaskRecord,
  ConnectionProfile,
  ConsoleProxySession,
  OpenDialogOptions,
  OpenDialogProperty,
  OpenDialogResult,
  PoolJoinParams,
  PoolTaskRef,
  SaveDialogOptions,
  SaveDialogResult,
  TaskCancellationResult,
  VmConsoleRecord,
} from '../types/xapi'
import {
  hasOwn,
  identifierArgsSchema,
  invalid,
  noArgsSchema,
  requireArray,
  requireBoolean,
  requireEnum,
  requireExactKeys,
  requireFiniteNumber,
  requireNonBlankString,
  requirePlainObject,
  requirePositiveInteger,
  requireRef,
  requireString,
  requireStringArray,
  requireTuple,
  voidResultSchema,
} from './runtime-schema'

const TASK_STATUSES = new Set<ConnectedTaskRecord['status']>([
  'pending',
  'success',
  'failure',
  'cancelling',
  'cancelled',
])
const BATCH_OPERATION_TYPES = new Set<BatchOperationType>([
  'start',
  'stop',
  'reboot',
  'migrate',
  'delete',
  'suspend',
  'resume',
  'snapshot',
  'pause',
  'unpause',
])
const BATCH_TASK_STATUSES = new Set<BatchTaskStatus>([
  'pending',
  'running',
  'completed',
  'cancelled',
  'cancel-requested',
  'unknown',
])
const BATCH_ITEM_STATUSES = new Set<BatchItemStatus>([
  'pending',
  'running',
  'completed',
  'failed',
  'skipped',
  'cancelled',
  'unknown',
])
const BATCH_PROGRESS_STATUSES = new Set<BatchProgressEvent['status']>([
  'running',
  'completed',
  'cancelled',
  'cancel-requested',
  'unknown',
])
const OPEN_DIALOG_PROPERTIES = new Set<OpenDialogProperty>([
  'openFile',
  'openDirectory',
  'multiSelections',
  'showHiddenFiles',
  'createDirectory',
  'promptToCreate',
  'noResolveAliases',
  'treatPackageAsDirectory',
  'dontAddToRecent',
])

const invokeBoundary = {
  errorShape: 'ipc-error-response-v1' as const,
  callerPolicy: 'app-window-main-frame' as const,
}

function connectionId(value: unknown): string {
  return requireNonBlankString(value, 'connection identity')
}

function optionalString(value: unknown, label: string): void {
  if (value !== undefined) requireString(value, label)
}

function optionalBoolean(value: unknown, label: string): void {
  if (value !== undefined) requireBoolean(value, label)
}

function optionalNonNegativeNumber(value: unknown, label: string): void {
  if (value === undefined) return
  const result = requireFiniteNumber(value, label)
  if (result < 0) invalid(label)
}

function requireNonNegativeInteger(value: unknown, label: string): number {
  const result = requireFiniteNumber(value, label)
  if (!Number.isInteger(result) || result < 0) invalid(label)
  return result
}

const connectionIdArgsSchema: IpcRuntimeSchema<[string]> = {
  parse(value: unknown): [string] {
    const [rawConnectionId] = requireTuple(value, 1, 'connection arguments')
    return [connectionId(rawConnectionId)]
  },
}

const connectionAndRefArgsSchema: IpcRuntimeSchema<[string, string]> = {
  parse(value: unknown): [string, string] {
    const [rawConnectionId, ref] = requireTuple(value, 2, 'connection reference arguments')
    return [connectionId(rawConnectionId), requireRef(ref, 'XAPI reference')]
  },
}

function parsePoolRecord(value: unknown): ConnectedPoolRecord {
  const record = requirePlainObject(value, 'resource pool result')
  for (const key of [
    'ref',
    'uuid',
    'name_label',
    'name_description',
    'master',
    'default_SR',
    'connectionId',
  ]) {
    if (!hasOwn(record, key)) invalid('resource pool result')
  }
  requireRef(record.ref, 'resource pool reference')
  requireNonBlankString(record.uuid, 'resource pool UUID')
  requireString(record.name_label, 'resource pool name')
  requireString(record.name_description, 'resource pool description')
  requireRef(record.master, 'resource pool master reference')
  requireNonBlankString(record.default_SR, 'resource pool default SR reference')
  connectionId(record.connectionId)
  if (!hasOwn(record, 'ha_enabled')) invalid('resource pool HA state')
  requireBoolean(record.ha_enabled, 'resource pool HA state')
  return value as ConnectedPoolRecord
}

const poolGetResultSchema: IpcRuntimeSchema<ConnectedPoolRecord | null> = {
  parse(value: unknown): ConnectedPoolRecord | null {
    return value === null ? null : parsePoolRecord(value)
  },
}

function parsePoolJoinParams(value: unknown): PoolJoinParams {
  const params = requirePlainObject(value, 'resource pool join parameters')
  requireExactKeys(
    params,
    ['targetHost', 'username', 'password', 'masterAddress'],
    ['forceJoin'],
    'resource pool join parameters',
  )
  requireNonBlankString(params.targetHost, 'resource pool target host')
  requireNonBlankString(params.username, 'resource pool join username')
  requireNonBlankString(params.password, 'resource pool join password')
  requireNonBlankString(params.masterAddress, 'resource pool master address')
  optionalBoolean(params.forceJoin, 'resource pool force-join flag')
  return value as PoolJoinParams
}

const poolAddHostArgsSchema: IpcRuntimeSchema<[string, PoolJoinParams]> = {
  parse(value: unknown): [string, PoolJoinParams] {
    const [rawConnectionId, params] = requireTuple(value, 2, 'resource pool add-host arguments')
    return [connectionId(rawConnectionId), parsePoolJoinParams(params)]
  },
}

const poolTaskRefResultSchema: IpcRuntimeSchema<PoolTaskRef> = {
  parse(value: unknown): PoolTaskRef {
    return requireRef(value, 'resource pool task reference')
  },
}

function parseTaskRecord(value: unknown): ConnectedTaskRecord {
  const record = requirePlainObject(value, 'resource pool task result')
  for (const key of [
    'ref',
    'uuid',
    'name_label',
    'name_description',
    'status',
    'progress',
    'created',
    'finished',
    'error_info',
    'connectionId',
    'poolName',
  ]) {
    if (!hasOwn(record, key)) invalid('resource pool task result')
  }
  requireRef(record.ref, 'resource pool task reference')
  requireNonBlankString(record.uuid, 'resource pool task UUID')
  requireString(record.name_label, 'resource pool task name')
  requireString(record.name_description, 'resource pool task description')
  requireEnum(record.status, TASK_STATUSES, 'resource pool task status')
  const progress = requireFiniteNumber(record.progress, 'resource pool task progress')
  if (progress < 0 || progress > 1) invalid('resource pool task progress')
  requireString(record.created, 'resource pool task creation timestamp')
  requireString(record.finished, 'resource pool task completion timestamp')
  requireStringArray(record.error_info, 'resource pool task errors')
  connectionId(record.connectionId)
  requireString(record.poolName, 'resource pool task pool name')
  return value as ConnectedTaskRecord
}

const taskListResultSchema: IpcRuntimeSchema<ConnectedTaskRecord[]> = {
  parse(value: unknown): ConnectedTaskRecord[] {
    return requireArray(value, 'resource pool task list').map(parseTaskRecord)
  },
}

function parseConnectionProfile(value: unknown): ConnectionProfile {
  const profile = requirePlainObject(value, 'saved server profile')
  requireExactKeys(
    profile,
    ['id', 'name', 'host', 'port', 'scheme', 'username', 'lastConnected'],
    ['autoConnect', 'allowSelfSigned'],
    'saved server profile',
  )
  requireNonBlankString(profile.id, 'saved server profile identity')
  requireNonBlankString(profile.name, 'saved server profile name')
  requireNonBlankString(profile.host, 'saved server profile host')
  const port = requirePositiveInteger(profile.port, 'saved server profile port')
  if (port > 65_535) invalid('saved server profile port')
  if (profile.scheme !== 'http:' && profile.scheme !== 'https:') {
    invalid('saved server profile scheme')
  }
  requireNonBlankString(profile.username, 'saved server profile username')
  if (profile.lastConnected !== null) {
    requireString(profile.lastConnected, 'saved server last-connected timestamp')
  }
  optionalBoolean(profile.autoConnect, 'saved server auto-connect flag')
  optionalBoolean(profile.allowSelfSigned, 'saved server TLS policy')
  return value as ConnectionProfile
}

const profileListResultSchema: IpcRuntimeSchema<ConnectionProfile[]> = {
  parse(value: unknown): ConnectionProfile[] {
    return requireArray(value, 'saved server profile list').map(parseConnectionProfile)
  },
}

const profileSaveArgsSchema: IpcRuntimeSchema<[ConnectionProfile, string | null]> = {
  parse(value: unknown): [ConnectionProfile, string | null] {
    const [profile, password] = requireTuple(value, 2, 'saved server save arguments')
    return [parseConnectionProfile(profile), password === null ? null : requireString(password, 'saved server password')]
  },
}

function parseVmConsoleRecord(value: unknown): VmConsoleRecord {
  const record = requirePlainObject(value, 'VM console record')
  for (const key of ['ref', 'location', 'protocol']) {
    if (!hasOwn(record, key)) invalid('VM console record')
  }
  requireRef(record.ref, 'VM console reference')
  requireNonBlankString(record.location, 'VM console location')
  requireNonBlankString(record.protocol, 'VM console protocol')
  return value as VmConsoleRecord
}

const vmConsoleResultSchema: IpcRuntimeSchema<VmConsoleRecord[]> = {
  parse(value: unknown): VmConsoleRecord[] {
    return requireArray(value, 'VM console list').map(parseVmConsoleRecord)
  },
}

const consoleProxySessionResultSchema: IpcRuntimeSchema<ConsoleProxySession> = {
  parse(value: unknown): ConsoleProxySession {
    const session = requirePlainObject(value, 'console proxy session')
    requireExactKeys(session, ['wsUrl', 'sessionId'], [], 'console proxy session')
    return {
      wsUrl: requireNonBlankString(session.wsUrl, 'console proxy URL'),
      sessionId: requireNonBlankString(session.sessionId, 'console proxy session identity'),
    }
  },
}

function parseDialogFilters(value: unknown): void {
  for (const rawFilter of requireArray(value, 'file dialog filters')) {
    const filter = requirePlainObject(rawFilter, 'file dialog filter')
    requireExactKeys(filter, ['name', 'extensions'], [], 'file dialog filter')
    requireNonBlankString(filter.name, 'file dialog filter name')
    requireStringArray(filter.extensions, 'file dialog filter extensions')
  }
}

function parseOpenDialogOptions(value: unknown): OpenDialogOptions {
  const options = requirePlainObject(value, 'open dialog options')
  requireExactKeys(
    options,
    [],
    ['title', 'defaultPath', 'properties', 'filters'],
    'open dialog options',
  )
  optionalString(options.title, 'open dialog title')
  optionalString(options.defaultPath, 'open dialog default path')
  if (options.properties !== undefined) {
    for (const property of requireArray(options.properties, 'open dialog properties')) {
      requireEnum(property, OPEN_DIALOG_PROPERTIES, 'open dialog property')
    }
  }
  if (options.filters !== undefined) parseDialogFilters(options.filters)
  return value as OpenDialogOptions
}

function parseSaveDialogOptions(value: unknown): SaveDialogOptions {
  const options = requirePlainObject(value, 'save dialog options')
  requireExactKeys(options, [], ['title', 'defaultPath', 'filters'], 'save dialog options')
  optionalString(options.title, 'save dialog title')
  optionalString(options.defaultPath, 'save dialog default path')
  if (options.filters !== undefined) parseDialogFilters(options.filters)
  return value as SaveDialogOptions
}

function optionalDialogArgs<T>(
  value: unknown,
  label: string,
  parse: (candidate: unknown) => T,
): [T | undefined] {
  const tuple = requireTuple(value, 0, label, 1)
  if (tuple[0] === undefined) return [undefined]
  return [parse(tuple[0])]
}

const openDialogArgsSchema: IpcRuntimeSchema<[OpenDialogOptions?]> = {
  parse(value: unknown): [OpenDialogOptions?] {
    return optionalDialogArgs(value, 'open dialog arguments', parseOpenDialogOptions)
  },
}

const saveDialogArgsSchema: IpcRuntimeSchema<[SaveDialogOptions?]> = {
  parse(value: unknown): [SaveDialogOptions?] {
    return optionalDialogArgs(value, 'save dialog arguments', parseSaveDialogOptions)
  },
}

const openDialogResultSchema: IpcRuntimeSchema<OpenDialogResult> = {
  parse(value: unknown): OpenDialogResult {
    const result = requirePlainObject(value, 'open dialog result')
    requireExactKeys(result, ['canceled', 'filePaths'], ['bookmarks'], 'open dialog result')
    requireBoolean(result.canceled, 'open dialog canceled state')
    requireStringArray(result.filePaths, 'open dialog file paths')
    if (result.bookmarks !== undefined) requireStringArray(result.bookmarks, 'open dialog bookmarks')
    return value as OpenDialogResult
  },
}

const saveDialogResultSchema: IpcRuntimeSchema<SaveDialogResult> = {
  parse(value: unknown): SaveDialogResult {
    const result = requirePlainObject(value, 'save dialog result')
    requireExactKeys(result, ['canceled', 'filePath'], ['bookmark'], 'save dialog result')
    requireBoolean(result.canceled, 'save dialog canceled state')
    requireString(result.filePath, 'save dialog file path')
    optionalString(result.bookmark, 'save dialog bookmark')
    return value as SaveDialogResult
  },
}

function parseBatchTarget(value: unknown): BatchTaskTarget {
  const target = requirePlainObject(value, 'batch task target')
  requireExactKeys(target, ['connectionId', 'vmRef', 'vmName'], ['intent'], 'batch task target')
  connectionId(target.connectionId)
  requireRef(target.vmRef, 'batch task VM reference')
  requireString(target.vmName, 'batch task VM name')
  if (target.intent !== undefined) parseVmPowerIntent(target.intent)
  return value as BatchTaskTarget
}

function parseBatchTargets(value: unknown): BatchTaskTarget[] {
  const targets = requireArray(value, 'batch task targets')
  if (targets.length === 0) invalid('batch task targets')
  return targets.map(parseBatchTarget)
}

function parseBatchOptions(
  value: unknown,
  operationType?: BatchOperationType,
): BatchTaskOptions {
  const options = requirePlainObject(value, 'batch task options')
  requireExactKeys(options, [], ['force', 'targetHostRef', 'snapshotName', 'deleteDisks'], 'batch task options')
  optionalBoolean(options.force, 'batch task force flag')
  optionalBoolean(options.deleteDisks, 'batch delete disks flag')
  if (options.deleteDisks !== undefined && operationType !== 'delete') invalid('batch task options')
  if (options.targetHostRef !== undefined) {
    requireRef(options.targetHostRef, 'batch task target host reference')
  }
  if (options.snapshotName !== undefined) {
    requireNonBlankString(options.snapshotName, 'batch snapshot name')
    if (operationType !== 'snapshot') invalid('batch task options')
  }
  if (operationType === 'migrate') {
    if (options.targetHostRef === undefined || options.force !== undefined) {
      invalid('batch migrate options')
    }
  } else {
    if (options.targetHostRef !== undefined) invalid('batch task options')
    if (operationType !== 'stop' && options.force !== undefined) invalid('batch task options')
  }
  return value as BatchTaskOptions
}

function parseBatchOperationInput(value: unknown): BatchOperationInput {
  const input = requirePlainObject(value, 'batch operation input')
  requireExactKeys(input, ['requestId', 'type', 'targets'], ['options'], 'batch operation input')
  requireNonBlankString(input.requestId, 'batch request identity')
  const type = requireEnum(input.type, BATCH_OPERATION_TYPES, 'batch operation type')
  parseBatchTargets(input.targets)
  if (type === 'migrate' && input.options === undefined) invalid('batch migrate options')
  if (input.options !== undefined) parseBatchOptions(input.options, type)
  const reason = batchOperationBlockReason(type, input.options as BatchTaskOptions | undefined)
  if (reason) throw new Error(reason)
  for (const target of input.targets as BatchTaskTarget[]) {
    const identityReason = batchTargetIdentityReason(target)
    if (identityReason) throw new Error(identityReason)
  }
  return value as BatchOperationInput
}

const batchSubmitArgsSchema: IpcRuntimeSchema<[BatchOperationInput]> = {
  parse(value: unknown): [BatchOperationInput] {
    const [input] = requireTuple(value, 1, 'batch submit arguments')
    return [parseBatchOperationInput(input)]
  },
}

function parseBatchProgress(value: unknown): BatchTaskProgress {
  const progress = requirePlainObject(value, 'batch task progress')
  requireExactKeys(
    progress,
    ['total', 'completed', 'failed'],
    ['currentItem', 'unknown', 'cancelled'],
    'batch task progress',
  )
  const total = requireNonNegativeInteger(progress.total, 'batch task total count')
  const completed = requireNonNegativeInteger(progress.completed, 'batch task completed count')
  const failed = requireNonNegativeInteger(progress.failed, 'batch task failed count')
  const unknown = progress.unknown === undefined ? 0 : requireNonNegativeInteger(progress.unknown, 'batch task unknown count')
  const cancelled = progress.cancelled === undefined ? 0 : requireNonNegativeInteger(progress.cancelled, 'batch task cancelled count')
  if (completed > total || failed + unknown + cancelled > completed) invalid('batch task progress')
  optionalString(progress.currentItem, 'batch task current item')
  return value as BatchTaskProgress
}

function parseBatchTask(value: unknown): BatchTask {
  const task = requirePlainObject(value, 'batch task')
  requireExactKeys(
    task,
    ['id', 'type', 'targets', 'status', 'progress', 'createdAt'],
    ['options', 'startedAt', 'completedAt', 'requestId', 'retryRequestIds'],
    'batch task',
  )
  requireNonBlankString(task.id, 'batch task identity')
  if (task.requestId !== undefined) requireNonBlankString(task.requestId, 'batch request identity')
  if (task.retryRequestIds !== undefined) requireArray(task.retryRequestIds, 'batch retry identities').forEach((id) => requireNonBlankString(id, 'batch retry identity'))
  const type = requireEnum(task.type, BATCH_OPERATION_TYPES, 'batch operation type')
  parseBatchTargets(task.targets)
  if (type === 'migrate' && task.options === undefined) invalid('batch migrate options')
  if (task.options !== undefined) parseBatchOptions(task.options, type)
  requireEnum(task.status, BATCH_TASK_STATUSES, 'batch task status')
  parseBatchProgress(task.progress)
  optionalNonNegativeNumber(task.startedAt, 'batch task start timestamp')
  optionalNonNegativeNumber(task.completedAt, 'batch task completion timestamp')
  const createdAt = requireFiniteNumber(task.createdAt, 'batch task creation timestamp')
  if (createdAt < 0) invalid('batch task creation timestamp')
  return value as BatchTask
}

function parseBatchTaskItem(value: unknown): BatchTaskItem {
  const item = requirePlainObject(value, 'batch task item')
  requireExactKeys(
    item,
    ['id', 'taskId', 'connectionId', 'vmRef', 'vmName', 'status', 'retryCount'],
    ['error', 'startedAt', 'completedAt', 'intent'],
    'batch task item',
  )
  requireNonBlankString(item.id, 'batch task item identity')
  requireNonBlankString(item.taskId, 'batch task identity')
  connectionId(item.connectionId)
  requireRef(item.vmRef, 'batch task item VM reference')
  requireString(item.vmName, 'batch task item VM name')
  if (item.intent !== undefined) parseVmPowerIntent(item.intent)
  requireEnum(item.status, BATCH_ITEM_STATUSES, 'batch task item status')
  requireNonNegativeInteger(item.retryCount, 'batch task item retry count')
  optionalString(item.error, 'batch task item error')
  optionalNonNegativeNumber(item.startedAt, 'batch task item start timestamp')
  optionalNonNegativeNumber(item.completedAt, 'batch task item completion timestamp')
  return value as BatchTaskItem
}

const batchTaskListResultSchema: IpcRuntimeSchema<BatchTask[]> = {
  parse(value: unknown): BatchTask[] {
    return requireArray(value, 'batch task list').map(parseBatchTask)
  },
}

const batchTaskStatusResultSchema: IpcRuntimeSchema<BatchTaskWithItems> = {
  parse(value: unknown): BatchTaskWithItems {
    const task = requirePlainObject(value, 'batch task status')
    requireExactKeys(
      task,
      ['id', 'type', 'targets', 'status', 'progress', 'createdAt', 'items'],
      ['options', 'startedAt', 'completedAt', 'requestId', 'retryRequestIds'],
      'batch task status',
    )
    const { items: _items, ...baseTask } = task
    parseBatchTask(baseTask)
    requireArray(task.items, 'batch task items').forEach(parseBatchTaskItem)
    return value as BatchTaskWithItems
  },
}

const batchSubmitResultSchema: IpcRuntimeSchema<BatchSubmitResult> = {
  parse(value: unknown): BatchSubmitResult {
    const result = requirePlainObject(value, 'batch submit result')
    requireExactKeys(result, ['taskId'], [], 'batch submit result')
    return { taskId: requireNonBlankString(result.taskId, 'batch task identity') }
  },
}

function parseBatchOperationResult(value: unknown): BatchOperationResult {
  const result = requirePlainObject(value, 'batch operation result')
  requireExactKeys(result, ['vmRef', 'vmName', 'success'], ['error', 'connectionId', 'status'], 'batch operation result')
  requireRef(result.vmRef, 'batch operation VM reference')
  requireString(result.vmName, 'batch operation VM name')
  requireBoolean(result.success, 'batch operation success state')
  if (result.connectionId !== undefined) connectionId(result.connectionId)
  if (result.status !== undefined) requireEnum(result.status, BATCH_ITEM_STATUSES, 'batch operation result status')
  optionalString(result.error, 'batch operation error')
  return value as BatchOperationResult
}

function parseBatchProgressEvent(value: unknown): BatchProgressEvent {
  const event = requirePlainObject(value, 'batch progress event')
  requireExactKeys(
    event,
    ['taskId', 'status', 'progress'],
    ['currentResult'],
    'batch progress event',
  )
  requireNonBlankString(event.taskId, 'batch task identity')
  requireEnum(event.status, BATCH_PROGRESS_STATUSES, 'batch progress status')
  parseBatchProgress(event.progress)
  if (event.currentResult !== undefined) parseBatchOperationResult(event.currentResult)
  return value as BatchProgressEvent
}

const batchProgressArgsSchema: IpcRuntimeSchema<[BatchProgressEvent]> = {
  parse(value: unknown): [BatchProgressEvent] {
    const [event] = requireTuple(value, 1, 'batch progress arguments')
    return [parseBatchProgressEvent(event)]
  },
}

export const poolGetContract = defineInvokeContract({
  channel: Ch.POOL_GET,
  argsSchema: connectionIdArgsSchema,
  resultSchema: poolGetResultSchema,
  ...invokeBoundary,
  redaction: ['none'],
})

export const poolAddHostContract = defineInvokeContract({
  channel: Ch.POOL_ADD_HOST,
  argsSchema: poolAddHostArgsSchema,
  resultSchema: poolTaskRefResultSchema,
  ...invokeBoundary,
  redaction: ['credentials'],
})

export const poolRemoveHostContract = defineInvokeContract({
  channel: Ch.POOL_REMOVE_HOST,
  argsSchema: connectionAndRefArgsSchema,
  resultSchema: poolTaskRefResultSchema,
  ...invokeBoundary,
  redaction: ['none'],
})

export const poolTransferMasterContract = defineInvokeContract({
  channel: Ch.POOL_TRANSFER_MASTER,
  argsSchema: connectionAndRefArgsSchema,
  resultSchema: poolTaskRefResultSchema,
  ...invokeBoundary,
  redaction: ['none'],
})

export const taskListContract = defineInvokeContract({
  channel: Ch.TASK_LIST,
  argsSchema: connectionIdArgsSchema,
  resultSchema: taskListResultSchema,
  ...invokeBoundary,
  redaction: ['none'],
})

export const taskCancelContract = defineInvokeContract({
  channel: Ch.TASK_CANCEL,
  argsSchema: connectionAndRefArgsSchema,
  resultSchema: {
    parse(value: unknown): TaskCancellationResult {
      const result = requirePlainObject(value, 'task cancellation result')
      return {
        status: requireEnum(result.status, new Set<TaskCancellationResult['status']>(['success', 'failure', 'cancelled']), 'task cancellation status'),
        message: requireString(result.message, 'task cancellation message'),
      }
    },
  },
  ...invokeBoundary,
  redaction: ['none'],
})

export const profileListContract = defineInvokeContract({
  channel: Ch.PROFILE_LIST,
  argsSchema: noArgsSchema,
  resultSchema: profileListResultSchema,
  ...invokeBoundary,
  redaction: ['none'],
})

export const profileSaveContract = defineInvokeContract({
  channel: Ch.PROFILE_SAVE,
  argsSchema: profileSaveArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
  redaction: ['credentials'],
})

export const profileDeleteContract = defineInvokeContract({
  channel: Ch.PROFILE_DELETE,
  argsSchema: identifierArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
  redaction: ['none'],
})

export const profileHasPasswordContract = defineInvokeContract({
  channel: Ch.PROFILE_HAS_PASSWORD,
  argsSchema: identifierArgsSchema,
  resultSchema: { parse: (value: unknown) => requireBoolean(value, 'saved password availability') },
  ...invokeBoundary,
  redaction: ['none'],
})

export const profileConnectContract = defineInvokeContract({
  channel: Ch.PROFILE_CONNECT,
  argsSchema: {
    parse(value: unknown): [string, string?] {
      const args = requireArray(value, 'saved connection arguments')
      if (args.length < 1 || args.length > 2) invalid('saved connection arguments')
      const id = requireNonBlankString(args[0], 'saved server identity')
      return args.length === 1 || args[1] === undefined
        ? [id]
        : [id, requireNonBlankString(args[1], 'connection password')]
    },
  },
  resultSchema: { parse(value: unknown): { id: string } {
    const record = requirePlainObject(value, 'saved connection result')
    requireExactKeys(record, ['id'], [], 'saved connection result')
    return { id: requireNonBlankString(record.id, 'connection identity') }
  } },
  ...invokeBoundary,
  redaction: ['credentials'],
})

export const vmConsoleContract = defineInvokeContract({
  channel: Ch.VM_CONSOLE,
  argsSchema: connectionAndRefArgsSchema,
  resultSchema: vmConsoleResultSchema,
  ...invokeBoundary,
  redaction: ['none'],
})

export const consoleGetUrlContract = defineInvokeContract({
  channel: Ch.CONSOLE_GET_URL,
  argsSchema: connectionAndRefArgsSchema,
  resultSchema: consoleProxySessionResultSchema,
  ...invokeBoundary,
  redaction: ['none'],
})

export const consoleCloseContract = defineInvokeContract({
  channel: Ch.CONSOLE_CLOSE,
  argsSchema: identifierArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
  redaction: ['session'],
})

export const dialogShowOpenContract = defineInvokeContract({
  channel: Ch.DIALOG_SHOW_OPEN,
  argsSchema: openDialogArgsSchema,
  resultSchema: openDialogResultSchema,
  ...invokeBoundary,
  redaction: ['none'],
})

export const dialogShowSaveContract = defineInvokeContract({
  channel: Ch.DIALOG_SHOW_SAVE,
  argsSchema: saveDialogArgsSchema,
  resultSchema: saveDialogResultSchema,
  ...invokeBoundary,
  redaction: ['none'],
})

export const batchSubmitContract = defineInvokeContract({
  channel: Ch.BATCH_SUBMIT,
  argsSchema: batchSubmitArgsSchema,
  resultSchema: batchSubmitResultSchema,
  ...invokeBoundary,
  redaction: ['none'],
})

export const batchCancelContract = defineInvokeContract({
  channel: Ch.BATCH_CANCEL,
  argsSchema: identifierArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
  redaction: ['none'],
})

export const batchGetStatusContract = defineInvokeContract({
  channel: Ch.BATCH_GET_STATUS,
  argsSchema: identifierArgsSchema,
  resultSchema: batchTaskStatusResultSchema,
  ...invokeBoundary,
  redaction: ['none'],
})

export const batchListContract = defineInvokeContract({
  channel: Ch.BATCH_LIST,
  argsSchema: noArgsSchema,
  resultSchema: batchTaskListResultSchema,
  ...invokeBoundary,
  redaction: ['none'],
})

export const batchRetryContract = defineInvokeContract({
  channel: Ch.BATCH_RETRY,
  argsSchema: {
    parse(value: unknown): [string, BatchRetryConfirmation] {
      const [id, raw] = requireTuple(value, 2, 'batch retry arguments')
      const confirmation = requirePlainObject(raw, 'batch retry confirmation')
      requireExactKeys(confirmation, ['requestId', 'items'], [], 'batch retry confirmation')
      requireNonBlankString(confirmation.requestId, 'batch retry request identity')
      const items = requireArray(confirmation.items, 'batch retry items').map((rawItem) => {
        const item = requirePlainObject(rawItem, 'batch retry item')
        requireExactKeys(item, ['id', 'retryCount'], [], 'batch retry item')
        return { id: requireNonBlankString(item.id, 'batch retry item identity'), retryCount: requireNonNegativeInteger(item.retryCount, 'batch retry count') }
      })
      if (!items.length || new Set(items.map((item) => item.id)).size !== items.length) invalid('batch retry items')
      return [requireNonBlankString(id, 'batch task identity'), { requestId: confirmation.requestId as string, items }]
    },
  },
  resultSchema: voidResultSchema,
  ...invokeBoundary,
  redaction: ['none'],
})

export const batchProgressContract = definePushContract({
  channel: Ch.EVENT_BATCH_PROGRESS,
  argsSchema: batchProgressArgsSchema,
  callerPolicy: 'main-process',
  redaction: ['none'],
})

export const infrastructureInvokeContracts = Object.freeze([
  poolGetContract,
  poolAddHostContract,
  poolRemoveHostContract,
  poolTransferMasterContract,
  taskListContract,
  taskCancelContract,
  profileListContract,
  profileSaveContract,
  profileDeleteContract,
  profileHasPasswordContract,
  profileConnectContract,
  vmConsoleContract,
  consoleGetUrlContract,
  consoleCloseContract,
  dialogShowOpenContract,
  dialogShowSaveContract,
  batchSubmitContract,
  batchCancelContract,
  batchGetStatusContract,
  batchListContract,
  batchRetryContract,
] as const)

export const infrastructureContracts = Object.freeze([
  ...infrastructureInvokeContracts,
  batchProgressContract,
] as const)
