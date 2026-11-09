import { useState } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import DashboardPage from '../../src/renderer/src/pages/DashboardPage'
import { useMetricsStore } from '../../src/renderer/src/store/metrics.store'
import { syncManager } from '../../src/renderer/src/store/syncManager.store'
import HostsPage from '../../src/renderer/src/pages/HostsPage'
import HostDetailPage from '../../src/renderer/src/pages/HostDetailPage'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TopBar from '../../src/renderer/src/components/layout/TopBar'
import Breadcrumb from '../../src/renderer/src/components/layout/Breadcrumb'
import { DesktopDialog } from '../../src/renderer/src/components/layout/DesktopDialog'
import { ResourceReadBanner } from '../../src/renderer/src/components/layout/ResourceReadBanner'
import { AddServerDialog } from '../../src/renderer/src/components/connection/AddServerDialog'
import { BatchToolbar } from '../../src/renderer/src/components/batch/BatchToolbar'
import { useConnectionManagerStore } from '../../src/renderer/src/store/connectionManager.store'
import { useMultiDataStore } from '../../src/renderer/src/store/multiData.store'
import { useBatchStore } from '../../src/renderer/src/store/batch.store'
import { useExportPanelStore } from '../../src/renderer/src/store/exportPanel.store'

vi.mock('../../src/renderer/src/components/dashboard/DashboardMetricsPanel', () => ({ DashboardMetricsPanel: () => null }))
vi.mock('../../src/renderer/src/components/toast/useToast', () => ({ useToast: () => ({ error: vi.fn(), info: vi.fn() }) }))
const future = { v7_startTransition: true, v7_relativeSplatPath: true } as const
const wrapper = ({ children }: { children: React.ReactNode }) => <MemoryRouter initialEntries={['/pool/A/vms']} future={future}>{children}</MemoryRouter>
const disconnect = vi.fn().mockResolvedValue(undefined)
const submitTask = vi.fn().mockResolvedValue('task-1')

describe('desktop workflow usability', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useConnectionManagerStore.setState({ connections: ['A', 'B'].map((id) => ({ id, host: `${id}.invalid`, name: `Pool ${id}`, poolName: `Pool ${id}`, poolRef: `pool-${id}`, state: 'connected', errorMessage: null, connectedAt: 1, poolUuid: `pool-${id}`, epoch: 1 })), activeConnectionId: 'B', disconnect })
    useMultiDataStore.setState({ vms: [], hosts: [], pools: [], domainStates: {}, refreshConnection: vi.fn().mockResolvedValue(undefined) })
    useExportPanelStore.setState({ tasks: [], })
    useBatchStore.setState({ selectedVms: [], activeTask: null, activeTasks: [], pendingTaskIds: [], isSubmitting: false, error: null, submitTask })
  })

  it('shows an empty pool host read as unknown while retaining the actual health of populated pools', () => {
    const refresh = vi.spyOn(syncManager, 'refreshNow').mockImplementation(() => {})
    useMetricsStore.setState({ startCollection: vi.fn(), stopCollection: vi.fn(), collectionIntervalIds: new Map() })
    useMultiDataStore.setState({ hosts: [{ connectionId: 'B', ref: 'OpaqueRef:b', name_label: 'Host B', enabled: false, memory_total: 0, memory_free: 0 } as any], srs: [], tasks: [], loading: false, domainStates: { A: { hosts: { loading: false, error: null, lastSuccessAt: 1 } }, B: { hosts: { loading: false, error: null, lastSuccessAt: 1 } } } })
    render(<DashboardPage />, { wrapper })
    const poolA = screen.getByRole('heading', { name: 'Pool A' }).closest('.group')!
    const poolB = screen.getByRole('heading', { name: 'Pool B' }).closest('.group')!
    expect(within(poolA as HTMLElement).getByText('暂无主机数据')).toBeInTheDocument()
    expect(within(poolA as HTMLElement).queryByText(/健康|台主机异常/)).not.toBeInTheDocument()
    expect(within(poolB as HTMLElement).getByText('1 台主机异常')).toBeInTheDocument()
    refresh.mockRestore()
  })

  it('disconnects the resource pool visible in the route even when the active pool differs', async () => {
    render(<TopBar />, { wrapper })
    fireEvent.click(screen.getByRole('button', { name: '断开资源池 Pool A' }))
    await waitFor(() => expect(disconnect).toHaveBeenCalledWith('A'))
    expect(disconnect).not.toHaveBeenCalledWith('B')
  })

  it('opens all task progress from the notification icon without starting a new export', () => {
    useExportPanelStore.setState({ tasks: [{ exportId: 'export-1', status: 'running' } as any], })
    render(<TopBar />, { wrapper })
    fireEvent.click(screen.getByRole('button', { name: /任务通知/ }))
    expect(screen.getByRole('complementary', { name: '任务通知' })).toBeVisible()
  })

  it('links the pool breadcrumb to a supported resource route', () => {
    render(<Breadcrumb />, { wrapper })
    expect(screen.getByRole('link', { name: 'Pool A' })).toHaveAttribute('href', '/pool/A/hosts')
  })

  it('requires reviewing targets hidden by the current resource view before submission', async () => {
    const targets = ['A', 'B'].map((id) => ({ connectionId: id, vmRef: id.toLowerCase(), vmName: 'VM ' + id, intent: { vmUuid: id, poolUuid: 'pool-' + id, epoch: 1 } }))
    useBatchStore.setState({ selectedVms: targets })
    useMultiDataStore.setState({ vms: targets.map((target) => ({ connectionId: target.connectionId, ref: target.vmRef, uuid: target.intent.vmUuid, name_label: target.vmName, power_state: 'Halted', allowed_operations: ['start'] })) as any })
    render(<BatchToolbar visibleVms={[{ connectionId: 'A', ref: 'a' }]} />)
    expect(screen.getByText('其中 1 台不在当前列表')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '启动', exact: true }))
    expect(submitTask).not.toHaveBeenCalled()
    const dialog = screen.getByRole('dialog', { name: '确认批量启动' })
    expect(within(dialog).getByText('Pool B · VM B')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: '确认', exact: true }))
    await waitFor(() => expect(submitTask).toHaveBeenCalledWith('start', targets, undefined))
  })

  it('confirms suspended-VM resume and offers snapshots when XAPI permits them', async () => {
    const target = { connectionId: 'A', vmRef: 'a', vmName: 'VM A', intent: { vmUuid: 'A', poolUuid: 'pool-A', epoch: 1 } }
    useBatchStore.setState({ selectedVms: [target] })
    useMultiDataStore.setState({ vms: [{ connectionId: 'A', ref: 'a', uuid: 'A', name_label: 'VM A', power_state: 'Suspended', allowed_operations: ['resume', 'snapshot'] }] as any })
    render(<BatchToolbar />)
    expect(screen.getByRole('button', { name: '创建快照', exact: true })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '从挂起恢复', exact: true }))
    const dialog = screen.getByRole('dialog', { name: '确认批量从挂起恢复' })
    expect(dialog).toHaveTextContent('重新分配内存')
    fireEvent.click(within(dialog).getByRole('button', { name: '确认', exact: true }))
    await waitFor(() => expect(submitTask).toHaveBeenCalledWith('resume', [target], undefined))
  })

  it('shows the current resource read error and the last successful read, without unrelated pool errors', () => {
    useMultiDataStore.setState({ domainStates: { A: { vms: { loading: false, error: 'VM读取失败', lastSuccessAt: 1000 } }, B: { hosts: { loading: false, error: 'B主机失败', lastSuccessAt: null } } } })
    render(<ResourceReadBanner />, { wrapper })
    expect(screen.getByRole('alert')).toHaveTextContent('Pool A · 虚拟机：VM读取失败')
    expect(screen.getByRole('alert')).toHaveTextContent('当前显示上次成功读取的数据')
    expect(screen.queryByText(/B主机失败/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重新读取' }))
    expect(useMultiDataStore.getState().refreshConnection).toHaveBeenCalledWith('A')
  })

  it('focuses the dialog and returns focus to the invoking control after Escape', async () => {
    function Example() {
      const [open, setOpen] = useState(false)
      return <><button onClick={() => setOpen(true)}>打开编辑</button><DesktopDialog open={open} title="编辑" onClose={() => setOpen(false)}><label>名称<input /></label><button onClick={() => setOpen(false)}>取消</button></DesktopDialog></>
    }
    render(<Example />)
    const trigger = screen.getByRole('button', { name: '打开编辑' })
    trigger.focus()
    fireEvent.click(trigger)
    await waitFor(() => expect(screen.getByRole('textbox', { name: '名称' })).toHaveFocus())
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())
  })


  it('reads each scoped host maintenance state once without a render/request loop', async () => {
    const getMaintenanceStatus = vi.fn().mockResolvedValue({ state: 'enabled', runningVms: [] })
    Object.assign(window, { xapi: { host: { getMaintenanceStatus } } })
    useMultiDataStore.setState({ hosts: [{ connectionId: 'A', ref: 'OpaqueRef:host', name_label: 'Host A', enabled: true } as any], networks: [], refreshHosts: vi.fn(), refreshNetworks: vi.fn() })
    render(<Routes><Route path="/pool/:connectionId/vms" element={<HostsPage />} /></Routes>, { wrapper })
    await waitFor(() => expect(getMaintenanceStatus).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('heading', { name: 'Host A' })).toBeInTheDocument()
    expect(getMaintenanceStatus).toHaveBeenCalledTimes(1)
  })

  it('keeps password access in the main process when saving a profile without changing the password', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    Object.assign(window, { xapi: { profiles: { save } } })
    render(<AddServerDialog open mode="edit" profile={{ id: 'saved-A', name: 'Pool A', host: 'A.invalid', port: 443, scheme: 'https:', username: 'root', lastConnected: null }} onClose={vi.fn()} />)
    expect(screen.getByLabelText('主机地址 *')).toHaveValue('A.invalid')
    expect(screen.getByLabelText('密码')).toHaveValue('')
    expect(screen.getByRole('checkbox', { name: '允许自签名证书' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '保存', exact: true }))
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ id: 'saved-A' }), null))
  })

  it('shows host memory capacity, used and free bytes together with CPU hardware', async () => {
    Object.assign(window, { xapi: { host: { getMaintenanceStatus: vi.fn().mockResolvedValue({ state: 'enabled' }) } } })
    useMultiDataStore.setState({ hosts: [{ connectionId: 'A', ref: 'host', name_label: 'Host A', enabled: true,
      memory_total: 64 * 1024 ** 3, memory_free: 16 * 1024 ** 3, cpu_info: { cpu_count: '32', modelname: 'AMD EPYC', socket_count: '2' },
    } as any], networks: [], refreshHosts: vi.fn(), refreshNetworks: vi.fn() })
    render(<HostsPage />, { wrapper })
    expect(screen.getByText('64 GiB')).toBeVisible()
    expect(screen.getByText('已用 48 GiB · 可用 16 GiB')).toBeVisible()
    expect(screen.getByText('32 逻辑处理器')).toBeVisible()
    expect(screen.getByText('AMD EPYC')).toBeVisible()
    await waitFor(() => expect(window.xapi.host.getMaintenanceStatus).toHaveBeenCalledOnce())
  })

  it('keeps a memory read failure visible on the host overview without displaying invented capacity', async () => {
    useMultiDataStore.setState({ hosts: [{ connectionId: 'A', ref: 'host', uuid: 'host-uuid', name_label: 'Host A', hostname: 'xcp-host', address: '192.0.2.10', enabled: true,
      memoryReadError: 'HOST_OFFLINE', cpu_info: {}, software_version: { build_number: 'build' },
    } as any], refreshHosts: vi.fn().mockResolvedValue(undefined) })
    render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }} initialEntries={['/pool/A/hosts/host']}><Routes><Route path="/pool/:connectionId/hosts/:ref" element={<HostDetailPage />} /></Routes></MemoryRouter>)
    expect(await screen.findByText('容量暂不可用')).toBeVisible()
    expect(screen.getByRole('alert')).toHaveTextContent('内存读取失败：HOST_OFFLINE')
    expect(screen.getByText('host-uuid')).toBeVisible()
    expect(screen.queryByText('0 B')).not.toBeInTheDocument()
  })
})
