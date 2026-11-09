/**
 * HostMonitorTab component tests.
 * Tests rendering of metric sections, time range selector, auto-refresh, stats display.
 */
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { HostMonitorTab } from '../../src/renderer/src/components/host/HostMonitorTab'

// Mock the metrics store
const mockFetchRangeData = vi.fn()
const mockFetchStats = vi.fn()
const mockSetTimeRange = vi.fn()
const mockGetRangeData = vi.fn().mockReturnValue([])
const mockGetHostStats = vi.fn().mockReturnValue(null)

vi.mock('../../src/renderer/src/store/metrics.store', () => ({
  useMetricsStore: () => ({
    timeRange: '1h',
    setTimeRange: mockSetTimeRange,
    fetchRangeData: mockFetchRangeData,
    fetchStats: mockFetchStats,
    getRangeData: mockGetRangeData,
    getHostStats: mockGetHostStats,
  }),
}))

// Mock MetricsChart to avoid Recharts rendering
vi.mock('../../src/renderer/src/components/dashboard/MetricsChart', () => ({
  MetricsChart: ({ metricType, height }: { metricType: string; height: number }) => (
    <div data-testid={`chart-${metricType}`} style={{ height }}>
      Chart: {metricType}
    </div>
  ),
}))

// Mock window.xapi.metrics.getCollectionError
const mockGetCollectionError = vi.fn().mockResolvedValue(null)
beforeAll(() => {
  Object.defineProperty(window, 'xapi', {
    value: {
      metrics: {
        getCollectionError: mockGetCollectionError,
      },
    },
    writable: true,
  })
})

describe('HostMonitorTab', () => {
  const defaultProps = {
    connectionId: 'conn-1',
    hostRef: 'OpaqueRef:host-1',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetCollectionError.mockResolvedValue(null)
    mockGetRangeData.mockReturnValue([])
    mockGetHostStats.mockReturnValue(null)
  })

  async function renderTab() {
    const view = render(<HostMonitorTab {...defaultProps} />)
    await waitFor(() => {
      expect(mockGetCollectionError).toHaveBeenCalledWith(defaultProps.connectionId)
    })
    return view
  }

  it('renders time range selector buttons', async () => {
    await renderTab()
    expect(screen.getByText('1h')).toBeTruthy()
    expect(screen.getByText('24h')).toBeTruthy()
    expect(screen.getByText('7d')).toBeTruthy()
  })

  it('calls setTimeRange when clicking range buttons', async () => {
    await renderTab()
    fireEvent.click(screen.getByText('24h'))
    expect(mockSetTimeRange).toHaveBeenCalledWith('24h')
  })

  it('renders auto-refresh toggle', async () => {
    await renderTab()
    expect(screen.getByText(/自动刷新/)).toBeTruthy()
  })

  it('toggles auto-refresh on click', async () => {
    await renderTab()
    const toggle = screen.getByText('自动刷新: 开')
    fireEvent.click(toggle)
    expect(screen.getByText('自动刷新: 关')).toBeTruthy()
  })

  it('calls loadData on mount', async () => {
    await renderTab()
    expect(mockFetchRangeData).toHaveBeenCalledWith('conn-1', 'OpaqueRef:host-1')
    expect(mockFetchStats).toHaveBeenCalled()
  })

  it('renders all four metric charts', async () => {
    await renderTab()
    expect(screen.getByTestId('chart-cpu')).toBeTruthy()
    expect(screen.getByTestId('chart-memory')).toBeTruthy()
    expect(screen.getByTestId('chart-networkRx')).toBeTruthy()
    expect(screen.getByTestId('chart-networkTx')).toBeTruthy()
    expect(screen.getByTestId('chart-diskRead')).toBeTruthy()
    expect(screen.getByTestId('chart-diskWrite')).toBeTruthy()
  })

  it('displays stats when available', async () => {
    mockGetHostStats.mockReturnValue({ current: 42.5, max: 80, avg: 35, min: 10 })
    await renderTab()
    // Stats appear in all 6 metric sections, so use getAllByText
    expect(screen.getAllByText(/当前 42.5%/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/最大 80.0%/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/平均 35.0%/).length).toBeGreaterThan(0)
  })

  it('displays empty state when no data', async () => {
    mockGetRangeData.mockReturnValue([])
    await renderTab()
    expect(screen.getByText('暂无监控数据')).toBeTruthy()
  })

  it('renders refresh button', async () => {
    await renderTab()
    const refreshBtn = screen.getByTitle('立即刷新')
    expect(refreshBtn).toBeTruthy()
    fireEvent.click(refreshBtn)
    await waitFor(() => {
      expect(mockGetCollectionError).toHaveBeenCalledTimes(2)
    })
    expect(mockFetchRangeData).toHaveBeenCalled()
  })
})
