/** Bounded batch queue. Cancellation stops dispatch; in-flight requests retain their actual outcome. */
import { BrowserWindow } from 'electron'
import { EventEmitter } from 'events'
import { randomUUID } from 'crypto'
import { batchProgressContract } from '../../shared/ipc-contracts/infrastructure'
import type { BatchOperationType, BatchProgressEvent, BatchTask, BatchTaskTarget, BatchTaskOptions, BatchOperationResult, BatchRetryConfirmation } from '../../shared/types/xapi'
import { batchOperationBlockReason, batchRetryBlockReason, batchResourceKey, batchTargetIdentityReason, isBatchRunning } from '../../shared/batch-policy'
import {
  initBatchTaskDatabase, createBatchTask, getBatchTaskById, getAllBatchTasks,
  updateBatchTaskStatus, updateBatchTaskItemStatus, getFailedTaskItems,
  resetBatchItemsForRetry, cancelPendingBatchItems, cleanupCompletedTasks, calculateBatchProgress, getBatchProgress,
} from './batch-task.repository'
import { executeBatchOperation } from './batch-command.service'
import { createLogger } from '../logger'
import { sendIpcContractPush } from '../ipc/ipc-contract-sender'

const log = createLogger('BatchTaskManager')
export type { BatchProgressEvent } from '../../shared/types/xapi'
export interface BatchTaskManagerOptions { concurrency?: number; mainWindow?: BrowserWindow }

class AsyncTaskQueue {
  private pendingTasks: Array<() => Promise<void>> = []
  private activeCount = 0
  constructor(private readonly concurrency: number) {}
  get size(): number { return this.pendingTasks.length }
  get pending(): number { return this.activeCount }
  add(task: () => Promise<void>): Promise<void> {
    return new Promise((resolve, reject) => {
      this.pendingTasks.push(async () => {
        try { await task(); resolve() } catch (error) { reject(error) }
      })
      this.drain()
    })
  }
  private drain(): void {
    while (this.activeCount < this.concurrency && this.pendingTasks.length) {
      const task = this.pendingTasks.shift()!
      this.activeCount++
      void task().finally(() => { this.activeCount--; this.drain() })
    }
  }
}

export class BatchTaskManager extends EventEmitter {
  private queue: AsyncTaskQueue
  private runningTasks = new Map<string, AbortController>()
  private executions = new Map<string, Promise<void>>()
  private mainWindow?: BrowserWindow
  private isInitialized = false
  private shuttingDown = false

  constructor(options: BatchTaskManagerOptions = {}) {
    super()
    this.queue = new AsyncTaskQueue(Number.isFinite(options.concurrency) ? Math.min(5, Math.max(1, Math.floor(options.concurrency!))) : 5)
    this.mainWindow = options.mainWindow
  }
  initialize(): void {
    if (!this.isInitialized) { initBatchTaskDatabase(); this.isInitialized = true }
  }
  setMainWindow(window: BrowserWindow): void { this.mainWindow = window }

  async submitTask(type: BatchOperationType, targets: BatchTaskTarget[], options?: BatchTaskOptions, requestId: string = randomUUID()): Promise<string> {
    this.initialize()
    if (this.shuttingDown) throw new Error('BATCH_MANAGER_STOPPED')
    if (!targets.length) throw new Error('EMPTY_TARGETS')
    if (!requestId.trim()) throw new Error('缺少批量提交请求身份')
    const blocked = batchOperationBlockReason(type, options)
    if (blocked) throw new Error(blocked)
    for (const target of targets) {
      const reason = batchTargetIdentityReason(target)
      if (reason) throw new Error(reason)
    }
    if (new Set(targets.map((target) => `${target.connectionId}\0${target.vmRef}`)).size !== targets.length) throw new Error('DUPLICATE_TARGETS')
    if (new Set(targets.map(batchResourceKey)).size !== targets.length) throw new Error('DUPLICATE_TARGETS')
    const existing = getAllBatchTasks().find((task) => task.requestId === requestId || task.retryRequestIds?.includes(requestId))
    if (existing) {
      const same = existing.requestId === requestId && existing.type === type
        && JSON.stringify(existing.targets) === JSON.stringify(targets) && JSON.stringify(existing.options ?? {}) === JSON.stringify(options ?? {})
      if (!same) throw new Error('批量提交请求身份已用于其他操作，请重新确认')
      return existing.id
    }
    this.assertTargetsAvailable(targets)
    const task = createBatchTask(type, targets, options, requestId)
    this.startTaskExecution(task.id)
    return task.id
  }

  async cancelTask(taskId: string): Promise<void> {
    this.initialize()
    const task = getBatchTaskById(taskId)
    const controller = this.runningTasks.get(taskId)
    if (!task) throw new Error('TASK_NOT_FOUND')
    if (task.status === 'cancel-requested') return
    if (!controller || !['pending', 'running'].includes(task.status)) throw new Error('TASK_ALREADY_COMPLETED')
    controller.abort()
    updateBatchTaskStatus(taskId, 'cancel-requested')
    cancelPendingBatchItems(taskId, '已取消，未开始执行')
    this.publish(taskId)
  }

  getTaskStatus(taskId: string) { this.initialize(); return getBatchTaskById(taskId) }
  getAllTasks(): BatchTask[] { this.initialize(); return getAllBatchTasks() }

  async retryFailedItems(taskId: string, confirmation: BatchRetryConfirmation): Promise<void> {
    this.initialize()
    if (this.shuttingDown) throw new Error('BATCH_MANAGER_STOPPED')
    const task = getBatchTaskById(taskId)
    if (!task) throw new Error('TASK_NOT_FOUND')
    const blocked = batchRetryBlockReason(task.type, task.options)
    if (blocked) throw new Error(blocked)
    if (!confirmation?.requestId || !confirmation.items?.length) throw new Error('请先核对失败项目后再重试')
    if (task.retryRequestIds?.includes(confirmation.requestId)) return
    if (getAllBatchTasks().some((entry) => entry.requestId === confirmation.requestId || entry.retryRequestIds?.includes(confirmation.requestId))) throw new Error('批量重试请求身份已被使用')
    if (this.runningTasks.has(taskId)) throw new Error('TASK_STILL_RUNNING')
    // Unknown and cancelled items are deliberately excluded from retries.
    const failed = getFailedTaskItems(taskId)
    if (!failed.length) return
    const signature = (items: Array<{ id: string; retryCount: number }>) => JSON.stringify(items.map(({ id, retryCount }) => [id, retryCount]).sort())
    if (signature(failed) !== signature(confirmation.items)) throw new Error('失败项目已变化，请重新读取并确认')
    for (const item of failed) {
      const reason = batchTargetIdentityReason(item)
      if (reason) throw new Error(reason)
    }
    this.assertTargetsAvailable(failed, taskId)
    resetBatchItemsForRetry(taskId, failed, confirmation.requestId)
    this.startTaskExecution(taskId)
  }

  private assertTargetsAvailable(targets: BatchTaskTarget[], exceptTaskId?: string): void {
    const keys = new Set(targets.map(batchResourceKey))
    const busy = getAllBatchTasks().some((task) => task.id !== exceptTaskId && isBatchRunning(task.status)
      && task.targets.some((target) => keys.has(batchResourceKey(target))))
    if (busy) throw new Error('所选虚拟机已有批量任务尚未结束，请先核对原任务')
  }

  cleanupTasks(keepCount = 50): void { this.initialize(); cleanupCompletedTasks(keepCount) }

  private startTaskExecution(taskId: string): void {
    if (this.runningTasks.has(taskId)) return
    const controller = new AbortController()
    this.runningTasks.set(taskId, controller)
    const execution = this.executeTask(taskId, controller).catch((error) => {
      log.error(`Task execution stopped: ${taskId}`, error)
      // Persistence failures must not cause silent replay. Leave the persisted state for recovery.
    }).finally(() => { this.runningTasks.delete(taskId); this.executions.delete(taskId) })
    this.executions.set(taskId, execution)
  }

  private async executeTask(taskId: string, controller: AbortController): Promise<void> {
    const task = getBatchTaskById(taskId)
    if (!task) return
    updateBatchTaskStatus(taskId, 'running', { startedAt: Date.now() })
    this.publish(taskId)
    const pending = task.items.filter((item) => item.status === 'pending')
    try {
      // Reads and writes share the same bounded queue; a slow pool creates no global precheck barrier.
      const settled = await Promise.allSettled(pending.map((item) => this.queue.add(async () => {
        if (controller.signal.aborted || this.shuttingDown) return
        updateBatchTaskItemStatus(item.id, 'running', { startedAt: Date.now() })
        this.publish(taskId, undefined, item.vmName)
        let result
        try {
          result = await executeBatchOperation({ type: task.type, target: item, options: task.options, signal: controller.signal })
        } catch (error) {
          result = { success: false, unknown: true, error: error instanceof Error ? error.message : String(error) }
        }
        if (this.shuttingDown) return
        const status = result.cancelled ? 'cancelled' : result.skipped ? 'skipped' : result.success ? 'completed' : result.unknown ? 'unknown' : 'failed'
        updateBatchTaskItemStatus(item.id, status, { error: result.error || result.skipReason, completedAt: Date.now() })
        this.publish(taskId, { connectionId: item.connectionId, vmRef: item.vmRef, vmName: item.vmName, status, success: result.success, error: result.error || result.skipReason })
      })))
      const rejected = settled.find((result) => result.status === 'rejected')
      if (rejected?.status === 'rejected') throw rejected.reason
    } catch (error) {
      if (this.shuttingDown) return
      // An unexpected scheduler error does not prove that dispatched work failed.
      for (const item of getBatchTaskById(taskId)?.items ?? []) {
        if (item.status === 'running' || item.status === 'pending') {
          updateBatchTaskItemStatus(item.id, item.status === 'running' ? 'unknown' : 'cancelled', {
            error: error instanceof Error ? error.message : String(error), completedAt: Date.now(),
          })
        }
      }
    }
    if (this.shuttingDown) return
    const final = getBatchTaskById(taskId)
    if (!final) return
    const status = final.items.some((item) => item.status === 'unknown') ? 'unknown' : controller.signal.aborted || final.items.some((item) => item.status === 'cancelled') ? 'cancelled' : 'completed'
    updateBatchTaskStatus(taskId, status, { completedAt: Date.now() })
    this.publish(taskId)
    cleanupCompletedTasks()
  }

  private publish(taskId: string, currentResult?: BatchOperationResult, currentItem?: string): void {
    const task = getBatchProgress(taskId, currentItem)
    if (!task || task.status === 'pending') return
    const progress = task.progress
    const event: BatchProgressEvent = { taskId, status: task.status, progress, ...(currentResult ? { currentResult } : {}) }
    // Renderer delivery is observational; a closed window must not alter remote execution.
    try { this.emit('progress', event) } catch (error) { log.warn('Batch progress listener failed', error) }
    try {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) sendIpcContractPush(this.mainWindow.webContents, batchProgressContract, event)
    } catch (error) { log.warn('Batch progress delivery failed', error) }
  }

  getQueueStatus() { return { pending: this.queue.size, running: this.queue.pending } }
  async onIdle(): Promise<void> { while (this.executions.size) await Promise.all([...this.executions.values()]) }

  stopAll(): void {
    this.shuttingDown = true
    for (const [taskId, controller] of this.runningTasks) {
      controller.abort()
      const task = getBatchTaskById(taskId)
      if (!task) continue
      cancelPendingBatchItems(taskId, '应用关闭前未开始执行')
      for (const item of task.items) {
        if (item.status === 'running') updateBatchTaskItemStatus(item.id, 'unknown', { error: '应用关闭时未能读取服务器执行结果，请查看虚拟机状态和服务器任务记录', completedAt: Date.now() })
      }
      const items = getBatchTaskById(taskId)!.items
      updateBatchTaskStatus(taskId, items.some((item) => item.status === 'unknown') ? 'unknown' : 'cancelled', { completedAt: Date.now(), progress: calculateBatchProgress(items) })
    }
  }
}

let globalBatchTaskManager: BatchTaskManager | null = null
export function getBatchTaskManager(mainWindow?: BrowserWindow): BatchTaskManager {
  if (!globalBatchTaskManager) globalBatchTaskManager = new BatchTaskManager({ mainWindow })
  else if (mainWindow) globalBatchTaskManager.setMainWindow(mainWindow)
  return globalBatchTaskManager
}
export function initBatchTaskManager(mainWindow?: BrowserWindow): BatchTaskManager {
  const manager = getBatchTaskManager(mainWindow)
  manager.initialize()
  return manager
}
