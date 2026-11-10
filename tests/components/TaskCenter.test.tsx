import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AppearanceMenu } from '../../src/renderer/src/components/layout/AppearanceMenu'
import TaskHistoryPage from '../../src/renderer/src/pages/TaskHistoryPage'
import TopBar from '../../src/renderer/src/components/layout/TopBar'
import TasksPage, { useTaskCancellationStore } from '../../src/renderer/src/pages/TasksPage'
import { useFeedbackStore } from '../../src/renderer/src/store/feedback.store'
import { useBatchStore } from '../../src/renderer/src/store/batch.store'
import { useCopyStore } from '../../src/renderer/src/store/copy.store'
import { useExportPanelStore } from '../../src/renderer/src/store/exportPanel.store'
import { useImportWizardStore } from '../../src/renderer/src/store/importWizard.store'
import { useMultiDataStore } from '../../src/renderer/src/store/multiData.store'
import { useConnectionManagerStore } from '../../src/renderer/src/store/connectionManager.store'
import { useTaskHistoryStore } from '../../src/renderer/src/store/taskHistory.store'
import { copyOperation } from '../helpers/vm-copy-fixtures'

const future = { v7_startTransition: true, v7_relativeSplatPath: true } as const
const imported = { operationId: 'import', taskRef: null, status: 'pending' as const, progress: 10, message: '正在上传', lastUpdatedAt: 1 }
const exported = { exportId: 'export', vmName: 'Export VM', connectionId: 'pool', status: 'running' as const, progress: 30, bytesTransferred: 30, bytesTotal: 100, message: '正在下载', filePath: '/tmp/vm.xva', startedAt: 1 }
const batch = { id: 'batch', type: 'start' as const, targets: [{ connectionId: 'pool', vmRef: 'vm', vmName: 'Batch VM' }], status: 'running' as const, progress: { total: 1, completed: 0, failed: 0 }, results: [], createdAt: 1 }
const server = { ref: 'task', uuid: 'server-task-uuid', connectionId: 'pool', poolName: 'Pool', name_label: 'Server VM', name_description: '', status: 'pending' as const, progress: 0.4, created: '', finished: '', error_info: [] }
const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
const renderCenter = (children?: React.ReactNode) => render(<MemoryRouter future={future}><TopBar />{children}</MemoryRouter>)
const open = () => {
  fireEvent.click(screen.getByRole('button', { name: /任务通知/ }))
  return screen.getByRole('complementary', { name: '任务通知' })
}

beforeEach(() => {
  vi.useFakeTimers()
  useTaskHistoryStore.setState({ deletedRecords: [] })
  useTaskCancellationStore.setState({ cancellations: {} })
  useConnectionManagerStore.setState({ connections: [{ id: 'pool', poolUuid: 'pool-uuid', name: 'Pool', poolName: 'Pool', state: 'connected', epoch: 1, connectedAt: 1 }] as any })
  useFeedbackStore.setState({ progress: [], toasts: [], confirmDialog: null })
  useCopyStore.setState({ operations: [] })
  useImportWizardStore.getState().reset()
  useImportWizardStore.setState({ history: [] })
  useExportPanelStore.setState({ tasks: [] })
  useBatchStore.setState({ activeTask: null, activeTasks: [], taskHistory: [], error: null, pendingTaskIds: [], refreshTasks: vi.fn().mockResolvedValue(undefined), cancelTask: vi.fn().mockResolvedValue(undefined) })
  useMultiDataStore.setState({ tasks: [], domainStates: {}, refreshTasks: vi.fn().mockResolvedValue(undefined) })
  window.xapi = { vm: { copyOperations: vi.fn().mockResolvedValue([]), importProgress: vi.fn().mockResolvedValue(imported), exportProgress: vi.fn().mockResolvedValue({ ...exported, taskId: exported.exportId, lastUpdatedAt: 1 }), cancelImport: vi.fn(), cancelCopy: vi.fn(), cancelExport: vi.fn() }, tasks: { cancel: vi.fn() } } as any
})
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })

it('starts collapsed and stays collapsed through admission and completion while observers continue', async () => {
  renderCenter()
  const trigger = screen.getByRole('button', { name: '任务通知' })
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
  act(() => {
    useExportPanelStore.getState().addTask(exported)
    useFeedbackStore.getState().startProgress('action', '普通任务')
  })
  await act(async () => { await Promise.resolve() })
  expect(window.xapi.vm.exportProgress).toHaveBeenCalledOnce()
  act(() => useFeedbackStore.getState().completeProgress('action'))
  await act(async () => { await vi.advanceTimersByTimeAsync(4000) })
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
  expect(useFeedbackStore.getState().progress[0].status).toBe('completed')
  expect(window.xapi.vm.exportProgress).toHaveBeenCalledTimes(5)
  const panel = open()
  expect(within(panel).getByText('普通任务')).not.toBeVisible()
  fireEvent.click(within(panel).getByRole('region', { name: '普通操作' }).querySelector('summary')!)
  expect(within(panel).getByText('普通任务')).toBeVisible()
  expect(within(panel).getByText('Export VM')).toBeVisible()
})

it('shows every progress category in one top-right panel without nested floating panels', async () => {
  useFeedbackStore.getState().startProgress('action', '普通任务', 20)
  useBatchStore.setState({ activeTask: batch, activeTasks: [batch] })
  useImportWizardStore.setState({ history: [{ connectionId: 'pool', name: 'Import VM', isTemplate: false, operation: imported }] })
  useExportPanelStore.setState({ tasks: [exported] })
  vi.mocked(window.xapi.vm.copyOperations).mockResolvedValue([{ ...copyOperation, status: 'pending', cancellable: true }])
  useMultiDataStore.setState({ tasks: [server] })
  renderCenter()
  await act(async () => { await Promise.resolve() })
  const panel = open()
  for (const label of ['普通操作', '批量任务', '导入任务 (1)', '导出任务 (1)', '复制任务 (1)', '服务器任务']) {
    expect(within(panel).getByRole('heading', { name: label })).toBeVisible()
  }
  expect(panel).toHaveClass('absolute', 'right-0', 'top-full')
  expect(panel.className).toContain('top-')
  expect(panel.querySelector('.fixed')).toBeNull()
  expect(within(panel).getByRole('button', { name: '停止后续操作' })).toBeEnabled()
  expect(within(panel).getByRole('button', { name: '取消导入' })).toBeEnabled()
  expect(within(panel).getByRole('button', { name: '请求取消' })).toBeEnabled()
  expect(within(panel).getByRole('button', { name: '取消任务' })).toBeEnabled()
})

it('keeps import and copy cancellation single-submit and preserves an already confirmed copy result', async () => {
  const cancelImport = deferred<void>(), cancelCopy = deferred<any>()
  vi.mocked(window.xapi.vm.cancelImport).mockReturnValue(cancelImport.promise)
  vi.mocked(window.xapi.vm.cancelCopy).mockReturnValue(cancelCopy.promise)
  useImportWizardStore.setState({ history: [{ connectionId: 'pool', name: 'Import VM', isTemplate: false, operation: imported }] })
  vi.mocked(window.xapi.vm.copyOperations).mockResolvedValue([{ ...copyOperation, status: 'pending', cancellable: true }])
  renderCenter(<TaskHistoryPage />)
  await act(async () => { await Promise.resolve() })
  expect(window.xapi.vm.copyOperations).toHaveBeenCalledTimes(2)
  expect(window.xapi.vm.importProgress).toHaveBeenCalledOnce()
  const panel = open()
  for (const name of ['取消导入', '请求取消']) {
    const button = within(panel).getByRole('button', { name })
    fireEvent.click(button); fireEvent.click(button)
    expect(button).toBeDisabled()
    expect(screen.getAllByRole('button', { name: '正在请求取消…' }).every((item) => item.hasAttribute('disabled'))).toBe(true)
  }
  expect(window.xapi.vm.cancelImport).toHaveBeenCalledOnce()
  expect(window.xapi.vm.cancelCopy).toHaveBeenCalledOnce()
  act(() => useCopyStore.getState().accept({ ...copyOperation, status: 'completed', progress: 100 }))
  await act(async () => { cancelCopy.resolve({ ...copyOperation, status: 'cancelling' }); cancelImport.resolve() })
  expect(useCopyStore.getState().operations[0].status).toBe('completed')
})

it('shares server cancellation with the full task page and keeps observing while folded', async () => {
  const cancelled = deferred<any>()
  vi.mocked(window.xapi.tasks.cancel).mockReturnValue(cancelled.promise)
  useMultiDataStore.setState({ tasks: [server] })
  renderCenter(<TasksPage />)
  const panel = open()
  fireEvent.click(within(panel).getByRole('button', { name: '取消任务' }))
  fireEvent.click(screen.getByRole('button', { name: 'Cancel Server VM' }))
  expect(window.xapi.tasks.cancel).toHaveBeenCalledOnce()
  fireEvent.click(within(panel).getByRole('button', { name: '收起任务通知' }))
  await act(async () => cancelled.resolve({ status: 'cancelled', message: '服务器已确认取消' }))
  expect(within(open()).getByRole('status')).toHaveTextContent('服务器已确认取消')
})

it('deletes terminal history locally and keeps it deleted after polling, list refresh and reload', async () => {
  useFeedbackStore.getState().startProgress('action', '普通任务')
  useFeedbackStore.getState().completeProgress('action')
  useBatchStore.setState({ activeTask: { ...batch, status: 'completed' }, taskHistory: [{ ...batch, status: 'completed' }] })
  const copied = { ...copyOperation, status: 'completed' as const, progress: 100 }
  vi.mocked(window.xapi.vm.copyOperations).mockResolvedValue([copied])
  useImportWizardStore.setState({ history: [{ connectionId: 'pool', name: 'Import VM', isTemplate: false, operation: { ...imported, status: 'completed' } }] })
  useExportPanelStore.setState({ tasks: [{ ...exported, status: 'completed' }] })
  useMultiDataStore.setState({ tasks: [{ ...server, status: 'success' }] })
  renderCenter()
  await act(async () => { await Promise.resolve() })
  const panel = open()
  for (const section of ['普通操作', '批量任务进度', '导入任务', '导出任务', '复制任务', '服务器任务']) {
    const region = within(panel).getByRole('region', { name: section })
    const history = region.querySelector('details')!
    expect(history).not.toHaveAttribute('open')
    expect(within(region).getByRole('button', { name: /^(删除记录|移除记录|移除本地导出记录|关闭已完成操作)$/ })).not.toBeVisible()
    fireEvent.click(history.querySelector('summary')!)
    fireEvent.click(within(region).getByRole('button', { name: /^(删除记录|移除记录|移除本地导出记录|关闭已完成操作)$/ }))
  }
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10000)
    await useTaskHistoryStore.persist.rehydrate()
    await useExportPanelStore.persist.rehydrate()
    await useImportWizardStore.persist.rehydrate()
  })
  for (const name of ['普通任务', 'Import VM', 'Export VM', 'Server VM']) expect(within(panel).queryByText(name)).not.toBeInTheDocument()
  expect(within(panel).queryByRole('region', { name: '复制任务' })).not.toBeInTheDocument()
  expect(within(panel).queryByRole('region', { name: '批量任务进度' })).not.toBeInTheDocument()
  expect(useCopyStore.getState().operations).toHaveLength(1)
  expect(window.xapi.vm.cancelCopy).not.toHaveBeenCalled()
  expect(window.xapi.tasks.cancel).not.toHaveBeenCalled()
})

it('never deletes live operations and re-shows a retried batch even after its old history was removed', async () => {
  useFeedbackStore.getState().startProgress('live', '执行中任务')
  useFeedbackStore.getState().removeProgress('live')
  useExportPanelStore.getState().addTask(exported)
  useExportPanelStore.getState().removeTask(exported.exportId)
  useTaskHistoryStore.getState().deleteRecord(`batch:${batch.id}`)
  useBatchStore.setState({ activeTask: batch, activeTasks: [batch] })
  renderCenter()
  await act(async () => { await Promise.resolve() })
  const panel = open()
  expect(within(panel).getByText('执行中任务')).toBeVisible()
  expect(within(panel).getByText('Export VM')).toBeVisible()
  expect(within(panel).getByText(/批量启动 · Batch VM/)).toBeVisible()
  expect(within(panel).queryByRole('button', { name: /删除记录|关闭已完成操作/ })).not.toBeInTheDocument()
})

it('closes with Escape and outside clicks, returns focus, and keeps appearance controls usable', async () => {
  renderCenter(<AppearanceMenu />)
  await act(async () => { await Promise.resolve() })
  const panel = open()
  expect(panel).toHaveFocus()
  fireEvent.keyDown(panel, { key: 'Escape' })
  expect(screen.getByRole('button', { name: '任务通知' })).toHaveFocus()
  open()
  fireEvent.pointerDown(document.body)
  expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
  open()
  fireEvent.click(screen.getByRole('button', { name: '外观' }))
  fireEvent.click(screen.getByRole('menuitemradio', { name: '深色' }))
  expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
})


it('shows the empty operation history and uses the URL for task categories', async () => {
  renderCenter(<TaskHistoryPage />)
  await act(async () => { await Promise.resolve() })
  expect(screen.getByText('暂无操作记录')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '服务器任务' }))
  expect(screen.getByRole('button', { name: '服务器任务' })).toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(screen.getByRole('button', { name: '批量任务' }))
  expect(screen.getByText('没有批量任务历史')).toBeVisible()
  expect(useBatchStore.getState().refreshTasks).toHaveBeenCalledOnce()
  expect(useMultiDataStore.getState().refreshTasks).toHaveBeenCalledOnce()
})
