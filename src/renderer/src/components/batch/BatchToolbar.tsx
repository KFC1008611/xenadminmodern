import { useEffect, useState } from 'react'
import { batchSelectionChangeReason, useBatchStore } from '../../store/batch.store'
import { useConnectionManagerStore } from '../../store/connectionManager.store'
import { useMultiDataStore } from '../../store/multiData.store'
import { BATCH_LABELS, BATCH_OPERATION_TYPES, canRunBatchVmAction, batchResourceKey, batchTargetIdentityReason, batchTargetKey, type SupportedBatchType } from '../../../../shared/batch-policy'
import type { BatchTaskTarget } from '../../../../shared/types/xapi'
import { BatchConfirmationDialog } from './BatchConfirmationDialog'

export function BatchToolbar({ visibleVms }: { visibleVms?: Array<{ connectionId: string; ref: string }> } = {}) {
  const { selectedVms, selectionNotice, reconcileSelection, activeTasks, isSubmitting, submitTask, clearSelection, toggleVmSelection, error } = useBatchStore()
  const connections = useConnectionManagerStore((state) => state.connections)
  const vms = useMultiDataStore((state) => state.vms)
  const domainStates = useMultiDataStore((state) => state.domainStates)
  const [confirmation, setConfirmation] = useState<{ type: SupportedBatchType; targets: BatchTaskTarget[] } | null>(null)
  useEffect(() => { reconcileSelection() }, [connections, vms, domainStates, selectedVms, isSubmitting, reconcileSelection])
  if (!selectedVms.length && !confirmation && !selectionNotice) return null
  const currentVms = new Map(vms.map((vm) => [JSON.stringify([vm.connectionId, vm.ref]), vm]))
  const operationReason = (type: SupportedBatchType, targets: BatchTaskTarget[]) => targets.map((target) => {
    const vm = currentVms.get(batchTargetKey(target))
    const reason = domainStates[target.connectionId]?.vms?.error ? 'VM 列表读取失败，请刷新后再操作'
      : !vm ? '尚未读取到当前 VM，请刷新后再操作' : canRunBatchVmAction(vm, type).reason
    return reason ? `${target.vmName}：${reason}` : null
  }).find(Boolean)
  const confirmationChanged = confirmation?.targets.map((target) => {
    const vm = currentVms.get(batchTargetKey(target)) ?? null
    return batchSelectionChangeReason(target, vm) || (vm && vm.name_label !== target.vmName ? '虚拟机名称已变化，请取消后重新确认' : null)
  }).find(Boolean) || (confirmation && operationReason(confirmation.type, confirmation.targets))
  const visibleKeys = visibleVms ? new Set(visibleVms.map((vm) => JSON.stringify([vm.connectionId, vm.ref]))) : null
  const hidden = visibleKeys ? selectedVms.filter((vm) => !visibleKeys.has(batchTargetKey(vm))).length : 0
  const pools = [...new Set(selectedVms.map((vm) => vm.connectionId))]
  const label = (id: string) => { const connection = connections.find((item) => item.id === id); return connection?.poolName || connection?.name || id }
  const selectedKeys = new Set(selectedVms.map(batchResourceKey))
  const overlap = activeTasks.some((task) => task.targets.some((target) => selectedKeys.has(batchResourceKey(target))))
  const blocked = isSubmitting ? '批量任务正在提交，请等待受理结果' : overlap ? '所选虚拟机已有批量任务尚未结束'
    : selectedVms.map(batchTargetIdentityReason).find(Boolean)
  return <>
    {selectionNotice && <p role="alert" className="break-words text-sm text-warning">{selectionNotice}</p>}
    {!!selectedVms.length && <div className="space-y-3 rounded-lg border border-input bg-card p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <details className="min-w-0 flex-1">
          <summary className="cursor-pointer text-sm text-foreground">查看已选虚拟机：{selectedVms.length} 台，{pools.length} 个资源池{hidden > 0 && <span className="ml-2 text-warning">其中 {hidden} 台不在当前列表</span>}</summary>
          <div className="mt-3 max-h-48 space-y-2 overflow-y-auto text-sm">{pools.map((id) => <section key={id}>
            <h3 className="font-medium text-muted-foreground">{label(id)}</h3>
            {selectedVms.filter((vm) => vm.connectionId === id).map((vm) => <div key={batchTargetKey(vm)} className="flex items-center justify-between gap-3 py-1 text-foreground">
              <span className="min-w-0 break-all">{vm.vmName}{visibleKeys && !visibleKeys.has(batchTargetKey(vm)) && <span className="ml-2 text-xs text-warning">当前不可见</span>}</span>
              <button disabled={isSubmitting} onClick={() => toggleVmSelection(vm)} aria-label={'移除已选 ' + vm.vmName} className="shrink-0 rounded px-2 py-1 text-muted-foreground hover:bg-muted disabled:opacity-50">移除</button>
            </div>)}
          </section>)}</div>
        </details>
        <button disabled={isSubmitting} onClick={clearSelection} className="rounded px-2 py-1 text-sm text-muted-foreground hover:bg-muted disabled:opacity-50">清除选择</button>
      </div>
      <div className="flex flex-wrap items-center gap-2">{BATCH_OPERATION_TYPES.map((type) => {
        const reason = blocked || operationReason(type, selectedVms)
        return <button key={type} disabled={!!reason} title={reason || undefined}
        onClick={() => setConfirmation({ type, targets: structuredClone(selectedVms) })}
        className={'rounded-lg border border-input px-3 py-2 text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 ' + (type === 'delete' ? 'text-danger' : 'text-secondary-foreground')}>{BATCH_LABELS[type]}</button>
      })}</div>
    </div>}
    {confirmation && <BatchConfirmationDialog type={confirmation.type} targets={confirmation.targets} busy={isSubmitting} blockedReason={confirmationChanged} error={error}
      onClose={() => setConfirmation(null)} onConfirm={(options) => {
        if (confirmationChanged || operationReason(confirmation.type, confirmation.targets) || confirmation.targets.some((target) => batchSelectionChangeReason(target))) return
        void submitTask(confirmation.type, confirmation.targets, options).then(() => setConfirmation(null)).catch(() => {})
      }} />}
  </>
}
