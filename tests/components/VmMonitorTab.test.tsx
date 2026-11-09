/**
 * VmMonitorTab component tests.
 * Tests rendering of CPU/memory charts, time range, auto-refresh, stats, empty state.
 */
import React from 'react'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VmMetricDataPoint } from '../../src/renderer/src/types/xapi'
import { VmMonitorTab } from '../../src/renderer/src/components/vm/VmMonitorTab'

// Mock MetricsChart
vi.mock('../../src/renderer/src/components/dashboard/MetricsChart', () => ({
  MetricsChart: ({ metricType, height, data }: { metricType: string; height: number; data: unknown[] }) => (
    <div data-testid={`chart-${metricType}`} data-points={JSON.stringify(data)} style={{ height }}>
      Chart: {metricType}
    </div>
  ),
}))

describe('VmMonitorTab', () => {
  const defaultProps = {
    connectionId: 'conn-1',
    vmRef: 'OpaqueRef:vm-1',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(window.xapi.metrics.getVmHistory).mockResolvedValue([])
    // Ensure getCollectionError is mocked (may not exist in the preload type yet)
    if (!window.xapi.metrics.getCollectionError) {
      Object.defineProperty(window.xapi.metrics, 'getCollectionError', {
        value: vi.fn().mockResolvedValue(null),
        writable: true,
        configurable: true,
      })
    } else {
      vi.mocked(window.xapi.metrics.getCollectionError).mockResolvedValue(null)
    }
  })

  async function renderTab() {
    const view = render(<VmMonitorTab {...defaultProps} />)
    await waitFor(() => {
      expect(window.xapi.metrics.getVmHistory).toHaveBeenCalled()
    })
    await waitFor(() => {
      expect(window.xapi.metrics.getCollectionError).toHaveBeenCalledWith(defaultProps.connectionId)
    })
    return view
  }

  it('renders time range selector buttons', async () => {
    await renderTab()
    expect(screen.getByText('1h')).toBeTruthy()
    expect(screen.getByText('24h')).toBeTruthy()
    expect(screen.getByText('7d')).toBeTruthy()
  })

  it('renders auto-refresh toggle', async () => {
    await renderTab()
    expect(screen.getByText(/自动刷新/)).toBeTruthy()
  })

  it('toggles auto-refresh', async () => {
    await renderTab()
    const toggle = screen.getByText('自动刷新: 开')
    fireEvent.click(toggle)
    expect(screen.getByText('自动刷新: 关')).toBeTruthy()
  })

  it('calls getVmHistory on mount', async () => {
    await renderTab()
    await waitFor(() => {
      expect(window.xapi.metrics.getVmHistory).toHaveBeenCalledWith(
        'conn-1',
        'OpaqueRef:vm-1',
        expect.objectContaining({ startTime: expect.any(Number), endTime: expect.any(Number) }),
      )
    })
  })

  it('renders CPU and memory charts', async () => {
    await renderTab()
    expect(screen.getByTestId('chart-cpu')).toBeTruthy()
    expect(screen.getByTestId('chart-memory')).toBeTruthy()
  })

  it('displays stats from data', async () => {
    vi.mocked(window.xapi.metrics.getVmHistory).mockResolvedValue([
      { timestamp: Date.now() - 60000, cpuPercent: 25, memoryPercent: 40 },
      { timestamp: Date.now(), cpuPercent: 50, memoryPercent: 60 },
    ])
    await renderTab()
    await waitFor(() => {
      expect(screen.getByText(/当前 50.0%/)).toBeTruthy()
      expect(screen.getByText(/当前 60.0%/)).toBeTruthy()
    })
  })
  it('shows unavailable CPU and memory as unknown and preserves availability in chart data', async () => {
    vi.mocked(window.xapi.metrics.getVmHistory).mockResolvedValue([
      { timestamp: Date.now(), cpuPercent: 0, memoryPercent: 0, availableMetrics: [] },
    ])
    await renderTab()
    expect(await screen.findByText('CPU 利用率：--（暂无有效采样）')).toBeTruthy()
    expect(screen.getByText('内存利用率：--（暂无有效采样）')).toBeTruthy()
    expect(screen.queryByText('当前 0.0%')).toBeNull()
    expect(screen.getByTestId('chart-cpu').getAttribute('data-points')).toContain('"availableMetrics":[]')
  })

  it('displays empty state when no data', async () => {
    vi.mocked(window.xapi.metrics.getVmHistory).mockResolvedValue([])
    await renderTab()
    await waitFor(() => {
      expect(screen.getByText('暂无监控数据')).toBeTruthy()
    })
  })

  it('changes time range on button click', async () => {
    await renderTab()
    fireEvent.click(screen.getByText('7d'))
    await waitFor(() => {
      expect(window.xapi.metrics.getVmHistory).toHaveBeenCalledTimes(2)
    })
    await waitFor(() => {
      expect(window.xapi.metrics.getCollectionError).toHaveBeenCalledTimes(2)
    })
    // Should show 7d as active (bg-primary class)
    const btn = screen.getByText('7d')
    expect(btn.className).toContain('bg-primary')
  })

  it('renders refresh button', async () => {
    await renderTab()
    const refreshBtn = screen.getByTitle('立即刷新')
    expect(refreshBtn).toBeTruthy()
  })

  it('shows memory usage when available', async () => {
    vi.mocked(window.xapi.metrics.getVmHistory).mockResolvedValue([
      { timestamp: Date.now(), cpuPercent: 30, memoryPercent: 50, memoryUsed: 1073741824, memoryTotal: 2147483648 },
    ])
    await renderTab()
    await waitFor(() => {
      // Should show formatted memory: 1 GB / 2 GB
      expect(screen.getByText(/1 GB \/ 2 GB/)).toBeTruthy()
    })
  })
})

describe('VM monitoring request lifecycle', () => {
  it('waits for a slow read to finish before scheduling the next refresh', async () => {
    vi.useFakeTimers()
    let active = 0, peak = 0
    vi.mocked(window.xapi.metrics.getCollectionError).mockResolvedValue(null)
    vi.mocked(window.xapi.metrics.getVmHistory).mockReset().mockImplementation(() => {
      active++; peak = Math.max(peak, active)
      return new Promise((resolve) => setTimeout(() => { active--; resolve([]) }, 90_000))
    })
    const view = render(<VmMonitorTab connectionId="c" vmRef="v" />)
    try {
      await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
      expect(window.xapi.metrics.getVmHistory).toHaveBeenCalledTimes(1)
      await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
      expect(window.xapi.metrics.getVmHistory).toHaveBeenCalledTimes(1)
      await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
      expect(window.xapi.metrics.getVmHistory).toHaveBeenCalledTimes(2)
      expect(peak).toBe(1)
      fireEvent.click(screen.getByText('自动刷新: 开'))
      await act(async () => { await vi.advanceTimersByTimeAsync(120_000) })
      expect(window.xapi.metrics.getVmHistory).toHaveBeenCalledTimes(2)
    } finally { view.unmount(); vi.clearAllTimers(); vi.useRealTimers() }
  })

  it('coalesces range changes behind an in-flight read and ignores its obsolete data', async () => {
    const pending: Array<(data: VmMetricDataPoint[]) => void> = []
    vi.mocked(window.xapi.metrics.getCollectionError).mockResolvedValue(null)
    vi.mocked(window.xapi.metrics.getVmHistory).mockReset().mockImplementation(() => new Promise((resolve) => { pending.push(resolve) }))
    const view = render(<VmMonitorTab connectionId="c" vmRef="v" />)
    try {
      await waitFor(() => expect(pending).toHaveLength(1))
      fireEvent.click(screen.getByText('24h'))
      fireEvent.click(screen.getByText('7d'))
      expect(window.xapi.metrics.getVmHistory).toHaveBeenCalledTimes(1)
      await act(async () => { pending[0]([{ timestamp: Date.now(), cpuPercent: 99, memoryPercent: 30 }]) })
      await waitFor(() => expect(pending).toHaveLength(2))
      expect(screen.queryByText('当前 99.0%')).toBeNull()
      const query = vi.mocked(window.xapi.metrics.getVmHistory).mock.calls[1][2]
      expect(query.endTime - query.startTime).toBe(604800000)
      await act(async () => { pending[1]([{ timestamp: Date.now(), cpuPercent: 25, memoryPercent: 40 }]) })
      expect(screen.getByText('当前 25.0%')).toBeTruthy()
    } finally { view.unmount() }
  })

  it('ignores old VM responses and cancels queued reads when unmounted', async () => {
    let finish!: (data: VmMetricDataPoint[]) => void
    vi.mocked(window.xapi.metrics.getCollectionError).mockResolvedValue(null)
    vi.mocked(window.xapi.metrics.getVmHistory).mockReset().mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    const view = render(<VmMonitorTab connectionId="c" vmRef="v1" />)
    await waitFor(() => expect(window.xapi.metrics.getVmHistory).toHaveBeenCalledTimes(1))
    view.rerender(<VmMonitorTab connectionId="other" vmRef="v2" />)
    view.unmount()
    await act(async () => { finish([{ timestamp: Date.now(), cpuPercent: 99, memoryPercent: 20 }]) })
    expect(window.xapi.metrics.getVmHistory).toHaveBeenCalledTimes(1)
  })

  it('shows a history-read failure and clears it after a successful manual retry', async () => {
    vi.mocked(window.xapi.metrics.getCollectionError).mockResolvedValue(null)
    vi.mocked(window.xapi.metrics.getVmHistory).mockReset().mockRejectedValueOnce(new Error('读取历史失败'))
      .mockResolvedValue([{ timestamp: Date.now(), cpuPercent: 25, memoryPercent: 40 }])
    const view = render(<VmMonitorTab connectionId="c" vmRef="v" />)
    try {
      expect(await screen.findByText('读取历史失败')).toBeTruthy()
      fireEvent.click(screen.getByTitle('立即刷新'))
      expect(await screen.findByText('当前 25.0%')).toBeTruthy()
      expect(screen.queryByText('读取历史失败')).toBeNull()
    } finally { view.unmount() }
  })
})
