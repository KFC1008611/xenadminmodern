import * as Ch from '../channels'
import {
  defineInvokeContract,
  type IpcRuntimeSchema,
} from '../ipc-contract'
import type {
  ConnectedHostRecord,
  EvacuateResult,
  HostMetrics,
  MaintenanceStatus,
} from '../types/xapi'
import {
  invalid,
  requireArray,
  requireBoolean,
  requireEnum,
  requireExactKeys,
  requireNonBlankString,
  requireNonNegativeNumber,
  requireOpenStringRecord,
  requirePlainObject,
  requireRef,
  requireString,
  requireTuple,
  voidResultSchema,
} from './runtime-schema'

const MAINTENANCE_STATES = new Set<MaintenanceStatus['state']>([
  'enabled',
  'disabled',
  'maintenance',
])

function requireNonNegativeSafeInteger(value: unknown, label: string): number {
  const result = requireNonNegativeNumber(value, label)
  if (!Number.isSafeInteger(result)) invalid(label)
  return result
}

function requireRefArray(value: unknown, label: string): string[] {
  return requireArray(value, label).map((entry) => requireRef(entry, label))
}

const connectionArgsSchema: IpcRuntimeSchema<[string]> = {
  parse(value: unknown): [string] {
    const [connectionId] = requireTuple(value, 1, 'host connection arguments')
    return [requireNonBlankString(connectionId, 'connection identity')]
  },
}

const connectionAndRefArgsSchema: IpcRuntimeSchema<[string, string]> = {
  parse(value: unknown): [string, string] {
    const [connectionId, ref] = requireTuple(value, 2, 'host reference arguments')
    return [
      requireNonBlankString(connectionId, 'connection identity'),
      requireRef(ref, 'host or host metrics reference'),
    ]
  },
}

function parseConnectedHostRecord(value: unknown): ConnectedHostRecord {
  const record = requirePlainObject(value, 'connected host record')
  requireRef(record.ref, 'host reference')
  requireNonBlankString(record.uuid, 'host UUID')
  requireString(record.name_label, 'host name')
  requireString(record.hostname, 'host hostname')
  requireString(record.address, 'host address')
  requireBoolean(record.enabled, 'host enabled state')
  requireRefArray(record.resident_VMs, 'host resident VM references')
  if (record.memory_total !== undefined) {
    requireNonNegativeNumber(record.memory_total, 'host total memory')
  }
  if (record.memory_free !== undefined) {
    requireNonNegativeNumber(record.memory_free, 'host free memory')
  }
  if (record.memoryReadError !== undefined) requireString(record.memoryReadError, 'host memory read error')
  requireOpenStringRecord(record.cpu_info, 'host CPU information')
  requireOpenStringRecord(record.software_version, 'host software version')
  requireRef(record.metrics, 'host metrics reference')
  requireString(record.suspend_image_sr, 'host suspend-image SR reference')
  requireNonBlankString(record.connectionId, 'connection identity')
  requireString(record.poolName, 'resource pool name')
  return value as ConnectedHostRecord
}

const hostListResultSchema: IpcRuntimeSchema<ConnectedHostRecord[]> = {
  parse(value: unknown): ConnectedHostRecord[] {
    return requireArray(value, 'connected host list').map(parseConnectedHostRecord)
  },
}

function parseHostMetrics(value: unknown): HostMetrics {
  const metrics = requirePlainObject(value, 'host metrics')
  requireRef(metrics.ref, 'host metrics reference')
  requireNonNegativeNumber(metrics.memory_total, 'host metrics total memory')
  requireNonNegativeNumber(metrics.memory_free, 'host metrics free memory')
  requireBoolean(metrics.live, 'host metrics live state')
  return value as HostMetrics
}

const hostMetricsResultSchema: IpcRuntimeSchema<HostMetrics> = {
  parse: parseHostMetrics,
}

function parseMaintenanceStatus(value: unknown): MaintenanceStatus {
  const status = requirePlainObject(value, 'host maintenance status')
  requireExactKeys(
    status,
    ['hostRef', 'state', 'runningVms', 'residentVms'],
    [],
    'host maintenance status',
  )
  requireRef(status.hostRef, 'host reference')
  requireEnum(status.state, MAINTENANCE_STATES, 'host maintenance state')
  requireNonNegativeSafeInteger(status.runningVms, 'running VM count')
  requireRefArray(status.residentVms, 'resident VM references')
  return value as MaintenanceStatus
}

const maintenanceStatusResultSchema: IpcRuntimeSchema<MaintenanceStatus> = {
  parse: parseMaintenanceStatus,
}

function parseEvacuationResult(value: unknown): EvacuateResult {
  const result = requirePlainObject(value, 'host evacuation result')
  requireExactKeys(
    result,
    ['success', 'migratedVms', 'failedVms'],
    [],
    'host evacuation result',
  )
  requireBoolean(result.success, 'host evacuation success state')
  requireRefArray(result.migratedVms, 'migrated VM references')
  for (const failedValue of requireArray(result.failedVms, 'failed VM migrations')) {
    const failure = requirePlainObject(failedValue, 'failed VM migration')
    requireExactKeys(failure, ['vmRef', 'error'], [], 'failed VM migration')
    requireRef(failure.vmRef, 'failed VM reference')
    requireString(failure.error, 'failed VM migration error')
  }
  return value as EvacuateResult
}

const evacuationResultSchema: IpcRuntimeSchema<EvacuateResult> = {
  parse: parseEvacuationResult,
}

const invokeBoundary = {
  callerPolicy: 'app-window-main-frame' as const,
  errorShape: 'ipc-error-response-v1' as const,
  redaction: ['none'] as const,
}

export const hostListContract = defineInvokeContract({
  channel: Ch.HOST_LIST,
  argsSchema: connectionArgsSchema,
  resultSchema: hostListResultSchema,
  ...invokeBoundary,
})

export const hostMetricsContract = defineInvokeContract({
  channel: Ch.HOST_METRICS,
  argsSchema: connectionAndRefArgsSchema,
  resultSchema: hostMetricsResultSchema,
  ...invokeBoundary,
})

export const hostEnableContract = defineInvokeContract({
  channel: Ch.HOST_ENABLE,
  argsSchema: connectionAndRefArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const hostDisableContract = defineInvokeContract({
  channel: Ch.HOST_DISABLE,
  argsSchema: connectionAndRefArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const hostRebootContract = defineInvokeContract({
  channel: Ch.HOST_REBOOT,
  argsSchema: connectionAndRefArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const hostShutdownContract = defineInvokeContract({
  channel: Ch.HOST_SHUTDOWN,
  argsSchema: connectionAndRefArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const hostGetMaintenanceStatusContract = defineInvokeContract({
  channel: Ch.HOST_GET_MAINTENANCE_STATUS,
  argsSchema: connectionAndRefArgsSchema,
  resultSchema: maintenanceStatusResultSchema,
  ...invokeBoundary,
})

export const hostEnterMaintenanceContract = defineInvokeContract({
  channel: Ch.HOST_ENTER_MAINTENANCE,
  argsSchema: connectionAndRefArgsSchema,
  resultSchema: evacuationResultSchema,
  ...invokeBoundary,
})

export const hostExitMaintenanceContract = defineInvokeContract({
  channel: Ch.HOST_EXIT_MAINTENANCE,
  argsSchema: connectionAndRefArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const hostEvacuateContract = defineInvokeContract({
  channel: Ch.HOST_EVACUATE,
  argsSchema: connectionAndRefArgsSchema,
  resultSchema: evacuationResultSchema,
  ...invokeBoundary,
})

export const hostGovernanceInvokeContracts = Object.freeze([
  hostListContract,
  hostMetricsContract,
  hostEnableContract,
  hostDisableContract,
  hostRebootContract,
  hostShutdownContract,
  hostGetMaintenanceStatusContract,
  hostEnterMaintenanceContract,
  hostExitMaintenanceContract,
  hostEvacuateContract,
] as const)
