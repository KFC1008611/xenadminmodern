import { Fragment, useEffect, useRef, useState } from 'react'
import { useTaskHistoryStore } from '../store/taskHistory.store'
import { useBatchStore } from '../store/batch.store'
import { BATCH_STATUS_LABEL, batchTaskLabel } from '../components/batch/BatchProgressDialog'
import { BatchConfirmationDialog } from '../components/batch/BatchConfirmationDialog'
import { batchRetryBlockReason, batchTargetIdentityReason, isBatchRunning, type SupportedBatchType } from '../../../shared/batch-policy'
import type { BatchOperationTask } from '../types/batch'
import type { BatchRetryConfirmation } from '../../../shared/types/xapi'

export default function BatchHistoryPage() {
  const { activeTasks, taskHistory, refreshTasks, retryTask, cancelTask, loadTaskDetails, pendingTaskIds, error } = useBatchStore()
  const { deletedRecords, deleteRecord } = useTaskHistoryStore()
  const [expanded, setExpanded] = useState<string | null>(null)
  const [readingRetry, setReadingRetry] = useState<string | null>(null)
  const reading = useRef(false)
  const [review, setReview] = useState<{ task: BatchOperationTask; confirmation: BatchRetryConfirmation } | null>(null)
  useEffect(() => { void refreshTasks() }, [refreshTasks])
  useEffect(() => {
    if (!activeTasks.length) return
    const timer = setInterval(() => { void refreshTasks() }, 2000)
    return () => clearInterval(timer)
  }, [activeTasks.length, refreshTasks])
  const history = taskHistory.filter((task) => !deletedRecords.includes(`batch:${task.id}`))
  const tasks = [...activeTasks, ...history]
  const prepareRetry = async (taskId: string) => {
    if (reading.current) return
    reading.current = true; setReadingRetry(taskId)
    try {
      const task = await loadTaskDetails(taskId)
      if (!task || useTaskHistoryStore.getState().deletedRecords.includes(`batch:${taskId}`)
        || isBatchRunning(task.status) || batchRetryBlockReason(task.type, task.options)) return
      const failed = task.items?.filter((item) => item.status === 'failed') ?? []
      if (!failed.length || failed.some((item) => batchTargetIdentityReason(item))) return
      setReview({ task: { ...task, targets: failed }, confirmation: { requestId: crypto.randomUUID(), items: failed.map(({ id, retryCount }) => ({ id, retryCount })) } })
    } finally { reading.current = false; setReadingRetry(null) }
  }
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div><h1 className="text-xl font-semibold text-foreground">批量任务</h1><p className="mt-1 text-sm text-muted-foreground">{activeTasks.length} 个进行中 · {history.length} 条历史记录</p></div>
      <button onClick={() => { void refreshTasks() }} className="rounded-lg border border-input px-3 py-2 text-sm text-secondary-foreground">刷新</button>
    </div>
    {error && <p role="alert" className="rounded-lg border border-danger/30 bg-danger-soft p-3 text-sm text-danger">{error}</p>}
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-sm">
        <thead className="bg-muted"><tr className="border-b border-border text-left text-muted-foreground">{['类型', '状态', '结果', '创建时间', '操作'].map((label) => <th key={label} className={'px-4 py-3 font-medium ' + (label === '操作' ? 'sticky right-0 bg-muted' : '')}>{label}</th>)}</tr></thead>
        <tbody className="divide-y divide-border">{tasks.map((task) => {
          const running = isBatchRunning(task.status), unknown = task.progress.unknown ?? 0, cancelled = task.progress.cancelled ?? 0
          const blocked = batchRetryBlockReason(task.type, task.options) || task.targets.map(batchTargetIdentityReason).find(Boolean)
          const busy = pendingTaskIds.includes(task.id)
          return <Fragment key={task.id}>
            <tr className="text-secondary-foreground hover:bg-muted">
              <td className="min-w-36 px-4 py-3 text-foreground"><div className="whitespace-nowrap">{batchTaskLabel(task)}</div><p className="mt-1 max-w-48 break-words text-xs text-muted-foreground">{task.targets[0]?.vmName}{task.targets.length > 1 ? ` 等 ${task.targets.length} 台` : ''}</p></td>
              <td className={'whitespace-nowrap px-4 py-3 ' + (task.status === 'unknown' ? 'text-warning' : '')}>{BATCH_STATUS_LABEL[task.status]}</td>
              <td className="px-4 py-3"><div className="whitespace-nowrap">{task.progress.completed}/{task.progress.total} 已处理</div><div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xs text-muted-foreground"><span className="whitespace-nowrap">成功 {task.progress.completed - task.progress.failed - unknown - cancelled}</span><span className="whitespace-nowrap">失败 {task.progress.failed}</span><span className="whitespace-nowrap">读取失败 {unknown}</span><span className="whitespace-nowrap">未执行 {cancelled}</span></div></td>
              <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{new Date(task.createdAt).toLocaleString()}</td>
              <td className="sticky right-0 bg-card px-4 py-3"><div className="flex flex-wrap gap-2">
                <button aria-expanded={expanded === task.id} onClick={() => { setExpanded(expanded === task.id ? null : task.id); if (expanded !== task.id) void loadTaskDetails(task.id) }} className="rounded border border-input px-2 py-1 text-xs">{expanded === task.id ? '收起详情' : '查看详情'}</button>
                {running && task.status !== 'cancel-requested' && <button disabled={busy} onClick={() => { void cancelTask(task.id).catch(() => {}) }} className="rounded border border-input px-2 py-1 text-xs text-warning disabled:opacity-50">停止后续操作</button>}
                {!running && <button disabled={busy || readingRetry === task.id} title="仅删除本地历史记录，不撤销服务器操作" onClick={() => deleteRecord(`batch:${task.id}`)} className="rounded border border-input px-2 py-1 text-xs text-muted-foreground disabled:opacity-50">删除记录</button>}
                {!running && task.progress.failed > 0 && !blocked && <button disabled={busy || readingRetry === task.id} onClick={() => { void prepareRetry(task.id) }} className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground disabled:opacity-50">{readingRetry === task.id ? '读取失败项…' : '重试明确失败项'}</button>}
              </div></td>
            </tr>
            {expanded === task.id && <tr><td colSpan={5} className="bg-background p-4">
              {blocked && <p className="mb-3 text-sm text-warning">{blocked}</p>}
              {task.status === 'cancel-requested' && <p className="mb-3 text-sm text-warning">已停止后续派发，正在等待已开始的操作返回；不会撤销服务器已执行的操作。</p>}
              {unknown > 0 && <p className="mb-3 text-sm text-warning">服务器执行结果读取失败。请恢复连接后查看虚拟机状态和服务器任务记录；不要重复提交同一操作。</p>}
              <ul className="max-h-80 space-y-2 overflow-y-auto text-sm">{task.results.map((item) => <li key={JSON.stringify([item.connectionId, item.vmRef])} className="text-secondary-foreground">
                <span>{item.vmName} · {item.status === 'skipped' ? '状态已满足' : item.success ? '成功' : BATCH_STATUS_LABEL[item.status || 'failed']}</span>
                <span className="ml-2 text-xs text-muted-foreground">{item.connectionId}</span>
                {item.error && <p className="mt-1 break-words text-xs text-muted-foreground">{item.error}</p>}
              </li>)}{!task.results.length && <li className="text-muted-foreground">正在读取项目详情。</li>}</ul>
            </td></tr>}
          </Fragment>
        })}</tbody>
      </table></div>
      {!tasks.length && <p className="py-12 text-center text-muted-foreground">没有批量任务历史</p>}
    </div>
    {review && <BatchConfirmationDialog retry type={review.task.type as SupportedBatchType} targets={review.task.targets} busy={pendingTaskIds.includes(review.task.id)} error={error}
      onClose={() => setReview(null)} onConfirm={() => { void retryTask(review.task.id, review.confirmation).then(() => setReview(null)).catch(() => {}) }} />}
  </div>
}
