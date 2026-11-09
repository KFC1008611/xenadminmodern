import * as Ch from '../channels'
import {
  defineInvokeContract,
  type IpcRuntimeSchema,
} from '../ipc-contract'
import type {
  BondCreateParams,
  BondRecord,
  ConnectedPifRecord,
  ConnectedNetworkRecord,
  ConnectedTunnelRecord,
  PifIpConfig,
  VifCreateParams,
  VifCreateResult,
  VifQosParams,
  VlanCreateParams,
  VlanRecord,
} from '../types/xapi'
import {
  invalid,
  requireArray,
  requireBoolean,
  requireEnum,
  requireExactKeys,
  requireFiniteNumber,
  requireNonBlankString,
  requireOpenStringRecord,
  requirePlainObject,
  requirePositiveInteger,
  requireRef,
  requireString,
  requireStringArray,
  requireTuple,
  voidResultSchema,
} from './runtime-schema'

type DisruptionOptions = { confirmManagementDisruption?: boolean }

const BOND_MODES = new Set<NonNullable<BondCreateParams['mode']>>([
  'balance-slb',
  'active-backup',
  'lacp',
])
const PIF_IP_MODES = new Set<PifIpConfig['mode']>(['Static', 'DHCP', 'None'])
const NETWORK_KINDS = new Set<NonNullable<ConnectedNetworkRecord['kind']>>([
  'internal',
  'external',
  'bond',
  'vlan',
  'tunnel',
  'sriov',
])
const LINK_STATES = new Set<NonNullable<ConnectedNetworkRecord['linkState']>>([
  'connected',
  'disconnected',
  'unknown',
])
const NETWORK_LINK_STATUSES = new Set<NonNullable<ConnectedNetworkRecord['linkStatus']>>([
  'connected',
  'disconnected',
  'partial',
  'unknown',
  'none',
])

function connectionId(value: unknown): string {
  return requireNonBlankString(value, 'connection identity')
}

function optionalString(value: unknown, label: string): void {
  if (value !== undefined) requireString(value, label)
}

function optionalBoolean(value: unknown, label: string): void {
  if (value !== undefined) requireBoolean(value, label)
}

function optionalPositiveInteger(value: unknown, label: string): void {
  if (value !== undefined) requirePositiveInteger(value, label)
}

function requireNullableString(value: unknown, label: string): string | null {
  return value === null ? null : requireString(value, label)
}

function requireNullableBoolean(value: unknown, label: string): boolean | null {
  return value === null ? null : requireBoolean(value, label)
}

function requireRefArray(value: unknown, label: string): string[] {
  return requireArray(value, label).map((entry) => requireRef(entry, label))
}

const connectionIdArgsSchema: IpcRuntimeSchema<[string]> = {
  parse(value: unknown): [string] {
    const [rawConnectionId] = requireTuple(value, 1, 'network connection arguments')
    return [connectionId(rawConnectionId)]
  },
}

const connectionAndRefArgsSchema: IpcRuntimeSchema<[string, string]> = {
  parse(value: unknown): [string, string] {
    const [rawConnectionId, ref] = requireTuple(value, 2, 'network reference arguments')
    return [connectionId(rawConnectionId), requireRef(ref, 'network-domain reference')]
  },
}

const connectionAndTwoRefsArgsSchema: IpcRuntimeSchema<[string, string, string]> = {
  parse(value: unknown): [string, string, string] {
    const [rawConnectionId, firstRef, secondRef] = requireTuple(
      value,
      3,
      'network two-reference arguments',
    )
    return [
      connectionId(rawConnectionId),
      requireRef(firstRef, 'first network-domain reference'),
      requireRef(secondRef, 'second network-domain reference'),
    ]
  },
}

const networkCreateArgsSchema: IpcRuntimeSchema<[string, string, string]> = {
  parse(value: unknown): [string, string, string] {
    const [rawConnectionId, name, description] = requireTuple(
      value,
      3,
      'network create arguments',
    )
    return [
      connectionId(rawConnectionId),
      requireNonBlankString(name, 'network name'),
      requireString(description, 'network description'),
    ]
  },
}

function stringMutationArgs(
  value: unknown,
  valueLabel: string,
): [string, string, string] {
  const [rawConnectionId, ref, text] = requireTuple(
    value,
    3,
    `network ${valueLabel} arguments`,
  )
  return [
    connectionId(rawConnectionId),
    requireRef(ref, 'network reference'),
    requireNonBlankString(text, valueLabel),
  ]
}

const networkRenameArgsSchema: IpcRuntimeSchema<[string, string, string]> = {
  parse: (value) => stringMutationArgs(value, 'name'),
}

const networkTagArgsSchema: IpcRuntimeSchema<[string, string, string]> = {
  parse: (value) => stringMutationArgs(value, 'tag'),
}

const networkOtherConfigArgsSchema: IpcRuntimeSchema<[string, string, string, string]> = {
  parse(value: unknown): [string, string, string, string] {
    const [rawConnectionId, networkRef, key, entryValue] = requireTuple(
      value,
      4,
      'network other-configuration arguments',
    )
    return [
      connectionId(rawConnectionId),
      requireRef(networkRef, 'network reference'),
      requireNonBlankString(key, 'network configuration key'),
      requireString(entryValue, 'network configuration value'),
    ]
  },
}

function parsePifIpConfig(value: unknown): PifIpConfig {
  const config = requirePlainObject(value, 'PIF IP configuration')
  requireExactKeys(
    config,
    ['mode'],
    ['ip', 'netmask', 'gateway', 'dns'],
    'PIF IP configuration',
  )
  const mode = requireEnum(config.mode, PIF_IP_MODES, 'PIF IP mode')
  if (mode === 'Static') {
    requireNonBlankString(config.ip, 'PIF static IP address')
    requireNonBlankString(config.netmask, 'PIF static netmask')
    optionalString(config.gateway, 'PIF static gateway')
    optionalString(config.dns, 'PIF static DNS')
  } else {
    for (const key of ['ip', 'netmask', 'gateway', 'dns'] as const) {
      if (config[key] === undefined) continue
      if (requireString(config[key], `PIF ${key}`) !== '') {
        invalid('PIF IP configuration')
      }
    }
  }
  return value as PifIpConfig
}

const pifReconfigureIpArgsSchema: IpcRuntimeSchema<[string, string, PifIpConfig]> = {
  parse(value: unknown): [string, string, PifIpConfig] {
    const [rawConnectionId, pifRef, config] = requireTuple(
      value,
      3,
      'PIF reconfigure-IP arguments',
    )
    return [
      connectionId(rawConnectionId),
      requireRef(pifRef, 'PIF reference'),
      parsePifIpConfig(config),
    ]
  },
}

function parseVifCreateParams(value: unknown): VifCreateParams {
  const params = requirePlainObject(value, 'VIF create parameters')
  requireExactKeys(
    params,
    ['vmRef', 'networkRef'],
    ['mac', 'mtu', 'requestId'],
    'VIF create parameters',
  )
  requireRef(params.vmRef, 'VM reference')
  requireRef(params.networkRef, 'network reference')
  optionalString(params.mac, 'VIF MAC address')
  optionalPositiveInteger(params.mtu, 'VIF MTU')
  if (params.requestId !== undefined && !/^[a-zA-Z0-9-]{1,128}$/.test(requireNonBlankString(params.requestId, 'VIF request identity'))) invalid('invalid VIF request identity')
  return value as VifCreateParams
}

const vifCreateArgsSchema: IpcRuntimeSchema<[string, VifCreateParams]> = {
  parse(value: unknown): [string, VifCreateParams] {
    const [rawConnectionId, params] = requireTuple(value, 2, 'VIF create arguments')
    return [connectionId(rawConnectionId), parseVifCreateParams(params)]
  },
}

const vifCreateResultSchema: IpcRuntimeSchema<VifCreateResult> = {
  parse(value: unknown): VifCreateResult {
    const result = requirePlainObject(value, 'VIF create result')
    requireExactKeys(result, ['vifRef', 'plugged'], ['warning'], 'VIF create result')
    const parsed: VifCreateResult = {
      vifRef: requireRef(result.vifRef, 'VIF reference'),
      plugged: requireBoolean(result.plugged, 'VIF plugged state'),
    }
    if (Object.prototype.hasOwnProperty.call(result, 'warning')) {
      parsed.warning = requireString(result.warning, 'VIF plug warning')
    }
    return parsed
  },
}

function parseVifQosParams(value: unknown): VifQosParams {
  const params = requirePlainObject(value, 'VIF QoS parameters')
  requireExactKeys(
    params,
    ['algorithmType', 'algorithmParams'],
    [],
    'VIF QoS parameters',
  )
  requireNonBlankString(params.algorithmType, 'VIF QoS algorithm type')
  requireOpenStringRecord(params.algorithmParams, 'VIF QoS algorithm parameters')
  return value as VifQosParams
}

const vifQosArgsSchema: IpcRuntimeSchema<[string, string, VifQosParams]> = {
  parse(value: unknown): [string, string, VifQosParams] {
    const [rawConnectionId, vifRef, params] = requireTuple(value, 3, 'VIF QoS arguments')
    return [
      connectionId(rawConnectionId),
      requireRef(vifRef, 'VIF reference'),
      parseVifQosParams(params),
    ]
  },
}

function parseBondCreateParams(value: unknown): BondCreateParams {
  const params = requirePlainObject(value, 'Bond create parameters')
  requireExactKeys(
    params,
    ['pifRefs'],
    [
      'mode',
      'networkRef',
      'nameLabel',
      'nameDescription',
      'mtu',
      'confirmManagementDisruption',
    ],
    'Bond create parameters',
  )
  const pifRefs = requireRefArray(params.pifRefs, 'Bond PIF references')
  if (pifRefs.length < 2 || new Set(pifRefs).size !== pifRefs.length) {
    invalid('Bond PIF references')
  }
  if (params.mode !== undefined) requireEnum(params.mode, BOND_MODES, 'Bond mode')
  if (params.networkRef !== undefined) requireRef(params.networkRef, 'Bond network reference')
  optionalString(params.nameLabel, 'Bond network name')
  optionalString(params.nameDescription, 'Bond network description')
  optionalPositiveInteger(params.mtu, 'Bond network MTU')
  optionalBoolean(params.confirmManagementDisruption, 'Bond disruption confirmation')
  if (
    params.networkRef !== undefined
    && [params.nameLabel, params.nameDescription, params.mtu].some(
      (candidate) => candidate !== undefined,
    )
  ) invalid('Bond create parameters')
  return value as BondCreateParams
}

const bondCreateArgsSchema: IpcRuntimeSchema<[string, BondCreateParams]> = {
  parse(value: unknown): [string, BondCreateParams] {
    const [rawConnectionId, params] = requireTuple(value, 2, 'Bond create arguments')
    return [connectionId(rawConnectionId), parseBondCreateParams(params)]
  },
}

function requireVlanTag(value: unknown): number {
  const tag = requireFiniteNumber(value, 'VLAN tag')
  if (!Number.isInteger(tag) || tag < 0 || tag > 4094) invalid('VLAN tag')
  return tag
}

function parseVlanCreateParams(value: unknown): VlanCreateParams {
  const params = requirePlainObject(value, 'VLAN create parameters')
  requireExactKeys(
    params,
    ['taggedPifRef', 'vlanTag'],
    [
      'networkRef',
      'nameLabel',
      'nameDescription',
      'confirmManagementDisruption',
    ],
    'VLAN create parameters',
  )
  requireRef(params.taggedPifRef, 'tagged PIF reference')
  requireVlanTag(params.vlanTag)
  if (params.networkRef !== undefined) requireRef(params.networkRef, 'VLAN network reference')
  optionalString(params.nameLabel, 'VLAN network name')
  optionalString(params.nameDescription, 'VLAN network description')
  optionalBoolean(params.confirmManagementDisruption, 'VLAN disruption confirmation')
  if (
    params.networkRef !== undefined
    && [params.nameLabel, params.nameDescription].some(
      (candidate) => candidate !== undefined,
    )
  ) invalid('VLAN create parameters')
  return value as VlanCreateParams
}

const vlanCreateArgsSchema: IpcRuntimeSchema<[string, VlanCreateParams]> = {
  parse(value: unknown): [string, VlanCreateParams] {
    const [rawConnectionId, params] = requireTuple(value, 2, 'VLAN create arguments')
    return [connectionId(rawConnectionId), parseVlanCreateParams(params)]
  },
}

function parseDisruptionOptions(value: unknown): DisruptionOptions | undefined {
  if (value === undefined) return undefined
  const options = requirePlainObject(value, 'network disruption options')
  requireExactKeys(
    options,
    [],
    ['confirmManagementDisruption'],
    'network disruption options',
  )
  optionalBoolean(options.confirmManagementDisruption, 'network disruption confirmation')
  return value as DisruptionOptions
}

const disruptionArgsSchema: IpcRuntimeSchema<[
  string,
  string,
  DisruptionOptions?,
]> = {
  parse(value: unknown): [string, string, DisruptionOptions?] {
    const args = requireTuple(value, 2, 'network disruption arguments', 1)
    const result: [string, string, DisruptionOptions?] = [
      connectionId(args[0]),
      requireRef(args[1], 'network-domain reference'),
    ]
    if (args.length === 3) result.push(parseDisruptionOptions(args[2]))
    return result
  },
}

const refResultSchema: IpcRuntimeSchema<string> = {
  parse: (value) => requireRef(value, 'network-domain result reference'),
}

const refArrayResultSchema: IpcRuntimeSchema<string[]> = {
  parse: (value) => requireRefArray(value, 'network-domain result references'),
}

const stringArrayResultSchema: IpcRuntimeSchema<string[]> = {
  parse: (value) => requireStringArray(value, 'network allowed-operation result'),
}

function validateConnectedNetwork(value: unknown): ConnectedNetworkRecord {
  const record = requirePlainObject(value, 'connected network record')
  requireRef(record.ref, 'network reference')
  requireNonBlankString(record.uuid, 'network UUID')
  requireString(record.name_label, 'network name')
  requireString(record.name_description, 'network description')
  requireString(record.bridge, 'network bridge')
  requireRefArray(record.VIFs, 'network VIF references')
  requireRefArray(record.PIFs, 'network PIF references')
  requirePositiveInteger(record.MTU, 'network MTU')
  requireOpenStringRecord(record.other_config, 'network other configuration')
  requireStringArray(record.tags, 'network tags')
  requireBoolean(record.managed, 'network managed state')
  requireEnum(record.kind, NETWORK_KINDS, 'network kind')
  requireEnum(record.linkState, LINK_STATES, 'network link state')
  requireEnum(record.linkStatus, NETWORK_LINK_STATUSES, 'network link status')
  if (record.vlan !== null) requireVlanTag(record.vlan)
  requireNullableString(record.device, 'network device')
  requireRefArray(record.pifRefs, 'network normalized PIF references')
  for (const key of [
    'isHidden',
    'isGuestInstallerNetwork',
    'isBond',
    'isBondMember',
    'isVlan',
    'isSriov',
    'isTunnel',
    'canUseJumboFrames',
    'visible',
  ]) requireBoolean(record[key], `network ${key} state`)
  const actions = requirePlainObject(record.allowedActions, 'network allowed actions')
  requireExactKeys(actions, ['rename', 'destroy'], [], 'network allowed actions')
  requireBoolean(actions.rename, 'network rename action')
  requireBoolean(actions.destroy, 'network destroy action')
  connectionId(record.connectionId)
  requireNonBlankString(record.poolName, 'network pool name')
  return value as ConnectedNetworkRecord
}

const connectedNetworkListResultSchema: IpcRuntimeSchema<ConnectedNetworkRecord[]> = {
  parse(value: unknown): ConnectedNetworkRecord[] {
    return requireArray(value, 'connected network list').map(validateConnectedNetwork)
  },
}

function validateConnectedPif(value: unknown): ConnectedPifRecord {
  const record = requirePlainObject(value, 'connected PIF record')
  requireRef(record.ref, 'PIF reference')
  requireNonBlankString(record.uuid, 'PIF UUID')
  requireString(record.device, 'PIF device')
  requireRef(record.host, 'PIF host reference')
  requireRef(record.network, 'PIF network reference')
  requireString(record.IP, 'PIF IP address')
  requireString(record.MAC, 'PIF MAC address')
  requirePositiveInteger(record.MTU, 'PIF MTU')
  requireFiniteNumber(record.speed, 'PIF speed')
  requireNullableBoolean(record.duplex, 'PIF duplex state')
  requireFiniteNumber(record.vlan, 'PIF VLAN')
  for (const key of [
    'physical',
    'managed',
    'management',
    'currently_attached',
    'disallow_unplug',
    'isPhysicalNic',
    'isBondMaster',
    'isBondMember',
    'isVlan',
    'isPrimaryManagement',
    'isSecondaryManagement',
    'isManagementInterface',
    'isHidden',
    'isTunnelAccess',
    'isTunnelTransport',
    'isSriovLogical',
    'isSriovPhysical',
    'isClusterPif',
    'isBondCandidate',
    'isVlanCandidate',
  ]) requireBoolean(record[key], `PIF ${key} state`)
  for (const key of [
    'ip_configuration_mode',
    'netmask',
    'gateway',
    'DNS',
    'metrics',
    'bond_slave_of',
    'VLAN_master_of',
  ]) requireString(record[key], `PIF ${key}`)
  for (const key of [
    'bond_master_of',
    'tunnel_access_PIF_of',
    'tunnel_transport_PIF_of',
    'sriov_logical_PIF_of',
    'sriov_physical_PIF_of',
  ]) requireStringArray(record[key], `PIF ${key}`)
  requireOpenStringRecord(record.other_config, 'PIF other configuration')
  requireNullableBoolean(record.carrier, 'PIF carrier state')
  requireEnum(record.linkState, LINK_STATES, 'PIF link state')
  connectionId(record.connectionId)
  requireNonBlankString(record.poolName, 'PIF pool name')
  return value as ConnectedPifRecord
}

const connectedPifListResultSchema: IpcRuntimeSchema<ConnectedPifRecord[]> = {
  parse(value: unknown): ConnectedPifRecord[] {
    return requireArray(value, 'connected PIF list').map(validateConnectedPif)
  },
}

function validateConnectedBond(value: unknown): BondRecord {
  const record = requirePlainObject(value, 'connected Bond record')
  requireRef(record.ref, 'Bond reference')
  requireNonBlankString(record.uuid, 'Bond UUID')
  requireRef(record.master, 'Bond master PIF reference')
  requireRefArray(record.slaves, 'Bond slave PIF references')
  requireString(record.mode, 'Bond mode')
  requireOpenStringRecord(record.properties, 'Bond properties')
  requireOpenStringRecord(record.other_config, 'Bond other configuration')
  requireFiniteNumber(record.links_up, 'Bond links-up count')
  requireRef(record.network, 'Bond network reference')
  requireStringArray(record.devices, 'Bond devices')
  requireNullableString(record.masterDevice, 'Bond master device')
  for (const key of [
    'hasManagement',
    'hasPrimaryManagement',
    'hasSecondaryManagement',
    'hasClusterPif',
  ]) requireBoolean(record[key], `Bond ${key} state`)
  connectionId(record.connectionId)
  requireNonBlankString(record.poolName, 'Bond pool name')
  return value as BondRecord
}

const connectedBondResultSchema: IpcRuntimeSchema<BondRecord> = {
  parse: validateConnectedBond,
}

const connectedBondListResultSchema: IpcRuntimeSchema<BondRecord[]> = {
  parse(value: unknown): BondRecord[] {
    return requireArray(value, 'connected Bond list').map(validateConnectedBond)
  },
}

function validateConnectedVlan(value: unknown): VlanRecord {
  const record = requirePlainObject(value, 'connected VLAN record')
  requireRef(record.ref, 'VLAN reference')
  requireNonBlankString(record.uuid, 'VLAN UUID')
  requireVlanTag(record.tag)
  requireRef(record.tagged_PIF, 'VLAN tagged PIF reference')
  requireRef(record.untagged_PIF, 'VLAN untagged PIF reference')
  requireRef(record.network, 'VLAN network reference')
  requireNullableString(record.taggedDevice, 'VLAN tagged device')
  const host = requireNullableString(record.host, 'VLAN host reference')
  if (host !== null) requireRef(host, 'VLAN host reference')
  connectionId(record.connectionId)
  requireNonBlankString(record.poolName, 'VLAN pool name')
  return value as VlanRecord
}

const connectedVlanResultSchema: IpcRuntimeSchema<VlanRecord> = {
  parse: validateConnectedVlan,
}

const connectedVlanListResultSchema: IpcRuntimeSchema<VlanRecord[]> = {
  parse(value: unknown): VlanRecord[] {
    return requireArray(value, 'connected VLAN list').map(validateConnectedVlan)
  },
}

function validateConnectedTunnel(value: unknown): ConnectedTunnelRecord {
  const record = requirePlainObject(value, 'connected Tunnel record')
  requireRef(record.ref, 'Tunnel reference')
  requireNonBlankString(record.uuid, 'Tunnel UUID')
  requireRef(record.access_PIF, 'Tunnel access PIF reference')
  requireRef(record.transport_PIF, 'Tunnel transport PIF reference')
  connectionId(record.connectionId)
  requireNonBlankString(record.poolName, 'Tunnel pool name')
  return value as ConnectedTunnelRecord
}

const connectedTunnelListResultSchema: IpcRuntimeSchema<ConnectedTunnelRecord[]> = {
  parse(value: unknown): ConnectedTunnelRecord[] {
    return requireArray(value, 'connected Tunnel list').map(validateConnectedTunnel)
  },
}

const invokeBoundary = {
  errorShape: 'ipc-error-response-v1' as const,
  callerPolicy: 'app-window-main-frame' as const,
  redaction: ['none'] as const,
}

export const networkListContract = defineInvokeContract({
  channel: Ch.NETWORK_LIST,
  argsSchema: connectionIdArgsSchema,
  resultSchema: connectedNetworkListResultSchema,
  ...invokeBoundary,
})

export const networkCreateContract = defineInvokeContract({
  channel: Ch.NETWORK_CREATE,
  argsSchema: networkCreateArgsSchema,
  resultSchema: refResultSchema,
  ...invokeBoundary,
})

export const networkDestroyContract = defineInvokeContract({
  channel: Ch.NETWORK_DESTROY,
  argsSchema: connectionAndRefArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const networkRenameContract = defineInvokeContract({
  channel: Ch.NETWORK_RENAME,
  argsSchema: networkRenameArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const networkGetAllowedOpsContract = defineInvokeContract({
  channel: Ch.NETWORK_GET_ALLOWED_OPS,
  argsSchema: connectionAndRefArgsSchema,
  resultSchema: stringArrayResultSchema,
  ...invokeBoundary,
})

export const networkAddTagContract = defineInvokeContract({
  channel: Ch.NETWORK_ADD_TAG,
  argsSchema: networkTagArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const networkRemoveTagContract = defineInvokeContract({
  channel: Ch.NETWORK_REMOVE_TAG,
  argsSchema: networkTagArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const networkUpdateOtherConfigContract = defineInvokeContract({
  channel: Ch.NETWORK_UPDATE_OTHER_CONFIG,
  argsSchema: networkOtherConfigArgsSchema,
  resultSchema: voidResultSchema,
  errorShape: 'ipc-error-response-v1',
  callerPolicy: 'app-window-main-frame',
  redaction: ['credentials'],
})

export const networkResourceContracts = [
  networkListContract,
  networkCreateContract,
  networkDestroyContract,
  networkRenameContract,
  networkGetAllowedOpsContract,
  networkAddTagContract,
  networkRemoveTagContract,
  networkUpdateOtherConfigContract,
] as const

export const pifListContract = defineInvokeContract({
  channel: Ch.PIF_LIST,
  argsSchema: connectionIdArgsSchema,
  resultSchema: connectedPifListResultSchema,
  ...invokeBoundary,
})

export const pifReconfigureIpContract = defineInvokeContract({
  channel: Ch.PIF_RECONFIGURE_IP,
  argsSchema: pifReconfigureIpArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const pifScanContract = defineInvokeContract({
  channel: Ch.PIF_SCAN,
  argsSchema: connectionAndRefArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const pifGetForHostContract = defineInvokeContract({
  channel: Ch.PIF_GET_FOR_HOST,
  argsSchema: connectionAndRefArgsSchema,
  resultSchema: connectedPifListResultSchema,
  ...invokeBoundary,
})

export const pifContracts = [
  pifListContract,
  pifReconfigureIpContract,
  pifScanContract,
  pifGetForHostContract,
] as const

export const vifCreateContract = defineInvokeContract({
  channel: Ch.VIF_CREATE,
  argsSchema: vifCreateArgsSchema,
  resultSchema: vifCreateResultSchema,
  ...invokeBoundary,
})

export const vifDestroyContract = defineInvokeContract({
  channel: Ch.VIF_DESTROY,
  argsSchema: connectionAndRefArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const vifPlugContract = defineInvokeContract({
  channel: Ch.VIF_PLUG,
  argsSchema: connectionAndRefArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const vifUnplugContract = defineInvokeContract({
  channel: Ch.VIF_UNPLUG,
  argsSchema: connectionAndRefArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const vifMoveContract = defineInvokeContract({
  channel: Ch.VIF_MOVE,
  argsSchema: connectionAndTwoRefsArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const vifSetQosContract = defineInvokeContract({
  channel: Ch.VIF_SET_QOS,
  argsSchema: vifQosArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const vifClearQosContract = defineInvokeContract({
  channel: Ch.VIF_CLEAR_QOS,
  argsSchema: connectionAndRefArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const vifContracts = [
  vifCreateContract,
  vifDestroyContract,
  vifPlugContract,
  vifUnplugContract,
  vifMoveContract,
  vifSetQosContract,
  vifClearQosContract,
] as const

export const bondListContract = defineInvokeContract({
  channel: Ch.BOND_LIST,
  argsSchema: connectionIdArgsSchema,
  resultSchema: connectedBondListResultSchema,
  ...invokeBoundary,
})

export const bondCreateContract = defineInvokeContract({
  channel: Ch.BOND_CREATE,
  argsSchema: bondCreateArgsSchema,
  resultSchema: refArrayResultSchema,
  ...invokeBoundary,
})

export const bondDestroyContract = defineInvokeContract({
  channel: Ch.BOND_DESTROY,
  argsSchema: connectionAndRefArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const bondDestroyGroupContract = defineInvokeContract({
  channel: Ch.BOND_DESTROY_GROUP,
  argsSchema: disruptionArgsSchema,
  resultSchema: refArrayResultSchema,
  ...invokeBoundary,
})

export const bondGetRecordContract = defineInvokeContract({
  channel: Ch.BOND_GET_RECORD,
  argsSchema: connectionAndRefArgsSchema,
  resultSchema: connectedBondResultSchema,
  ...invokeBoundary,
})

export const bondContracts = [
  bondListContract,
  bondCreateContract,
  bondDestroyContract,
  bondDestroyGroupContract,
  bondGetRecordContract,
] as const

export const vlanListContract = defineInvokeContract({
  channel: Ch.VLAN_LIST,
  argsSchema: connectionIdArgsSchema,
  resultSchema: connectedVlanListResultSchema,
  ...invokeBoundary,
})

export const vlanCreateContract = defineInvokeContract({
  channel: Ch.VLAN_CREATE,
  argsSchema: vlanCreateArgsSchema,
  resultSchema: refArrayResultSchema,
  ...invokeBoundary,
})

export const vlanDestroyContract = defineInvokeContract({
  channel: Ch.VLAN_DESTROY,
  argsSchema: connectionAndRefArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const vlanDestroyNetworkContract = defineInvokeContract({
  channel: Ch.VLAN_DESTROY_NETWORK,
  argsSchema: disruptionArgsSchema,
  resultSchema: refArrayResultSchema,
  ...invokeBoundary,
})

export const vlanGetRecordContract = defineInvokeContract({
  channel: Ch.VLAN_GET_RECORD,
  argsSchema: connectionAndRefArgsSchema,
  resultSchema: connectedVlanResultSchema,
  ...invokeBoundary,
})

export const vlanContracts = [
  vlanListContract,
  vlanCreateContract,
  vlanDestroyContract,
  vlanDestroyNetworkContract,
  vlanGetRecordContract,
] as const

export const tunnelListContract = defineInvokeContract({
  channel: Ch.TUNNEL_LIST,
  argsSchema: connectionIdArgsSchema,
  resultSchema: connectedTunnelListResultSchema,
  ...invokeBoundary,
})

export const tunnelCreateContract = defineInvokeContract({
  channel: Ch.TUNNEL_CREATE,
  argsSchema: connectionAndTwoRefsArgsSchema,
  resultSchema: refResultSchema,
  ...invokeBoundary,
})

export const tunnelDestroyContract = defineInvokeContract({
  channel: Ch.TUNNEL_DESTROY,
  argsSchema: connectionAndRefArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const tunnelContracts = [
  tunnelListContract,
  tunnelCreateContract,
  tunnelDestroyContract,
] as const

export const networkContracts = [
  ...networkResourceContracts,
  ...pifContracts,
  ...vifContracts,
  ...bondContracts,
  ...vlanContracts,
  ...tunnelContracts,
] as const
