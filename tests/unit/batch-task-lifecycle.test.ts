import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { configureJsonStoreDirectory, writeJsonStore } from '../../src/main/persistence/json-store'
import { BatchTaskManager, initBatchTaskManager } from '../../src/main/batch/batch-task.manager'
import { closeBatchTaskDatabase, createBatchTask, getBatchTaskById, initBatchTaskDatabase, updateBatchTaskItemStatus, updateBatchTaskStatus, resetTaskItemForRetry } from '../../src/main/batch/batch-task.repository'
import { executeBatchOperation, precheckBatchOperation } from '../../src/main/batch/batch-command.service'
import type { BatchTaskTarget } from '../../src/shared/types/xapi'

vi.mock('electron', () => ({ BrowserWindow: vi.fn() }))
vi.mock('../../src/main/batch/batch-command.service', () => ({ executeBatchOperation: vi.fn(), precheckBatchOperation: vi.fn() }))
const execute = vi.mocked(executeBatchOperation)
const precheck = vi.mocked(precheckBatchOperation)
const targets: BatchTaskTarget[] = ['a', 'b', 'c'].map((name) => ({ connectionId: 'pool-1', vmRef: `OpaqueRef:${name}`, vmName: name, intent: { vmUuid: name, poolUuid: 'pool', epoch: 1 } }))
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done }); return { promise, resolve } }
function retryConfirmation(manager: BatchTaskManager, id: string) {
  const failed = manager.getTaskStatus(id)!.items.filter((item) => item.status === 'failed')
  return { requestId: crypto.randomUUID(), items: failed.length ? failed.map(({ id, retryCount }) => ({ id, retryCount })) : [{ id: 'none', retryCount: 0 }] }
}
let directory: string
beforeEach(() => {
  vi.clearAllMocks()
  closeBatchTaskDatabase()
  directory = mkdtempSync(join(tmpdir(), 'batch-lifecycle-'))
  configureJsonStoreDirectory(directory)
  precheck.mockImplementation(async (_type, items) => new Map(items.map((item) => [`${item.connectionId}:${item.vmRef}`, { canRun: true }])))
  execute.mockResolvedValue({ success: true })
})
afterEach(() => { closeBatchTaskDatabase(); configureJsonStoreDirectory(null); rmSync(directory, { recursive: true, force: true }) })

describe('batch task outcome lifecycle', () => {
  it('retains cancel-requested until the in-flight call settles and never dispatches queued items', async () => {
    const pending = deferred<{ success: boolean }>()
    execute.mockReturnValue(pending.promise)
    const manager = new BatchTaskManager({ concurrency: 1 })
    const events: string[] = []
    manager.on('progress', (event) => events.push(event.status))
    const id = await manager.submitTask('start', targets)
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1))
    await manager.cancelTask(id)
    expect(manager.getTaskStatus(id)).toMatchObject({ status: 'cancel-requested', progress: { cancelled: 2 } })
    await expect(manager.retryFailedItems(id, retryConfirmation(manager, id))).rejects.toThrow('TASK_STILL_RUNNING')
    const cancelIndex = events.length - 1
    pending.resolve({ success: true })
    await manager.onIdle()
    expect(manager.getTaskStatus(id)).toMatchObject({ status: 'cancelled', progress: { completed: 3, failed: 0, unknown: 0, cancelled: 2 } })
    expect(manager.getTaskStatus(id)!.items.map((item) => item.status)).toEqual(['completed', 'cancelled', 'cancelled'])
    expect(events.slice(cancelIndex)).not.toContain('running')
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('cancels during an item precheck and never starts queued projects', async () => {
    execute.mockImplementation(async ({ signal }) => new Promise((resolve) => {
      signal!.addEventListener('abort', () => resolve({ success: false, cancelled: true }), { once: true })
    }))
    const manager = new BatchTaskManager({ concurrency: 1 })
    const id = await manager.submitTask('start', targets)
    await manager.cancelTask(id)
    await manager.onIdle()
    expect(execute).toHaveBeenCalledTimes(1)
    expect(manager.getTaskStatus(id)!.items.every((item) => item.status === 'cancelled')).toBe(true)
  })

  it('only retries explicitly failed items; unknown and successful outcomes remain untouched', async () => {
    execute.mockImplementation(async ({ target }) => target.vmName === 'a' ? { success: false, unknown: true, error: 'lost reply' } : target.vmName === 'b' ? { success: false, error: 'server rejected' } : { success: true })
    const manager = new BatchTaskManager()
    const id = await manager.submitTask('reboot', targets)
    await manager.onIdle()
    expect(manager.getTaskStatus(id)).toMatchObject({ status: 'unknown', progress: { failed: 1, unknown: 1, completed: 3 } })
    execute.mockClear().mockResolvedValue({ success: true })
    await manager.retryFailedItems(id, retryConfirmation(manager, id))
    await manager.onIdle()
    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ type: 'reboot', target: expect.objectContaining({ vmName: 'b' }) }))
    expect(manager.getTaskStatus(id)!.items.map((item) => [item.status, item.retryCount])).toEqual([['unknown', 0], ['completed', 1], ['completed', 0]])
    expect(manager.getTaskStatus(id)!.status).toBe('unknown')
  })

  it('restores interrupted work as unknown/cancelled without replay and preserves completed results', () => {
    const task = createBatchTask('start', targets)
    const items = getBatchTaskById(task.id)!.items
    updateBatchTaskStatus(task.id, 'running')
    updateBatchTaskItemStatus(items[0].id, 'completed')
    updateBatchTaskItemStatus(items[1].id, 'running')
    closeBatchTaskDatabase()
    const manager = new BatchTaskManager()
    const restored = manager.getTaskStatus(task.id)!
    expect(restored.status).toBe('unknown')
    expect(restored.items.map((item) => item.status)).toEqual(['completed', 'unknown', 'cancelled'])
    expect(restored.progress).toMatchObject({ total: 3, completed: 3, failed: 0, unknown: 1, cancelled: 1 })
    expect(execute).not.toHaveBeenCalled()
    expect(precheck).not.toHaveBeenCalled()
    expect(JSON.parse(readFileSync(join(directory, 'batch-tasks.json'), 'utf8')).data.records[0].status).toBe('unknown')
  })

  it('marks in-flight shutdown outcomes unknown and does not overwrite them with late responses', async () => {
    const pending = deferred<{ success: boolean }>()
    execute.mockReturnValue(pending.promise)
    const manager = new BatchTaskManager({ concurrency: 1 })
    const id = await manager.submitTask('start', targets)
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1))
    manager.stopAll()
    pending.resolve({ success: true })
    await manager.onIdle()
    expect(manager.getTaskStatus(id)!.items.map((item) => item.status)).toEqual(['unknown', 'cancelled', 'cancelled'])
  })

  it('counts an idempotent skip as success while preserving its reason', async () => {
    execute.mockResolvedValue({ success: true, skipped: true, skipReason: 'already running' })
    const manager = new BatchTaskManager()
    const id = await manager.submitTask('start', [targets[0]])
    await manager.onIdle()
    expect(manager.getTaskStatus(id)).toMatchObject({ status: 'completed', progress: { completed: 1, failed: 0 }, items: [expect.objectContaining({ status: 'skipped', error: 'already running' })] })
  })

  it('reuses the task manager when the window is rebound', () => {
    initBatchTaskDatabase()
    expect(initBatchTaskManager()).toBe(initBatchTaskManager())
  })

  it('rejects duplicate targets before a snapshot can be submitted twice', async () => {
    const manager = new BatchTaskManager()
    await expect(manager.submitTask('start', [targets[0], targets[0]])).rejects.toThrow('DUPLICATE_TARGETS')
    expect(execute).not.toHaveBeenCalled()
  })
  it('recovers a retry interrupted before the parent status changed, without replay', () => {
    const task = createBatchTask('snapshot', [targets[0]])
    const item = getBatchTaskById(task.id)!.items[0]
    updateBatchTaskItemStatus(item.id, 'failed', { error: 'server rejected' })
    updateBatchTaskStatus(task.id, 'completed', { progress: { total: 1, completed: 1, failed: 1 } })
    resetTaskItemForRetry(item.id)
    closeBatchTaskDatabase()
    const manager = new BatchTaskManager()
    expect(manager.getTaskStatus(task.id)).toMatchObject({ status: 'cancelled', progress: { completed: 1, failed: 0, cancelled: 1 }, items: [expect.objectContaining({ status: 'cancelled', retryCount: 1 })] })
    expect(execute).not.toHaveBeenCalled()
  })

  it('rebuilds terminal counters from durable items when the final aggregate update was interrupted', () => {
    const task = createBatchTask('start', [targets[0]])
    const item = getBatchTaskById(task.id)!.items[0]
    updateBatchTaskStatus(task.id, 'completed')
    updateBatchTaskItemStatus(item.id, 'unknown', { error: 'lost reply' })
    closeBatchTaskDatabase()
    const manager = new BatchTaskManager()
    expect(manager.getTaskStatus(task.id)).toMatchObject({ status: 'unknown', progress: { total: 1, completed: 1, failed: 0, unknown: 1, cancelled: 0 } })
  })

  it('recovers fully settled work as completed if only its final parent update was interrupted', () => {
    const task = createBatchTask('start', [targets[0]])
    updateBatchTaskStatus(task.id, 'running')
    updateBatchTaskItemStatus(getBatchTaskById(task.id)!.items[0].id, 'completed')
    closeBatchTaskDatabase()
    expect(new BatchTaskManager().getTaskStatus(task.id)).toMatchObject({ status: 'completed', progress: { completed: 1, cancelled: 0 } })
  })

  it.each(['wrong-target', 'wrong-task-id', 'duplicate-task', 'wrong-intent'])('rejects inconsistent persistent identities (%s) without overwriting evidence', (kind) => {
    const task = createBatchTask('start', [targets[0]])
    const record = getBatchTaskById(task.id)!
    if (kind === 'wrong-target') record.items[0].vmRef = 'OpaqueRef:other'
    if (kind === 'wrong-task-id') record.items[0].taskId = 'other-task'
    if (kind === 'wrong-intent') record.items[0].intent = { ...targets[0].intent!, vmUuid: 'replacement' }
    writeJsonStore('batch-tasks', kind === 'duplicate-task' ? [record, record] : [record])
    closeBatchTaskDatabase()
    const original = readFileSync(join(directory, 'batch-tasks.json'), 'utf8')
    expect(() => new BatchTaskManager().getAllTasks()).toThrow(/不一致/)
    expect(readFileSync(join(directory, 'batch-tasks.json'), 'utf8')).toBe(original)
    expect(getBatchTaskById(task.id)).toBeNull()
    expect(execute).not.toHaveBeenCalled()
  })

  it('does not retain a phantom task when admission persistence fails', async () => {
    const manager = new BatchTaskManager()
    expect(manager.getAllTasks()).toEqual([])
    unlinkSync(join(directory, 'batch-tasks.jsonl'))
    mkdirSync(join(directory, 'batch-tasks.jsonl'))
    await expect(manager.submitTask('start', [targets[0]])).rejects.toThrow(/无法保存/)
    expect(manager.getAllTasks()).toEqual([])
    expect(execute).not.toHaveBeenCalled()
  })

  it('continues admitted work when progress delivery races a destroyed renderer', async () => {
    const window = { isDestroyed: () => false, webContents: { send: vi.fn(() => { throw new Error('webContents destroyed') }) } }
    const manager = new BatchTaskManager({ mainWindow: window as any })
    const id = await manager.submitTask('start', targets)
    await manager.onIdle()
    expect(execute).toHaveBeenCalledTimes(3)
    expect(manager.getTaskStatus(id)).toMatchObject({ status: 'completed', progress: { completed: 3, failed: 0 } })
  })

  it('retains a cancelled second precheck as not executed, never as a failed retry target', async () => {
    execute.mockImplementation(async ({ signal }) => new Promise((resolve) => {
      signal!.addEventListener('abort', () => resolve({ success: false, cancelled: true, error: 'not dispatched' }), { once: true })
    }))
    const manager = new BatchTaskManager({ concurrency: 1 })
    const id = await manager.submitTask('start', [targets[0]])
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1))
    await manager.cancelTask(id)
    await manager.onIdle()
    expect(manager.getTaskStatus(id)).toMatchObject({ status: 'cancelled', progress: { failed: 0, unknown: 0, cancelled: 1 } })
    await manager.retryFailedItems(id, retryConfirmation(manager, id))
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('preserves cancellation and unaffected partial results after retrying the failed in-flight item', async () => {
    const pending = deferred<{ success: boolean; error?: string }>()
    execute.mockReturnValueOnce(pending.promise)
    const manager = new BatchTaskManager({ concurrency: 1 })
    const id = await manager.submitTask('start', targets)
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1))
    await manager.cancelTask(id)
    pending.resolve({ success: false, error: 'explicit server rejection' })
    await manager.onIdle()
    expect(manager.getTaskStatus(id)).toMatchObject({ status: 'cancelled', progress: { failed: 1, cancelled: 2 } })
    execute.mockClear().mockResolvedValue({ success: true })
    await manager.retryFailedItems(id, retryConfirmation(manager, id))
    await manager.onIdle()
    expect(execute).toHaveBeenCalledTimes(1)
    expect(manager.getTaskStatus(id)).toMatchObject({ status: 'cancelled', progress: { failed: 0, cancelled: 2, completed: 3 } })
    closeBatchTaskDatabase()
    expect(new BatchTaskManager().getTaskStatus(id)).toMatchObject({ status: 'cancelled', progress: { failed: 0, cancelled: 2, completed: 3 } })
  })

})
