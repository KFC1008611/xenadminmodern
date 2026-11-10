import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { VdiAttachDialog } from '../../src/renderer/src/components/vdi/VdiAttachDialog'
import { VdiResizeDialog } from '../../src/renderer/src/components/vdi/VdiResizeDialog'
import { VdiMoveDialog } from '../../src/renderer/src/components/vdi/VdiMoveDialog'
import { VmStorageTab } from '../../src/renderer/src/components/vm/VmStorageTab'
import { VmImportDialog } from '../../src/renderer/src/components/vm/VmImportDialog'
import VmsPage from '../../src/renderer/src/pages/VmsPage'
import HostsPage from '../../src/renderer/src/pages/HostsPage'
import TasksPage, { useTaskCancellationStore } from '../../src/renderer/src/pages/TasksPage'
import TopBar from '../../src/renderer/src/components/layout/TopBar'
import { useConnectionManagerStore } from '../../src/renderer/src/store/connectionManager.store'
import { useMultiDataStore } from '../../src/renderer/src/store/multiData.store'
import { useBatchStore } from '../../src/renderer/src/store/batch.store'
import { useFeedbackStore } from '../../src/renderer/src/store/feedback.store'
import { useImportWizardStore } from '../../src/renderer/src/store/importWizard.store'
import type { TaskCancellationResult } from '../../src/shared/types/xapi'

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }))
vi.mock('../../src/renderer/src/components/toast/useToast', () => ({ useToast: () => toast }))
vi.mock('../../src/renderer/src/components/wizard/CreateVmWizard', () => ({ CreateVmWizard: () => null }))
vi.mock('../../src/renderer/src/components/batch/BatchToolbar', () => ({ BatchToolbar: () => null }))
vi.mock('../../src/renderer/src/components/batch/BatchProgressDialog', () => ({ BatchProgressDialog: () => null }))

const GIB = 1073741824
const routerFuture = { v7_startTransition: true, v7_relativeSplatPath: true } as const
const pool = { id: 'pool', name: 'Pool', poolName: 'Pool', host: '127.0.0.1', state: 'connected', epoch: 1, connectedAt: 1 }
const dataActions = useMultiDataStore.getState()
const template = (name: string) => ({ ref: name, uuid: name, name_label: name, name_description: '', is_a_template: true, is_default_template: false, other_config: {}, allowed_operations: [], power_state: 'Halted' })
const disk = (ref: string) => ({ ref, uuid: ref, name_label: ref, srName: 'SR', SR: 'sr', virtual_size: GIB, forceReadOnly: false })
const deferred = <T,>() => {
  let resolve!: (value: T) => void
  let reject!: (value: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}
const routed = (child: React.ReactNode) => <MemoryRouter future={routerFuture}>{child}</MemoryRouter>

beforeEach(() => {
  vi.clearAllMocks()
  useTaskCancellationStore.setState({ cancellations: {} })
  useConnectionManagerStore.setState({ connections: [pool] as any, activeConnectionId: 'pool', error: null })
  useMultiDataStore.setState({
    vms: [], hosts: [], srs: [], networks: [], tasks: [], pools: [], domainStates: {}, errors: {}, loading: false, lastRefresh: null, templateRevision: 0,
    refreshVms: vi.fn().mockResolvedValue(undefined), refreshHosts: vi.fn().mockResolvedValue(undefined),
    refreshNetworks: vi.fn().mockResolvedValue(undefined), refreshTasks: vi.fn().mockResolvedValue(undefined), refreshAll: vi.fn().mockResolvedValue(undefined),
  })
  useBatchStore.setState({ selectedVms: [], refreshTasks: vi.fn().mockResolvedValue(undefined) })
  useFeedbackStore.setState({ toasts: [], progress: [], confirmDialog: null })
  useImportWizardStore.getState().reset()
  window.xapi = {
    vm: { templates: vi.fn().mockResolvedValue({ user: [], system: [] }), import: vi.fn().mockResolvedValue('import-op'), importProgress: vi.fn() },
    host: { getMaintenanceStatus: vi.fn().mockResolvedValue({ state: 'normal' }) },
    network: { listPifs: vi.fn().mockResolvedValue([]) },
    storage: { listAttachableVdis: vi.fn(), attachExistingVdi: vi.fn().mockResolvedValue({}), listSrs: vi.fn().mockResolvedValue([{ ref: 'sr', name_label: 'SR', physical_size: 100 * GIB, physical_utilisation: 0 }]), getAllowedOperations: vi.fn().mockResolvedValue({ resize: true }), resizeVdi: vi.fn().mockResolvedValue('task'), listVdis: vi.fn() },
    tasks: { list: vi.fn(), cancel: vi.fn(() => new Promise(() => {})) },
  } as any
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  useMultiDataStore.setState({ refreshVms: dataActions.refreshVms, refreshHosts: dataActions.refreshHosts, refreshNetworks: dataActions.refreshNetworks, refreshTasks: dataActions.refreshTasks, refreshAll: dataActions.refreshAll })
})

const attachProps = { connectionId: 'pool', vmRef: 'vm', onClose: vi.fn(), onAttached: vi.fn() }
const resizeProps = { connectionId: 'pool', vmRef: 'vm', powerState: 'Halted', vdi: { ...disk('Disk'), vbdRef: 'vbd', userdevice: '0', bootable: true, mode: 'RW' } as any, onClose: vi.fn(), onResized: vi.fn() }
const task = { ref: 'task', connectionId: 'pool', poolName: 'Pool', name_label: 'Long task', status: 'pending', progress: 0.5 }
const readTasks = (status = 'pending', error: string | null = null, present = true) => act(() => useMultiDataStore.setState({
  tasks: present ? [{ ...task, status }] as any : [],
  domainStates: { pool: { tasks: { loading: false, lastSuccessAt: error ? 1 : Date.now(), error } } },
}))
const tick = async () => { await act(async () => { await Promise.resolve() }) }
const startResize = async (onResized = vi.fn()) => {
  await act(async () => { render(<VdiResizeDialog {...resizeProps} onResized={onResized} open />) })
  fireEvent.change(screen.getByLabelText('New size value'), { target: { value: '2' } })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '确认扩容' })) })
}

it('keeps the current attachment selection when an earlier opening returns', async () => {
  const old = deferred<any[]>()
  vi.mocked(window.xapi.storage.listAttachableVdis).mockReturnValueOnce(old.promise).mockResolvedValueOnce([disk('A'), disk('B')] as any)
  const view = render(<VdiAttachDialog {...attachProps} open />)
  view.rerender(<VdiAttachDialog {...attachProps} open={false} />)
  view.rerender(<VdiAttachDialog {...attachProps} open />)
  await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue('A'))
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'B' } })
  await act(async () => old.resolve([disk('A')]))
  expect(screen.getByRole('combobox')).toHaveValue('B')
  fireEvent.click(screen.getByRole('button', { name: '附加', exact: true }))
  await waitFor(() => expect(window.xapi.storage.attachExistingVdi).toHaveBeenCalledWith('pool', { vmRef: 'vm', vdiRef: 'B', readOnly: false }))
})

it('ignores attachment failures from a prior connection lifecycle and supports read retry', async () => {
  const old = deferred<any[]>()
  vi.mocked(window.xapi.storage.listAttachableVdis).mockReturnValueOnce(old.promise).mockRejectedValueOnce(new Error('current read failed')).mockResolvedValueOnce([disk('B')] as any)
  render(<VdiAttachDialog {...attachProps} open />)
  act(() => useConnectionManagerStore.setState({ connections: [{ ...pool, epoch: 2 }] as any }))
  expect(await screen.findByRole('alert')).toHaveTextContent('current read failed')
  await act(async () => old.reject(new Error('obsolete read failed')))
  expect(screen.getByRole('alert')).not.toHaveTextContent('obsolete')
  fireEvent.click(screen.getByRole('button', { name: '重新读取可附加磁盘' }))
  await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue('B'))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('does not let a late attachment completion close a different VM dialog', async () => {
  const acceptance = deferred<any>()
  vi.mocked(window.xapi.storage.listAttachableVdis).mockResolvedValue([disk('B')] as any)
  vi.mocked(window.xapi.storage.attachExistingVdi).mockReturnValue(acceptance.promise)
  const props = { ...attachProps, onClose: vi.fn(), onAttached: vi.fn() }
  const view = render(<VdiAttachDialog {...props} open />)
  await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue('B'))
  fireEvent.click(screen.getByRole('button', { name: '附加', exact: true }))
  view.rerender(<VdiAttachDialog {...props} vmRef="other-vm" open />)
  await act(async () => acceptance.resolve({}))
  expect(props.onClose).not.toHaveBeenCalled()
  expect(props.onAttached).not.toHaveBeenCalled()
})

it('preserves successful attachment feedback if only the parent refresh fails', async () => {
  vi.mocked(window.xapi.storage.listAttachableVdis).mockResolvedValue([disk('B')] as any)
  render(<VdiAttachDialog {...attachProps} onAttached={vi.fn().mockRejectedValue(new Error('refresh failed'))} open />)
  await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue('B'))
  fireEvent.click(screen.getByRole('button', { name: '附加', exact: true }))
  await waitFor(() => expect(useFeedbackStore.getState().toasts.some((entry) => entry.message.includes('列表刷新失败'))).toBe(true))
  expect(useFeedbackStore.getState().toasts.some((entry) => entry.message.includes('附加磁盘失败'))).toBe(false)
})

it('rejects older template successes and failures after a newer successful refresh', async () => {
  const first = deferred<any>()
  const second = deferred<any>()
  vi.mocked(window.xapi.vm.templates).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockResolvedValue({ user: [template('Current')], system: [] } as any)
  render(routed(<VmsPage />))
  act(() => useMultiDataStore.setState({ templateRevision: 1 }))
  act(() => useMultiDataStore.setState({ templateRevision: 2 }))
  expect(await screen.findByText('Current')).toBeInTheDocument()
  await act(async () => { first.resolve({ user: [template('Old')], system: [] }); second.reject(new Error('old failure')) })
  expect(screen.queryByText('Old')).not.toBeInTheDocument()
  expect(screen.queryByText(/old failure/)).not.toBeInTheDocument()
  expect(screen.getByText('Current')).toBeInTheDocument()
})

it('retains failed-pool templates, leaves other pools current, and retries only that pool', async () => {
  useConnectionManagerStore.setState({ connections: [pool, { ...pool, id: 'other', poolName: 'Other' }] as any })
  let fail = false
  vi.mocked(window.xapi.vm.templates).mockImplementation(async (id) => {
    if (id === 'pool' && fail) throw new Error('temporary failure')
    return { user: [template(id === 'pool' ? 'Retained' : 'Other template')], system: [] } as any
  })
  render(routed(<VmsPage />))
  expect(await screen.findByText('Retained')).toBeInTheDocument()
  fail = true
  act(() => useMultiDataStore.setState({ templateRevision: 1 }))
  expect(await screen.findByRole('alert')).toHaveTextContent('temporary failure')
  expect(screen.getByText('Retained')).toBeInTheDocument()
  expect(screen.getByText('Other template')).toBeInTheDocument()
  expect(within(screen.getByText('Retained').closest('tr')!).getByRole('button', { name: '操作' })).toBeDisabled()
  const before = vi.mocked(window.xapi.vm.templates).mock.calls.filter(([id]) => id === 'other').length
  fail = false
  fireEvent.click(screen.getByRole('button', { name: '重新读取模板' }))
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  expect(vi.mocked(window.xapi.vm.templates).mock.calls.filter(([id]) => id === 'other')).toHaveLength(before)
})

it('clears templates on reconnect and rejects an old pool lifecycle response', async () => {
  const old = deferred<any>()
  vi.mocked(window.xapi.vm.templates).mockReturnValueOnce(old.promise).mockResolvedValueOnce({ user: [template('Reconnected')], system: [] } as any)
  render(routed(<VmsPage />))
  act(() => useConnectionManagerStore.setState({ connections: [{ ...pool, epoch: 2 }] as any }))
  expect(await screen.findByText('Reconnected')).toBeInTheDocument()
  await act(async () => old.resolve({ user: [template('Old session')], system: [] }))
  expect(screen.queryByText('Old session')).not.toBeInTheDocument()
})

it('offers template recovery after the first read fails without claiming the pool is empty', async () => {
  vi.mocked(window.xapi.vm.templates).mockRejectedValueOnce(new Error('first read failed')).mockResolvedValueOnce({ user: [template('Recovered')], system: [] } as any)
  render(routed(<VmsPage />))
  expect(await screen.findByRole('alert')).toHaveTextContent('first read failed')
  expect(screen.queryByText('没有找到虚拟机或模板')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '重新读取模板' }))
  expect(await screen.findByText('Recovered')).toBeInTheDocument()
})

const host = { ref: 'host', connectionId: 'pool', poolName: 'Pool', name_label: 'Host', enabled: true }
const pif = (IP: string) => ({ ref: 'pif', host: 'host', network: 'net', device: 'eth0', physical: true, IP })
it('rereads host interfaces on global refresh, explicit retry, reopen and reconnect', async () => {
  useMultiDataStore.setState({ hosts: [host] as any, refreshAll: vi.fn().mockImplementation(async () => {
    useMultiDataStore.setState({ domainStates: { pool: { hosts: { loading: false, error: null, lastSuccessAt: 2 } } } })
  }) })
  vi.mocked(window.xapi.network.listPifs).mockResolvedValueOnce([pif('192.0.2.10')] as any).mockResolvedValue([pif('192.0.2.20')] as any)
  render(routed(<><TopBar /><HostsPage /></>))
  fireEvent.click(screen.getByRole('button', { name: '主机接口' }))
  expect(await screen.findByText('192.0.2.10')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '刷新资源' }))
  expect(await screen.findByText('192.0.2.20')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '重新读取主机接口' }))
  await waitFor(() => expect(window.xapi.network.listPifs).toHaveBeenCalledTimes(3))
  fireEvent.click(screen.getByRole('button', { name: '主机接口' }))
  fireEvent.click(screen.getByRole('button', { name: '主机接口' }))
  await waitFor(() => expect(window.xapi.network.listPifs).toHaveBeenCalledTimes(4))
  act(() => useConnectionManagerStore.setState({ connections: [{ ...pool, epoch: 2 }] as any }))
  await waitFor(() => expect(window.xapi.network.listPifs).toHaveBeenCalledTimes(5))
})

it('rejects old host-interface responses and retains last good data on a transient error', async () => {
  const old = deferred<any[]>()
  useMultiDataStore.setState({ hosts: [host] as any })
  vi.mocked(window.xapi.network.listPifs).mockReturnValueOnce(old.promise).mockResolvedValueOnce([pif('192.0.2.20')] as any).mockRejectedValueOnce(new Error('PIF read failed'))
  render(routed(<HostsPage />))
  fireEvent.click(screen.getByRole('button', { name: '主机接口' }))
  act(() => useConnectionManagerStore.setState({ connections: [{ ...pool, epoch: 2 }] as any }))
  expect(await screen.findByText('192.0.2.20')).toBeInTheDocument()
  await act(async () => old.resolve([pif('192.0.2.10')]))
  expect(screen.queryByText('192.0.2.10')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '重新读取主机接口' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('PIF read failed')
  expect(screen.getByText('192.0.2.20')).toBeInTheDocument()
})

it('allows an unsubmitted XVA review to go back, retain the file and submit revised settings', async () => {
  useImportWizardStore.setState({ currentStep: 4, draftScope: JSON.stringify({ connectionId: 'pool', epoch: 1 }), filePath: '/tmp/example.xva', targetSrRef: 'sr', vifMappings: { '0': 'net' }, preview: { vmName: 'Imported', vifs: [{ device: '0', sourceNetworkName: 'Source' }], diskCount: 1 } as any })
  window.xapi.vm.creationResources = vi.fn().mockResolvedValue({ hosts: [{ ref: 'host', name: 'Host' }], srs: ['sr', 'new-sr'].map((ref) => ({ ref, name: ref, freeBytes: 1e12, hostRefs: ['host'] })), networks: ['net', 'new-net'].map((ref) => ({ ref, name: ref, hostRefs: ['host'] })), isos: [] })
  useMultiDataStore.setState({ srs: [{ ref: 'sr', connectionId: 'pool', type: 'ext', shared: true }, { ref: 'new-sr', name_label: 'New SR', type: 'ext', shared: true, connectionId: 'pool' }] as any, networks: [{ ref: 'net', name_label: 'Network', connectionId: 'pool' }, { ref: 'new-net', name_label: 'New network', connectionId: 'pool' }] as any })
  render(<VmImportDialog open connectionId="pool" onClose={vi.fn()} />)
  await tick()
  fireEvent.click(screen.getByRole('button', { name: '上一步' }))
  fireEvent.change(screen.getByRole('combobox', { name: /目标网络/ }), { target: { value: 'new-net' } })
  fireEvent.click(screen.getByRole('button', { name: '上一步' }))
  fireEvent.change(screen.getByLabelText('目标存储'), { target: { value: 'new-sr' } })
  fireEvent.click(screen.getByRole('button', { name: '下一步' }))
  expect(screen.getByRole('combobox', { name: /目标网络/ })).toHaveValue('new-net')
  fireEvent.click(screen.getByRole('button', { name: '下一步' }))
  fireEvent.click(screen.getByRole('button', { name: '开始导入' }))
  await tick()
  expect(window.xapi.vm.import).toHaveBeenCalledWith('pool', { originEpoch: 1, filePath: '/tmp/example.xva', srRef: 'new-sr', homeServerRef: null, vifMappings: { '0': 'new-net' } })
  expect(screen.queryByRole('button', { name: '上一步' })).not.toBeInTheDocument()
})

it('keeps XVA draft editing locked during unknown or unacknowledged submission', async () => {
  useImportWizardStore.setState({ currentStep: 4, filePath: '/tmp/example.xva', targetSrRef: 'sr', operationStatus: 'unknown', preview: { vmName: 'Imported', vifs: [], diskCount: 1 } as any })
  render(<VmImportDialog open connectionId="pool" onClose={vi.fn()} />)
  expect(screen.queryByRole('button', { name: '上一步' })).not.toBeInTheDocument()
  act(() => useImportWizardStore.setState({ operationStatus: null, importing: true }))
  expect(screen.queryByRole('button', { name: '上一步' })).not.toBeInTheDocument()
})

it('waits for cancellation result and blocks duplicate submissions', async () => {
  useMultiDataStore.setState({ tasks: [task] as any })
  render(<TasksPage />)
  const button = screen.getByRole('button', { name: 'Cancel Long task' })
  fireEvent.click(button)
  fireEvent.click(button)
  await tick()
  expect(window.xapi.tasks.cancel).toHaveBeenCalledOnce()
  expect(button).toBeDisabled()
  expect(screen.getByRole('status')).toHaveTextContent('正在取消，等待服务器结果')
  expect(useFeedbackStore.getState().toasts).toHaveLength(0)
})

it.each([
  ['cancelled', '任务已取消（服务器已确认）'],
  ['success', '任务已正常完成，取消未阻止任务完成'],
  ['failure', '任务已失败'],
])('reports cancellation terminal status %s accurately', async (status, message) => {
  vi.mocked(window.xapi.tasks.cancel).mockResolvedValue({ status, message } as TaskCancellationResult)
  useMultiDataStore.setState({ tasks: [task] as any })
  render(<TasksPage />)
  fireEvent.click(screen.getByRole('button', { name: 'Cancel Long task' }))
  await tick()
  expect(screen.getByRole('status')).toHaveTextContent(message)
  readTasks('pending', 'list refresh disconnected', false)
  expect(screen.getByRole('status')).toHaveTextContent(message)
})

it('does not overwrite a terminal cancellation result when acknowledgement arrives late', async () => {
  const pending = deferred<TaskCancellationResult>()
  vi.mocked(window.xapi.tasks.cancel).mockReturnValue(pending.promise)
  useMultiDataStore.setState({ tasks: [task] as any })
  render(<TasksPage />)
  fireEvent.click(screen.getByRole('button', { name: 'Cancel Long task' }))
  readTasks('cancelled')
  await act(async () => pending.resolve({ status: 'cancelled', message: '任务已取消' }))
  expect(screen.getByRole('status')).toHaveTextContent('服务器已确认')
})

it('keeps observing cancellation after a task read failure without another user action', async () => {
  useMultiDataStore.setState({ tasks: [task] as any })
  render(<TasksPage />)
  fireEvent.click(screen.getByRole('button', { name: 'Cancel Long task' }))
  await tick()
  readTasks('pending', 'read disconnected')
  expect(screen.getByRole('status')).toHaveTextContent('正在取消，等待服务器结果')
  expect(screen.queryByRole('button', { name: '重新读取任务状态' })).not.toBeInTheDocument()
  expect(window.xapi.tasks.cancel).toHaveBeenCalledOnce()
  readTasks('pending', null, false)
  expect(screen.getByRole('status')).toHaveTextContent('正在取消，等待服务器结果')
  readTasks('cancelled')
  expect(screen.getByRole('status')).toHaveTextContent('服务器已确认')
})

it('does not read or cancel a same-reference task in a new connection lifecycle', async () => {
  const pending = deferred<TaskCancellationResult>()
  vi.mocked(window.xapi.tasks.cancel).mockReturnValue(pending.promise)
  useMultiDataStore.setState({ tasks: [task] as any })
  render(<TasksPage />)
  fireEvent.click(screen.getByRole('button', { name: 'Cancel Long task' }))
  await tick()
  act(() => useConnectionManagerStore.setState({ connections: [{ ...pool, epoch: 2 }] as any }))
  readTasks('cancelled')
  await act(async () => pending.resolve({ status: 'cancelled', message: '任务已取消' }))
  expect(screen.getByRole('status')).toHaveTextContent('管理连接已变化')
  expect(screen.queryByRole('button', { name: '重新读取任务状态' })).not.toBeInTheDocument()
})

it('preserves uncertainty after a cancellation transport error without resubmitting', async () => {
  useMultiDataStore.setState({ tasks: [task] as any })
  vi.mocked(window.xapi.tasks.cancel).mockRejectedValue(new Error('reply lost'))
  render(<TasksPage />)
  fireEvent.click(screen.getByRole('button', { name: 'Cancel Long task' }))
  await tick()
  readTasks()
  expect(screen.getByRole('status')).toHaveTextContent('获取取消结果失败')
  expect(screen.getByRole('button', { name: 'Cancel Long task' })).toBeDisabled()
})

it('recovers a successful resize capacity read without resubmitting or rereading the known terminal task', async () => {
  vi.mocked(window.xapi.tasks.list).mockResolvedValue([{ ref: 'task', status: 'success', progress: 1 }] as any)
  vi.mocked(window.xapi.storage.listVdis).mockRejectedValueOnce(new Error('readback disconnected')).mockResolvedValueOnce([{ ...disk('Disk'), virtual_size: 2 * GIB }] as any)
  const onResized = vi.fn()
  await startResize(onResized)
  expect(screen.queryByText('扩容失败')).not.toBeInTheDocument()
  expect(await screen.findByText('扩容完成', {}, { timeout: 2500 })).toBeInTheDocument()
  expect(onResized).toHaveBeenCalledOnce()
  expect(window.xapi.storage.resizeVdi).toHaveBeenCalledOnce()
  expect(window.xapi.tasks.list).toHaveBeenCalledOnce()
})

it.each([['failure', '扩容失败'], ['cancelled', '扩容已取消']])('reports explicit resize task %s', async (status, message) => {
  vi.mocked(window.xapi.tasks.list).mockResolvedValue([{ ref: 'task', status, error_info: ['SR_BACKEND_FAILURE'] }] as any)
  await startResize()
  expect(screen.getByText(message)).toBeInTheDocument()
  expect(window.xapi.storage.listVdis).not.toHaveBeenCalled()
})

it.each([
  ['RBAC_PERMISSION_DENIED', { kind: 'xapi' }],
  ['SR_SPACE_INSUFFICIENT', { kind: 'xapi' }],
  ['IPC_SCHEMA_INVALID', undefined],
])('reports an explicit resize rejection %s without starting result polling', async (code, details) => {
  vi.mocked(window.xapi.storage.resizeVdi).mockRejectedValue(Object.assign(new Error(`${code}: resize rejected`), { code, details }))
  await startResize()
  expect(screen.getByText('扩容失败')).toBeInTheDocument()
  expect(screen.getByRole('alert')).toHaveTextContent(`${code}: resize rejected`)
  expect(screen.queryByText('无法获取扩容结果')).not.toBeInTheDocument()
  expect(window.xapi.storage.resizeVdi).toHaveBeenCalledOnce()
  expect(window.xapi.tasks.list).not.toHaveBeenCalled()
  expect(window.xapi.storage.listVdis).not.toHaveBeenCalled()
  expect(resizeProps.onResized).not.toHaveBeenCalled()
})

it.each([
  [undefined, undefined],
  ['ECONNRESET', { kind: 'transport' }],
  ['XAPI_CONTRACT_MISMATCH', { kind: 'client' }],
  ['IPC_RESULT_INVALID', undefined],
])('confirms capacity after a lost or invalid resize acceptance reply (%s) without repeating the write', async (code, details) => {
  vi.mocked(window.xapi.storage.resizeVdi).mockRejectedValue(Object.assign(new Error('acceptance reply lost'), { code, details }))
  vi.mocked(window.xapi.storage.listVdis).mockResolvedValue([{ ...disk('Disk'), virtual_size: 2 * GIB }] as any)
  await startResize()
  expect(await screen.findByText('扩容完成', {}, { timeout: 2500 })).toBeInTheDocument()
  expect(window.xapi.storage.resizeVdi).toHaveBeenCalledOnce()
  expect(window.xapi.tasks.list).not.toHaveBeenCalled()
})

it('keeps resize capacity below target or a different UUID unconfirmed', async () => {
  vi.mocked(window.xapi.tasks.list).mockResolvedValue([{ ref: 'task', status: 'success', progress: 1 }] as any)
  vi.mocked(window.xapi.storage.listVdis).mockResolvedValueOnce([disk('Disk')] as any).mockResolvedValue([{ ...disk('Disk'), uuid: 'different', virtual_size: 3 * GIB }] as any)
  await startResize()
  expect(await screen.findByText('无法获取扩容结果', {}, { timeout: 3500 })).toBeInTheDocument()
  expect(window.xapi.storage.listVdis).toHaveBeenCalledTimes(3)
  expect(resizeProps.onResized).not.toHaveBeenCalled()
})

it('preserves confirmed resize success when a parent list refresh fails', async () => {
  vi.mocked(window.xapi.tasks.list).mockResolvedValue([{ ref: 'task', status: 'success', progress: 1 }] as any)
  vi.mocked(window.xapi.storage.listVdis).mockResolvedValue([{ ...disk('Disk'), virtual_size: 2 * GIB }] as any)
  await startResize(vi.fn().mockImplementation(() => { throw new Error('refresh failed') }))
  expect(screen.getByText('扩容完成')).toBeInTheDocument()
  expect(screen.getByRole('alert')).toHaveTextContent('列表刷新失败')
})

it('keeps a completed disk move successful when only the parent list refresh fails', async () => {
  const onClose = vi.fn()
  Object.assign(window.xapi.storage, { moveVdi: vi.fn().mockResolvedValue({ newVdiRef: 'moved' }) })
  render(<VdiMoveDialog open connectionId="pool" vdi={{ ...resizeProps.vdi, SR: 'source-sr' }}
    onClose={onClose} onMoved={vi.fn().mockRejectedValue(new Error('refresh failed'))} />)
  await waitFor(() => expect(screen.getByRole('button', { name: '移动', exact: true })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '移动', exact: true }))
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  expect(window.xapi.storage.moveVdi).toHaveBeenCalledOnce()
  const messages = useFeedbackStore.getState().toasts.map((entry) => entry.message)
  expect(messages.some((message) => message.includes('移动完成'))).toBe(true)
  expect(messages.some((message) => message.includes('列表刷新失败'))).toBe(true)
  expect(messages.some((message) => message.includes('移动磁盘失败'))).toBe(false)
})

it('serializes slow resize polling and invalidates late results after switching disks', async () => {
  vi.useFakeTimers()
  const slow = deferred<any[]>()
  vi.mocked(window.xapi.tasks.list).mockReturnValueOnce(slow.promise)
  const view = render(<VdiResizeDialog {...resizeProps} open />)
  await tick()
  fireEvent.change(screen.getByLabelText('New size value'), { target: { value: '2' } })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '确认扩容' })) })
  await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
  expect(window.xapi.tasks.list).toHaveBeenCalledOnce()
  view.rerender(<VdiResizeDialog {...resizeProps} vdi={{ ...resizeProps.vdi, ref: 'other', uuid: 'other' }} open />)
  await act(async () => slow.resolve([{ ref: 'task', status: 'success', progress: 1 }]))
  expect(window.xapi.storage.listVdis).not.toHaveBeenCalled()
  expect(screen.queryByText('扩容完成')).not.toBeInTheDocument()
})

const setupVmDisks = () => {
  Object.assign(window.xapi.vm, { getVBDs: vi.fn().mockResolvedValue([{ ref: 'vbd', VDI: 'Disk', type: 'Disk', srRef: 'sr', userdevice: '0', bootable: true, mode: 'RW' }]) })
  vi.mocked(window.xapi.storage.listVdis).mockResolvedValue([resizeProps.vdi])
}
it('keeps attachment completion connected to the parent while its disk list refreshes', async () => {
  setupVmDisks()
  vi.mocked(window.xapi.storage.listAttachableVdis).mockResolvedValue([disk('B')] as any)
  render(<VmStorageTab connectionId="pool" vmRef="vm" powerState="Halted" />)
  await waitFor(() => expect(screen.getByRole('button', { name: '附加已有磁盘' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '附加已有磁盘' }))
  await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue('B'))
  fireEvent.click(screen.getByRole('button', { name: '附加', exact: true }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(window.xapi.storage.attachExistingVdi).toHaveBeenCalledOnce()
  expect(window.xapi.storage.listVdis).toHaveBeenCalledTimes(2)
})
it('keeps a completed resize visible through the parent disk list refresh', async () => {
  setupVmDisks()
  vi.mocked(window.xapi.tasks.list).mockResolvedValue([{ ref: 'task', status: 'success', progress: 1 }] as any)
  render(<VmStorageTab connectionId="pool" vmRef="vm" powerState="Halted" />)
  fireEvent.click(await screen.findByTitle('扩容磁盘'))
  await tick()
  vi.mocked(window.xapi.storage.listVdis).mockResolvedValue([{ ...resizeProps.vdi, virtual_size: 2 * GIB }])
  fireEvent.change(screen.getByLabelText('New size value'), { target: { value: '2' } })
  fireEvent.click(screen.getByRole('button', { name: '确认扩容' }))
  expect(await screen.findByText('扩容完成')).toBeInTheDocument()
  await waitFor(() => expect(window.xapi.storage.listVdis).toHaveBeenCalledTimes(3))
  expect(screen.getByText('扩容完成')).toBeInTheDocument()
  expect(window.xapi.storage.resizeVdi).toHaveBeenCalledOnce()
})

it('rereads the original resize task after a task-list failure', async () => {
  vi.mocked(window.xapi.tasks.list).mockRejectedValueOnce(new Error('task read interrupted')).mockResolvedValueOnce([{ ref: 'task', status: 'success', progress: 1 }] as any)
  vi.mocked(window.xapi.storage.listVdis).mockResolvedValue([{ ...resizeProps.vdi, virtual_size: 2 * GIB }])
  await startResize()
  expect(await screen.findByText('扩容完成', {}, { timeout: 2500 })).toBeInTheDocument()
  expect(window.xapi.tasks.list).toHaveBeenCalledTimes(2)
  expect(window.xapi.storage.resizeVdi).toHaveBeenCalledOnce()
})

it('does not verify a resize against a reconnected pool with the same disk reference', async () => {
  vi.mocked(window.xapi.tasks.list).mockRejectedValueOnce(new Error('disconnected'))
  await startResize()
  await act(async () => { useConnectionManagerStore.setState({ connections: [{ ...pool, epoch: 2 }] as any }) })
  expect(screen.getByText('无法获取扩容结果')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '重新核对扩容结果' })).not.toBeInTheDocument()
  expect(window.xapi.storage.listVdis).not.toHaveBeenCalled()
  expect(window.xapi.storage.resizeVdi).toHaveBeenCalledOnce()
})

it('submits resize only once while the acceptance reply is pending', async () => {
  const acceptance = deferred<string>()
  vi.mocked(window.xapi.storage.resizeVdi).mockReturnValue(acceptance.promise)
  await act(async () => { render(<VdiResizeDialog {...resizeProps} open />) })
  fireEvent.change(screen.getByLabelText('New size value'), { target: { value: '2' } })
  const submit = screen.getByRole('button', { name: '确认扩容' })
  fireEvent.click(submit)
  fireEvent.click(submit)
  expect(window.xapi.storage.resizeVdi).toHaveBeenCalledOnce()
  vi.mocked(window.xapi.tasks.list).mockResolvedValue([{ ref: 'task', status: 'failure' }] as any)
  await act(async () => acceptance.resolve('task'))
  expect(screen.getByText('扩容失败')).toBeInTheDocument()
})

it('keeps cancellation requests isolated when two pools reuse the same task reference', async () => {
  useConnectionManagerStore.setState({ connections: [pool, { ...pool, id: 'other' }] as any })
  useMultiDataStore.setState({ tasks: [task, { ...task, connectionId: 'other', name_label: 'Other task', poolName: 'Other' }] as any })
  render(<TasksPage />)
  fireEvent.click(screen.getByRole('button', { name: 'Cancel Long task' }))
  await tick()
  expect(screen.getByRole('button', { name: 'Cancel Other task' })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: 'Cancel Other task' }))
  await tick()
  expect(vi.mocked(window.xapi.tasks.cancel).mock.calls).toEqual([['pool', 'task'], ['other', 'task']])
})
