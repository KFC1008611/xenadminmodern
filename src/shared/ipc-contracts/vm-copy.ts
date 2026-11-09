import * as Ch from '../channels'
import { defineInvokeContract, type IpcRuntimeSchema } from '../ipc-contract'
import type { VmCopyOperation, VmCopyPlan } from '../types/xapi'
import { invalid, requireArray, requireBoolean, requireEnum, requireExactKeys,
  requireNonBlankString, requireNonNegativeNumber, requirePlainObject, requireRef, requireString,
  requireStringArray, requireTuple } from './runtime-schema'

export const COPY_MODES = new Set<VmCopyOperation['mode']>(['clone', 'copy', 'cross-pool-copy'])
const states = new Set<VmCopyOperation['status']>(['preparing', 'pending', 'cancelling', 'unknown', 'completed', 'failed', 'cancelled'])
const boundary = { errorShape: 'ipc-error-response-v1', callerPolicy: 'app-window-main-frame', redaction: ['none'] } as const
export const copyOperationSchema: IpcRuntimeSchema<VmCopyOperation> = {
  parse(value) {
    const v = requirePlainObject(value, 'copy operation')
    requireExactKeys(v, ['id', 'sourceConnectionId', 'targetConnectionId', 'sourcePoolUuid', 'targetPoolUuid', 'sourcePoolName', 'targetPoolName',
      'sourceVmRef', 'name', 'isTemplate', 'mode', 'status', 'progress', 'message', 'warnings', 'cancellable', 'createdAt'],
    ['taskRef', 'vmRef', 'vmUuid'], 'copy operation')
    for (const key of ['id', 'sourceConnectionId', 'targetConnectionId', 'sourcePoolUuid', 'targetPoolUuid', 'name'] as const) requireNonBlankString(v[key], key)
    for (const key of ['sourcePoolName', 'targetPoolName', 'message'] as const) requireString(v[key], key)
    requireRef(v.sourceVmRef, 'source VM')
    requireBoolean(v.isTemplate, 'template flag')
    requireBoolean(v.cancellable, 'cancellable')
    requireEnum(v.mode, COPY_MODES, 'copy mode')
    requireEnum(v.status, states, 'copy status')
    if (requireNonNegativeNumber(v.progress, 'progress') > 100) invalid('progress')
    requireNonNegativeNumber(v.createdAt, 'creation time')
    requireStringArray(v.warnings, 'warnings')
    if (v.taskRef !== undefined) requireRef(v.taskRef, 'task')
    if (v.vmRef !== undefined) requireRef(v.vmRef, 'result VM')
    if (v.vmUuid !== undefined) requireNonBlankString(v.vmUuid, 'result UUID')
    if (v.status === 'completed' && (!v.vmRef || !v.vmUuid)) invalid('confirmed copy result')
    return v as unknown as VmCopyOperation
  },
}
export const copyPlanSchema: IpcRuntimeSchema<VmCopyPlan> = {
  parse(value) {
    const v = requirePlainObject(value, 'copy plan')
    requireExactKeys(v, ['sourceConnectionId', 'targetConnectionId', 'vmRef', 'sourceUuid', 'isTemplate',
      'powerState', 'allowedModes', 'blockers', 'warnings', 'disks', 'vifs', 'hosts', 'srs', 'networks'], [], 'copy plan')
    for (const key of ['sourceConnectionId', 'targetConnectionId', 'sourceUuid', 'powerState']) requireNonBlankString(v[key], key)
    requireRef(v.vmRef, 'VM')
    requireBoolean(v.isTemplate, 'template flag')
    requireStringArray(v.blockers, 'blockers'); requireStringArray(v.warnings, 'warnings')
    requireArray(v.allowedModes, 'copy modes').forEach((mode) => requireEnum(mode, COPY_MODES, 'copy mode'))
    for (const item of requireArray(v.disks, 'copy disks')) {
      const d = requirePlainObject(item, 'copy disk')
      requireExactKeys(d, ['vdiRef', 'vbdRef', 'vmRef', 'vmName', 'history', 'suspend', 'device', 'name', 'size', 'srRef'], [], 'copy disk')
      for (const key of ['vdiRef', 'vmRef', 'srRef']) requireRef(d[key], key)
      requireString(d.vbdRef, 'VBD'); requireString(d.vmName, 'VM name'); requireString(d.device, 'device'); requireString(d.name, 'name')
      requireBoolean(d.history, 'history'); requireBoolean(d.suspend, 'suspend'); requireNonNegativeNumber(d.size, 'disk size')
    }
    for (const item of requireArray(v.vifs, 'copy VIFs')) {
      const n = requirePlainObject(item, 'copy VIF')
      requireExactKeys(n, ['vifRef', 'vmRef', 'vmName', 'history', 'device', 'networkRef', 'networkName'], [], 'copy VIF')
      for (const key of ['vifRef', 'vmRef', 'networkRef']) requireRef(n[key], key)
      for (const key of ['vmName', 'device', 'networkName']) requireString(n[key], key)
      requireBoolean(n.history, 'history')
    }
    for (const item of requireArray(v.hosts, 'hosts')) {
      const h = requirePlainObject(item, 'host'); requireExactKeys(h, ['ref', 'name'], [], 'host')
      requireRef(h.ref, 'host ref'); requireString(h.name, 'host name')
    }
    for (const item of requireArray(v.srs, 'SRs')) {
      const s = requirePlainObject(item, 'SR'); requireExactKeys(s, ['ref', 'name', 'freeBytes', 'hostRefs'], [], 'SR')
      requireRef(s.ref, 'SR ref'); requireString(s.name, 'SR name'); requireStringArray(s.hostRefs, 'SR hosts')
      if (s.freeBytes !== null) requireNonNegativeNumber(s.freeBytes, 'SR free bytes')
    }
    for (const item of requireArray(v.networks, 'networks')) {
      const n = requirePlainObject(item, 'network'); requireExactKeys(n, ['ref', 'name', 'hostRefs', 'transferHostRefs'], [], 'network')
      requireRef(n.ref, 'network ref'); requireString(n.name, 'network name')
      requireStringArray(n.hostRefs, 'network hosts'); requireStringArray(n.transferHostRefs, 'transfer hosts')
    }
    return v as unknown as VmCopyPlan
  },
}
export const vmCopyPlanContract = defineInvokeContract({
  channel: Ch.VM_COPY_PLAN,
  argsSchema: { parse(value: unknown): [string, string, string] {
    const [source, vm, target] = requireTuple(value, 3, 'copy plan arguments')
    return [requireNonBlankString(source, 'source connection'), requireRef(vm, 'VM'), requireNonBlankString(target, 'target connection')]
  } },
  resultSchema: copyPlanSchema, ...boundary,
})
export const vmCopyOperationsContract = defineInvokeContract({
  channel: Ch.VM_COPY_OPERATIONS,
  argsSchema: { parse(value: unknown): [] { requireTuple(value, 0, 'copy history arguments'); return [] } },
  resultSchema: { parse(value: unknown) { return requireArray(value, 'copy operations').map((v) => copyOperationSchema.parse(v)) } },
  ...boundary,
})
export const vmCancelCopyContract = defineInvokeContract({
  channel: Ch.VM_CANCEL_COPY,
  argsSchema: { parse(value: unknown): [string] {
    const [id] = requireTuple(value, 1, 'cancel copy arguments'); return [requireNonBlankString(id, 'copy identity')]
  } },
  resultSchema: copyOperationSchema, ...boundary,
})
