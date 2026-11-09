import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import StoragePage from '../../src/renderer/src/pages/StoragePage'
import SrDetailPanel from '../../src/renderer/src/components/sr/SrDetailPanel'
import { PbdManagementPanel } from '../../src/renderer/src/components/sr/PbdManagementPanel'
import { ThinProvisioningChart } from '../../src/renderer/src/components/sr/ThinProvisioningChart'
import { ToastContext } from '../../src/renderer/src/components/toast/ToastProvider'
import { useMultiDataStore } from '../../src/renderer/src/store/multiData.store'
import { useConnectionManagerStore } from '../../src/renderer/src/store/connectionManager.store'
import { useStorageAdvancedStore } from '../../src/renderer/src/store/storage-advanced.store'
import { useSrWizardStore } from '../../src/renderer/src/store/srWizard.store'

const initialStorage = useStorageAdvancedStore.getState()
const listVdis = vi.fn()
const srCreate = vi.fn()
const srScan = vi.fn()
const thinStats = vi.fn()
const sr = (connectionId = 'a', name = 'SR A') => ({ ref: 'OpaqueRef:sr', uuid: `uuid-${connectionId}`, name_label: name,
  type: 'nfs', shared: true, physical_size: 1024, physical_utilisation: 256, virtual_allocation: 512,
  VDIs: [], PBDs: [], connectionId, poolName: `Pool ${connectionId.toUpperCase()}` })
const disk = (name: string) => ({ ref: 'OpaqueRef:vdi', name_label: name, virtual_size: 512, physical_utilisation: 128, read_only: false, type: 'user' })

function renderPage() {
  return render(<ToastContext.Provider value={{ addToast: vi.fn() }}>
    <MemoryRouter initialEntries={['/pool/a/storage']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Link to="/pool/b/storage">切换到 B</Link>
      <Routes><Route path="/pool/:connectionId/storage" element={<StoragePage />} /></Routes>
    </MemoryRouter>
  </ToastContext.Provider>)
}

beforeEach(() => {
  vi.resetAllMocks()
  listVdis.mockResolvedValue([])
  srScan.mockResolvedValue(undefined)
  window.xapi = { storage: { listVdis }, sr: { create: srCreate, scan: srScan, getThinStats: thinStats }, pbd: { list: vi.fn().mockResolvedValue([]) } } as any
  useConnectionManagerStore.setState({ connections: ['a', 'b'].map((id) => ({ id, state: 'connected', name: `Endpoint ${id}`, poolName: `Pool ${id.toUpperCase()}` })) as any })
  useMultiDataStore.setState({ vms: [], domainStates: {}, srs: [sr(), sr('b', 'SR B')] as any, pools: [],
    hosts: [{ connectionId: 'a', ref: 'OpaqueRef:host1', name_label: 'Host One' }, { connectionId: 'a', ref: 'OpaqueRef:host2', name_label: 'Host Two' }] as any,
    refreshSrs: vi.fn().mockResolvedValue(undefined), refreshHosts: vi.fn().mockResolvedValue(undefined), refreshConnection: vi.fn().mockResolvedValue(undefined) })
  useStorageAdvancedStore.setState({ ...initialStorage, pbdStates: {}, pbds: [], isoStates: {}, thinStats: {} })
  useSrWizardStore.getState().reset()
})

describe('storage workflows', () => {
  it('closes a selected detail when navigating to another pool with the same SR reference', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: '查看存储仓库 SR A' }))
    expect(await screen.findByRole('button', { name: '关闭存储仓库详情' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('link', { name: '切换到 B' }))
    expect(screen.getByRole('button', { name: '查看存储仓库 SR B' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '关闭存储仓库详情' })).not.toBeInTheDocument()
    expect(screen.queryByText('uuid-a')).not.toBeInTheDocument()
  })

  it('reads refreshed SR metadata and rescans the open VDI detail after a scan', async () => {
    listVdis.mockResolvedValueOnce([disk('old disk')]).mockResolvedValue([disk('new disk')])
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: '查看存储仓库 SR A' }))
    expect(await screen.findByText('old disk')).toBeInTheDocument()
    act(() => useMultiDataStore.setState({ vms: [], domainStates: {}, srs: [{ ...sr(), uuid: 'updated-uuid', physical_utilisation: 768 }] as any }))
    expect(screen.getByText('updated-uuid')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '扫描' }))
    expect(await screen.findByText('new disk')).toBeInTheDocument()
    expect(srScan).toHaveBeenCalledWith('a', 'OpaqueRef:sr')
    expect(useMultiDataStore.getState().refreshConnection).toHaveBeenCalledWith('a', { afterMutation: true })
  })

  it('shows a VDI read failure with retained data and supports an explicit reload', async () => {
    listVdis.mockResolvedValueOnce([disk('known disk')]).mockRejectedValueOnce(new Error('permission denied')).mockResolvedValueOnce([disk('reloaded disk')])
    const record = sr() as any
    const view = render(<SrDetailPanel sr={record} connectionId="a" onClose={vi.fn()} />)
    expect(await screen.findByText('known disk')).toBeInTheDocument()
    view.rerender(<SrDetailPanel sr={record} connectionId="a" onClose={vi.fn()} refreshRevision={1} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('permission denied')
    expect(screen.getByText('known disk')).toBeInTheDocument()
    expect(screen.queryByText('没有 VDI')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }))
    expect(await screen.findByText('reloaded disk')).toBeInTheDocument()
  })

  it('displays only this pools PBDs and disables stale mutation while showing the read error', () => {
    const pbd = (connectionId: string, uuid: string) => ({ connectionId, ref: 'OpaqueRef:pbd', uuid,
      SR: 'OpaqueRef:sr', host: 'OpaqueRef:host1', currently_attached: false })
    useStorageAdvancedStore.setState({ loadPbds: vi.fn(), pbdStates: {
      a: { items: [pbd('a', 'this-pbd')] as any, error: 'permission denied', loading: false },
      b: { items: [pbd('b', 'other-pbd')] as any, error: null, loading: false },
    } })
    render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><PbdManagementPanel connectionId="a" srRef="OpaqueRef:sr" /></MemoryRouter>)
    expect(screen.getByText('this-pbd')).toBeInTheDocument()
    expect(screen.queryByText('other-pb')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Host One' })).toHaveAttribute('href', '/pool/a/hosts/OpaqueRef%3Ahost1')
    expect(screen.getByRole('alert')).toHaveTextContent('permission denied')
    expect(screen.getByRole('button', { name: '连接' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }))
    expect(useStorageAdvancedStore.getState().loadPbds).toHaveBeenCalledWith('a')
  })

  it('reports capacity errors and reloads without an unhandled promise rejection', async () => {
    thinStats.mockRejectedValueOnce(new Error('access denied')).mockResolvedValueOnce({ physicalSize: 100, physicalUtilisation: 50, virtualAllocation: 200, overprovisionRatio: 2 })
    render(<ThinProvisioningChart connectionId="a" srRef="OpaqueRef:sr" srName="SR A" />)
    expect(await screen.findByRole('alert')).toHaveTextContent('access denied')
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }))
    expect(await screen.findByText('2.00x')).toBeInTheDocument()
  })

  it('shows the selected pool and host, allows review correction, and closes after creation', async () => {
    srCreate.mockResolvedValueOnce('OpaqueRef:created')
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: '新建存储' }))
    expect(screen.getByText('目标资源池：Pool A')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('combobox', { name: '接入主机' }), { target: { value: 'OpaqueRef:host2' } })
    act(() => useSrWizardStore.setState({ currentStep: 5, srType: 'nfs', nfsServer: 'nfs.test', nfsPath: '/export', nameLabel: 'new SR' }))
    fireEvent.click(screen.getByRole('button', { name: '上一步' }))
    expect(useSrWizardStore.getState().currentStep).toBe(4)
    fireEvent.click(screen.getByRole('button', { name: '下一步' }))
    fireEvent.click(screen.getByRole('button', { name: '创建存储仓库' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(srCreate).toHaveBeenCalledWith('a', 'OpaqueRef:host2', expect.objectContaining({ nameLabel: 'new SR' }))
    expect(srCreate).toHaveBeenCalledTimes(1)
  })
})
