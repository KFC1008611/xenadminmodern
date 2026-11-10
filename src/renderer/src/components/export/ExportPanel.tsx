import { TaskRecords } from '../feedback/TaskRecords'
/**
 * Export progress and history inside the shared task center.
 */
import { useEffect, useMemo, useRef } from 'react'
import { Download, Trash2 } from 'lucide-react'
import { useExportPanelStore } from '../../store/exportPanel.store'
import { ExportTaskItem } from './ExportTaskItem'
import { feedback } from '../../store/feedback.store'
import { readOperationResult } from '../../../../shared/read-operation-result'
import { useConnectionManagerStore } from '../../store/connectionManager.store'

export function ExportPanel({ observe = true }: { observe?: boolean } = {}) {
  const {
    tasks,
    clearCompleted,
    updateTask,
  } = useExportPanelStore()

  const connections = useConnectionManagerStore((state) => state.connections)

  // Calculate active and completed task counts
  const activeCount = useMemo(
    () => tasks.filter(
      (t) => !t.recordMissing && (t.cleanupPending || t.status === 'running' || t.status === 'pending' || t.status === 'cancelling' || t.status === 'unknown'),
    ).length,
    [tasks]
  )
  const completedCount = useMemo(
    () => tasks.filter((t) => !t.cleanupPending && (t.recordMissing || t.status === 'completed' || t.status === 'failed' || t.status === 'cancelled')).length,
    [tasks]
  )
  const trackedCount = tasks.filter((task) => !task.recordMissing && (!['completed', 'failed', 'cancelled'].includes(task.status) || task.cleanupPending)).length

  // Use ref to store tasks so polling callback always reads latest value
  // without triggering effect re-runs on every task update
  const tasksRef = useRef(tasks)
  tasksRef.current = tasks

  // Poll for progress updates on active tasks
  useEffect(() => {
    if (!observe) return
    if (trackedCount === 0) return
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const pollProgress = async () => {
      const currentTasks = tasksRef.current
      const activeTasks = currentTasks.filter(
        (t) => !t.recordMissing && (!['completed', 'failed', 'cancelled'].includes(t.status) || t.cleanupPending),
      )

      for (const task of activeTasks) {
        try {
          const progressData = await readOperationResult(async () => {
            const result = await window.xapi.vm.exportProgress(task.exportId)
            return result
          }, { isCurrent: () => !disposed })
          if (disposed) return
          if (!progressData) { useExportPanelStore.getState().markRecordMissing(task.exportId); continue }

          const updates: Partial<ReturnType<typeof useExportPanelStore.getState>['tasks'][0]> = {
            connectionId: progressData.connectionId ?? task.connectionId,
            cleanupPending: progressData.cleanupPending,
            warnings: progressData.warnings,
            status: progressData.cleanupPending && ['completed', 'failed', 'cancelled'].includes(progressData.status) ? 'running' : progressData.status,
            progress: progressData.progress,
            phase: progressData.phase,
            transfer: progressData.transfer,
            validation: progressData.validation,
            bytesTransferred: progressData.bytesTransferred ?? task.bytesTransferred,
            message: progressData.message || task.message,
          }

          if (progressData.bytesTotal !== undefined) {
            updates.bytesTotal = progressData.bytesTotal
          }

          if (progressData.status === 'completed' && !progressData.cleanupPending) {
            updates.status = 'completed'
            updates.bytesTotal = progressData.bytesTotal || task.bytesTotal
            if ((progressData.warnings?.length || progressData.message?.includes('未能清理'))) {
              feedback.error(`"${task.vmName}" 导出完成，但${progressData.warnings?.join('；') || progressData.message.split('；').slice(1).join('；')}`)
            } else {
              feedback.success(`"${task.vmName}" 导出完成`)
            }
          } else if (progressData.status === 'failed' && !progressData.cleanupPending) {
            updates.status = 'failed'
            updates.message = progressData.message || '导出失败'
            const isTimeout = progressData.message?.includes('timed out')
            feedback.error(isTimeout
              ? `"${task.vmName}" 导出超时，请检查网络连接后重试`
              : `"${task.vmName}" 导出失败: ${progressData.message}`)
          } else if (progressData.status === 'cancelled' && !progressData.cleanupPending) {
            updates.status = 'cancelled'
          } else if (progressData.status === 'cancelling') {
            updates.status = 'cancelling'
            updates.message = progressData.message || '正在等待资源池任务确认取消'
          }

          // Set finishedAt when transitioning to terminal state
          if (progressData.status === 'completed' || progressData.status === 'failed' || progressData.status === 'cancelled') {
            updateTask(task.exportId, {
              ...updates,
              finishedAt: task.finishedAt ?? Date.now()
            })
          } else {
            updateTask(task.exportId, updates)
          }
        } catch (e) {
          if (disposed) return
          updateTask(task.exportId, { status: 'unknown', message: `获取导出结果失败：${e instanceof Error ? e.message : String(e)}` })
        }
      }
      if (!disposed && useExportPanelStore.getState().tasks.some((task) => !task.recordMissing && (['pending', 'running', 'cancelling', 'unknown'].includes(task.status) || task.cleanupPending))) {
        timer = setTimeout(pollProgress, useExportPanelStore.getState().tasks.every((t) => t.status === 'unknown' || ['completed', 'failed', 'cancelled'].includes(t.status)) ? 10000 : 1000)
      }
    }

    void pollProgress()
    return () => { disposed = true; if (timer) clearTimeout(timer) }
  }, [trackedCount, updateTask, connections, observe])

  if (!tasks.length) return null
  return <section aria-label="导出任务" className="space-y-2">
    <h3 className="flex items-center gap-2 text-sm font-medium"><Download className="h-4 w-4" />导出任务{activeCount > 0 && ` (${activeCount})`}</h3>
    <TaskRecords records={tasks} finished={(task) => !task.cleanupPending && !task.recordMissing && ['completed', 'failed', 'cancelled'].includes(task.status)}>{(task) => <ExportTaskItem key={task.exportId} task={task} />}</TaskRecords>
    {completedCount > 0 && <button onClick={clearCompleted} title="仅删除本地记录，不删除导出文件" className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted"><Trash2 className="h-3 w-3" />清除可移除记录</button>}
  </section>
}

export default ExportPanel
