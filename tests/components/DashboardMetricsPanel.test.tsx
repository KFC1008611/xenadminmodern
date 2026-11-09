import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DashboardMetricsPanel } from '../../src/renderer/src/components/dashboard/DashboardMetricsPanel'
import type { MetricDataPoint, MetricStats } from '../../src/shared/types/xapi'

const metricsState = {
  collecting: true,
  timeRange: '1h' as const,
  setTimeRange: vi.fn(),
  getRangeData: vi.fn<(connectionId: string, hostRef: string) => MetricDataPoint[]>(() => []),
  getHostStats: vi.fn<(connectionId: string, hostRef: string, metric: string) => MetricStats | null>(() => null),
  history: new Map<string, MetricDataPoint[]>(),
  fetchRangeData: vi.fn(),
  fetchStats: vi.fn(),
  collectionErrors: {} as Record<string, string | null>,
}

const connectionState = {
  connections: [{
    id: 'connection-a',
    name: 'Pool A',
    host: 'pool-a.example.test',
    poolName: 'Pool A',
    poolRef: 'OpaqueRef:pool-a',
    state: 'connected' as const,
    errorMessage: null,
    connectedAt: 1,
  }],
}

const multiDataState = {
  hosts: [{
    ref: 'OpaqueRef:host-a',
    name_label: 'Host A',
    connectionId: 'connection-a',
  }],
}

vi.mock('../../src/renderer/src/store/metrics.store', () => ({
  useMetricsStore: () => metricsState,
}))

vi.mock('../../src/renderer/src/store/connectionManager.store', () => ({
  useConnectionManagerStore: (selector: (state: typeof connectionState) => unknown) => (
    selector(connectionState)
  ),
}))

vi.mock('../../src/renderer/src/store/multiData.store', () => ({
  useMultiDataStore: (selector: (state: typeof multiDataState) => unknown) => (
    selector(multiDataState)
  ),
}))

vi.mock('../../src/renderer/src/components/dashboard/MetricsChart', () => ({
  MetricsChart: () => <div data-testid="metrics-chart" />,
}))

vi.mock('../../src/renderer/src/components/dashboard/MetricsDetailModal', () => ({
  MetricsDetailModal: () => null,
}))

describe('DashboardMetricsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    metricsState.collecting = true
    metricsState.history = new Map()
    metricsState.collectionErrors = {}
    metricsState.getRangeData.mockReturnValue([])
    metricsState.getHostStats.mockReturnValue(null)
    connectionState.connections = connectionState.connections.slice(0, 1)
    multiDataState.hosts = [{ ref: 'OpaqueRef:host-a', name_label: 'Host A', connectionId: 'connection-a' }]
  })

  it('renders hosts from the connection-scoped inventory instead of ConnectionInfo', () => {
    render(<DashboardMetricsPanel />)

    expect(screen.getByText('Host A')).toBeInTheDocument()
    expect(screen.getByText('Pool A')).toBeInTheDocument()
  })

  it('keeps the startup failure visible when no collector could start', () => {
    metricsState.collecting = false
    metricsState.collectionErrors['connection-a'] = '无法启动：连接已断开'
    render(<DashboardMetricsPanel onStartCollection={vi.fn()} />)
    expect(screen.getByText('监控启动失败')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Pool A：无法启动：连接已断开')
    expect(screen.getByRole('button', { name: '启动监控' })).toBeInTheDocument()
  })

  it('shows the failed pool and its RRD cause instead of claiming successful collection', () => {
    metricsState.collectionErrors['connection-a'] = '主机 RRD 采集失败: Host A（Authentication failed (HTTP 401)）'
    render(<DashboardMetricsPanel />)
    expect(screen.getByText('部分采集失败')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('HTTP 401')
    expect(screen.queryByText('采集中')).not.toBeInTheDocument()
  })

  it('uses separate realtime samples for the same host reference in two resource pools', () => {
    connectionState.connections.push({ ...connectionState.connections[0], id: 'connection-b', name: 'Pool B', poolName: 'Pool B' })
    multiDataState.hosts.push({ ref: 'OpaqueRef:host-a', name_label: 'Host B', connectionId: 'connection-b' })
    metricsState.history.set('connection-a:OpaqueRef:host-a', [{ timestamp: 1, cpuPercent: 12, memoryPercent: 23 }])
    metricsState.history.set('connection-b:OpaqueRef:host-a', [{ timestamp: 1, cpuPercent: 78, memoryPercent: 89 }])

    render(<DashboardMetricsPanel />)

    const poolA = within(screen.getByText('Pool A').parentElement!)
    const poolB = within(screen.getByText('Pool B').parentElement!)
    expect(poolA.getByText('12.0%')).toBeInTheDocument()
    expect(poolA.getByText('23.0%')).toBeInTheDocument()
    expect(poolA.queryByText('78.0%')).not.toBeInTheDocument()
    expect(poolB.getByText('78.0%')).toBeInTheDocument()
    expect(poolB.getByText('89.0%')).toBeInTheDocument()
  })

  it('shows missing values without presenting zero samples or empty statistics as observations', () => {
    metricsState.getHostStats.mockReturnValue({ sampleCount: 0, current: 0, max: 0, min: 0, avg: 0 })

    render(<DashboardMetricsPanel />)

    expect(screen.getAllByText('--')).toHaveLength(2)
    expect(screen.queryByText('0.0%')).not.toBeInTheDocument()
    expect(screen.queryByText(/最大/)).not.toBeInTheDocument()
  })

  it('preserves an observed zero while marking an unavailable metric unknown', () => {
    metricsState.history.set('connection-a:OpaqueRef:host-a', [{ timestamp: 1, cpuPercent: 0, memoryPercent: 0, availableMetrics: ['cpuPercent'] }])
    metricsState.getHostStats.mockImplementation((_connectionId, _hostRef, metric) => metric === 'cpu'
      ? { sampleCount: 1, current: 0, max: 0, min: 0, avg: 0 }
      : { sampleCount: 0, current: 0, max: 0, min: 0, avg: 0 })

    render(<DashboardMetricsPanel />)

    expect(screen.getByText('0.0%')).toBeInTheDocument()
    expect(screen.getByText('--')).toBeInTheDocument()
    expect(screen.getAllByText(/最大 0.0%/)).toHaveLength(1)
  })
})
