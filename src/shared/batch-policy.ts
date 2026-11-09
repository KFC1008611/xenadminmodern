import type { BatchOperationType, BatchTaskOptions, BatchTaskTarget } from './types/xapi'
import { canRunVmAction, type VmAction, type VmActionRecord } from './vm-actions'

export const BATCH_OPERATION_TYPES = ['start', 'stop', 'reboot', 'suspend', 'resume', 'pause', 'unpause', 'snapshot', 'delete'] as const
export type SupportedBatchType = typeof BATCH_OPERATION_TYPES[number]
export const BATCH_LABELS: Record<SupportedBatchType, string> = {
  start: '启动', stop: '正常关闭', reboot: '正常重启', suspend: '挂起', resume: '从挂起恢复',
  pause: '暂停', unpause: '继续运行', snapshot: '创建快照', delete: '删除',
}
export const BATCH_EFFECTS: Record<SupportedBatchType, string> = {
  start: '将启动虚拟机并分配运行资源。',
  stop: '将请求客户机正常关闭，服务会中断；不会自动强制断电。',
  reboot: '将请求客户机正常重启，服务会暂时中断；不会自动强制重启。',
  suspend: '将保存内存到存储并停止运行，服务会中断；存储空间不足时会失败。',
  resume: '将从挂起状态恢复运行并重新分配内存。',
  pause: '将暂停虚拟 CPU，服务会中断；内存等资源仍被占用。',
  unpause: '将继续运行已暂停的虚拟机。',
  snapshot: '将创建磁盘快照并占用存储空间，不保存运行内存，也不保证应用数据一致性。',
  delete: '仅删除已停止的虚拟机，VM 配置删除后不可恢复。快照和光驱介质保留。',
}

export function batchOperationBlockReason(type: BatchOperationType, options?: BatchTaskOptions): string | null {
  if (type === 'stop' && options?.force) return '强制关闭请逐台核对后操作，批量任务不支持强制断电。'
  if (!(BATCH_OPERATION_TYPES as readonly string[]).includes(type)) return '此操作请在单台虚拟机中处理，不支持批量提交或重试。'
  if (options?.targetHostRef || (options?.snapshotName !== undefined && type !== 'snapshot')
    || (options?.deleteDisks !== undefined && type !== 'delete')) return '批量操作选项与操作类型不匹配。'
  return null
}

export function batchRetryBlockReason(type: BatchOperationType, options?: BatchTaskOptions): string | null {
  return batchOperationBlockReason(type, options) || (type === 'delete' ? '删除任务不能直接重试，请重新读取虚拟机与存储清单后选择目标。' : null)
}

export function canRunBatchVmAction(vm: VmActionRecord, type: SupportedBatchType) {
  const actions: Record<SupportedBatchType, VmAction> = {
    start: 'start', stop: 'shutdown', reboot: 'reboot', suspend: 'suspend', resume: 'resume',
    pause: 'pause', unpause: 'unpause', snapshot: 'snapshot', delete: 'delete',
  }
  return canRunVmAction(vm, actions[type])
}

export const isBatchRunning = (status: string) => ['pending', 'running', 'cancel-requested'].includes(status)
export const batchTargetKey = (target: BatchTaskTarget) => JSON.stringify([target.connectionId, target.vmRef])
export const batchResourceKey = (target: BatchTaskTarget) => target.intent?.poolUuid && target.intent.vmUuid
  ? JSON.stringify([target.intent.poolUuid, target.intent.vmUuid]) : batchTargetKey(target)

export function batchTargetIdentityReason(target: BatchTaskTarget): string | null {
  const intent = target.intent
  return intent?.vmUuid && intent.poolUuid && Number.isFinite(intent.epoch)
    ? null : '尚未取得虚拟机和资源池的完整身份，请刷新后重新选择。'
}
