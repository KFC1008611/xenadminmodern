import { DesktopDialog } from '../layout/DesktopDialog'
/**
 * MetricsDetailModal — full 4-dimension metrics view in a modal overlay.
 * v6: Basic single-chart modal.
 * v7: Refactored to show CPU/Memory/Network/Disk with shared time range.
 */
import { useEffect, useCallback } from 'react'
import { X, Server } from 'lucide-react'
import { useMetricsStore } from '../../store/metrics.store'
import { MetricsChart } from './MetricsChart'
import type { MetricStats } from '../../types/xapi'

interface MetricsDetailModalProps {
  connectionId: string
  hostRef: string
  hostName: string
  onClose: () => void
}

/** Format bytes to human-readable. */
function formatStatValue(value: number, metricType: string): string {
  if (['cpu', 'memory'].includes(metricType)) {
    return `${value.toFixed(1)}%`
  }
  if (value === 0) return '0 B/s'
  const k = 1024
  const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s']
  const i = Math.floor(Math.log(value) / Math.log(k))
  return `${(value / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

/** Stats summary card for a single metric. */
function StatsSummary({
  label,
  stats,
  metricType,
  color,
}: {
  label: string
  stats: MetricStats | null
  metricType: string
  color: string
}) {
  if (!stats) return null

  return (
    <div className="bg-muted rounded-lg p-3">
      <div className="text-xs text-subtle mb-2">{label}</div>
      <div className="grid grid-cols-4 gap-2 text-center">
        <div>
          <div className="text-xs text-subtle">当前</div>
          <div className={`text-sm font-medium ${color}`}>
            {formatStatValue(stats.current, metricType)}
          </div>
        </div>
        <div>
          <div className="text-xs text-subtle">最大</div>
          <div className="text-sm font-medium text-foreground">
            {formatStatValue(stats.max, metricType)}
          </div>
        </div>
        <div>
          <div className="text-xs text-subtle">平均</div>
          <div className="text-sm font-medium text-foreground">
            {formatStatValue(stats.avg, metricType)}
          </div>
        </div>
        <div>
          <div className="text-xs text-subtle">最小</div>
          <div className="text-sm font-medium text-foreground">
            {formatStatValue(stats.min, metricType)}
          </div>
        </div>
      </div>
    </div>
  )
}

export function MetricsDetailModal({
  connectionId,
  hostRef,
  hostName,
  onClose,
}: MetricsDetailModalProps) {
  const {
    timeRange,
    setTimeRange,
    fetchRangeData,
    fetchStats,
    getRangeData,
    getHostStats,
  } = useMetricsStore()

  const rangeData = getRangeData(connectionId, hostRef)
  const cpuStats = getHostStats(connectionId, hostRef, 'cpu')
  const memStats = getHostStats(connectionId, hostRef, 'memory')
  const netRxStats = getHostStats(connectionId, hostRef, 'networkRx')
  const netTxStats = getHostStats(connectionId, hostRef, 'networkTx')
  const diskReadStats = getHostStats(connectionId, hostRef, 'diskRead')
  const diskWriteStats = getHostStats(connectionId, hostRef, 'diskWrite')

  const loadData = useCallback(() => {
    fetchRangeData(connectionId, hostRef)
    fetchStats(connectionId, hostRef, 'cpu')
    fetchStats(connectionId, hostRef, 'memory')
    fetchStats(connectionId, hostRef, 'networkRx')
    fetchStats(connectionId, hostRef, 'networkTx')
    fetchStats(connectionId, hostRef, 'diskRead')
    fetchStats(connectionId, hostRef, 'diskWrite')
  }, [connectionId, hostRef, fetchRangeData, fetchStats])

  useEffect(() => {
    loadData()
  }, [timeRange, loadData])


  return (
    <DesktopDialog title="性能监控详情" onClose={onClose} busy={false} className="max-w-[900px]">
      <div className="w-full max-w-[900px] overflow-y-auto rounded-xl border border-input bg-card shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 bg-card border-b border-border px-6 py-4 flex items-center justify-between z-10">
          <div className="flex items-center gap-3">
            <Server className="w-5 h-5 text-accent-foreground" />
            <div>
              <h2 className="text-base font-semibold text-foreground">{hostName}</h2>
              <p className="text-xs text-subtle">性能监控详情</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Time range selector */}
            <div className="flex gap-1">
              {(['1h', '24h', '7d'] as const).map((range) => (
                <button
                  key={range}
                  onClick={() => setTimeRange(range)}
                  className={`px-3 py-1 text-xs rounded-lg ${
                    timeRange === range
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:bg-secondary'
                  }`}
                >
                  {range}
                </button>
              ))}
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* CPU */}
          <div>
            <StatsSummary label="CPU 利用率" stats={cpuStats} metricType="cpu" color="text-accent-foreground" />
            <div className="mt-3">
              <MetricsChart data={rangeData} metricType="cpu" height={180} />
            </div>
          </div>

          {/* Memory */}
          <div>
            <StatsSummary label="内存利用率" stats={memStats} metricType="memory" color="text-success" />
            <div className="mt-3">
              <MetricsChart data={rangeData} metricType="memory" height={180} />
            </div>
          </div>

          {/* Network I/O — dual lines via two AreaChart overlays */}
          <div>
            <div className="bg-muted rounded-lg p-3">
              <div className="text-xs text-subtle mb-2">网络 I/O</div>
              <div className="grid grid-cols-2 gap-4">
                <div className="text-center">
                  <div className="text-xs text-subtle">接收 当前</div>
                  <div className="text-sm font-medium text-accent-foreground">
                    {netRxStats ? formatStatValue(netRxStats.current, 'networkRx') : '--'}
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-xs text-subtle">发送 当前</div>
                  <div className="text-sm font-medium text-warning">
                    {netTxStats ? formatStatValue(netTxStats.current, 'networkTx') : '--'}
                  </div>
                </div>
              </div>
            </div>
            <div className="mt-3 space-y-3">
              <MetricsChart data={rangeData} metricType="networkRx" height={150} />
              <MetricsChart data={rangeData} metricType="networkTx" height={150} />
            </div>
          </div>

          {/* Disk I/O */}
          <div>
            <div className="bg-muted rounded-lg p-3">
              <div className="text-xs text-subtle mb-2">磁盘 I/O</div>
              <div className="grid grid-cols-2 gap-4">
                <div className="text-center">
                  <div className="text-xs text-subtle">读取 当前</div>
                  <div className="text-sm font-medium text-accent-foreground">
                    {diskReadStats ? formatStatValue(diskReadStats.current, 'diskRead') : '--'}
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-xs text-subtle">写入 当前</div>
                  <div className="text-sm font-medium text-danger">
                    {diskWriteStats ? formatStatValue(diskWriteStats.current, 'diskWrite') : '--'}
                  </div>
                </div>
              </div>
            </div>
            <div className="mt-3 space-y-3">
              <MetricsChart data={rangeData} metricType="diskRead" height={150} />
              <MetricsChart data={rangeData} metricType="diskWrite" height={150} />
            </div>
          </div>
        </div>
      </div>
    </DesktopDialog>
  )
}

export default MetricsDetailModal
