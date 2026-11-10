import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import NetworksPage from '../../src/renderer/src/pages/NetworksPage'
import VmsPage from '../../src/renderer/src/pages/VmsPage'
import VmDetailPage from '../../src/renderer/src/pages/VmDetailPage'
import Sidebar from '../../src/renderer/src/components/layout/Sidebar'
import TopBar from '../../src/renderer/src/components/layout/TopBar'
import { VmStorageTab } from '../../src/renderer/src/components/vm/VmStorageTab'
import { ToastProvider } from '../../src/renderer/src/components/toast/ToastProvider'
import { useConnectionManagerStore } from '../../src/renderer/src/store/connectionManager.store'
import { useMultiDataStore } from '../../src/renderer/src/store/multiData.store'
import { useBatchStore } from '../../src/renderer/src/store/batch.store'
import { useFeedbackStore } from '../../src/renderer/src/store/feedback.store'
import { FeedbackOverlay } from '../../src/renderer/src/components/feedback/FeedbackOverlay'
import { BatchToolbar } from '../../src/renderer/src/components/batch/BatchToolbar'

const originalRefreshAll = useMultiDataStore.getState().refreshAll
const originalBatch = useBatchStore.getState()
const GiB = 1024 ** 3
const vm = { ref: 'OpaqueRef:vm', uuid: 'vm', name_label: 'App VM', name_description: '',
  power_state: 'Running', resident_on: 'host', VCPUs_max: 2, VCPUs_at_startup: 2,
  memory_static_min: GiB, memory_static_max: 2 * GiB, memory_dynamic_min: GiB, memory_dynamic_max: 2 * GiB,
  is_a_template: false, is_a_snapshot: false, is_control_domain: false, VBDs: ['vbd'], VIFs: [],
  metrics: 'OpaqueRef:NULL', guest_metrics: 'OpaqueRef:NULL', consoles: [], os_version: {}, networks: {},
  allowed_operations: ['clean_shutdown', 'snapshot'], current_operations: {}, connectionId: 'conn-a', poolName: 'Pool A' }
const network = { ref: 'OpaqueRef:network', uuid: 'network', name_label: 'Production network', name_description: '',
  bridge: 'xenbr0', PIFs: ['pif-a'], VIFs: [], MTU: 1500, connectionId: 'conn-a', poolName: 'Pool A',
  allowedActions: { rename: true, destroy: false } }
const disk = { ref: 'vdi', uuid: 'vdi', name_label: 'Data disk', SR: 'sr', virtual_size: 5 * GiB, physical_utilisation: 0 }
const vbd = { ref: 'vbd', VDI: 'vdi', srRef: 'sr', type: 'Disk', userdevice: '0', mode: 'RW',
  currently_attached: true, unpluggable: true, allowed_operations: ['unplug'] }
const connections = [
  { id: 'conn-a', host: 'a.invalid', name: 'Pool A', poolName: 'Pool A', state: 'connected', connectedAt: 1, epoch: 1, poolUuid: 'pool-a' },
  { id: 'conn-b', host: 'b.invalid', name: 'Pool B', poolName: 'Pool B', state: 'connected', connectedAt: 1, epoch: 1, poolUuid: 'pool-b' },
]
const future = { v7_startTransition: true, v7_relativeSplatPath: true }
function renderDetail(tab: string) {
  return render(<ToastProvider><MemoryRouter initialEntries={['/pool/conn-a/vms/OpaqueRef%3Avm?tab=' + tab]} future={future}>
    <TopBar /><Routes><Route path="/pool/:connectionId/vms/:ref" element={<VmDetailPage />} /></Routes><FeedbackOverlay />
  </MemoryRouter></ToastProvider>)
}
beforeEach(() => {
  vi.clearAllMocks()
  useConnectionManagerStore.setState({ connections: connections.map((item) => ({ ...item })) as any, activeConnectionId: 'conn-a' })
  useMultiDataStore.setState({ vms: [vm], hosts: [], srs: [{ ref: 'sr', name_label: 'Storage', connectionId: 'conn-a' }],
    networks: [network], tasks: [], pools: [], domainStates: {}, errors: {}, loading: false, loadingConnections: [],
    refreshAll: originalRefreshAll, refreshVms: vi.fn().mockResolvedValue(undefined),
    refreshNetworks: vi.fn().mockResolvedValue(undefined), refreshHosts: vi.fn().mockResolvedValue(undefined) } as any)
  useBatchStore.setState({ ...originalBatch, selectedVms: [], activeTask: null, activeTasks: [], taskHistory: [],
    isSubmitting: false, isLoading: false, error: null, refreshTasks: vi.fn().mockResolvedValue(undefined) })
  useFeedbackStore.setState({ toasts: [], progress: [], confirmDialog: null })
  window.xapi = {
    onVmChanged: vi.fn().mockReturnValue(() => {}),
    vm: { getRecord: vi.fn().mockResolvedValue(vm), getVBDs: vi.fn().mockResolvedValue([vbd]), getVIFs: vi.fn().mockResolvedValue([]),
      getSnapshots: vi.fn().mockResolvedValue([]), list: vi.fn().mockResolvedValue([vm]),
      templates: vi.fn().mockResolvedValue({ system: [], user: [] }), unplugVbd: vi.fn().mockResolvedValue(undefined) },
    storage: { listVdis: vi.fn().mockResolvedValue([disk]), listSrs: vi.fn().mockResolvedValue([]) },
    network: { list: vi.fn().mockResolvedValue([network]), listPifs: vi.fn().mockResolvedValue([
      { ref: 'pif-a', host: 'host-a', network: network.ref, device: 'eth0', IP: '192.0.2.10', linkState: 'connected', isPhysicalNic: true, management: true },
    ]) },
    host: { list: vi.fn().mockResolvedValue([]) }, tasks: { list: vi.fn().mockResolvedValue([]) },
    pool: { get: vi.fn().mockResolvedValue(null) }, bond: { list: vi.fn().mockResolvedValue([]) }, vlan: { list: vi.fn().mockResolvedValue([]) },
  } as any
})
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('resource refresh and selection consistency', () => {
  it('updates network interface IP and link state through the global refresh', async () => {
    const page = () => <ToastProvider><MemoryRouter initialEntries={['/pool/conn-a/networks?network=' + encodeURIComponent(network.ref)]} future={future}>
      <TopBar /><Routes><Route path="/pool/:connectionId/networks" element={<NetworksPage />} /></Routes>
    </MemoryRouter></ToastProvider>
    render(page())
    expect(await screen.findByText(/192\.0\.2\.10/)).toBeInTheDocument()
    vi.mocked(window.xapi.network.listPifs).mockResolvedValue([{ ref: 'pif-a', host: 'host-a', network: network.ref, device: 'eth0', IP: '192.0.2.20', linkState: 'disconnected', isPhysicalNic: true } as any])
    fireEvent.click(within(document.querySelector('header')!).getByRole('button', { name: '刷新资源', exact: true }))
    await waitFor(() => expect(useMultiDataStore.getState().domainStates['conn-a']?.networks?.lastSuccessAt).toBeTypeOf('number'))
    await waitFor(() => expect(within(document.querySelector('header')!).getByRole('button', { name: '刷新资源', exact: true })).toBeEnabled())
    expect(window.xapi.network.list).toHaveBeenCalled()
    expect(await screen.findByText(/192\.0\.2\.20/)).toBeInTheDocument()
  })

  it.each(['storage', 'snapshots'])('rereads %s through both the VM page and nested refresh controls', async (tab) => {
    renderDetail(tab)
    const read = tab === 'storage' ? window.xapi.vm.getVBDs : window.xapi.vm.getSnapshots
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1))
    await act(async () => {})
    const vmReads = vi.mocked(window.xapi.vm.getRecord).mock.calls.length
    fireEvent.click(screen.getAllByTitle('刷新')[0])
    await waitFor(() => expect(window.xapi.vm.getRecord).toHaveBeenCalledTimes(vmReads + 1))
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2))
    const childRefresh = within(screen.getByRole('tabpanel')).getByRole('button', { name: '刷新', exact: true })
    fireEvent.click(childRefresh)
    await waitFor(() => expect(read).toHaveBeenCalledTimes(3))
  })

  it('rereads disk activation after confirmed shutdown without switching tabs', async () => {
    window.xapi.vm.shutdown = vi.fn().mockImplementation(async () => {
      vi.mocked(window.xapi.vm.getRecord).mockResolvedValue({ ...vm, power_state: 'Halted', allowed_operations: ['start'] } as any)
      vi.mocked(window.xapi.vm.getVBDs).mockResolvedValue([{ ...vbd, currently_attached: false, allowed_operations: [] }] as any)
    })
    renderDetail('storage')
    await screen.findByText('已激活')
    fireEvent.click(screen.getByRole('button', { name: '关闭', exact: true }))
    fireEvent.click(within(screen.getByRole('dialog', { name: '确认关闭虚拟机' })).getByRole('button', { name: '关闭', exact: true }))
    await waitFor(() => expect(screen.getByRole('button', { name: '启动', exact: true })).toBeEnabled())
    await screen.findByText('未激活')
    expect(screen.getByRole('button', { name: '删除磁盘' })).toBeEnabled()
  })

  it.each(['storage', 'snapshots'])('updates the current %s tab after a global refresh', async (tab) => {
    renderDetail(tab)
    const read = tab === 'storage' ? window.xapi.vm.getVBDs : window.xapi.vm.getSnapshots
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1))
    fireEvent.click(within(document.querySelector('header')!).getByRole('button', { name: '刷新资源', exact: true }))
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2))
  })

  it('recovers a failed disk read using the page refresh and rejects an older device response', async () => {
    let finish!: (records: any[]) => void
    vi.mocked(window.xapi.vm.getVBDs).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    renderDetail('storage')
    await waitFor(() => expect(window.xapi.vm.getVBDs).toHaveBeenCalledTimes(1))
    vi.mocked(window.xapi.vm.getVBDs).mockRejectedValueOnce(new Error('VBD read interrupted'))
    fireEvent.click(screen.getByTitle('刷新'))
    expect(await screen.findByRole('alert')).toHaveTextContent('VBD read interrupted')
    await act(async () => { finish([vbd]) })
    expect(screen.queryByText('Data disk')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTitle('刷新'))
    await screen.findByText('Data disk')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('updates selected names and removes expired connection identities before confirmation', async () => {
    const submitTask = vi.fn().mockResolvedValue('task')
    useBatchStore.setState({ submitTask })
    render(<ToastProvider><MemoryRouter initialEntries={['/pool/conn-a/vms']} future={future}>
      <TopBar /><Routes><Route path="/pool/:connectionId/vms" element={<VmsPage />} /></Routes>
    </MemoryRouter></ToastProvider>)
    await screen.findByRole('button', { name: 'App VM' })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select App VM' }))
    await act(async () => { useMultiDataStore.setState({ vms: [{ ...vm, name_label: 'Renamed VM' }] } as any) })
    fireEvent.click(screen.getByRole('button', { name: '正常关闭', exact: true }))
    const dialog = screen.getByRole('dialog', { name: '确认批量正常关闭' })
    expect(dialog).toHaveTextContent('Renamed VM')
    await act(async () => {
      useConnectionManagerStore.setState({ connections: connections.map((item) => ({ ...item, epoch: 2 })) as any })
    })
    expect(within(dialog).getByRole('button', { name: '确认', exact: true })).toBeDisabled()
    expect(useBatchStore.getState().selectedVms).toEqual([])
    expect(submitTask).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }))
    expect(screen.getByRole('checkbox', { name: 'Select Renamed VM' })).not.toBeChecked()
  })

  it('locks conflicting disk controls until the unplug request and readback finish', async () => {
    let finish!: () => void
    const pending = new Promise<void>((resolve) => { finish = resolve })
    vi.mocked(window.xapi.vm.unplugVbd).mockReturnValue(pending)
    render(<VmStorageTab connectionId="conn-a" vmRef={vm.ref} powerState="Running" />)
    const button = await screen.findByTitle('停用磁盘')
    fireEvent.click(button)
    expect(button).toBeDisabled()
    expect(screen.getByTitle('扩容磁盘')).toBeDisabled()
    expect(screen.getByRole('button', { name: '附加已有磁盘' })).toBeDisabled()
    fireEvent.click(button)
    expect(window.xapi.vm.unplugVbd).toHaveBeenCalledTimes(1)
    await act(async () => { finish(); await pending })
  })

  it('keeps frozen confirmation names and prevents submission after a rename', async () => {
    const submitTask = vi.fn().mockResolvedValue('task')
    useBatchStore.setState({ submitTask, selectedVms: [{ connectionId: 'conn-a', vmRef: vm.ref, vmName: vm.name_label,
      intent: { vmUuid: vm.uuid, poolUuid: 'pool-a', epoch: 1 } }] })
    render(<BatchToolbar />)
    fireEvent.click(screen.getByRole('button', { name: '正常关闭', exact: true }))
    await act(async () => { useMultiDataStore.setState({ vms: [{ ...vm, name_label: 'Renamed VM' }] } as any) })
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('App VM')
    expect(within(dialog).getByRole('button', { name: '确认', exact: true })).toBeDisabled()
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }))
    fireEvent.click(screen.getByRole('button', { name: '正常关闭', exact: true }))
    expect(screen.getByRole('dialog')).toHaveTextContent('Renamed VM')
    expect(submitTask).not.toHaveBeenCalled()
  })

  it.each(['missing', 'replaced', 'template'])('invalidates %s VM selections while retaining other pools', async (change) => {
    const other = { ...vm, connectionId: 'conn-b', uuid: 'other', name_label: 'Other VM' }
    useMultiDataStore.setState({ vms: [vm, other] } as any)
    const target = (record: typeof vm) => ({ connectionId: record.connectionId, vmRef: record.ref, vmName: record.name_label,
      intent: { vmUuid: record.uuid, poolUuid: record.connectionId === 'conn-a' ? 'pool-a' : 'pool-b', epoch: 1 } })
    useBatchStore.setState({ selectedVms: [target(vm), target(other)] })
    render(<BatchToolbar />)
    await act(async () => {
      useMultiDataStore.setState({ vms: [other, ...(change === 'missing' ? [] : [{ ...vm,
        uuid: change === 'replaced' ? 'replacement' : vm.uuid, is_a_template: change === 'template' }])],
        domainStates: { 'conn-a': { vms: { loading: false, error: null, lastSuccessAt: 2 } } } } as any)
    })
    expect(useBatchStore.getState().selectedVms).toEqual([target(other)])
    expect(screen.getByRole('alert')).toHaveTextContent('已移除 1 台失效选择')
  })

  it('returns to the complete list after scoped sidebar navigation', async () => {
    useMultiDataStore.setState({ vms: [vm, { ...vm, connectionId: 'conn-b', name_label: 'B VM' }] } as any)
    render(<ToastProvider><MemoryRouter initialEntries={['/pool/conn-a/vms']} future={future}><Sidebar /><Routes>
      <Route path="/vms" element={<VmsPage />} /><Route path="/pool/:connectionId/vms" element={<VmsPage />} />
    </Routes></MemoryRouter></ToastProvider>)
    await screen.findByRole('button', { name: 'App VM' })
    expect(screen.queryByRole('button', { name: 'B VM' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('link', { name: '资源池 Pool B' }))
    await screen.findByRole('button', { name: 'B VM' })
    fireEvent.click(screen.getByRole('link', { name: '全部资源' }))
    expect(screen.getByRole('button', { name: 'App VM' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'B VM' })).toBeInTheDocument()
  })

  it('retains the explicit scope and disables writes when that pool disconnects', async () => {
    useMultiDataStore.setState({ vms: [vm, { ...vm, connectionId: 'conn-b', name_label: 'B VM' }] } as any)
    render(<ToastProvider><MemoryRouter initialEntries={['/pool/conn-a/vms']} future={future}><Routes>
      <Route path="/pool/:connectionId/vms" element={<VmsPage />} />
    </Routes></MemoryRouter></ToastProvider>)
    await screen.findByRole('button', { name: 'App VM' })
    await act(async () => {
      useConnectionManagerStore.setState({ connections: connections.map((item) => ({ ...item, state: item.id === 'conn-a' ? 'disconnected' : 'connected' })) as any })
    })
    expect(screen.getByRole('button', { name: 'Create new virtual machine' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Import virtual machine' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'B VM' })).not.toBeInTheDocument()
  })
})
