/** Durable Async VM copies. Observing/reconnecting never replays a mutation. */
import { randomUUID } from 'node:crypto'
import { connectionManager } from '../connection-manager'
import { readJsonStore, writeJsonStore } from '../../persistence/json-store'
import { copyOperationSchema, copyPlanSchema } from '../../../shared/ipc-contracts/vm-copy'
import type { VmCopyOperation, VmCopyPayload, VmCopyPlan } from '../../../shared/types/xapi'
import { copyClient, copyError, getVmCopyPlan, mapCopyReads, nonNullRef, readCopySource, validateCopyPlacement } from './vm-copy-resources'

export { getVmCopyPlan } from './vm-copy-resources'
interface SavedCopy {
  operation: VmCopyOperation
  payload: VmCopyPayload
  sourcePoolUuid: string
  targetPoolUuid: string
  sourceFingerprint: string
  sourceUuid: string
  plan: VmCopyPlan
  issued: boolean
  configurationAttempted?: boolean
  cancelRequested?: boolean
  taskCleaned?: boolean
}
let records: SavedCopy[] | undefined
const active = new Set<string>()
const idleWaiters = new Map<string, Array<() => void>>()
function release(id: string) {
  active.delete(id)
  const waiting = idleWaiters.get(id) ?? []
  idleWaiters.delete(id)
  for (const resolve of waiting) resolve()
}
const terminal = (s: string) => ['completed', 'failed', 'cancelled'].includes(s)
function load(): SavedCopy[] {
  if (records) return records
  const saved = readJsonStore<SavedCopy[]>('vm-copies', [])
  if (!Array.isArray(saved)) throw new Error('本地复制记录格式无效，已保留原文件')
  let recoveredUnissued = false
  for (const r of saved) {
    // Read records written before pool identity was included in the public DTO.
    r.operation = { ...r.operation, sourcePoolUuid: r.sourcePoolUuid, targetPoolUuid: r.targetPoolUuid }
    copyOperationSchema.parse(r.operation); copyPlanSchema.parse(r.plan)
    if (!r.sourcePoolUuid || !r.targetPoolUuid || !r.sourceUuid || r.plan.sourceUuid !== r.sourceUuid
      || r.payload?.vmRef !== r.operation.sourceVmRef || r.plan.vmRef !== r.operation.sourceVmRef || typeof r.sourceFingerprint !== 'string'
      || typeof r.issued !== 'boolean' || !r.payload?.vmRef || !r.payload.newName) throw new Error('本地复制记录不完整，已保留原文件')
    if (!terminal(r.operation.status)) {
      // issued is persisted before the Async mutation. Only a record without
      // any server identity can prove that a restart interrupted preflight.
      if (!r.issued && !r.operation.taskRef && !r.operation.vmRef && !r.operation.vmUuid) {
        r.operation = { ...r.operation, status: 'failed', cancellable: false,
          message: '应用退出前复制尚未提交，可重新发起复制' }
        recoveredUnissued = true
      } else r.operation = { ...r.operation, status: 'unknown', cancellable: false,
        message: r.operation.taskRef ? '等待重新连接原资源池，核对已有复制任务' : '应用退出前尚未确认任务身份，请核对资源池；不会自动重试复制' }
    }
  }
  if (recoveredUnissued) writeJsonStore('vm-copies', saved)
  records = saved
  return records
}
function save(record: SavedCopy): void {
  const candidates = load().filter((r) => r.operation.id !== record.operation.id).concat(record)
  const recentTerminal = new Set(candidates.filter((r) => terminal(r.operation.status)).sort((a, b) => b.operation.createdAt - a.operation.createdAt).slice(0, 50).map((r) => r.operation.id))
  const next = candidates.filter((r) => !terminal(r.operation.status) || recentTerminal.has(r.operation.id))
  writeJsonStore('vm-copies', next)
  records = next
}
function patch(record: SavedCopy, changes: Partial<VmCopyOperation>): SavedCopy {
  const next = { ...record, operation: { ...record.operation, ...changes } }
  if (JSON.stringify(next.operation) === JSON.stringify(record.operation)) return record
  save(next)
  return next
}
function currentRecord(id: string): SavedCopy {
  const record = load().find((r) => r.operation.id === id)
  if (!record) throw copyError('COPY_NOT_FOUND', '未找到原复制记录')
  return record
}
function connectionFor(id: string, uuid: string): string {
  if (connectionManager.getConnectionInfo(id)?.poolUuid === uuid && connectionManager.getClient(id)) return id
  const found = connectionManager.listConnections().find((c) => c.poolUuid === uuid && c.state === 'connected')
  if (!found) throw copyError('COPY_CONNECTION_UNAVAILABLE', '原资源池未连接或身份已变化，请重新连接原资源池后核对任务')
  return found.id
}
function bindPool(record: SavedCopy, side: 'source' | 'target'): SavedCopy {
  const key = side === 'source' ? 'sourceConnectionId' : 'targetConnectionId'
  const uuid = side === 'source' ? record.sourcePoolUuid : record.targetPoolUuid
  const id = connectionFor(record.operation[key], uuid)
  return patch(record, record.sourcePoolUuid === record.targetPoolUuid
    ? { sourceConnectionId: id, targetConnectionId: id } : { [key]: id })
}
function resultRef(result: unknown): string {
  const refs = [...new Set(String(result ?? '').match(/OpaqueRef:[A-Za-z0-9._:-]+/g) ?? [])].filter(nonNullRef)
  if (refs.length !== 1) throw copyError('COPY_RESULT_UNCONFIRMED', '服务器任务成功，但未返回唯一的副本引用')
  return refs[0]
}
function currentDeviceSignature(disks: VmCopyPlan['disks'], vifs: VmCopyPlan['vifs'], payload?: VmCopyPayload): string {
  return JSON.stringify({
    disks: disks.filter((d) => !d.history).map((d) => [d.suspend, d.device, d.size, payload ? payload.mode === 'cross-pool-copy' ? payload.storageMap?.[d.vdiRef] : payload.mode === 'copy' || payload.targetSrRef ? payload.targetSrRef : d.srRef : d.srRef]).sort(),
    vifs: vifs.filter((v) => !v.history).map((v) => [v.device, payload?.mode === 'cross-pool-copy' ? payload.networkMap?.[v.vifRef] : v.networkRef]).sort(),
  })
}
async function verifyResult(record: SavedCopy, ref: string, sourceId: string): Promise<SavedCopy> {
  record = bindPool(record, 'target')
  const targetId = record.operation.targetConnectionId
  const cross = record.operation.mode === 'cross-pool-copy'
  const sourceClient = copyClient(sourceId)
  const targetClient = copyClient(targetId)
  const assertScope = () => {
    if (connectionManager.getConnectionInfo(sourceId)?.poolUuid !== record.sourcePoolUuid || connectionManager.getConnectionInfo(targetId)?.poolUuid !== record.targetPoolUuid
      || copyClient(sourceId) !== sourceClient || copyClient(targetId) !== targetClient) throw copyError('COPY_SCOPE_CHANGED', '连接身份在核对期间发生变化，等待原池恢复')
  }
  const [source, target] = await Promise.all([
    readCopySource(sourceClient, record.payload.vmRef, cross), readCopySource(targetClient, ref, false),
  ])
  assertScope()
  if (source.vm.uuid !== record.sourceUuid || source.fingerprint !== record.sourceFingerprint) throw copyError('COPY_SOURCE_CHANGED', '源对象或磁盘、网卡、光驱关系发生变化，副本已创建，请核对源和目标')
  if (!target.vm.uuid || target.vm.uuid === record.sourceUuid || target.vm.is_a_snapshot || target.vm.is_control_domain
    || (target.vm.is_a_template === true) !== record.operation.isTemplate || target.vm.power_state !== 'Halted') throw copyError('COPY_RESULT_UNCONFIRMED', '副本身份、类型或电源状态未通过核对')
  // migrate_send(copy=true) still processes historical device mappings,
  // but metadata transfer uses send_snapshots=false. Verify the current VM.
  if (currentDeviceSignature(record.plan.disks, record.plan.vifs, { ...record.payload, mode: record.operation.mode }) !== currentDeviceSignature(target.disks, target.vifs)) throw copyError('COPY_MAPPING_UNCONFIRMED', '副本的磁盘或网络映射未通过核对')
  const sourceVdis = new Set(source.disks.map((d) => d.vdiRef))
  if (!cross && target.disks.some((d) => sourceVdis.has(d.vdiRef))) throw copyError('COPY_DISK_IDENTITY_UNCONFIRMED', '副本仍引用源磁盘，无法确认复制完成')
  record = patch(record, { vmRef: ref, vmUuid: target.vm.uuid, cancellable: false })
  // Persist before configuration. A lost acknowledgement must not cause repeated writes after restart.
  const warnings = [...record.operation.warnings]
  if (!record.configurationAttempted) {
    record = { ...record, configurationAttempted: true }; save(record)
    if (cross && target.vm.name_label !== record.payload.newName) {
      try { assertScope(); await targetClient.callWithSession('VM.set_name_label', [ref, record.payload.newName]) }
      catch (error: any) { warnings.push(`副本已创建，名称设置未确认：${error.message}`) }
    }
    if (record.payload.nameDescription !== undefined && target.vm.name_description !== record.payload.nameDescription) {
      try { assertScope(); await targetClient.callWithSession('VM.set_name_description', [ref, record.payload.nameDescription]) }
      catch (error: any) { warnings.push(`副本已创建，描述设置未确认：${error.message}`) }
    }
  } else {
    if (target.vm.name_label !== record.payload.newName) warnings.push('副本已创建，请核对并修改副本名称')
    if (record.payload.nameDescription !== undefined && target.vm.name_description !== record.payload.nameDescription) warnings.push('副本已创建，请核对并修改副本描述')
  }
  return patch(record, { status: 'completed', progress: 100, message: '复制完成，副本及源对象保留关系已确认', warnings: [...new Set(warnings)] })
}
async function cleanupTask(record: SavedCopy, connectionId: string): Promise<void> {
  if (!record.operation.taskRef || record.taskCleaned) return
  try {
    if (connectionManager.getConnectionInfo(connectionId)?.poolUuid !== record.sourcePoolUuid) throw copyError('COPY_SCOPE_CHANGED', '原源池身份已变化')
    await copyClient(connectionId).callWithSession('task.destroy', [record.operation.taskRef])
  } catch (error: any) {
    if (error.code !== 'HANDLE_INVALID') {
      patch(record, { warnings: [...new Set([...record.operation.warnings, '复制结果已确认，服务器任务记录尚未清理'])] })
      return
    }
  }
  save({ ...currentRecord(record.operation.id), taskCleaned: true })
}
async function observe(id: string): Promise<void> {
  if (active.has(id)) return
  active.add(id)
  let record = currentRecord(id)
  try {
    record = bindPool(record, 'source')
    const sourceId = record.operation.sourceConnectionId
    if (terminal(record.operation.status)) { await cleanupTask(record, sourceId); return }
    if (record.operation.vmRef) {
      record = await verifyResult(record, record.operation.vmRef, sourceId)
      await cleanupTask(record, sourceId); return
    }
    if (!record.operation.taskRef) {
      patch(record, { status: 'unknown', cancellable: false, message: '任务身份未确认，请在源、目标池核对；不会重新提交复制' }); return
    }
    const client = copyClient(sourceId)
    const task = await client.callWithSession('task.get_record', [record.operation.taskRef])
    if (connectionManager.getConnectionInfo(sourceId)?.poolUuid !== record.sourcePoolUuid || copyClient(sourceId) !== client) throw copyError('COPY_SCOPE_CHANGED', '连接身份在观察期间发生变化，等待原源池恢复')
    if (task.status === 'success') {
      const ref = resultRef(task.result)
      record = patch(record, { vmRef: ref, cancellable: false })
      record = await verifyResult(record, ref, sourceId)
      await cleanupTask(record, sourceId); return
    }
    if (task.status === 'failure' || task.status === 'cancelled') {
      record = patch(record, { status: task.status === 'failure' ? 'failed' : 'cancelled', cancellable: false,
        message: task.status === 'failure' ? `服务器确认复制失败：${(task.error_info ?? []).join('：')}；请核对是否有残留副本` : '服务器确认任务已取消；请核对目标池是否有残留副本' })
      await cleanupTask(record, sourceId); return
    }
    if (!['pending', 'cancelling'].includes(task.status)) throw new Error('服务器返回未知任务状态')
    patch(record, { status: task.status === 'cancelling' || record.cancelRequested ? 'cancelling' : 'pending',
      progress: Math.max(0, Math.min(99, (Number(task.progress) || 0) * 100)),
      cancellable: !record.cancelRequested && task.allowed_operations?.includes('cancel') === true,
      message: record.cancelRequested || task.status === 'cancelling' ? '已请求取消，等待服务器确认终态' : '服务器正在复制，可关闭窗口继续在后台观察' })
  } catch (error: any) {
    // The task may be complete. Keep its identity and never turn a read failure into a new copy.
    record = currentRecord(id)
    if (terminal(record.operation.status)) return
    patch(record, { status: 'unknown', cancellable: false, message: `复制状态读取失败：${error.message}` })
  } finally { release(id) }
}
async function submit(id: string): Promise<void> {
  active.add(id)
  let record = currentRecord(id)
  let issued = false
  try {
    record = bindPool(bindPool(record, 'source'), 'target')
    const sourceId = record.operation.sourceConnectionId
    const targetId = record.operation.targetConnectionId
    const sourceClient = copyClient(sourceId)
    const targetClient = copyClient(targetId)
    const payload = record.payload
    const assertScope = () => {
      if (connectionManager.getConnectionInfo(sourceId)?.poolUuid !== record.sourcePoolUuid || connectionManager.getConnectionInfo(targetId)?.poolUuid !== record.targetPoolUuid
        || copyClient(sourceId) !== sourceClient || copyClient(targetId) !== targetClient) throw copyError('COPY_SCOPE_CHANGED', '连接身份在提交期间发生变化，请重新读取计划')
    }
    // Repeat fresh preflight immediately before mutation; a saved plan is not authorization.
    const plan = await getVmCopyPlan(sourceId, payload.vmRef, targetId)
    validateCopyPlacement(plan, payload)
    const source = await readCopySource(sourceClient, payload.vmRef, record.operation.mode === 'cross-pool-copy')
    if (source.fingerprint !== record.sourceFingerprint) throw copyError('COPY_SOURCE_CHANGED', '源设备在提交前已变化，请重新读取计划')
    let method: string
    let args: any[]
    assertScope()
    if (record.operation.mode === 'cross-pool-copy') {
      const destination = await targetClient.callWithSession('host.migrate_receive', [payload.targetHostRef, payload.transferNetworkRef, {}])
      const options = { copy: 'true' }
      args = [payload.vmRef, destination, true, payload.storageMap, payload.networkMap, options, {}]
      assertScope()
      await sourceClient.callWithSession('VM.assert_can_migrate', args)
      method = 'Async.VM.migrate_send'
    } else {
      method = record.operation.mode === 'clone' ? 'Async.VM.clone' : 'Async.VM.copy'
      args = record.operation.mode === 'clone' ? [payload.vmRef, payload.newName] : [payload.vmRef, payload.newName, payload.targetSrRef]
    }
    assertScope()
    record = { ...record, issued: true }; save(record)
    issued = true
    const taskRef = await sourceClient.callWithSession(method, args)
    if (!nonNullRef(taskRef)) throw new Error('服务器未返回有效任务身份')
    record = patch(record, { taskRef, status: 'pending', message: '复制任务已提交，等待服务器进度' })
  } catch (error: any) {
    const definitive = !issued || error?.details?.kind === 'xapi'
    patch(currentRecord(id), { status: definitive ? 'failed' : 'unknown', cancellable: false,
      message: definitive ? `复制未能开始：${error.message}` : `提交响应未确认，请核对源、目标池；不会自动重试：${error.message}` })
  } finally { release(id) }
}
export async function startVmCopy(connectionId: string, payload: VmCopyPayload): Promise<VmCopyOperation> {
  const targetId = payload.targetConnectionId ?? connectionId
  const sourceInfo = { ...connectionManager.getConnectionInfo(connectionId) }
  const targetInfo = { ...connectionManager.getConnectionInfo(targetId) }
  if (!sourceInfo?.poolUuid || !targetInfo?.poolUuid) throw copyError('COPY_POOL_IDENTITY_UNCONFIRMED', '无法确认资源池 UUID，请重新连接后复制')
  const plan = await getVmCopyPlan(connectionId, payload.vmRef, targetId)
  validateCopyPlacement(plan, payload)
  const existing = load().find((r) => r.sourcePoolUuid === sourceInfo.poolUuid && r.sourceUuid === plan.sourceUuid && !terminal(r.operation.status))
  if (existing) return structuredClone(existing.operation)
  const source = await readCopySource(copyClient(connectionId), payload.vmRef, payload.mode === 'cross-pool-copy')
  if (connectionManager.getConnectionInfo(connectionId)?.poolUuid !== sourceInfo.poolUuid
    || connectionManager.getConnectionInfo(targetId)?.poolUuid !== targetInfo.poolUuid || source.vm.uuid !== plan.sourceUuid) {
    throw copyError('COPY_SCOPE_CHANGED', '资源池或源对象身份已变化，请重新读取复制计划')
  }
  const operation: VmCopyOperation = { id: randomUUID(), sourceConnectionId: connectionId, targetConnectionId: targetId,
    sourcePoolUuid: sourceInfo.poolUuid, targetPoolUuid: targetInfo.poolUuid,
    sourcePoolName: sourceInfo.poolName || connectionId, targetPoolName: targetInfo.poolName || targetId,
    sourceVmRef: payload.vmRef, name: payload.newName.trim(), isTemplate: plan.isTemplate,
    mode: payload.mode ?? (payload.targetSrRef ? 'copy' : 'clone'), status: 'preparing', progress: 0,
    message: '正在重新预检并提交复制任务', warnings: [], cancellable: false, createdAt: Date.now() }
  // Concurrent starts can finish preflight together; deduplicate again before the synchronous durable write.
  const concurrent = load().find((r) => r.sourcePoolUuid === sourceInfo.poolUuid && r.sourceUuid === plan.sourceUuid && !terminal(r.operation.status))
  if (concurrent) return structuredClone(concurrent.operation)
  save({ operation, payload: { ...payload, newName: operation.name }, sourcePoolUuid: sourceInfo.poolUuid,
    targetPoolUuid: targetInfo.poolUuid, sourceFingerprint: source.fingerprint, sourceUuid: plan.sourceUuid, plan, issued: false })
  active.add(operation.id)
  const timer = setTimeout(() => { void submit(operation.id).catch(() => { /* Durable record remains available for reconciliation. */ }) }, 0)
  timer.unref?.()
  return structuredClone(operation)
}
export async function getCopyOperations(): Promise<VmCopyOperation[]> {
  const pending = load().filter((r) => !terminal(r.operation.status) || r.operation.taskRef && !r.taskCleaned)
  await mapCopyReads(pending, async (r) => { await observe(r.operation.id) })
  return structuredClone(load().map((r) => r.operation).sort((a, b) => b.createdAt - a.createdAt))
}
export async function cancelCopy(id: string): Promise<VmCopyOperation> {
  let record = currentRecord(id)
  if (terminal(record.operation.status) || record.cancelRequested) return structuredClone(record.operation)
  // A progress read may be in flight when the user clicks. Serialize cancellation
  // behind it instead of silently dropping the request or overwriting its result.
  if (active.has(id)) {
    await new Promise<void>((resolve) => idleWaiters.set(id, [...idleWaiters.get(id) ?? [], resolve]))
    return cancelCopy(id)
  }
  active.add(id)
  let reconcile = false
  try {
    record = bindPool(record, 'source')
    const sourceId = record.operation.sourceConnectionId
    if (!record.operation.taskRef) throw copyError('COPY_TASK_UNCONFIRMED', '尚未确认任务身份，无法安全取消；请核对资源池')
    const client = copyClient(sourceId)
    const task = await client.callWithSession('task.get_record', [record.operation.taskRef])
    if (connectionManager.getConnectionInfo(sourceId)?.poolUuid !== record.sourcePoolUuid || copyClient(sourceId) !== client) {
      throw copyError('COPY_SCOPE_CHANGED', '连接身份在取消前发生变化，请重新连接原池后核对任务')
    }
    if (!task.allowed_operations?.includes('cancel') || !['pending', 'cancelling'].includes(task.status)) {
      reconcile = true
    } else {
      record = { ...record, cancelRequested: true, operation: { ...record.operation, status: 'cancelling', cancellable: false, message: '已请求取消，等待服务器确认终态' } }; save(record)
      try { await client.callWithSession('task.cancel', [record.operation.taskRef]) }
      catch (error: any) { patch(record, { message: `取消请求响应读取失败：${error.message}；等待原任务终态` }) }
    }
  } finally { release(id) }
  if (reconcile) await observe(id)
  return structuredClone(currentRecord(id).operation)
}
