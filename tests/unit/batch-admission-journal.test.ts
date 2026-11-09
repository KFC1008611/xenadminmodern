import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { configureJsonStoreDirectory, writeJsonStore } from '../../src/main/persistence/json-store'
import { BatchTaskManager } from '../../src/main/batch/batch-task.manager'
import { closeBatchTaskDatabase, createBatchTask, getBatchTaskById, updateBatchTaskItemStatus, updateBatchTaskStatus } from '../../src/main/batch/batch-task.repository'
import { executeBatchOperation } from '../../src/main/batch/batch-command.service'

vi.mock('electron', () => ({ BrowserWindow: vi.fn() }))
vi.mock('../../src/main/batch/batch-command.service', () => ({ executeBatchOperation: vi.fn() }))
const execute = vi.mocked(executeBatchOperation)
const target = { connectionId: 'pool-1', vmRef: 'OpaqueRef:vm', vmName: 'VM', intent: { vmUuid: 'vm', poolUuid: 'pool', epoch: 1 } }
let directory: string
beforeEach(() => {
  vi.resetAllMocks(); closeBatchTaskDatabase()
  directory = mkdtempSync(join(tmpdir(), 'batch-admission-'))
  configureJsonStoreDirectory(directory)
  execute.mockResolvedValue({ success: true })
})
afterEach(() => { closeBatchTaskDatabase(); configureJsonStoreDirectory(null); rmSync(directory, { recursive: true, force: true }) })

it('returns one durable task for a replayed request, including after a process restart', async () => {
  const manager = new BatchTaskManager()
  const first = await manager.submitTask('reboot', [target], undefined, 'same-request')
  expect(await manager.submitTask('reboot', [target], undefined, 'same-request')).toBe(first)
  await manager.onIdle()
  closeBatchTaskDatabase()
  expect(await new BatchTaskManager().submitTask('reboot', [target], undefined, 'same-request')).toBe(first)
  expect(execute).toHaveBeenCalledTimes(1)
})

it('rejects reusing a request identity for a different operation', async () => {
  const manager = new BatchTaskManager()
  await manager.submitTask('start', [target], undefined, 'same-request')
  await manager.onIdle()
  await expect(manager.submitTask('reboot', [target], undefined, 'same-request')).rejects.toThrow(/身份已用于其他/)
  expect(execute).toHaveBeenCalledTimes(1)
})

it('reserves a VM across task queues and across connections to the same pool', async () => {
  let release!: (result: { success: boolean }) => void
  execute.mockReturnValue(new Promise((resolve) => { release = resolve }))
  const manager = new BatchTaskManager()
  await manager.submitTask('reboot', [target])
  await expect(manager.submitTask('start', [{ ...target, connectionId: 'another-connection', vmRef: 'OpaqueRef:alias' }])).rejects.toThrow(/已有批量任务/)
  release({ success: true }); await manager.onIdle()
  expect(execute).toHaveBeenCalledTimes(1)
})

it.each([
  ['migrate', { targetHostRef: 'OpaqueRef:host' }], ['stop', { force: true }],
] as const)('rejects new and historical retry execution of %s', async (type, options) => {
  const manager = new BatchTaskManager()
  await expect(manager.submitTask(type, [target], options)).rejects.toThrow(/不支持|不受支持/)
  const task = createBatchTask(type, [target], options)
  const item = getBatchTaskById(task.id)!.items[0]
  updateBatchTaskItemStatus(item.id, 'failed')
  updateBatchTaskStatus(task.id, 'completed')
  await expect(manager.retryFailedItems(task.id, { requestId: 'retry', items: [{ id: item.id, retryCount: 0 }] })).rejects.toThrow(/不支持|不受支持/)
  expect(execute).not.toHaveBeenCalled()
})

it('checks the reviewed failure attempt and deduplicates retries after admission', async () => {
  execute.mockResolvedValue({ success: false, error: 'explicit rejection' })
  const manager = new BatchTaskManager()
  const id = await manager.submitTask('reboot', [target])
  await manager.onIdle()
  const item = manager.getTaskStatus(id)!.items[0]
  const confirmation = { requestId: 'retry-once', items: [{ id: item.id, retryCount: item.retryCount }] }
  await expect(manager.retryFailedItems(id, { ...confirmation, items: [{ id: item.id, retryCount: 99 }] })).rejects.toThrow(/失败项目已变化/)
  await manager.retryFailedItems(id, confirmation)
  await manager.onIdle()
  await manager.retryFailedItems(id, confirmation)
  expect(execute).toHaveBeenCalledTimes(2)
  await expect(manager.retryFailedItems(id, { ...confirmation, requestId: 'different-retry' })).rejects.toThrow(/失败项目已变化/)
})

it('bounds all precheck/execution work and cancels queued items without an eager read stage', async () => {
  const release: Array<() => void> = []
  execute.mockImplementation(() => new Promise((resolve) => { release.push(() => resolve({ success: true })) }))
  const manager = new BatchTaskManager()
  const targets = Array.from({ length: 120 }, (_, i) => ({ ...target, vmRef: 'OpaqueRef:' + i, intent: { ...target.intent, vmUuid: 'vm-' + i } }))
  const id = await manager.submitTask('start', targets)
  expect(execute).toHaveBeenCalledTimes(5)
  await manager.cancelTask(id)
  release.forEach((done) => done()); await manager.onIdle()
  expect(execute).toHaveBeenCalledTimes(5)
  expect(manager.getTaskStatus(id)?.progress).toMatchObject({ completed: 120, cancelled: 115 })
})

it('writes small durable item deltas instead of serializing the whole 100-item history per progress event', async () => {
  const manager = new BatchTaskManager()
  const targets = Array.from({ length: 100 }, (_, i) => ({ ...target, vmRef: 'OpaqueRef:' + i, intent: { ...target.intent, vmUuid: 'vm-' + i } }))
  const id = await manager.submitTask('start', targets)
  await manager.onIdle()
  const journal = readFileSync(join(directory, 'batch-tasks.jsonl'), 'utf8')
  expect(journal.trim().split('\n')).toHaveLength(203)
  expect(Buffer.byteLength(journal)).toBeLessThan(180_000)
  expect(JSON.parse(readFileSync(join(directory, 'batch-tasks.json'), 'utf8')).data.records).toEqual([])
  closeBatchTaskDatabase()
  expect(new BatchTaskManager().getTaskStatus(id)).toMatchObject({ status: 'completed', progress: { completed: 100 } })
  expect(execute).toHaveBeenCalledTimes(100)
})

it('prunes old settled history while preserving failed and unknown outcomes', async () => {
  const manager = new BatchTaskManager()
  for (const outcome of [{ success: false, error: 'rejected' }, { success: false, unknown: true, error: 'lost reply' }]) {
    execute.mockResolvedValueOnce(outcome)
    await manager.submitTask('start', [target]); await manager.onIdle()
  }
  for (let i = 0; i < 51; i++) { await manager.submitTask('start', [target]); await manager.onIdle() }
  expect(manager.getAllTasks()).toHaveLength(52)
  expect(manager.getAllTasks().filter((task) => task.progress.failed || task.progress.unknown)).toHaveLength(2)
})

it('recovers a torn final log append conservatively, without replaying a dispatched VM operation', () => {
  const task = createBatchTask('start', [target])
  updateBatchTaskStatus(task.id, 'running')
  updateBatchTaskItemStatus(getBatchTaskById(task.id)!.items[0].id, 'running')
  appendFileSync(join(directory, 'batch-tasks.jsonl'), '{"kind":"items","sequence":4')
  closeBatchTaskDatabase()
  expect(new BatchTaskManager().getTaskStatus(task.id)).toMatchObject({ status: 'unknown', items: [expect.objectContaining({ status: 'unknown' })] })
  expect(execute).not.toHaveBeenCalled()
})

it('ignores old log records after a checkpoint was committed but truncation was interrupted', () => {
  const task = createBatchTask('start', [target])
  updateBatchTaskStatus(task.id, 'running')
  updateBatchTaskItemStatus(getBatchTaskById(task.id)!.items[0].id, 'completed')
  updateBatchTaskStatus(task.id, 'completed')
  const log = readFileSync(join(directory, 'batch-tasks.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line))
  writeJsonStore('batch-tasks', { sequence: log.at(-1).sequence, records: [getBatchTaskById(task.id)] }, { flush: true })
  closeBatchTaskDatabase()
  expect(new BatchTaskManager().getTaskStatus(task.id)?.status).toBe('completed')
  expect(execute).not.toHaveBeenCalled()
})

it('preserves malformed complete log records as evidence and admits no new work', () => {
  createBatchTask('start', [target])
  const path = join(directory, 'batch-tasks.jsonl')
  writeFileSync(path, '{broken}\n')
  closeBatchTaskDatabase()
  expect(() => new BatchTaskManager().getAllTasks()).toThrow(/日志/)
  expect(readFileSync(path, 'utf8')).toBe('{broken}\n')
  expect(execute).not.toHaveBeenCalled()
})
