// These assertions reproduce current defects; passing does not mean the defects are fixed.
import { beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { BatchToolbar } from '../../../../src/renderer/src/components/batch/BatchToolbar'
import BatchHistoryPage from '../../../../src/renderer/src/pages/BatchHistoryPage'
import { useBatchStore } from '../../../../src/renderer/src/store/batch.store'
import { useMultiDataStore } from '../../../../src/renderer/src/store/multiData.store'

vi.mock('../../../../src/renderer/src/components/toast/useToast', () => ({ useToast: () => ({ error: vi.fn(), info: vi.fn() }) }))
const target = { connectionId: 'pool', vmRef: 'OpaqueRef:vm', vmName: 'VM' }
const base = { id: 'failed-force-stop', type: 'stop' as const, targets: [target], options: { force: true }, status: 'completed' as const, progress: { total: 1, completed: 1, failed: 1 }, results: [], createdAt: 1 }
const submitTask = vi.fn().mockResolvedValue('new-task')
const retryTask = vi.fn().mockResolvedValue(undefined)

beforeEach(() => {
  vi.clearAllMocks()
  useBatchStore.setState({ selectedVms: [target], activeTask: null, taskHistory: [], isLoading: false, error: null, submitTask, retryTask, refreshTasks: vi.fn().mockResolvedValue(undefined), loadTaskDetails: vi.fn().mockResolvedValue(undefined) })
  useMultiDataStore.setState({ hosts: [] })
})

it('reproduces enabled action buttons while the first submission is loading', () => {
  useBatchStore.setState({ isLoading: true })
  render(<BatchToolbar />)
  const start = screen.getByRole('button', { name: '启动虚拟机' })
  expect(start).toBeEnabled()
  fireEvent.click(start)
  expect(submitTask).toHaveBeenCalledWith('start')
})

it('reproduces immediate force-stop retry without a target or force confirmation', () => {
  useBatchStore.setState({ taskHistory: [base] })
  render(<BatchHistoryPage />)
  fireEvent.click(screen.getByRole('button', { name: '重试明确失败项' }))
  expect(retryTask).toHaveBeenCalledWith(base.id)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.queryByText(/强制/)).not.toBeInTheDocument()
})

it('reproduces admission of a history retry while a different batch is still running', () => {
  useBatchStore.setState({ taskHistory: [base], activeTask: { ...base, id: 'other-running-task', status: 'running', progress: { total: 1, completed: 0, failed: 0 } } })
  render(<BatchHistoryPage />)
  const retry = screen.getByRole('button', { name: '重试明确失败项' })
  expect(retry).toBeEnabled()
  fireEvent.click(retry)
  expect(retryTask).toHaveBeenCalledWith(base.id)
})

it('reproduces absence of a cancellation control on the batch history page', () => {
  useBatchStore.setState({ activeTask: { ...base, status: 'running', progress: { total: 1, completed: 0, failed: 0 } } })
  render(<BatchHistoryPage />)
  expect(screen.queryByRole('button', { name: /停止后续|取消任务/ })).not.toBeInTheDocument()
})
