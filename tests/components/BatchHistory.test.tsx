import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import BatchHistoryPage from '../../src/renderer/src/pages/BatchHistoryPage'
import { BatchProgressDialog } from '../../src/renderer/src/components/batch/BatchProgressDialog'
import { useTaskHistoryStore } from '../../src/renderer/src/store/taskHistory.store'
import { useBatchStore } from '../../src/renderer/src/store/batch.store'
const target = { connectionId: 'A', vmRef: 'OpaqueRef:vm', vmName: 'VM A', intent: { vmUuid: 'vm', poolUuid: 'pool', epoch: 1 } }
const failed = { ...target, vmRef: 'OpaqueRef:failed', vmName: 'Failed VM', id: 'failed-item', taskId: 'batch-1', status: 'failed' as const, retryCount: 2 }
const task = { id: 'batch-1', type: 'stop' as const, targets: [target, failed], status: 'unknown' as const, progress: { total: 2, completed: 2, failed: 1, unknown: 1, cancelled: 0 }, items: [failed], results: [{ connectionId: 'A', vmRef: target.vmRef, vmName: 'VM A', status: 'unknown' as const, success: false, error: '响应丢失，请核对服务器' }], createdAt: 1 }
const retry = vi.fn().mockResolvedValue(undefined), cancel = vi.fn().mockResolvedValue(undefined), details = vi.fn()
const retryTask = useBatchStore.getState().retryTask, refreshTasks = useBatchStore.getState().refreshTasks
beforeEach(() => {
  useTaskHistoryStore.setState({ deletedRecords: [] })
  vi.clearAllMocks(); details.mockResolvedValue(task)
  useBatchStore.setState({ activeTask: null, activeTasks: [], pendingTaskIds: [], taskHistory: [task], refreshTasks: vi.fn().mockResolvedValue(undefined), retryTask: retry, cancelTask: cancel, loadTaskDetails: details, isLoading: false, isSubmitting: false, error: null })
})
describe('batch history outcomes and safe retry', () => {
  it('reviews only current explicit failures before retrying an interrupting action', async () => {
    render(<BatchHistoryPage />)
    expect(screen.getByText('读取结果失败', { exact: true })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重试明确失败项' }))
    const dialog = await screen.findByRole('dialog', { name: '确认重试正常关闭' })
    expect(dialog).toHaveTextContent('Failed VM')
    expect(dialog).not.toHaveTextContent('VM A')
    expect(dialog).toHaveTextContent('不会自动强制断电')
    expect(retry).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: '确认', exact: true }))
    await waitFor(() => expect(retry).toHaveBeenCalledWith('batch-1', { requestId: expect.any(String), items: [{ id: failed.id, retryCount: 2 }] }))
  })
  it('has no retry action for unknown-only outcomes', () => {
    useBatchStore.setState({ taskHistory: [{ ...task, progress: { total: 1, completed: 1, failed: 0, unknown: 1 } }] })
    render(<BatchHistoryPage />)
    expect(screen.queryByRole('button', { name: /重试/ })).not.toBeInTheDocument()
    expect(screen.getByText('成功 0', { exact: true })).toBeInTheDocument()
    expect(screen.getByText('失败 0', { exact: true })).toBeInTheDocument()
    expect(screen.getByText('读取失败 1', { exact: true })).toBeInTheDocument()
    expect(screen.queryByText(/结果未确认/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '查看详情' }))
    expect(screen.getByText(/请恢复连接后查看虚拟机状态和服务器任务记录/)).toBeInTheDocument()
    expect(screen.getByText('响应丢失，请核对服务器')).toBeInTheDocument()
  })
  it.each(['delete', 'migrate'] as const)('retains legacy %s records but provides no executable retry', (type) => {
    useBatchStore.setState({ taskHistory: [{ ...task, type }] })
    render(<BatchHistoryPage />)
    expect(screen.queryByRole('button', { name: /重试/ })).not.toBeInTheDocument()
    expect(screen.getByText(type === 'migrate' ? '迁移（历史）' : '删除', { exact: true })).toBeInTheDocument()
  })
  it('labels old force-stop history explicitly and prevents its retry', () => {
    useBatchStore.setState({ taskHistory: [{ ...task, options: { force: true } }] })
    render(<BatchHistoryPage />)
    expect(screen.getByText('强制关闭（历史）')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /重试/ })).not.toBeInTheDocument()
  })
  it('shows every active task and cancels the requested task by identity', async () => {
    const first = { ...task, id: 'first', status: 'running' as const }, second = { ...task, id: 'second', type: 'start' as const, status: 'running' as const }
    useBatchStore.setState({ activeTask: first, activeTasks: [first, second], taskHistory: [] })
    render(<BatchHistoryPage />)
    expect(screen.getByText('2 个进行中 · 0 条历史记录')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: '停止后续操作' })).toHaveLength(2)
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: '停止后续操作' })[1]) })
    expect(cancel).toHaveBeenCalledWith('second')
  })
  it('does not submit a retry when the fresh item read fails', async () => {
    details.mockResolvedValue(null)
    render(<BatchHistoryPage />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '重试明确失败项' })) })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(retry).not.toHaveBeenCalled()
  })
  it('disables local deletion during retry reads and both deletion entries during submission', async () => {
    let resolve!: (value: typeof task) => void
    details.mockReturnValueOnce(new Promise((done) => { resolve = done }))
    render(<><BatchHistoryPage /><BatchProgressDialog /></>)
    const row = screen.getByRole('row', { name: /正常关闭/ })
    fireEvent.click(within(row).getByRole('button', { name: '重试明确失败项' }))
    const remove = within(row).getByRole('button', { name: '删除记录' })
    expect(remove).toBeDisabled()
    fireEvent.click(remove)
    expect(useTaskHistoryStore.getState().deletedRecords).toEqual([])
    await act(async () => resolve(task))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '取消', exact: true }))
    expect(remove).toBeEnabled()
    act(() => useBatchStore.setState({ pendingTaskIds: [task.id] }))
    for (const button of screen.getAllByRole('button', { name: '删除记录' })) expect(button).toBeDisabled()
  })
  it('does not open a late retry confirmation after the record is deleted from notifications', async () => {
    let resolve!: (value: typeof task) => void
    details.mockReturnValueOnce(new Promise((done) => { resolve = done }))
    render(<><BatchHistoryPage /><BatchProgressDialog /></>)
    fireEvent.click(screen.getByRole('button', { name: '重试明确失败项' }))
    fireEvent.click(within(screen.getByRole('region', { name: '批量任务进度' })).getByRole('button', { name: '删除记录' }))
    await act(async () => resolve(task))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(retry).not.toHaveBeenCalled()
    expect(useTaskHistoryStore.getState().deletedRecords).toContain(`batch:${task.id}`)
  })
  it.each(['completed', 'failed'] as const)('keeps a retried %s result visible in notifications and history after refresh and rehydration', async (status) => {
    let resolve!: () => void
    const admission = new Promise<void>((done) => { resolve = done })
    const completed = { ...task, status, progress: { total: 2, completed: 2, failed: status === 'failed' ? 1 : 0 }, items: [{ ...failed, status, retryCount: 3 }] }
    const batch = { retry: vi.fn().mockReturnValue(admission), list: vi.fn().mockResolvedValue([completed]), getStatus: vi.fn().mockResolvedValue(completed) }
    Object.assign(window.xapi, { batch, onBatchProgress: vi.fn(() => vi.fn()) })
    useBatchStore.setState({ activeTask: task, retryTask, refreshTasks, unsubscribeProgress: null })
    const pending = useBatchStore.getState().retryTask(task.id, { requestId: 'retry', items: [{ id: failed.id, retryCount: failed.retryCount }] })
    useTaskHistoryStore.getState().deleteRecord(`batch:${task.id}`)
    useTaskHistoryStore.getState().deleteRecord('copy:other')
    expect(useTaskHistoryStore.getState().deletedRecords).toContain(`batch:${task.id}`)
    resolve(); await pending
    render(<><BatchHistoryPage /><BatchProgressDialog /></>)
    await act(async () => {
      await useTaskHistoryStore.persist.rehydrate()
      await refreshTasks()
    })
    expect(useTaskHistoryStore.getState().deletedRecords).toEqual(['copy:other'])
    expect(screen.getByRole('region', { name: '批量任务进度' })).toHaveTextContent(status === 'completed' ? '已结束' : '失败')
    expect(screen.getByRole('row', { name: /正常关闭/ })).toHaveTextContent(status === 'completed' ? '成功 2' : '失败 1')
    expect(batch.retry).toHaveBeenCalledOnce()
  })
  it('preserves deletion markers when retry admission fails', async () => {
    Object.assign(window.xapi, { batch: { retry: vi.fn().mockRejectedValue(new Error('重试未受理')) }, onBatchProgress: vi.fn(() => vi.fn()) })
    useBatchStore.setState({ retryTask, unsubscribeProgress: null })
    useTaskHistoryStore.getState().deleteRecord(`batch:${task.id}`)
    await expect(retryTask(task.id, { requestId: 'retry', items: [{ id: failed.id, retryCount: failed.retryCount }] })).rejects.toThrow('重试未受理')
    expect(useTaskHistoryStore.getState().deletedRecords).toEqual([`batch:${task.id}`])
  })
  it('keeps cancellation pending without presenting unknown or cancelled items as success', () => {
    useBatchStore.setState({ activeTask: { ...task, status: 'cancel-requested', progress: { total: 3, completed: 2, failed: 0, unknown: 1, cancelled: 1 } } })
    render(<BatchProgressDialog />)
    expect(screen.getByRole('status')).toHaveTextContent('正在取消')
    expect(screen.getByText('成功 0')).toBeInTheDocument()
    expect(screen.getByText(/等待已开始的操作返回/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '停止后续操作' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '查看全部批量任务' })).toHaveAttribute('href', '#/batch-tasks')
  })

  it('keeps concrete read errors until its local record is deleted', () => {
    useBatchStore.setState({ activeTask: task })
    render(<BatchProgressDialog />)
    expect(screen.getByRole('status')).toHaveTextContent('读取结果失败')
    expect(screen.getByText('读取失败 1')).toBeInTheDocument()
    expect(screen.getByText('响应丢失，请核对服务器')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '删除记录' }))
    expect(screen.queryByRole('region', { name: '批量任务进度' })).not.toBeInTheDocument()
    expect(useBatchStore.getState().taskHistory).toEqual([task])
  })

  it('keeps polling other active tasks while a finished result is displayed', async () => {
    vi.useFakeTimers()
    const refreshTasks = vi.fn().mockResolvedValue(undefined)
    useBatchStore.setState({ activeTask: task, activeTasks: [{ ...task, id: 'background', status: 'running' }], refreshTasks })
    const view = render(<BatchProgressDialog />)
    try {
      await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
      expect(refreshTasks).toHaveBeenCalledTimes(2)
      expect(screen.getAllByRole('status')[0]).toHaveTextContent('读取结果失败')
    } finally { view.unmount(); vi.clearAllTimers(); vi.useRealTimers() }
  })
})
