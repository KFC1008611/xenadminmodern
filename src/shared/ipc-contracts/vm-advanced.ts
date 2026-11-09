import * as Ch from '../channels'
import {
  defineInvokeContract,
  type IpcRuntimeSchema,
} from '../ipc-contract'
import type { VmAdvancedConfig, VmAffinityConfig } from '../types/xapi'
import {
  invalid,
  requireArray,
  requireBoolean,
  requireExactKeys,
  requireFiniteNumber,
  requireNonBlankString,
  requireNonNegativeNumber,
  requireOpenStringRecord,
  requirePlainObject,
  requirePositiveInteger,
  requireRef,
  requireString,
  requireTuple,
  voidResultSchema,
  type UnknownRecord,
} from './runtime-schema'

const connectionIdArgsSchema: IpcRuntimeSchema<[string]> = {
  parse(value: unknown): [string] {
    const [connectionId] = requireTuple(value, 1, 'VM Advanced connection arguments')
    return [requireNonBlankString(connectionId, 'connection identity')]
  },
}

const connectionAndVmRefArgsSchema: IpcRuntimeSchema<[string, string]> = {
  parse(value: unknown): [string, string] {
    const [connectionId, vmRef] = requireTuple(value, 2, 'VM Advanced reference arguments')
    return [
      requireNonBlankString(connectionId, 'connection identity'),
      requireRef(vmRef, 'VM reference'),
    ]
  },
}

const affinityArgsSchema: IpcRuntimeSchema<[string, string, string | null]> = {
  parse(value: unknown): [string, string, string | null] {
    const [connectionId, vmRef, hostRef] = requireTuple(value, 3, 'VM affinity arguments')
    return [
      requireNonBlankString(connectionId, 'connection identity'),
      requireRef(vmRef, 'VM reference'),
      requireNullableRef(hostRef, 'host affinity reference'),
    ]
  },
}

const antiAffinityListArgsSchema: IpcRuntimeSchema<[string, string, string[]]> = {
  parse(value: unknown): [string, string, string[]] {
    const [connectionId, vmRef, vmRefs] = requireTuple(value, 3, 'VM anti-affinity arguments')
    return [
      requireNonBlankString(connectionId, 'connection identity'),
      requireRef(vmRef, 'VM reference'),
      requireRefArray(vmRefs, 'anti-affinity VM references'),
    ]
  },
}

const antiAffinityRefArgsSchema: IpcRuntimeSchema<[string, string, string]> = {
  parse(value: unknown): [string, string, string] {
    const [connectionId, vmRef, antiAffinityVmRef] = requireTuple(
      value,
      3,
      'VM anti-affinity reference arguments',
    )
    return [
      requireNonBlankString(connectionId, 'connection identity'),
      requireRef(vmRef, 'VM reference'),
      requireRef(antiAffinityVmRef, 'anti-affinity VM reference'),
    ]
  },
}

const positiveIntegerArgsSchema: IpcRuntimeSchema<[string, string, number]> = {
  parse(value: unknown): [string, string, number] {
    const [connectionId, vmRef, integer] = requireTuple(value, 3, 'VM positive integer arguments')
    return [
      requireNonBlankString(connectionId, 'connection identity'),
      requireRef(vmRef, 'VM reference'),
      requirePositiveInteger(integer, 'positive integer value'),
    ]
  },
}

const startDelayArgsSchema: IpcRuntimeSchema<[string, string, number]> = {
  parse(value: unknown): [string, string, number] {
    const [connectionId, vmRef, delay] = requireTuple(value, 3, 'VM start delay arguments')
    const parsedDelay = requireNonNegativeNumber(delay, 'VM start delay')
    if (!Number.isInteger(parsedDelay)) invalid('VM start delay')
    return [
      requireNonBlankString(connectionId, 'connection identity'),
      requireRef(vmRef, 'VM reference'),
      parsedDelay,
    ]
  },
}

const bootOrderArgsSchema: IpcRuntimeSchema<[string, string, string]> = {
  parse(value: unknown): [string, string, string] {
    const [connectionId, vmRef, order] = requireTuple(value, 3, 'VM boot order arguments')
    return [
      requireNonBlankString(connectionId, 'connection identity'),
      requireRef(vmRef, 'VM reference'),
      requireBootOrder(order, 'VM boot order'),
    ]
  },
}

const hvmBootParamsArgsSchema: IpcRuntimeSchema<[string, string, Record<string, string>]> = {
  parse(value: unknown): [string, string, Record<string, string>] {
    const [connectionId, vmRef, candidate] = requireTuple(value, 3, 'HVM boot parameter arguments')
    const params = requireOpenStringRecord(candidate, 'HVM boot parameters')
    if (Object.prototype.hasOwnProperty.call(params, 'order')) {
      requireBootOrder(params.order, 'VM boot order')
    }
    return [
      requireNonBlankString(connectionId, 'connection identity'),
      requireRef(vmRef, 'VM reference'),
      params,
    ]
  },
}

const configurationEntryArgsSchema: IpcRuntimeSchema<[string, string, string, string]> = {
  parse(value: unknown): [string, string, string, string] {
    const [connectionId, vmRef, key, entryValue] = requireTuple(
      value,
      4,
      'VM configuration entry arguments',
    )
    return [
      requireNonBlankString(connectionId, 'connection identity'),
      requireRef(vmRef, 'VM reference'),
      requireNonBlankString(key, 'configuration key'),
      requireString(entryValue, 'configuration value'),
    ]
  },
}

const viridianArgsSchema: IpcRuntimeSchema<[string, string, boolean]> = {
  parse(value: unknown): [string, string, boolean] {
    const [connectionId, vmRef, enabled] = requireTuple(value, 3, 'VM Viridian arguments')
    return [
      requireNonBlankString(connectionId, 'connection identity'),
      requireRef(vmRef, 'VM reference'),
      requireBoolean(enabled, 'Viridian state'),
    ]
  },
}

const tagArgsSchema: IpcRuntimeSchema<[string, string, string]> = {
  parse(value: unknown): [string, string, string] {
    const [connectionId, vmRef, tag] = requireTuple(value, 3, 'VM tag arguments')
    return [
      requireNonBlankString(connectionId, 'connection identity'),
      requireRef(vmRef, 'VM reference'),
      requireNonBlankString(tag, 'VM tag'),
    ]
  },
}

type VmStartConfig = { vmRef: string; startDelay: number; order: number }

function requireNonNegativeInteger(value: unknown, label: string): number {
  const result = requireNonNegativeNumber(value, label)
  if (!Number.isInteger(result)) invalid(label)
  return result
}

function parseVmStartConfig(value: unknown): VmStartConfig {
  const config = requirePlainObject(value, 'VM start-order entry')
  requireExactKeys(config, ['vmRef', 'startDelay', 'order'], [], 'VM start-order entry')
  return {
    vmRef: requireRef(config.vmRef, 'VM reference'),
    startDelay: requireNonNegativeInteger(config.startDelay, 'VM start delay'),
    order: requireNonNegativeInteger(config.order, 'VM start order'),
  }
}

const startOrderArgsSchema: IpcRuntimeSchema<[string, VmStartConfig[]]> = {
  parse(value: unknown): [string, VmStartConfig[]] {
    const [connectionId, candidate] = requireTuple(value, 2, 'VM start-order arguments')
    return [
      requireNonBlankString(connectionId, 'connection identity'),
      requireArray(candidate, 'VM start-order entries').map(parseVmStartConfig),
    ]
  },
}

function requireNullableRef(value: unknown, label: string): string | null {
  return value === null ? null : requireRef(value, label)
}

function requireRefArray(value: unknown, label: string): string[] {
  return requireArray(value, label).map((entry) => requireRef(entry, label))
}

function requireBootOrder(value: unknown, label: string): string {
  const order = requireString(value, label)
  const devices = [...order]
  if (devices.some((device) => device !== 'c' && device !== 'd' && device !== 'n')) invalid(label)
  if (new Set(devices).size !== devices.length) invalid(label)
  return order
}

const ADVANCED_CONFIG_KEYS = [
  'vmRef',
  'vmName',
  'affinity',
  'antiAffinity',
  'isProtected',
  'vcpusHotplug',
  'startDelay',
  'bootOrder',
  'hvmBootParams',
  'otherConfig',
  'platform',
] as const

function parseAdvancedConfig(value: unknown): VmAdvancedConfig {
  const config = requirePlainObject(value, 'VM Advanced configuration')
  requireExactKeys(config, ADVANCED_CONFIG_KEYS, ['antiAffinitySupported'], 'VM Advanced configuration')
  const startDelay = requireFiniteNumber(config.startDelay, 'VM start delay')
  if (startDelay < 0) invalid('VM start delay')
  return {
    vmRef: requireRef(config.vmRef, 'VM reference'),
    vmName: requireString(config.vmName, 'VM name'),
    affinity: requireNullableRef(config.affinity, 'host affinity reference'),
    antiAffinity: requireRefArray(config.antiAffinity, 'anti-affinity references'),
    ...(config.antiAffinitySupported !== undefined ? { antiAffinitySupported: requireBoolean(config.antiAffinitySupported, 'VM group support') } : {}),
    isProtected: requireBoolean(config.isProtected, 'VM protection state'),
    vcpusHotplug: requireBoolean(config.vcpusHotplug, 'VCPU hotplug state'),
    startDelay,
    bootOrder: requireBootOrder(config.bootOrder, 'VM boot order'),
    hvmBootParams: requireOpenStringRecord(config.hvmBootParams, 'HVM boot parameters'),
    otherConfig: requireOpenStringRecord(config.otherConfig, 'VM other configuration'),
    platform: requireOpenStringRecord(config.platform, 'VM platform configuration'),
  }
}

const advancedConfigResultSchema: IpcRuntimeSchema<VmAdvancedConfig> = {
  parse: parseAdvancedConfig,
}

const advancedConfigListResultSchema: IpcRuntimeSchema<VmAdvancedConfig[]> = {
  parse(value: unknown): VmAdvancedConfig[] {
    return requireArray(value, 'VM Advanced configuration list').map(parseAdvancedConfig)
  },
}

const AFFINITY_CONFIG_KEYS = ['vmRef', 'hostRef', 'antiAffinityRefs'] as const

const affinityConfigResultSchema: IpcRuntimeSchema<VmAffinityConfig> = {
  parse(value: unknown): VmAffinityConfig {
    const config: UnknownRecord = requirePlainObject(value, 'VM affinity configuration')
    requireExactKeys(config, AFFINITY_CONFIG_KEYS, [], 'VM affinity configuration')
    return {
      vmRef: requireRef(config.vmRef, 'VM reference'),
      hostRef: requireNullableRef(config.hostRef, 'host affinity reference'),
      antiAffinityRefs: requireRefArray(config.antiAffinityRefs, 'anti-affinity references'),
    }
  },
}

const invokeBoundary = {
  errorShape: 'ipc-error-response-v1' as const,
  callerPolicy: 'app-window-main-frame' as const,
  redaction: ['none'] as const,
}

export const vmAdvancedGetConfigContract = defineInvokeContract({
  channel: Ch.VM_ADV_GET_CONFIG,
  argsSchema: connectionAndVmRefArgsSchema,
  resultSchema: advancedConfigResultSchema,
  ...invokeBoundary,
})

export const vmAdvancedGetAllConfigsContract = defineInvokeContract({
  channel: Ch.VM_ADV_GET_ALL_CONFIGS,
  argsSchema: connectionIdArgsSchema,
  resultSchema: advancedConfigListResultSchema,
  ...invokeBoundary,
})

export const vmAdvancedGetAffinityContract = defineInvokeContract({
  channel: Ch.VM_ADV_GET_AFFINITY,
  argsSchema: connectionAndVmRefArgsSchema,
  resultSchema: affinityConfigResultSchema,
  ...invokeBoundary,
})

export const vmAdvancedSetAffinityContract = defineInvokeContract({
  channel: Ch.VM_ADV_SET_AFFINITY,
  argsSchema: affinityArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const vmAdvancedSetAntiAffinityContract = defineInvokeContract({
  channel: Ch.VM_ADV_SET_ANTI_AFFINITY,
  argsSchema: antiAffinityListArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const vmAdvancedAddAntiAffinityContract = defineInvokeContract({
  channel: Ch.VM_ADV_ADD_ANTI_AFFINITY,
  argsSchema: antiAffinityRefArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const vmAdvancedRemoveAntiAffinityContract = defineInvokeContract({
  channel: Ch.VM_ADV_REMOVE_ANTI_AFFINITY,
  argsSchema: antiAffinityRefArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const vmAdvancedEnableProtectionContract = defineInvokeContract({
  channel: Ch.VM_ADV_ENABLE_PROTECTION,
  argsSchema: connectionAndVmRefArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const vmAdvancedDisableProtectionContract = defineInvokeContract({
  channel: Ch.VM_ADV_DISABLE_PROTECTION,
  argsSchema: connectionAndVmRefArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const vmAdvancedSetVcpuHotplugContract = defineInvokeContract({
  channel: Ch.VM_ADV_SET_VCPU_HOTPLUG,
  argsSchema: positiveIntegerArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const vmAdvancedSetVcpusNumberContract = defineInvokeContract({
  channel: Ch.VM_ADV_SET_VCPUS_NUMBER,
  argsSchema: positiveIntegerArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const vmAdvancedSetStartDelayContract = defineInvokeContract({
  channel: Ch.VM_ADV_SET_START_DELAY,
  argsSchema: startDelayArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const vmAdvancedSetBootOrderContract = defineInvokeContract({
  channel: Ch.VM_ADV_SET_BOOT_ORDER,
  argsSchema: bootOrderArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const vmAdvancedSetHvmBootParamsContract = defineInvokeContract({
  channel: Ch.VM_ADV_SET_HVM_BOOT_PARAMS,
  argsSchema: hvmBootParamsArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const vmAdvancedSetPlatformParamContract = defineInvokeContract({
  channel: Ch.VM_ADV_SET_PLATFORM_PARAM,
  argsSchema: configurationEntryArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
  redaction: ['credentials'],
})

export const vmAdvancedSetViridianContract = defineInvokeContract({
  channel: Ch.VM_ADV_SET_VIRIDIAN,
  argsSchema: viridianArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const vmAdvancedSetOtherConfigContract = defineInvokeContract({
  channel: Ch.VM_ADV_SET_OTHER_CONFIG,
  argsSchema: configurationEntryArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
  redaction: ['credentials'],
})

export const vmAdvancedAddTagContract = defineInvokeContract({
  channel: Ch.VM_ADV_ADD_TAG,
  argsSchema: tagArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const vmAdvancedRemoveTagContract = defineInvokeContract({
  channel: Ch.VM_ADV_REMOVE_TAG,
  argsSchema: tagArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const vmAdvancedSetStartOrderContract = defineInvokeContract({
  channel: Ch.VM_ADV_SET_START_ORDER,
  argsSchema: startOrderArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const vmAdvancedContracts = [
  vmAdvancedGetConfigContract,
  vmAdvancedGetAllConfigsContract,
  vmAdvancedGetAffinityContract,
  vmAdvancedSetAffinityContract,
  vmAdvancedSetAntiAffinityContract,
  vmAdvancedAddAntiAffinityContract,
  vmAdvancedRemoveAntiAffinityContract,
  vmAdvancedEnableProtectionContract,
  vmAdvancedDisableProtectionContract,
  vmAdvancedSetVcpuHotplugContract,
  vmAdvancedSetVcpusNumberContract,
  vmAdvancedSetStartDelayContract,
  vmAdvancedSetBootOrderContract,
  vmAdvancedSetHvmBootParamsContract,
  vmAdvancedSetPlatformParamContract,
  vmAdvancedSetViridianContract,
  vmAdvancedSetOtherConfigContract,
  vmAdvancedAddTagContract,
  vmAdvancedRemoveTagContract,
  vmAdvancedSetStartOrderContract,
] as const
