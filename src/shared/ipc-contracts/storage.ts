import * as Ch from '../channels'
import {
  defineInvokeContract,
  type IpcRuntimeSchema,
} from '../ipc-contract'
import type {
  AttachableVdiRecord,
  ConnectedSrRecord,
  ConnectedPbdRecord,
  ConnectedVdiRecord,
  IsoImageRecord,
  IscsiTarget,
  IscsiProbeOptions,
  NfsTarget,
  SrCreateParams,
  SrIdentity,
  SrIdentityUpdate,
  SrIntroduceParams,
  ThinProvisioningStats,
  VdiAllowedOperations,
  VdiAttachPayload,
  VdiAttachResult,
  VdiCloneParams,
  VdiCopyParams,
  VdiCreateParams,
  VdiCreateForVmResult,
  VdiDeleteResult,
  VdiMovePayload,
  VdiMoveResult,
  VdiResizeParams,
} from '../types/xapi'
import {
  hasOwn,
  IpcValidationError,
  invalid,
  requireArray,
  requireBoolean,
  requireEnum,
  requireExactKeys,
  requireFiniteNumber,
  requireNonBlankString,
  requireNonNegativeNumber,
  requireSrCapacity,
  requireOpenStringRecord,
  requirePlainObject,
  requireRef,
  requireString,
  requireTuple,
  voidResultSchema,
  type UnknownRecord,
} from './runtime-schema'

const connectionArgsSchema: IpcRuntimeSchema<[string]> = {
  parse(value: unknown): [string] {
    const [connectionId] = requireTuple(value, 1, 'storage connection arguments')
    return [requireNonBlankString(connectionId, 'connection identity')]
  },
}

function parseConnectionRefArgs(value: unknown, label: string): [string, string] {
  const [connectionId, ref] = requireTuple(value, 2, label)
  return [
    requireNonBlankString(connectionId, 'connection identity'),
    requireRef(ref, 'storage reference'),
  ]
}

const srRefArgsSchema: IpcRuntimeSchema<[string, string]> = {
  parse(value: unknown): [string, string] {
    return parseConnectionRefArgs(value, 'SR reference arguments')
  },
}

const srIdentityArgsSchema: IpcRuntimeSchema<[string, string, SrIdentityUpdate]> = {
  parse(value: unknown): [string, string, SrIdentityUpdate] {
    const [connectionId, srRef, raw] = requireTuple(value, 3, 'SR identity arguments')
    const params = requirePlainObject(raw, 'SR identity update')
    requireExactKeys(params, ['nameLabel', 'nameDescription', 'expectedNameLabel', 'expectedNameDescription'], [], 'SR identity update')
    return [requireNonBlankString(connectionId, 'connection identity'), requireRef(srRef, 'SR reference'), {
      nameLabel: requireNonBlankString(params.nameLabel, 'SR name'),
      nameDescription: requireString(params.nameDescription, 'SR description'),
      expectedNameLabel: requireString(params.expectedNameLabel, 'expected SR name'),
      expectedNameDescription: requireString(params.expectedNameDescription, 'expected SR description'),
    }]
  },
}
const srIdentityResultSchema: IpcRuntimeSchema<SrIdentity> = {
  parse(value: unknown): SrIdentity {
    const record = requirePlainObject(value, 'SR identity result')
    requireExactKeys(record, ['nameLabel', 'nameDescription'], [], 'SR identity result')
    return { nameLabel: requireString(record.nameLabel, 'SR name'), nameDescription: requireString(record.nameDescription, 'SR description') }
  },
}

const srSetDefaultArgsSchema: IpcRuntimeSchema<[string, string, string]> = {
  parse(value: unknown): [string, string, string] {
    const [connectionId, poolRef, srRef] = requireTuple(value, 3, 'default SR arguments')
    return [
      requireNonBlankString(connectionId, 'connection identity'),
      requireRef(poolRef, 'pool reference'),
      requireRef(srRef, 'SR reference'),
    ]
  },
}

const srProbeArgsSchema: IpcRuntimeSchema<[string, string, string]> = {
  parse(value: unknown): [string, string, string] {
    const [connectionId, hostRef, endpoint] = requireTuple(value, 3, 'SR probe arguments')
    return [
      requireNonBlankString(connectionId, 'connection identity'),
      requireRef(hostRef, 'host reference'),
      requireNonBlankString(endpoint, 'storage endpoint'),
    ]
  },
}

const iscsiProbeArgsSchema: IpcRuntimeSchema<[string, string, string, IscsiProbeOptions?]> = {
  parse(value: unknown): [string, string, string, IscsiProbeOptions?] {
    const args = requireTuple(value, 3, 'iSCSI probe arguments', 1)
    const base = srProbeArgsSchema.parse(args.slice(0, 3))
    if (args[3] === undefined) return base
    const options = requirePlainObject(args[3], 'iSCSI probe options')
    requireExactKeys(options, [], ['iqn', 'port', 'chapUser', 'chapPassword'], 'iSCSI probe options')
    const parsed: IscsiProbeOptions = {}
    for (const key of ['iqn', 'chapUser', 'chapPassword'] as const) {
      if (hasOwn(options, key)) parsed[key] = requireString(options[key], `iSCSI ${key}`)
    }
    if (hasOwn(options, 'port')) parsed.port = parseIscsiPort(options.port)
    return [...base, parsed]
  },
}

function parseIscsiPort(value: unknown): number {
  const port = requireFiniteNumber(value, 'iSCSI port')
  if (!Number.isInteger(port) || port < 1 || port > 65535) invalid('iSCSI port')
  return port
}

const srSetSharedArgsSchema: IpcRuntimeSchema<[string, string, boolean]> = {
  parse(value: unknown): [string, string, boolean] {
    const [connectionId, srRef, shared] = requireTuple(value, 3, 'shared SR arguments')
    return [
      requireNonBlankString(connectionId, 'connection identity'),
      requireRef(srRef, 'SR reference'),
      requireBoolean(shared, 'shared SR state'),
    ]
  },
}

function parseSrCreateParams(value: unknown): SrCreateParams {
  const params = requirePlainObject(value, 'SR creation parameters')
  const type = requireString(params.type, 'SR type')
  const common = {
    nameLabel: requireNonBlankString(params.nameLabel, 'SR name'),
    nameDescription: requireString(params.nameDescription, 'SR description'),
  }

  if (type === 'ext' || type === 'hba') {
    requireExactKeys(
      params,
      ['type', 'nameLabel', 'nameDescription'],
      [],
      'SR creation parameters',
    )
    return { type, ...common }
  }

  if (type === 'nfs' || type === 'iso') {
    requireExactKeys(
      params,
      ['type', 'nameLabel', 'nameDescription', 'nfsServer', 'nfsPath'],
      [],
      'NFS SR creation parameters',
    )
    return {
      type,
      ...common,
      nfsServer: requireNonBlankString(params.nfsServer, 'NFS server'),
      nfsPath: requireNonBlankString(params.nfsPath, 'NFS path'),
    }
  }

  if (type === 'iscsi') {
    requireExactKeys(
      params,
      ['type', 'nameLabel', 'nameDescription', 'iscsiTarget'],
      ['iscsiIqn', 'iscsiLun', 'iscsiPort', 'chapUser', 'chapPassword', 'existingSrUuid'],
      'iSCSI SR creation parameters',
    )
    const hasChapUser = hasOwn(params, 'chapUser')
    const hasChapPassword = hasOwn(params, 'chapPassword')
    if (hasChapUser !== hasChapPassword) invalid('iSCSI CHAP credentials')

    const result: SrCreateParams = {
      type,
      ...common,
      iscsiTarget: requireNonBlankString(params.iscsiTarget, 'iSCSI target'),
    }
    if (hasOwn(params, 'existingSrUuid')) result.existingSrUuid = requireNonBlankString(params.existingSrUuid, 'existing SR UUID')
    if (hasOwn(params, 'iscsiIqn')) {
      result.iscsiIqn = requireString(params.iscsiIqn, 'iSCSI IQN')
    }
    if (hasOwn(params, 'iscsiPort')) result.iscsiPort = parseIscsiPort(params.iscsiPort)
    if (hasOwn(params, 'iscsiLun')) {
      result.iscsiLun = requireString(params.iscsiLun, 'iSCSI LUN')
    }
    if (hasChapUser) {
      result.chapUser = requireNonBlankString(params.chapUser, 'CHAP user')
      result.chapPassword = requireString(params.chapPassword, 'CHAP password')
    }
    return result
  }

  return invalid('SR type')
}

const srCreateArgsSchema: IpcRuntimeSchema<[string, string, SrCreateParams]> = {
  parse(value: unknown): [string, string, SrCreateParams] {
    const [connectionId, hostRef, params] = requireTuple(value, 3, 'SR creation arguments')
    return [
      requireNonBlankString(connectionId, 'connection identity'),
      requireRef(hostRef, 'host reference'),
      parseSrCreateParams(params),
    ]
  },
}

function parseSrIntroduceParams(value: unknown): SrIntroduceParams {
  const params = requirePlainObject(value, 'SR introduce parameters')
  requireExactKeys(
    params,
    ['uuid', 'nameLabel', 'nameDescription', 'type'],
    ['contentType', 'shared'],
    'SR introduce parameters',
  )
  const result: SrIntroduceParams = {
    uuid: requireNonBlankString(params.uuid, 'SR UUID'),
    nameLabel: requireNonBlankString(params.nameLabel, 'SR name'),
    nameDescription: requireString(params.nameDescription, 'SR description'),
    type: requireNonBlankString(params.type, 'SR type'),
  }
  if (hasOwn(params, 'contentType')) {
    result.contentType = requireString(params.contentType, 'SR content type')
  }
  if (hasOwn(params, 'shared')) {
    result.shared = requireBoolean(params.shared, 'shared SR state')
  }
  return result
}

const srIntroduceArgsSchema: IpcRuntimeSchema<[string, SrIntroduceParams]> = {
  parse(value: unknown): [string, SrIntroduceParams] {
    const [connectionId, params] = requireTuple(value, 2, 'SR introduce arguments')
    return [
      requireNonBlankString(connectionId, 'connection identity'),
      parseSrIntroduceParams(params),
    ]
  },
}

function requireRefArray(value: unknown, label: string): string[] {
  return requireArray(value, label).map((entry) => requireRef(entry, label))
}

function validateConnectedSr(value: unknown): ConnectedSrRecord {
  const record = requirePlainObject(value, 'connected SR record')
  requireRef(record.ref, 'SR reference')
  requireString(record.uuid, 'SR UUID')
  requireString(record.name_label, 'SR name')
  requireString(record.type, 'SR type')
  requireSrCapacity(record.physical_size, 'SR physical size')
  requireSrCapacity(record.physical_utilisation, 'SR physical utilisation')
  requireSrCapacity(record.virtual_allocation, 'SR virtual allocation')
  requireRefArray(record.VDIs, 'SR VDI references')
  requireBoolean(record.shared, 'shared SR state')
  requireNonBlankString(record.connectionId, 'connection identity')
  requireString(record.poolName, 'pool name')
  if (record.name_description !== undefined) {
    requireString(record.name_description, 'SR description')
  }
  if (record.PBDs !== undefined) requireRefArray(record.PBDs, 'SR PBD references')
  return value as ConnectedSrRecord
}

const connectedSrListResultSchema: IpcRuntimeSchema<ConnectedSrRecord[]> = {
  parse(value: unknown): ConnectedSrRecord[] {
    return requireArray(value, 'connected SR list').map((record, index) => {
      try { return validateConnectedSr(record) }
      catch (error) {
        if (error instanceof IpcValidationError) error.recordIndex = index
        throw error
      }
    })
  },
}

function parseNfsTarget(value: unknown): NfsTarget {
  const target = requirePlainObject(value, 'NFS probe target')
  requireExactKeys(target, ['server', 'path'], [], 'NFS probe target')
  return {
    server: requireString(target.server, 'NFS server'),
    path: requireNonBlankString(target.path, 'NFS path'),
  }
}

const nfsTargetsResultSchema: IpcRuntimeSchema<NfsTarget[]> = {
  parse(value: unknown): NfsTarget[] {
    return requireArray(value, 'NFS probe targets').map(parseNfsTarget)
  },
}

function parseIscsiTarget(value: unknown): IscsiTarget {
  const target = requirePlainObject(value, 'iSCSI probe target')
  requireExactKeys(target, ['iqn', 'address', 'port'], ['luns'], 'iSCSI probe target')
  const port = requireFiniteNumber(target.port, 'iSCSI port')
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) invalid('iSCSI port')
  return {
    iqn: requireNonBlankString(target.iqn, 'iSCSI IQN'),
    address: requireString(target.address, 'iSCSI address'),
    port,
    ...(hasOwn(target, 'luns') ? { luns: requireArray(target.luns, 'iSCSI LUNs').map((value) => {
      const lun = requirePlainObject(value, 'iSCSI LUN')
      requireExactKeys(lun, ['id', 'lunId', 'size', 'vendor'], [], 'iSCSI LUN')
      return { id: requireNonBlankString(lun.id, 'SCSI identifier'), lunId: requireString(lun.lunId, 'LUN number'),
        size: requireNonNegativeNumber(lun.size, 'LUN size'), vendor: requireString(lun.vendor, 'LUN vendor') }
    }) } : {}),
  }
}

const iscsiTargetsResultSchema: IpcRuntimeSchema<IscsiTarget[]> = {
  parse(value: unknown): IscsiTarget[] {
    return requireArray(value, 'iSCSI probe targets').map(parseIscsiTarget)
  },
}

const referenceResultSchema: IpcRuntimeSchema<string> = {
  parse(value: unknown): string {
    return requireRef(value, 'result reference')
  },
}

const thinStatsResultSchema: IpcRuntimeSchema<ThinProvisioningStats> = {
  parse(value: unknown): ThinProvisioningStats {
    const stats = requirePlainObject(value, 'thin provisioning statistics')
    requireExactKeys(
      stats,
      ['physicalSize', 'physicalUtilisation', 'virtualAllocation', 'overprovisionRatio'],
      [],
      'thin provisioning statistics',
    )
    return {
      physicalSize: requireNonNegativeNumber(stats.physicalSize, 'physical size'),
      physicalUtilisation: requireNonNegativeNumber(
        stats.physicalUtilisation,
        'physical utilisation',
      ),
      virtualAllocation: requireNonNegativeNumber(stats.virtualAllocation, 'virtual allocation'),
      overprovisionRatio: requireNonNegativeNumber(
        stats.overprovisionRatio,
        'overprovision ratio',
      ),
    }
  },
}

function requirePositiveSafeInteger(value: unknown, label: string): number {
  const result = requireFiniteNumber(value, label)
  if (!Number.isSafeInteger(result) || result <= 0) invalid(label)
  return result
}

const vdiRefArgsSchema: IpcRuntimeSchema<[string, string]> = {
  parse(value: unknown): [string, string] {
    return parseConnectionRefArgs(value, 'VDI reference arguments')
  },
}

const vdiCreateArgsSchema: IpcRuntimeSchema<[string, string, string, number]> = {
  parse(value: unknown): [string, string, string, number] {
    const [connectionId, srRef, name, size] = requireTuple(value, 4, 'VDI creation arguments')
    return [
      requireNonBlankString(connectionId, 'connection identity'),
      requireRef(srRef, 'SR reference'),
      requireNonBlankString(name, 'VDI name'),
      requirePositiveSafeInteger(size, 'VDI size'),
    ]
  },
}

function parseVdiResizeParams(value: unknown): VdiResizeParams {
  const params = requirePlainObject(value, 'VDI resize parameters')
  requireExactKeys(params, ['vdiRef', 'newSize'], [], 'VDI resize parameters')
  return {
    vdiRef: requireRef(params.vdiRef, 'VDI reference'),
    newSize: requirePositiveSafeInteger(params.newSize, 'VDI size'),
  }
}

const vdiResizeArgsSchema: IpcRuntimeSchema<[string, VdiResizeParams]> = {
  parse(value: unknown): [string, VdiResizeParams] {
    const [connectionId, params] = requireTuple(value, 2, 'VDI resize arguments')
    return [
      requireNonBlankString(connectionId, 'connection identity'),
      parseVdiResizeParams(params),
    ]
  },
}

const vdiTypes = new Set<VdiCreateParams['type'] & string>(['system', 'user', 'iso'])

function parseVdiCreateParams(value: unknown): VdiCreateParams {
  const params = requirePlainObject(value, 'VDI creation parameters')
  requireExactKeys(
    params,
    ['nameLabel', 'nameDescription', 'srRef', 'size'],
    ['type', 'sharable', 'readOnly'],
    'VDI creation parameters',
  )
  const result: VdiCreateParams = {
    nameLabel: requireNonBlankString(params.nameLabel, 'VDI name'),
    nameDescription: requireString(params.nameDescription, 'VDI description'),
    srRef: requireRef(params.srRef, 'SR reference'),
    size: requirePositiveSafeInteger(params.size, 'VDI size'),
  }
  if (hasOwn(params, 'type')) {
    result.type = requireEnum(params.type, vdiTypes, 'VDI type')
  }
  if (hasOwn(params, 'sharable')) {
    result.sharable = requireBoolean(params.sharable, 'VDI sharable state')
  }
  if (hasOwn(params, 'readOnly')) {
    result.readOnly = requireBoolean(params.readOnly, 'VDI read-only state')
  }
  return result
}

const vdiCreateForVmArgsSchema: IpcRuntimeSchema<[string, VdiCreateParams, string]> = {
  parse(value: unknown): [string, VdiCreateParams, string] {
    const [connectionId, params, vmRef] = requireTuple(value, 3, 'VM VDI creation arguments')
    return [
      requireNonBlankString(connectionId, 'connection identity'),
      parseVdiCreateParams(params),
      requireRef(vmRef, 'VM reference'),
    ]
  },
}

const vdiAllowedOperationsArgsSchema: IpcRuntimeSchema<[string, string, string]> = {
  parse(value: unknown): [string, string, string] {
    const [connectionId, vdiRef, vmRef] = requireTuple(value, 3, 'VDI operation arguments')
    return [
      requireNonBlankString(connectionId, 'connection identity'),
      requireRef(vdiRef, 'VDI reference'),
      requireRef(vmRef, 'VM reference'),
    ]
  },
}

function parseVdiAttachPayload(value: unknown): VdiAttachPayload {
  const payload = requirePlainObject(value, 'VDI attach payload')
  requireExactKeys(
    payload,
    ['vmRef', 'vdiRef'],
    ['readOnly', 'userdevice'],
    'VDI attach payload',
  )
  const result: VdiAttachPayload = {
    vmRef: requireRef(payload.vmRef, 'VM reference'),
    vdiRef: requireRef(payload.vdiRef, 'VDI reference'),
  }
  if (hasOwn(payload, 'readOnly')) {
    result.readOnly = requireBoolean(payload.readOnly, 'VDI read-only state')
  }
  if (hasOwn(payload, 'userdevice')) {
    result.userdevice = requireNonBlankString(payload.userdevice, 'VBD device number')
  }
  return result
}

const vdiAttachArgsSchema: IpcRuntimeSchema<[string, VdiAttachPayload]> = {
  parse(value: unknown): [string, VdiAttachPayload] {
    const [connectionId, payload] = requireTuple(value, 2, 'VDI attach arguments')
    return [
      requireNonBlankString(connectionId, 'connection identity'),
      parseVdiAttachPayload(payload),
    ]
  },
}

function parseVdiMovePayload(value: unknown): VdiMovePayload {
  const payload = requirePlainObject(value, 'VDI move payload')
  requireExactKeys(payload, ['vdiRef', 'targetSrRef'], ['preferLive'], 'VDI move payload')
  const result: VdiMovePayload = {
    vdiRef: requireRef(payload.vdiRef, 'VDI reference'),
    targetSrRef: requireRef(payload.targetSrRef, 'target SR reference'),
  }
  if (hasOwn(payload, 'preferLive')) {
    result.preferLive = requireBoolean(payload.preferLive, 'live move preference')
  }
  return result
}

const vdiMoveArgsSchema: IpcRuntimeSchema<[string, VdiMovePayload]> = {
  parse(value: unknown): [string, VdiMovePayload] {
    const [connectionId, payload] = requireTuple(value, 2, 'VDI move arguments')
    return [
      requireNonBlankString(connectionId, 'connection identity'),
      parseVdiMovePayload(payload),
    ]
  },
}

function parseVdiCloneParams(value: unknown): VdiCloneParams {
  const params = requirePlainObject(value, 'VDI clone parameters')
  requireExactKeys(params, ['vdiRef'], ['targetSrRef', 'nameLabel'], 'VDI clone parameters')
  const result: VdiCloneParams = { vdiRef: requireRef(params.vdiRef, 'VDI reference') }
  if (hasOwn(params, 'targetSrRef')) {
    result.targetSrRef = requireRef(params.targetSrRef, 'target SR reference')
  }
  if (hasOwn(params, 'nameLabel')) {
    result.nameLabel = requireString(params.nameLabel, 'VDI clone name')
  }
  return result
}

function parseVdiCopyParams(value: unknown): VdiCopyParams {
  const params = requirePlainObject(value, 'VDI copy parameters')
  requireExactKeys(params, ['vdiRef', 'targetSrRef'], ['nameLabel'], 'VDI copy parameters')
  const result: VdiCopyParams = {
    vdiRef: requireRef(params.vdiRef, 'VDI reference'),
    targetSrRef: requireRef(params.targetSrRef, 'target SR reference'),
  }
  if (hasOwn(params, 'nameLabel')) {
    result.nameLabel = requireString(params.nameLabel, 'VDI copy name')
  }
  return result
}

function createConnectionPayloadSchema<T>(
  label: string,
  parsePayload: (value: unknown) => T,
): IpcRuntimeSchema<[string, T]> {
  return {
    parse(value: unknown): [string, T] {
      const [connectionId, payload] = requireTuple(value, 2, label)
      return [requireNonBlankString(connectionId, 'connection identity'), parsePayload(payload)]
    },
  }
}

const vdiCloneArgsSchema = createConnectionPayloadSchema(
  'VDI clone arguments',
  parseVdiCloneParams,
)
const vdiCopyArgsSchema = createConnectionPayloadSchema('VDI copy arguments', parseVdiCopyParams)

const vdiSnapshotArgsSchema: IpcRuntimeSchema<[string, string, string?]> = {
  parse(value: unknown): [string, string, string?] {
    const args = requireTuple(value, 2, 'VDI snapshot arguments', 1)
    const result: [string, string, string?] = [
      requireNonBlankString(args[0], 'connection identity'),
      requireRef(args[1], 'VDI reference'),
    ]
    if (args.length === 3) {
      result.push(
        args[2] === undefined ? undefined : requireString(args[2], 'VDI snapshot name'),
      )
    }
    return result
  },
}

function createVdiTextArgsSchema(
  label: string,
  requireValue: (value: unknown, label: string) => string,
): IpcRuntimeSchema<[string, string, string]> {
  return {
    parse(value: unknown): [string, string, string] {
      const [connectionId, vdiRef, text] = requireTuple(value, 3, `${label} arguments`)
      return [
        requireNonBlankString(connectionId, 'connection identity'),
        requireRef(vdiRef, 'VDI reference'),
        requireValue(text, label),
      ]
    },
  }
}

const vdiNameArgsSchema = createVdiTextArgsSchema('VDI name', requireNonBlankString)
const vdiDescriptionArgsSchema = createVdiTextArgsSchema('VDI description', requireString)
const vdiTagArgsSchema = createVdiTextArgsSchema('VDI tag', requireNonBlankString)

function validateConnectedVdi(value: unknown): ConnectedVdiRecord {
  const record = requirePlainObject(value, 'connected VDI record')
  requireRef(record.ref, 'VDI reference')
  requireString(record.uuid, 'VDI UUID')
  requireString(record.name_label, 'VDI name')
  requireNonNegativeNumber(record.virtual_size, 'VDI virtual size')
  requireNonNegativeNumber(record.physical_utilisation, 'VDI physical utilisation')
  requireString(record.type, 'VDI type')
  requireRef(record.SR, 'SR reference')
  requireBoolean(record.read_only, 'VDI read-only state')
  requireNonBlankString(record.connectionId, 'connection identity')
  requireString(record.poolName, 'pool name')
  if (record.VBDs !== undefined) requireRefArray(record.VBDs, 'VDI VBD references')
  return value as ConnectedVdiRecord
}

const connectedVdiListResultSchema: IpcRuntimeSchema<ConnectedVdiRecord[]> = {
  parse(value: unknown): ConnectedVdiRecord[] {
    return requireArray(value, 'connected VDI list').map(validateConnectedVdi)
  },
}

function validateAttachableVdi(value: unknown): AttachableVdiRecord {
  const record = validateConnectedVdi(value)
  const raw = record as unknown as UnknownRecord
  requireString(raw.srName, 'SR name')
  requireBoolean(raw.forceReadOnly, 'forced read-only state')
  requireRefArray(raw.attachedVmRefs, 'attached VM references')
  return value as AttachableVdiRecord
}

const attachableVdiListResultSchema: IpcRuntimeSchema<AttachableVdiRecord[]> = {
  parse(value: unknown): AttachableVdiRecord[] {
    return requireArray(value, 'attachable VDI list').map(validateAttachableVdi)
  },
}

const vdiAllowedOperationsResultSchema: IpcRuntimeSchema<VdiAllowedOperations> = {
  parse(value: unknown): VdiAllowedOperations {
    const operations = requirePlainObject(value, 'VDI allowed operations')
    requireExactKeys(
      operations,
      ['resize', 'create', 'destroy', 'onlineResize'],
      [],
      'VDI allowed operations',
    )
    return {
      resize: requireBoolean(operations.resize, 'VDI resize permission'),
      create: requireBoolean(operations.create, 'VDI create permission'),
      destroy: requireBoolean(operations.destroy, 'VDI destroy permission'),
      onlineResize: requireBoolean(operations.onlineResize, 'VDI online resize permission'),
    }
  },
}

const vdiCreateForVmResultSchema: IpcRuntimeSchema<VdiCreateForVmResult> = {
  parse(value: unknown): VdiCreateForVmResult {
    const result = requirePlainObject(value, 'VM VDI creation result')
    requireExactKeys(result, ['vdiRef', 'vbdRef', 'plugged'], ['warning'], 'VM VDI creation result')
    const parsed: VdiCreateForVmResult = {
      vdiRef: requireRef(result.vdiRef, 'VDI reference'),
      vbdRef: requireRef(result.vbdRef, 'VBD reference'),
      plugged: requireBoolean(result.plugged, 'VBD plugged state'),
    }
    if (hasOwn(result, 'warning')) parsed.warning = requireString(result.warning, 'plug warning')
    return parsed
  },
}

const vdiDeleteResultSchema: IpcRuntimeSchema<VdiDeleteResult> = {
  parse(value: unknown): VdiDeleteResult {
    const result = requirePlainObject(value, 'VDI delete result')
    requireExactKeys(result, ['vdiDeleted'], ['detachedVbdRef', 'warning'], 'VDI delete result')
    const parsed: VdiDeleteResult = {
      vdiDeleted: requireBoolean(result.vdiDeleted, 'VDI deleted state'),
    }
    if (hasOwn(result, 'detachedVbdRef')) parsed.detachedVbdRef = requireRef(result.detachedVbdRef, 'detached VBD reference')
    if (hasOwn(result, 'warning')) parsed.warning = requireString(result.warning, 'VDI delete warning')
    return parsed
  },
}

const vdiAttachResultSchema: IpcRuntimeSchema<VdiAttachResult> = {
  parse(value: unknown): VdiAttachResult {
    const result = requirePlainObject(value, 'VDI attach result')
    requireExactKeys(result, ['vbdRef', 'plugged'], ['warning'], 'VDI attach result')
    const parsed: VdiAttachResult = {
      vbdRef: requireRef(result.vbdRef, 'VBD reference'),
      plugged: requireBoolean(result.plugged, 'VBD plugged state'),
    }
    if (hasOwn(result, 'warning')) parsed.warning = requireString(result.warning, 'attach warning')
    return parsed
  },
}

const vdiMoveResultSchema: IpcRuntimeSchema<VdiMoveResult> = {
  parse(value: unknown): VdiMoveResult {
    const result = requirePlainObject(value, 'VDI move result')
    requireExactKeys(result, ['newVdiRef'], [], 'VDI move result')
    return { newVdiRef: requireRef(result.newVdiRef, 'VDI reference') }
  },
}

const pbdCreateArgsSchema: IpcRuntimeSchema<[
  string,
  string,
  string,
  Record<string, string>?,
]> = {
  parse(value: unknown): [string, string, string, Record<string, string>?] {
    const args = requireTuple(value, 3, 'PBD creation arguments', 1)
    const result: [string, string, string, Record<string, string>?] = [
      requireNonBlankString(args[0], 'connection identity'),
      requireRef(args[1], 'host reference'),
      requireRef(args[2], 'SR reference'),
    ]
    if (args.length === 4) {
      result.push(
        args[3] === undefined
          ? undefined
          : requireOpenStringRecord(args[3], 'PBD device configuration'),
      )
    }
    return result
  },
}

function validateConnectedPbd(value: unknown): ConnectedPbdRecord {
  const record = requirePlainObject(value, 'connected PBD record')
  requireRef(record.ref, 'PBD reference')
  requireString(record.uuid, 'PBD UUID')
  requireRef(record.host, 'host reference')
  requireRef(record.SR, 'SR reference')
  requireOpenStringRecord(record.device_config, 'PBD device configuration')
  requireBoolean(record.currently_attached, 'PBD attached state')
  requireNonBlankString(record.connectionId, 'connection identity')
  requireString(record.poolName, 'pool name')
  return value as ConnectedPbdRecord
}

const connectedPbdListResultSchema: IpcRuntimeSchema<ConnectedPbdRecord[]> = {
  parse(value: unknown): ConnectedPbdRecord[] {
    return requireArray(value, 'connected PBD list').map(validateConnectedPbd)
  },
}

function parseIsoImage(value: unknown): IsoImageRecord {
  const record = requirePlainObject(value, 'ISO image record')
  requireExactKeys(
    record,
    [
      'ref',
      'uuid',
      'name_label',
      'name_description',
      'virtual_size',
      'physical_utilisation',
      'type',
      'SR',
      'srName',
      'read_only',
      'connectionId',
      'poolName',
    ],
    [],
    'ISO image record',
  )
  return {
    ref: requireRef(record.ref, 'ISO VDI reference'),
    uuid: requireString(record.uuid, 'ISO UUID'),
    name_label: requireString(record.name_label, 'ISO name'),
    name_description: requireString(record.name_description, 'ISO description'),
    virtual_size: requireNonNegativeNumber(record.virtual_size, 'ISO virtual size'),
    physical_utilisation: requireNonNegativeNumber(
      record.physical_utilisation,
      'ISO physical utilisation',
    ),
    type: requireString(record.type, 'ISO VDI type'),
    SR: requireRef(record.SR, 'ISO SR reference'),
    srName: requireString(record.srName, 'ISO SR name'),
    read_only: requireBoolean(record.read_only, 'ISO read-only state'),
    connectionId: requireNonBlankString(record.connectionId, 'connection identity'),
    poolName: requireString(record.poolName, 'pool name'),
  }
}

const isoImageListResultSchema: IpcRuntimeSchema<IsoImageRecord[]> = {
  parse(value: unknown): IsoImageRecord[] {
    return requireArray(value, 'ISO image list').map(parseIsoImage)
  },
}

const invokeBoundary = {
  errorShape: 'ipc-error-response-v1' as const,
  callerPolicy: 'app-window-main-frame' as const,
  redaction: ['none'] as const,
}

export const srListContract = defineInvokeContract({
  channel: Ch.SR_LIST,
  argsSchema: connectionArgsSchema,
  resultSchema: connectedSrListResultSchema,
  ...invokeBoundary,
})

export const srCreateContract = defineInvokeContract({
  channel: Ch.SR_CREATE,
  argsSchema: srCreateArgsSchema,
  resultSchema: referenceResultSchema,
  ...invokeBoundary,
  redaction: ['storage-secret'],
})

export const srDestroyContract = defineInvokeContract({
  channel: Ch.SR_DESTROY,
  argsSchema: srRefArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const srScanContract = defineInvokeContract({
  channel: Ch.SR_SCAN,
  argsSchema: srRefArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const srDetachContract = defineInvokeContract({
  channel: Ch.SR_DETACH,
  argsSchema: srRefArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const srSetDefaultContract = defineInvokeContract({
  channel: Ch.SR_SET_DEFAULT,
  argsSchema: srSetDefaultArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const srProbeNfsContract = defineInvokeContract({
  channel: Ch.SR_PROBE_NFS,
  argsSchema: srProbeArgsSchema,
  resultSchema: nfsTargetsResultSchema,
  ...invokeBoundary,
})

export const srProbeIscsiContract = defineInvokeContract({
  channel: Ch.SR_PROBE_ISCSI,
  argsSchema: iscsiProbeArgsSchema,
  resultSchema: iscsiTargetsResultSchema,
  ...invokeBoundary,
  redaction: ['storage-secret'],
})

export const srIntroduceContract = defineInvokeContract({
  channel: Ch.SR_INTRODUCE,
  argsSchema: srIntroduceArgsSchema,
  resultSchema: referenceResultSchema,
  ...invokeBoundary,
})

export const srForgetContract = defineInvokeContract({
  channel: Ch.SR_FORGET,
  argsSchema: srRefArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const srSetSharedContract = defineInvokeContract({
  channel: Ch.SR_SET_SHARED,
  argsSchema: srSetSharedArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const srGetThinStatsContract = defineInvokeContract({
  channel: Ch.SR_GET_THIN_STATS,
  argsSchema: srRefArgsSchema,
  resultSchema: thinStatsResultSchema,
  ...invokeBoundary,
})

export const vdiListContract = defineInvokeContract({
  channel: Ch.VDI_LIST,
  argsSchema: srRefArgsSchema,
  resultSchema: connectedVdiListResultSchema,
  ...invokeBoundary,
})

export const vdiCreateContract = defineInvokeContract({
  channel: Ch.VDI_CREATE,
  argsSchema: vdiCreateArgsSchema,
  resultSchema: referenceResultSchema,
  ...invokeBoundary,
})

export const vdiDestroyContract = defineInvokeContract({
  channel: Ch.VDI_DESTROY,
  argsSchema: vdiRefArgsSchema,
  resultSchema: vdiDeleteResultSchema,
  ...invokeBoundary,
})

export const vdiResizeContract = defineInvokeContract({
  channel: Ch.VDI_RESIZE,
  argsSchema: vdiResizeArgsSchema,
  resultSchema: referenceResultSchema,
  ...invokeBoundary,
})

export const vdiCreateForVmContract = defineInvokeContract({
  channel: Ch.VDI_CREATE_FOR_VM,
  argsSchema: vdiCreateForVmArgsSchema,
  resultSchema: vdiCreateForVmResultSchema,
  ...invokeBoundary,
})

export const vdiGetAllowedOperationsContract = defineInvokeContract({
  channel: Ch.VDI_GET_ALLOWED_OPERATIONS,
  argsSchema: vdiAllowedOperationsArgsSchema,
  resultSchema: vdiAllowedOperationsResultSchema,
  ...invokeBoundary,
})

export const vdiListAttachableContract = defineInvokeContract({
  channel: Ch.VDI_LIST_ATTACHABLE,
  argsSchema: vdiRefArgsSchema,
  resultSchema: attachableVdiListResultSchema,
  ...invokeBoundary,
})

export const vdiAttachExistingContract = defineInvokeContract({
  channel: Ch.VDI_ATTACH_EXISTING,
  argsSchema: vdiAttachArgsSchema,
  resultSchema: vdiAttachResultSchema,
  ...invokeBoundary,
})

export const vdiMoveContract = defineInvokeContract({
  channel: Ch.VDI_MOVE,
  argsSchema: vdiMoveArgsSchema,
  resultSchema: vdiMoveResultSchema,
  ...invokeBoundary,
})

export const vdiCloneContract = defineInvokeContract({
  channel: Ch.VDI_CLONE,
  argsSchema: vdiCloneArgsSchema,
  resultSchema: referenceResultSchema,
  ...invokeBoundary,
})

export const vdiSnapshotContract = defineInvokeContract({
  channel: Ch.VDI_SNAPSHOT_ADVANCED,
  argsSchema: vdiSnapshotArgsSchema,
  resultSchema: referenceResultSchema,
  ...invokeBoundary,
})

export const vdiCopyContract = defineInvokeContract({
  channel: Ch.VDI_COPY,
  argsSchema: vdiCopyArgsSchema,
  resultSchema: referenceResultSchema,
  ...invokeBoundary,
})

export const vdiSetNameLabelContract = defineInvokeContract({
  channel: Ch.VDI_SET_NAME_LABEL,
  argsSchema: vdiNameArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const vdiSetNameDescriptionContract = defineInvokeContract({
  channel: Ch.VDI_SET_NAME_DESCRIPTION,
  argsSchema: vdiDescriptionArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const vdiAddTagContract = defineInvokeContract({
  channel: Ch.VDI_ADD_TAG,
  argsSchema: vdiTagArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const vdiRemoveTagContract = defineInvokeContract({
  channel: Ch.VDI_REMOVE_TAG,
  argsSchema: vdiTagArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const pbdListContract = defineInvokeContract({
  channel: Ch.PBD_LIST,
  argsSchema: connectionArgsSchema,
  resultSchema: connectedPbdListResultSchema,
  ...invokeBoundary,
})

export const pbdCreateContract = defineInvokeContract({
  channel: Ch.PBD_CREATE,
  argsSchema: pbdCreateArgsSchema,
  resultSchema: referenceResultSchema,
  ...invokeBoundary,
  redaction: ['storage-secret'],
})

export const pbdPlugContract = defineInvokeContract({
  channel: Ch.PBD_PLUG,
  argsSchema: vdiRefArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const pbdUnplugContract = defineInvokeContract({
  channel: Ch.PBD_UNPLUG,
  argsSchema: vdiRefArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const pbdDestroyContract = defineInvokeContract({
  channel: Ch.PBD_DESTROY,
  argsSchema: vdiRefArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const isoListContract = defineInvokeContract({
  channel: Ch.ISO_LIST,
  argsSchema: srRefArgsSchema,
  resultSchema: connectedVdiListResultSchema,
  ...invokeBoundary,
})

export const isoListAllContract = defineInvokeContract({
  channel: Ch.ISO_LIST_ALL,
  argsSchema: connectionArgsSchema,
  resultSchema: isoImageListResultSchema,
  ...invokeBoundary,
})

export const isoDeleteContract = defineInvokeContract({
  channel: Ch.ISO_DELETE,
  argsSchema: vdiRefArgsSchema,
  resultSchema: voidResultSchema,
  ...invokeBoundary,
})

export const srUpdateIdentityContract = defineInvokeContract({
  channel: Ch.SR_UPDATE_IDENTITY,
  argsSchema: srIdentityArgsSchema,
  resultSchema: srIdentityResultSchema,
  ...invokeBoundary,
})

export const storageContracts = [
  srListContract,
  srCreateContract,
  srDestroyContract,
  srScanContract,
  srDetachContract,
  srSetDefaultContract,
  srProbeNfsContract,
  srProbeIscsiContract,
  srIntroduceContract,
  srForgetContract,
  srSetSharedContract,
  srGetThinStatsContract,
  vdiListContract,
  vdiCreateContract,
  vdiDestroyContract,
  vdiResizeContract,
  vdiCreateForVmContract,
  vdiGetAllowedOperationsContract,
  vdiListAttachableContract,
  vdiAttachExistingContract,
  vdiMoveContract,
  vdiCloneContract,
  vdiSnapshotContract,
  vdiCopyContract,
  vdiSetNameLabelContract,
  vdiSetNameDescriptionContract,
  vdiAddTagContract,
  vdiRemoveTagContract,
  pbdListContract,
  pbdCreateContract,
  pbdPlugContract,
  pbdUnplugContract,
  pbdDestroyContract,
  isoListContract,
  isoListAllContract,
  isoDeleteContract,
  srUpdateIdentityContract,
] as const
