import * as Ch from '../channels'
import { defineInvokeContract, type IpcRuntimeSchema } from '../ipc-contract'
import type {
  ConnectedHaConfiguration,
  HaComputeResult,
  HaFailoverPlan,
  HaHostStatus,
  HaVmConfig,
  HaRestartPriority,
} from '../types/xapi'
import {
  invalid,
  requireArray,
  requireBoolean,
  requireEnum,
  requireExactKeys,
  requireFiniteNumber,
  requireNonBlankString,
  requirePlainObject,
  requireRef,
  requireString,
  requireTuple,
  voidResultSchema,
} from './runtime-schema'

export interface HaEnableParams {
  heartbeatSRs: string[]
  allowOvercommit?: boolean
}

const FAILURE_MODES = new Set<HaHostStatus['failureMode']>(['unknown'])

const invokeBoundary = {
  errorShape: 'ipc-error-response-v1' as const,
  callerPolicy: 'app-window-main-frame' as const,
  redaction: ['none'] as const,
}

function connectionId(value: unknown): string {
  return requireNonBlankString(value, 'connection identity')
}

function nonNegativeInteger(value: unknown, label: string): number {
  const result = requireFiniteNumber(value, label)
  if (!Number.isInteger(result) || result < 0) invalid(label)
  return result
}

function restartPriority(value: unknown, label: string): HaRestartPriority {
  return requireEnum(value, new Set<HaRestartPriority>(['', 'restart', 'best-effort']), label)
}

function parseRefs(value: unknown, label: string): string[] {
  return requireArray(value, label).map((entry) => requireRef(entry, label))
}

const connectionArgsSchema: IpcRuntimeSchema<[string]> = {
  parse(value: unknown): [string] {
    const [rawConnectionId] = requireTuple(value, 1, 'HA connection arguments')
    return [connectionId(rawConnectionId)]
  },
}

const connectionRefArgsSchema: IpcRuntimeSchema<[string, string]> = {
  parse(value: unknown): [string, string] {
    const [rawConnectionId, ref] = requireTuple(value, 2, 'HA reference arguments')
    return [connectionId(rawConnectionId), requireRef(ref, 'HA VM reference')]
  },
}

const enableArgsSchema: IpcRuntimeSchema<[string, HaEnableParams]> = {
  parse(value: unknown): [string, HaEnableParams] {
    const [rawConnectionId, rawParams] = requireTuple(value, 2, 'HA enable arguments')
    const params = requirePlainObject(rawParams, 'HA enable parameters')
    requireExactKeys(
      params,
      ['heartbeatSRs'],
      ['allowOvercommit'],
      'HA enable parameters',
    )
    const parsed: HaEnableParams = {
      heartbeatSRs: parseRefs(params.heartbeatSRs, 'HA heartbeat SR references'),
    }
    if (params.allowOvercommit !== undefined) {
      parsed.allowOvercommit = requireBoolean(params.allowOvercommit, 'HA overcommit flag')
    }
    return [connectionId(rawConnectionId), parsed]
  },
}

const preventRestartsArgsSchema: IpcRuntimeSchema<[string, number]> = {
  parse(value: unknown): [string, number] {
    const [rawConnectionId, seconds] = requireTuple(value, 2, 'HA restart delay arguments')
    return [
      connectionId(rawConnectionId),
      nonNegativeInteger(seconds, 'HA restart delay'),
    ]
  },
}

const setVmPriorityArgsSchema: IpcRuntimeSchema<[string, string, HaRestartPriority]> = {
  parse(value: unknown): [string, string, HaRestartPriority] {
    const [rawConnectionId, vmRef, priority] = requireTuple(
      value,
      3,
      'HA VM restart priority arguments',
    )
    return [
      connectionId(rawConnectionId),
      requireRef(vmRef, 'HA VM reference'),
      restartPriority(priority, 'HA VM restart priority'),
    ]
  },
}

const setVmAlwaysRunArgsSchema: IpcRuntimeSchema<[string, string, boolean]> = {
  parse(value: unknown): [string, string, boolean] {
    const [rawConnectionId, vmRef, alwaysRun] = requireTuple(
      value,
      3,
      'HA VM always-run arguments',
    )
    return [
      connectionId(rawConnectionId),
      requireRef(vmRef, 'HA VM reference'),
      requireBoolean(alwaysRun, 'HA VM always-run flag'),
    ]
  },
}

function parseHaHostStatus(value: unknown): HaHostStatus {
  const host = requirePlainObject(value, 'HA host status')
  requireExactKeys(
    host,
    ['hostRef', 'hostName', 'live', 'failed', 'failureMode'],
    [],
    'HA host status',
  )
  return {
    hostRef: requireRef(host.hostRef, 'HA host reference'),
    hostName: requireString(host.hostName, 'HA host name'),
    live: host.live === null ? null : requireBoolean(host.live, 'HA host live state'),
    failed: host.failed === null ? null : requireBoolean(host.failed, 'HA host failed state'),
    failureMode: requireEnum(host.failureMode, FAILURE_MODES, 'HA host failure mode'),
  }
}

function parseHaVmConfig(value: unknown): HaVmConfig {
  const config = requirePlainObject(value, 'HA VM configuration')
  requireExactKeys(
    config,
    ['vmRef', 'vmName', 'restartPriority', 'alwaysRun'],
    [],
    'HA VM configuration',
  )
  return {
    vmRef: requireRef(config.vmRef, 'HA VM reference'),
    vmName: requireString(config.vmName, 'HA VM name'),
    restartPriority: restartPriority(config.restartPriority, 'HA VM restart priority'),
    alwaysRun: requireBoolean(config.alwaysRun, 'HA VM always-run state'),
  }
}

const getConfigResultSchema: IpcRuntimeSchema<ConnectedHaConfiguration | null> = {
  parse(value: unknown): ConnectedHaConfiguration | null {
    if (value === null) return null
    const config = requirePlainObject(value, 'HA configuration')
    requireExactKeys(
      config,
      [
        'enabled',
        'allowOvercommit',
        'plannedRepeats',
        'heartbeatSRs',
        'hosts',
        'connectionId',
        'poolName',
      ],
      [],
      'HA configuration',
    )
    return {
      enabled: requireBoolean(config.enabled, 'HA enabled state'),
      allowOvercommit: requireBoolean(config.allowOvercommit, 'HA overcommit state'),
      plannedRepeats: nonNegativeInteger(config.plannedRepeats, 'HA failure tolerance'),
      heartbeatSRs: parseRefs(config.heartbeatSRs, 'HA heartbeat SR references'),
      hosts: requireArray(config.hosts, 'HA host statuses').map(parseHaHostStatus),
      connectionId: connectionId(config.connectionId),
      poolName: requireString(config.poolName, 'HA resource pool name'),
    }
  },
}

const computeToleranceResultSchema: IpcRuntimeSchema<HaComputeResult> = {
  parse(value: unknown): HaComputeResult {
    const result = requirePlainObject(value, 'HA tolerance result')
    requireExactKeys(
      result,
      [
        'canHandleHostFailures',
        'vmsThatCouldBeRestarted',
        'vmsThatWouldNotBeRestarted',
      ],
      [],
      'HA tolerance result',
    )
    return {
      canHandleHostFailures: nonNegativeInteger(
        result.canHandleHostFailures,
        'HA tolerated host failures',
      ),
      vmsThatCouldBeRestarted: result.vmsThatCouldBeRestarted === null ? null : invalid('HA scenario unavailable'),
      vmsThatWouldNotBeRestarted: result.vmsThatWouldNotBeRestarted === null ? null : invalid('HA scenario unavailable'),
    }
  },
}

const vmConfigsResultSchema: IpcRuntimeSchema<HaVmConfig[]> = {
  parse(value: unknown): HaVmConfig[] {
    return requireArray(value, 'HA VM configurations').map(parseHaVmConfig)
  },
}

const booleanResultSchema: IpcRuntimeSchema<boolean> = {
  parse(value: unknown): boolean {
    return requireBoolean(value, 'HA boolean result')
  },
}

const failoverPlanResultSchema: IpcRuntimeSchema<HaFailoverPlan> = {
  parse(value: unknown): HaFailoverPlan {
    const plan = requirePlainObject(value, 'HA failover plan')
    requireExactKeys(
      plan,
      ['vmsByPriority', 'canTolerateFailures'],
      [],
      'HA failover plan',
    )
    const vmsByPriority = requireArray(plan.vmsByPriority, 'HA failover priority groups')
      .map((value) => {
        const group = requirePlainObject(value, 'HA failover priority group')
        requireExactKeys(group, ['priority', 'vms'], [], 'HA failover priority group')
        return {
          priority: requireEnum(group.priority, new Set<'restart' | 'best-effort'>(['restart', 'best-effort']), 'HA restart policy'),
          vms: requireArray(group.vms, 'HA failover VMs').map(parseHaVmConfig),
        }
      })
    return {
      vmsByPriority,
      canTolerateFailures: nonNegativeInteger(
        plan.canTolerateFailures,
        'HA failover tolerated host failures',
      ),
    }
  },
}

export const haGetConfigContract = defineInvokeContract({
  channel: Ch.HA_GET_CONFIG,
  argsSchema: connectionArgsSchema,
  resultSchema: getConfigResultSchema,
  ...invokeBoundary,
})

export const haEnableContract = defineInvokeContract({
  channel: Ch.HA_ENABLE,
  argsSchema: enableArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const haDisableContract = defineInvokeContract({
  channel: Ch.HA_DISABLE,
  argsSchema: connectionArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const haComputeToleranceContract = defineInvokeContract({
  channel: Ch.HA_COMPUTE_TOLERANCE,
  argsSchema: connectionArgsSchema,
  resultSchema: computeToleranceResultSchema,
  ...invokeBoundary,
})

export const haPreventRestartsContract = defineInvokeContract({
  channel: Ch.HA_PREVENT_RESTARTS,
  argsSchema: preventRestartsArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const haGetVmConfigsContract = defineInvokeContract({
  channel: Ch.HA_GET_VM_CONFIGS,
  argsSchema: connectionArgsSchema,
  resultSchema: vmConfigsResultSchema,
  ...invokeBoundary,
})

export const haSetVmPriorityContract = defineInvokeContract({
  channel: Ch.HA_SET_VM_PRIORITY,
  argsSchema: setVmPriorityArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const haSetVmAlwaysRunContract = defineInvokeContract({
  channel: Ch.HA_SET_VM_ALWAYS_RUN,
  argsSchema: setVmAlwaysRunArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const haGetVmAlwaysRunContract = defineInvokeContract({
  channel: Ch.HA_GET_VM_ALWAYS_RUN,
  argsSchema: connectionRefArgsSchema,
  resultSchema: booleanResultSchema,
  ...invokeBoundary,
})

export const haEmergencyMasterContract = defineInvokeContract({
  channel: Ch.HA_EMERGENCY_MASTER,
  argsSchema: connectionArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const haRecoverSlavesContract = defineInvokeContract({
  channel: Ch.HA_RECOVER_SLAVES,
  argsSchema: connectionArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const haGetFailoverPlanContract = defineInvokeContract({
  channel: Ch.HA_GET_FAILOVER_PLAN,
  argsSchema: connectionArgsSchema,
  resultSchema: failoverPlanResultSchema,
  ...invokeBoundary,
})

export const haGovernanceContracts = Object.freeze([
  haGetConfigContract,
  haEnableContract,
  haDisableContract,
  haComputeToleranceContract,
  haPreventRestartsContract,
  haGetVmConfigsContract,
  haSetVmPriorityContract,
  haSetVmAlwaysRunContract,
  haGetVmAlwaysRunContract,
  haEmergencyMasterContract,
  haRecoverSlavesContract,
  haGetFailoverPlanContract,
] as const)
