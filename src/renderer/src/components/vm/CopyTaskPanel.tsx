import { TaskRecords } from '../feedback/TaskRecords'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Copy } from 'lucide-react'
import { useCopyStore } from '../../store/copy.store'
import { useConnectionManagerStore } from '../../store/connectionManager.store'
import { useMultiDataStore } from '../../store/multiData.store'
import { feedback } from '../../store/feedback.store'
import { useTaskHistoryStore } from '../../store/taskHistory.store'
import type { VmCopyOperation } from '../../../../shared/types/xapi'

export const copyTerminal = (status: string) => ['completed', 'failed', 'cancelled'].includes(status)
function targetConnection(op: VmCopyOperation) {
  const matches = useConnectionManagerStore.getState().connections.filter((c) => c.state === 'connected' && c.poolUuid === op.targetPoolUuid)
  return (matches.find((c) => c.id === op.targetConnectionId) ?? matches[0])?.id
}
export function CopyTaskPanel() {
  const { operations } = useCopyStore()
  const { deletedRecords, deleteRecord } = useTaskHistoryStore()
  const cancelling = useRef(new Set<string>())
  const [pendingCancels, setPendingCancels] = useState<string[]>([])
  const cancel = async (id: string) => {
    if (cancelling.current.has(id)) return
    cancelling.current.add(id); setPendingCancels([...cancelling.current])
    try { useCopyStore.getState().accept(await window.xapi.vm.cancelCopy(id)) }
    catch (error: any) { feedback.error(error.message) }
    finally { cancelling.current.delete(id); setPendingCancels([...cancelling.current]) }
  }
  const connections = useConnectionManagerStore((s) => s.connections)
  const [readError, setReadError] = useState('')
  const navigate = useNavigate()
  const active = operations.filter((o) => !copyTerminal(o.status)).length
  useEffect(() => {
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      try {
        const next = await window.xapi.vm.copyOperations()
        if (disposed) return
        for (const op of next) {
          const old = useCopyStore.getState().operations.find((o) => o.id === op.id)
          if (!old || old.status === op.status) continue
          if (op.status === 'completed') {
            feedback.success(`${op.name} 复制完成`)
            const connectionId = targetConnection(op)
            if (connectionId) {
              if (!op.isTemplate) void useMultiDataStore.getState().refreshVms({ connectionId, afterMutation: true }).catch(() => feedback.warning('副本已创建，列表刷新失败，请手动刷新'))
              window.dispatchEvent(new CustomEvent('vm-copy-completed', { detail: { ...op, targetConnectionId: connectionId } }))
            }
          } else if (op.status === 'failed' || op.status === 'cancelled') feedback.warning(`${op.name}：${op.message}`)
        }
        useCopyStore.setState((state) => ({ operations: next.map((op) => {
          const old = state.operations.find((record) => record.id === op.id)
          return old && copyTerminal(old.status) && old.status !== op.status ? old : op
        }) }))
        setReadError('')
      } catch (error: any) { if (!disposed) setReadError(`复制任务读取失败：${error.message}`) }
      if (!disposed) timer = setTimeout(poll, useCopyStore.getState().operations.some((o) => ['pending', 'preparing', 'cancelling'].includes(o.status)) ? 1500 : 10000)
    }
    void poll()
    return () => { disposed = true; if (timer) clearTimeout(timer) }
  }, [active, connections])
  const records = operations.filter((op) => !copyTerminal(op.status) || !deletedRecords.includes(`copy:${op.id}`))
  if (!records.length && !readError) return null
  return <section aria-label="复制任务" className="space-y-2">
    <h3 className="flex items-center gap-2 text-sm font-medium"><Copy className="h-4 w-4" />复制任务{active > 0 && ` (${active})`}</h3>
    <div className="space-y-2">
      {readError && <p role="alert" className="text-xs text-warning">{readError}。原任务不会重新提交。</p>}
      <TaskRecords records={records} finished={(op) => copyTerminal(op.status)}>{(op) => <div key={op.id} className="space-y-2 rounded-lg bg-muted p-3 text-sm">
        <p className="break-words font-medium">{op.isTemplate ? '模板' : 'VM'} · {op.name}</p>
        <p className="break-words text-xs text-muted-foreground">{op.sourcePoolName} → {op.targetPoolName}</p>
        <p role="status" className={`break-words text-xs ${op.status === 'unknown' || op.status === 'failed' ? 'text-warning' : 'text-secondary-foreground'}`}>{op.message}</p>
        <progress className="h-1.5 w-full accent-primary" aria-label={`${op.name} 复制进度`} value={op.progress} max={100} />
        <p className="text-xs text-subtle">{Math.round(op.progress)}%{op.taskRef && ` · ${op.taskRef}`}</p>
        {op.warnings.map((warning) => <p key={warning} className="break-words text-xs text-warning">{warning}</p>)}
        <div className="flex flex-wrap gap-3 text-xs">
          {op.vmRef && <button disabled={!targetConnection(op)} title={!targetConnection(op) ? '请重新连接原目标资源池' : undefined} className="text-accent-foreground underline disabled:cursor-not-allowed disabled:text-subtle" onClick={() => {
            const connectionId = targetConnection(op)
            if (connectionId) navigate(op.isTemplate ? `/pool/${encodeURIComponent(connectionId)}/vms?search=${encodeURIComponent(op.name)}` : `/pool/${encodeURIComponent(connectionId)}/vms/${encodeURIComponent(op.vmRef!)}`)
          }}>查看副本</button>}
          {op.cancellable && !copyTerminal(op.status) && <button disabled={pendingCancels.includes(op.id) || op.status === 'cancelling'} className="text-danger disabled:opacity-50" onClick={() => { void cancel(op.id) }}>{pendingCancels.includes(op.id) || op.status === 'cancelling' ? '正在请求取消…' : '请求取消'}</button>}
          {!op.cancellable && !copyTerminal(op.status) && <span className="text-muted-foreground">{op.status === 'cancelling' ? '正在等待服务器确认取消' : '当前阶段不支持取消'}</span>}
          {copyTerminal(op.status) && <button title="仅删除本地记录，不删除副本" className="text-muted-foreground" onClick={() => deleteRecord(`copy:${op.id}`)}>删除记录</button>}
        </div>
      </div>}</TaskRecords>
    </div>
  </section>
}
