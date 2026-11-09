import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import { CopyTaskPanel } from '../../src/renderer/src/components/vm/CopyTaskPanel'
import { useCopyStore } from '../../src/renderer/src/store/copy.store'
import { useMultiDataStore } from '../../src/renderer/src/store/multiData.store'
import { useConnectionManagerStore } from '../../src/renderer/src/store/connectionManager.store'
import { copyOperation } from '../helpers/vm-copy-fixtures'
function Location() { const location = useLocation(); return <output>{location.pathname}{location.search}</output> }
beforeEach(() => {
  useCopyStore.setState({ operations: [] })
  useConnectionManagerStore.setState({ connections: [{ id: 'pool-1', poolUuid: 'pool-uuid-1', state: 'connected' }] as any })
  Object.assign(window.xapi, { vm: { copyOperations: vi.fn().mockResolvedValue([{ ...copyOperation, status: 'pending', progress: 25, taskRef: 'OpaqueRef:task', cancellable: true }]), cancelCopy: vi.fn().mockResolvedValue({ ...copyOperation, status: 'cancelling' }) } })
})
it('restores background history and exposes cancellation only when the server permits it', async () => {
  render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><CopyTaskPanel /></MemoryRouter>)
  expect(await screen.findByText(/25%/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '请求取消' }))
  await waitFor(() => expect(window.xapi.vm.cancelCopy).toHaveBeenCalledWith(copyOperation.id))
})
it('refreshes only the destination after confirmation and locates the copy', async () => {
  useCopyStore.setState({ operations: [copyOperation] })
  const refresh = vi.fn().mockResolvedValue(undefined); useMultiDataStore.setState({ refreshVms: refresh })
  vi.mocked(window.xapi.vm.copyOperations).mockResolvedValue([{ ...copyOperation, status: 'completed', vmRef: 'OpaqueRef:new', vmUuid: 'new-uuid', progress: 100 }])
  render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><CopyTaskPanel /><Location /></MemoryRouter>)
  await screen.findByText('已结束（1）')
  fireEvent.click(document.querySelector('summary')!)
  fireEvent.click(screen.getByRole('button', { name: '查看副本' }))
  expect(refresh).toHaveBeenCalledWith({ connectionId: 'pool-1', afterMutation: true })
  expect(screen.getByText('正在提交复制任务').parentElement).toHaveTextContent('100%')
  expect(screen.getByText('/pool/pool-1/vms/OpaqueRef%3Anew')).toBeInTheDocument()
})
it('keeps an unreadable operation tracked without exposing unsupported cancellation', async () => {
  vi.mocked(window.xapi.vm.copyOperations).mockResolvedValue([{ ...copyOperation, status: 'unknown', message: '原任务读取失败' }])
  render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><CopyTaskPanel /></MemoryRouter>)
  expect(await screen.findByText('原任务读取失败')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '请求取消' })).not.toBeInTheDocument()
  await act(async () => {})
})
it('blocks a reused connection ID and locates a completed copy through the original pool UUID', async () => {
  useCopyStore.setState({ operations: [copyOperation] })
  const refresh = vi.fn(); useMultiDataStore.setState({ refreshVms: refresh })
  useConnectionManagerStore.setState({ connections: [{ id: 'pool-1', poolUuid: 'different-pool', state: 'connected' }] as any })
  vi.mocked(window.xapi.vm.copyOperations).mockResolvedValue([{ ...copyOperation, status: 'completed', vmRef: 'OpaqueRef:new', vmUuid: 'new-uuid', progress: 100 }])
  render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><CopyTaskPanel /><Location /></MemoryRouter>)
  await screen.findByText('已结束（1）')
  fireEvent.click(document.querySelector('summary')!)
  expect(screen.getByRole('button', { name: '查看副本' })).toBeDisabled()
  expect(refresh).not.toHaveBeenCalled()
  act(() => useConnectionManagerStore.setState({ connections: [{ id: 'reconnected', poolUuid: 'pool-uuid-1', state: 'connected' }] as any }))
  fireEvent.click(screen.getByRole('button', { name: '查看副本' }))
  expect(screen.getByText('/pool/reconnected/vms/OpaqueRef%3Anew')).toBeInTheDocument()
  await act(async () => {})
})
