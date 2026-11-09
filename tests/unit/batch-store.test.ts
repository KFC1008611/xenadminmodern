import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useBatchStore } from '../../src/renderer/src/store/batch.store'
import { useMultiDataStore } from '../../src/renderer/src/store/multiData.store'
const target = { connectionId: 'A', vmRef: 'OpaqueRef:vm', vmName: 'VM', intent: { vmUuid: 'vm', poolUuid: 'pool', epoch: 1 } }
const task = { id: 'batch-1', type: 'start' as const, targets: [target], status: 'unknown' as const, progress: { total: 1, completed: 1, failed: 0, unknown: 1 }, createdAt: 1, items: [{ id: 'item-1', taskId: 'batch-1', ...target, status: 'unknown' as const, error: 'lost reply', retryCount: 0 }] }
const api = { submit: vi.fn(), list: vi.fn(), getStatus: vi.fn(), cancel: vi.fn(), retry: vi.fn() }
beforeEach(() => { vi.resetAllMocks(); useBatchStore.setState({ selectedVms: [target], activeTask: null, activeTasks: [], taskHistory: [], error: null, isLoading: false, isSubmitting: false, pendingTaskIds: [], unconfirmedSubmission: null, unsubscribeProgress: null }); useMultiDataStore.setState({ refreshConnection: vi.fn().mockResolvedValue(undefined) }); Object.assign(globalThis, { window: { xapi: { batch: api, onBatchProgress: vi.fn(() => vi.fn()) } } }) })
describe('batch task store', () => {
  it('clears submitted selection and returns task identity even if progress retrieval then fails', async () => {
    api.submit.mockResolvedValue({ taskId: 'batch-1' }); api.list.mockResolvedValue([]); api.getStatus.mockRejectedValue(new Error('connection lost'))
    await expect(useBatchStore.getState().submitTask('start')).resolves.toBe('batch-1')
    expect(useBatchStore.getState().selectedVms).toEqual([])
    expect(useBatchStore.getState().error).toContain('任务已提交（batch-1）')
    expect(useBatchStore.getState().activeTask?.id).toBe('batch-1')
    expect(api.submit).toHaveBeenCalledTimes(1)
  })
  it('loads unknown task history and preserves per-item outcomes in details', async () => {
    api.list.mockResolvedValue([task]); api.getStatus.mockResolvedValue(task)
    await useBatchStore.getState().refreshTasks()
    await useBatchStore.getState().loadTaskDetails(task.id)
    expect(useBatchStore.getState().activeTask).toBeNull()
    expect(useBatchStore.getState().taskHistory[0].results).toEqual([expect.objectContaining({ connectionId: 'A', status: 'unknown', success: false, error: 'lost reply' })])
  })
  it('ignores a late running refresh after a newer cancellation-requested push', async () => {
    let resolve!: (value: unknown) => void
    api.list.mockReturnValueOnce(new Promise((done) => { resolve = done }))
    api.getStatus.mockResolvedValue({ ...task, status: 'running', items: [] })
    useBatchStore.setState({ activeTask: { ...task, status: 'running', results: [] } })
    const refresh = useBatchStore.getState().refreshTasks()
    useBatchStore.getState().handleProgressEvent({ taskId: task.id, status: 'cancel-requested', progress: task.progress })
    resolve([{ ...task, status: 'running' }])
    await refresh
    expect(useBatchStore.getState().activeTask!.status).toBe('cancel-requested')
  })

  it('discards old detail rows when a retry changes the terminal outcome', async () => {
    useBatchStore.setState({ taskHistory: [{ ...task, status: 'completed', progress: { total: 1, completed: 1, failed: 1 }, results: [{ vmRef: target.vmRef, vmName: target.vmName, success: false, status: 'failed', error: 'previous rejection' }] }] })
    api.list.mockResolvedValue([{ id: task.id, type: task.type, targets: [target], status: 'completed', progress: { total: 1, completed: 1, failed: 0 }, createdAt: 1 }])
    await useBatchStore.getState().refreshTasks()
    expect(useBatchStore.getState().taskHistory[0].results).toEqual([])
  })

  it('places a task that finishes between list and detail reads into history with its final items', async () => {
    api.list.mockResolvedValue([{ ...task, status: 'running' }])
    api.getStatus.mockResolvedValue(task)
    await useBatchStore.getState().refreshTasks()
    expect(useBatchStore.getState().activeTask).toBeNull()
    expect(useBatchStore.getState().taskHistory[0]).toMatchObject({ status: 'unknown', results: [expect.objectContaining({ status: 'unknown', error: 'lost reply' })] })
  })

  it('rejects submit reentry synchronously while the first admission is pending', async () => {
    let release!: (value: unknown) => void
    api.submit.mockReturnValueOnce(new Promise((resolve) => { release = resolve }))
    api.list.mockResolvedValue([task]); api.getStatus.mockResolvedValue(task)
    const first = useBatchStore.getState().submitTask('start')
    await expect(useBatchStore.getState().submitTask('start')).rejects.toThrow(/正在提交/)
    expect(api.submit).toHaveBeenCalledTimes(1)
    release({ taskId: task.id }); await first
  })

  it('reuses the request identity after an unconfirmed admission response', async () => {
    api.submit.mockRejectedValueOnce(new Error('lost IPC response')).mockResolvedValueOnce({ taskId: task.id })
    api.list.mockResolvedValue([task])
    await expect(useBatchStore.getState().submitTask('start')).rejects.toThrow('lost IPC response')
    await useBatchStore.getState().submitTask('start')
    expect(api.submit.mock.calls[0][0].requestId).toBe(api.submit.mock.calls[1][0].requestId)
  })

  it('does not clear a new selection made while an earlier target is being admitted', async () => {
    let release!: (value: unknown) => void
    api.submit.mockReturnValueOnce(new Promise((resolve) => { release = resolve }))
    api.list.mockResolvedValue([task])
    const first = useBatchStore.getState().submitTask('start')
    const next = { ...target, vmRef: 'OpaqueRef:other', vmName: 'Other VM', intent: { ...target.intent, vmUuid: 'other' } }
    useBatchStore.getState().setSelectedVms([next])
    release({ taskId: task.id }); await first
    expect(useBatchStore.getState().selectedVms).toEqual([next])
  })

  it('retains every active task and updates a background task without losing another', async () => {
    const one = { ...task, id: 'one', status: 'running' }, two = { ...task, id: 'two', status: 'running' }
    api.list.mockResolvedValue([one, two]); api.getStatus.mockImplementation(async (id) => id === 'one' ? one : two)
    await useBatchStore.getState().refreshTasks()
    expect(useBatchStore.getState().activeTasks.map((entry) => entry.id)).toEqual(['one', 'two'])
    useBatchStore.getState().handleProgressEvent({ taskId: 'two', status: 'cancel-requested', progress: task.progress })
    expect(useBatchStore.getState().activeTasks.find((entry) => entry.id === 'two')?.status).toBe('cancel-requested')
    expect(useBatchStore.getState().activeTasks.find((entry) => entry.id === 'one')?.status).toBe('running')
  })

  it('invalidates a stale detail read when a confirmed retry starts', async () => {
    let release!: (value: unknown) => void
    api.getStatus.mockReturnValueOnce(new Promise((resolve) => { release = resolve }))
    api.retry.mockResolvedValue(undefined); api.list.mockResolvedValue([])
    const read = useBatchStore.getState().loadTaskDetails(task.id)
    const confirmation = { requestId: 'retry', items: [{ id: 'failed', retryCount: 0 }] }
    await useBatchStore.getState().retryTask(task.id, confirmation)
    release(task)
    expect(await read).toBeNull()
    expect(api.retry).toHaveBeenCalledWith(task.id, confirmation)
  })

  it.each(['completed', 'cancelled', 'unknown'] as const)('keeps the displayed %s result when the follow-up list read fails', async (status) => {
    api.list.mockRejectedValue(new Error('读取任务列表失败'))
    useBatchStore.setState({ activeTask: { ...task, status: 'running', results: [] } })
    useBatchStore.getState().handleProgressEvent({ taskId: task.id, status, progress: task.progress })
    await vi.waitFor(() => expect(useBatchStore.getState().error).toBe('读取任务列表失败'))
    expect(useBatchStore.getState().activeTask?.status).toBe(status)
    expect(useBatchStore.getState().activeTasks).toEqual([])
  })

  it('retains the displayed result across successful refreshes until it is dismissed', async () => {
    const { items, ...summary } = task
    const completed = { ...summary, startedAt: 2, completedAt: 3 }
    const result = { connectionId: target.connectionId, vmRef: target.vmRef, vmName: target.vmName, status: 'unknown' as const, success: false, error: items[0].error }
    api.list.mockResolvedValue([completed]); api.getStatus.mockResolvedValue({ ...completed, items })
    useBatchStore.setState({ activeTask: { ...summary, startedAt: 2, status: 'running', results: [result] } })
    useBatchStore.getState().handleProgressEvent({ taskId: task.id, status: 'unknown', progress: task.progress })
    await useBatchStore.getState().refreshTasks()
    expect(useBatchStore.getState().activeTask).toMatchObject({ status: 'unknown', completedAt: 3, results: [result] })
    useBatchStore.getState().clearActiveTask()
    await useBatchStore.getState().refreshTasks()
    expect(useBatchStore.getState().activeTask).toBeNull()
    expect(useBatchStore.getState().taskHistory).toHaveLength(1)
  })

  it('keeps pushed errors if the terminal detail read fails and replaces them after a successful retry', async () => {
    const { items, ...summary } = task
    const result = { connectionId: target.connectionId, vmRef: target.vmRef, vmName: target.vmName, status: 'unknown' as const, success: false, error: items[0].error }
    api.list.mockResolvedValue([{ ...summary, startedAt: 2, completedAt: 3 }])
    api.getStatus.mockRejectedValue(new Error('详情读取中断'))
    useBatchStore.setState({ activeTask: { ...summary, startedAt: 2, status: 'running', results: [result] } })
    useBatchStore.getState().handleProgressEvent({ taskId: task.id, status: 'unknown', progress: task.progress })
    await useBatchStore.getState().refreshTasks()
    expect(useBatchStore.getState().activeTask).toMatchObject({ status: 'unknown', completedAt: 3, results: [result] })
    expect(useBatchStore.getState().error).toContain('详情读取中断')
    api.getStatus.mockResolvedValue({ ...summary, startedAt: 2, completedAt: 3, items: [{ ...items[0], error: '完整的服务器错误详情' }] })
    await useBatchStore.getState().refreshTasks()
    expect(useBatchStore.getState().activeTask?.results[0].error).toBe('完整的服务器错误详情')
    expect(useBatchStore.getState().error).toBeNull()
  })

  it('loads item outcomes when a submitted task finishes before its admission response', async () => {
    const { items, ...summary } = task
    api.submit.mockResolvedValue({ taskId: task.id })
    api.list.mockResolvedValue([{ ...summary, startedAt: 2, completedAt: 3 }])
    api.getStatus.mockResolvedValue({ ...summary, startedAt: 2, completedAt: 3, items })
    await useBatchStore.getState().submitTask('start')
    expect(api.getStatus).toHaveBeenCalledWith(task.id)
    expect(useBatchStore.getState().activeTask).toMatchObject({ status: 'unknown', results: [expect.objectContaining({ error: items[0].error })] })
    expect(useBatchStore.getState().selectedVms).toEqual([])
    expect(api.submit).toHaveBeenCalledTimes(1)
  })

  it.each(['success', 'failure'])('ignores a terminal detail read %s when a retry has already started', async (outcome) => {
    const { items, ...summary } = task
    let release!: (value: unknown) => void
    let reject!: (error: Error) => void
    api.list.mockResolvedValue([{ ...summary, completedAt: 3 }])
    api.getStatus.mockReturnValueOnce(new Promise((resolve, fail) => { release = resolve; reject = fail }))
    useBatchStore.setState({ activeTask: { ...summary, completedAt: 3, results: [] } })
    const refresh = useBatchStore.getState().refreshTasks()
    await vi.waitFor(() => expect(api.getStatus).toHaveBeenCalledWith(task.id))
    useBatchStore.getState().handleProgressEvent({ taskId: task.id, status: 'running', progress: { total: 1, completed: 0, failed: 0 } })
    if (outcome === 'success') release({ ...summary, completedAt: 3, items })
    else reject(new Error('旧详情读取失败'))
    await refresh
    expect(useBatchStore.getState().activeTask).toMatchObject({ status: 'running', progress: { completed: 0 } })
    expect(useBatchStore.getState().activeTask?.completedAt).toBeUndefined()
    expect(useBatchStore.getState().error).toBeNull()
  })

  it('does not retain a previous failure when a displayed retry has a different outcome', async () => {
    const result = { connectionId: target.connectionId, vmRef: target.vmRef, vmName: target.vmName, status: 'failed' as const, success: false, error: 'previous rejection' }
    const previous = { id: task.id, type: task.type, targets: [target], status: 'completed' as const, createdAt: 1, startedAt: 2, completedAt: 3, progress: { total: 1, completed: 1, failed: 1 }, results: [result] }
    useBatchStore.setState({ activeTask: previous, taskHistory: [previous] })
    api.list.mockResolvedValue([{ id: task.id, type: task.type, targets: [target], status: 'completed', createdAt: 1, startedAt: 4, completedAt: 5, progress: { total: 1, completed: 1, failed: 0 } }])
    api.getStatus.mockRejectedValue(new Error('新结果详情读取失败'))
    await useBatchStore.getState().refreshTasks()
    expect(useBatchStore.getState().activeTask?.results).toEqual([])
  })

  it('shows the next running task only after the displayed result is dismissed', async () => {
    const background = { ...task, id: 'background', status: 'running' as const, results: [] }
    api.list.mockResolvedValue([task, background]); api.getStatus.mockImplementation(async (id) => id === task.id ? task : background)
    useBatchStore.setState({ activeTask: { ...task, status: 'running', results: [] }, activeTasks: [background] })
    useBatchStore.getState().handleProgressEvent({ taskId: task.id, status: 'unknown', progress: task.progress })
    await useBatchStore.getState().refreshTasks()
    expect(useBatchStore.getState().activeTask?.id).toBe(task.id)
    useBatchStore.getState().clearActiveTask()
    expect(useBatchStore.getState().activeTask?.id).toBe('background')
  })

  it('focuses a newly admitted task while retaining a prior completed task in history', async () => {
    const previous = { ...task, id: 'previous', results: [] }
    const admitted = { ...task, id: 'new', status: 'running' as const, items: [] }
    api.submit.mockResolvedValue({ taskId: admitted.id }); api.list.mockResolvedValue([admitted, previous]); api.getStatus.mockResolvedValue(admitted)
    useBatchStore.setState({ activeTask: previous, taskHistory: [previous] })
    await useBatchStore.getState().submitTask('start')
    expect(useBatchStore.getState().activeTask?.id).toBe(admitted.id)
    expect(useBatchStore.getState().taskHistory.map((entry) => entry.id)).toContain(previous.id)
  })

  it('reads a newly admitted task by identity when the list omits it and keeps its fast completion visible', async () => {
    api.submit.mockResolvedValue({ taskId: task.id }); api.list.mockResolvedValue([]); api.getStatus.mockResolvedValue(task)
    await useBatchStore.getState().submitTask('start')
    expect(api.getStatus).toHaveBeenCalledWith(task.id)
    expect(useBatchStore.getState().activeTask?.status).toBe('unknown')
    expect(useBatchStore.getState().taskHistory).toHaveLength(1)
  })

})
