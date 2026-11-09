/** Batch commands share the single-VM guards and confirmed mutation results. */
import { connectionManager } from '../xapi/connection-manager'
import { startVm, shutdownVm, rebootVm, suspendVm, resumeVm, pauseVm, unpauseVm, snapshotVm, destroyVm } from '../xapi/services/vm.service'
import type { BatchOperationType, BatchTaskTarget, BatchTaskOptions, VmPowerIntent } from '../../shared/types/xapi'
import { batchOperationBlockReason, batchTargetIdentityReason, canRunBatchVmAction, type SupportedBatchType } from '../../shared/batch-policy'

export interface PreCheckResult { canRun: boolean; reason?: string; currentState?: string }
export interface OperationResult { success: boolean; error?: string; unknown?: boolean; cancelled?: boolean; skipped?: boolean; skipReason?: string }
export interface BatchOperationContext { type: BatchOperationType; target: BatchTaskTarget; options?: BatchTaskOptions; signal?: AbortSignal }

export async function canRunOperation(type: BatchOperationType, connectionId: string, vmRef: string, options?: BatchTaskOptions, intent?: VmPowerIntent): Promise<PreCheckResult> {
  const blocked = batchOperationBlockReason(type, options)
  if (blocked) return { canRun: false, reason: blocked }
  const missing = batchTargetIdentityReason({ connectionId, vmRef, vmName: '', intent })
  if (missing) return { canRun: false, reason: missing }
  const client = connectionManager.getClient(connectionId)
  const info = connectionManager.getConnectionInfo(connectionId)
  if (!client || !info) return { canRun: false, reason: '连接已断开，未提交操作' }
  const identity = JSON.stringify([info.poolUuid, info.epoch])
  let record: any
  try { record = await client.callWithSession('VM.get_record', [vmRef]) }
  catch { return { canRun: false, reason: '无法获取 VM 状态，未提交操作' } }
  const current = connectionManager.getConnectionInfo(connectionId)
  if (record?.uuid !== intent!.vmUuid || intent!.poolUuid !== info.poolUuid || intent!.epoch !== info.epoch
    || connectionManager.getClient(connectionId) !== client || JSON.stringify([current?.poolUuid, current?.epoch]) !== identity) {
    return { canRun: false, reason: '虚拟机或资源池连接已变化，请刷新后重新选择并确认' }
  }
  const currentState = record.power_state
  if (!record.is_a_template && !record.is_a_snapshot && !record.is_control_domain && isIdempotentSkip(type, currentState)) return { canRun: true, currentState }
  return { ...canRunBatchVmAction(record, type as SupportedBatchType), currentState }
}

/** Kept for callers needing an explicit preview, with bounded reads. Execution checks run inside the manager queue. */
export async function precheckBatchOperation(type: BatchOperationType, targets: BatchTaskTarget[], options?: BatchTaskOptions): Promise<Map<string, PreCheckResult>> {
  const results = new Map<string, PreCheckResult>()
  let next = 0
  await Promise.all(Array.from({ length: Math.min(5, targets.length) }, async () => {
    while (next < targets.length) {
      const target = targets[next++]
      const check = await canRunOperation(type, target.connectionId, target.vmRef, options, target.intent)
      results.set(target.connectionId + ':' + target.vmRef, check)
    }
  }))
  return results
}

export async function executeBatchOperation({ type, target, options, signal }: BatchOperationContext): Promise<OperationResult> {
  const cancelled = (): OperationResult => ({ success: false, cancelled: true, error: '已取消，未提交服务器操作' })
  if (signal?.aborted) return cancelled()
  const check = await canRunOperation(type, target.connectionId, target.vmRef, options, target.intent)
  if (signal?.aborted) return cancelled()
  if (!check.canRun) return { success: false, error: check.reason || '预检查失败，未提交操作' }
  if (isIdempotentSkip(type, check.currentState)) return { success: true, skipped: true, skipReason: '虚拟机已处于目标状态，未重复提交' }
  try {
    switch (type) {
      case 'start': await startVm(target.connectionId, target.vmRef, target.intent); break
      case 'stop': await shutdownVm(target.connectionId, target.vmRef, target.intent); break
      case 'reboot': await rebootVm(target.connectionId, target.vmRef, target.intent); break
      case 'suspend': await suspendVm(target.connectionId, target.vmRef, target.intent); break
      case 'resume': await resumeVm(target.connectionId, target.vmRef, target.intent); break
      case 'pause': await pauseVm(target.connectionId, target.vmRef, target.intent); break
      case 'unpause': await unpauseVm(target.connectionId, target.vmRef, target.intent); break
      case 'snapshot': await snapshotVm(target.connectionId, target.vmRef, options?.snapshotName || `${target.vmName}-snapshot-${Date.now()}`, target.intent); break
      case 'delete': {
        const result = await destroyVm(target.connectionId, target.vmRef, { deleteDisks: options?.deleteDisks !== false, intent: target.intent })
        if (result.failedVdiRefs.length) return { success: false, error: `VM 已删除，以下磁盘未完成清理：${result.failedVdiRefs.join('、')}。请到存储中检查；不要重复删除 VM。` }
        break
      }
      default: return { success: false, error: '不支持此批量操作' }
    }
    return { success: true }
  } catch (error: any) {
    return {
      success: false, cancelled: error?.code === 'TASK_CANCELLED',
      error: error?.faultString || error?.message || '操作执行失败',
      unknown: /OUTCOME_UNKNOWN/.test(error?.code ?? '') || (error?.details?.outcome !== 'failed' && !['TASK_FAILED', 'TASK_CANCELLED'].includes(error?.code) && error?.details?.kind !== 'xapi'),
    }
  }
}
function isIdempotentSkip(type: BatchOperationType, state?: string): boolean {
  return ((type === 'start' || type === 'resume') && state === 'Running')
    || (type === 'stop' && state === 'Halted') || (type === 'suspend' && state === 'Suspended')
}
