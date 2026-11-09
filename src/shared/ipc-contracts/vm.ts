import { copyOperationSchema, COPY_MODES, vmCopyPlanContract, vmCopyOperationsContract, vmCancelCopyContract } from './vm-copy'
import * as Ch from '../channels'
import { parseVmPowerIntent } from './vm-power-intent'
import { validateVmMemoryLimits } from '../vm-memory'
import {
  defineInvokeContract,
  definePushContract,
  type IpcRuntimeSchema,
} from '../ipc-contract'
import type {
  ConnectedHostRecord,
  ConnectedNetworkRecord,
  ConnectedSrRecord,
  ConnectedVmRecord,
  SnapshotRecord,
  TemplateClonePayload,
  TemplateDeletePayload,
  TemplateSettingsPayload,
  VBDRecord,
  VIFRecord,
  VmCdDriveRecord,
  VmCreationResourceOptions,
  VmCopyPayload,
  VmDetailRecord,
  VmDestroyOptions,
  VmDestroyResult,
  VmExportParams,
  VmImportOperation,
  VmImportOperationStatus,
  VmImportParams,
  VmImportPreview,
  VmChangeEvent,
  VmRecord,
  VmPowerIntent,
  VmRelocationMode,
  VmRelocationPayload,
  VmRelocationPlan,
  VmRelocationResult,
  VmTransferProgress,
  VmTransferMetrics,
  VmWizardPayload,
  VmVifPolicy,
  WizardDisk,
  WizardVif,
} from '../types/xapi'
import {
  invalid,
  requireArray,
  requireBoolean,
  requireEnum,
  requireExactKeys,
  requireFiniteNumber,
  requireSrCapacity,
  requireNonNegativeNumber,
  requireNonBlankString,
  requireOpenStringRecord,
  requirePlainObject,
  requirePositiveInteger,
  requireRef,
  requireString,
  requireStringArray,
  requireTuple,
  type UnknownRecord,
  voidResultSchema,
} from './runtime-schema'

const POWER_STATES = new Set<ConnectedVmRecord['power_state']>([
  'Running',
  'Halted',
  'Suspended',
  'Paused',
])
const RELOCATION_MODES = new Set<VmRelocationMode>([
  'pool-migrate',
  'storage-move',
  'cross-pool-migrate',
  'cross-pool-copy',
])
const INSTALL_MODES = new Set<VmWizardPayload['installMode']>(['iso', 'pxe', 'url', 'none'])
const EXPORT_MODES = new Set<VmExportParams['exportMode']>(['shutdown', 'snapshot', 'force'])
const IMPORT_OPERATION_STATUSES = new Set<VmImportOperationStatus>([
  'pending',
  'validating',
  'uploading',
  'waiting_for_task',
  'unknown',
  'cancelling',
  'configuring',
  'completed',
  'failed',
  'cancelled',
])
const TRANSFER_STATUSES = new Set<VmTransferProgress['status']>([
  'unknown',
  'pending',
  'running',
  'cancelling',
  'completed',
  'failed',
  'cancelled',
])
const VM_EVENT_OPERATIONS = new Set<VmChangeEvent['operation']>(['add', 'mod', 'del'])

function requireRecord(value: unknown, label: string): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(label)
  return value as UnknownRecord
}

const connectionIdArgsSchema: IpcRuntimeSchema<[string]> = {
  parse(value: unknown): [string] {
    const [connectionId] = requireTuple(value, 1, 'VM connection arguments')
    return [requireNonBlankString(connectionId, 'connection identity')]
  },
}

const vmChangedArgsSchema: IpcRuntimeSchema<[VmChangeEvent]> = {
  parse(value: unknown): [VmChangeEvent] {
    const [rawEvent] = requireTuple(value, 1, 'VM change arguments')
    const event = requirePlainObject(rawEvent, 'VM change event')
    requireExactKeys(
      event,
      ['connectionId', 'operation', 'ref', 'receivedAt'],
      ['snapshot'],
      'VM change event',
    )

    const snapshot = event.snapshot === undefined
      ? undefined
      : requirePlainObject(event.snapshot, 'VM change snapshot')

    return [{
      connectionId: requireNonBlankString(event.connectionId, 'connection identity'),
      operation: requireEnum(event.operation, VM_EVENT_OPERATIONS, 'VM event operation'),
      ref: requireRef(event.ref, 'VM reference'),
      ...(snapshot === undefined ? {} : { snapshot }),
      receivedAt: requireNonNegativeNumber(event.receivedAt, 'VM event received time'),
    }]
  },
}

const connectionAndVmRefArgsSchema: IpcRuntimeSchema<[string, string]> = {
  parse(value: unknown): [string, string] {
    const [connectionId, vmRef] = requireTuple(value, 2, 'VM reference arguments')
    return [
      requireNonBlankString(connectionId, 'connection identity'),
      requireRef(vmRef, 'VM reference'),
    ]
  },
}

const vmPowerArgsSchema: IpcRuntimeSchema<[string, string, VmPowerIntent?]> = {
  parse(value: unknown): [string, string, VmPowerIntent?] {
    const tuple = requireTuple(value, 2, 'VM power arguments', 1)
    const base = connectionAndVmRefArgsSchema.parse(tuple.slice(0, 2))
    return tuple.length === 2 ? base : [...base, tuple[2] === undefined ? undefined : parseVmPowerIntent(tuple[2])]
  },
}

function validateOptionalString(value: unknown, label: string): void {
  if (value !== undefined) requireString(value, label)
}

function validateOptionalNumber(value: unknown, label: string): void {
  if (value !== undefined) requireFiniteNumber(value, label)
}

function validateOptionalBoolean(value: unknown, label: string): void {
  if (value !== undefined) requireBoolean(value, label)
}

function validateOptionalStringArray(value: unknown, label: string): void {
  if (value !== undefined) requireStringArray(value, label)
}

function validateOptionalStringRecord(value: unknown, label: string): void {
  if (value !== undefined) requireOpenStringRecord(value, label)
}

function validateVmRecord(value: unknown): VmRecord {
  const record = requireRecord(value, 'VM record')
  requireString(record.ref, 'VM reference')
  requireString(record.uuid, 'VM UUID')
  requireString(record.name_label, 'VM name')
  requireString(record.name_description, 'VM description')
  requireEnum(record.power_state, POWER_STATES, 'VM power state')
  requireString(record.resident_on, 'resident host reference')
  requireFiniteNumber(record.VCPUs_max, 'maximum VCPU count')
  requireFiniteNumber(record.VCPUs_at_startup, 'startup VCPU count')
  validateOptionalNumber(record.memory_static_min, 'static minimum memory')
  requireFiniteNumber(record.memory_static_max, 'static maximum memory')
  validateOptionalNumber(record.memory_dynamic_min, 'dynamic minimum memory')
  requireFiniteNumber(record.memory_dynamic_max, 'dynamic maximum memory')
  requireBoolean(record.is_a_template, 'VM template flag')
  validateOptionalBoolean(record.is_a_snapshot, 'VM snapshot flag')
  requireBoolean(record.is_control_domain, 'VM control-domain flag')
  requireStringArray(record.VBDs, 'VM VBD references')
  requireStringArray(record.VIFs, 'VM VIF references')
  requireString(record.metrics, 'VM metrics reference')
  requireString(record.guest_metrics, 'VM guest metrics reference')
  requireStringArray(record.consoles, 'VM console references')
  validateOptionalStringRecord(record.other_config, 'VM other configuration')
  validateOptionalString(record.HVM_boot_policy, 'VM HVM boot policy')
  validateOptionalStringRecord(record.HVM_boot_params, 'VM HVM boot parameters')
  validateOptionalString(record.PV_bootloader, 'VM PV bootloader')
  validateOptionalString(record.PV_args, 'VM PV arguments')
  validateOptionalStringRecord(record.platform, 'VM platform')
  validateOptionalString(record.affinity, 'VM affinity')
  validateOptionalBoolean(record.is_default_template, 'default template flag')
  validateOptionalStringArray(record.allowed_operations, 'VM allowed operations')
  validateOptionalStringRecord(record.current_operations, 'VM current operations')
  validateOptionalStringRecord(record.blocked_operations, 'VM blocked operations')
  validateOptionalBoolean(record.locked, 'VM locked flag')
  validateOptionalBoolean(record.Locked, 'VM compatibility locked flag')
  return value as VmRecord
}

function validateConnectedVmRecord(value: unknown): ConnectedVmRecord {
  validateVmRecord(value)
  const record = value as UnknownRecord
  requireString(record.connectionId, 'VM connection identity')
  requireString(record.poolName, 'VM pool name')
  validateOptionalStringRecord(record.networks, 'VM guest networks')
  validateOptionalString(record.guestMetricsError, 'VM guest metrics error')
  return value as ConnectedVmRecord
}

const connectedVmListResultSchema: IpcRuntimeSchema<ConnectedVmRecord[]> = {
  parse(value: unknown): ConnectedVmRecord[] {
    const records = requireArray(value, 'VM list result')
    for (const record of records) validateConnectedVmRecord(record)
    return records as ConnectedVmRecord[]
  },
}

const templatesResultSchema: IpcRuntimeSchema<{ user: VmRecord[]; system: VmRecord[] }> = {
  parse(value: unknown): { user: VmRecord[]; system: VmRecord[] } {
    const result = requirePlainObject(value, 'VM template result')
    requireExactKeys(result, ['user', 'system'], [], 'VM template result')
    const user = requireArray(result.user, 'user templates').map(validateVmRecord)
    const system = requireArray(result.system, 'system templates').map(validateVmRecord)
    return { user, system }
  },
}

const vmDetailResultSchema: IpcRuntimeSchema<VmDetailRecord> = {
  parse(value: unknown): VmDetailRecord {
    validateVmRecord(value)
    const record = value as UnknownRecord
    requireFiniteNumber(record.memory_static_min, 'static minimum memory')
    requireFiniteNumber(record.memory_dynamic_min, 'dynamic minimum memory')
    if (record.memory_actual !== undefined) requireNonNegativeNumber(record.memory_actual, 'allocated memory')
    requireOpenStringRecord(record.os_version, 'VM OS version')
    requireOpenStringRecord(record.networks, 'VM guest networks')
    return value as VmDetailRecord
  },
}

function parseCreationHost(value: unknown) {
  const result = requirePlainObject(value, 'VM creation host')
  requireExactKeys(result, ['ref', 'name', 'enabled', 'memoryFree', 'cpuCount'], [], 'VM creation host')
  return {
    ref: requireRef(result.ref, 'host reference'),
    name: requireString(result.name, 'host name'),
    enabled: requireBoolean(result.enabled, 'host enabled state'),
    memoryFree: requireFiniteNumber(result.memoryFree, 'host free memory'),
    cpuCount: requireFiniteNumber(result.cpuCount, 'host CPU count'),
  }
}

function parseCreationSr(value: unknown) {
  const result = requirePlainObject(value, 'VM creation SR')
  requireExactKeys(result, ['ref', 'name', 'freeBytes', 'shared', 'hostRefs'], ['uuid', 'isDefault'], 'VM creation SR')
  return {
    ref: requireRef(result.ref, 'SR reference'),
    name: requireString(result.name, 'SR name'),
    freeBytes: requireFiniteNumber(result.freeBytes, 'SR free bytes'),
    shared: requireBoolean(result.shared, 'SR shared state'),
    hostRefs: requireStringArray(result.hostRefs, 'SR host references'),
    ...(result.uuid === undefined ? {} : { uuid: requireString(result.uuid, 'SR UUID') }),
    ...(result.isDefault === undefined ? {} : { isDefault: requireBoolean(result.isDefault, 'default SR') }),
  }
}

function parseCreationNetwork(value: unknown) {
  const result = requirePlainObject(value, 'VM creation network')
  requireExactKeys(result, ['ref', 'name', 'hostRefs', 'autoPlug'], [], 'VM creation network')
  return {
    ref: requireRef(result.ref, 'network reference'),
    name: requireString(result.name, 'network name'),
    hostRefs: requireStringArray(result.hostRefs, 'network host references'),
    autoPlug: requireBoolean(result.autoPlug, 'network auto-plug state'),
  }
}

function parseCreationIso(value: unknown) {
  const result = requirePlainObject(value, 'VM creation ISO')
  requireExactKeys(result, ['ref', 'name', 'srRef', 'hostRefs'], [], 'VM creation ISO')
  return {
    ref: requireRef(result.ref, 'ISO reference'),
    name: requireString(result.name, 'ISO name'),
    srRef: requireRef(result.srRef, 'ISO SR reference'),
    hostRefs: requireStringArray(result.hostRefs, 'ISO host references'),
  }
}

const creationResourcesResultSchema: IpcRuntimeSchema<VmCreationResourceOptions> = {
  parse(value: unknown): VmCreationResourceOptions {
    const result = requirePlainObject(value, 'VM creation resources')
    requireExactKeys(result, ['hosts', 'srs', 'networks', 'isos'], ['templateDisks', 'templateCdCount'], 'VM creation resources')
    return {
      hosts: requireArray(result.hosts, 'creation hosts').map(parseCreationHost),
      srs: requireArray(result.srs, 'creation SRs').map(parseCreationSr),
      networks: requireArray(result.networks, 'creation networks').map(parseCreationNetwork),
      isos: requireArray(result.isos, 'creation ISOs').map(parseCreationIso),
      ...(result.templateDisks === undefined ? {} : { templateDisks: requireArray(result.templateDisks, 'template disks').map(parseWizardDisk) }),
      ...(result.templateCdCount === undefined ? {} : { templateCdCount: requireNonNegativeNumber(result.templateCdCount, 'template CD count') }),
    }
  },
}

function validateVbdRecord(value: unknown): VBDRecord {
  const record = requireRecord(value, 'VBD record')
  requireRef(record.ref, 'VBD reference')
  requireString(record.VDI, 'VDI reference')
  requireString(record.userdevice, 'VBD user device')
  requireString(record.mode, 'VBD mode')
  requireString(record.type, 'VBD type')
  requireBoolean(record.bootable, 'VBD bootable state')
  requireBoolean(record.currently_attached, 'VBD attached state')
  requireBoolean(record.unpluggable, 'VBD unpluggable state')
  validateOptionalStringArray(record.allowed_operations, 'VBD allowed operations')
  requireBoolean(record.owner, 'VBD owner state')
  if (record.deleteReason !== undefined) requireString(record.deleteReason, 'VBD delete reason')
  requireString(record.vdiName, 'VDI name')
  requireFiniteNumber(record.vdiSize, 'VDI size')
  requireString(record.srRef, 'VBD SR reference')
  return value as VBDRecord
}

const vbdListResultSchema: IpcRuntimeSchema<VBDRecord[]> = {
  parse(value: unknown): VBDRecord[] {
    return requireArray(value, 'VBD list result').map(validateVbdRecord)
  },
}

function requireNullableString(value: unknown, label: string): string | null {
  if (value === null) return null
  return requireString(value, label)
}

function requireNullableNumber(value: unknown, label: string): number | null {
  if (value === null) return null
  return requireFiniteNumber(value, label)
}

const cdDriveResultSchema: IpcRuntimeSchema<VmCdDriveRecord> = {
  parse(value: unknown): VmCdDriveRecord {
    const record = requireRecord(value, 'VM CD drive result')
    requireNullableString(record.vbdRef, 'CD VBD reference')
    requireNullableString(record.vdiRef, 'CD VDI reference')
    requireNullableString(record.userdevice, 'CD user device')
    requireBoolean(record.empty, 'CD empty state')
    requireNullableString(record.isoName, 'CD ISO name')
    requireNullableNumber(record.isoSize, 'CD ISO size')
    requireNullableString(record.srRef, 'CD SR reference')
    requireNullableString(record.srName, 'CD SR name')
    return value as VmCdDriveRecord
  },
}

function validateVifRecord(value: unknown): VIFRecord {
  const record = requireRecord(value, 'VIF record')
  requireRef(record.ref, 'VIF reference')
  requireString(record.device, 'VIF device')
  requireString(record.MAC, 'VIF MAC')
  requireString(record.network, 'VIF network reference')
  requireString(record.networkName, 'VIF network name')
  requireFiniteNumber(record.MTU, 'VIF MTU')
  if (Object.prototype.hasOwnProperty.call(record, 'currently_attached')) {
    requireBoolean(record.currently_attached, 'VIF attached state')
  }
  if (record.policy !== undefined) parseVifPolicy(record.policy)
  return value as VIFRecord
}

function parseVifPolicy(value: unknown): VmVifPolicy {
  const record = requirePlainObject(value, 'inherited VIF policy')
  requireExactKeys(record, ['MTU', 'qos_algorithm_type', 'qos_algorithm_params', 'locking_mode', 'ipv4_allowed', 'ipv6_allowed'], [], 'inherited VIF policy')
  return {
    MTU: requirePositiveInteger(record.MTU, 'VIF MTU'),
    qos_algorithm_type: requireString(record.qos_algorithm_type, 'VIF QoS type'),
    qos_algorithm_params: requireOpenStringRecord(record.qos_algorithm_params, 'VIF QoS parameters'),
    locking_mode: requireEnum(record.locking_mode, new Set<VmVifPolicy['locking_mode']>(['network_default', 'locked', 'unlocked', 'disabled']), 'VIF locking mode'),
    ipv4_allowed: requireStringArray(record.ipv4_allowed, 'VIF IPv4 restrictions'),
    ipv6_allowed: requireStringArray(record.ipv6_allowed, 'VIF IPv6 restrictions'),
  }
}

const vifListResultSchema: IpcRuntimeSchema<VIFRecord[]> = {
  parse(value: unknown): VIFRecord[] {
    return requireArray(value, 'VIF list result').map(validateVifRecord)
  },
}

function validateSnapshotRecord(value: unknown): SnapshotRecord {
  const record = requireRecord(value, 'VM snapshot record')
  requireRef(record.ref, 'snapshot reference')
  requireString(record.uuid, 'snapshot UUID')
  requireString(record.name_label, 'snapshot name')
  requireString(record.name_description, 'snapshot description')
  requireString(record.snapshot_time, 'snapshot time')
  requireFiniteNumber(record.size, 'snapshot size')
  return value as SnapshotRecord
}

const snapshotListResultSchema: IpcRuntimeSchema<SnapshotRecord[]> = {
  parse(value: unknown): SnapshotRecord[] {
    return requireArray(value, 'snapshot list result').map(validateSnapshotRecord)
  },
}

const vmDestroyResultSchema: IpcRuntimeSchema<VmDestroyResult> = {
  parse(value: unknown): VmDestroyResult {
    const result = requirePlainObject(value, 'VM destroy result')
    requireExactKeys(result, ['vmDeleted', 'failedVdiRefs'], [], 'VM destroy result')
    if (requireBoolean(result.vmDeleted, 'VM deleted state') !== true) {
      return invalid('VM destroy result must confirm VM deletion')
    }
    return {
      vmDeleted: true,
      failedVdiRefs: requireArray(result.failedVdiRefs, 'failed VDI references')
        .map((entry) => requireRef(entry, 'failed VDI reference')),
    }
  },
}

const destroyArgsSchema: IpcRuntimeSchema<[string, string, VmDestroyOptions?]> = {
  parse(value: unknown): [string, string, VmDestroyOptions?] {
    const tuple = requireTuple(value, 2, 'VM destroy arguments', 1)
    const connectionId = requireNonBlankString(tuple[0], 'connection identity')
    const vmRef = requireRef(tuple[1], 'VM reference')
    if (tuple.length === 2) return [connectionId, vmRef]
    if (tuple[2] === undefined) return [connectionId, vmRef, undefined]
    const options = requirePlainObject(tuple[2], 'VM destroy options')
    requireExactKeys(options, [], ['vdiRefs', 'deleteDisks', 'intent'], 'VM destroy options')
    const parsed: VmDestroyOptions = {}
    if (options.deleteDisks !== undefined) parsed.deleteDisks = requireBoolean(options.deleteDisks, 'VM delete disks flag')
    if (options.intent !== undefined) parsed.intent = parseVmPowerIntent(options.intent)
    if (options.vdiRefs !== undefined && options.deleteDisks !== undefined) invalid('VM destroy disk options')
    if (Object.prototype.hasOwnProperty.call(options, 'vdiRefs')) {
      const refs = requireArray(options.vdiRefs, 'VM destroy VDI references')
        .map((entry) => requireRef(entry, 'VM destroy VDI reference'))
      parsed.vdiRefs = refs
    }
    return [connectionId, vmRef, parsed]
  },
}

const connectionVmRefAndNameArgsSchema: IpcRuntimeSchema<[string, string, string]> = {
  parse(value: unknown): [string, string, string] {
    const [connectionId, vmRef, name] = requireTuple(value, 3, 'VM name arguments')
    return [
      requireNonBlankString(connectionId, 'connection identity'),
      requireRef(vmRef, 'VM reference'),
      requireNonBlankString(name, 'VM name'),
    ]
  },
}

const connectionVmRefAndDescriptionArgsSchema: IpcRuntimeSchema<[string, string, string]> = {
  parse(value: unknown): [string, string, string] {
    const [connectionId, vmRef, description] = requireTuple(value, 3, 'VM description arguments')
    return [
      requireNonBlankString(connectionId, 'connection identity'),
      requireRef(vmRef, 'VM reference'),
      requireString(description, 'VM description'),
    ]
  },
}

const connectionVmRefAndPositiveIntegerArgsSchema: IpcRuntimeSchema<[string, string, number]> = {
  parse(value: unknown): [string, string, number] {
    const [connectionId, vmRef, count] = requireTuple(value, 3, 'VM positive integer arguments')
    return [
      requireNonBlankString(connectionId, 'connection identity'),
      requireRef(vmRef, 'VM reference'),
      requirePositiveInteger(count, 'VM positive integer'),
    ]
  },
}

const memoryLimitsArgsSchema: IpcRuntimeSchema<[string, string, number, number, number, number]> = {
  parse(value: unknown): [string, string, number, number, number, number] {
    const [connectionId, vmRef, sMin, dMin, dMax, sMax] = requireTuple(
      value,
      6,
      'VM memory limit arguments',
    )
    const parsed: [string, string, number, number, number, number] = [
      requireNonBlankString(connectionId, 'connection identity'),
      requireRef(vmRef, 'VM reference'),
      requireNonNegativeNumber(sMin, 'static minimum memory'),
      requireNonNegativeNumber(dMin, 'dynamic minimum memory'),
      requireNonNegativeNumber(dMax, 'dynamic maximum memory'),
      requireNonNegativeNumber(sMax, 'static maximum memory'),
    ]
    if (validateVmMemoryLimits({ staticMin: parsed[2], dynamicMin: parsed[3], dynamicMax: parsed[4], staticMax: parsed[5] })) {
      invalid('VM memory limit order')
    }
    return parsed
  },
}

const mountIsoArgsSchema: IpcRuntimeSchema<[string, string, string]> = {
  parse(value: unknown): [string, string, string] {
    const [connectionId, vmRef, isoVdiRef] = requireTuple(value, 3, 'VM mount ISO arguments')
    return [
      requireNonBlankString(connectionId, 'connection identity'),
      requireRef(vmRef, 'VM reference'),
      requireRef(isoVdiRef, 'ISO VDI reference'),
    ]
  },
}

const refResultSchema: IpcRuntimeSchema<string> = {
  parse(value: unknown): string {
    return requireRef(value, 'result reference')
  },
}

const migrateArgsSchema: IpcRuntimeSchema<[string, string, string]> = {
  parse(value: unknown): [string, string, string] {
    const [connectionId, vmRef, targetHostRef] = requireTuple(value, 3, 'VM migrate arguments')
    return [
      requireNonBlankString(connectionId, 'connection identity'),
      requireRef(vmRef, 'VM reference'),
      requireRef(targetHostRef, 'target host reference'),
    ]
  },
}

const relocationPlanArgsSchema: IpcRuntimeSchema<[string, string, string?]> = {
  parse(value: unknown): [string, string, string?] {
    const tuple = requireTuple(value, 2, 'VM relocation plan arguments', 1)
    const sourceConnectionId = requireNonBlankString(tuple[0], 'source connection identity')
    const vmRef = requireRef(tuple[1], 'VM reference')
    if (tuple.length === 2) return [sourceConnectionId, vmRef]
    if (tuple[2] === undefined) return [sourceConnectionId, vmRef, undefined]
    return [
      sourceConnectionId,
      vmRef,
      requireNonBlankString(tuple[2], 'target connection identity'),
    ]
  },
}

function parseRefMap(value: unknown, label: string): Record<string, string> {
  const record = requirePlainObject(value, label)
  const parsed: Record<string, string> = {}
  for (const [key, targetRef] of Object.entries(record)) {
    const sourceRef = requireRef(key, `${label} source reference`)
    parsed[sourceRef] = requireRef(targetRef, `${label} target reference`)
  }
  return parsed
}

function parseOptionalRef(
  source: UnknownRecord,
  key: string,
  label: string,
): string | undefined {
  const value = source[key]
  if (value === undefined) return undefined
  return requireRef(value, label)
}

function parseOptionalConnectionId(
  source: UnknownRecord,
  key: string,
  label: string,
): string | undefined {
  const value = source[key]
  if (value === undefined) return undefined
  return requireNonBlankString(value, label)
}

function parseOptionalRefMap(
  source: UnknownRecord,
  key: string,
  label: string,
): Record<string, string> | undefined {
  const value = source[key]
  if (value === undefined) return undefined
  return parseRefMap(value, label)
}

function parseRelocationPayload(value: unknown): VmRelocationPayload {
  const payload = requirePlainObject(value, 'VM relocation payload')
  requireExactKeys(
    payload,
    ['mode', 'sourceConnectionId', 'vmRef'],
    [
      'targetConnectionId',
      'targetHostRef',
      'transferNetworkRef',
      'storageMap',
      'networkMap',
    ],
    'VM relocation payload',
  )
  const parsed: VmRelocationPayload = {
    mode: requireEnum(payload.mode, RELOCATION_MODES, 'VM relocation mode'),
    sourceConnectionId: requireNonBlankString(payload.sourceConnectionId, 'source connection identity'),
    vmRef: requireRef(payload.vmRef, 'VM reference'),
  }
  for (const [key, parser, label] of [
    ['targetConnectionId', parseOptionalConnectionId, 'target connection identity'],
    ['targetHostRef', parseOptionalRef, 'target host reference'],
    ['transferNetworkRef', parseOptionalRef, 'transfer network reference'],
    ['storageMap', parseOptionalRefMap, 'storage map'],
    ['networkMap', parseOptionalRefMap, 'network map'],
  ] as const) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      Object.assign(parsed, { [key]: parser(payload, key, label) })
    }
  }

  const targetConnectionId = parsed.targetConnectionId
  const sameConnection = targetConnectionId === undefined
    || targetConnectionId === parsed.sourceConnectionId
  switch (parsed.mode) {
    case 'pool-migrate':
      if (!sameConnection || !parsed.targetHostRef) invalid('pool migration branch')
      if (parsed.transferNetworkRef || parsed.storageMap || parsed.networkMap) {
        invalid('pool migration branch')
      }
      break
    case 'storage-move':
      if (!sameConnection || parsed.targetHostRef || parsed.transferNetworkRef || !parsed.storageMap || parsed.networkMap) {
        invalid('storage move branch')
      }
      break
    case 'cross-pool-migrate':
    case 'cross-pool-copy':
      if (
        !targetConnectionId
        || sameConnection
        || !parsed.targetHostRef
        || !parsed.transferNetworkRef
        || !parsed.storageMap
        || !parsed.networkMap
      ) invalid('cross-pool relocation branch')
      break
  }
  return parsed
}

const relocateArgsSchema: IpcRuntimeSchema<[VmRelocationPayload]> = {
  parse(value: unknown): [VmRelocationPayload] {
    const [payload] = requireTuple(value, 1, 'VM relocation arguments')
    return [parseRelocationPayload(payload)]
  },
}

const relocationResultSchema: IpcRuntimeSchema<VmRelocationResult> = {
  parse(value: unknown): VmRelocationResult {
    const result = requirePlainObject(value, 'VM relocation result')
    requireExactKeys(result, [], ['taskRef', 'movedVdis', 'copyOperation'], 'VM relocation result')
    if (result.copyOperation !== undefined) {
      if (result.taskRef !== undefined || result.movedVdis !== undefined) invalid('VM relocation result branch')
      return { copyOperation: copyOperationSchema.parse(result.copyOperation) }
    }
    const hasTask = result.taskRef !== undefined
    const hasVdis = result.movedVdis !== undefined
    if (hasTask === hasVdis) invalid('VM relocation result branch')
    if (hasTask) return { taskRef: requireRef(result.taskRef, 'relocation task reference') }
    return {
      movedVdis: requireArray(result.movedVdis, 'moved VDI references')
        .map((entry) => requireRef(entry, 'moved VDI reference')),
    }
  },
}

function validateBlocker(value: unknown) {
  const record = requirePlainObject(value, 'VM relocation blocker')
  requireExactKeys(record, ['code', 'message'], [], 'VM relocation blocker')
  return {
    code: requireNonBlankString(record.code, 'relocation blocker code'),
    message: requireString(record.message, 'relocation blocker message'),
  }
}

function validateRelocationDisk(value: unknown) {
  const record = requirePlainObject(value, 'VM relocation disk')
  requireExactKeys(record, [
    'vdiRef', 'vbdRef', 'nameLabel', 'size', 'sourceSrRef',
    'userdevice', 'bootable', 'mode', 'type', 'owner',
  ], [], 'VM relocation disk')
  return {
    vdiRef: requireRef(record.vdiRef, 'relocation VDI reference'),
    vbdRef: requireRef(record.vbdRef, 'relocation VBD reference'),
    nameLabel: requireString(record.nameLabel, 'relocation disk name'),
    size: requireNonNegativeNumber(record.size, 'relocation disk size'),
    sourceSrRef: requireRef(record.sourceSrRef, 'source SR reference'),
    userdevice: requireString(record.userdevice, 'relocation disk device'),
    bootable: requireBoolean(record.bootable, 'relocation disk bootable state'),
    mode: requireString(record.mode, 'relocation disk mode'),
    type: requireString(record.type, 'relocation disk type'),
    owner: requireBoolean(record.owner, 'relocation disk owner state'),
  }
}

function validateRelocationVif(value: unknown) {
  const record = requirePlainObject(value, 'VM relocation VIF')
  requireExactKeys(
    record,
    ['vifRef', 'device', 'networkRef', 'networkName'],
    [],
    'VM relocation VIF',
  )
  return {
    vifRef: requireRef(record.vifRef, 'relocation VIF reference'),
    device: requireString(record.device, 'relocation VIF device'),
    networkRef: requireRef(record.networkRef, 'relocation network reference'),
    networkName: requireString(record.networkName, 'relocation network name'),
  }
}

function validateConnectedHost(value: unknown): ConnectedHostRecord {
  const record = requireRecord(value, 'connected host record')
  for (const [key, label] of [
    ['ref', 'host reference'], ['uuid', 'host UUID'], ['name_label', 'host name'],
    ['hostname', 'host hostname'], ['address', 'host address'], ['metrics', 'host metrics reference'],
    ['suspend_image_sr', 'host suspend image SR'], ['connectionId', 'host connection identity'],
    ['poolName', 'host pool name'],
  ] as const) requireString(record[key], label)
  requireBoolean(record.enabled, 'host enabled state')
  requireStringArray(record.resident_VMs, 'host resident VMs')
  requireFiniteNumber(record.memory_total, 'host total memory')
  requireFiniteNumber(record.memory_free, 'host free memory')
  requireOpenStringRecord(record.cpu_info, 'host CPU information')
  requireOpenStringRecord(record.software_version, 'host software version')
  return value as ConnectedHostRecord
}

function validateConnectedSr(value: unknown): ConnectedSrRecord {
  const record = requireRecord(value, 'connected SR record')
  for (const [key, label] of [
    ['ref', 'SR reference'], ['uuid', 'SR UUID'], ['name_label', 'SR name'],
    ['type', 'SR type'], ['connectionId', 'SR connection identity'], ['poolName', 'SR pool name'],
  ] as const) requireString(record[key], label)
  requireSrCapacity(record.physical_size, 'SR physical size')
  requireSrCapacity(record.physical_utilisation, 'SR physical utilisation')
  requireSrCapacity(record.virtual_allocation, 'SR virtual allocation')
  requireStringArray(record.VDIs, 'SR VDI references')
  requireBoolean(record.shared, 'SR shared state')
  return value as ConnectedSrRecord
}

function validateConnectedNetwork(value: unknown): ConnectedNetworkRecord {
  const record = requireRecord(value, 'connected network record')
  for (const [key, label] of [
    ['ref', 'network reference'], ['uuid', 'network UUID'], ['name_label', 'network name'],
    ['name_description', 'network description'], ['bridge', 'network bridge'],
    ['connectionId', 'network connection identity'], ['poolName', 'network pool name'],
  ] as const) requireString(record[key], label)
  requireStringArray(record.VIFs, 'network VIF references')
  requireStringArray(record.PIFs, 'network PIF references')
  requireFiniteNumber(record.MTU, 'network MTU')
  return value as ConnectedNetworkRecord
}

const relocationPlanResultSchema: IpcRuntimeSchema<VmRelocationPlan> = {
  parse(value: unknown): VmRelocationPlan {
    const result = requirePlainObject(value, 'VM relocation plan')
    requireExactKeys(result, [
      'sourceConnectionId', 'targetConnectionId', 'vmRef', 'vmName', 'powerState',
      'allowedModes', 'blockers', 'warnings', 'disks', 'vifs', 'sourceHosts',
      'targetHosts', 'sourceSrs', 'targetSrs', 'sourceNetworks', 'targetNetworks',
    ], [], 'VM relocation plan')
    return {
      sourceConnectionId: requireNonBlankString(result.sourceConnectionId, 'source connection identity'),
      targetConnectionId: requireNonBlankString(result.targetConnectionId, 'target connection identity'),
      vmRef: requireRef(result.vmRef, 'VM reference'),
      vmName: requireString(result.vmName, 'VM name'),
      powerState: requireEnum(result.powerState, POWER_STATES, 'VM power state'),
      allowedModes: requireArray(result.allowedModes, 'allowed relocation modes')
        .map((mode) => requireEnum(mode, RELOCATION_MODES, 'allowed relocation mode')),
      blockers: requireArray(result.blockers, 'relocation blockers').map(validateBlocker),
      warnings: requireArray(result.warnings, 'relocation warnings').map(validateBlocker),
      disks: requireArray(result.disks, 'relocation disks').map(validateRelocationDisk),
      vifs: requireArray(result.vifs, 'relocation VIFs').map(validateRelocationVif),
      sourceHosts: requireArray(result.sourceHosts, 'source hosts').map(validateConnectedHost),
      targetHosts: requireArray(result.targetHosts, 'target hosts').map(validateConnectedHost),
      sourceSrs: requireArray(result.sourceSrs, 'source SRs').map(validateConnectedSr),
      targetSrs: requireArray(result.targetSrs, 'target SRs').map(validateConnectedSr),
      sourceNetworks: requireArray(result.sourceNetworks, 'source networks').map(validateConnectedNetwork),
      targetNetworks: requireArray(result.targetNetworks, 'target networks').map(validateConnectedNetwork),
    }
  },
}

function parseOptionalStringProperty(
  source: UnknownRecord,
  key: string,
  label: string,
): string | undefined {
  const value = source[key]
  if (value === undefined) return undefined
  return requireString(value, label)
}

function parseCopyPayload(value: unknown): VmCopyPayload {
  const payload = requirePlainObject(value, 'VM copy payload')
  requireExactKeys(
    payload,
    ['vmRef', 'newName'],
    ['nameDescription', 'mode', 'targetSrRef', 'targetConnectionId', 'targetHostRef', 'transferNetworkRef', 'storageMap', 'networkMap'],
    'VM copy payload',
  )
  const parsed: VmCopyPayload = {
    vmRef: requireRef(payload.vmRef, 'VM reference'),
    newName: requireNonBlankString(payload.newName, 'VM copy name'),
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'nameDescription')) {
    parsed.nameDescription = parseOptionalStringProperty(payload, 'nameDescription', 'VM copy description')
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'mode')) {
    parsed.mode = payload.mode === undefined
      ? undefined
      : requireEnum(payload.mode, COPY_MODES, 'VM copy mode')
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'targetSrRef')) {
    parsed.targetSrRef = parseOptionalRef(payload, 'targetSrRef', 'target SR reference')
  }
  for (const [key, parser] of [
    ['targetConnectionId', parseOptionalConnectionId], ['targetHostRef', parseOptionalRef],
    ['transferNetworkRef', parseOptionalRef], ['storageMap', parseOptionalRefMap], ['networkMap', parseOptionalRefMap],
  ] as const) {
    if (payload[key] !== undefined) Object.assign(parsed, { [key]: parser(payload, key, key) })
  }
  if (parsed.mode === 'cross-pool-copy') {
    if (!parsed.targetConnectionId || !parsed.targetHostRef || !parsed.transferNetworkRef || !parsed.storageMap || !parsed.networkMap || parsed.targetSrRef) invalid('cross-pool copy branch')
    return parsed
  }
  if (parsed.targetHostRef || parsed.transferNetworkRef || parsed.storageMap || parsed.networkMap) invalid('same-pool copy branch')
  const effectiveMode = parsed.mode ?? (parsed.targetSrRef ? 'copy' : 'clone')
  if (
    (effectiveMode === 'copy' && !parsed.targetSrRef)
    || (parsed.mode === 'clone' && parsed.targetSrRef)
  ) invalid('VM copy branch')
  return parsed
}

const copyArgsSchema: IpcRuntimeSchema<[string, VmCopyPayload]> = {
  parse(value: unknown): [string, VmCopyPayload] {
    const [connectionId, payload] = requireTuple(value, 2, 'VM copy arguments')
    return [
      requireNonBlankString(connectionId, 'connection identity'),
      parseCopyPayload(payload),
    ]
  },
}

function parseWizardDisk(value: unknown): WizardDisk {
  const disk = requirePlainObject(value, 'VM wizard disk')
  requireExactKeys(
    disk,
    ['templateVdiRef', 'srRef', 'sizeBytes'],
    ['device', 'bootable', 'type', 'mode'],
    'VM wizard disk',
  )
  const sizeBytes = requireFiniteNumber(disk.sizeBytes, 'VM wizard disk size')
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) invalid('VM wizard disk size')
  const parsed: WizardDisk = {
    templateVdiRef: requireString(disk.templateVdiRef, 'template VDI reference'),
    srRef: requireString(disk.srRef, 'VM wizard SR reference'),
    sizeBytes,
  }
  if (Object.prototype.hasOwnProperty.call(disk, 'device')) {
    parsed.device = disk.device === undefined ? undefined : requireString(disk.device, 'VM wizard disk device')
  }
  if (Object.prototype.hasOwnProperty.call(disk, 'bootable')) {
    parsed.bootable = disk.bootable === undefined ? undefined : requireBoolean(disk.bootable, 'VM wizard disk bootable state')
  }
  if (Object.prototype.hasOwnProperty.call(disk, 'type')) {
    parsed.type = disk.type === undefined ? undefined : requireString(disk.type, 'VM wizard disk type')
  }
  if (disk.mode !== undefined) parsed.mode = requireEnum(disk.mode, new Set<'RW' | 'RO'>(['RW', 'RO']), 'disk mode')
  return parsed
}

function parseWizardVif(value: unknown): WizardVif {
  const vif = requirePlainObject(value, 'VM wizard VIF')
  requireExactKeys(vif, ['networkRef'], ['device', 'networkName', 'policy'], 'VM wizard VIF')
  const parsed: WizardVif = { networkRef: requireRef(vif.networkRef, 'VM wizard network reference') }
  if (Object.prototype.hasOwnProperty.call(vif, 'device')) {
    parsed.device = vif.device === undefined ? undefined : requireString(vif.device, 'VM wizard VIF device')
  }
  if (Object.prototype.hasOwnProperty.call(vif, 'networkName')) {
    parsed.networkName = vif.networkName === undefined
      ? undefined
      : requireString(vif.networkName, 'VM wizard network name')
  }
  if (vif.policy !== undefined) parsed.policy = parseVifPolicy(vif.policy)
  return parsed
}

function parseWizardPayload(value: unknown): VmWizardPayload {
  const payload = requirePlainObject(value, 'VM wizard payload')
  requireExactKeys(payload, [
    'templateRef', 'vmName', 'vmDescription', 'vcpus', 'memoryBytes',
    'installMode', 'disks', 'vifs', 'startAfter',
  ], ['isoRef', 'targetHostRef', 'targetSrRef', 'installUrl'], 'VM wizard payload')
  const memoryBytes = requireFiniteNumber(payload.memoryBytes, 'VM memory')
  if (!Number.isSafeInteger(memoryBytes) || memoryBytes <= 0) invalid('VM memory')
  const parsed: VmWizardPayload = {
    templateRef: requireRef(payload.templateRef, 'template reference'),
    vmName: requireNonBlankString(payload.vmName, 'VM name'),
    vmDescription: requireString(payload.vmDescription, 'VM description'),
    vcpus: requirePositiveInteger(payload.vcpus, 'VM VCPU count'),
    memoryBytes,
    installMode: requireEnum(payload.installMode, INSTALL_MODES, 'VM install mode'),
    disks: requireArray(payload.disks, 'VM wizard disks').map(parseWizardDisk),
    vifs: requireArray(payload.vifs, 'VM wizard VIFs').map(parseWizardVif),
    startAfter: requireBoolean(payload.startAfter, 'VM start-after-create state'),
  }
  if (payload.installUrl !== undefined) parsed.installUrl = requireString(payload.installUrl, 'installation URL')
  for (const [key, label] of [
    ['isoRef', 'ISO reference'],
    ['targetHostRef', 'target host reference'],
    ['targetSrRef', 'target SR reference'],
  ] as const) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      Object.assign(parsed, { [key]: parseOptionalRef(payload, key, label) })
    }
  }
  if (parsed.installMode === 'iso' && !parsed.isoRef) invalid('ISO install branch')
  if (parsed.installMode !== 'iso' && parsed.isoRef) invalid('non-ISO install branch')
  if (parsed.installMode === 'url' && !parsed.installUrl?.trim()) invalid('URL installation branch')
  if (parsed.installMode !== 'url' && parsed.installUrl) invalid('non-URL installation branch')
  for (const disk of parsed.disks) {
    if (disk.srRef || parsed.installMode !== 'none') requireRef(disk.srRef, 'VM wizard SR reference')
    if (disk.templateVdiRef) requireRef(disk.templateVdiRef, 'template VDI reference')
  }
  return parsed
}

const createFromTemplateArgsSchema: IpcRuntimeSchema<[string, VmWizardPayload]> = {
  parse(value: unknown): [string, VmWizardPayload] {
    const [connectionId, payload] = requireTuple(value, 2, 'VM creation arguments')
    return [
      requireNonBlankString(connectionId, 'connection identity'),
      parseWizardPayload(payload),
    ]
  },
}

function parseTemplateClonePayload(value: unknown): TemplateClonePayload {
  const payload = requirePlainObject(value, 'template clone payload')
  requireExactKeys(payload, ['templateRef', 'newName'], ['targetSrRef'], 'template clone payload')
  const parsed: TemplateClonePayload = {
    templateRef: requireRef(payload.templateRef, 'template reference'),
    newName: requireNonBlankString(payload.newName, 'template clone name'),
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'targetSrRef')) {
    parsed.targetSrRef = parseOptionalRef(payload, 'targetSrRef', 'target SR reference')
  }
  return parsed
}

const templateCloneArgsSchema: IpcRuntimeSchema<[string, TemplateClonePayload]> = {
  parse(value: unknown): [string, TemplateClonePayload] {
    const [connectionId, payload] = requireTuple(value, 2, 'template clone arguments')
    return [
      requireNonBlankString(connectionId, 'connection identity'),
      parseTemplateClonePayload(payload),
    ]
  },
}

function parseTemplateDeletePayload(value: unknown): TemplateDeletePayload {
  const payload = requirePlainObject(value, 'template delete payload')
  requireExactKeys(payload, ['templateRef', 'deleteDisks'], [], 'template delete payload')
  return {
    templateRef: requireRef(payload.templateRef, 'template reference'),
    deleteDisks: requireBoolean(payload.deleteDisks, 'template disk deletion state'),
  }
}

const templateDeleteArgsSchema: IpcRuntimeSchema<[string, TemplateDeletePayload]> = {
  parse(value: unknown): [string, TemplateDeletePayload] {
    const [connectionId, payload] = requireTuple(value, 2, 'template delete arguments')
    return [
      requireNonBlankString(connectionId, 'connection identity'),
      parseTemplateDeletePayload(payload),
    ]
  },
}

function parseOptionalTemplateNumber(
  payload: UnknownRecord,
  key: keyof TemplateSettingsPayload,
  integer: boolean,
): number | undefined {
  const value = payload[key]
  if (value === undefined) return undefined
  return integer
    ? requirePositiveInteger(value, `template ${key}`)
    : requireNonNegativeNumber(value, `template ${key}`)
}

function parseTemplateSettingsPayload(value: unknown): TemplateSettingsPayload {
  const payload = requirePlainObject(value, 'template settings payload')
  const optionalKeys = [
    'nameLabel', 'nameDescription', 'vcpusMax', 'vcpusAtStartup',
    'memoryStaticMax', 'memoryDynamicMax', 'memoryDynamicMin', 'memoryStaticMin',
  ] as const
  requireExactKeys(payload, ['templateRef'], optionalKeys, 'template settings payload')
  const parsed: TemplateSettingsPayload = {
    templateRef: requireRef(payload.templateRef, 'template reference'),
  }
  for (const key of ['nameLabel', 'nameDescription'] as const) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      parsed[key] = payload[key] === undefined
        ? undefined
        : requireString(payload[key], `template ${key}`)
    }
  }
  for (const key of ['vcpusMax', 'vcpusAtStartup'] as const) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      parsed[key] = parseOptionalTemplateNumber(payload, key, true)
    }
  }
  for (const key of [
    'memoryStaticMax', 'memoryDynamicMax', 'memoryDynamicMin', 'memoryStaticMin',
  ] as const) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      parsed[key] = parseOptionalTemplateNumber(payload, key, false)
    }
  }
  if (
    parsed.vcpusMax !== undefined
    && parsed.vcpusAtStartup !== undefined
    && parsed.vcpusAtStartup > parsed.vcpusMax
  ) invalid('template VCPU order')
  for (const [lower, upper] of [
    ['memoryStaticMin', 'memoryDynamicMin'],
    ['memoryDynamicMin', 'memoryDynamicMax'],
    ['memoryDynamicMax', 'memoryStaticMax'],
  ] as const) {
    if (
      parsed[lower] !== undefined
      && parsed[upper] !== undefined
      && parsed[lower] > parsed[upper]
    ) invalid('template memory limit order')
  }
  return parsed
}

const templateSettingsArgsSchema: IpcRuntimeSchema<[string, TemplateSettingsPayload]> = {
  parse(value: unknown): [string, TemplateSettingsPayload] {
    const [connectionId, payload] = requireTuple(value, 2, 'template settings arguments')
    return [
      requireNonBlankString(connectionId, 'connection identity'),
      parseTemplateSettingsPayload(payload),
    ]
  },
}

function parseExportParams(value: unknown): VmExportParams {
  const payload = requirePlainObject(value, 'VM export payload')
  requireExactKeys(
    payload,
    ['vmRef', 'filePath', 'powerState', 'exportMode'],
    ['useCompression'],
    'VM export payload',
  )
  const parsed: VmExportParams = {
    vmRef: requireRef(payload.vmRef, 'VM reference'),
    filePath: requireNonBlankString(payload.filePath, 'XVA export path'),
    powerState: requireEnum(payload.powerState, POWER_STATES, 'VM export power state'),
    exportMode: requireEnum(payload.exportMode, EXPORT_MODES, 'VM export mode'),
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'useCompression')) {
    parsed.useCompression = payload.useCompression === undefined
      ? undefined
      : requireBoolean(payload.useCompression, 'XVA compression state')
  }
  return parsed
}

const exportArgsSchema: IpcRuntimeSchema<[string, VmExportParams]> = {
  parse(value: unknown): [string, VmExportParams] {
    const [connectionId, payload] = requireTuple(value, 2, 'VM export arguments')
    return [
      requireNonBlankString(connectionId, 'connection identity'),
      parseExportParams(payload),
    ]
  },
}

const exportResultSchema: IpcRuntimeSchema<{ exportId: string; estimatedBytes: number }> = {
  parse(value: unknown): { exportId: string; estimatedBytes: number } {
    const result = requirePlainObject(value, 'VM export result')
    requireExactKeys(result, ['exportId', 'estimatedBytes'], [], 'VM export result')
    return {
      exportId: requireNonBlankString(result.exportId, 'export identity'),
      estimatedBytes: requireNonNegativeNumber(result.estimatedBytes, 'estimated export bytes'),
    }
  },
}

function parseVifMappings(value: unknown): Record<string, string> {
  const mappings = requirePlainObject(value, 'XVA VIF mappings')
  const parsed: Record<string, string> = {}
  for (const [device, target] of Object.entries(mappings)) {
    const parsedDevice = requireNonBlankString(device, 'XVA VIF device')
    const networkRef = requireString(target, 'XVA target network reference')
    parsed[parsedDevice] = networkRef === ''
      ? ''
      : requireRef(networkRef, 'XVA target network reference')
  }
  return parsed
}

function parseImportParams(value: unknown): VmImportParams {
  const payload = requirePlainObject(value, 'VM import payload')
  requireExactKeys(payload, [
    'filePath', 'srRef', 'vifMappings',
  ], ['homeServerRef', 'nameLabel', 'nameDescription', 'originPoolUuid', 'originEpoch'], 'VM import payload')
  const parsed: VmImportParams = {
    filePath: requireNonBlankString(payload.filePath, 'XVA import path'),
    srRef: requireRef(payload.srRef, 'target SR reference'),
    vifMappings: parseVifMappings(payload.vifMappings),
  }
  if (payload.originPoolUuid !== undefined) parsed.originPoolUuid = requireNonBlankString(payload.originPoolUuid, 'origin pool UUID')
  if (payload.originEpoch !== undefined) parsed.originEpoch = requireNonNegativeNumber(payload.originEpoch, 'origin connection epoch')
  if (Object.prototype.hasOwnProperty.call(payload, 'homeServerRef')) {
    parsed.homeServerRef = payload.homeServerRef === null
      ? null
      : requireRef(payload.homeServerRef, 'home server reference')
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'nameLabel')) {
    parsed.nameLabel = requireNonBlankString(payload.nameLabel, 'imported VM name')
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'nameDescription')) {
    parsed.nameDescription = requireString(payload.nameDescription, 'imported VM description')
  }
  return parsed
}

const importArgsSchema: IpcRuntimeSchema<[string, VmImportParams]> = {
  parse(value: unknown): [string, VmImportParams] {
    const [connectionId, payload] = requireTuple(value, 2, 'VM import arguments')
    return [
      requireNonBlankString(connectionId, 'connection identity'),
      parseImportParams(payload),
    ]
  },
}

const nonBlankStringArgsSchema: IpcRuntimeSchema<[string]> = {
  parse(value: unknown): [string] {
    const [identity] = requireTuple(value, 1, 'VM operation identity arguments')
    return [requireNonBlankString(identity, 'VM operation identity')]
  },
}

const nonBlankStringResultSchema: IpcRuntimeSchema<string> = {
  parse(value: unknown): string {
    return requireNonBlankString(value, 'VM operation identity result')
  },
}

const connectionAndOperationIdArgsSchema: IpcRuntimeSchema<[string, string]> = {
  parse(value: unknown): [string, string] {
    const [connectionId, operationId] = requireTuple(value, 2, 'VM operation arguments')
    return [
      requireNonBlankString(connectionId, 'connection identity'),
      requireNonBlankString(operationId, 'VM operation identity'),
    ]
  },
}

function requireProgress(value: unknown, label: string): number {
  const result = requireFiniteNumber(value, label)
  if (result !== -1 && (result < 0 || result > 100)) invalid(label)
  return result
}

function parseTransferMetrics(value: unknown): VmTransferMetrics {
  const result = requirePlainObject(value, 'transfer metrics')
  requireExactKeys(result, ['bytesTransferred', 'bytesTotal', 'elapsedMs'], [], 'transfer metrics')
  const bytesTransferred = requireNonNegativeNumber(result.bytesTransferred, 'transferred bytes')
  const bytesTotal = requireNonNegativeNumber(result.bytesTotal, 'transfer total bytes')
  if (!Number.isSafeInteger(bytesTransferred) || !Number.isSafeInteger(bytesTotal)) invalid('transfer byte count')
  return { bytesTransferred, bytesTotal, elapsedMs: requireNonNegativeNumber(result.elapsedMs, 'transfer elapsed time') }
}

function parseValidationProgress(value: unknown): NonNullable<VmImportOperation['validation']> {
  const validation = requirePlainObject(value, 'XVA validation progress')
  requireExactKeys(validation, ['bytesChecked', 'bytesTotal', 'elapsedMs'], [], 'XVA validation progress')
  const bytesChecked = requireNonNegativeNumber(validation.bytesChecked, 'XVA checked bytes')
  const bytesTotal = requirePositiveInteger(validation.bytesTotal, 'XVA total bytes')
  if (!Number.isSafeInteger(bytesChecked) || !Number.isSafeInteger(bytesTotal) || bytesChecked > bytesTotal) invalid('XVA validation byte range')
  return { bytesChecked, bytesTotal, elapsedMs: requireNonNegativeNumber(validation.elapsedMs, 'XVA validation elapsed time') }
}

const importPreviewResultSchema: IpcRuntimeSchema<VmImportPreview> = {
  parse(value: unknown): VmImportPreview {
    const result = requirePlainObject(value, 'VM import preview')
    requireExactKeys(result, [
      'vmName', 'originalSize', 'diskCount', 'exportTime', 'vifs',
      'isTemplate', 'vcpus', 'memory', 'isHvm', 'description',
    ], ['powerState', 'suspendDiskSize'], 'VM import preview')
    return {
      vmName: requireString(result.vmName, 'preview VM name'),
      originalSize: requireNonNegativeNumber(result.originalSize, 'preview original size'),
      diskCount: requireNonNegativeNumber(result.diskCount, 'preview disk count'),
      exportTime: requireString(result.exportTime, 'preview export time'),
      vifs: requireArray(result.vifs, 'preview VIFs').map((entry) => {
        const vif = requirePlainObject(entry, 'preview VIF')
        requireExactKeys(vif, ['device', 'sourceNetworkName'], [], 'preview VIF')
        return {
          device: requireString(vif.device, 'preview VIF device'),
          sourceNetworkName: requireString(vif.sourceNetworkName, 'preview source network name'),
        }
      }),
      isTemplate: requireBoolean(result.isTemplate, 'preview template state'),
      vcpus: requireNonNegativeNumber(result.vcpus, 'preview VCPU count'),
      memory: requireNonNegativeNumber(result.memory, 'preview memory'),
      isHvm: requireBoolean(result.isHvm, 'preview HVM state'),
      description: requireString(result.description, 'preview description'),
      ...(result.powerState === undefined ? {} : { powerState: requireEnum(result.powerState, new Set<'Halted' | 'Suspended'>(['Halted', 'Suspended']), 'preview power state') }),
      ...(result.suspendDiskSize === undefined ? {} : { suspendDiskSize: requireNonNegativeNumber(result.suspendDiskSize, 'preview suspend disk size') }),
    }
  },
}

function parseOptionalProgressString(
  result: UnknownRecord,
  key: string,
  label: string,
): string | undefined {
  if (result[key] === undefined) return undefined
  return requireString(result[key], label)
}

const importProgressResultSchema: IpcRuntimeSchema<VmImportOperation | null> = {
  parse(value: unknown): VmImportOperation | null {
    if (value === null) return null
    const result = requirePlainObject(value, 'VM import progress')
    requireExactKeys(result, [
      'operationId', 'taskRef', 'status', 'progress', 'message', 'lastUpdatedAt',
    ], ['vmRef', 'errorCode', 'warnings', 'connectionId', 'poolUuid', 'validation', 'transfer'], 'VM import progress')
    const taskRef = result.taskRef === null
      ? null
      : requireRef(result.taskRef, 'import task reference')
    const parsed: VmImportOperation = {
      operationId: requireNonBlankString(result.operationId, 'import operation identity'),
      taskRef,
      status: requireEnum(result.status, IMPORT_OPERATION_STATUSES, 'import operation status'),
      progress: requireProgress(result.progress, 'import operation progress'),
      message: requireString(result.message, 'import progress message'),
      lastUpdatedAt: requireNonNegativeNumber(result.lastUpdatedAt, 'import update timestamp'),
    }
    for (const key of ['vmRef', 'errorCode', 'connectionId', 'poolUuid'] as const) {
      if (Object.prototype.hasOwnProperty.call(result, key)) {
        parsed[key] = parseOptionalProgressString(result, key, `import ${key}`)
      }
    }
    if (Object.prototype.hasOwnProperty.call(result, 'warnings')) {
      parsed.warnings = result.warnings === undefined
        ? undefined
        : requireStringArray(result.warnings, 'import warnings')
    }
    if (result.validation !== undefined) {
      parsed.validation = parseValidationProgress(result.validation)
    }
    if (result.transfer !== undefined) parsed.transfer = parseTransferMetrics(result.transfer)
    return parsed
  },
}

const transferProgressResultSchema: IpcRuntimeSchema<VmTransferProgress | null> = {
  parse(value: unknown): VmTransferProgress | null {
    if (value === null) return null
    const result = requirePlainObject(value, 'VM export progress')
    requireExactKeys(result, ['taskId', 'progress', 'status', 'message', 'lastUpdatedAt'], [
      'bytesTransferred', 'bytesTotal', 'cleanupPending', 'warnings', 'connectionId', 'poolUuid',
      'phase', 'transfer', 'validation',
    ], 'VM export progress')
    const parsed: VmTransferProgress = {
      taskId: requireNonBlankString(result.taskId, 'export task identity'),
      progress: requireProgress(result.progress, 'export progress'),
      status: requireEnum(result.status, TRANSFER_STATUSES, 'export status'),
      message: requireString(result.message, 'export progress message'),
      lastUpdatedAt: requireNonNegativeNumber(result.lastUpdatedAt, 'export update timestamp'),
    }
    if (result.connectionId !== undefined) parsed.connectionId = requireNonBlankString(result.connectionId, 'export connection identity')
    if (result.poolUuid !== undefined) parsed.poolUuid = requireNonBlankString(result.poolUuid, 'export pool UUID')
    if (result.cleanupPending !== undefined) parsed.cleanupPending = requireBoolean(result.cleanupPending, 'export cleanup pending')
    if (result.warnings !== undefined) parsed.warnings = requireStringArray(result.warnings, 'export warnings')
    if (result.phase !== undefined) parsed.phase = requireEnum(result.phase, new Set<NonNullable<VmTransferProgress['phase']>>(['preparing', 'transferring', 'validating', 'waiting_for_task', 'cleanup']), 'export phase')
    if (result.transfer !== undefined) parsed.transfer = parseTransferMetrics(result.transfer)
    if (result.validation !== undefined) parsed.validation = parseValidationProgress(result.validation)
    for (const key of ['bytesTransferred', 'bytesTotal'] as const) {
      if (Object.prototype.hasOwnProperty.call(result, key)) {
        parsed[key] = result[key] === undefined
          ? undefined
          : requireNonNegativeNumber(result[key], `export ${key}`)
      }
    }
    return parsed
  },
}

const invokeBoundary = {
  errorShape: 'ipc-error-response-v1' as const,
  callerPolicy: 'app-window-main-frame' as const,
  redaction: ['none'] as const,
}

export const vmListContract = defineInvokeContract({
  channel: Ch.VM_LIST,
  argsSchema: connectionIdArgsSchema,
  resultSchema: connectedVmListResultSchema,
  ...invokeBoundary,
})

export const vmTemplatesContract = defineInvokeContract({
  channel: Ch.VM_TEMPLATES,
  argsSchema: connectionIdArgsSchema,
  resultSchema: templatesResultSchema,
  ...invokeBoundary,
})

export const vmCreationResourcesContract = defineInvokeContract({
  channel: Ch.VM_CREATION_RESOURCES,
  argsSchema: {
    parse(value: unknown): [string, string?] {
      const args = requireArray(value, 'creation resources arguments')
      if (args.length < 1 || args.length > 2) invalid('creation resources arguments')
      const connectionId = requireNonBlankString(args[0], 'connection identity')
      return args.length === 1 ? [connectionId] : [connectionId, requireRef(args[1], 'template reference')]
    },
  },
  resultSchema: creationResourcesResultSchema,
  ...invokeBoundary,
})

export const vmGetRecordContract = defineInvokeContract({
  channel: Ch.VM_GET_RECORD,
  argsSchema: connectionAndVmRefArgsSchema,
  resultSchema: vmDetailResultSchema,
  ...invokeBoundary,
})

export const vmGetVbdsContract = defineInvokeContract({
  channel: Ch.VM_GET_VBDS,
  argsSchema: connectionAndVmRefArgsSchema,
  resultSchema: vbdListResultSchema,
  ...invokeBoundary,
})

export const vmGetCdDriveContract = defineInvokeContract({
  channel: Ch.VM_GET_CD_DRIVE,
  argsSchema: connectionAndVmRefArgsSchema,
  resultSchema: cdDriveResultSchema,
  ...invokeBoundary,
})

export const vmGetVifsContract = defineInvokeContract({
  channel: Ch.VM_GET_VIFS,
  argsSchema: connectionAndVmRefArgsSchema,
  resultSchema: vifListResultSchema,
  ...invokeBoundary,
})

export const vmGetSnapshotsContract = defineInvokeContract({
  channel: Ch.VM_GET_SNAPSHOTS,
  argsSchema: connectionAndVmRefArgsSchema,
  resultSchema: snapshotListResultSchema,
  ...invokeBoundary,
})

export const vmReadContracts = [
  vmListContract,
  vmTemplatesContract,
  vmCreationResourcesContract,
  vmGetRecordContract,
  vmGetVbdsContract,
  vmGetCdDriveContract,
  vmGetVifsContract,
  vmGetSnapshotsContract,
] as const

export const vmStartContract = defineInvokeContract({
  channel: Ch.VM_START,
  argsSchema: vmPowerArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const vmShutdownContract = defineInvokeContract({
  channel: Ch.VM_SHUTDOWN,
  argsSchema: vmPowerArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const vmForceShutdownContract = defineInvokeContract({
  channel: Ch.VM_FORCE_SHUTDOWN,
  argsSchema: vmPowerArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const vmRebootContract = defineInvokeContract({
  channel: Ch.VM_REBOOT,
  argsSchema: vmPowerArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const vmPauseContract = defineInvokeContract({
  channel: Ch.VM_PAUSE,
  argsSchema: vmPowerArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const vmUnpauseContract = defineInvokeContract({
  channel: Ch.VM_UNPAUSE,
  argsSchema: vmPowerArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const vmSuspendContract = defineInvokeContract({
  channel: Ch.VM_SUSPEND,
  argsSchema: vmPowerArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const vmResumeContract = defineInvokeContract({
  channel: Ch.VM_RESUME,
  argsSchema: vmPowerArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const vmDestroyContract = defineInvokeContract({
  channel: Ch.VM_DESTROY,
  argsSchema: destroyArgsSchema,
  resultSchema: vmDestroyResultSchema,
  ...invokeBoundary,
})

export const vmSnapshotContract = defineInvokeContract({
  channel: Ch.VM_SNAPSHOT,
  argsSchema: connectionVmRefAndNameArgsSchema,
  resultSchema: refResultSchema,
  ...invokeBoundary,
})

export const vmSetNameLabelContract = defineInvokeContract({
  channel: Ch.VM_SET_NAME_LABEL,
  argsSchema: connectionVmRefAndNameArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const vmSetNameDescriptionContract = defineInvokeContract({
  channel: Ch.VM_SET_NAME_DESCRIPTION,
  argsSchema: connectionVmRefAndDescriptionArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const vmSetVcpusContract = defineInvokeContract({
  channel: Ch.VM_SET_VCPUS,
  argsSchema: connectionVmRefAndPositiveIntegerArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const vmSetMemoryLimitsContract = defineInvokeContract({
  channel: Ch.VM_SET_MEMORY_LIMITS,
  argsSchema: memoryLimitsArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const vmPlugVbdContract = defineInvokeContract({
  channel: Ch.VM_PLUG_VBD,
  argsSchema: connectionAndVmRefArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const vmUnplugVbdContract = defineInvokeContract({
  channel: Ch.VM_UNPLUG_VBD,
  argsSchema: connectionAndVmRefArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const vmDetachVbdContract = defineInvokeContract({
  channel: Ch.VM_DETACH_VBD,
  argsSchema: connectionAndVmRefArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const vmMountIsoContract = defineInvokeContract({
  channel: Ch.VM_MOUNT_ISO,
  argsSchema: mountIsoArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const vmEjectIsoContract = defineInvokeContract({
  channel: Ch.VM_EJECT_ISO,
  argsSchema: connectionAndVmRefArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const vmLifecycleComputeDeviceContracts = [
  vmStartContract,
  vmShutdownContract,
  vmForceShutdownContract,
  vmRebootContract,
  vmPauseContract,
  vmUnpauseContract,
  vmSuspendContract,
  vmResumeContract,
  vmDestroyContract,
  vmSnapshotContract,
  vmSetNameLabelContract,
  vmSetNameDescriptionContract,
  vmSetVcpusContract,
  vmSetMemoryLimitsContract,
  vmPlugVbdContract,
  vmUnplugVbdContract,
  vmDetachVbdContract,
  vmMountIsoContract,
  vmEjectIsoContract,
] as const

export const vmMigrateContract = defineInvokeContract({
  channel: Ch.VM_MIGRATE,
  argsSchema: migrateArgsSchema,
  resultSchema: relocationResultSchema,
  ...invokeBoundary,
})

export const vmGetRelocationPlanContract = defineInvokeContract({
  channel: Ch.VM_GET_RELOCATION_PLAN,
  argsSchema: relocationPlanArgsSchema,
  resultSchema: relocationPlanResultSchema,
  ...invokeBoundary,
})

export const vmRelocateContract = defineInvokeContract({
  channel: Ch.VM_RELOCATE,
  argsSchema: relocateArgsSchema,
  resultSchema: relocationResultSchema,
  ...invokeBoundary,
})

export const vmCopyContract = defineInvokeContract({
  channel: Ch.VM_COPY,
  argsSchema: copyArgsSchema,
  resultSchema: copyOperationSchema,
  ...invokeBoundary,
})

export const vmCreateFromTemplateContract = defineInvokeContract({
  channel: Ch.VM_CREATE_FROM_TEMPLATE,
  argsSchema: createFromTemplateArgsSchema,
  resultSchema: refResultSchema,
  ...invokeBoundary,
})

export const vmQuickCreateFromTemplateContract = defineInvokeContract({
  channel: Ch.VM_QUICK_CREATE_FROM_TEMPLATE,
  argsSchema: connectionAndVmRefArgsSchema,
  resultSchema: refResultSchema,
  ...invokeBoundary,
})

export const vmRelocationCreationContracts = [
  vmMigrateContract,
  vmGetRelocationPlanContract,
  vmRelocateContract,
  vmCopyContract,
  vmCopyPlanContract,
  vmCopyOperationsContract,
  vmCancelCopyContract,
  vmCreateFromTemplateContract,
  vmQuickCreateFromTemplateContract,
] as const

export const vmRevertSnapshotContract = defineInvokeContract({
  channel: Ch.VM_REVERT_SNAPSHOT,
  argsSchema: connectionAndVmRefArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const vmDeleteSnapshotContract = defineInvokeContract({
  channel: Ch.VM_DELETE_SNAPSHOT,
  argsSchema: connectionAndVmRefArgsSchema,
  resultSchema: vmDestroyResultSchema,
  ...invokeBoundary,
})

export const vmRenameSnapshotContract = defineInvokeContract({
  channel: Ch.VM_RENAME_SNAPSHOT,
  argsSchema: connectionVmRefAndNameArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const vmMarkAsTemplateContract = defineInvokeContract({
  channel: Ch.VM_MARK_AS_TEMPLATE,
  argsSchema: connectionAndVmRefArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const templateCloneContract = defineInvokeContract({
  channel: Ch.TEMPLATE_CLONE,
  argsSchema: templateCloneArgsSchema,
  resultSchema: copyOperationSchema,
  ...invokeBoundary,
})

export const templateDeleteContract = defineInvokeContract({
  channel: Ch.TEMPLATE_DELETE,
  argsSchema: templateDeleteArgsSchema,
  resultSchema: vmDestroyResultSchema,
  ...invokeBoundary,
})

export const templateUpdateSettingsContract = defineInvokeContract({
  channel: Ch.TEMPLATE_UPDATE_SETTINGS,
  argsSchema: templateSettingsArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const templateEnableInstantCreateContract = defineInvokeContract({
  channel: Ch.TEMPLATE_ENABLE_INSTANT_CREATE,
  argsSchema: connectionAndVmRefArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const vmSnapshotTemplateContracts = [
  vmRevertSnapshotContract,
  vmDeleteSnapshotContract,
  vmRenameSnapshotContract,
  vmMarkAsTemplateContract,
  templateCloneContract,
  templateDeleteContract,
  templateUpdateSettingsContract,
  templateEnableInstantCreateContract,
] as const

export const vmExportContract = defineInvokeContract({
  channel: Ch.VM_EXPORT,
  argsSchema: exportArgsSchema,
  resultSchema: exportResultSchema,
  ...invokeBoundary,
})

export const vmImportContract = defineInvokeContract({
  channel: Ch.VM_IMPORT,
  argsSchema: importArgsSchema,
  resultSchema: nonBlankStringResultSchema,
  ...invokeBoundary,
})

export const vmImportGetPreviewContract = defineInvokeContract({
  channel: Ch.VM_IMPORT_GET_PREVIEW,
  argsSchema: nonBlankStringArgsSchema,
  resultSchema: importPreviewResultSchema,
  ...invokeBoundary,
})

export const vmImportProgressContract = defineInvokeContract({
  channel: Ch.VM_IMPORT_PROGRESS,
  argsSchema: nonBlankStringArgsSchema,
  resultSchema: importProgressResultSchema,
  ...invokeBoundary,
})

export const vmCancelImportContract = defineInvokeContract({
  channel: Ch.VM_IMPORT_CANCEL,
  argsSchema: connectionAndOperationIdArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const vmCancelExportContract = defineInvokeContract({
  channel: Ch.VM_CANCEL_EXPORT,
  argsSchema: connectionAndOperationIdArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const vmExportProgressContract = defineInvokeContract({
  channel: Ch.VM_EXPORT_PROGRESS,
  argsSchema: nonBlankStringArgsSchema,
  resultSchema: transferProgressResultSchema,
  ...invokeBoundary,
})

export const vmChangedContract = definePushContract({
  channel: Ch.EVENT_VM_CHANGED,
  argsSchema: vmChangedArgsSchema,
  callerPolicy: 'main-process',
  redaction: ['none'],
})

export const vmXvaContracts = [
  vmExportContract,
  vmImportContract,
  vmImportGetPreviewContract,
  vmImportProgressContract,
  vmCancelImportContract,
  vmCancelExportContract,
  vmExportProgressContract,
] as const

export const vmContracts = [
  ...vmReadContracts,
  ...vmLifecycleComputeDeviceContracts,
  ...vmRelocationCreationContracts,
  ...vmSnapshotTemplateContracts,
  ...vmXvaContracts,
  vmChangedContract,
] as const
