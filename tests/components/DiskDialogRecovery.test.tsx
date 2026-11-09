import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { VdiCreateDialog } from '../../src/renderer/src/components/vdi/VdiCreateDialog'
import { VdiMoveDialog } from '../../src/renderer/src/components/vdi/VdiMoveDialog'
import { useConnectionManagerStore } from '../../src/renderer/src/store/connectionManager.store'
import { useFeedbackStore } from '../../src/renderer/src/store/feedback.store'

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }))
vi.mock('../../src/renderer/src/components/toast/useToast', () => ({ useToast: () => toast }))
const GIB = 1024 ** 3
const pool = { id: 'pool', name: 'Pool', host: '127.0.0.1', state: 'connected', epoch: 1, connectedAt: 1, poolUuid: 'pool-uuid' }
const sr = (ref: string, type = 'nfs', content_type = 'user') => ({ ref, uuid: ref, name_label: ref, type, content_type, physical_size: 100 * GIB, physical_utilisation: 0 })
const disk = { ref: 'disk', uuid: 'disk-uuid', name_label: 'Disk', SR: 'source', virtual_size: GIB } as any
const createProps = { open: true, connectionId: 'pool', vmRef: 'vm', onClose: vi.fn(), onCreated: vi.fn() }
const moveProps = { open: true, connectionId: 'pool', vdi: disk, onClose: vi.fn(), onMoved: vi.fn() }
const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
const fillCreate = async () => {
  await waitFor(() => expect(screen.getByRole('combobox', { name: '目标 SR' })).toHaveValue('target'))
  fireEvent.change(screen.getByPlaceholderText('磁盘名称'), { target: { value: 'Data' } })
}

beforeEach(() => {
  vi.clearAllMocks()
  useConnectionManagerStore.setState({ connections: [pool] as any, activeConnectionId: 'pool' })
  useFeedbackStore.setState({ toasts: [], progress: [], confirmDialog: null })
  window.xapi = { storage: {
    listSrs: vi.fn().mockResolvedValue([sr('target')]),
    createForVm: vi.fn().mockResolvedValue({ vdiRef: 'created', vbdRef: 'vbd', plugged: false }),
    moveVdi: vi.fn().mockResolvedValue({ newVdiRef: 'moved' }),
  } } as any
})
afterEach(cleanup)

it('excludes ISO content and device repositories from disk creation', async () => {
  vi.mocked(window.xapi.storage.listSrs).mockResolvedValue([sr('iso', 'iso'), sr('devices', 'udev'), sr('iso-content', 'nfs', 'iso'), sr('target')] as any)
  render(<VdiCreateDialog {...createProps} />)
  await waitFor(() => expect(screen.getByRole('combobox', { name: '目标 SR' })).toHaveValue('target'))
  expect(screen.queryByRole('option', { name: /iso-content/ })).not.toBeInTheDocument()
})

it('keeps confirmed disk creation successful when synchronous parent refresh fails', async () => {
  render(<VdiCreateDialog {...createProps} onCreated={() => { throw new Error('list offline') }} />)
  await fillCreate()
  fireEvent.click(screen.getByRole('button', { name: '创建', exact: true }))
  expect(await screen.findByText('创建成功')).toBeInTheDocument()
  expect(screen.getByRole('alert')).toHaveTextContent('list offline')
  expect(toast.error).not.toHaveBeenCalled()
  expect(window.xapi.storage.createForVm).toHaveBeenCalledOnce()
})

it('handles asynchronous parent refresh rejection separately from creation', async () => {
  render(<VdiCreateDialog {...createProps} onCreated={vi.fn().mockRejectedValue(new Error('refresh rejected'))} />)
  await fillCreate()
  fireEvent.click(screen.getByRole('button', { name: '创建', exact: true }))
  expect(await screen.findByRole('alert')).toHaveTextContent('refresh rejected')
  expect(screen.getByText('创建成功')).toBeInTheDocument()
  expect(toast.error).not.toHaveBeenCalled()
})

it('reports an existing created disk separately when attachment is incomplete', async () => {
  vi.mocked(window.xapi.storage.createForVm).mockRejectedValue(Object.assign(new Error('已保留 VDI created'), { code: 'VDI_CREATED_ATTACH_INCOMPLETE', details: { outcome: 'partial', vdiRef: 'created' } }))
  render(<VdiCreateDialog {...createProps} />)
  await fillCreate()
  fireEvent.click(screen.getByRole('button', { name: '创建', exact: true }))
  expect(await screen.findByText('磁盘已创建，附加未完成')).toBeInTheDocument()
  expect(screen.getByRole('alert')).toHaveTextContent('已保留 VDI created')
  expect(createProps.onCreated).toHaveBeenCalledOnce()
  expect(screen.queryByText('创建失败')).not.toBeInTheDocument()
})

it('does not publish old creation results into a different VM dialog', async () => {
  const old = deferred<any>()
  vi.mocked(window.xapi.storage.createForVm).mockReturnValueOnce(old.promise)
  const view = render(<VdiCreateDialog {...createProps} />)
  await fillCreate()
  fireEvent.click(screen.getByRole('button', { name: '创建', exact: true }))
  view.rerender(<VdiCreateDialog {...createProps} vmRef="other-vm" />)
  await act(async () => old.resolve({ vbdRef: 'old-vbd', plugged: false }))
  expect(screen.queryByText('创建成功')).not.toBeInTheDocument()
  expect(createProps.onCreated).not.toHaveBeenCalled()
  expect(toast.success).not.toHaveBeenCalled()
})

it('rereads creation storage after reconnect and discards the old list', async () => {
  const old = deferred<any[]>()
  vi.mocked(window.xapi.storage.listSrs).mockReturnValueOnce(old.promise).mockResolvedValueOnce([sr('target')] as any)
  render(<VdiCreateDialog {...createProps} />)
  act(() => useConnectionManagerStore.setState({ connections: [{ ...pool, epoch: 2 }] as any }))
  await waitFor(() => expect(window.xapi.storage.listSrs).toHaveBeenCalledTimes(2))
  await act(async () => old.resolve([sr('old-target')]))
  expect(screen.getByRole('combobox', { name: '目标 SR' })).toHaveValue('target')
})

it('blocks another create and ignores its old result after connection identity changes', async () => {
  const old = deferred<any>()
  vi.mocked(window.xapi.storage.createForVm).mockReturnValueOnce(old.promise)
  render(<VdiCreateDialog {...createProps} />)
  await fillCreate()
  fireEvent.click(screen.getByRole('button', { name: '创建', exact: true }))
  act(() => useConnectionManagerStore.setState({ connections: [{ ...pool, epoch: 2 }] as any }))
  expect(await screen.findByText('读取创建结果失败')).toBeInTheDocument()
  expect(screen.getByRole('alert')).toHaveTextContent('管理连接已变化')
  await act(async () => old.resolve({ vbdRef: 'old-vbd', plugged: false }))
  expect(createProps.onCreated).not.toHaveBeenCalled()
  expect(toast.success).not.toHaveBeenCalled()
  expect(window.xapi.storage.createForVm).toHaveBeenCalledOnce()
})

it('offers only supported destination storage for a disk move', async () => {
  vi.mocked(window.xapi.storage.listSrs).mockResolvedValue([sr('source'), sr('iso', 'iso'), sr('devices', 'udev'), sr('iso-content', 'nfs', 'iso'), sr('target')] as any)
  render(<VdiMoveDialog {...moveProps} />)
  await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue('target'))
  expect(screen.queryByRole('option', { name: /iso|devices/ })).not.toBeInTheDocument()
})

it('recovers a failed destination list read inside the move dialog', async () => {
  vi.mocked(window.xapi.storage.listSrs).mockRejectedValueOnce(new Error('storage read failed')).mockResolvedValueOnce([sr('target')] as any)
  render(<VdiMoveDialog {...moveProps} />)
  expect(await screen.findByRole('alert')).toHaveTextContent('storage read failed')
  fireEvent.click(screen.getByRole('button', { name: '重新读取存储仓库' }))
  await waitFor(() => expect(screen.getByRole('button', { name: '移动', exact: true })).toBeEnabled())
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('keeps the new disk destination when an older read finishes later', async () => {
  const old = deferred<any[]>()
  vi.mocked(window.xapi.storage.listSrs).mockReturnValueOnce(old.promise).mockResolvedValueOnce([sr('target')] as any)
  const view = render(<VdiMoveDialog {...moveProps} />)
  view.rerender(<VdiMoveDialog {...moveProps} vdi={{ ...disk, ref: 'other-disk', uuid: 'other-uuid' }} />)
  await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue('target'))
  await act(async () => old.resolve([sr('old-target')]))
  expect(screen.getByRole('combobox')).toHaveValue('target')
})

it('does not refresh or close a new move dialog after the old move finishes', async () => {
  const old = deferred<any>()
  vi.mocked(window.xapi.storage.moveVdi).mockReturnValueOnce(old.promise)
  const view = render(<VdiMoveDialog {...moveProps} />)
  await waitFor(() => expect(screen.getByRole('button', { name: '移动', exact: true })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '移动', exact: true }))
  view.rerender(<VdiMoveDialog {...moveProps} vdi={{ ...disk, ref: 'other-disk', uuid: 'other-uuid' }} />)
  await act(async () => old.resolve({ newVdiRef: 'moved' }))
  expect(moveProps.onMoved).not.toHaveBeenCalled()
  expect(moveProps.onClose).not.toHaveBeenCalled()
  expect(useFeedbackStore.getState().toasts).toHaveLength(0)
})

it('does not resend a move after task result retrieval fails', async () => {
  vi.mocked(window.xapi.storage.moveVdi).mockRejectedValue(Object.assign(new Error('task result unavailable'), { code: 'TASK_OUTCOME_UNKNOWN' }))
  render(<VdiMoveDialog {...moveProps} />)
  await waitFor(() => expect(screen.getByRole('button', { name: '移动', exact: true })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '移动', exact: true }))
  expect(await screen.findByRole('alert')).toHaveTextContent('task result unavailable')
  expect(screen.getByRole('button', { name: '移动', exact: true })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: '移动', exact: true }))
  expect(window.xapi.storage.moveVdi).toHaveBeenCalledOnce()
})

it('submits only one disk creation when clicks share the same render', async () => {
  vi.mocked(window.xapi.storage.createForVm).mockReturnValue(new Promise(() => {}))
  render(<VdiCreateDialog {...createProps} />)
  await fillCreate()
  const button = screen.getByRole('button', { name: '创建', exact: true })
  const cancel = screen.getByRole('button', { name: '取消', exact: true })
  act(() => { button.click(); button.click(); cancel.click() })
  expect(window.xapi.storage.createForVm).toHaveBeenCalledOnce()
  expect(createProps.onClose).not.toHaveBeenCalled()
})

it('submits only one disk move when clicks share the same render', async () => {
  vi.mocked(window.xapi.storage.moveVdi).mockReturnValue(new Promise(() => {}))
  render(<VdiMoveDialog {...moveProps} />)
  await waitFor(() => expect(screen.getByRole('button', { name: '移动', exact: true })).toBeEnabled())
  const button = screen.getByRole('button', { name: '移动', exact: true })
  const cancel = screen.getByRole('button', { name: '取消', exact: true })
  act(() => { button.click(); button.click(); cancel.click() })
  expect(window.xapi.storage.moveVdi).toHaveBeenCalledOnce()
  expect(moveProps.onClose).not.toHaveBeenCalled()
})

it('shows a static connection failure and ignores the original move completion after reconnect', async () => {
  const old = deferred<any>()
  vi.mocked(window.xapi.storage.moveVdi).mockReturnValueOnce(old.promise)
  render(<VdiMoveDialog {...moveProps} />)
  await waitFor(() => expect(screen.getByRole('button', { name: '移动', exact: true })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '移动', exact: true }))
  act(() => useConnectionManagerStore.setState({ connections: [{ ...pool, epoch: 2 }] as any }))
  expect(await screen.findByRole('alert')).toHaveTextContent('管理连接已变化')
  expect(screen.getByRole('button', { name: '移动', exact: true })).toBeDisabled()
  expect(screen.getByRole('button', { name: '取消', exact: true })).toBeEnabled()
  await act(async () => old.resolve({ newVdiRef: 'moved' }))
  expect(moveProps.onClose).not.toHaveBeenCalled()
  expect(moveProps.onMoved).not.toHaveBeenCalled()
  expect(window.xapi.storage.moveVdi).toHaveBeenCalledOnce()
})

it('preserves the selected move destination when a fresh record for the same disk arrives', async () => {
  vi.mocked(window.xapi.storage.listSrs).mockResolvedValue([sr('target'), sr('second-target')] as any)
  const view = render(<VdiMoveDialog {...moveProps} />)
  await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue('target'))
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'second-target' } })
  view.rerender(<VdiMoveDialog {...moveProps} vdi={{ ...disk }} />)
  expect(screen.getByRole('combobox')).toHaveValue('second-target')
  expect(window.xapi.storage.listSrs).toHaveBeenCalledOnce()
})

it('keeps the creation draft when retrying a failed storage read', async () => {
  vi.mocked(window.xapi.storage.listSrs).mockRejectedValueOnce(new Error('read failed')).mockResolvedValueOnce([sr('target')] as any)
  render(<VdiCreateDialog {...createProps} />)
  expect(await screen.findByRole('alert')).toHaveTextContent('read failed')
  fireEvent.change(screen.getByPlaceholderText('磁盘名称'), { target: { value: 'Keep draft' } })
  fireEvent.click(screen.getByRole('button', { name: '重新读取存储仓库' }))
  await waitFor(() => expect(screen.getByRole('button', { name: '创建', exact: true })).toBeEnabled())
  expect(screen.getByPlaceholderText('磁盘名称')).toHaveValue('Keep draft')
})

it('starts a clean draft when the creation dialog is closed and reopened', async () => {
  const view = render(<VdiCreateDialog {...createProps} />)
  await fillCreate()
  view.rerender(<VdiCreateDialog {...createProps} open={false} />)
  view.rerender(<VdiCreateDialog {...createProps} />)
  await waitFor(() => expect(screen.getByRole('combobox', { name: '目标 SR' })).toHaveValue('target'))
  expect(screen.getByPlaceholderText('磁盘名称')).toHaveValue('')
})

it('disables moving when only the source SR and ISO repositories exist', async () => {
  vi.mocked(window.xapi.storage.listSrs).mockResolvedValue([sr('source'), sr('iso', 'iso')] as any)
  render(<VdiMoveDialog {...moveProps} />)
  expect(await screen.findByRole('status')).toHaveTextContent('没有其他可移动到的磁盘存储仓库')
  expect(screen.getByRole('button', { name: '移动', exact: true })).toBeDisabled()
  expect(window.xapi.storage.moveVdi).not.toHaveBeenCalled()
})

it('keeps attachment-result read errors and refresh failures visible without retrying creation', async () => {
  vi.mocked(window.xapi.storage.createForVm).mockRejectedValue(Object.assign(new Error('VDI created；VBD result read failed'), { code: 'VDI_CREATED_ATTACH_INCOMPLETE', details: { outcome: 'unknown' } }))
  render(<VdiCreateDialog {...createProps} onCreated={vi.fn().mockRejectedValue(new Error('refresh failed'))} />)
  await fillCreate()
  fireEvent.click(screen.getByRole('button', { name: '创建', exact: true }))
  expect(await screen.findByText('读取创建结果失败')).toBeInTheDocument()
  await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(2))
  expect(screen.getAllByRole('alert').map((element) => element.textContent).join(' ')).toMatch(/VBD result read failed.*refresh failed/)
  expect(screen.queryByRole('button', { name: '创建', exact: true })).not.toBeInTheDocument()
  expect(window.xapi.storage.createForVm).toHaveBeenCalledOnce()
})
