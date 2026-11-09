// These assertions reproduce current defects; passing does not mean the defects are fixed.
import { beforeEach, expect, it, vi } from 'vitest'
import { useBatchStore } from '../../../../src/renderer/src/store/batch.store'
const target = { connectionId: 'pool', vmRef: 'OpaqueRef:vm', vmName: 'VM' }
const task = (id: string) => ({ id, type: 'snapshot' as const, targets: [target], status: 'running' as const, progress: { total: 1, completed: 0, failed: 0 }, createdAt: 1, items: [] })
const api = { submit: vi.fn(), list: vi.fn(), getStatus: vi.fn() }

beforeEach(() => {
  vi.resetAllMocks()
  useBatchStore.setState({ selectedVms: [target], activeTask: null, taskHistory: [], isLoading: false, error: null, unsubscribeProgress: null })
  Object.assign(globalThis, { window: { xapi: { batch: api, onBatchProgress: vi.fn(() => vi.fn()) } } })
})

it('reproduces two submissions for the same selection while the first submit is pending', async () => {
  const release: Array<() => void> = []
  api.submit.mockImplementation(() => new Promise((resolve) => {
    const taskId = `task-${release.length}`
    release.push(() => resolve({ taskId }))
  }))
  api.list.mockResolvedValue([])
  api.getStatus.mockImplementation(async (id) => task(id))
  const first = useBatchStore.getState().submitTask('snapshot')
  expect(useBatchStore.getState().isLoading).toBe(true)
  const second = useBatchStore.getState().submitTask('snapshot')
  expect(api.submit).toHaveBeenCalledTimes(2)
  expect(api.submit.mock.calls[0]).toEqual(api.submit.mock.calls[1])
  release.forEach((done) => done())
  await Promise.all([first, second])
})

it('reproduces omission of the second running task from both active task and history', async () => {
  api.list.mockResolvedValue([task('newer'), task('older')])
  api.getStatus.mockImplementation(async (id) => task(id))
  await useBatchStore.getState().refreshTasks()
  expect(useBatchStore.getState().activeTask?.id).toBe('newer')
  expect(useBatchStore.getState().taskHistory).toEqual([])
  expect(api.getStatus).not.toHaveBeenCalledWith('older')
})
