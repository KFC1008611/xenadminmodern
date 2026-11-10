import { fireEvent, render, screen } from '@testing-library/react'
import { Link, MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ResourceNavigation } from '../../src/renderer/src/components/layout/ResourceNavigation'
import Breadcrumb from '../../src/renderer/src/components/layout/Breadcrumb'
import Sidebar from '../../src/renderer/src/components/layout/Sidebar'
import { useAlertStore } from '../../src/renderer/src/store/alert.store'
import { useConnectionManagerStore } from '../../src/renderer/src/store/connectionManager.store'
import { useMultiDataStore } from '../../src/renderer/src/store/multiData.store'
import type { ConnectionInfo } from '../../src/renderer/src/types/xapi'

const routerFuture = {
  v7_startTransition: true,
  v7_relativeSplatPath: true,
} as const

function connection(id: string, poolName: string): ConnectionInfo {
  return {
    id,
    name: poolName,
    host: id === 'conn-a' ? '172.16.5.250' : '172.16.5.251',
    poolName,
    poolRef: `OpaqueRef:${id}`,
    state: 'connected',
    errorMessage: null,
    connectedAt: 1,
  }
}

function renderSidebar(props: Parameters<typeof Sidebar>[0] = {}) {
  return render(
    <MemoryRouter future={routerFuture} initialEntries={['/vms']}>
      <Sidebar {...props} /><ResourceNavigation />
    </MemoryRouter>,
  )
}

describe('Sidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useConnectionManagerStore.setState({
      connections: [connection('conn-a', 'Pool A'), connection('conn-b', 'Pool B')],
      activeConnectionId: 'conn-a',
      isLoading: false,
      error: null,
    })
    useMultiDataStore.setState({
      hosts: [
        { connectionId: 'conn-a', ref: 'host-a', name_label: 'Host A', address: 'a.example' },
        { connectionId: 'conn-b', ref: 'host-b', name_label: 'Host B', address: 'b.example' },
      ] as any,
      vms: [
        { connectionId: 'conn-a', power_state: 'Running' },
        { connectionId: 'conn-a', power_state: 'Halted' },
        { connectionId: 'conn-b', power_state: 'Running' },
      ] as any,
      srs: [],
      networks: [],
      tasks: [],
      pools: [],
      loading: false,
      loadingConnections: [],
      errors: {},
      lastRefresh: null,
    })
    useAlertStore.setState({
      alerts: [],
      unreadCount: 3,
      errorCount: 1,
      warningCount: 0,
      loading: false,
    })
  })

  it('shows full navigation and pool tree when expanded', () => {
    renderSidebar()

    expect(screen.queryByText('XCP-ng Center')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '全部资源' })).toHaveAttribute('href', '/vms')
    expect(screen.getByRole('link', { name: '资源池 Pool A' })).toHaveAttribute('href', '/pool/conn-a/vms')
    expect(screen.getByRole('link', { name: '虚拟机', exact: true })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '主机 Host A' })).toHaveAttribute('href', '/pool/conn-a/hosts/host-a')
    fireEvent.click(screen.getByRole('button', { name: '收起资源池 Pool A' }))
    expect(screen.queryByRole('link', { name: '主机 Host A' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '主机 Host B' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '展开资源池 Pool A' }))
    expect(screen.getByRole('link', { name: '主机 Host A' })).toBeInTheDocument()
  })

  it('uses a desktop icon rail while keeping navigation accessible when collapsed', () => {
    const { container } = renderSidebar({ collapsed: true })

    expect(container.querySelector('aside')).toHaveClass('md:w-16')
    expect(screen.getByRole('link', { name: '全部资源' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '告警，3 条' })).toBeInTheDocument()
    expect(screen.queryByText('XCP-ng Center')).not.toBeInTheDocument()
    expect(screen.queryByText('Pool A')).not.toBeInTheDocument()
  })

  it('requests expansion from the collapsed rail toggle', () => {
    const onCollapsedChange = vi.fn()
    renderSidebar({ collapsed: true, onCollapsedChange })

    fireEvent.click(screen.getByRole('button', { name: '展开侧边栏' }))

    expect(onCollapsedChange).toHaveBeenCalledWith(false)
  })

  it('selects a pool from the collapsed rail', () => {
    const onCollapsedChange = vi.fn()
    renderSidebar({ collapsed: true, onCollapsedChange })

    fireEvent.click(screen.getByRole('link', { name: '资源池 Pool B' }))

    expect(useConnectionManagerStore.getState().activeConnectionId).toBe('conn-b')
  })

  it('uses a compact alert badge in collapsed navigation', () => {
    renderSidebar({ collapsed: true })

    expect(screen.getAllByText('3')).toHaveLength(1)
    expect(screen.getByRole('link', { name: '告警，3 条' })).toHaveAttribute('href', '/alerts')
  })

  it('reveals the destination pool after following a resource link outside the tree', () => {
    render(<MemoryRouter future={routerFuture} initialEntries={['/vms']}>
      <Link to="/pool/conn-b/vms/OpaqueRef%3Avm?tab=storage">查看关联虚拟机</Link>
      <Sidebar /><ResourceNavigation fallback={<Breadcrumb />} />
    </MemoryRouter>)

    fireEvent.click(screen.getByRole('link', { name: '查看关联虚拟机' }))

    expect(useConnectionManagerStore.getState().activeConnectionId).toBe('conn-b')
    expect(screen.getByRole('link', { name: '虚拟机' })).toHaveAttribute('href', '/pool/conn-b/vms')
    expect(screen.queryByRole('navigation', { name: '资源类型' })).not.toBeInTheDocument()
  })

  it('expands the selected host parent and keeps only that host selected', () => {
    render(<MemoryRouter future={routerFuture} initialEntries={['/pool/conn-a/vms']}>
      <Link to="/pool/conn-a/hosts/host-a?tab=storage">打开主机</Link><Sidebar />
    </MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: '收起资源池 Pool A' }))
    fireEvent.click(screen.getByRole('link', { name: '打开主机' }))
    expect(screen.getByRole('button', { name: '收起资源池 Pool A' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('link', { name: '主机 Host A' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: '资源池 Pool A' })).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('link', { name: '主机 Host B' })).toHaveAttribute('href', '/pool/conn-b/hosts/host-b?tab=storage')
  })
})

it('preserves the resource type while switching pools with encoded identifiers', () => {
  useConnectionManagerStore.setState({ connections: [connection('pool / B', 'Pool B')] })
  render(<MemoryRouter future={routerFuture} initialEntries={['/hosts']}><Sidebar /><ResourceNavigation /></MemoryRouter>)
  const pool = screen.getByRole('link', { name: '资源池 Pool B' })
  expect(pool).toHaveAttribute('href', '/pool/pool%20%2F%20B/hosts')
  fireEvent.click(pool)
  expect(screen.getByRole('link', { name: '网络', exact: true })).toHaveAttribute('href', '/pool/pool%20%2F%20B/networks')
  expect(screen.getByRole('link', { name: '全部资源' })).toHaveAttribute('href', '/hosts')
  expect(useConnectionManagerStore.getState().activeConnectionId).toBe('pool / B')
})
