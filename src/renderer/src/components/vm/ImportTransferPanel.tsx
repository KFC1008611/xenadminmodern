import { TaskRecords } from '../feedback/TaskRecords'
import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Upload } from 'lucide-react'
import { useImportWizardStore } from '../../store/importWizard.store'
import { useConnectionManagerStore } from '../../store/connectionManager.store'
import { useMultiDataStore } from '../../store/multiData.store'
import { feedback } from '../../store/feedback.store'
import { ImportOperationProgress } from './ImportOperationProgress'

const terminal = (status: string) => ['completed', 'failed', 'cancelled'].includes(status)

/** Keeps accepted imports observable across dialogs, routes and new drafts. */
export function ImportTransferPanel({ observe = true }: { observe?: boolean } = {}) {
  const store = useImportWizardStore()
  const pendingCancels = store.pendingCancels
  const cancel = async (connectionId: string, operationId: string) => {
    try { await store.cancel(connectionId, operationId) }
    catch (error: any) { feedback.error(error.message) }
  }
  const connections = useConnectionManagerStore((s) => s.connections)
  const history = useRef(store.history)
  history.current = store.history
  const navigate = useNavigate()
  const active = store.history.filter((item) => !item.recordMissing && !terminal(item.operation.status)).length
  useEffect(() => {
    if (!observe) return
    if (!active) return
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      const state = useImportWizardStore.getState()
      for (const item of history.current) {
        if (item.recordMissing || terminal(item.operation.status) || state.dialogOpen && state.operationId === item.operation.operationId) continue
        try {
          const operation = await window.xapi.vm.importProgress(item.operation.operationId)
          if (disposed) return
          if (!operation) { state.markRecordMissing(item.operation.operationId); continue }
          state.applyOperation(operation)
          if (operation.status === 'completed') {
            feedback.success(`${item.name} 导入完成`)
            void useMultiDataStore.getState().refreshVms({ afterMutation: true, connectionId: operation.connectionId ?? item.connectionId }).catch(() => feedback.warning('导入已完成，资源列表刷新失败，请手动刷新'))
          } else if (operation.status === 'failed') feedback.error(`${item.name}：${operation.message}`)
        } catch (error: any) {
          if (!disposed) state.applyOperation({ ...item.operation, status: 'unknown', message: `获取导入结果失败：${error.message}`, lastUpdatedAt: Date.now() })
        }
      }
      if (!disposed) timer = setTimeout(poll, history.current.every((item) => terminal(item.operation.status) || item.operation.status === 'unknown') ? 10000 : 1000)
    }
    void poll()
    return () => { disposed = true; if (timer) clearTimeout(timer) }
  }, [active, connections, store.dialogOpen, observe])

  if (!store.history.length) return null
  return <section aria-label="导入任务" className="space-y-2">
    <h3 className="flex items-center gap-2 text-sm font-medium"><Upload className="h-4 w-4" />导入任务{active > 0 && ` (${active})`}</h3>
    <div className="space-y-2">
      <TaskRecords records={store.history} finished={(item) => !item.recordMissing && terminal(item.operation.status)}>{({ operation, connectionId, poolUuid, filePath, name, isTemplate, recordMissing }) => <div key={operation.operationId} className="space-y-2 rounded-lg bg-muted p-3 text-sm">
        <p className="break-words font-medium">{isTemplate ? '模板' : '虚拟机'} · {name}</p>
        <p className="text-xs text-subtle break-all">{connections.find((c) => c.id === connectionId)?.poolName || connectionId}{filePath && ` · ${filePath}`}</p>
        {recordMissing ? <p role="status" className="text-xs text-warning">{operation.message}</p> : <ImportOperationProgress {...operation} />}
        {operation.warnings?.map((warning) => <p className="text-xs text-warning" key={warning}>{warning}</p>)}
        <div className="flex flex-wrap gap-3 text-xs">
          {operation.vmRef && <button disabled={!poolUuid || !connections.some((c) => c.id === connectionId && c.state === 'connected' && c.poolUuid === poolUuid)} title="在原资源池中查看" className="text-accent-foreground underline disabled:text-subtle" onClick={() => navigate(`/pool/${encodeURIComponent(connectionId)}/vms/${encodeURIComponent(operation.vmRef!)}`)}>查看已导入对象</button>}
          {!recordMissing && !terminal(operation.status) && operation.status !== 'configuring' && operation.status !== 'cancelling' && !(operation.status === 'unknown' && operation.vmRef) && <button disabled={pendingCancels.includes(operation.operationId)} className="text-danger disabled:opacity-50" onClick={() => { void cancel(connectionId, operation.operationId) }}>{pendingCancels.includes(operation.operationId) ? '正在请求取消…' : '取消导入'}</button>}
          {!recordMissing && !terminal(operation.status) && (operation.status === 'configuring' || operation.status === 'unknown' && operation.vmRef) && <span className="text-muted-foreground">正在核对已导入对象，不能中断</span>}
          {(terminal(operation.status) || recordMissing) && <button className="text-muted-foreground" title="仅移除本地记录，不取消资源池任务" onClick={() => store.removeRecord(operation.operationId)}>移除记录</button>}
        </div>
      </div>}</TaskRecords>
    </div>
  </section>
}
