import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Link, MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import VmsPage from '../../src/renderer/src/pages/VmsPage'
import NetworksPage from '../../src/renderer/src/pages/NetworksPage'
import StoragePage from '../../src/renderer/src/pages/StoragePage'
import VmDetailPage from '../../src/renderer/src/pages/VmDetailPage'
import HostDetailPage from '../../src/renderer/src/pages/HostDetailPage'
import Sidebar from '../../src/renderer/src/components/layout/Sidebar'
import Breadcrumb from '../../src/renderer/src/components/layout/Breadcrumb'
import { useConnectionManagerStore } from '../../src/renderer/src/store/connectionManager.store'
import { useMultiDataStore } from '../../src/renderer/src/store/multiData.store'
import { feedback } from '../../src/renderer/src/store/feedback.store'

const routerFuture = {
  v7_startTransition: true,
  v7_relativeSplatPath: true,
} as const

vi.mock('../../src/renderer/src/components/wizard/CreateVmWizard', () => ({
  CreateVmWizard: ({ connectionId, initialHostRef }: { connectionId: string; initialHostRef?: string }) => (
    <div data-testid="create-vm-connection" data-host={initialHostRef}>{connectionId}</div>
  ),
}))

vi.mock('../../src/renderer/src/components/vm/VmImportDialog', () => ({
  VmImportDialog: ({ connectionId }: { connectionId: string }) => (
    <div data-testid="import-vm-connection">{connectionId}</div>
  ),
}))

vi.mock('../../src/renderer/src/components/network/CreateNetworkDialog', () => ({
  CreateNetworkDialog: ({ connectionId }: { connectionId: string }) => (
    <div data-testid="create-network-connection">{connectionId}</div>
  ),
}))

vi.mock('../../src/renderer/src/components/batch/BatchToolbar', () => ({
  BatchToolbar: () => null,
}))

vi.mock('../../src/renderer/src/components/batch/BatchProgressDialog', () => ({
  BatchProgressDialog: () => null,
}))

vi.mock('../../src/renderer/src/components/vm/VmExportDialog', () => ({
  VmExportDialog: () => null,
}))

vi.mock('../../src/renderer/src/components/vm/DeleteVmDialog', () => ({
  DeleteVmDialog: () => null,
}))

vi.mock('../../src/renderer/src/components/template/CloneTemplateDialog', () => ({
  CloneTemplateDialog: () => null,
}))

vi.mock('../../src/renderer/src/components/template/DeleteTemplateDialog', () => ({
  DeleteTemplateDialog: () => null,
}))

vi.mock('../../src/renderer/src/components/template/TemplateSettingsDialog', () => ({
  TemplateSettingsDialog: () => null,
}))

vi.mock('../../src/renderer/src/components/network/BondList', () => ({
  BondList: () => null,
}))

vi.mock('../../src/renderer/src/components/network/VlanList', () => ({
  VlanList: () => null,
}))

vi.mock('../../src/renderer/src/pages/vm-detail/OverviewTab', () => ({
  OverviewTab: () => <div>VM overview</div>,
}))

vi.mock('../../src/renderer/src/pages/vm-detail/ConsoleTab', () => ({
  ConsoleTab: () => null,
}))

vi.mock('../../src/renderer/src/pages/vm-detail/SnapshotsTab', () => ({
  SnapshotsTab: () => null,
}))

vi.mock('../../src/renderer/src/components/vm/VifManager', () => ({
  VifManager: ({ guestNetworks, vifs, networks }: { guestNetworks: Record<string, string>; vifs: unknown[]; networks: { name_label: string }[] }) => (
    <div data-testid="vm-network-data">{JSON.stringify({ guestNetworks, vifCount: vifs.length, networkNames: networks.map((network) => network.name_label) })}</div>
  ),
}))

vi.mock('../../src/renderer/src/components/vm/VmMonitorTab', () => ({
  VmMonitorTab: () => null,
}))

vi.mock('../../src/renderer/src/components/vm/VmStorageTab', () => ({
  VmStorageTab: () => null,
}))

vi.mock('../../src/renderer/src/components/vm/VmAdvancedSettingsTab', () => ({
  VmAdvancedSettingsTab: ({ connectionId }: { connectionId: string }) => (
    <div data-testid="vm-advanced-connection">{connectionId}</div>
  ),
}))

vi.mock('../../src/renderer/src/components/host/HostMonitorTab', () => ({
  HostMonitorTab: () => null,
}))

vi.mock('../../src/renderer/src/components/patch/HostPatchesTab', () => ({
  HostPatchesTab: ({ connectionId }: { connectionId: string }) => (
    <div data-testid="host-patches-connection">{connectionId}</div>
  ),
}))

vi.mock('../../src/renderer/src/components/ha/HaSettingsTab', () => ({
  HaSettingsTab: ({ connectionId }: { connectionId: string }) => (
    <div data-testid="ha-settings-connection">{connectionId}</div>
  ),
}))

vi.mock('../../src/renderer/src/components/sr/CreateSrWizard', () => ({
  default: ({ connectionId, hostRef }: { connectionId: string; hostRef: string }) => (
    <div data-testid="create-sr-target">{connectionId}:{hostRef}</div>
  ),
}))

vi.mock('../../src/renderer/src/components/sr/SrDetailPanel', () => ({
  default: ({ connectionId, sr }: { connectionId: string; sr: { ref: string } }) => (
    <div data-testid="sr-detail-connection">{connectionId}:{sr.ref}</div>
  ),
}))

vi.mock('../../src/renderer/src/components/sr/SrActions', () => ({
  default: () => null,
}))

function SwitchVmPool() {
  const navigate = useNavigate()
  return <button onClick={() => navigate('/pool/conn-a/vms/OpaqueRef%3Avm')}>切换 VM 池</button>
}

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location">{location.pathname + location.search}</div>
}

function userTemplate(
  other_config: Record<string, string> = { instant: 'true' },
  overrides: Record<string, unknown> = {},
) {
  return {
    ref: 'OpaqueRef:user-template',
    name_label: 'User Template',
    name_description: '',
    is_a_template: true,
    is_a_snapshot: false,
    is_default_template: false,
    power_state: 'Halted',
    allowed_operations: ['clone'],
    other_config,
    VBDs: [],
    VIFs: [],
    ...overrides,
  }
}

function deferred() {
  let resolve!: () => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function getTemplateRow(name: string): HTMLElement {
  const row = screen.getByText(name).closest('tr')
  if (!row) throw new Error(`Missing template row: ${name}`)
  return row
}

function getQuickCreateAction(name: string): HTMLElement {
  fireEvent.click(within(getTemplateRow(name)).getByTitle('操作'))
  return screen.getByRole('button', { name: '快速创建 VM' })
}

function keepUnrelatedTemplateLoadingPending(): void {
  ;(window.xapi.vm.templates as any) = vi.fn(() => new Promise(() => {}))
}

describe('pool-scoped pages', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    const hostARecord = {
      ref: 'OpaqueRef:host-a',
      uuid: 'host-a',
      name_label: 'Host A',
      hostname: 'host-a',
      address: 'a.example',
      enabled: true,
      resident_VMs: [],
      memory_total: 16,
      memory_free: 8,
      cpu_info: {},
      software_version: {},
      metrics: 'OpaqueRef:NULL',
      suspend_image_sr: 'OpaqueRef:NULL',
      connectionId: 'conn-a',
      poolName: 'Pool A',
    }
    const hostRecord = {
      ref: 'OpaqueRef:host',
      uuid: 'host',
      name_label: 'Host B',
      hostname: 'host-b',
      address: 'b.example',
      enabled: true,
      resident_VMs: [],
      memory_total: 16,
      memory_free: 8,
      cpu_info: {},
      software_version: {},
      metrics: 'OpaqueRef:NULL',
      suspend_image_sr: 'OpaqueRef:NULL',
      connectionId: 'conn-b',
      poolName: 'Pool B',
    }
    const srARecord = {
      ref: 'OpaqueRef:same-sr',
      uuid: 'sr-a',
      name_label: 'SR A',
      name_description: '',
      type: 'ext',
      content_type: 'user',
      shared: true,
      physical_size: 100,
      physical_utilisation: 10,
      virtual_allocation: 10,
      VDIs: [],
      PBDs: [],
      connectionId: 'conn-a',
      poolName: 'Pool A',
    }
    const srBRecord = {
      ...srARecord,
      uuid: 'sr-b',
      name_label: 'SR B',
      physical_utilisation: 20,
      connectionId: 'conn-b',
      poolName: 'Pool B',
    }
    useConnectionManagerStore.setState({
      connections: [
        { id: 'conn-a', name: 'Pool A', host: 'a.example', port: 443, username: 'root', state: 'connected', poolName: 'Pool A' },
        { id: 'conn-b', name: 'Pool B', host: 'b.example', port: 443, username: 'root', state: 'connected', poolName: 'Pool B' },
      ] as any,
      activeConnectionId: 'conn-a',
      isLoading: false,
      error: null,
    })
    useMultiDataStore.setState({
      vms: [],
      hosts: [hostARecord, hostRecord],
      srs: [srARecord, srBRecord],
      networks: [],
      tasks: [],
      pools: [
        { ref: 'OpaqueRef:pool-a', name_label: 'Pool A', connectionId: 'conn-a' },
        { ref: 'OpaqueRef:pool-b', name_label: 'Pool B', connectionId: 'conn-b' },
      ],
      refreshVms: vi.fn().mockResolvedValue(undefined),
      refreshHosts: vi.fn().mockImplementation(async () => {
        useMultiDataStore.setState({ hosts: [hostARecord, hostRecord] } as any)
      }),
      refreshSrs: vi.fn().mockResolvedValue(undefined),
      refreshNetworks: vi.fn().mockResolvedValue(undefined),
      refreshTasks: vi.fn().mockResolvedValue(undefined),
    } as any)
    Object.assign(window.xapi, {
      vm: {
        templates: vi.fn().mockResolvedValue({ user: [], system: [] }),
        getRecord: vi.fn().mockResolvedValue({
          ref: 'OpaqueRef:vm',
          uuid: 'vm',
          name_label: 'VM B',
          name_description: '',
          power_state: 'Halted',
          resident_on: 'OpaqueRef:host',
          VCPUs_max: 2,
          VCPUs_at_startup: 2,
          memory_static_max: 2,
          memory_dynamic_max: 2,
          is_a_template: false,
          is_control_domain: false,
          VBDs: [],
          VIFs: [],
          metrics: 'OpaqueRef:NULL',
          guest_metrics: 'OpaqueRef:NULL',
          consoles: [],
          memory_static_min: 0,
          memory_dynamic_min: 0,
          os_version: {},
          networks: {},
        }),
      },
      network: {
        list: vi.fn().mockResolvedValue([]),
        listPifs: vi.fn().mockReturnValue(new Promise(() => {})),
      },
    })
  })

  it('passes the route connection to VM create and import dialogs', () => {
    keepUnrelatedTemplateLoadingPending()
    render(
      <MemoryRouter future={routerFuture} initialEntries={['/pool/conn-b/vms']}>
        <Routes>
          <Route path="/pool/:connectionId/vms" element={<VmsPage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByTestId('create-vm-connection')).toHaveTextContent('conn-b')
    expect(screen.getByTestId('import-vm-connection')).toHaveTextContent('conn-b')
  })

  it('does not use the active connection for ambiguous global VM create and import actions', () => {
    keepUnrelatedTemplateLoadingPending()
    render(
      <MemoryRouter future={routerFuture} initialEntries={['/vms']}>
        <Routes>
          <Route path="/vms" element={<VmsPage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByRole('button', { name: 'Create new virtual machine' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Import virtual machine' })).toBeDisabled()
    expect(screen.getByTestId('create-vm-connection')).toHaveTextContent('')
    expect(screen.getByTestId('import-vm-connection')).toHaveTextContent('')
  })

  it('uses the sidebar scope for VM create and import actions', () => {
    keepUnrelatedTemplateLoadingPending()
    render(<MemoryRouter future={routerFuture} initialEntries={['/vms']}>
      <Sidebar /><Routes><Route path="/vms" element={<VmsPage />} /><Route path="/pool/:connectionId/vms" element={<VmsPage />} /></Routes>
    </MemoryRouter>)
    fireEvent.click(screen.getByRole('link', { name: '资源池 Pool B' }))
    expect(screen.getByRole('button', { name: 'Create new virtual machine' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Import virtual machine' })).toBeEnabled()
    expect(screen.getByTestId('create-vm-connection')).toHaveTextContent('conn-b')
    expect(screen.getByTestId('import-vm-connection')).toHaveTextContent('conn-b')
  })

  it('reloads VM templates when a connected pool is added while the VM page is open', async () => {
    const templateFor = (connectionId: string, name: string) => ({
      ref: `OpaqueRef:${connectionId}-template`,
      uuid: `${connectionId}-template`,
      name_label: name,
      name_description: '',
      is_a_template: true,
      is_a_snapshot: false,
      is_control_domain: false,
      is_default_template: false,
      other_config: {},
      VBDs: [],
      VIFs: [],
    })
    const templates = vi.fn((connectionId: string) => Promise.resolve({
      user: connectionId === 'conn-a'
        ? [templateFor(connectionId, 'Pool A Template')]
        : [templateFor(connectionId, 'Pool B Template')],
      system: [],
    }))
    ;(window.xapi.vm.templates as any) = templates

    useConnectionManagerStore.setState({
      connections: [
        { id: 'conn-a', name: 'Pool A', host: 'a.example', port: 443, username: 'root', state: 'connected', poolName: 'Pool A' },
      ] as any,
      activeConnectionId: 'conn-a',
    })

    render(
      <MemoryRouter future={routerFuture} initialEntries={['/vms']}>
        <Routes>
          <Route path="/vms" element={<VmsPage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText('Pool A Template')).toBeInTheDocument()
    expect(screen.queryByText('Pool B Template')).not.toBeInTheDocument()

    act(() => {
      useConnectionManagerStore.setState({
        connections: [
          { id: 'conn-a', name: 'Pool A', host: 'a.example', port: 443, username: 'root', state: 'connected', poolName: 'Pool A' },
          { id: 'conn-b', name: 'Pool B', host: 'b.example', port: 443, username: 'root', state: 'connected', poolName: 'Pool B' },
        ] as any,
        activeConnectionId: 'conn-b',
      })
    })

    expect(await screen.findByText('Pool B Template')).toBeInTheDocument()
    expect(templates).toHaveBeenCalledWith('conn-b')
  })

  it('hides system templates by default and allows showing them through the type filter', async () => {
    ;(window.xapi.vm.templates as any) = vi.fn().mockResolvedValue({
      user: [userTemplate()],
      system: [{
        ref: 'OpaqueRef:system-template',
        uuid: 'system-template',
        name_label: 'XCP-ng System Template',
        name_description: '',
        is_a_template: true,
        is_a_snapshot: false,
        is_control_domain: false,
        is_default_template: true,
        other_config: { default_template: 'true' },
        VBDs: [],
        VIFs: [],
      }],
    })
    useConnectionManagerStore.setState({
      connections: [
        { id: 'conn-a', name: 'Pool A', host: 'a.example', port: 443, username: 'root', state: 'connected', poolName: 'Pool A' },
      ] as any,
      activeConnectionId: 'conn-a',
    })

    render(
      <MemoryRouter future={routerFuture} initialEntries={['/vms']}>
        <Routes>
          <Route path="/vms" element={<VmsPage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText('User Template')).toBeInTheDocument()
    expect(screen.queryByText('XCP-ng System Template')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '虚拟机、用户模板' }))
    const systemFilter = screen.getByRole('checkbox', { name: '系统模板' })
    expect(systemFilter).not.toBeChecked()
    fireEvent.click(systemFilter)
    expect(screen.getByText('XCP-ng System Template')).toBeInTheDocument()
    fireEvent.click(systemFilter)
    expect(screen.queryByText('XCP-ng System Template')).not.toBeInTheDocument()
  })

  it('quick creates from a user template once and refreshes VMs after completion', async () => {
    const create = deferred()
    const quickCreateFromTemplate = vi.fn(() => create.promise)
    const success = vi.spyOn(feedback, 'success').mockImplementation(() => undefined)
    const refreshVms = vi.fn().mockResolvedValue(undefined)
    useMultiDataStore.setState({ refreshVms } as any)
    ;(window.xapi.vm as any).quickCreateFromTemplate = quickCreateFromTemplate
    ;(window.xapi.vm.templates as any) = vi.fn().mockResolvedValue({ user: [userTemplate()], system: [] })

    render(<MemoryRouter future={routerFuture} initialEntries={['/pool/conn-a/vms']}>
      <Routes><Route path="/pool/:connectionId/vms" element={<VmsPage />} /></Routes>
    </MemoryRouter>)

    await screen.findByText('User Template')
    const action = getQuickCreateAction('User Template')
    act(() => { action.click(); action.click() })
    expect(quickCreateFromTemplate).toHaveBeenCalledOnce()
    expect(quickCreateFromTemplate).toHaveBeenCalledWith('conn-a', 'OpaqueRef:user-template')
    expect(within(getTemplateRow('User Template')).getByText('处理中...')).toBeInTheDocument()
    expect(success).not.toHaveBeenCalled()

    await act(async () => { create.resolve(); await create.promise })
    await waitFor(() => expect(success).toHaveBeenCalledWith('已从模板创建并启动虚拟机：User Template'))
    expect(refreshVms).toHaveBeenCalled()
  })

  it('offers quick create for an instant template and explains automatic start', async () => {
    ;(window.xapi.vm.templates as any) = vi.fn().mockResolvedValue({
      user: [userTemplate({ instant: 'true' })], system: [],
    })
    render(<MemoryRouter future={routerFuture} initialEntries={['/pool/conn-a/vms']}>
      <Routes><Route path="/pool/:connectionId/vms" element={<VmsPage />} /></Routes>
    </MemoryRouter>)
    await screen.findByText('User Template')
    expect(getQuickCreateAction('User Template')).toHaveAttribute('title', '沿用模板配置创建并启动 VM')
  })

  it('enables a missing instant marker once and reloads only the original pool without creating a VM', async () => {
    const enable = deferred()
    const enableInstantCreate = vi.fn(() => enable.promise)
    const quickCreateFromTemplate = vi.fn()
    let marked = false
    const templates = vi.fn().mockImplementation(async () => ({ user: [userTemplate(marked ? { instant: 'true' } : {})], system: [] }))
    Object.assign(window.xapi, { template: { enableInstantCreate } })
    ;(window.xapi.vm as any).quickCreateFromTemplate = quickCreateFromTemplate
    ;(window.xapi.vm as any).templates = templates
    render(<MemoryRouter future={routerFuture} initialEntries={['/pool/conn-a/vms']}>
      <Routes><Route path="/pool/:connectionId/vms" element={<VmsPage />} /></Routes>
    </MemoryRouter>)
    await screen.findByText('User Template')
    const before = templates.mock.calls.length
    fireEvent.click(within(getTemplateRow('User Template')).getByTitle('操作'))
    expect(screen.queryByRole('button', { name: '快速创建 VM' })).not.toBeInTheDocument()
    const action = screen.getByRole('button', { name: '启用快速创建' })
    act(() => { action.click(); action.click() })
    expect(enableInstantCreate).toHaveBeenCalledOnce()
    expect(enableInstantCreate).toHaveBeenCalledWith('conn-a', 'OpaqueRef:user-template')
    marked = true
    await act(async () => { enable.resolve(); await enable.promise })
    await waitFor(() => expect(within(getTemplateRow('User Template')).queryByText('处理中...')).not.toBeInTheDocument())
    expect(templates.mock.calls.slice(before)).toEqual([['conn-a']])
    expect(getQuickCreateAction('User Template')).toBeEnabled()
    expect(quickCreateFromTemplate).not.toHaveBeenCalled()
  })

  it.each([
    [{ Locked: true }, '模板已锁定'],
    [{ current_operations: { task: 'copy' } }, '模板正在执行其他操作'],
    [{ blocked_operations: { clone: '管理员禁止克隆' } }, '管理员禁止克隆'],
  ])('disables quick create with the current template reason: %j', async (state, reason) => {
    ;(window.xapi.vm as any).templates = vi.fn().mockResolvedValue({ user: [userTemplate({ instant: 'true' }, state)], system: [] })
    render(<MemoryRouter future={routerFuture} initialEntries={['/pool/conn-a/vms']}>
      <Routes><Route path="/pool/:connectionId/vms" element={<VmsPage />} /></Routes>
    </MemoryRouter>)
    await screen.findByText('User Template')
    const action = getQuickCreateAction('User Template')
    expect(action).toBeDisabled()
    expect(action).toHaveAttribute('title', reason)
  })

  it.each(['VM_CREATED_START_INCOMPLETE', 'VM_QUICK_CREATE_INCOMPLETE', 'VM_QUICK_CREATE_OUTCOME_UNKNOWN'])(
    'reports retained or unconfirmed results as a warning: %s', async (code) => {
      const warning = vi.spyOn(feedback, 'warning').mockImplementation(() => undefined)
      const error = vi.spyOn(feedback, 'error').mockImplementation(() => undefined)
      ;(window.xapi.vm as any).quickCreateFromTemplate = vi.fn().mockRejectedValue(Object.assign(new Error('请核对已有 VM OpaqueRef:retained'), { code }))
      ;(window.xapi.vm as any).templates = vi.fn().mockResolvedValue({ user: [userTemplate()], system: [] })
      render(<MemoryRouter future={routerFuture} initialEntries={['/pool/conn-a/vms']}>
        <Routes><Route path="/pool/:connectionId/vms" element={<VmsPage />} /></Routes>
      </MemoryRouter>)
      await screen.findByText('User Template')
      fireEvent.click(getQuickCreateAction('User Template'))
      await waitFor(() => expect(warning).toHaveBeenCalledWith('请核对已有 VM OpaqueRef:retained'))
      expect(error).not.toHaveBeenCalled()
    },
  )

  it('does not refresh a replacement pool when the original quick create completes', async () => {
    const create = deferred()
    const info = vi.spyOn(feedback, 'info').mockImplementation(() => undefined)
    const refreshVms = vi.fn().mockResolvedValue(undefined)
    useMultiDataStore.setState({ refreshVms } as any)
    ;(window.xapi.vm as any).quickCreateFromTemplate = vi.fn(async () => { await create.promise; return 'OpaqueRef:new-vm' })
    ;(window.xapi.vm as any).templates = vi.fn().mockResolvedValue({ user: [userTemplate()], system: [] })
    render(<MemoryRouter future={routerFuture} initialEntries={['/pool/conn-a/vms']}>
      <Routes><Route path="/pool/:connectionId/vms" element={<VmsPage />} /></Routes>
    </MemoryRouter>)
    await screen.findByText('User Template')
    fireEvent.click(getQuickCreateAction('User Template'))
    act(() => useConnectionManagerStore.setState((state) => ({ connections: state.connections.map((connection) => connection.id === 'conn-a' ? { ...connection, poolUuid: 'replacement-pool', epoch: 2 } : connection) })))
    await act(async () => { create.resolve(); await create.promise })
    await waitFor(() => expect(info).toHaveBeenCalledWith('Pool A 的虚拟机已创建并启动（OpaqueRef:new-vm），请连接原资源池查看'))
    expect(refreshVms).not.toHaveBeenCalledWith({ afterMutation: true, connectionId: 'conn-a' })
  })

  it('does not report creation failure when only the VM list refresh fails', async () => {
    const quickCreateFromTemplate = vi.fn().mockResolvedValue('OpaqueRef:new-vm')
    const info = vi.spyOn(feedback, 'info').mockImplementation(() => undefined)
    const error = vi.spyOn(feedback, 'error').mockImplementation(() => undefined)
    const refreshVms = vi.fn().mockResolvedValue(undefined)
    useMultiDataStore.setState({ refreshVms } as any)
    ;(window.xapi.vm as any).quickCreateFromTemplate = quickCreateFromTemplate
    ;(window.xapi.vm.templates as any) = vi.fn().mockResolvedValue({ user: [userTemplate()], system: [] })

    render(<MemoryRouter future={routerFuture} initialEntries={['/pool/conn-a/vms']}>
      <Routes><Route path="/pool/:connectionId/vms" element={<VmsPage />} /></Routes>
    </MemoryRouter>)
    await screen.findByText('User Template')
    await waitFor(() => expect(refreshVms).toHaveBeenCalled())
    refreshVms.mockRejectedValueOnce(new Error('refresh failed'))
    fireEvent.click(getQuickCreateAction('User Template'))
    await waitFor(() => expect(info).toHaveBeenCalledWith('虚拟机已创建并启动（OpaqueRef:new-vm），列表刷新失败，请手动刷新'))
    expect(error).not.toHaveBeenCalled()
  })

  it('does not offer quick create for a system template', async () => {
    ;(window.xapi.vm.templates as any) = vi.fn().mockResolvedValue({
      user: [], system: [{ ...userTemplate(), ref: 'OpaqueRef:system-template', name_label: 'System Template' }],
    })
    render(<MemoryRouter future={routerFuture} initialEntries={['/pool/conn-a/vms']}>
      <Routes><Route path="/pool/:connectionId/vms" element={<VmsPage />} /></Routes>
    </MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: '虚拟机、用户模板' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '系统模板' }))
    fireEvent.click(screen.getByRole('button', { name: '全部类型' }))
    await screen.findByText('System Template')
    fireEvent.click(screen.getByTitle('操作'))
    expect(screen.queryByText('快速创建 VM')).not.toBeInTheDocument()
  })

  it('reports a quick create failure and refreshes for retained VMs', async () => {
    const create = deferred()
    const error = vi.spyOn(feedback, 'error').mockImplementation(() => undefined)
    const refreshVms = vi.fn().mockResolvedValue(undefined)
    useMultiDataStore.setState({ refreshVms } as any)
    ;(window.xapi.vm as any).quickCreateFromTemplate = vi.fn(() => create.promise)
    ;(window.xapi.vm.templates as any) = vi.fn().mockResolvedValue({ user: [userTemplate()], system: [] })

    render(<MemoryRouter future={routerFuture} initialEntries={['/pool/conn-a/vms']}>
      <Routes><Route path="/pool/:connectionId/vms" element={<VmsPage />} /></Routes>
    </MemoryRouter>)
    await screen.findByText('User Template')
    await waitFor(() => expect(refreshVms).toHaveBeenCalled())
    const initialRefreshes = refreshVms.mock.calls.length
    fireEvent.click(getQuickCreateAction('User Template'))
    await act(async () => { create.reject(new Error('XAPI failure')); await Promise.resolve() })
    await waitFor(() => expect(error).toHaveBeenCalledWith('快速创建失败：XAPI failure'))
    expect(refreshVms).toHaveBeenCalledTimes(initialRefreshes + 1)
    expect(within(getTemplateRow('User Template')).queryByText('处理中...')).not.toBeInTheDocument()
  })

  it('passes the route connection to the network create dialog', () => {
    render(
      <MemoryRouter future={routerFuture} initialEntries={['/pool/conn-b/networks']}>
        <Routes>
          <Route path="/pool/:connectionId/networks" element={<NetworksPage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByTestId('create-network-connection')).toHaveTextContent('conn-b')
  })

  it('uses host-interface and virtual-NIC labels on the network page', () => {
    useMultiDataStore.setState({
      networks: [{
        ref: 'OpaqueRef:network',
        uuid: 'network',
        name_label: 'Production',
        name_description: '',
        bridge: 'xenbr0',
        kind: 'bond',
        PIFs: ['OpaqueRef:pif'],
        VIFs: ['OpaqueRef:vif'],
        MTU: 1500,
        connectionId: 'conn-b',
        poolName: 'Pool B',
      }],
    } as any)

    render(
      <MemoryRouter future={routerFuture} initialEntries={['/pool/conn-b/networks']}>
        <Routes>
          <Route path="/pool/:connectionId/networks" element={<NetworksPage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getAllByText('Virtual Interface').length).toBeGreaterThan(0)
    expect(screen.getByText('Host Interface')).toBeInTheDocument()
    expect(screen.getByText('绑定网络')).toBeInTheDocument()
    expect(screen.queryByText('VIFs')).not.toBeInTheDocument()
    expect(screen.queryByText('PIFs')).not.toBeInTheDocument()
  })

  it('scopes network names and counts to the selected pool and excludes name-only VLANs', () => {
    const base = {
      ref: 'OpaqueRef:same-network', uuid: 'network', name_description: '', bridge: '',
      PIFs: [], VIFs: [], MTU: 1500, poolName: 'Pool B', connectionId: 'conn-b',
    }
    useMultiDataStore.setState({ networks: [
      { ...base, connectionId: 'conn-a', poolName: 'Pool A', name_label: 'Pool A only', kind: 'internal' },
      { ...base, name_label: 'Pool-wide network associated with eth0', kind: 'external', device: 'eth0', PIFs: ['OpaqueRef:pif'] },
      { ...base, ref: 'OpaqueRef:vlan', name_label: 'Guest VLAN', kind: 'vlan', isVlan: true, vlan: 100, PIFs: ['OpaqueRef:vlan-pif'] },
      { ...base, ref: 'OpaqueRef:name-only', name_label: 'vlan201', kind: 'internal' },
    ] } as any)

    render(<MemoryRouter future={routerFuture} initialEntries={['/pool/conn-b/networks']}>
      <Routes><Route path="/pool/:connectionId/networks" element={<NetworksPage />} /></Routes>
    </MemoryRouter>)

    expect(screen.getByText('Network 0')).toHaveAttribute('title', 'Pool-wide network associated with eth0')
    expect(screen.getByText('外部网络')).toBeInTheDocument()
    expect(screen.getByText('Host Interface eth0')).toBeInTheDocument()
    expect(screen.getByText('名称像 VLAN，未配置 VLAN 接口')).toBeInTheDocument()
    expect(screen.queryByText('Pool A only')).not.toBeInTheDocument()
    const vlanSummary = screen.getByText('VLAN').parentElement?.parentElement
    expect(vlanSummary).toHaveTextContent('1')
    expect(vlanSummary).toHaveTextContent('1 个仅名称含 VLAN')
  })

  it('does not use the active connection for ambiguous global storage creation', () => {
    render(
      <MemoryRouter future={routerFuture} initialEntries={['/storage']}>
        <Routes>
          <Route path="/storage" element={<StoragePage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByRole('button', { name: '新建存储' })).toBeDisabled()
    expect(screen.getByTestId('create-sr-target')).toHaveTextContent(':')
  })

  it('uses the route connection for scoped storage creation', () => {
    render(
      <MemoryRouter future={routerFuture} initialEntries={['/pool/conn-b/storage']}>
        <Routes>
          <Route path="/pool/:connectionId/storage" element={<StoragePage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByRole('button', { name: '新建存储' })).not.toBeDisabled()
    expect(screen.getByTestId('create-sr-target')).toHaveTextContent('conn-b:OpaqueRef:host')
  })

  it('does not collapse SR selection when two pools contain the same SR ref', async () => {
    render(
      <MemoryRouter future={routerFuture} initialEntries={['/storage']}>
        <Link to="/storage">全部存储</Link>
        <LocationProbe />
        <Routes>
          <Route path="/storage" element={<StoragePage />} />
          <Route path="/pool/:connectionId/storage" element={<StoragePage />} />
        </Routes>
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByText('SR A'))
    expect(await screen.findByTestId('sr-detail-connection')).toHaveTextContent('conn-a:OpaqueRef:same-sr')
    expect(screen.getByTestId('location')).toHaveTextContent('/pool/conn-a/storage')

    fireEvent.click(screen.getByRole('link', { name: '全部存储' }))
    fireEvent.click(await screen.findByText('SR B'))
    expect(await screen.findByTestId('sr-detail-connection')).toHaveTextContent('conn-b:OpaqueRef:same-sr')
    expect(screen.getByTestId('location')).toHaveTextContent('/pool/conn-b/storage')
  })

  it('uses the route connection for VM detail and returns to the scoped VM list', async () => {
    render(
      <MemoryRouter future={routerFuture} initialEntries={['/pool/conn-b/vms/OpaqueRef%3Avm']}>
        <LocationProbe />
        <Routes>
          <Route path="/pool/:connectionId/vms/:ref" element={<VmDetailPage />} />
          <Route path="/pool/:connectionId/vms" element={<div>VM list</div>} />
        </Routes>
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(window.xapi.vm.getRecord).toHaveBeenCalledWith('conn-b', 'OpaqueRef:vm')
    })

    fireEvent.click(screen.getByTitle('返回 VM 列表'))

    expect(screen.getByTestId('location')).toHaveTextContent('/pool/conn-b/vms')
  })

  it('passes the route connection to VM advanced settings from the VM detail route', async () => {
    render(
      <MemoryRouter future={routerFuture} initialEntries={['/pool/conn-b/vms/OpaqueRef%3Avm']}>
        <Routes>
          <Route path="/pool/:connectionId/vms/:ref" element={<VmDetailPage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText('VM B')).toBeTruthy()
    fireEvent.mouseDown(screen.getByRole('tab', { name: '高级设置' }), { button: 0 })

    expect(await screen.findByTestId('vm-advanced-connection')).toHaveTextContent('conn-b')
  })

  it('confirms conversion from VM detail and returns to the scoped template list', async () => {
    const markAsTemplate = vi.fn().mockResolvedValue(undefined)
    window.xapi.vm.markAsTemplate = markAsTemplate
    render(<MemoryRouter future={routerFuture} initialEntries={['/pool/conn-b/vms/OpaqueRef%3Avm']}>
      <Routes>
        <Route path="/pool/:connectionId/vms/:ref" element={<VmDetailPage />} />
        <Route path="/pool/:connectionId/vms" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>)

    expect(await screen.findByText('VM B')).toBeInTheDocument()
    fireEvent.click(screen.getByText('更多操作', { selector: 'summary' }))
    fireEvent.click(screen.getByRole('button', { name: '转换为模板' }))
    expect(markAsTemplate).not.toHaveBeenCalled()
    const dialog = screen.getByRole('dialog', { name: '转换为模板' })
    expect(dialog).toHaveTextContent('不能再直接启动')
    fireEvent.click(within(dialog).getByRole('button', { name: '转换' }))
    await waitFor(() => expect(markAsTemplate).toHaveBeenCalledWith('conn-b', 'OpaqueRef:vm'))
    expect(await screen.findByTestId('location')).toHaveTextContent('/pool/conn-b/vms')
  })

  it('refreshes guest IPs and VIFs when opening and refreshing the VM network tab', async () => {
    const initialVm = await window.xapi.vm.getRecord('conn-b', 'OpaqueRef:vm')
    const getRecord = vi.fn()
      .mockResolvedValueOnce(initialVm)
      .mockResolvedValueOnce({ ...initialVm, networks: { '0/ipv4/0': '10.0.0.2' } })
      .mockResolvedValueOnce({ ...initialVm, networks: { '0/ipv4/0': '10.0.0.3' } })
    window.xapi.vm.getRecord = getRecord
    window.xapi.vm.getVIFs = vi.fn().mockResolvedValue([{ ref: 'OpaqueRef:vif0', device: '0' }])

    render(
      <MemoryRouter future={routerFuture} initialEntries={['/pool/conn-b/vms/OpaqueRef%3Avm']}>
        <Routes>
          <Route path="/pool/:connectionId/vms/:ref" element={<VmDetailPage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText('VM B')).toBeInTheDocument()
    fireEvent.mouseDown(screen.getByRole('tab', { name: '网络' }), { button: 0 })
    await waitFor(() => expect(screen.getByTestId('vm-network-data')).toHaveTextContent('10.0.0.2'))
    expect(screen.getByTestId('vm-network-data')).toHaveTextContent('"vifCount":1')

    fireEvent.click(screen.getByTitle('刷新'))
    await waitFor(() => expect(screen.getByTestId('vm-network-data')).toHaveTextContent('10.0.0.3'))
    expect(getRecord).toHaveBeenCalledTimes(3)
    expect(window.xapi.vm.getVIFs).toHaveBeenCalledTimes(2)
  })

  it('passes only the VM pool networks to its VIF view even when refs overlap', async () => {
    window.xapi.vm.getVIFs = vi.fn().mockResolvedValue([])
    useMultiDataStore.setState({ networks: [
      { ref: 'OpaqueRef:same-network', name_label: 'Pool A network', connectionId: 'conn-a' },
      { ref: 'OpaqueRef:same-network', name_label: 'Pool B network', connectionId: 'conn-b' },
    ] } as any)
    render(<MemoryRouter future={routerFuture} initialEntries={['/pool/conn-b/vms/OpaqueRef%3Avm']}>
      <Routes><Route path="/pool/:connectionId/vms/:ref" element={<VmDetailPage />} /></Routes>
    </MemoryRouter>)

    expect(await screen.findByText('VM B')).toBeInTheDocument()
    fireEvent.mouseDown(screen.getByRole('tab', { name: '网络' }), { button: 0 })
    expect(await screen.findByTestId('vm-network-data')).toHaveTextContent('Pool B network')
    expect(screen.getByTestId('vm-network-data')).not.toHaveTextContent('Pool A network')
  })

  it('discards a VM response from the previous pool even when refs overlap', async () => {
    const base = await window.xapi.vm.getRecord('conn-b', 'OpaqueRef:vm')
    const pending = deferred()
    window.xapi.vm.getRecord = vi.fn(async (connectionId) => {
      if (connectionId === 'conn-b') { await pending.promise; return { ...base, name_label: 'Old pool VM' } }
      return { ...base, name_label: 'Current pool VM' }
    })
    render(<MemoryRouter future={routerFuture} initialEntries={['/pool/conn-b/vms/OpaqueRef%3Avm']}>
      <SwitchVmPool /><Routes><Route path="/pool/:connectionId/vms/:ref" element={<VmDetailPage />} /></Routes>
    </MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: '切换 VM 池' }))
    expect(await screen.findByText('Current pool VM')).toBeInTheDocument()
    await act(async () => { pending.resolve(); await pending.promise })
    expect(screen.queryByText('Old pool VM')).not.toBeInTheDocument()
    expect(screen.getByText('Current pool VM')).toBeInTheDocument()
  })

  it('does not resurrect a deleted VM from an older in-flight read', async () => {
    const base = await window.xapi.vm.getRecord('conn-b', 'OpaqueRef:vm')
    const pending = deferred()
    window.xapi.vm.getRecord = vi.fn().mockResolvedValueOnce(base).mockImplementation(async () => { await pending.promise; return base })
    render(<MemoryRouter future={routerFuture} initialEntries={['/pool/conn-b/vms/OpaqueRef%3Avm']}>
      <Routes><Route path="/pool/:connectionId/vms/:ref" element={<VmDetailPage />} /></Routes>
    </MemoryRouter>)
    expect(await screen.findByText('VM B')).toBeInTheDocument()
    const listener = vi.mocked(window.xapi.onVmChanged).mock.calls.at(-1)![0]
    act(() => listener({ connectionId: 'conn-b', ref: 'OpaqueRef:vm', operation: 'mod' } as any))
    act(() => listener({ connectionId: 'conn-b', ref: 'OpaqueRef:vm', operation: 'del' } as any))
    await act(async () => { pending.resolve(); await pending.promise })
    expect(screen.getByText('VM 已删除')).toBeInTheDocument()
    expect(screen.queryByText('VM B')).not.toBeInTheDocument()
  })

  it('keeps the VM visible but marks a failed event refresh as stale and disables power writes', async () => {
    const base = await window.xapi.vm.getRecord('conn-b', 'OpaqueRef:vm')
    window.xapi.vm.getRecord = vi.fn().mockResolvedValueOnce(base).mockRejectedValueOnce(new Error('connection lost'))
    render(<MemoryRouter future={routerFuture} initialEntries={['/pool/conn-b/vms/OpaqueRef%3Avm']}>
      <Routes><Route path="/pool/:connectionId/vms/:ref" element={<VmDetailPage />} /></Routes>
    </MemoryRouter>)
    expect(await screen.findByText('VM B')).toBeInTheDocument()
    const listener = vi.mocked(window.xapi.onVmChanged).mock.calls.at(-1)![0]
    act(() => listener({ connectionId: 'conn-b', ref: 'OpaqueRef:vm', operation: 'mod' } as any))
    expect(await screen.findByRole('alert')).toHaveTextContent('最近一次成功读取')
    expect(screen.getByText('VM B')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '启动' })).toBeDisabled()
  })

  it('shows VIF read failure instead of rendering an empty network inventory', async () => {
    window.xapi.vm.getVIFs = vi.fn().mockRejectedValue(new Error('VIF read denied'))
    render(<MemoryRouter future={routerFuture} initialEntries={['/pool/conn-b/vms/OpaqueRef%3Avm']}>
      <Routes><Route path="/pool/:connectionId/vms/:ref" element={<VmDetailPage />} /></Routes>
    </MemoryRouter>)
    expect(await screen.findByText('VM B')).toBeInTheDocument()
    fireEvent.mouseDown(screen.getByRole('tab', { name: '网络' }), { button: 0 })
    expect(await screen.findByRole('alert')).toHaveTextContent('VIF read denied')
    expect(screen.queryByTestId('vm-network-data')).not.toBeInTheDocument()
  })

  it('uses the route connection for host patch and HA tabs and returns to the scoped host list', async () => {
    render(
      <MemoryRouter future={routerFuture} initialEntries={['/pool/conn-b/hosts/OpaqueRef%3Ahost']}>
        <LocationProbe />
        <Routes>
          <Route path="/pool/:connectionId/hosts/:ref" element={<HostDetailPage />} />
          <Route path="/pool/:connectionId/hosts" element={<div>Host list</div>} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText('Host B')).toBeTruthy()

    fireEvent.mouseDown(screen.getByRole('tab', { name: '补丁' }), { button: 0 })
    expect(await screen.findByTestId('host-patches-connection')).toHaveTextContent('conn-b')

    expect(screen.queryByRole('tab', { name: '高可用' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByTitle('返回主机列表'))

    expect(screen.getByTestId('location')).toHaveTextContent('/pool/conn-b/hosts')
  })

  it('redirects the legacy host HA link to the same pool settings', async () => {
    render(<MemoryRouter future={routerFuture} initialEntries={['/pool/conn-b/hosts/OpaqueRef%3Ahost?tab=ha']}><LocationProbe /><Routes>
      <Route path="/pool/:connectionId/hosts/:ref" element={<HostDetailPage />} /><Route path="/pool/:connectionId/settings" element={<div>池设置目的地</div>} />
    </Routes></MemoryRouter>)
    expect(await screen.findByText('池设置目的地')).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('/pool/conn-b/settings?tab=ha')
  })

  it('opens the host information directly and retains resource tabs in its URL', async () => {
    render(<MemoryRouter future={routerFuture} initialEntries={['/pool/conn-b/hosts/OpaqueRef%3Ahost']}><LocationProbe /><Routes>
      <Route path="/pool/:connectionId/hosts/:ref" element={<HostDetailPage />} />
    </Routes></MemoryRouter>)
    expect(await screen.findByText('Host B')).toBeInTheDocument()
    expect(screen.getByText('b.example')).toBeInTheDocument()
    for (const name of ['概览', '虚拟机', '网络', '存储', '监控', '补丁']) expect(screen.getByRole('tab', { name })).toBeInTheDocument()
    await act(async () => fireEvent.mouseDown(screen.getByRole('tab', { name: '虚拟机' }), { button: 0 }))
    expect(screen.getByTestId('location')).toHaveTextContent('?tab=vms')
    expect(screen.getByTestId('create-vm-connection')).toHaveAttribute('data-host', 'OpaqueRef:host')
  })

  it('returns from VM details to the original host VM tab with its search state', async () => {
    const vmListPath = '/pool/conn-b/hosts/OpaqueRef%3Ahost?tab=vms&search=VM'
    render(<MemoryRouter future={routerFuture} initialEntries={[{ pathname: '/pool/conn-b/vms/OpaqueRef%3Avm', state: { vmListPath } }]}><LocationProbe /><Routes>
      <Route path="/pool/:connectionId/vms/:ref" element={<VmDetailPage />} />
      <Route path="/pool/:connectionId/hosts/:ref" element={<div>主机虚拟机清单</div>} />
    </Routes></MemoryRouter>)
    expect(await screen.findByText('VM B')).toBeInTheDocument()
    fireEvent.click(screen.getByTitle('返回 VM 列表'))
    expect(screen.getByTestId('location')).toHaveTextContent(vmListPath)
  })

  it('shows host storage through PBD relations and keeps its detail selection in the host tab', async () => {
    window.xapi.pbd = { ...window.xapi.pbd, list: vi.fn().mockResolvedValue([
      { host: 'OpaqueRef:host', SR: 'OpaqueRef:same-sr', currently_attached: false },
      { host: 'different-host', SR: 'other-sr', currently_attached: true },
    ]) }
    useMultiDataStore.setState((state) => ({ srs: [...state.srs, { ...state.srs.find((sr) => sr.connectionId === 'conn-b')!, ref: 'other-sr', name_label: 'Other host storage' }] }))
    render(<MemoryRouter future={routerFuture} initialEntries={['/pool/conn-b/hosts/OpaqueRef%3Ahost?tab=storage']}><LocationProbe /><Routes>
      <Route path="/pool/:connectionId/hosts/:ref" element={<HostDetailPage />} />
    </Routes></MemoryRouter>)
    expect(await screen.findByRole('button', { name: '查看存储仓库 SR B' })).toBeInTheDocument()
    expect(screen.queryByText('Other host storage')).not.toBeInTheDocument()
    expect(screen.getByText('未连接')).toBeInTheDocument()
    expect(screen.getByTestId('create-sr-target')).toHaveTextContent('conn-b:OpaqueRef:host')
    fireEvent.click(screen.getByRole('button', { name: '查看存储仓库 SR B' }))
    expect(screen.getByTestId('location')).toHaveTextContent('tab=storage&sr=OpaqueRef%3Asame-sr')
  })

  it('shows storage relation failures and retries without reporting an empty inventory', async () => {
    window.xapi.pbd = { ...window.xapi.pbd, list: vi.fn().mockRejectedValueOnce(new Error('PBD denied')).mockResolvedValue([]) }
    render(<MemoryRouter future={routerFuture} initialEntries={['/pool/conn-b/hosts/OpaqueRef%3Ahost?tab=storage']}><Routes>
      <Route path="/pool/:connectionId/hosts/:ref" element={<HostDetailPage />} />
    </Routes></MemoryRouter>)
    expect(await screen.findByRole('alert')).toHaveTextContent('PBD denied')
    expect(screen.queryByText('未找到存储仓库')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重新读取存储连接' }))
    expect(await screen.findByText('未找到存储仓库')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('uses the selected host PIF for network link state and retains pool-wide deletion guards', async () => {
    const pifs = [{ ref: 'pif-b', host: 'OpaqueRef:host', network: 'net-b', device: 'eth9', linkState: 'disconnected', IP: 'b.example' }]
    window.xapi.network.listPifs = vi.fn().mockResolvedValue(pifs)
    useMultiDataStore.setState({ networks: [
      { ref: 'net-b', name_label: 'Host B network', connectionId: 'conn-b', PIFs: ['pif-b'], VIFs: [], linkStatus: 'connected', MTU: 1500 },
      { ref: 'net-other', name_label: 'Other host network', connectionId: 'conn-b', PIFs: ['pif-other'], VIFs: [], linkStatus: 'connected', MTU: 1500 },
      { ref: 'internal', name_label: 'Internal', connectionId: 'conn-b', PIFs: [], VIFs: [], MTU: 1500 },
    ] as any })
    render(<MemoryRouter future={routerFuture} initialEntries={['/pool/conn-b/hosts/OpaqueRef%3Ahost?tab=networks']}><LocationProbe /><Routes>
      <Route path="/pool/:connectionId/hosts/:ref" element={<HostDetailPage />} />
    </Routes></MemoryRouter>)
    const name = await screen.findByRole('button', { name: '查看网络 Host B network' })
    await waitFor(() => expect(name.closest('tr')).toHaveTextContent('eth9'))
    expect(name.closest('tr')).toHaveTextContent('断开')
    const other = screen.getByRole('button', { name: '查看网络 Other host network' }).closest('tr')!
    expect(within(other).getByText('无主机接口')).toBeInTheDocument()
    expect(within(other).getByRole('button', { name: '删除网络 Other host network' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '查看网络 Internal' })).toBeInTheDocument()
    fireEvent.click(name)
    expect(screen.getByTestId('location')).toHaveTextContent('tab=networks&network=net-b')
  })

  it('does not silently pick the first connection for ambiguous legacy VM detail URLs', async () => {
    render(
      <MemoryRouter future={routerFuture} initialEntries={['/vms/OpaqueRef%3Avm']}>
        <Routes>
          <Route path="/vms/:ref" element={<VmDetailPage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText('加载失败')).toBeInTheDocument()
    expect(screen.getByText('旧链接缺少资源池连接，请从左侧资源池或 VM 列表重新进入')).toBeInTheDocument()
    expect(window.xapi.vm.getRecord).not.toHaveBeenCalled()
  })

  it('keeps the sidebar scope aligned with the route and navigates when its scope changes', async () => {
    render(<MemoryRouter future={routerFuture} initialEntries={['/pool/conn-b/vms']}>
      <LocationProbe /><Sidebar />
      <Routes><Route path="/pool/:connectionId/vms" element={<VmsPage />} /></Routes>
    </MemoryRouter>)
    await waitFor(() => expect(screen.getByRole('link', { name: '资源池 Pool B' })).toHaveAttribute('aria-current', 'page'))
    fireEvent.click(screen.getByRole('link', { name: '资源池 Pool A' }))
    expect(screen.getByTestId('location')).toHaveTextContent('/pool/conn-a/vms')
    expect(screen.getByTestId('create-vm-connection')).toHaveTextContent('conn-a')
  })

  it('restores search, resource types and sorting when returning from VM details', async () => {
    const vm = { ref: 'OpaqueRef:vm', uuid: 'vm-b', name_label: 'VM B', power_state: 'Halted', connectionId: 'conn-b', poolName: 'Pool B', is_a_template: false, is_a_snapshot: false, is_control_domain: false, allowed_operations: [], current_operations: {}, VBDs: [], VIFs: [] }
    useMultiDataStore.setState({ vms: [vm] as any })
    vi.mocked(window.xapi.vm.getRecord).mockResolvedValue(vm as any)
    const path = '/pool/conn-b/vms?search=VM+B&sort=name_label.desc&types=vm'
    render(<MemoryRouter future={routerFuture} initialEntries={[path]}><LocationProbe /><Routes>
      <Route path="/pool/:connectionId/vms" element={<VmsPage />} /><Route path="/pool/:connectionId/vms/:ref" element={<VmDetailPage />} />
    </Routes></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: 'VM B' }))
    const back = await screen.findByTitle('返回 VM 列表')
    await act(async () => { fireEvent.click(back) })
    expect(screen.getByTestId('location')).toHaveTextContent(path)
    expect(screen.getByRole('textbox', { name: 'Filter items' })).toHaveValue('VM B')
    expect(screen.getByRole('columnheader', { name: /名称/ })).toHaveAttribute('aria-sort', 'descending')
  })

  it('shows the pool name and scoped links in breadcrumbs', () => {
    render(
      <MemoryRouter future={routerFuture} initialEntries={['/pool/conn-b/vms/OpaqueRef%3Avm']}>
        <Breadcrumb />
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: 'Pool B' })).toHaveAttribute('href', '/pool/conn-b/vms')
    expect(screen.getByRole('link', { name: '虚拟机' })).toHaveAttribute('href', '/pool/conn-b/vms')
  })
})
