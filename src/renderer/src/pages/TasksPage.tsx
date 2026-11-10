import { TaskRecords } from '../components/feedback/TaskRecords'
/**
 * TasksPage — live XAPI task monitor with progress bars and cancel controls.
 *
 * UX Architecture Redesign:
 * - Uses SyncManager for periodic data refresh (no independent setInterval)
 * - Uses multiDataStore to show tasks from ALL connections
 * - Cancellation is a request; only server terminal status confirms the result
 */
import { useEffect } from 'react'
import { create } from 'zustand'
import { useTaskHistoryStore } from '../store/taskHistory.store'
import type { ConnectedTaskRecord } from '../../../shared/types/xapi'
import { getConnectionReadIdentity, useMultiDataStore } from '../store/multiData.store'
import { useConnectionManagerStore } from '../store/connectionManager.store'
import { X, ClipboardList } from 'lucide-react'

const STATUS_BADGE: Record<string, string> = {
  pending:    'bg-accent text-accent-foreground border-primary/30',
  success:    'bg-success-soft text-success border-success/30',
  failure:    'bg-danger-soft text-danger border-danger/30',
  cancelling: 'bg-warning-soft text-warning border-warning/30',
  cancelled:  'bg-muted text-muted-foreground border-input',
}

interface Cancellation {
  connectionId: string
  ref: string
  name: string
  pool: string
  identity: string
  recordKey: string
  phase: 'submitting' | 'unknown' | 'terminal'
  message: string
}
const taskKey = (connectionId: string, ref: string) => JSON.stringify([connectionId, ref])

export const serverTaskRecordKey = (task: ConnectedTaskRecord) => `server:${task.uuid || JSON.stringify([task.connectionId, task.ref, task.created])}`
export const useTaskCancellationStore = create<{
  cancellations: Record<string, Cancellation>
  update: (fn: (previous: Record<string, Cancellation>) => Record<string, Cancellation>) => void
}>((set) => ({ cancellations: {}, update: (fn) => set((state) => ({ cancellations: fn(state.cancellations) })) }))

export default function TasksPage({ compact = false, observe = true, embedded = false }: { compact?: boolean; observe?: boolean; embedded?: boolean }) {
  const allTasks = useMultiDataStore((s) => s.tasks)
  const { deletedRecords, deleteRecord } = useTaskHistoryStore()
  const tasks = allTasks.filter((task) => !['success', 'failure', 'cancelled'].includes(task.status) || !deletedRecords.includes(serverTaskRecordKey(task)))
  const domainStates = useMultiDataStore((s) => s.domainStates)
  const refreshTasks = useMultiDataStore((s) => s.refreshTasks)
  const connections = useConnectionManagerStore((s) => s.connections)
  const { cancellations, update: setCancellations } = useTaskCancellationStore()

  useEffect(() => {
    if (observe) void refreshTasks()
  }, [observe, refreshTasks])

  useEffect(() => {
    setCancellations((previous) => {
      let next = previous
      for (const [key, entry] of Object.entries(previous)) {
        if (entry.phase === 'terminal') continue
        let phase: Cancellation['phase'] = entry.phase
        let message = entry.message
        const identity = getConnectionReadIdentity(entry.connectionId)
        const read = domainStates[entry.connectionId]?.tasks
        const task = tasks.find((item) => item.connectionId === entry.connectionId && item.ref === entry.ref)
        if (identity !== entry.identity) {
          phase = 'unknown'
          message = '管理连接已变化，无法获取原任务的取消结果。'
        } else if (!read?.error && task && ['cancelled', 'success', 'failure'].includes(task.status)) {
          phase = 'terminal'
          message = task.status === 'cancelled' ? '任务已取消（服务器已确认）'
            : task.status === 'success' ? '任务已正常完成，取消未阻止任务完成'
              : `任务已失败：${task.error_info?.join('；') || '服务器报告 failure'}`
        }
        if (phase !== entry.phase || message !== entry.message) {
          if (next === previous) next = { ...previous }
          next[key] = { ...entry, phase, message }
        }
      }
      return next
    })
  }, [allTasks, domainStates, connections, setCancellations])

  const handleCancel = async (ref: string, connectionId: string) => {
    const identity = getConnectionReadIdentity(connectionId)
    const key = taskKey(connectionId, ref)
    const task = tasks.find((item) => item.connectionId === connectionId && item.ref === ref)
    if (!identity || !task || task.status !== 'pending' || useTaskCancellationStore.getState().cancellations[key]?.identity === identity) return
    setCancellations((previous) => ({ ...previous, [key]: {
      connectionId, ref, name: task.name_label, pool: task.poolName, identity, recordKey: serverTaskRecordKey(task),
      phase: 'submitting', message: '正在取消，等待服务器结果…',
    } }))
    try {
      const result = await window.xapi.tasks.cancel(connectionId, ref)
      if (getConnectionReadIdentity(connectionId) !== identity) return
      setCancellations((previous) => {
        const entry = previous[key]
        return entry && entry.phase !== 'terminal' && entry.identity === identity
          ? { ...previous, [key]: { ...entry, phase: 'terminal', message: result.message } } : previous
      })
    } catch (error) {
      if (getConnectionReadIdentity(connectionId) !== identity) return
      const message = error instanceof Error ? error.message : String(error)
      setCancellations((previous) => {
        const entry = previous[key]
        return entry && entry.phase !== 'terminal' && entry.identity === identity
          ? { ...previous, [key]: { ...entry, phase: 'unknown', message: `获取取消结果失败：${message}` } } : previous
      })
    }
    if (getConnectionReadIdentity(connectionId) === identity) void refreshTasks()
  }

  if (compact) return <section aria-label="服务器任务" className="space-y-2">
    <h3 className="text-sm font-medium">服务器任务</h3>
    {Object.entries(domainStates).filter(([, state]) => state.tasks?.error).map(([id, state]) => <p role="alert" key={id} className="text-xs text-danger">{connections.find((c) => c.id === id)?.poolName || id}：{state.tasks?.error}</p>)}
    <TaskRecords records={tasks} finished={(task) => ['success', 'failure', 'cancelled'].includes(task.status)}>{(task) => {
      const cancellation = cancellations[taskKey(task.connectionId, task.ref)]
      const running = ['pending', 'cancelling'].includes(task.status)
      const status = { pending: '执行中', cancelling: '正在取消', success: '已完成', failure: '失败', cancelled: '已取消' }[task.status]
      return <div key={taskKey(task.connectionId, task.ref)} className="space-y-2 rounded-lg border border-input bg-muted p-3 text-sm">
        <p className="font-medium">{task.name_label}</p>
        <p className="text-xs text-muted-foreground">{task.poolName} · {status}</p>
        {running && <><progress aria-label={`${task.name_label}进度`} className="h-1.5 w-full accent-primary" value={Math.max(0, Math.min(1, task.progress || 0))} max={1} /><p className="text-xs tabular-nums">{Math.round(Math.max(0, Math.min(1, task.progress || 0)) * 100)}%</p></>}
        {task.status === 'failure' && <p className="text-xs text-danger">{task.error_info?.join('；') || '服务器未提供错误详情'}</p>}
        {cancellation && <p role="status" className="text-xs text-warning">{cancellation.message}</p>}
        {task.status === 'pending' && <button disabled={!getConnectionReadIdentity(task.connectionId) || cancellation?.identity === getConnectionReadIdentity(task.connectionId)} onClick={() => { void handleCancel(task.ref, task.connectionId) }} className="text-xs text-danger disabled:opacity-50">取消任务</button>}
        {!running && <button onClick={() => deleteRecord(serverTaskRecordKey(task))} title="仅删除本地记录，不删除服务器 Task" className="text-xs text-muted-foreground">删除记录</button>}
      </div>
    }}</TaskRecords>
    {!tasks.length && <p className="text-xs text-muted-foreground">暂无服务器任务</p>}
  </section>

  return (
    <div className="space-y-4">
      {!embedded && <div>
        <h1 className="text-xl font-semibold text-foreground">任务</h1>
        <p className="text-muted-foreground text-sm mt-0.5">{tasks.length} 个任务</p>
      </div>}

      {Object.entries(cancellations).filter(([, entry]) => !deletedRecords.includes(entry.recordKey)).map(([key, entry]) => (
        <div key={key} role="status" className="flex flex-wrap items-center gap-2 rounded-lg border border-input bg-card px-4 py-3 text-sm text-secondary-foreground">
          <span>{entry.pool} · {entry.name}：{entry.message}</span>
        </div>
      ))}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="overflow-x-auto">
        <table className="min-w-[720px] w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left px-4 py-3 text-muted-foreground font-medium">任务</th>
              <th className="text-left px-4 py-3 text-muted-foreground font-medium">资源池</th>
              <th className="text-left px-4 py-3 text-muted-foreground font-medium">状态</th>
              <th className="text-left px-4 py-3 text-muted-foreground font-medium">进度</th>
              <th className="text-right px-4 py-3 text-muted-foreground font-medium">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {tasks.map((task) => (
              <tr key={`${task.connectionId}-${task.ref}`} className="hover:bg-muted">
                <td className="max-w-sm px-4 py-3">
                  <div className="break-words text-foreground">{task.name_label}</div>
                  {task.status === 'failure' && <p className="mt-1 break-words text-xs text-danger">失败原因：{task.error_info?.join('；') || '服务器未提供错误详情'}</p>}
                </td>
                <td className="px-4 py-3 text-muted-foreground text-xs">
                  {task.poolName}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border ${
                      STATUS_BADGE[task.status] ?? STATUS_BADGE.cancelled
                    }`}
                  >
                    {task.status}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="w-24 bg-muted rounded-full h-1.5">
                      <div
                        className="bg-primary h-1.5 rounded-full"
                        style={{ width: `${(task.progress || 0) * 100}%` }}
                      />
                    </div>
                    <span className="text-xs text-subtle">
                      {Math.round((task.progress || 0) * 100)}%
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3 text-right">
                  {['success', 'failure', 'cancelled'].includes(task.status) && <button title="仅删除本地记录，不删除服务器 Task" onClick={() => deleteRecord(serverTaskRecordKey(task))} className="px-2 py-1 text-xs text-muted-foreground hover:bg-muted">删除记录</button>}
                  {task.status === 'pending' && (
                    <button
                      onClick={() => handleCancel(task.ref, task.connectionId)}
                      disabled={!getConnectionReadIdentity(task.connectionId) || cancellations[taskKey(task.connectionId, task.ref)]?.identity === getConnectionReadIdentity(task.connectionId)}
                      className="p-1.5 text-danger hover:bg-danger-soft rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      title="取消任务"
                      aria-label={`Cancel ${task.name_label}`}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        {tasks.length === 0 && (
          <div className="text-center py-12">
            <ClipboardList className="w-10 h-10 text-subtle mx-auto mb-3" />
            <p className="text-muted-foreground font-medium">没有进行中的任务</p>
          </div>
        )}
      </div>
    </div>
  )
}
