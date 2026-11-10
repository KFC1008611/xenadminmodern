import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Sidebar from '../../src/renderer/src/components/layout/Sidebar'
import NetworksPage from '../../src/renderer/src/pages/NetworksPage'
import { useConnectionManagerStore } from '../../src/renderer/src/store/connectionManager.store'
import { useMultiDataStore } from '../../src/renderer/src/store/multiData.store'
import { useNetworkAdvancedStore } from '../../src/renderer/src/store/network-advanced.store'
import { ToastProvider } from '../../src/renderer/src/components/toast/ToastProvider'

const initialAdvancedState = useNetworkAdvancedStore.getState()
const refreshNetworks = useMultiDataStore.getState().refreshNetworks
const network = {
  ref: 'OpaqueRef:network', uuid: 'network', name_label: 'Internal network', name_description: '',
  bridge: '', PIFs: [], VIFs: [], MTU: 1500, connectionId: 'conn-a', poolName: 'Pool A',
  allowedActions: { rename: true, destroy: true },
}

function renderPage(path = '/pool/conn-a/networks') {
  return render(<ToastProvider><MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }} initialEntries={[path]}>
    <Sidebar /><Routes><Route path="/pool/:connectionId/networks" element={<NetworksPage />} /><Route path="/networks" element={<NetworksPage />} /></Routes>
  </MemoryRouter></ToastProvider>)
}

beforeEach(() => {
  vi.clearAllMocks()
  useConnectionManagerStore.setState({
    connections: [{ id: 'conn-a', host: 'a.invalid', name: 'Pool A', poolName: 'Pool A', state: 'connected', connectedAt: 1, epoch: 1 } as any],
    activeConnectionId: 'conn-a',
  })
  useMultiDataStore.setState({ networks: [network], hosts: [], vms: [], domainStates: {}, refreshNetworks: vi.fn().mockResolvedValue(undefined), refreshHosts: vi.fn().mockResolvedValue(undefined), refreshVms: vi.fn().mockResolvedValue(undefined) } as any)
  useNetworkAdvancedStore.setState(initialAdvancedState, true)
  window.xapi.network = { ...window.xapi.network, listPifs: vi.fn().mockResolvedValue([]), rename: vi.fn().mockResolvedValue(undefined), create: vi.fn().mockResolvedValue('OpaqueRef:new'), destroy: vi.fn().mockResolvedValue(undefined) } as any
  window.xapi.bond = { ...window.xapi.bond, list: vi.fn().mockResolvedValue([]) } as any
  window.xapi.vlan = { ...window.xapi.vlan, list: vi.fn().mockResolvedValue([]) } as any
})

describe('normal network workflows', () => {
  it('lets a user choose a creation pool from the global page and explains the new network scope', async () => {
    useConnectionManagerStore.setState({ connections: [
      ...useConnectionManagerStore.getState().connections,
      { id: 'conn-b', host: 'b.invalid', name: 'Pool B', poolName: 'Pool B', state: 'connected', connectedAt: 2 } as any,
    ] })
    renderPage('/networks')
    expect(screen.getByRole('button', { name: '创建网络' })).toBeDisabled()
    fireEvent.click(screen.getByRole('link', { name: '资源池 Pool B' }))
    fireEvent.click(screen.getByRole('button', { name: '创建网络' }))
    expect(within(screen.getByRole('dialog')).getByText('目标资源池：Pool B')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/名称/), { target: { value: 'Isolated lab' } })
    fireEvent.click(screen.getByRole('button', { name: '创建', exact: true }))
    await waitFor(() => expect(window.xapi.network.create).toHaveBeenCalledWith('conn-b', 'Isolated lab', ''))
    await screen.findByText(/当前资源池的清单中尚未找到所选网络/)
  })

  it('keeps a failed creation editable, then locates the new network and offers the next VM task', async () => {
    const created = { ...network, ref: 'OpaqueRef:new', uuid: 'new', name_label: 'Isolated lab', name_description: 'Application tests' }
    vi.mocked(window.xapi.network.create).mockRejectedValueOnce(new Error('PERMISSION_DENIED')).mockImplementationOnce(async () => {
      useMultiDataStore.setState({ networks: [network, created] })
      return created.ref
    })
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: '创建网络' }))
    fireEvent.change(screen.getByLabelText(/名称/), { target: { value: created.name_label } })
    fireEvent.change(screen.getByLabelText('描述'), { target: { value: created.name_description } })
    fireEvent.click(screen.getByRole('button', { name: '创建', exact: true }))
    expect(await screen.findByRole('alert')).toHaveTextContent('PERMISSION_DENIED')
    expect(screen.getByLabelText(/名称/)).toHaveValue(created.name_label)
    expect(screen.getByLabelText('描述')).toHaveValue(created.name_description)
    fireEvent.click(screen.getByRole('button', { name: '创建', exact: true }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const details = await screen.findByRole('region', { name: '网络详情 Isolated lab' })
    expect(within(details).getByText('Application tests')).toBeInTheDocument()
    expect(within(details).getByRole('link', { name: '打开此资源池的虚拟机' })).toHaveAttribute('href', '/pool/conn-a/vms')
    expect(window.xapi.network.create).toHaveBeenCalledTimes(2)
  })

  it('explains a missing new network after a successful create without offering another submission', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: '创建网络' }))
    fireEvent.change(screen.getByLabelText(/名称/), { target: { value: 'New network' } })
    fireEvent.click(screen.getByRole('button', { name: '创建', exact: true }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await screen.findByText(/当前资源池的清单中尚未找到所选网络/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重新读取网络清单' }))
    expect(window.xapi.network.create).toHaveBeenCalledTimes(1)
  })

  it('opens network relationships by URL and links only same-pool hosts and VMs', async () => {
    useMultiDataStore.setState({
      networks: [{ ...network, PIFs: ['pif-a'], VIFs: ['vif-a', 'template-vif'], allowedActions: { rename: true, destroy: false } }],
      hosts: [{ ref: 'host-a', connectionId: 'conn-a', name_label: 'Compute A' }, { ref: 'host-a', connectionId: 'conn-b', name_label: 'Wrong host' }] as any,
      vms: [{ ref: 'vm-a', connectionId: 'conn-a', name_label: 'Web VM', VIFs: ['vif-a'] }, { ref: 'vm-a', connectionId: 'conn-b', name_label: 'Wrong VM', VIFs: ['vif-a'] }] as any,
    })
    vi.mocked(window.xapi.network.listPifs).mockResolvedValue([{ ref: 'pif-a', host: 'host-a', network: network.ref, device: 'eth0', IP: '192.0.2.10', linkState: 'connected', isPhysicalNic: true, management: true } as any])
    renderPage(`/pool/conn-a/networks?network=${encodeURIComponent(network.ref)}`)
    const details = screen.getByRole('region', { name: '网络详情 Internal network' })
    expect(await within(details).findByRole('link', { name: 'Compute A' })).toHaveAttribute('href', '/pool/conn-a/hosts/host-a')
    expect(within(details).getByRole('link', { name: /Web VM/ })).toHaveAttribute('href', '/pool/conn-a/vms/vm-a?tab=network')
    expect(within(details).queryByText(/Wrong/)).not.toBeInTheDocument()
    expect(within(details).getByText(/另有 1 个虚拟网卡未匹配/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '删除网络 Internal network' })).toBeDisabled()
  })

  it('does not present a missing host-interface read as an internal network', async () => {
    useMultiDataStore.setState({ networks: [{ ...network, PIFs: ['missing-pif'] }] })
    vi.mocked(window.xapi.network.listPifs).mockRejectedValue(new Error('PIF_READ_FAILED'))
    renderPage(`/pool/conn-a/networks?network=${encodeURIComponent(network.ref)}`)
    expect(await screen.findByText('主机网络接口读取失败：PIF_READ_FAILED')).toBeInTheDocument()
    const details = screen.getByRole('region', { name: '网络详情 Internal network' })
    expect(within(details).getByText(/另有 1 个主机网络接口尚未读取到/)).toBeInTheDocument()
    expect(within(details).queryByText(/此网络没有物理网络出口/)).not.toBeInTheDocument()
  })

  it('confirms the pool, object and impact before deleting and retains a definite failure for correction', async () => {
    vi.mocked(window.xapi.network.destroy).mockRejectedValueOnce(new Error('NETWORK_CONTAINS_VIF')).mockResolvedValueOnce(undefined)
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: '删除网络 Internal network' }))
    const dialog = screen.getByRole('dialog', { name: '删除网络' })
    expect(within(dialog).getByText('Pool A')).toBeInTheDocument()
    expect(within(dialog).getByText('0 个主机网络接口，0 个虚拟网卡')).toBeInTheDocument()
    expect(within(dialog).getByText(/删除后，此网络将从资源池移除/)).toBeInTheDocument()
    expect(window.xapi.network.destroy).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: '确认删除网络 Internal network' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('NETWORK_CONTAINS_VIF')
    expect(window.xapi.network.destroy).toHaveBeenCalledTimes(1)
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('rechecks the current attachment protection while a delete confirmation is open', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: '删除网络 Internal network' }))
    await act(async () => { useMultiDataStore.setState({ networks: [{ ...network, VIFs: ['new-vif'] }] }) })
    const dialog = screen.getByRole('dialog', { name: '删除网络' })
    expect(within(dialog).getByRole('button', { name: '确认删除网络 Internal network' })).toBeDisabled()
    expect(within(dialog).getByRole('alert')).toHaveTextContent('网络状态已变化')
    expect(window.xapi.network.destroy).not.toHaveBeenCalled()
  })

  it('opens a network from the list and clears its details after a confirmed deletion', async () => {
    vi.mocked(window.xapi.network.destroy).mockImplementation(async () => { useMultiDataStore.setState({ networks: [] }) })
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: '查看网络 Internal network' }))
    expect(screen.getByRole('region', { name: '网络详情 Internal network' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '删除网络 Internal network' }))
    fireEvent.click(screen.getByRole('button', { name: '确认删除网络 Internal network' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.queryByRole('region', { name: '网络详情 Internal network' })).not.toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText(/当前资源池的清单中尚未找到所选网络/)).not.toBeInTheDocument())
    expect(window.xapi.network.destroy).toHaveBeenCalledWith('conn-a', network.ref)
  })

  it('lets the user retry related VM reads without pretending unmatched devices are absent', async () => {
    useMultiDataStore.setState({
      networks: [{ ...network, VIFs: ['vif-a'] }],
      domainStates: { 'conn-a': { vms: { loading: false, error: 'VM_READ_FAILED', lastSuccessAt: null } } },
    })
    await act(async () => { renderPage(`/pool/conn-a/networks?network=${encodeURIComponent(network.ref)}`) })
    const details = screen.getByRole('region', { name: '网络详情 Internal network' })
    expect(within(details).getByRole('alert')).toHaveTextContent('VM_READ_FAILED')
    expect(within(details).getByText(/另有 1 个虚拟网卡未匹配/)).toBeInTheDocument()
    expect(within(details).queryByText(/尚无虚拟网卡接入/)).not.toBeInTheDocument()
    fireEvent.click(within(details).getByRole('button', { name: '重新读取虚拟机' }))
    expect(useMultiDataStore.getState().refreshVms).toHaveBeenCalledTimes(2)
  })

  it('presents a failed host-interface read and retries in the route resource pool', async () => {
    vi.mocked(window.xapi.network.listPifs).mockRejectedValueOnce(new Error('PIF_PERMISSION_DENIED')).mockResolvedValueOnce([])
    renderPage()
    expect(await screen.findByText('主机网络接口读取失败：PIF_PERMISSION_DENIED')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重新读取主机接口' }))
    await waitFor(() => expect(screen.queryByText('主机网络接口读取失败：PIF_PERMISSION_DENIED')).not.toBeInTheDocument())
    expect(window.xapi.network.listPifs).toHaveBeenNthCalledWith(2, 'conn-a')
  })

  it('submits a pending rename once even when Enter is pressed repeatedly', async () => {
    let finish!: () => void
    vi.mocked(window.xapi.network.rename).mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    renderPage()
    fireEvent.click(screen.getByTitle('重命名'))
    const input = screen.getByRole('textbox', { name: '网络 Internal network 的新名称' })
    fireEvent.change(input, { target: { value: 'Updated network' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(window.xapi.network.rename).toHaveBeenCalledTimes(1)
    expect(window.xapi.network.rename).toHaveBeenCalledWith('conn-a', network.ref, 'Updated network')
    expect(input).toBeDisabled()
    await act(async () => { finish(); await Promise.resolve() })
    await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument())
    expect(useMultiDataStore.getState().refreshNetworks).toHaveBeenLastCalledWith({ afterMutation: true, connectionId: 'conn-a' })
  })

  it('retains disconnected resource names but disables mutations and closes a previous creation form', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: '创建网络' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await act(async () => {
      useConnectionManagerStore.setState({ connections: [{ id: 'conn-a', host: 'a.invalid', name: 'Pool A', poolName: 'Pool A', state: 'disconnected' } as any] })
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText('Internal network')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '创建网络' })).toBeDisabled()
    expect(screen.getByTitle('该网络不能重命名')).toBeDisabled()
    expect(screen.getByRole('button', { name: '删除网络 Internal network' })).toBeDisabled()
  })

  it('shows the renamed network after a pre-mutation list finally returns', async () => {
    let finishOld!: (rows: unknown[]) => void
    window.xapi.network.list = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve }))
      .mockResolvedValueOnce([{ ...network, name_label: 'Updated network' }])
    const refresh = vi.fn(refreshNetworks)
    useMultiDataStore.setState({ refreshNetworks: refresh })
    renderPage()
    expect(window.xapi.network.list).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByTitle('重命名'))
    const input = screen.getByRole('textbox', { name: '网络 Internal network 的新名称' })
    fireEvent.change(input, { target: { value: 'Updated network' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(refresh).toHaveBeenLastCalledWith({ afterMutation: true, connectionId: 'conn-a' }))
    await act(async () => { finishOld([network]); await Promise.resolve() })
    expect(await screen.findByText('Updated network')).toBeInTheDocument()
    expect(window.xapi.network.list).toHaveBeenCalledTimes(2)
    expect(window.xapi.network.rename).toHaveBeenCalledTimes(1)
  })
})
