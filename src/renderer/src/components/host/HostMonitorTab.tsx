/**
 * HostMonitorTab — host detail page monitoring tab.
 * Shows 4-dimension metrics (CPU, Memory, Network I/O, Disk I/O)
 * with time range selector, stats summary, and auto-refresh.
 * v7: New component
 */
import { useEffect, useCallback, useState } from 'react'
import { Activity, RefreshCw, AlertTriangle } from 'lucide-react'
import { useMetricsStore } from '../../store/metrics.store'
import { useMultiDataStore } from '../../store/multiData.store'
import { HostMemorySummary } from './HostMemorySummary'
import { MetricsChart } from '../dashboard/MetricsChart'
import type { MetricStats } from '../../types/xapi'

interface HostMonitorTabProps {
  connectionId: string
  hostRef: string
}

function isMetricsDebugEnabled(): boolean {
  if (import.meta.env.MODE === 'test') {
    return false
  }

  if (typeof window === 'undefined') {
    return false
  }

  let userEnabled = false
  try {
    userEnabled = window.localStorage.getItem('xenadmin:metrics-debug') === '1'
  } catch {
    userEnabled = false
  }

  return Boolean(import.meta.env.DEV || userEnabled)
}

function logMetricsDebug(event: string, context?: Record<string, unknown>): void {
  if (!isMetricsDebugEnabled()) {
    return
  }
  if (context) {
    console.log(`[metrics:debug:host-tab] ${event}`, context)
    return
  }
  console.log(`[metrics:debug:host-tab] ${event}`)
}

/** Format value with unit based on metric type. */
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

/** Stats summary strip for a single metric. */
function StatsStrip({ label, stats, metricType, color }: { label: string; stats: MetricStats | null; metricType: string; color: string }) {
  if (!stats) return null
  return (
    <div className="flex items-center gap-4 text-xs">
      <span className="text-subtle font-medium">{label}</span>
      <span className={color}>当前 {formatStatValue(stats.current, metricType)}</span>
      <span className="text-muted-foreground">最大 {formatStatValue(stats.max, metricType)}</span>
      <span className="text-muted-foreground">平均 {formatStatValue(stats.avg, metricType)}</span>
    </div>
  )
}

export function HostMonitorTab({ connectionId, hostRef }: HostMonitorTabProps) {
  const host = useMultiDataStore((state) => state.hosts.find((record) => record.connectionId === connectionId && record.ref === hostRef))
  const {
    timeRange,
    setTimeRange,
    fetchRangeData,
    fetchStats,
    getRangeData,
    getHostStats,
  } = useMetricsStore()

  const [autoRefresh, setAutoRefresh] = useState(true)
  const [collectionError, setCollectionError] = useState<string | null>(null)

  const rangeData = getRangeData(connectionId, hostRef)
  const cpuStats = getHostStats(connectionId, hostRef, 'cpu')
  const memStats = getHostStats(connectionId, hostRef, 'memory')
  const netRxStats = getHostStats(connectionId, hostRef, 'networkRx')
  const netTxStats = getHostStats(connectionId, hostRef, 'networkTx')
  const diskReadStats = getHostStats(connectionId, hostRef, 'diskRead')
  const diskWriteStats = getHostStats(connectionId, hostRef, 'diskWrite')

  const loadData = useCallback(() => {
    logMetricsDebug('loadData:request', {
      connectionId,
      hostRef,
      timeRange,
    })

    fetchRangeData(connectionId, hostRef)
    fetchStats(connectionId, hostRef, 'cpu')
    fetchStats(connectionId, hostRef, 'memory')
    fetchStats(connectionId, hostRef, 'networkRx')
    fetchStats(connectionId, hostRef, 'networkTx')
    fetchStats(connectionId, hostRef, 'diskRead')
    fetchStats(connectionId, hostRef, 'diskWrite')

    // Check for collection errors
    if (connectionId) {
      window.xapi.metrics.getCollectionError(connectionId).then((err: string | null) => {
        setCollectionError(err)
      }).catch(() => {})
    }
  }, [connectionId, hostRef, fetchRangeData, fetchStats])

  useEffect(() => {
    logMetricsDebug('rangeData:updated', {
      connectionId,
      hostRef,
      rowCount: rangeData.length,
      timeRange,
      firstTimestamp: rangeData.length > 0 ? rangeData[0].timestamp : null,
      lastTimestamp: rangeData.length > 0 ? rangeData[rangeData.length - 1].timestamp : null,
    })
  }, [connectionId, hostRef, rangeData, timeRange])

  // Load data on mount and when time range changes
  useEffect(() => {
    loadData()
  }, [timeRange, loadData])

  // Auto-refresh every 30 seconds
  useEffect(() => {
    if (!autoRefresh) return
    const interval = setInterval(loadData, 30_000)
    return () => clearInterval(interval)
  }, [autoRefresh, loadData])

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        {/* Time range selector */}
        <div className="flex gap-1">
          {(['1h', '24h', '7d'] as const).map((range) => (
            <button
              key={range}
              onClick={() => setTimeRange(range)}
              className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
                timeRange === range
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-secondary'
              }`}
            >
              {range}
            </button>
          ))}
        </div>

        {/* Auto-refresh toggle */}
        <div className="flex items-center gap-2">
          <button
            onClick={loadData}
            className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
            title="立即刷新"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-colors ${
              autoRefresh
                ? 'bg-success-soft text-success border border-success/30'
                : 'bg-muted text-muted-foreground border border-input'
            }`}
          >
            <Activity className="w-3 h-3" />
            {autoRefresh ? '自动刷新: 开' : '自动刷新: 关'}
          </button>
        </div>
      </div>

      {/* CPU */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-3">
        <StatsStrip label="CPU 利用率" stats={cpuStats} metricType="cpu" color="text-accent-foreground" />
        <MetricsChart data={rangeData} metricType="cpu" height={200} />
      </div>

      {/* Memory */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-3">
        {host && <HostMemorySummary host={host} />}
        <StatsStrip label="内存利用率" stats={memStats} metricType="memory" color="text-success" />
        <MetricsChart data={rangeData} metricType="memory" height={200} />
      </div>

      {/* Network I/O */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-6">
          <StatsStrip label="网络接收" stats={netRxStats} metricType="networkRx" color="text-accent-foreground" />
          <StatsStrip label="网络发送" stats={netTxStats} metricType="networkTx" color="text-warning" />
        </div>
        <MetricsChart data={rangeData} metricType="networkRx" height={180} />
        <MetricsChart data={rangeData} metricType="networkTx" height={180} />
      </div>

      {/* Disk I/O */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-6">
          <StatsStrip label="磁盘读取" stats={diskReadStats} metricType="diskRead" color="text-accent-foreground" />
          <StatsStrip label="磁盘写入" stats={diskWriteStats} metricType="diskWrite" color="text-danger" />
        </div>
        <MetricsChart data={rangeData} metricType="diskRead" height={180} />
        <MetricsChart data={rangeData} metricType="diskWrite" height={180} />
      </div>

      {/* Collection error */}
      {collectionError && (
        <div className="bg-danger-soft border border-danger/30 rounded-xl p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-danger shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-danger font-medium">监控数据采集失败</p>
            <p className="text-xs text-danger mt-1">{collectionError}</p>
          </div>
        </div>
      )}

      {/* Empty state */}
      {rangeData.length === 0 && !collectionError && (
        <div className="text-center py-8">
          <Activity className="w-8 h-8 mx-auto mb-3 text-subtle" />
          <p className="text-sm text-subtle">暂无监控数据</p>
          <p className="text-xs text-subtle mt-1">监控采集已自动启动，请等待一个采样周期（约 30 秒）</p>
        </div>
      )}
    </div>
  )
}

export default HostMonitorTab
