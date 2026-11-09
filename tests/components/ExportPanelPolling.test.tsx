import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ExportPanel } from '../../src/renderer/src/components/export/ExportPanel'
import { useFeedbackStore } from '../../src/renderer/src/store/feedback.store'
import { ToastProvider } from '../../src/renderer/src/components/toast/ToastProvider'
import { type ExportTask, useExportPanelStore } from '../../src/renderer/src/store/exportPanel.store'
import type { VmTransferProgress } from '../../src/shared/types/xapi'

const task: ExportTask = {
  exportId: 'export-1', vmName: 'Contract VM', connectionId: 'pool',
  status: 'running', progress: 0, bytesTransferred: 0, bytesTotal: 100,
  message: 'Exporting...', filePath: '/tmp/contract.xva', startedAt: 1,
}
const progress: VmTransferProgress = {
  taskId: task.exportId, status: 'running', progress: 10, bytesTransferred: 10,
  message: 'Exporting...', lastUpdatedAt: 1,
}
const deferred = () => {
  let resolve!: (value: VmTransferProgress) => void
  const promise = new Promise<VmTransferProgress>((done) => { resolve = done })
  return { promise, resolve }
}

beforeEach(() => {
  vi.useFakeTimers()
  useFeedbackStore.setState({ toasts: [] })
  useExportPanelStore.setState({ tasks: [task], })
  Object.assign(window.xapi, { vm: { exportProgress: vi.fn() } })
})

afterEach(() => {
  cleanup()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
  useExportPanelStore.setState({ tasks: [] })
})

it('waits a second between export progress reads across task and toast renders, then stops at completion', async () => {
  const second = deferred()
  vi.mocked(window.xapi.vm.exportProgress)
    .mockResolvedValueOnce(progress)
    .mockReturnValueOnce(second.promise)
    .mockResolvedValueOnce({ ...progress, status: 'completed', progress: 100 })

  await act(async () => { render(<ToastProvider><ExportPanel /></ToastProvider>) })
  expect(window.xapi.vm.exportProgress).toHaveBeenCalledOnce()
  act(() => useExportPanelStore.getState().updateTask(task.exportId, { message: '重新渲染' }))
  await act(async () => { await vi.advanceTimersByTimeAsync(999) })
  expect(window.xapi.vm.exportProgress).toHaveBeenCalledOnce()
  await act(async () => { await vi.advanceTimersByTimeAsync(1) })
  expect(window.xapi.vm.exportProgress).toHaveBeenCalledTimes(2)
  await act(async () => second.resolve({ ...progress, progress: 50 }))
  expect(window.xapi.vm.exportProgress).toHaveBeenCalledTimes(2)
  await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
  expect(useExportPanelStore.getState().tasks[0].status).toBe('completed')
  expect(useFeedbackStore.getState().toasts).toContainEqual(expect.objectContaining({ message: '"Contract VM" 导出完成' }))
  await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
  expect(window.xapi.vm.exportProgress).toHaveBeenCalledTimes(3)
})

it('keeps slow export reads serial and ignores a read that completes after unmount', async () => {
  const first = deferred()
  const second = deferred()
  vi.mocked(window.xapi.vm.exportProgress).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
  const view = render(<ToastProvider><ExportPanel /></ToastProvider>)
  await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
  expect(window.xapi.vm.exportProgress).toHaveBeenCalledOnce()
  await act(async () => first.resolve(progress))
  expect(window.xapi.vm.exportProgress).toHaveBeenCalledOnce()
  await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
  expect(window.xapi.vm.exportProgress).toHaveBeenCalledTimes(2)
  view.unmount()
  await act(async () => second.resolve({ ...progress, status: 'completed', progress: 100 }))
  await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
  expect(window.xapi.vm.exportProgress).toHaveBeenCalledTimes(2)
  expect(useExportPanelStore.getState().tasks[0]).toMatchObject({ status: 'running', progress: 10 })
})

it('keeps observing unknown exports with backoff and retains cancellation', async () => {
  vi.mocked(window.xapi.vm.exportProgress)
    .mockResolvedValueOnce({ ...progress, status: 'unknown', message: '读取中断' })
    .mockResolvedValue({ ...progress, status: 'completed', progress: 100 })
  await act(async () => { render(<ToastProvider><ExportPanel /></ToastProvider>) })
  expect(screen.getByTitle('取消导出')).toBeInTheDocument()
  expect(screen.queryByTitle('移除')).not.toBeInTheDocument()
  await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
  expect(useExportPanelStore.getState().tasks[0].status).toBe('completed')
})

it('waits for cleanup before notifying completion and displays structured warnings', async () => {
  vi.mocked(window.xapi.vm.exportProgress)
    .mockResolvedValueOnce({ ...progress, status: 'completed', cleanupPending: true, progress: 100 })
    .mockResolvedValue({ ...progress, status: 'completed', cleanupPending: false, progress: 100, bytesTransferred: 42, bytesTotal: 42, warnings: ['任务记录清理失败'] })
  await act(async () => { render(<ToastProvider><ExportPanel /></ToastProvider>) })
  expect(useExportPanelStore.getState().tasks[0].status).toBe('running')
  expect(screen.queryByText('"Contract VM" 导出完成')).not.toBeInTheDocument()
  await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
  expect(useExportPanelStore.getState().tasks[0]).toMatchObject({ status: 'completed', bytesTransferred: 42 })
  expect(screen.getByText('任务记录清理失败')).toBeInTheDocument()
})

it('shows measured download speed without an estimated percentage, then shows real validation progress', async () => {
  const transfer = { bytesTransferred: 512 * 1024 ** 2, bytesTotal: 0, elapsedMs: 4000 }
  vi.mocked(window.xapi.vm.exportProgress)
    .mockResolvedValueOnce({ ...progress, phase: 'transferring', progress: -1, bytesTransferred: transfer.bytesTransferred, bytesTotal: 0, transfer, message: '正在下载 XVA' })
    .mockResolvedValueOnce({ ...progress, phase: 'validating', progress: 25, validation: { bytesChecked: 256 * 1024 ** 2, bytesTotal: 1024 ** 3, elapsedMs: 2000 }, message: '正在校验下载的 XVA' })
    .mockResolvedValue({ ...progress, phase: 'waiting_for_task', progress: -1, message: '等待资源池任务确认' })
  await act(async () => { render(<ToastProvider><ExportPanel /></ToastProvider>) })
  expect(useExportPanelStore.getState().tasks[0].bytesTotal).toBe(0)
  expect(screen.getByRole('progressbar', { name: 'XVA 下载进度' })).not.toHaveAttribute('aria-valuenow')
  expect(screen.getByText('平均速度 128 MB/s')).toBeInTheDocument()
  expect(screen.getByText(/已接收 512 MB · 总大小未知/)).toBeInTheDocument()
  await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
  expect(screen.getByRole('progressbar', { name: 'XVA 导出校验进度' })).toHaveAttribute('aria-valuenow', '25')
  expect(screen.getByText('已检查 256 MB / 1 GB · 已用 2 秒')).toBeInTheDocument()
  await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
  expect(screen.getByText('等待资源池任务确认')).toBeInTheDocument()
  expect(screen.queryByText(/平均速度/)).not.toBeInTheDocument()
})

it('stops reading a missing local export record and removes it without cancelling a server task', async () => {
  window.xapi.vm.cancelExport = vi.fn()
  vi.mocked(window.xapi.vm.exportProgress).mockResolvedValue(null)
  await act(async () => { render(<ToastProvider><ExportPanel /></ToastProvider>) })
  expect(useExportPanelStore.getState().tasks[0]).toMatchObject({ status: 'unknown', recordMissing: true })
  expect(useExportPanelStore.getState().getActiveTasks()).toEqual([])
  expect(screen.getByText(/本地导出记录已不存在/)).toBeInTheDocument()
  expect(screen.queryByTitle('取消导出')).not.toBeInTheDocument()
  await act(async () => { await vi.advanceTimersByTimeAsync(30000) })
  expect(window.xapi.vm.exportProgress).toHaveBeenCalledOnce()
  await act(async () => { await useExportPanelStore.persist.rehydrate() })
  expect(useExportPanelStore.getState().tasks[0].message).toContain('本地导出记录已不存在')
  act(() => useExportPanelStore.getState().clearCompleted())
  await act(async () => { await useExportPanelStore.persist.rehydrate() })
  expect(useExportPanelStore.getState().tasks).toEqual([])
  expect(window.xapi.vm.cancelExport).not.toHaveBeenCalled()
})

it('recovers a progress IPC read failure without classifying the local record as missing', async () => {
  vi.mocked(window.xapi.vm.exportProgress).mockRejectedValueOnce(new Error('IPC temporarily unavailable')).mockResolvedValue(progress)
  await act(async () => { render(<ToastProvider><ExportPanel /></ToastProvider>) })
  await act(async () => { await vi.advanceTimersByTimeAsync(500) })
  expect(useExportPanelStore.getState().tasks[0]).toMatchObject({ status: 'running', progress: 10 })
  expect(useExportPanelStore.getState().tasks[0].recordMissing).toBeUndefined()
  expect(window.xapi.vm.exportProgress).toHaveBeenCalledTimes(2)
})
