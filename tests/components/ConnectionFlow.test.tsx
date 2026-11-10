import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { StrictMode, type ReactNode } from 'react'
import { syncManager } from '../../src/renderer/src/store/syncManager.store'
import App from '../../src/renderer/src/App'
import { AddConnectionDialog } from '../../src/renderer/src/components/connection/AddConnectionDialog'
import { RememberedServerDialog } from '../../src/renderer/src/components/connection/RememberedServerDialog'
import ConnectPage from '../../src/renderer/src/pages/ConnectPage'
import { useConnectionStore } from '../../src/renderer/src/store/connection.store'
import { useConnectionManagerStore } from '../../src/renderer/src/store/connectionManager.store'
import { useMultiDataStore } from '../../src/renderer/src/store/multiData.store'
import { useMetricsStore } from '../../src/renderer/src/store/metrics.store'
import { useAlertStore } from '../../src/renderer/src/store/alert.store'
import type { ConnectionInfo, ConnectionProfile } from '../../src/renderer/src/types/xapi'

const routerFuture = {
  v7_startTransition: true,
  v7_relativeSplatPath: true,
} as const

vi.mock('../../src/renderer/src/store/syncManager.store', () => ({
  syncManager: {
    start: vi.fn(),
    stop: vi.fn(),
  },
}))

vi.mock('../../src/renderer/src/components/export/ExportPanel', () => ({
  default: () => null,
}))

vi.mock('../../src/renderer/src/components/layout/AppShell', () => ({
  default: ({ children }: { children: ReactNode }) => <div data-testid="app-shell">{children}</div>,
}))


vi.mock('../../src/renderer/src/pages/HostsPage', () => ({ default: () => null }))
vi.mock('../../src/renderer/src/pages/HostDetailPage', () => ({ default: () => null }))
vi.mock('../../src/renderer/src/pages/VmsPage', () => ({ default: () => <div>VM page<input aria-label="页面草稿" /></div> }))
vi.mock('../../src/renderer/src/pages/VmDetailPage', () => ({ default: () => null }))
vi.mock('../../src/renderer/src/pages/StoragePage', () => ({ default: () => null }))
vi.mock('../../src/renderer/src/pages/NetworksPage', () => ({ default: () => null }))
vi.mock('../../src/renderer/src/pages/TasksPage', () => ({ default: () => null }))
vi.mock('../../src/renderer/src/pages/AlertsPage', () => ({ default: () => null }))
vi.mock('../../src/renderer/src/pages/BatchHistoryPage', () => ({ default: () => null }))
vi.mock('../../src/renderer/src/pages/RbacPage', () => ({ default: () => null }))
vi.mock('../../src/renderer/src/pages/PoolManagerPage', () => ({ default: () => null }))

vi.mock('../../src/renderer/src/components/connection/AddServerDialog', () => ({
  AddServerDialog: ({
    open,
    onAdded,
  }: {
    open: boolean
    onAdded?: (profile: ConnectionProfile, password: string) => void
  }) => {
    if (!open) return null
    return (
      <button
        type="button"
        onClick={() =>
          onAdded?.(
            {
              id: 'manual-profile',
              name: 'Manual Pool',
              host: '172.16.5.251',
              port: 443,
              scheme: 'https:',
              username: 'root',
              lastConnected: null,
              allowSelfSigned: true,
            },
            'secret',
          )
        }
      >
        complete manual add
      </button>
    )
  },
}))

const mockXapi = {
  connection: {
    connect: vi.fn(),
    disconnect: vi.fn(),
    reconnect: vi.fn(),
    list: vi.fn(),
    getInfo: vi.fn(),
  },
  profiles: {
    list: vi.fn(),
    hasPassword: vi.fn(),
    connect: vi.fn(),
    save: vi.fn(),
    delete: vi.fn(),
  },
  vm: {
    list: vi.fn(),
  },
  host: {
    list: vi.fn(),
  },
  storage: {
    listSrs: vi.fn(),
  },
  network: {
    list: vi.fn(),
  },
  tasks: {
    list: vi.fn(),
  },
  pool: {
    get: vi.fn(),
  },
  metrics: { startCollection: vi.fn().mockResolvedValue(undefined), stopCollection: vi.fn().mockResolvedValue(undefined), getHistory: vi.fn().mockResolvedValue([]), getCollectionError: vi.fn().mockResolvedValue(null) },
  alerts: { getAll: vi.fn().mockResolvedValue([]) },
  onAlertTriggered: vi.fn().mockReturnValue(() => {}),
  onVmChanged: vi.fn(),
}

function connection(id: string, state: ConnectionInfo['state'] = 'connected'): ConnectionInfo {
  return {
    id,
    name: 'Pool A',
    host: '172.16.5.250',
    poolName: 'Pool A',
    poolRef: 'OpaqueRef:pool',
    state,
    errorMessage: null,
    connectedAt: 1,
  }
}

function profile(): ConnectionProfile {
  return {
    id: 'profile-a',
    name: 'Pool A',
    host: '172.16.5.250',
    port: 443,
    scheme: 'https:',
    username: 'root',
    lastConnected: null,
    allowSelfSigned: true,
  }
}

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location">{location.pathname}</div>
}

describe('connection flow routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(window, { xapi: mockXapi })
    mockXapi.profiles.list.mockResolvedValue([])
    mockXapi.profiles.hasPassword.mockResolvedValue(false)
    mockXapi.profiles.save.mockResolvedValue(undefined)
    mockXapi.profiles.connect.mockResolvedValue({ id: 'conn-a' })
    mockXapi.connection.connect.mockResolvedValue({ id: 'conn-a' })
    mockXapi.connection.disconnect.mockResolvedValue(undefined)
    mockXapi.connection.reconnect.mockResolvedValue(undefined)
    mockXapi.connection.list.mockResolvedValue([])
    mockXapi.connection.getInfo.mockResolvedValue(connection('conn-a'))
    mockXapi.vm.list.mockResolvedValue([])
    mockXapi.host.list.mockResolvedValue([])
    mockXapi.storage.listSrs.mockResolvedValue([])
    mockXapi.network.list.mockResolvedValue([])
    mockXapi.tasks.list.mockResolvedValue([])
    mockXapi.pool.get.mockResolvedValue(null)
    mockXapi.onVmChanged.mockReturnValue(() => {})

    useConnectionManagerStore.setState({
      connections: [],
      activeConnectionId: null,
      isLoading: false,
      error: null,
    })
    useConnectionStore.setState({
      isConnected: false,
      poolName: null,
      host: null,
    })
    useMultiDataStore.setState({
      vms: [],
      hosts: [],
      srs: [],
      networks: [],
      tasks: [],
      pools: [],
      loading: false,
      loadingConnections: [],
      errors: {},
      lastRefresh: null,
    })
  })

  it('shows startup auto-connect errors from the connection manager on the connection page', async () => {
    useConnectionManagerStore.setState({ error: '自动连接失败：请重新输入密码' })
    render(<MemoryRouter future={routerFuture}><ConnectPage /></MemoryRouter>)
    await waitFor(() => expect(mockXapi.profiles.list).toHaveBeenCalled())
    expect(screen.getByRole('alert')).toHaveTextContent('自动连接失败：请重新输入密码')
  })

  it('renders the saved server page while credential access is waiting', async () => {
    let release!: (value: { id: string }) => void
    mockXapi.profiles.list.mockResolvedValue([{ ...profile(), autoConnect: true }])
    mockXapi.profiles.connect.mockReturnValue(new Promise((resolve) => { release = resolve }))
    render(<MemoryRouter future={routerFuture}><App /></MemoryRouter>)
    expect(await screen.findByRole('button', { name: '添加服务器', exact: true })).toBeInTheDocument()
    expect(await screen.findByRole('status')).toHaveTextContent('钥匙串授权')
    await act(async () => { release({ id: 'conn-a' }) })
  })

  it('offers password entry when a saved credential is denied or unavailable', async () => {
    mockXapi.profiles.list.mockResolvedValue([profile()])
    mockXapi.profiles.hasPassword.mockResolvedValue(true)
    mockXapi.profiles.connect.mockRejectedValue(Object.assign(new Error('无法读取已保存密码，请重新输入密码'), { code: 'SAVED_PASSWORD_UNAVAILABLE' }))
    render(<MemoryRouter future={routerFuture}><ConnectPage /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: '连接', exact: true }))
    expect(await screen.findByPlaceholderText('输入密码')).toBeInTheDocument()
  })

  it.each(['page', 'dialog'])('lets a user replace a rejected saved password in the %s', async (surface) => {
    mockXapi.profiles.list.mockResolvedValue([profile()])
    mockXapi.profiles.hasPassword.mockResolvedValue(true)
    mockXapi.profiles.connect.mockRejectedValueOnce(Object.assign(new Error('用户名或密码不正确'), { code: 'SESSION_AUTHENTICATION_FAILED' }))
    mockXapi.connection.list.mockResolvedValue([connection('conn-a')])
    const onClose = vi.fn()
    render(<MemoryRouter future={routerFuture}>{surface === 'page'
      ? <ConnectPage /> : <RememberedServerDialog open onClose={onClose} />}</MemoryRouter>)

    fireEvent.click(await screen.findByRole('button', { name: '连接', exact: true }))
    const input = await screen.findByPlaceholderText('输入密码')
    expect(screen.getByText('用户名或密码不正确')).toBeInTheDocument()
    fireEvent.change(input, { target: { value: 'replacement-password' } })
    fireEvent.click(screen.getByRole('button', { name: '确认', exact: true }))
    await waitFor(() => expect(mockXapi.profiles.connect).toHaveBeenLastCalledWith('profile-a', 'replacement-password'))
    if (surface === 'dialog') await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  })

  it('opens settings before connecting and returns to the connection page', async () => {
    render(<MemoryRouter future={routerFuture} initialEntries={['/settings']}><App /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: '设置' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '软件更新' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('link', { name: '返回连接' }))
    expect(await screen.findByRole('button', { name: '添加服务器' })).toBeInTheDocument()
  })

  it('opens settings within the existing workspace when connected', async () => {
    mockXapi.connection.list.mockResolvedValue([connection('conn-a')])
    render(<MemoryRouter future={routerFuture} initialEntries={['/settings']}><App /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: '设置' })).toBeInTheDocument()
    expect(screen.getByTestId('app-shell')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '返回连接' })).not.toBeInTheDocument()
  })

  it('renders ConnectPage when there are no connected connections', async () => {
    render(
      <MemoryRouter future={routerFuture} initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('button', { name: '添加服务器', exact: true })).toBeInTheDocument()
    expect(screen.queryByText('内部实施阶段')).not.toBeInTheDocument()
  })

  it('keeps the current workspace and local draft mounted while the last connection recovers', async () => {
    mockXapi.connection.list.mockResolvedValue([connection('conn-a')])
    render(<MemoryRouter future={routerFuture} initialEntries={['/vms']}><App /></MemoryRouter>)
    const input = await screen.findByRole('textbox', { name: '页面草稿' })
    fireEvent.change(input, { target: { value: '保留的草稿' } })
    act(() => useConnectionManagerStore.setState({ connections: [{ ...connection('conn-a'), state: 'error', errorMessage: '网络中断' }] }))
    expect(screen.getByDisplayValue('保留的草稿')).toBe(input)
    act(() => useConnectionManagerStore.setState({ connections: [{ ...connection('conn-a'), epoch: 2 }] }))
    expect(screen.getByDisplayValue('保留的草稿')).toBe(input)
  })

  it('redirects /connect to /vms when a connection is already connected', async () => {
    mockXapi.connection.list.mockResolvedValue([connection('conn-a')])
    useConnectionManagerStore.setState({
      connections: [connection('conn-a')],
      activeConnectionId: 'conn-a',
    })

    render(
      <MemoryRouter future={routerFuture} initialEntries={['/connect']}>
        <App />
      </MemoryRouter>,
    )

    expect(await screen.findByText('VM page')).toBeInTheDocument()
  })

  it('restores an existing main-process connection when the renderer starts empty', async () => {
    mockXapi.connection.list.mockResolvedValue([connection('conn-a')])

    render(
      <MemoryRouter future={routerFuture} initialEntries={['/connect']}>
        <App />
      </MemoryRouter>,
    )

    expect(await screen.findByText('VM page')).toBeInTheDocument()
    expect(useConnectionManagerStore.getState().activeConnectionId).toBe('conn-a')
    expect(mockXapi.connection.connect).not.toHaveBeenCalled()
  })

  it('restores once under StrictMode and stops synchronization on unmount', async () => {
    mockXapi.profiles.list.mockResolvedValue([{ ...profile(), autoConnect: true }])
    mockXapi.connection.list.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValue([connection('conn-a')])
    const view = render(<StrictMode><MemoryRouter future={routerFuture}><App /></MemoryRouter></StrictMode>)
    expect(await screen.findByText('VM page')).toBeInTheDocument()
    expect(mockXapi.profiles.connect).toHaveBeenCalledTimes(1)
    expect(syncManager.start).toHaveBeenCalledTimes(1)
    const stops = vi.mocked(syncManager.stop).mock.calls.length
    view.unmount()
    expect(syncManager.stop).toHaveBeenCalledTimes(stops + 1)
  })

  it('connects from a saved server card, refreshes data, and navigates to /vms', async () => {
    mockXapi.profiles.list.mockResolvedValue([profile()])
    mockXapi.profiles.hasPassword.mockResolvedValue(true)
    mockXapi.connection.list.mockResolvedValue([connection('conn-a')])

    render(
      <MemoryRouter future={routerFuture} initialEntries={['/connect']}>
        <Routes>
          <Route
            path="/connect"
            element={
              <>
                <ConnectPage />
                <LocationProbe />
              </>
            }
          />
          <Route
            path="/vms"
            element={
              <>
                <div>VM route</div>
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText('Pool A')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^连接$/ }))

    expect(await screen.findByText('VM route')).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('/vms')
    expect(mockXapi.profiles.connect).toHaveBeenCalledWith('profile-a', undefined)
    expect(mockXapi.connection.connect).not.toHaveBeenCalled()
    expect(mockXapi.vm.list).toHaveBeenCalledWith('conn-a')
  })

  it.each(['/dashboard', '/batch-tasks', '/rbac', '/pool-manager'])('keeps the legacy %s route reachable', async (path) => {
    mockXapi.connection.list.mockResolvedValue([connection('conn-a')])
    render(<MemoryRouter future={routerFuture} initialEntries={[path]}><App /><LocationProbe /></MemoryRouter>)
    const expected = path === '/dashboard' ? '/vms' : path === '/batch-tasks' ? '/tasks' : '/pool/conn-a/settings'
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(expected))
  })

  it('collects metrics and listens for alerts directly from the VM entry, then stops on disconnect', async () => {
    mockXapi.connection.list.mockResolvedValue([connection('conn-a')])
    const view = render(<MemoryRouter future={routerFuture} initialEntries={['/vms']}><App /></MemoryRouter>)
    await screen.findByText('VM page')
    await waitFor(() => expect(mockXapi.metrics.startCollection).toHaveBeenCalledWith('conn-a', expect.any(Object)))
    expect(mockXapi.onAlertTriggered).toHaveBeenCalledTimes(2)
    const firstTimer = useMetricsStore.getState().collectionIntervalIds.get('conn-a')
    act(() => useConnectionManagerStore.setState({ connections: [{ ...connection('conn-a'), epoch: 2 }] }))
    expect(mockXapi.metrics.stopCollection).toHaveBeenCalledWith('conn-a')
    expect(useMetricsStore.getState().collectionIntervalIds.get('conn-a')).not.toBe(firstTimer)
    act(() => useConnectionManagerStore.setState({ connections: [{ ...connection('conn-a'), state: 'error' }] }))
    expect(useMetricsStore.getState().collectionIntervalIds.size).toBe(0)
    expect(useAlertStore.getState().pollingInterval).toBeNull()
    view.unmount()
  })

  it('closes RememberedServerDialog after a manual add succeeds', async () => {
    const onClose = vi.fn()
    const onConnected = vi.fn()

    render(
      <MemoryRouter future={routerFuture}>
        <RememberedServerDialog open={true} onClose={onClose} onConnected={onConnected} />
      </MemoryRouter>,
    )

    fireEvent.click(await screen.findByRole('button', { name: '手动添加服务器' }))
    // This stub is not a nested modal; the real AddServerDialog owns its focus layer.
    fireEvent.click(screen.getByText('complete manual add'))

    await waitFor(() => {
      expect(onConnected).toHaveBeenCalledTimes(1)
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  it('submits an explicit HTTP scheme independently of port 443', async () => {
    const onClose = vi.fn()
    const onConnected = vi.fn()

    render(
      <AddConnectionDialog open={true} onClose={onClose} onConnected={onConnected} />,
    )

    fireEvent.change(screen.getByPlaceholderText('192.168.1.100'), {
      target: { value: 'pool.example.test' },
    })
    fireEvent.change(screen.getByRole('combobox', { name: 'Protocol' }), {
      target: { value: 'http:' },
    })
    const passwordInput = document.querySelector('input[type="password"]')
    expect(passwordInput).not.toBeNull()
    fireEvent.change(passwordInput!, { target: { value: 'secret' } })
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))

    await waitFor(() => {
      expect(mockXapi.connection.connect).toHaveBeenCalledWith({
        host: 'pool.example.test',
        port: 443,
        scheme: 'http:',
        username: 'root',
        password: 'secret',
        allowSelfSigned: true,
      })
      expect(onConnected).toHaveBeenCalledWith('conn-a')
    })
  })
})
