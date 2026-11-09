import { useRef, useState } from 'react'
/**
 * ExportTaskItem — Individual export task row in the export panel
 * Shows VM name, progress bar, bytes transferred, status, and action buttons
 */
import { Loader2, CheckCircle, XCircle, X, Square, AlertTriangle } from 'lucide-react'
import type { ExportTask } from '../../store/exportPanel.store'
import { useExportPanelStore } from '../../store/exportPanel.store'
import { formatBytes } from '../../lib/utils'
import { TransferProgress } from '../transfer/TransferProgress'
import { isTransferTerminal } from '../../lib/transferTracking'

interface ExportTaskItemProps {
  task: ExportTask
}

function formatElapsed(startedAt: number, finishedAt?: number): string {
  const end = finishedAt || Date.now()
  const elapsedMs = end - startedAt
  const seconds = Math.floor(elapsedMs / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`
  }
  return `${seconds}s`
}

export function ExportTaskItem({ task }: ExportTaskItemProps) {
  const [cancelError, setCancelError] = useState('')
  const cancelling = useRef(false)
  const { updateTask, removeTask } = useExportPanelStore()

  const handleCancel = async () => {
    if (cancelling.current) return
    cancelling.current = true
    setCancelError('')
    updateTask(task.exportId, { status: 'cancelling', message: '正在等待资源池任务确认取消' })
    try {
      await window.xapi.vm.cancelExport(task.connectionId, task.exportId)
    } catch (e: any) {
      const latest = useExportPanelStore.getState().tasks.find((item) => item.exportId === task.exportId)
      if (latest && !latest.recordMissing && !isTransferTerminal(latest.status)) setCancelError(e?.message || '取消请求失败，系统继续核对原任务')
    } finally { cancelling.current = false }
  }

  const handleRemove = () => {
    removeTask(task.exportId)
  }

  const isActive = task.status === 'running'
    || task.status === 'pending'
    || task.status === 'cancelling'
  const canCancel = !task.recordMissing && (task.status === 'running' || task.status === 'pending' || task.status === 'unknown')
  const isCompleted = task.status === 'completed'
  const isFailed = task.status === 'failed'
  const isCancelled = task.status === 'cancelled'
  const validating = task.phase === 'validating'
  const metrics = validating && task.validation
    ? { bytesTransferred: task.validation.bytesChecked, bytesTotal: task.validation.bytesTotal, elapsedMs: task.validation.elapsedMs }
    : task.phase === 'transferring' && task.status !== 'cancelling' ? task.transfer : undefined

  return (
    <div className="flex flex-col gap-2 p-3 bg-muted border border-input rounded-lg">
      {/* Header: VM name and status */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          {isActive && <Loader2 className="w-4 h-4 text-info animate-spin flex-shrink-0" />}
          {isCompleted && <CheckCircle className="w-4 h-4 text-success flex-shrink-0" />}
          {isFailed && <XCircle className="w-4 h-4 text-danger flex-shrink-0" />}
          {isCancelled && <Square className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
          {task.status === 'unknown' && <AlertTriangle className="w-4 h-4 text-warning flex-shrink-0" />}
          <span className="text-sm text-foreground truncate font-medium">{task.vmName}</span>
        </div>
        <div className="flex items-center gap-1">
          {canCancel && (
            <button
              onClick={handleCancel}
              className="p-1 text-muted-foreground hover:text-danger hover:bg-danger-soft rounded transition-colors"
              title="取消导出"
            >
              <X className="w-4 h-4" />
            </button>
          )}
          {!task.cleanupPending && (!isActive && task.status !== 'unknown' || task.recordMissing) && (
            <button
              onClick={handleRemove}
              className="p-1 text-subtle hover:text-secondary-foreground hover:bg-secondary rounded transition-colors"
              title="移除"
              aria-label="移除本地导出记录"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Progress bar */}
      {isActive && (
        <TransferProgress label={validating ? 'XVA 导出校验进度' : 'XVA 下载进度'}
          message={task.status === 'cancelling' ? task.message || '正在等待资源池任务确认取消' : task.phase ? task.message : '传输中'}
          progress={metrics ? task.progress : -1} metrics={task.status === 'cancelling' ? undefined : metrics} bytesLabel={validating ? '已检查' : '已接收'} />
      )}

      {cancelError && <p role="alert" className="text-xs text-danger break-words">{cancelError}</p>}
      {task.warnings?.map((warning) => <p key={warning} className="text-xs text-warning break-words">{warning}</p>)}
      {task.recordMissing && task.status !== 'unknown' && <p className="text-xs text-warning">{task.message}</p>}
      {isCompleted && <p className="text-xs text-muted-foreground break-all" title={task.filePath}>{task.filePath}</p>}
      {/* Info row */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="min-w-0 break-words text-muted-foreground">
          {isActive && !metrics && `已用 ${formatElapsed(task.startedAt)}`}
          {isCompleted && (
            <span className="text-success">
              完成 · {formatBytes(task.bytesTransferred)} · {formatElapsed(task.startedAt, task.finishedAt)}
            </span>
          )}
          {isFailed && <span className="text-danger">{task.message || '导出失败'}</span>}
          {isCancelled && <span className="text-muted-foreground">已取消</span>}
          {task.status === 'unknown' && <span className="text-warning">无法获取导出结果 · {task.message}</span>}
        </span>
      </div>
      {(isCompleted && task.message.includes('清理')) && (
        <p className={`text-xs break-words ${isCompleted ? 'text-warning' : 'text-muted-foreground'}`}>{task.message}</p>
      )}
    </div>
  )
}
