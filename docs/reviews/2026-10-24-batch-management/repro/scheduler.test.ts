// These assertions reproduce current defects; passing does not mean the defects are fixed.
import { beforeEach, expect, it, vi } from 'vitest'
import { BatchTaskManager } from '../../../../src/main/batch/batch-task.manager'
import { closeBatchTaskDatabase } from '../../../../src/main/batch/batch-task.repository'
import { executeBatchOperation } from '../../../../src/main/batch/batch-command.service'

const io = vi.hoisted(() => ({ writes: 0, bytes: 0 }))
vi.mock('electron', () => ({ BrowserWindow: vi.fn() }))
vi.mock('../../../../src/main/persistence/json-store', () => ({
  readJsonStore: () => [],
  writeJsonStore: (_name: string, data: unknown) => {
    io.writes++
    io.bytes += Buffer.byteLength(JSON.stringify({ version: 1, data }))
  },
}))
vi.mock('../../../../src/main/batch/batch-command.service', () => ({
  executeBatchOperation: vi.fn().mockResolvedValue({ success: true }),
  precheckBatchOperation: vi.fn(async (_type, items) => new Map(items.map((item) => [`${item.connectionId}:${item.vmRef}`, { canRun: true }]))),
}))
const target = { connectionId: 'pool', vmRef: 'OpaqueRef:vm', vmName: 'VM' }
beforeEach(() => { closeBatchTaskDatabase(); vi.clearAllMocks(); io.writes = 0; io.bytes = 0 })

it('reproduces admission and execution of duplicate snapshot targets in separate tasks', async () => {
  const manager = new BatchTaskManager()
  const first = await manager.submitTask('snapshot', [target], { snapshotName: 'before-change' })
  const second = await manager.submitTask('snapshot', [target], { snapshotName: 'before-change' })
  await manager.onIdle()
  expect(first).not.toBe(second)
  expect(executeBatchOperation).toHaveBeenCalledTimes(2)
  expect(manager.getTaskStatus(first)?.items[0].status).toBe('completed')
  expect(manager.getTaskStatus(second)?.items[0].status).toBe('completed')
})

it('measures full-history serialization amplification for 100 immediately completed items', async () => {
  const manager = new BatchTaskManager()
  const targets = Array.from({ length: 100 }, (_, i) => ({ ...target, vmRef: `OpaqueRef:${i}` }))
  const id = await manager.submitTask('snapshot', targets)
  await manager.onIdle()
  expect(manager.getTaskStatus(id)?.progress.completed).toBe(100)
  expect(io.writes).toBe(407)
  expect(io.bytes).toBeGreaterThan(10_000_000)
  console.log(JSON.stringify({ scenario: '100-items-no-history-mocked-IO', writes: io.writes, serializedBytes: io.bytes }))
})

it('reproduces completed history growing beyond the unused 50-task cleanup default', async () => {
  const manager = new BatchTaskManager()
  for (let i = 0; i < 51; i++) {
    await manager.submitTask('snapshot', [target])
    await manager.onIdle()
  }
  expect(manager.getAllTasks()).toHaveLength(51)
  expect(manager.getAllTasks().every((task) => task.status === 'completed')).toBe(true)
})
