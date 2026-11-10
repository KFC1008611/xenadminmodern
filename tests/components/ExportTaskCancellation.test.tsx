import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ExportPanel } from '../../src/renderer/src/components/export/ExportPanel'
import { ExportTaskItem } from '../../src/renderer/src/components/export/ExportTaskItem'
import {
  type ExportTask,
  useExportPanelStore,
} from '../../src/renderer/src/store/exportPanel.store'

vi.mock('../../src/renderer/src/components/toast/useToast', () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
  }),
}))

const runningTask: ExportTask = {
  exportId: 'export-1',
  vmName: 'Contract VM',
  connectionId: 'connection-1',
  progress: 42,
  status: 'running',
  bytesTransferred: 42,
  bytesTotal: 100,
  message: 'Exporting...',
  filePath: '/tmp/contract.xva',
  startedAt: 1,
}

describe('export cancellation intent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useExportPanelStore.setState({
      tasks: [],
    })
    Object.assign(window.xapi, {
      vm: {
        cancelExport: vi.fn().mockResolvedValue(undefined),
        exportProgress: vi.fn().mockResolvedValue(null),
      },
    })
  })

  it('keeps cancelling exports in the active task set', () => {
    useExportPanelStore.setState({
      tasks: [{
        ...runningTask,
        status: 'cancelling',
        message: '正在等待资源池任务确认取消',
      }],
    })

    expect(useExportPanelStore.getState().getActiveTasks())
      .toEqual([expect.objectContaining({ exportId: 'export-1', status: 'cancelling' })])
  })

  it('shows cancellation as non-terminal until the resource pool task confirms it', async () => {
    vi.mocked(window.xapi.vm.exportProgress).mockResolvedValue({ taskId: runningTask.exportId, status: 'cancelling', progress: 42, message: '正在等待资源池任务确认取消', lastUpdatedAt: 1 })
    useExportPanelStore.setState({
      tasks: [runningTask],
    })
    render(<ExportPanel />)

    fireEvent.click(screen.getByTitle('取消导出'))

    await waitFor(() => {
      expect(window.xapi.vm.cancelExport).toHaveBeenCalledWith('connection-1', 'export-1')
      expect(useExportPanelStore.getState().tasks[0]).toMatchObject({
        status: 'cancelling',
        message: '正在等待资源池任务确认取消',
      })
    })

    expect(useExportPanelStore.getState().tasks[0].finishedAt).toBeUndefined()
    expect(screen.getByText('正在等待资源池任务确认取消')).toBeTruthy()
    expect(screen.queryByText('已取消')).toBeNull()
    expect(screen.queryByTitle('取消导出')).toBeNull()
    expect(screen.queryByTitle('移除')).toBeNull()
  })

  it('merges cancellation across two simultaneously rendered records', async () => {
    let finish!: () => void
    vi.mocked(window.xapi.vm.cancelExport).mockReturnValue(new Promise(resolve => { finish = resolve }))
    useExportPanelStore.setState({ tasks: [runningTask] })
    render(<><ExportTaskItem task={runningTask} /><ExportTaskItem task={runningTask} /></>)
    const controls = screen.getAllByTitle('取消导出')
    fireEvent.click(controls[0])
    fireEvent.click(controls[1])
    expect(window.xapi.vm.cancelExport).toHaveBeenCalledOnce()
    await act(async () => { finish() })
    expect(useExportPanelStore.getState().tasks[0].status).toBe('cancelling')
  })

  it('shows an export checkpoint cleanup warning after the file is complete', () => {
    render(<ExportTaskItem task={{
      ...runningTask,
      status: 'completed',
      progress: 100,
      message: 'Export completed；导出快照 OpaqueRef:checkpoint 未能清理',
    }} />)
    expect(screen.getByText(/导出快照 OpaqueRef:checkpoint 未能清理/)).toBeInTheDocument()
  })

  it('shows an indeterminate transfer without a negative percentage', () => {
    render(<ExportTaskItem task={{ ...runningTask, progress: -1, bytesTotal: 0 }} />)
    expect(screen.getByText(/传输中/)).toBeInTheDocument()
    expect(screen.queryByText(/-1%/)).not.toBeInTheDocument()
  })

  it.each(['completed', 'failed', 'cancelled'] as const)('retains a confirmed %s export when an earlier cancellation reply arrives', async (status) => {
    let finish!: () => void
    vi.mocked(window.xapi.vm.cancelExport).mockReturnValue(new Promise<void>((resolve) => { finish = resolve }))
    useExportPanelStore.setState({ tasks: [runningTask] })
    function CurrentTask() {
      const task = useExportPanelStore((state) => state.tasks[0])
      return <ExportTaskItem task={task} />
    }
    render(<CurrentTask />)
    fireEvent.click(screen.getByTitle('取消导出'))
    expect(useExportPanelStore.getState().tasks[0].status).toBe('cancelling')
    act(() => useExportPanelStore.getState().updateTask(runningTask.exportId, { status, message: '服务器终态', finishedAt: 123 }))
    await act(async () => { finish() })
    expect(useExportPanelStore.getState().tasks[0]).toMatchObject({ status, message: '服务器终态', finishedAt: 123 })
    expect(screen.getByTitle('移除')).toBeInTheDocument()
    act(() => useExportPanelStore.getState().updateTask(runningTask.exportId, { status: 'running', message: '旧进度' }))
    expect(useExportPanelStore.getState().tasks[0]).toMatchObject({ status, message: '服务器终态' })
  })

  it('does not attach a delayed cancellation error to an already completed export', async () => {
    let reject!: (error: Error) => void
    vi.mocked(window.xapi.vm.cancelExport).mockReturnValue(new Promise<void>((_resolve, fail) => { reject = fail }))
    useExportPanelStore.setState({ tasks: [runningTask] })
    render(<ExportTaskItem task={runningTask} />)
    fireEvent.click(screen.getByTitle('取消导出'))
    act(() => useExportPanelStore.getState().updateTask(runningTask.exportId, { status: 'completed' }))
    await act(async () => { reject(new Error('late cancellation error')) })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(useExportPanelStore.getState().tasks[0].status).toBe('completed')
  })
})
