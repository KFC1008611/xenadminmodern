import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BatchToolbar } from '../../src/renderer/src/components/batch/BatchToolbar'
import { useConnectionManagerStore } from '../../src/renderer/src/store/connectionManager.store'
import { useMultiDataStore } from '../../src/renderer/src/store/multiData.store'
import { useBatchStore } from '../../src/renderer/src/store/batch.store'
vi.mock('../../src/renderer/src/components/toast/useToast', () => ({ useToast: () => ({ error: vi.fn() }) }))
const target = { connectionId: 'conn-1', vmRef: 'OpaqueRef:vm', vmName: 'VM A', intent: { vmUuid: 'vm', poolUuid: 'pool', epoch: 1 } }
const submitTask = vi.fn().mockResolvedValue('task')
beforeEach(() => {
  vi.clearAllMocks()
  useConnectionManagerStore.setState({ connections: [{ id: 'conn-1', state: 'connected', poolUuid: 'pool', epoch: 1 }] as any })
  useMultiDataStore.setState({ vms: [{ ref: target.vmRef, uuid: 'vm', name_label: 'VM A', connectionId: 'conn-1', power_state: 'Halted', allowed_operations: ['start', 'destroy', 'snapshot', 'clean_shutdown', 'clean_reboot', 'suspend', 'resume', 'pause', 'unpause'] }] as any, domainStates: {} })
  useBatchStore.setState({ selectedVms: [target], selectionNotice: null, activeTask: null, activeTasks: [], isSubmitting: false, isLoading: false, error: null, submitTask, clearSelection: vi.fn() })
})
describe('batch operation prerequisites and confirmation', () => {
  it('offers nine operations and disables those incompatible with the selected VM state', () => {
    render(<BatchToolbar />)
    for (const label of ['启动', '创建快照', '删除']) expect(screen.getByRole('button', { name: label, exact: true })).toBeEnabled()
    for (const label of ['正常关闭', '正常重启', '挂起', '从挂起恢复', '暂停', '继续运行']) expect(screen.getByRole('button', { name: label, exact: true })).toBeDisabled()
    expect(screen.getByRole('button', { name: '正常关闭', exact: true })).toHaveAttribute('title', expect.stringContaining('VM A'))
  })
  it.each([
    ['启动', 'Halted'], ['正常关闭', 'Running'], ['正常重启', 'Running'], ['挂起', 'Running'], ['从挂起恢复', 'Suspended'],
    ['暂停', 'Running'], ['继续运行', 'Paused'], ['创建快照', 'Halted'], ['删除', 'Halted'],
  ])('requires a target review for %s', (label, state) => {
    useMultiDataStore.setState({ vms: useMultiDataStore.getState().vms.map((vm) => ({ ...vm, power_state: state })) as any })
    render(<BatchToolbar />)
      fireEvent.click(screen.getByRole('button', { name: label, exact: true }))
      const dialog = screen.getByRole('dialog', { name: '确认批量' + label })
      expect(dialog).toHaveTextContent('VM A')
      expect(submitTask).not.toHaveBeenCalled()
      fireEvent.click(within(dialog).getByRole('button', { name: '取消', exact: true }))
  })
  it('defaults disk deletion on and submits the reviewed opt-out', async () => {
    render(<BatchToolbar />)
    fireEvent.click(screen.getByRole('button', { name: '删除', exact: true }))
    const diskOption = screen.getByRole('checkbox', { name: '同时删除所属硬盘' })
    expect(diskOption).toBeChecked()
    expect(screen.getByRole('dialog')).toHaveTextContent('永久删除')
    fireEvent.click(diskOption)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '确认', exact: true })) })
    expect(submitTask).toHaveBeenCalledWith('delete', [target], { deleteDisks: false })
  })
  it('blocks a confirmation when a prerequisite changes after opening it', () => {
    render(<BatchToolbar />)
    fireEvent.click(screen.getByRole('button', { name: '删除', exact: true }))
    act(() => useMultiDataStore.setState({ vms: useMultiDataStore.getState().vms.map((vm) => ({ ...vm, power_state: 'Running' })) }))
    expect(screen.getByRole('button', { name: '确认', exact: true })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('只有已停止')
  })
  it('disables submission as soon as an admission request begins', () => {
    useBatchStore.setState({ isSubmitting: true })
    render(<BatchToolbar />)
    expect(screen.getByRole('button', { name: '启动', exact: true })).toBeDisabled()
    expect(screen.getByRole('button', { name: '正常关闭', exact: true })).toBeDisabled()
  })
  it('keeps the reviewed targets frozen when the selection changes', async () => {
    useMultiDataStore.setState({ vms: useMultiDataStore.getState().vms.map((vm) => ({ ...vm, power_state: 'Running' })) })
    render(<BatchToolbar />)
    fireEvent.click(screen.getByRole('button', { name: '正常关闭', exact: true }))
    act(() => useBatchStore.setState({ selectedVms: [{ ...target, vmName: 'VM B', vmRef: 'OpaqueRef:other', intent: { ...target.intent, vmUuid: 'other' } }] }))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('VM A')
    expect(dialog).not.toHaveTextContent('VM B')
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: '确认', exact: true })) })
    expect(submitTask).toHaveBeenCalledWith('stop', [target], undefined)
  })
  it('blocks overlapping VM tasks while allowing unrelated selections', () => {
    useBatchStore.setState({ activeTasks: [{ id: 'running', type: 'start', targets: [{ ...target, connectionId: 'another-connection', vmRef: 'OpaqueRef:alias' }], status: 'running', progress: { total: 1, completed: 0, failed: 0 }, results: [], createdAt: 1 }] })
    const view = render(<BatchToolbar />)
    expect(screen.getByRole('button', { name: '启动', exact: true })).toBeDisabled()
    act(() => useBatchStore.setState({ activeTasks: [] }))
    view.rerender(<BatchToolbar />)
    expect(screen.getByRole('button', { name: '启动', exact: true })).toBeEnabled()
  })
  it('blocks selections that lack the full pool and VM identity', () => {
    useBatchStore.setState({ selectedVms: [{ ...target, intent: undefined }] })
    useMultiDataStore.setState({ vms: [] })
    render(<BatchToolbar />)
    expect(screen.getByRole('button', { name: '启动', exact: true })).toBeDisabled()
    expect(screen.getByRole('button', { name: '启动', exact: true })).toHaveAttribute('title', expect.stringContaining('完整身份'))
  })
})
