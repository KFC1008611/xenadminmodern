import { useState } from 'react'
import type { BatchTaskOptions, BatchTaskTarget } from '../../../../shared/types/xapi'
import { BATCH_EFFECTS, BATCH_LABELS, type SupportedBatchType } from '../../../../shared/batch-policy'
import { useConnectionManagerStore } from '../../store/connectionManager.store'
import { DesktopDialog } from '../layout/DesktopDialog'

export function BatchConfirmationDialog({ type, targets, retry = false, busy, blockedReason, error, onClose, onConfirm }: {
  type: SupportedBatchType; targets: BatchTaskTarget[]; retry?: boolean; busy: boolean; error?: string | null
  blockedReason?: string | null
  onClose: () => void; onConfirm: (options?: BatchTaskOptions) => void
}) {
  const [deleteDisks, setDeleteDisks] = useState(true)
  const connections = useConnectionManagerStore((state) => state.connections)
  const title = '确认' + (retry ? '重试' : '批量') + BATCH_LABELS[type]
  return <DesktopDialog title={title} onClose={onClose} busy={busy}>
    <div className="rounded-xl border border-input bg-card p-6">
      <h2 className="mb-3 text-lg font-semibold text-foreground">{title}</h2>
      <p className="mb-3 text-sm text-secondary-foreground">{targets.length} 台虚拟机。{BATCH_EFFECTS[type]}</p>
      {type === 'delete' && <div className="mb-4 space-y-2 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={deleteDisks} disabled={busy} onChange={(event) => setDeleteDisks(event.target.checked)} />同时删除所属硬盘</label>
        <p className={deleteDisks ? 'text-danger' : 'text-muted-foreground'}>{deleteDisks ? '将永久删除独占且可写的所属硬盘及其数据；共享、只读、快照和归属不明的磁盘保留。' : '所有普通硬盘保留，可在存储中重新挂载。'}</p>
      </div>}
      <ul className="mb-4 max-h-64 overflow-y-auto text-sm text-secondary-foreground">{targets.map((target) => {
        const connection = connections.find((item) => item.id === target.connectionId)
        return <li key={JSON.stringify([target.connectionId, target.vmRef])} className="break-all py-1">{connection?.poolName || connection?.name || target.connectionId} · {target.vmName}</li>
      })}</ul>
      {(blockedReason || error) && <p role="alert" className="mb-4 break-words text-sm text-danger">{blockedReason || error}</p>}
      <div className="flex justify-end gap-3">
        <button disabled={busy} onClick={onClose} className="rounded-lg border border-input px-4 py-2 text-sm text-secondary-foreground disabled:opacity-50">取消</button>
        <button disabled={busy || !!blockedReason} onClick={() => onConfirm(type === 'delete' ? { deleteDisks } : undefined)} className={'rounded-lg px-4 py-2 text-sm disabled:opacity-50 ' + (type === 'delete' ? 'bg-danger-solid text-on-solid' : 'bg-primary text-primary-foreground')}>{busy ? '正在提交…' : '确认'}</button>
      </div>
    </div>
  </DesktopDialog>
}
