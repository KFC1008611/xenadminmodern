import { TaskRecords } from '../feedback/TaskRecords'
import { useEffect } from 'react'
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react'
import { useBatchStore } from '../../store/batch.store'
import { BATCH_LABELS, isBatchRunning } from '../../../../shared/batch-policy'
import { useTaskHistoryStore } from '../../store/taskHistory.store'
import type { BatchOperationTask } from '../../types/batch'

export const BATCH_TYPE_LABEL: Record<string, string> = { ...BATCH_LABELS, migrate: '迁移（历史）' }
export const batchTaskLabel = (task: Pick<BatchOperationTask, 'type' | 'options'>) => task.type === 'stop' && task.options?.force ? '强制关闭（历史）' : BATCH_TYPE_LABEL[task.type]
export const BATCH_STATUS_LABEL: Record<string, string> = { pending: '排队中', running: '执行中', 'cancel-requested': '正在取消', completed: '已结束', cancelled: '已取消', unknown: '读取结果失败', failed: '失败', skipped: '状态已满足' }

export function BatchProgressDialog() {
  const { activeTask, activeTasks, taskHistory, cancelTask, refreshTasks, error, pendingTaskIds } = useBatchStore()
  const { deletedRecords, deleteRecord } = useTaskHistoryStore()
  const observing = activeTasks.length > 0 || !!activeTask && isBatchRunning(activeTask.status)
  useEffect(() => { void refreshTasks() }, [refreshTasks])
  useEffect(() => {
    if (!observing) return
    const timer = setInterval(() => { void refreshTasks() }, 2000)
    return () => clearInterval(timer)
  }, [observing, refreshTasks])
  const tasks = [...(activeTask ? [activeTask] : []), ...activeTasks, ...taskHistory]
    .filter((task, index, all) => all.findIndex((other) => other.id === task.id) === index)
    .filter((task) => isBatchRunning(task.status) || !deletedRecords.includes(`batch:${task.id}`))
  if (!tasks.length && !error) return null
  return <section aria-label="批量任务进度" className="space-y-2">
    <h3 className="text-sm font-medium">批量任务</h3>
    {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    <TaskRecords records={tasks} finished={(task) => !isBatchRunning(task.status) && task.status !== 'unknown'}>{(activeTask) => {
      const running = isBatchRunning(activeTask.status)
      const { progress } = activeTask
      const unknown = progress.unknown ?? 0
      const cancelled = progress.cancelled ?? 0
      const success = progress.completed - progress.failed - unknown - cancelled
      const hasErrors = unknown > 0 || progress.failed > 0
      return <div key={activeTask.id} className="space-y-2 rounded-lg border border-input bg-muted p-3 text-sm">
        <p className="font-medium">批量{batchTaskLabel(activeTask)} · {activeTask.targets[0]?.vmName}{activeTask.targets.length > 1 && ` 等 ${activeTask.targets.length} 台`}</p>
        <div role="status" className="flex items-center gap-2 text-secondary-foreground">{running ? <Loader2 className="animate-spin text-accent-foreground" size={16} /> : hasErrors ? <AlertCircle className="text-warning" size={16} /> : <CheckCircle2 size={16} />}<span>{BATCH_STATUS_LABEL[activeTask.status]}</span><span className="ml-auto">{progress.completed}/{progress.total} 已处理</span></div>
        <progress aria-label="批量任务已处理数量" max={progress.total || 1} value={progress.completed} className="h-2 w-full accent-primary" />
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs"><span className="text-success">成功 {success}</span><span className="text-danger">失败 {progress.failed}</span><span className="text-warning">读取失败 {unknown}</span><span className="text-muted-foreground">未执行 {cancelled}</span></div>
        {activeTask.status === 'cancel-requested' && <p className="text-warning">已停止提交后续操作，正在等待已开始的操作返回。取消不会撤销服务器已经执行的操作。</p>}
        {unknown > 0 && <p className="text-warning">服务器执行结果读取失败。请恢复连接后查看虚拟机状态和服务器任务记录；不要重复提交同一操作。</p>}
        {activeTask.results.length > 0 && <ul className="max-h-36 space-y-2 overflow-y-auto">{activeTask.results.filter((result) => !['pending', 'running'].includes(result.status || '')).map((result) => <li key={`${result.connectionId}:${result.vmRef}`} className="text-secondary-foreground"><span>{result.vmName} · {result.status === 'skipped' ? '状态已满足' : result.success ? '成功' : BATCH_STATUS_LABEL[result.status || 'failed']}</span>{result.error && <p className="break-words text-xs text-muted-foreground">{result.error}</p>}</li>)}</ul>}
        <a href="#/batch-tasks" className="block text-accent-foreground underline">查看全部批量任务{activeTasks.length > 1 ? `（${activeTasks.length} 个进行中）` : ''}</a>
        {!running && <button disabled={pendingTaskIds.includes(activeTask.id)} onClick={() => deleteRecord(`batch:${activeTask.id}`)} title="仅删除本地历史记录，不撤销服务器操作" className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-secondary disabled:opacity-50">删除记录</button>}
        {running && activeTask.status !== 'cancel-requested' && <button disabled={pendingTaskIds.includes(activeTask.id)} onClick={() => { void cancelTask(activeTask.id).catch(() => {}) }} className="flex items-center gap-2 rounded-lg px-3 py-2 text-warning hover:bg-secondary disabled:opacity-50"><AlertCircle size={16} />停止后续操作</button>}
      </div>
    }}</TaskRecords>
  </section>
}
