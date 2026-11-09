import { fireEvent, render, screen } from '@testing-library/react'
import { Link, MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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
    <MemoryRouter future={routerFuture} initialEntries={['/dashboard']}>
      <Sidebar {...props} />
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
        { connectionId: 'conn-a' },
        { connectionId: 'conn-b' },
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

    expect(screen.getByText('XCP-ng Center')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /仪表盘/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Pool A/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '虚拟机', exact: true })).toBeInTheDocument()
  })

  it('uses a desktop icon rail while keeping navigation accessible when collapsed', () => {
    const { container } = renderSidebar({ collapsed: true })

    expect(container.querySelector('aside')).toHaveClass('md:w-16')
    expect(screen.getByRole('link', { name: '仪表盘' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '告警消息' })).toBeInTheDocument()
    expect(screen.queryByText('XCP-ng Center')).not.toBeInTheDocument()
    expect(screen.queryByText('Pool A')).not.toBeInTheDocument()
  })

  it('requests expansion from the collapsed rail toggle', () => {
    const onCollapsedChange = vi.fn()
    renderSidebar({ collapsed: true, onCollapsedChange })

    fireEvent.click(screen.getByRole('button', { name: '展开侧边栏' }))

    expect(onCollapsedChange).toHaveBeenCalledWith(false)
  })

  it('expands and activates a pool from the collapsed shortcut without navigating', () => {
    const onCollapsedChange = vi.fn()
    renderSidebar({ collapsed: true, onCollapsedChange })

    fireEvent.click(screen.getByRole('button', { name: '展开资源池 Pool B' }))

    expect(onCollapsedChange).toHaveBeenCalledWith(false)
    expect(useConnectionManagerStore.getState().activeConnectionId).toBe('conn-b')
  })

  it('uses a compact alert badge in collapsed navigation', () => {
    renderSidebar({ collapsed: true })

    expect(screen.getByText('3')).toHaveClass('h-3')
    expect(screen.getByText('3')).toHaveClass('min-w-[12px]')
  })

  it('reveals the destination pool after following a resource link outside the tree', () => {
    render(<MemoryRouter future={routerFuture} initialEntries={['/dashboard']}>
      <Link to="/pool/conn-b/vms/OpaqueRef%3Avm?tab=storage">查看关联虚拟机</Link>
      <Sidebar />
    </MemoryRouter>)

    fireEvent.click(screen.getByRole('link', { name: '查看关联虚拟机' }))

    expect(useConnectionManagerStore.getState().activeConnectionId).toBe('conn-b')
    expect(screen.getAllByRole('link', { name: /存储/ }).some((link) => link.getAttribute('href') === '/pool/conn-b/storage')).toBe(true)
    expect(screen.getAllByRole('link', { name: /虚拟机/ }).some((link) => link.getAttribute('aria-current') === 'page' && link.getAttribute('href') === '/pool/conn-b/vms')).toBe(true)
  })
})
