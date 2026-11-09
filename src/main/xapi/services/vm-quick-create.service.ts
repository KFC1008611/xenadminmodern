import { connectionManager } from '../connection-manager'
import { readJsonStore, writeJsonStore } from '../../persistence/json-store'
import { readOperationResult } from '../../../shared/read-operation-result'
import { templateQuickCreateGuard } from '../../../shared/template-quick-create'
import { canRunVmAction } from '../../../shared/vm-actions'
import { waitForXapiTask, XapiTaskError } from './xapi-task'

type Stage = 'clone' | 'provision' | 'configure' | 'start'
interface PendingCreate {
  poolUuid: string
  templateUuid: string
  stage: Stage
  taskRef?: string
  vmRef?: string
  vmUuid?: string
  creationComplete?: boolean
}
const storeName = 'vm-quick-creates'
const active = new Set<string>()
const namesInUse = new Set<string>()
const keyOf = (record: Pick<PendingCreate, 'poolUuid' | 'templateUuid'>) => JSON.stringify([record.poolUuid, record.templateUuid])
const validRef = (value: unknown): value is string => typeof value === 'string' && /^OpaqueRef:[\w.:-]+$/.test(value) && value !== 'OpaqueRef:NULL'
function load(): PendingCreate[] {
  const records = readJsonStore<PendingCreate[]>(storeName, [])
  if (!Array.isArray(records) || records.some((r) => !r || typeof r.poolUuid !== 'string' || !r.poolUuid
    || typeof r.templateUuid !== 'string' || !r.templateUuid
    || !['clone', 'provision', 'configure', 'start'].includes(r.stage)
    || (r.taskRef !== undefined && !validRef(r.taskRef)) || (r.vmRef !== undefined && !validRef(r.vmRef))
    || (r.vmUuid !== undefined && (typeof r.vmUuid !== 'string' || !r.vmUuid || r.vmUuid === r.templateUuid))
    || (r.creationComplete !== undefined && typeof r.creationComplete !== 'boolean')
    || (r.stage !== 'clone' && (!r.vmRef || !r.vmUuid))
    || (r.stage === 'start' && r.creationComplete !== true))
    || new Set(records.map(keyOf)).size !== records.length) {
    throw new Error('快速创建记录无效，原文件已保留，请先核对已有任务')
  }
  return records
}
function save(record: PendingCreate) {
  writeJsonStore(storeName, [...load().filter((r) => keyOf(r) !== keyOf(record)), record])
}
function forget(record: PendingCreate) {
  writeJsonStore(storeName, load().filter((r) => keyOf(r) !== keyOf(record)))
}
function failure(code: string, message: string, record?: PendingCreate, outcome = 'failed') {
  return Object.assign(new Error(message), { code, details: { ...record, outcome } })
}
function resultRef(result: unknown): string {
  const refs = typeof result === 'string' ? [...new Set(result.match(/OpaqueRef:[\w.:-]+/g) ?? [])] : []
  if (refs.length !== 1 || !validRef(refs[0])) throw new Error('克隆任务未返回唯一的副本引用')
  return refs[0]
}
function uncertain(error: any): boolean {
  return error?.code === 'TASK_OUTCOME_UNKNOWN' || (error?.details?.kind !== 'xapi'
    && !(error instanceof XapiTaskError && ['TASK_FAILED', 'TASK_CANCELLED'].includes(error.code)))
}

/** Clone/provision/start without a wizard. An unconfirmed write is never replayed. */
export async function quickCreateFromTemplate(connectionId: string, templateRef: string): Promise<string> {
  const connectionKey = JSON.stringify([connectionId, templateRef])
  if (active.has(connectionKey)) throw failure('VM_QUICK_CREATE_IN_PROGRESS', '该模板正在快速创建 VM，请等待结果')
  active.add(connectionKey)
  let resourceKey: string | undefined
  let reservedName: string | undefined
  let pending: PendingCreate | undefined
  try {
    const client = connectionManager.getClient(connectionId)
    const info = connectionManager.getConnectionInfo(connectionId)
    if (!client || !info?.poolUuid) throw failure('VM_QUICK_CREATE_PRECHECK_FAILED', '原资源池未连接，请重新连接并刷新模板')
    const current = () => connectionManager.getClient(connectionId) === client
      && connectionManager.getConnectionInfo(connectionId)?.poolUuid === info.poolUuid
      && connectionManager.getConnectionInfo(connectionId)?.epoch === info.epoch
    const assertCurrent = () => { if (!current()) throw new Error('管理连接已变化，请重新连接原资源池核对已有任务') }
    const readVm = (ref: string) => readOperationResult(() => client.callWithSession('VM.get_record', [ref]), { isCurrent: current })
    const taskClient = { callWithSession: async (method: string, params: unknown[]) => {
      assertCurrent()
      const value = await client.callWithSession(method, params)
      assertCurrent()
      return value
    } }
    const template = await readVm(templateRef)
    if (!template?.uuid) throw failure('VM_QUICK_CREATE_PRECHECK_FAILED', '无法确认模板身份，请刷新')
    resourceKey = keyOf({ poolUuid: info.poolUuid, templateUuid: template.uuid })
    if (active.has(resourceKey)) {
      resourceKey = undefined
      throw failure('VM_QUICK_CREATE_IN_PROGRESS', '该模板已从另一个连接发起快速创建，请等待结果')
    }
    active.add(resourceKey)
    pending = load().find((r) => keyOf(r) === resourceKey)
    if (pending) {
      // A subsequent click or application restart only observes the original attempt.
      if (pending.taskRef) {
        const task = await waitForXapiTask(taskClient, pending.taskRef, { timeoutMs: Infinity })
        if (pending.stage === 'clone') { pending.vmRef = resultRef(task.result); save(pending) }
      }
      if (!pending.vmRef) throw failure('VM_QUICK_CREATE_OUTCOME_UNKNOWN', '上次快速创建的响应未确认，请先核对服务器任务和副本；不会重复创建', pending, 'unknown')
      const vm = await readVm(pending.vmRef)
      if (!vm.uuid || vm.uuid === pending.templateUuid || vm.is_a_snapshot || vm.is_control_domain) throw new Error('原副本身份或类型无法确认')
      if (pending.vmUuid && vm.uuid !== pending.vmUuid) throw new Error('原副本身份已变化')
      if (pending.stage === 'start' && pending.creationComplete && pending.vmUuid === vm.uuid
        && vm.is_a_template === false && vm.power_state === 'Running') {
        forget(pending)
        return pending.vmRef
      }
      if (pending.stage === 'start' && !pending.taskRef) throw failure('VM_CREATED_START_INCOMPLETE', `虚拟机已创建，但上次启动结果仍未确认；已保留 VM ${pending.vmRef}，请核对后手动启动`, pending, 'unknown')
      forget(pending)
      throw failure('VM_QUICK_CREATE_INCOMPLETE', `已找到上次创建的副本 ${pending.vmRef}，当前状态为 ${vm.power_state}；请检查现有副本，本次未重新创建或启动`, pending, 'partial')
    }
    const guard = templateQuickCreateGuard(template)
    if (!guard.canRun) throw failure('VM_QUICK_CREATE_PRECHECK_FAILED', guard.reason!)
    pending = { poolUuid: info.poolUuid, templateUuid: template.uuid, stage: 'clone' }

    const runTask = async (stage: 'clone' | 'provision' | 'start', method: string, params: unknown[]) => {
      assertCurrent()
      pending = { ...pending!, stage, taskRef: undefined }
      // Save before submission, including when the response is lost.
      save(pending)
      const taskRef = await client.callWithSession(method, params)
      if (!validRef(taskRef)) throw new Error('服务器未返回有效任务引用')
      pending = { ...pending, taskRef }
      save(pending)
      return waitForXapiTask(taskClient, taskRef, { timeoutMs: Infinity })
    }

    const base = String(template.name_label || 'New VM').trim() || 'New VM'
    const cloned = await runTask('clone', 'Async.VM.clone', [templateRef, base])
    pending = { ...pending, vmRef: resultRef(cloned.result), taskRef: undefined }
    save(pending)
    const clone = await readVm(pending.vmRef!)
    if (!clone?.uuid || clone.uuid === template.uuid || clone.is_a_snapshot || clone.is_control_domain) throw new Error('无法确认克隆副本身份')
    pending = { ...pending, vmUuid: clone.uuid }
    save(pending)
    await runTask('provision', 'Async.VM.provision', [pending.vmRef])
    pending = { ...pending, stage: 'configure', taskRef: undefined }
    save(pending)
    const vm = await readVm(pending.vmRef!)
    if (vm.uuid !== pending.vmUuid || vm.is_a_template !== false || vm.is_a_snapshot || vm.is_control_domain || vm.power_state !== 'Halted') {
      throw new Error('未能确认 provision 后的副本身份、类型和状态')
    }
    const allVms = await readOperationResult(() => client.callWithSession('VM.get_all_records', []), { isCurrent: current })
    const names = new Set(Object.entries(allVms).filter(([ref]) => ref !== pending!.vmRef).map(([, value]: [string, any]) => value.name_label))
    let index = 1
    while (names.has(`${base} (${index})`) || names.has(`__gui__${base} (${index})`)
      || namesInUse.has(JSON.stringify([info.poolUuid, `${base} (${index})`]))) index++
    const name = `${base} (${index})`
    reservedName = JSON.stringify([info.poolUuid, name])
    namesInUse.add(reservedName)
    assertCurrent()
    await client.callWithSession('VM.set_name_label', [pending.vmRef, name])
    assertCurrent()
    await client.callWithSession('VM.remove_from_other_config', [pending.vmRef, 'HideFromXenCenter'])
    const configured = await readVm(pending.vmRef!)
    if (configured.uuid !== pending.vmUuid || configured.is_a_template !== false || configured.is_a_snapshot || configured.is_control_domain
      || configured.name_label !== name || configured.other_config?.HideFromXenCenter === 'true') throw new Error('无法确认副本的最终设置')
    pending = { ...pending, creationComplete: true }
    save(pending)
    const startGuard = canRunVmAction(configured, 'start')
    if (!startGuard.canRun) {
      forget(pending)
      throw failure('VM_CREATED_START_INCOMPLETE', `虚拟机已创建，启动未完成：${startGuard.reason}。已保留 VM ${pending.vmRef}`, pending, 'partial')
    }
    await runTask('start', 'Async.VM.start', [pending.vmRef, false, false])
    const running = await readVm(pending.vmRef!)
    if (running.uuid !== pending.vmUuid || running.power_state !== 'Running' || running.is_a_template || running.is_a_snapshot || running.is_control_domain) {
      throw new Error('未能确认副本已启动')
    }
    forget(pending)
    return pending.vmRef!
  } catch (error: any) {
    if (!pending || ['VM_QUICK_CREATE_PRECHECK_FAILED', 'VM_QUICK_CREATE_IN_PROGRESS', 'VM_QUICK_CREATE_INCOMPLETE', 'VM_CREATED_START_INCOMPLETE'].includes(error?.code)) throw error
    const unknown = uncertain(error)
    if (!unknown) forget(pending)
    const retained = pending.vmRef ? `。已保留 VM ${pending.vmRef}` : ''
    const task = pending.taskRef ? `，任务 ${pending.taskRef}` : ''
    throw failure(pending.creationComplete ? 'VM_CREATED_START_INCOMPLETE' : unknown ? 'VM_QUICK_CREATE_OUTCOME_UNKNOWN' : 'VM_QUICK_CREATE_FAILED',
      `${pending.creationComplete ? '虚拟机已创建，启动未完成' : unknown ? '快速创建结果尚未确认' : '快速创建失败'}${task}：${error?.message || String(error)}${retained}${unknown ? '。再次操作只核对原结果，不重复提交' : ''}`,
      pending, unknown ? 'unknown' : pending.creationComplete ? 'partial' : 'failed')
  } finally {
    active.delete(connectionKey)
    if (resourceKey) active.delete(resourceKey)
    if (reservedName) namesInUse.delete(reservedName)
  }
}
