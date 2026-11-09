import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Play, Trash2 } from 'lucide-react'
import { ResourceActionMenu } from '../../src/renderer/src/components/layout/ResourceActionMenu'
import VmsPage from '../../src/renderer/src/pages/VmsPage'
import { ToastProvider } from '../../src/renderer/src/components/toast/ToastProvider'
import { FeedbackOverlay } from '../../src/renderer/src/components/feedback/FeedbackOverlay'
import { useFeedbackStore } from '../../src/renderer/src/store/feedback.store'
import { useConnectionManagerStore } from '../../src/renderer/src/store/connectionManager.store'
import { useMultiDataStore } from '../../src/renderer/src/store/multiData.store'
import { useBatchStore } from '../../src/renderer/src/store/batch.store'

const onSelect = vi.fn()
const forceShutdown = vi.fn().mockResolvedValue(undefined)
const shutdown = vi.fn().mockResolvedValue(undefined)

beforeEach(() => {
  vi.clearAllMocks()
  useFeedbackStore.setState({ confirmDialog: null, progress: [], toasts: [] })
})

describe('resource row actions', () => {
  it('keeps blocked actions discoverable without invoking them', () => {
    render(<ResourceActionMenu name="VM A" actions={[{ label: '删除', icon: Trash2, disabled: true, reason: '请先关闭虚拟机', onSelect }]} />)
    fireEvent.click(screen.getByRole('button', { name: 'VM A 的更多操作' }))
    const item = screen.getByRole('menuitem', { name: '删除' })
    expect(item).toHaveAttribute('aria-disabled', 'true')
    expect(item).toHaveAttribute('title', '请先关闭虚拟机')
    fireEvent.click(item)
    expect(onSelect).not.toHaveBeenCalled()
    expect(screen.getByRole('menu')).toBeInTheDocument()
  })

  it('supports keyboard navigation, selection and returning to the row trigger', () => {
    render(<ResourceActionMenu name="VM A" actions={[{ label: '启动', icon: Play, onSelect }, { label: '删除', icon: Trash2, onSelect }]} />)
    const trigger = screen.getByRole('button', { name: 'VM A 的更多操作' })
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    expect(screen.getByRole('menuitem', { name: '启动' })).toHaveFocus()
    fireEvent.keyDown(document.activeElement!, { key: 'End' })
    expect(screen.getByRole('menuitem', { name: '删除' })).toHaveFocus()
    fireEvent.click(document.activeElement!)
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('closes on Escape and outside pointer without selecting an action', () => {
    render(<><ResourceActionMenu name="VM A" actions={[{ label: '启动', icon: Play, onSelect }]} /><button>其他控件</button></>)
    const trigger = screen.getByRole('button', { name: 'VM A 的更多操作' })
    fireEvent.click(trigger)
    fireEvent.keyDown(screen.getByRole('menuitem'), { key: 'Escape' })
    expect(trigger).toHaveFocus()
    fireEvent.click(trigger)
    fireEvent.pointerDown(screen.getByRole('button', { name: '其他控件' }))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(onSelect).not.toHaveBeenCalled()
  })

  function renderList(allowed = ['clean_shutdown', 'hard_shutdown']) {
    Object.assign(window, { xapi: { vm: { templates: vi.fn().mockResolvedValue({ user: [], system: [] }), forceShutdown, shutdown } } })
    useConnectionManagerStore.setState({ connections: [{ id: 'A', name: 'Pool A', poolName: 'Pool A', host: 'A.invalid', poolRef: null, poolUuid: 'pool-A', epoch: 7, state: 'connected', connectedAt: 1, errorMessage: null }], activeConnectionId: 'A' })
    useMultiDataStore.setState({ vms: [{ ref: 'vm-A', uuid: 'uuid-A', connectionId: 'A', poolName: 'Pool A', name_label: 'VM A', power_state: 'Running', is_a_template: false, is_control_domain: false, allowed_operations: allowed, current_operations: {}, blocked_operations: {} } as any], hosts: [], domainStates: {}, refreshVms: vi.fn().mockResolvedValue(undefined) })
    useBatchStore.setState({ refreshTasks: vi.fn().mockResolvedValue(undefined), selectedVms: [] })
    render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><ToastProvider><VmsPage /><FeedbackOverlay /></ToastProvider></MemoryRouter>)
  }

  it('preserves the scoped destructive confirmation after moving force shutdown into the menu', async () => {
    renderList()
    fireEvent.click(screen.getByRole('button', { name: 'VM A 的更多操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '强制关闭' }))
    expect(forceShutdown).not.toHaveBeenCalled()
    const dialog = screen.getByRole('dialog', { name: '确认强制关闭虚拟机' })
    expect(dialog).toHaveTextContent('资源池：Pool A')
    expect(dialog).toHaveTextContent('虚拟机：VM A')
    fireEvent.click(within(dialog).getByRole('button', { name: '强制关闭', exact: true }))
    await waitFor(() => expect(forceShutdown).toHaveBeenCalledWith('A', 'vm-A', { vmUuid: 'uuid-A', poolUuid: 'pool-A', epoch: 7 }))
  })

  it('keeps denied operations blocked in the menu and normal shutdown behind confirmation', async () => {
    renderList(['clean_shutdown'])
    fireEvent.click(screen.getByRole('button', { name: 'VM A 的更多操作' }))
    const denied = screen.getByRole('menuitem', { name: '强制关闭' })
    expect(denied).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(denied)
    expect(forceShutdown).not.toHaveBeenCalled()
    fireEvent.keyDown(denied, { key: 'Escape' })
    const normalShutdown = screen.getByRole('button', { name: '关闭', exact: true })
    // fireEvent.click omits the browser's pointer focus behavior.
    normalShutdown.focus()
    fireEvent.click(normalShutdown)
    expect(shutdown).not.toHaveBeenCalled()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(normalShutdown).toHaveFocus()
    expect(shutdown).not.toHaveBeenCalled()
  })
})
