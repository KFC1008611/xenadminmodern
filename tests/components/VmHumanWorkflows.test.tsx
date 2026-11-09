import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import VmDetailPage from '../../src/renderer/src/pages/VmDetailPage'
import VmsPage from '../../src/renderer/src/pages/VmsPage'
import { ToastProvider } from '../../src/renderer/src/components/toast/ToastProvider'
import { FeedbackOverlay } from '../../src/renderer/src/components/feedback/FeedbackOverlay'
import { VifManager } from '../../src/renderer/src/components/vm/VifManager'
import { useConnectionManagerStore } from '../../src/renderer/src/store/connectionManager.store'
import { useMultiDataStore } from '../../src/renderer/src/store/multiData.store'
import { useFeedbackStore } from '../../src/renderer/src/store/feedback.store'
import { useBatchStore } from '../../src/renderer/src/store/batch.store'
import { canRunVmAction } from '../../src/renderer/src/lib/vmActionGuard'
import type { VmDetailRecord, VIFRecord } from '../../src/shared/types/xapi'

const GIB = 1073741824
const vmRef = 'OpaqueRef:vm'
let vm: VmDetailRecord
const vif: VIFRecord = { ref: 'vif', uuid: 'vif', device: '0', MAC: '00:11:22:33:44:55', network: 'network', VM: vmRef, MTU: 1500, currently_attached: false } as VIFRecord
const route = '/pool/pool-b/vms/OpaqueRef%3Avm'
const routerFuture = { v7_startTransition: true, v7_relativeSplatPath: true } as const
function Navigation() {
  const location = useLocation()
  const navigate = useNavigate()
  return <><output data-testid="location">{location.pathname}{location.search}</output><button onClick={() => navigate(-1)}>浏览器后退</button><button onClick={() => navigate(1)}>浏览器前进</button></>
}
function renderPage(url = route) {
  return render(<ToastProvider><MemoryRouter initialEntries={[url]} future={routerFuture}><Navigation /><Routes>
    <Route path="/pool/:connectionId/vms/:ref" element={<VmDetailPage />} />
    <Route path="/pool/:connectionId/vms" element={<VmsPage />} />
    <Route path="/vms" element={<VmsPage />} />
    <Route path="*" element={<div>关联资源页</div>} />
  </Routes><FeedbackOverlay /></MemoryRouter></ToastProvider>)
}
const tab = (name: string) => fireEvent.mouseDown(screen.getByRole('tab', { name, exact: true }), { button: 0 })

beforeEach(() => {
  vi.clearAllMocks()
  vm = {
    ref: vmRef, uuid: 'vm', name_label: 'App VM', name_description: '', power_state: 'Running', resident_on: 'host',
    VCPUs_max: 2, VCPUs_at_startup: 2, memory_static_min: GIB, memory_static_max: 2 * GIB, memory_dynamic_min: GIB, memory_dynamic_max: 2 * GIB,
    is_a_template: false, is_a_snapshot: false, is_control_domain: false, VBDs: ['vbd'], VIFs: ['vif'],
    metrics: 'OpaqueRef:NULL', guest_metrics: 'OpaqueRef:NULL', consoles: [], os_version: {}, networks: {},
    allowed_operations: ['clean_shutdown', 'pause', 'suspend', 'snapshot', 'hard_shutdown', 'clean_reboot'], current_operations: {},
  }
  useFeedbackStore.setState({ toasts: [], progress: [], confirmDialog: null })
  useConnectionManagerStore.setState({ activeConnectionId: 'pool-a', connections: [
    { id: 'pool-a', name: 'Pool A', state: 'connected' }, { id: 'pool-b', name: 'Pool B', state: 'connected' },
  ] as any })
  useMultiDataStore.setState({
    domainStates: {},
    hosts: [{ ref: 'host', name_label: 'Wrong Host', connectionId: 'pool-a' }, { ref: 'host', name_label: 'Correct Host', connectionId: 'pool-b' }],
    networks: [{ ref: 'network', name_label: 'Wrong Network', connectionId: 'pool-a' }, { ref: 'network', name_label: 'Production Network', connectionId: 'pool-b' }],
    srs: [{ ref: 'sr', name_label: 'Wrong SR', connectionId: 'pool-a' }, { ref: 'sr', name_label: 'Correct SR', connectionId: 'pool-b' }],
    vms: [{ ...vm, connectionId: 'pool-b', poolName: 'Pool B' }],
    refreshNetworks: vi.fn().mockResolvedValue(undefined), refreshVms: vi.fn().mockResolvedValue(undefined),
  } as any)
  useBatchStore.setState({ selectedVms: [], refreshTasks: vi.fn().mockResolvedValue(undefined) })
  window.xapi = {
    onVmChanged: vi.fn().mockReturnValue(() => {}),
    vm: {
      getRecord: vi.fn().mockImplementation(async () => ({ ...vm })),
      getVIFs: vi.fn().mockResolvedValue([vif]),
      getVBDs: vi.fn().mockResolvedValue([{ ref: 'vbd', VDI: 'vdi', srRef: 'sr', type: 'Disk', vdiName: 'Data disk', vdiSize: 5 * GIB, userdevice: '0', mode: 'RW', currently_attached: false }]),
      templates: vi.fn().mockResolvedValue({ system: [], user: [] }),
      reboot: vi.fn().mockResolvedValue(undefined),
      forceShutdown: vi.fn().mockImplementation(async () => { vm = { ...vm, power_state: 'Halted', allowed_operations: ['start'] } }),
      shutdown: vi.fn().mockImplementation(async () => { vm = { ...vm, power_state: 'Halted', allowed_operations: ['start'] } }),
      suspend: vi.fn().mockImplementation(async () => { vm = { ...vm, power_state: 'Suspended', allowed_operations: ['resume'] } }),
      resume: vi.fn().mockImplementation(async () => { vm = { ...vm, power_state: 'Running', allowed_operations: ['suspend'] } }),
    },
    storage: { listVdis: vi.fn().mockResolvedValue([{ ref: 'vdi', uuid: 'vdi', name_label: 'Data disk', SR: 'sr', virtual_size: 5 * GIB, physical_utilisation: 0 }]) },
    vif: { destroy: vi.fn().mockResolvedValue(undefined) },
  } as any
})

afterEach(() => vi.useRealTimers())

describe('VM human workflows', () => {
  function setList(count: number) {
    const rows = Array.from({ length: count }, (_, i) => ({ ...vm, ref: `vm-${i}`, uuid: `uuid-${i}`,
      name_label: `VM-${String(i).padStart(3, '0')}`, connectionId: 'pool-b', poolName: 'Pool B' }))
    useMultiDataStore.setState({ vms: rows })
    return rows
  }

  it('selects sorted ranges with Shift and toggles rows with Ctrl or Command without opening details', async () => {
    setList(6)
    renderPage('/pool/pool-b/vms')
    await screen.findByRole('button', { name: 'VM-000' })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select VM-001' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select VM-004' }), { shiftKey: true })
    expect(useBatchStore.getState().selectedVms.map((row) => row.vmName)).toEqual(['VM-001', 'VM-002', 'VM-003', 'VM-004'])
    fireEvent.click(screen.getByRole('button', { name: 'VM-002' }), { ctrlKey: true })
    fireEvent.click(screen.getByRole('button', { name: 'VM-005' }), { metaKey: true })
    expect(useBatchStore.getState().selectedVms.map((row) => row.vmName)).toEqual(['VM-001', 'VM-003', 'VM-004', 'VM-005'])
    expect(screen.getByTestId('location')).toHaveTextContent('/pool/pool-b/vms')
    expect(screen.getByRole('checkbox', { name: 'Select all VMs' })).toBePartiallyChecked()
    fireEvent.click(screen.getByRole('button', { name: '名称', exact: true }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select VM-003' }), { shiftKey: true })
    expect(useBatchStore.getState().selectedVms.map((row) => row.vmName)).toEqual(['VM-001', 'VM-005', 'VM-004', 'VM-003'])
  })

  it('keeps hidden selections out of a visible Shift range and locks selection while submitting', async () => {
    setList(12)
    renderPage('/pool/pool-b/vms')
    await screen.findByRole('button', { name: 'VM-000' })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select VM-011' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Filter items' }), { target: { value: 'VM-00' } })
    fireEvent.click(screen.getByRole('button', { name: 'VM-001' }), { shiftKey: true })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select VM-003' }), { shiftKey: true })
    expect(useBatchStore.getState().selectedVms).toHaveLength(4)
    act(() => useBatchStore.setState({ isSubmitting: true }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select VM-000' }))
    expect(useBatchStore.getState().selectedVms).toHaveLength(4)
    expect(screen.getByRole('checkbox', { name: 'Select all VMs' })).toBeDisabled()
    act(() => useBatchStore.setState({ isSubmitting: false }))
  })

  it('handles macOS Ctrl clicks delivered as context menus without opening the VM', async () => {
    setList(3)
    renderPage('/pool/pool-b/vms')
    const first = await screen.findByRole('button', { name: 'VM-000' })
    fireEvent.contextMenu(first, { ctrlKey: true })
    fireEvent.contextMenu(screen.getByRole('button', { name: 'VM-002' }), { ctrlKey: true })
    expect(useBatchStore.getState().selectedVms.map((row) => row.vmName)).toEqual(['VM-000', 'VM-002'])
    fireEvent.contextMenu(first, { ctrlKey: true })
    expect(useBatchStore.getState().selectedVms.map((row) => row.vmName)).toEqual(['VM-002'])
    expect(screen.getByTestId('location')).toHaveTextContent('/pool/pool-b/vms')
  })

  it('renders every filtered row on one page and selects the complete result after sorting', async () => {
    setList(205)
    renderPage('/pool/pool-b/vms')
    await screen.findByRole('button', { name: 'VM-000' })
    expect(document.querySelectorAll('tbody tr')).toHaveLength(205)
    expect(screen.getByRole('button', { name: 'VM-204' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: '虚拟机列表分页' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '名称', exact: true }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all VMs' }))
    expect(useBatchStore.getState().selectedVms).toHaveLength(205)
    expect(screen.getByRole('checkbox', { name: 'Select all VMs' })).toBeChecked()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all VMs' }))
    expect(useBatchStore.getState().selectedVms).toEqual([])
  })

  it('shows all remaining rows after removal and preserves filtered selections', async () => {
    const rows = setList(205)
    renderPage('/pool/pool-b/vms')
    await screen.findByRole('button', { name: 'VM-000' })
    act(() => useMultiDataStore.setState({ vms: rows.slice(0, 110) }))
    expect(document.querySelectorAll('tbody tr')).toHaveLength(110)
    fireEvent.change(screen.getByRole('textbox', { name: 'Filter items' }), { target: { value: 'VM-00' } })
    expect(screen.getByRole('button', { name: 'VM-000' })).toBeInTheDocument()
    expect(document.querySelectorAll('tbody tr')).toHaveLength(10)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all VMs' }))
    expect(useBatchStore.getState().selectedVms).toHaveLength(10)
    fireEvent.change(screen.getByRole('textbox', { name: 'Filter items' }), { target: { value: '' } })
    expect(document.querySelectorAll('tbody tr')).toHaveLength(110)
    expect(useBatchStore.getState().selectedVms).toHaveLength(10)
  })

  it('keeps a provisioned VM unique while its old template cache is retained through refreshes', async () => {
    useMultiDataStore.setState({ vms: [] })
    vi.mocked(window.xapi.vm.templates).mockImplementation(async (id) => ({
      user: id === 'pool-b' ? [{ ...vm, is_a_template: true }] : [], system: [],
    }))
    renderPage('/pool/pool-b/vms')
    await screen.findByText('App VM')
    vi.mocked(window.xapi.vm.templates).mockRejectedValue(new Error('template refresh failed'))
    act(() => useMultiDataStore.getState().handleVmChangeEvent({ connectionId: 'pool-b', operation: 'mod', ref: vmRef,
      snapshot: vm, receivedAt: Date.now() }))
    expect(document.querySelectorAll('tbody tr')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'App VM' })).toBeInTheDocument()
    expect(screen.getByText('1 台虚拟机')).toBeInTheDocument()
    expect(screen.queryByText(/个用户模板/)).not.toBeInTheDocument()
    await screen.findByText(/template refresh failed/)
    for (let i = 0; i < 3; i++) {
      act(() => useMultiDataStore.setState({ vms: [{ ...vm, connectionId: 'pool-b', poolName: 'Pool B' }] }))
      expect(document.querySelectorAll('tbody tr')).toHaveLength(1)
    }
    // A normal VM refresh must also supersede a cached template if events were missed.
    act(() => useMultiDataStore.setState({ vms: [
      { ...vm, connectionId: 'pool-b', poolName: 'Pool B' },
      { ...vm, ref: 'another', uuid: 'another', connectionId: 'pool-b', poolName: 'Pool B' },
    ] }))
    expect(screen.getAllByRole('button', { name: 'App VM' })).toHaveLength(2)
  })

  it('keeps same-named objects and overlapping refs from different pools distinct', async () => {
    useMultiDataStore.setState({ vms: [
      { ...vm, connectionId: 'pool-a', poolName: 'Pool A' },
      { ...vm, connectionId: 'pool-b', poolName: 'Pool B' },
    ] })
    vi.mocked(window.xapi.vm.templates).mockImplementation(async () => ({
      user: [{ ...vm, ref: 'template', is_a_template: true, name_label: 'App VM' }], system: [],
    }))
    renderPage('/vms')
    await waitFor(() => expect(document.querySelectorAll('tbody tr')).toHaveLength(4))
    expect(screen.getAllByText('App VM')).toHaveLength(4)
  })

  it.each([
    { label: '名称', low: { name_label: 'VM-2' }, high: { name_label: 'VM-10' } },
    { label: '状态', low: { power_state: 'Halted' }, high: { power_state: 'Running' } },
    { label: 'IP 地址', low: { networks: { '0/ip': '192.0.2.2' } }, high: { networks: { '0/ip': '192.0.2.10' } }, missing: { guestMetricsError: 'IP read failed' } },
    { label: '资源池', low: { poolName: 'Pool 2' }, high: { poolName: 'Pool 10' } },
    { label: '主机', low: { connectionId: 'pool-a' }, high: { connectionId: 'pool-b' }, missing: { resident_on: 'OpaqueRef:NULL' } },
    { label: 'vCPU', low: { VCPUs_max: '2' }, high: { VCPUs_max: '10' }, missing: { VCPUs_max: undefined } },
    { label: '内存', low: { memory_static_max: String(2 * GIB) }, high: { memory_static_max: String(10 * GIB) }, missing: { memory_static_max: undefined } },
  ])('sorts $label in both directions using displayed values and leaves missing values last', async ({ label, low, high, missing }) => {
    const record = (ref: string, fields: object) => ({ ...vm, ref, uuid: ref, name_label: ref, connectionId: 'pool-b', poolName: 'Pool B', ...fields })
    const lowRow = record('low', low)
    const highRow = record('high', high)
    const absentRow = record('missing', missing ?? {})
    useMultiDataStore.setState({
      vms: [highRow, lowRow, ...(missing ? [absentRow] : [])] as any,
      hosts: [{ ref: 'host', name_label: 'Host 2', connectionId: 'pool-a' }, { ref: 'host', name_label: 'Host 10', connectionId: 'pool-b' }] as any,
    })
    renderPage('/vms')
    await screen.findByRole('button', { name: lowRow.name_label })
    const heading = screen.getByRole('columnheader', { name: label, exact: true })
    const sortButton = within(heading).getByRole('button', { name: label, exact: true })
    // The name column is the initial ascending order.
    if (label !== '名称') fireEvent.click(sortButton)
    const names = () => Array.from(document.querySelectorAll('tbody tr')).map((row) => row.querySelector('td:nth-child(3)')?.textContent)
    expect(names()).toEqual([lowRow.name_label, highRow.name_label, ...(missing ? [absentRow.name_label] : [])])
    expect(heading).toHaveAttribute('aria-sort', 'ascending')
    fireEvent.click(sortButton)
    expect(names()).toEqual([highRow.name_label, lowRow.name_label, ...(missing ? [absentRow.name_label] : [])])
    expect(heading).toHaveAttribute('aria-sort', 'descending')
    act(() => useMultiDataStore.setState({ vms: [lowRow, highRow, ...(missing ? [absentRow] : [])] as any }))
    expect(names()).toEqual([highRow.name_label, lowRow.name_label, ...(missing ? [absentRow.name_label] : [])])
  })

  it('sorts the type column and keeps the chosen order while filtering', async () => {
    vi.mocked(window.xapi.vm.templates).mockImplementation(async (id) => ({ user: id === 'pool-b'
      ? [{ ...vm, ref: 'template', name_label: 'Template', is_a_template: true }] : [], system: [] }))
    renderPage('/pool/pool-b/vms')
    await screen.findByText('Template')
    const button = screen.getByRole('button', { name: '类型', exact: true })
    fireEvent.click(button)
    expect(document.querySelector('tbody tr')).toHaveTextContent('App VM')
    fireEvent.click(button)
    expect(document.querySelector('tbody tr')).toHaveTextContent('Template')
    fireEvent.change(screen.getByRole('textbox', { name: 'Filter items' }), { target: { value: 'App' } })
    expect(document.querySelectorAll('tbody tr')).toHaveLength(1)
    fireEvent.change(screen.getByRole('textbox', { name: 'Filter items' }), { target: { value: '' } })
    expect(document.querySelector('tbody tr')).toHaveTextContent('Template')
    expect(screen.getByRole('columnheader', { name: '类型' })).toHaveAttribute('aria-sort', 'descending')
  })

  it('sorts by type then natural name and preserves priorities through refresh and filtering', async () => {
    useMultiDataStore.setState({ vms: ['VM-10', 'VM-2'].map((name_label) => ({ ...vm, ref: name_label, uuid: name_label, name_label, connectionId: 'pool-b', poolName: 'Pool B' })) })
    vi.mocked(window.xapi.vm.templates).mockResolvedValue({ user: ['VM-1', 'VM-3'].map((name_label) => ({ ...vm, ref: name_label, uuid: name_label, name_label, is_a_template: true })), system: [] })
    renderPage('/pool/pool-b/vms')
    await screen.findByText('VM-1')
    fireEvent.click(screen.getByRole('button', { name: '类型', exact: true }))
    fireEvent.click(screen.getByRole('button', { name: '名称', exact: true }), { shiftKey: true })
    const names = () => Array.from(document.querySelectorAll('tbody tr')).map((row) => row.querySelector('td:nth-child(3)')?.textContent)
    expect(names()).toEqual(['VM-2', 'VM-10', 'VM-1', 'VM-3'])
    expect(screen.getByRole('button', { name: '名称', exact: true })).toHaveAttribute('aria-description', '第 2 排序，升序')
    fireEvent.click(screen.getByRole('button', { name: '名称', exact: true }), { shiftKey: true })
    expect(names()).toEqual(['VM-10', 'VM-2', 'VM-3', 'VM-1'])
    act(() => useMultiDataStore.setState((state) => ({ vms: [...state.vms].reverse() })))
    fireEvent.change(screen.getByRole('textbox', { name: 'Filter items' }), { target: { value: 'VM-' } })
    expect(names()).toEqual(['VM-10', 'VM-2', 'VM-3', 'VM-1'])
    fireEvent.click(screen.getByRole('button', { name: '名称', exact: true }))
    expect(names()).toEqual(['VM-1', 'VM-2', 'VM-3', 'VM-10'])
    expect(screen.getByRole('columnheader', { name: '类型' })).not.toHaveAttribute('aria-sort')
  })

  it('places missing secondary values last in either direction and selects ranges in the combined order', async () => {
    useConnectionManagerStore.setState({ connections: [{ id: 'pool-b', name: 'Pool B', state: 'connected', epoch: 1, poolUuid: 'pool-b' }] as any })
    useMultiDataStore.setState({ vms: [
      { name_label: 'A', VCPUs_max: '10' }, { name_label: 'B', VCPUs_max: undefined }, { name_label: 'C', VCPUs_max: '2' },
    ].map((fields) => ({ ...vm, ...fields, ref: fields.name_label, uuid: fields.name_label, connectionId: 'pool-b', poolName: 'Pool B' })) })
    renderPage('/pool/pool-b/vms')
    await screen.findByRole('button', { name: 'A', exact: true })
    fireEvent.click(screen.getByRole('button', { name: '类型', exact: true }))
    fireEvent.click(screen.getByRole('button', { name: 'vCPU', exact: true }), { shiftKey: true })
    const names = () => Array.from(document.querySelectorAll('tbody tr')).map((row) => row.querySelector('td:nth-child(3)')?.textContent)
    expect(names()).toEqual(['C', 'A', 'B'])
    fireEvent.click(screen.getByRole('button', { name: 'vCPU', exact: true }), { shiftKey: true })
    expect(names()).toEqual(['A', 'C', 'B'])
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select A', exact: true }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select C', exact: true }), { shiftKey: true })
    expect(useBatchStore.getState().selectedVms.map((record) => record.vmName)).toEqual(['A', 'C'])
  })

  it('does not rebuild VM rows when only tasks or another resource read state changes', async () => {
    const readName = vi.fn(() => 'Stable VM')
    useMultiDataStore.setState({ vms: [{ ...vm, get name_label() { return readName() }, connectionId: 'pool-b', poolName: 'Pool B' }] })
    renderPage('/pool/pool-b/vms')
    await screen.findByRole('button', { name: 'Stable VM' })
    await act(async () => {})
    readName.mockClear()
    act(() => useMultiDataStore.setState({ tasks: [] }))
    act(() => useMultiDataStore.setState({ domainStates: { 'pool-b': { tasks: { loading: false, error: null, lastSuccessAt: Date.now() } as any } } }))
    act(() => useBatchStore.setState({ taskHistory: [] }))
    expect(readName).not.toHaveBeenCalled()
  })

  it('shows reported IPv4 and IPv6 in the list, deduplicates addresses and filters by IP', async () => {
    useMultiDataStore.setState({ vms: [{ ...vm, networks: { '0/ip': '192.0.2.23', '0/ipv4/0': '192.0.2.23', '1/ipv6/0': '2001:db8::23' }, connectionId: 'pool-b', poolName: 'Pool B' }] as any })
    renderPage('/pool/pool-b/vms')
    const row = (await screen.findByRole('button', { name: 'App VM' })).closest('tr')!
    expect(within(row).getAllByText('192.0.2.23')).toHaveLength(1)
    expect(within(row).getByText('2001:db8::23')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: 'Filter items' }), { target: { value: '2001:db8::23' } })
    expect(screen.getByRole('button', { name: 'App VM' })).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: 'Filter items' }), { target: { value: '192.0.2.99' } })
    expect(screen.queryByRole('button', { name: 'App VM' })).not.toBeInTheDocument()
  })

  it('distinguishes guest IP read failure, no reported address and a stopped VM', async () => {
    useMultiDataStore.setState({ vms: [
      { ...vm, ref: 'failed', name_label: 'Read failed', guestMetricsError: '客户机 IP 读取失败，请刷新重试', connectionId: 'pool-b', poolName: 'Pool B' },
      { ...vm, ref: 'missing', name_label: 'No tools', connectionId: 'pool-b', poolName: 'Pool B' },
      { ...vm, ref: 'stopped', name_label: 'Stopped', power_state: 'Halted', networks: { '0/ip': '192.0.2.99' }, connectionId: 'pool-b', poolName: 'Pool B' },
    ] as any })
    renderPage('/pool/pool-b/vms')
    expect(await screen.findByText('读取失败')).toHaveAttribute('title', '客户机 IP 读取失败，请刷新重试')
    expect(screen.getByText('未上报')).toBeInTheDocument()
    expect(screen.queryByText('192.0.2.99')).not.toBeInTheDocument()
  })

  it('keeps secondary actions behind a keyboard accessible menu and restores focus after confirmation', async () => {
    renderPage()
    await screen.findByRole('button', { name: '关闭', exact: true })
    expect(screen.queryByRole('button', { name: '强制关闭' })).not.toBeInTheDocument()
    const summary = screen.getByText('更多操作', { selector: 'summary' })
    fireEvent.click(summary)
    expect(screen.getByRole('group', { name: '电源操作' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: '管理操作' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: '危险操作' })).toBeInTheDocument()
    fireEvent.keyDown(summary, { key: 'Escape' })
    expect(summary).toHaveFocus()
    expect(screen.queryByRole('button', { name: '强制关闭' })).not.toBeInTheDocument()
    fireEvent.click(summary)
    fireEvent.click(screen.getByRole('button', { name: '强制关闭' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: '确认强制关闭虚拟机' })).getByRole('button', { name: '取消' }))
    await waitFor(() => expect(summary).toHaveFocus())
    expect(window.xapi.vm.forceShutdown).not.toHaveBeenCalled()
  })

  it('restores reboot and force shutdown with risk confirmation before submission', async () => {
    renderPage()
    expect(await screen.findByRole('button', { name: '重启', exact: true })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '重启', exact: true }))
    const dialog = screen.getByRole('dialog', { name: '确认重启虚拟机' })
    expect(dialog).toHaveTextContent('服务会暂时中断')
    expect(window.xapi.vm.reboot).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: '重启', exact: true }))
    await waitFor(() => expect(window.xapi.vm.reboot).toHaveBeenCalledOnce())
    fireEvent.click(screen.getByText('更多操作', { selector: 'summary' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '强制关闭' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '强制关闭' }))
    expect(screen.getByRole('dialog', { name: '确认强制关闭虚拟机' })).toHaveTextContent('未保存的数据可能丢失')
    expect(window.xapi.vm.forceShutdown).not.toHaveBeenCalled()
  })

  it('refreshes start-operation blockers on the overview tab even without VM events', async () => {
    vi.useFakeTimers()
    vm = { ...vm, current_operations: { task: 'start' } }
    await act(async () => { renderPage() })
    expect(screen.getByRole('button', { name: '关闭', exact: true })).toBeDisabled()
    expect(screen.getByText(/VM 正在执行：start/)).toBeInTheDocument()
    vm = { ...vm, current_operations: {} }
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(screen.getByRole('button', { name: '关闭', exact: true })).toBeEnabled()
  })

  it('explains a failed refresh and recovers the controls after a successful reread', async () => {
    renderPage()
    await screen.findByRole('button', { name: '关闭', exact: true })
    vi.mocked(window.xapi.vm.getRecord).mockRejectedValueOnce(new Error('读取中断'))
    fireEvent.click(screen.getByRole('button', { name: '刷新', exact: true }))
    expect(await screen.findByRole('alert')).toHaveTextContent('读取中断')
    expect(screen.getByRole('button', { name: '关闭', exact: true })).toHaveAttribute('title', 'VM 状态读取失败，请刷新后再操作')
    fireEvent.click(screen.getByRole('button', { name: '刷新', exact: true }))
    await waitFor(() => expect(screen.getByRole('button', { name: '关闭', exact: true })).toBeEnabled())
  })

  it('blocks list actions on stale VM data and exposes a reread control', async () => {
    useMultiDataStore.setState({ domainStates: { 'pool-b': { vms: { error: '列表中断', loading: false, lastSuccessAt: 100 } } } })
    await act(async () => { renderPage('/pool/pool-b/vms') })
    expect(screen.getByRole('alert')).toHaveTextContent('列表中断')
    expect(screen.getAllByTitle('VM 列表读取失败，请刷新后再操作').every((button) => button.hasAttribute('disabled'))).toBe(true)
    expect(screen.getByRole('button', { name: '重新读取 VM 列表' })).toBeEnabled()
  })

  it('opens a device deep link and preserves tabs through browser history', async () => {
    renderPage(`${route}?tab=network`)
    expect(await screen.findByRole('button', { name: '添加虚拟网卡' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '网络', exact: true })).toHaveAttribute('aria-selected', 'true')
    tab('存储')
    expect(await screen.findByText('Data disk')).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('tab=storage')
    fireEvent.click(screen.getByRole('button', { name: '浏览器后退' }))
    expect(await screen.findByRole('button', { name: '添加虚拟网卡' })).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('tab=network')
    fireEvent.click(screen.getByRole('button', { name: '浏览器前进' }))
    expect(await screen.findByText('Data disk')).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('tab=storage')
  })

  it('falls back to overview for unknown tabs and navigates to the host in the VM pool', async () => {
    renderPage(`${route}?tab=invalid`)
    expect(await screen.findByRole('button', { name: 'Correct Host' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '概览' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByText('Wrong Host')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Correct Host' }))
    expect(screen.getByTestId('location')).toHaveTextContent('/pool/pool-b/hosts/host')
  })

  it('navigates from the overview to devices and from a VIF to its scoped network', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: '管理虚拟网卡' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Production Network' }))
    expect(screen.getByTestId('location')).toHaveTextContent('/pool/pool-b/networks?network=network')
  })

  it('shows disk ownership and opens the matching storage repository', async () => {
    renderPage(`${route}?tab=storage`)
    fireEvent.click(await screen.findByRole('button', { name: '存储仓库：Correct SR' }))
    expect(screen.getByTestId('location')).toHaveTextContent('/pool/pool-b/storage?sr=sr')
    expect(screen.queryByText('Wrong SR')).not.toBeInTheDocument()
  })

  it('requires target and impact confirmation for shutdown, supports cancel, and refreshes the final state', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: '关闭', exact: true }))
    const confirmation = screen.getByRole('dialog', { name: '确认关闭虚拟机' })
    expect(confirmation).toHaveTextContent('Pool B')
    expect(confirmation).toHaveTextContent('App VM')
    expect(confirmation).toHaveTextContent('服务会停止')
    expect(window.xapi.vm.shutdown).not.toHaveBeenCalled()
    fireEvent.click(within(confirmation).getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '关闭', exact: true })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '关闭', exact: true }))
    fireEvent.click(within(screen.getByRole('dialog', { name: '确认关闭虚拟机' })).getByRole('button', { name: '关闭', exact: true }))
    await waitFor(() => expect(window.xapi.vm.shutdown).toHaveBeenCalledWith('pool-b', vmRef, expect.objectContaining({ vmUuid: 'vm' })))
    await waitFor(() => expect(screen.getByRole('button', { name: '启动', exact: true })).toBeEnabled())
    fireEvent.click(screen.getByText('更多操作', { selector: 'summary' }))
    expect(screen.getByRole('button', { name: '强制关闭' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '重启' })).toBeDisabled()
  })

  it('completes suspend and resume through visible detail controls', async () => {
    renderPage()
    await screen.findByRole('button', { name: '关闭', exact: true })
    fireEvent.click(screen.getByText('更多操作', { selector: 'summary' }))
    fireEvent.click(screen.getByRole('button', { name: '挂起', exact: true }))
    const dialog = screen.getByRole('dialog', { name: '确认挂起虚拟机' })
    expect(dialog).toHaveTextContent('内存状态保存到存储')
    expect(window.xapi.vm.suspend).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: '挂起', exact: true }))
    await waitFor(() => expect(screen.getByRole('button', { name: '从挂起恢复' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '从挂起恢复' }))
    await waitFor(() => expect(window.xapi.vm.resume).toHaveBeenCalledWith('pool-b', vmRef, expect.objectContaining({ vmUuid: 'vm' })))
    await screen.findByRole('button', { name: '关闭', exact: true })
    fireEvent.click(screen.getByText('更多操作', { selector: 'summary' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '挂起', exact: true })).toBeEnabled())
  })

  it('offers resume on a suspended VM in the list and preserves state and XAPI permission guards', async () => {
    vm = { ...vm, power_state: 'Suspended', allowed_operations: ['resume'] }
    useMultiDataStore.setState({ vms: [{ ...vm, connectionId: 'pool-b', poolName: 'Pool B' }] as any })
    renderPage('/pool/pool-b/vms')
    fireEvent.click(await screen.findByRole('button', { name: '从挂起恢复' }))
    await waitFor(() => expect(window.xapi.vm.resume).toHaveBeenCalledWith('pool-b', vmRef, expect.objectContaining({ vmUuid: 'vm' })))
    expect(canRunVmAction({ ...vm, power_state: 'Running' }, 'resume').canRun).toBe(false)
    expect(canRunVmAction({ ...vm, allowed_operations: [] }, 'resume').canRun).toBe(false)
    expect(canRunVmAction({ ...vm, power_state: 'Running', allowed_operations: ['suspend'], locked: true }, 'suspend').canRun).toBe(false)
  })

  it('explains VIF deletion, cancels without mutation, and lets users continue after a definite failure', async () => {
    vi.mocked(window.xapi.vif.destroy).mockRejectedValueOnce(new Error('权限不足'))
    const changed = vi.fn().mockResolvedValue(undefined)
    render(<ToastProvider><VifManager connectionId="pool-b" vmRef={vmRef} vifs={[vif]} networks={useMultiDataStore.getState().networks.filter((network) => network.connectionId === 'pool-b')} guestNetworks={{}} onChanged={changed} /></ToastProvider>)
    fireEvent.click(screen.getByRole('button', { name: '删除虚拟网卡' }))
    let dialog = screen.getByRole('dialog', { name: '删除虚拟网卡' })
    expect(dialog).toHaveTextContent('00:11:22:33:44:55')
    expect(dialog).toHaveTextContent('Production Network')
    expect(dialog).toHaveTextContent('网络本身会保留')
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }))
    expect(window.xapi.vif.destroy).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '删除虚拟网卡' }))
    dialog = screen.getByRole('dialog', { name: '删除虚拟网卡' })
    fireEvent.click(within(dialog).getByRole('button', { name: '确认删除' }))
    await waitFor(() => expect(changed).toHaveBeenCalledOnce())
    expect(await screen.findByText('删除虚拟网卡失败：权限不足')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: '取消' })).toBeEnabled()
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }))
    expect(screen.getByRole('button', { name: '添加虚拟网卡' })).toBeEnabled()
  })
})
