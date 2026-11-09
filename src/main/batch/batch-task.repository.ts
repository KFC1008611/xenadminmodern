/** Durable admission and item journal; progress is derived, never a second disk write. */
import { randomUUID } from 'crypto'
import { createLogger } from '../logger'
import { readJsonStore, writeJsonStore } from '../persistence/json-store'
import { appendBatchJournal, clearBatchJournal, readBatchJournal } from './batch-task.journal'
import { batchGetStatusContract } from '../../shared/ipc-contracts/infrastructure'
import { isBatchRunning } from '../../shared/batch-policy'
import type { BatchItemStatus, BatchOperationType, BatchTask, BatchTaskItem, BatchTaskOptions, BatchTaskStatus, BatchTaskTarget, BatchTaskWithItems } from '../../shared/types/xapi'
export type { BatchItemStatus, BatchOperationType, BatchTask, BatchTaskItem, BatchTaskOptions, BatchTaskStatus, BatchTaskTarget, BatchTaskWithItems } from '../../shared/types/xapi'

const log = createLogger('BatchTaskRepository')
const tasks = new Map<string, BatchTask>()
const taskItems = new Map<string, BatchTaskItem[]>()
const itemLocations = new Map<string, { taskId: string; index: number }>()
let initialized = false
let sequence = 0
let journalEntries = 0

type Change =
  | { kind: 'create'; task: BatchTaskWithItems }
  | { kind: 'task'; taskId: string; status: BatchTaskStatus; startedAt?: number; completedAt?: number }
  | { kind: 'items'; taskId: string; items: BatchTaskItem[]; retryRequestId?: string }
  | { kind: 'remove'; ids: string[] }
type Entry = Change & { sequence: number }
type Snapshot = { sequence: number; records: BatchTaskWithItems[] }

const clone = <T>(value: T): T => structuredClone(value)
export interface BatchMemoryDatabase { readonly kind: 'json' }
const database: BatchMemoryDatabase = { kind: 'json' }
export function getBatchTaskDatabase(): BatchMemoryDatabase { initBatchTaskDatabase(); return database }

function records(): BatchTaskWithItems[] {
  return [...tasks.values()].map((task) => ({ ...task, items: taskItems.get(task.id) ?? [] }))
}
function restore(saved: BatchTaskWithItems[]): void {
  tasks.clear(); taskItems.clear(); itemLocations.clear()
  for (const { items, ...task } of clone(saved)) {
    tasks.set(task.id, { ...task, progress: calculateBatchProgress(items) })
    taskItems.set(task.id, items)
    items.forEach((item, index) => itemLocations.set(item.id, { taskId: task.id, index }))
  }
}
function validate(saved: BatchTaskWithItems[]): void {
  const taskIds = new Set<string>(), itemIds = new Set<string>(), requestIds = new Set<string>()
  for (const raw of saved) {
    const task = batchGetStatusContract.resultSchema.parse(raw)
    const targets = new Set(task.targets.map((target) => JSON.stringify([target.connectionId, target.vmRef])))
    const targetIntents = new Map(task.targets.map((target) => [JSON.stringify([target.connectionId, target.vmRef]), target.intent]))
    if (taskIds.has(task.id) || targets.size !== task.targets.length || task.items.length !== task.targets.length) throw new Error('批量任务历史的目标或任务身份不一致，原文件已保留')
    taskIds.add(task.id)
    for (const id of [task.requestId, ...(task.retryRequestIds ?? [])].filter((id): id is string => !!id)) {
      if (requestIds.has(id)) throw new Error('批量任务请求身份不一致，原文件已保留')
      requestIds.add(id)
    }
    const seen = new Set<string>()
    for (const item of task.items) {
      const key = JSON.stringify([item.connectionId, item.vmRef])
      if (item.taskId !== task.id || itemIds.has(item.id) || seen.has(key) || !targets.has(key)) throw new Error('批量任务历史的项目与目标不一致，原文件已保留')
      const intent = targetIntents.get(key)
      if (item.intent?.vmUuid !== intent?.vmUuid || item.intent?.poolUuid !== intent?.poolUuid || item.intent?.epoch !== intent?.epoch) throw new Error('批量任务历史的确认身份不一致，原文件已保留')
      itemIds.add(item.id); seen.add(key)
    }
  }
}

export function initBatchTaskDatabase(): void {
  if (initialized) return
  try {
    const saved = readJsonStore<BatchTaskWithItems[] | Snapshot>('batch-tasks', [])
    const checkpoint = Array.isArray(saved) ? { sequence: 0, records: saved } : saved
    if (!checkpoint || !Number.isSafeInteger(checkpoint.sequence) || checkpoint.sequence < 0 || !Array.isArray(checkpoint.records)) throw new Error('批量任务历史格式无效，原文件已保留')
    validate(checkpoint.records)
    restore(checkpoint.records)
    sequence = checkpoint.sequence
    for (const raw of readBatchJournal()) {
      const entry = raw as Entry
      if (!entry || !Number.isSafeInteger(entry.sequence) || entry.sequence < 1) throw new Error('批量任务日志格式无效，原文件已保留')
      if (entry.sequence <= checkpoint.sequence) continue
      if (entry.sequence !== sequence + 1) throw new Error('批量任务日志顺序不一致，原文件已保留')
      apply(entry)
      sequence = entry.sequence
    }
    validate(records())
    const recovered = records().map(({ items, ...task }): BatchTaskWithItems => {
      const interrupted = isBatchRunning(task.status) || items.some((item) => ['running', 'pending'].includes(item.status))
      const restored = items.map((item) => ['running', 'pending'].includes(item.status) ? {
        ...item, status: item.status === 'running' ? 'unknown' as const : 'cancelled' as const,
        error: item.status === 'running' ? '应用退出时未读取到服务器执行结果；请查看虚拟机状态和服务器任务记录，勿重复提交' : '应用退出前尚未开始，未重新提交', completedAt: Date.now(),
      } : item)
      const status = restored.some((item) => item.status === 'unknown') ? 'unknown'
        : task.status === 'cancel-requested' || task.status === 'cancelled' || restored.some((item) => item.status === 'cancelled') ? 'cancelled' : 'completed'
      return { ...task, status, items: restored, progress: calculateBatchProgress(restored), ...(interrupted ? { completedAt: Date.now() } : {}) }
    })
    writeJsonStore('batch-tasks', { sequence, records: recovered } satisfies Snapshot, { flush: true })
    clearBatchJournal()
    restore(recovered)
    initialized = true
    journalEntries = 0
  } catch (error) { closeBatchTaskDatabase(); throw error }
}

export function closeBatchTaskDatabase(): void {
  tasks.clear(); taskItems.clear(); itemLocations.clear()
  initialized = false; sequence = 0; journalEntries = 0
}

function apply(change: Change): void {
  if (change.kind === 'create') {
    const { items, ...task } = change.task
    if (tasks.has(task.id)) throw new Error('重复的批量任务日志')
    tasks.set(task.id, task); taskItems.set(task.id, items)
    items.forEach((item, index) => itemLocations.set(item.id, { taskId: task.id, index }))
  } else if (change.kind === 'remove') {
    for (const id of change.ids) {
      for (const item of taskItems.get(id) ?? []) itemLocations.delete(item.id)
      tasks.delete(id); taskItems.delete(id)
    }
  } else {
    const task = tasks.get(change.taskId)
    if (!task) throw new Error('批量任务日志的任务不存在')
    if (change.kind === 'task') {
      task.status = change.status
      if (change.status === 'running') delete task.completedAt
      if (change.startedAt !== undefined) task.startedAt = change.startedAt
      if (change.completedAt !== undefined) task.completedAt = change.completedAt
    } else if (change.kind === 'items') {
      const items = taskItems.get(change.taskId)!
      for (const item of change.items) {
        const location = itemLocations.get(item.id)
        if (!location || location.taskId !== change.taskId) throw new Error('批量任务日志的项目不存在')
        const before = items[location.index]
        for (const [status, delta] of [[before.status, -1], [item.status, 1]] as const) {
          if (status !== 'pending' && status !== 'running') task.progress.completed += delta
          if (status === 'failed') task.progress.failed += delta
          if (status === 'unknown') task.progress.unknown = (task.progress.unknown ?? 0) + delta
          if (status === 'cancelled') task.progress.cancelled = (task.progress.cancelled ?? 0) + delta
        }
        items[location.index] = item
      }
      if (change.retryRequestId) {
        task.retryRequestIds = [...(task.retryRequestIds ?? []), change.retryRequestId]
        task.status = 'pending'; delete task.completedAt
      }
    } else throw new Error('未知的批量任务日志类型')
  }
}

function commit(change: Change): void {
  appendBatchJournal({ ...change, sequence: sequence + 1 })
  apply(change)
  sequence++; journalEntries++
}

export function calculateBatchProgress(items: BatchTaskItem[], currentItem?: string): BatchTask['progress'] {
  return {
    total: items.length, completed: items.filter((item) => !['pending', 'running'].includes(item.status)).length,
    failed: items.filter((item) => item.status === 'failed').length, unknown: items.filter((item) => item.status === 'unknown').length,
    cancelled: items.filter((item) => item.status === 'cancelled').length, ...(currentItem ? { currentItem } : {}),
  }
}

export function createBatchTask(type: BatchOperationType, targets: BatchTaskTarget[], options?: BatchTaskOptions, requestId?: string): BatchTask {
  initBatchTaskDatabase()
  const id = randomUUID()
  const task: BatchTask = { id, type, targets: clone(targets), ...(options ? { options: clone(options) } : {}), ...(requestId ? { requestId } : {}), status: 'pending', progress: { total: targets.length, completed: 0, failed: 0, unknown: 0, cancelled: 0 }, createdAt: Date.now() }
  const items: BatchTaskItem[] = targets.map((target) => ({ ...clone(target), id: randomUUID(), taskId: id, status: 'pending', retryCount: 0 }))
  commit({ kind: 'create', task: { ...task, items } })
  return clone(task)
}
export function getBatchTaskById(id: string): BatchTaskWithItems | null {
  const task = tasks.get(id)
  return task ? clone({ ...task, items: taskItems.get(id) ?? [] }) : null
}
export function getAllBatchTasks(): BatchTask[] { return [...tasks.values()].sort((a, b) => b.createdAt - a.createdAt).map(clone) }
export function getBatchTasksByStatus(status: BatchTaskStatus): BatchTask[] { return getAllBatchTasks().filter((task) => task.status === status) }
export function getBatchTaskItems(id: string): BatchTaskItem[] { return clone(taskItems.get(id) ?? []) }
export function getBatchTaskItemsByStatus(id: string, status: BatchItemStatus): BatchTaskItem[] { return getBatchTaskItems(id).filter((item) => item.status === status) }
export function getFailedTaskItems(id: string): BatchTaskItem[] { return getBatchTaskItemsByStatus(id, 'failed') }
export function getBatchProgress(id: string, currentItem?: string) {
  const task = tasks.get(id)
  return task ? { status: task.status, progress: { ...task.progress, ...(currentItem ? { currentItem } : {}) } } : null
}
export function updateBatchTaskStatus(taskId: string, status: BatchTaskStatus, updates?: Partial<Pick<BatchTask, 'startedAt' | 'completedAt' | 'progress'>>): void {
  const task = tasks.get(taskId)
  if (!task) return
  commit({ kind: 'task', taskId, status: task.status === 'cancel-requested' && status === 'running' ? 'cancel-requested' : status,
    ...(updates?.startedAt === undefined ? {} : { startedAt: updates.startedAt }), ...(updates?.completedAt === undefined ? {} : { completedAt: updates.completedAt }) })
}
export function updateBatchTaskItemStatus(itemId: string, status: BatchItemStatus, updates?: Partial<Pick<BatchTaskItem, 'error' | 'startedAt' | 'completedAt' | 'retryCount'>>): void {
  const location = itemLocations.get(itemId)
  if (!location) return
  const item = taskItems.get(location.taskId)![location.index]
  commit({ kind: 'items', taskId: location.taskId, items: [{ ...item, ...updates, status }] })
}
export function cancelPendingBatchItems(taskId: string, error: string): void {
  const items = (taskItems.get(taskId) ?? []).filter((item) => item.status === 'pending').map((item) => ({ ...item, status: 'cancelled' as const, error, completedAt: Date.now() }))
  if (items.length) commit({ kind: 'items', taskId, items })
}
export function resetBatchItemsForRetry(taskId: string, items: BatchTaskItem[], retryRequestId?: string): void {
  commit({ kind: 'items', taskId, items: items.map((item) => ({ ...item, status: 'pending', error: undefined, startedAt: undefined, completedAt: undefined, retryCount: item.retryCount + 1 })), ...(retryRequestId ? { retryRequestId } : {}) })
}
export function resetTaskItemForRetry(itemId: string): void {
  const location = itemLocations.get(itemId)
  if (!location) return
  const item = taskItems.get(location.taskId)![location.index]
  if (item.status === 'failed') resetBatchItemsForRetry(location.taskId, [item])
}
export function deleteBatchTask(id: string): void { commit({ kind: 'remove', ids: [id] }) }
export function cleanupCompletedTasks(keepCount = 50): void {
  const clean = [...tasks.values()].filter((task) => ['completed', 'cancelled'].includes(task.status) && !task.progress.failed)
    .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))
  const ids = clean.slice(Math.max(keepCount, 0)).map((task) => task.id)
  if (ids.length) commit({ kind: 'remove', ids })
  if ((ids.length || journalEntries >= 1024) && ![...tasks.values()].some((task) => isBatchRunning(task.status))) {
    try {
      writeJsonStore('batch-tasks', { sequence, records: records() } satisfies Snapshot, { flush: true })
      clearBatchJournal(); journalEntries = 0
    } catch (error) { log.warn('任务日志检查点未保存，已保留增量日志', error) }
  }
}
