import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ImportTransferPanel } from '../../src/renderer/src/components/vm/ImportTransferPanel'
import { useImportWizardStore } from '../../src/renderer/src/store/importWizard.store'
import { useConnectionManagerStore } from '../../src/renderer/src/store/connectionManager.store'
import { useMultiDataStore } from '../../src/renderer/src/store/multiData.store'

const operation = { operationId: 'old-import', taskRef: 'OpaqueRef:task', status: 'unknown' as const, progress: 70, message: '等待原任务', lastUpdatedAt: 1 }
function Location() { return <output>{useLocation().pathname}</output> }
const renderPanel = () => render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><ImportTransferPanel /><Location /></MemoryRouter>)

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  useImportWizardStore.getState().reset()
  useImportWizardStore.setState({ history: [{ connectionId: 'original', poolUuid: 'pool-1', name: 'Original VM', isTemplate: false, operation }] })
  useConnectionManagerStore.setState({ connections: [{ id: 'original', poolUuid: 'pool-1', state: 'connected' }] as any })
  useMultiDataStore.setState({ refreshVms: vi.fn().mockResolvedValue(undefined) })
  window.xapi = { vm: { importProgress: vi.fn().mockResolvedValue(operation), cancelImport: vi.fn().mockResolvedValue(undefined) } } as any
})
afterEach(() => { vi.useRealTimers(); act(() => useImportWizardStore.getState().reset()) })

it('observes unreadable imports independently of a new draft and refreshes the rebound connection', async () => {
  useImportWizardStore.getState().newDraft()
  vi.mocked(window.xapi.vm.importProgress).mockResolvedValueOnce(operation).mockResolvedValue({ ...operation, status: 'completed', progress: 100, connectionId: 'reconnected', poolUuid: 'pool-1' })
  renderPanel()
  await act(async () => { await Promise.resolve() })
  expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
  await act(async () => { await vi.advanceTimersByTimeAsync(9999) })
  expect(window.xapi.vm.importProgress).toHaveBeenCalledTimes(1)
  await act(async () => { await vi.advanceTimersByTimeAsync(1) })
  expect(window.xapi.vm.importProgress).toHaveBeenCalledTimes(2)
  expect(useImportWizardStore.getState()).toMatchObject({ operationId: null, history: [expect.objectContaining({ connectionId: 'reconnected', operation: expect.objectContaining({ status: 'completed' }) })] })
  expect(useMultiDataStore.getState().refreshVms).toHaveBeenCalledWith({ afterMutation: true, connectionId: 'reconnected' })
})

it('shows a static read-status message while the original task cannot be read', async () => {
  renderPanel()
  await act(async () => { await Promise.resolve() })
  expect(screen.getByText('等待原任务')).toHaveAttribute('role', 'status')
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  expect(window.xapi.vm.importProgress).toHaveBeenCalledOnce()
})

it('only opens an imported object in its confirmed original pool', async () => {
  const completed = { ...operation, status: 'completed' as const, vmRef: 'OpaqueRef:imported-vm' }
  useImportWizardStore.setState({ history: [{ connectionId: 'original', poolUuid: 'pool-1', name: 'VM', isTemplate: false, operation: completed }] })
  useConnectionManagerStore.setState({ connections: [{ id: 'original', poolUuid: 'pool-2', state: 'connected' }] as any })
  renderPanel()
  expect(screen.getByText('查看已导入对象')).toBeDisabled()
  act(() => useConnectionManagerStore.setState({ connections: [{ id: 'original', poolUuid: 'pool-1', state: 'connected' }] as any }))
  act(() => useImportWizardStore.setState({ history: [{ connectionId: 'original', name: 'VM', isTemplate: false, operation: completed }] }))
  expect(screen.getByText('查看已导入对象')).toBeDisabled()
  act(() => useImportWizardStore.setState({ history: [{ connectionId: 'original', poolUuid: 'pool-1', name: 'VM', isTemplate: false, operation: completed }] }))
  fireEvent.click(screen.getByText('查看已导入对象'))
  expect(screen.getByText('/pool/original/vms/OpaqueRef%3Aimported-vm')).toBeInTheDocument()
})

it('cancels the original unreadable operation and keeps it tracked', async () => {
  renderPanel()
  await act(async () => { await Promise.resolve() })
  fireEvent.click(screen.getByText('取消导入'))
  expect(window.xapi.vm.cancelImport).toHaveBeenCalledWith('original', 'old-import')
  await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
  expect(window.xapi.vm.importProgress).toHaveBeenCalledTimes(2)
  expect(useImportWizardStore.getState().history).toHaveLength(1)
})

it('leaves polling of the current open dialog operation to the dialog', async () => {
  useImportWizardStore.setState({ operationId: operation.operationId, dialogOpen: true })
  renderPanel()
  await act(async () => { await vi.advanceTimersByTimeAsync(11000) })
  expect(window.xapi.vm.importProgress).not.toHaveBeenCalled()
})

it('shows validation progress for an import running outside the dialog', async () => {
  const validating = { ...operation, status: 'validating' as const, progress: 0, message: '正在校验 XVA，完成后开始上传', validation: { bytesChecked: 512 * 1024 ** 2, bytesTotal: 1024 ** 3, elapsedMs: 9000 } }
  vi.mocked(window.xapi.vm.importProgress).mockResolvedValue(validating)
  renderPanel()
  await act(async () => { await Promise.resolve() })
  expect(screen.getByRole('progressbar', { name: 'XVA 校验进度' })).toHaveAttribute('aria-valuenow', '50')
  expect(screen.getByText('已检查 512 MB / 1 GB · 已用 9 秒')).toBeInTheDocument()
  expect(screen.getByText('取消导入')).toBeEnabled()
})

it('removes a finished current import together with its wizard reference and does not resurrect it on restart', async () => {
  const failed = { ...operation, status: 'failed' as const }
  useImportWizardStore.setState({ operationId: failed.operationId, operationStatus: 'failed', history: [{ connectionId: 'original', name: 'VM', isTemplate: false, operation: failed }] })
  renderPanel()
  fireEvent.click(document.querySelector('summary')!)
  fireEvent.click(screen.getByRole('button', { name: '移除记录' }))
  expect(useImportWizardStore.getState()).toMatchObject({ operationId: null, operationStatus: null, currentStep: 1, history: [] })
  await act(async () => { await useImportWizardStore.persist.rehydrate() })
  expect(useImportWizardStore.getState().history).toEqual([])
  expect(useImportWizardStore.getState().operationId).toBeNull()
  expect(window.xapi.vm.cancelImport).not.toHaveBeenCalled()
})

it('stops polling and allows removal when the main process has no original import record', async () => {
  vi.mocked(window.xapi.vm.importProgress).mockResolvedValue(null)
  renderPanel()
  await act(async () => { await Promise.resolve() })
  expect(useImportWizardStore.getState().history[0]).toMatchObject({ recordMissing: true, operation: { status: 'unknown' } })
  expect(screen.queryByText('取消导入')).not.toBeInTheDocument()
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  expect(screen.getByText(/本地导入记录已不存在/)).toBeInTheDocument()
  await act(async () => { await vi.advanceTimersByTimeAsync(30000) })
  expect(window.xapi.vm.importProgress).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole('button', { name: '移除记录' }))
  expect(useImportWizardStore.getState().history).toEqual([])
  expect(window.xapi.vm.cancelImport).not.toHaveBeenCalled()
})
