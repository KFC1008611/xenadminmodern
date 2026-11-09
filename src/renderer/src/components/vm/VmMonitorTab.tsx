/**
 * VmMonitorTab — VM detail page monitoring tab.
 * Shows CPU, Memory, Network I/O, and Disk I/O metrics with time range selector and auto-refresh.
 * v7: New component
 * v8: Added Network I/O and Disk I/O charts via RRD metrics
 */
import { useEffect, useRef, useState } from 'react'
import { Activity, RefreshCw, AlertTriangle } from 'lucide-react'
import { MetricsChart } from '../dashboard/MetricsChart'
import type { VmMetricDataPoint, MetricDataPoint, MetricStats } from '../../types/xapi'
import { formatBytes } from '../../lib/utils'
import { useConnectionManagerStore } from '../../store/connectionManager.store'

interface VmMonitorTabProps {
  connectionId: string
  vmRef: string
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
    console.log(`[metrics:debug:vm-tab] ${event}`, context)
    return
  }
  console.log(`[metrics:debug:vm-tab] ${event}`)
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

/** Compute stats from an array of values. */
function computeStats(values: number[]): MetricStats {
  if (values.length === 0) return { current: 0, max: 0, avg: 0, min: 0, sampleCount: 0 }
  const current = values[values.length - 1]
  const max = Math.max(...values)
  const min = Math.min(...values)
  const avg = values.reduce((a, b) => a + b, 0) / values.length
  return { current, max, avg, min, sampleCount: values.length }
}

/** Stats summary strip for a single metric. */
function StatsStrip({ label, stats, metricType, color }: { label: string; stats: MetricStats | null; metricType: string; color: string }) {
  if (!stats) return null
  if (stats.sampleCount === 0) return <div className="text-xs text-subtle">{label}：--（暂无有效采样）</div>
  return (
    <div className="flex items-center gap-4 text-xs">
      <span className="text-subtle font-medium">{label}</span>
      <span className={color}>当前 {formatStatValue(stats.current, metricType)}</span>
      <span className="text-muted-foreground">最大 {formatStatValue(stats.max, metricType)}</span>
      <span className="text-muted-foreground">平均 {formatStatValue(stats.avg, metricType)}</span>
    </div>
  )
}

/** Convert VmMetricDataPoint[] to MetricDataPoint[] for MetricsChart compatibility. */
function adaptVmData(vmData: VmMetricDataPoint[]): MetricDataPoint[] {
  return vmData.map((d) => ({
    timestamp: d.timestamp,
    availableMetrics: d.availableMetrics,
    cpuPercent: d.cpuPercent,
    memoryPercent: d.memoryPercent,
    networkRxBytes: d.networkRxBytes,
    networkTxBytes: d.networkTxBytes,
    diskReadBytes: d.diskReadBytes,
    diskWriteBytes: d.diskWriteBytes,
  }))
}

/** Check if VM data has any I/O metrics. */
function hasIoMetrics(vmData: VmMetricDataPoint[]): boolean {
  return vmData.some((d) =>
    d.networkRxBytes !== undefined ||
    d.networkTxBytes !== undefined ||
    d.diskReadBytes !== undefined ||
    d.diskWriteBytes !== undefined
  )
}

export function VmMonitorTab({ connectionId, vmRef }: VmMonitorTabProps) {
  const [vmData, setVmData] = useState<VmMetricDataPoint[]>([])
  const [timeRange, setTimeRange] = useState<'1h' | '24h' | '7d'>('1h')
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [loading, setLoading] = useState(false)
  const [collectionError, setCollectionError] = useState<string | null>(null)

  const connectionIdentity = useConnectionManagerStore((state) => {
    const info = state.connections.find((connection) => connection.id === connectionId)
    return JSON.stringify([info?.epoch, info?.poolUuid, info?.connectedAt, info?.state])
  })
  const inFlight = useRef<Promise<unknown> | null>(null)
  const refresh = useRef<() => void>(() => {})
  const configureAutoRefresh = useRef<() => void>(() => {})
  const autoRefreshRef = useRef(autoRefresh)
  autoRefreshRef.current = autoRefresh
  const previousScope = useRef('')

  useEffect(() => {
    let disposed = false
    let active = false
    let queued = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const scope = JSON.stringify([connectionId, vmRef, connectionIdentity])
    if (previousScope.current !== scope) { setVmData([]); setCollectionError(null); previousScope.current = scope }
    const clearTimer = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined }
    const schedule = () => {
      clearTimer()
      if (!disposed && !active && autoRefreshRef.current) timer = setTimeout(() => { void loadData() }, 30_000)
    }
    const loadData = async () => {
      if (disposed || !connectionId || !vmRef) return
      if (active) { queued = true; return }
      active = true
      clearTimer()
      setLoading(true)
      // A range or connection change waits for the preceding IPC to settle;
      // obsolete effects cannot send a queued read or publish their response.
      await inFlight.current?.catch(() => {})
      if (disposed) return
      const endTime = Date.now()
      const span = timeRange === '1h' ? 3600000 : timeRange === '24h' ? 86400000 : 604800000
      const reading = Promise.all([
        window.xapi.metrics.getVmHistory(connectionId, vmRef, { startTime: endTime - span, endTime }),
        window.xapi.metrics.getCollectionError(connectionId).catch(() => null),
      ])
      inFlight.current = reading
      try {
        const [data, error] = await reading
        if (!disposed) { setVmData(data); setCollectionError(error) }
      } catch (error: unknown) {
        if (!disposed) {
          const message = error instanceof Error ? error.message : String(error)
          setCollectionError(message)
          logMetricsDebug('loadData:error', { connectionId, vmRef, message })
        }
      } finally {
        if (inFlight.current === reading) inFlight.current = null
        active = false
        if (!disposed) {
          setLoading(false)
          if (queued) { queued = false; void loadData() }
          else schedule()
        }
      }
    }
    refresh.current = () => { void loadData() }
    configureAutoRefresh.current = schedule
    void loadData()
    return () => { disposed = true; clearTimer() }
  }, [connectionId, vmRef, connectionIdentity, timeRange])

  useEffect(() => { configureAutoRefresh.current() }, [autoRefresh])

  // Adapted data for MetricsChart
  const chartData = adaptVmData(vmData)

  // Compute stats
  const observedValues = (key: keyof MetricDataPoint): number[] => vmData
    .filter((point) => !point.availableMetrics || point.availableMetrics.includes(key))
    .map((point) => point[key]).filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  const cpuStats = computeStats(observedValues('cpuPercent'))
  const memStats = computeStats(observedValues('memoryPercent'))
  const netRxStats = computeStats(observedValues('networkRxBytes'))
  const netTxStats = computeStats(observedValues('networkTxBytes'))
  const diskReadStats = computeStats(observedValues('diskReadBytes'))
  const diskWriteStats = computeStats(observedValues('diskWriteBytes'))

  // Get latest memory usage info
  const latestPoint = vmData.length > 0 ? vmData[vmData.length - 1] : null
  const showIo = hasIoMetrics(vmData)

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
            onClick={() => refresh.current()}
            disabled={loading}
            className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
            title="立即刷新"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
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
        <MetricsChart data={chartData} metricType="cpu" height={200} />
      </div>

      {/* Memory */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <StatsStrip label="内存利用率" stats={memStats} metricType="memory" color="text-success" />
          {latestPoint?.memoryUsed !== undefined && latestPoint?.memoryTotal !== undefined && (
            <div className="text-xs text-muted-foreground">
              {formatBytes(latestPoint.memoryUsed, 1)} / {formatBytes(latestPoint.memoryTotal, 1)}
            </div>
          )}
        </div>
        <MetricsChart data={chartData} metricType="memory" height={200} />
      </div>

      {/* Network I/O */}
      {showIo && (
        <div className="bg-card border border-border rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-6">
            <StatsStrip label="网络接收" stats={netRxStats} metricType="networkRx" color="text-accent-foreground" />
            <StatsStrip label="网络发送" stats={netTxStats} metricType="networkTx" color="text-warning" />
          </div>
          <MetricsChart data={chartData} metricType="networkRx" height={180} />
          <MetricsChart data={chartData} metricType="networkTx" height={180} />
        </div>
      )}

      {/* Disk I/O */}
      {showIo && (
        <div className="bg-card border border-border rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-6">
            <StatsStrip label="磁盘读取" stats={diskReadStats} metricType="diskRead" color="text-accent-foreground" />
            <StatsStrip label="磁盘写入" stats={diskWriteStats} metricType="diskWrite" color="text-danger" />
          </div>
          <MetricsChart data={chartData} metricType="diskRead" height={180} />
          <MetricsChart data={chartData} metricType="diskWrite" height={180} />
        </div>
      )}

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
      {vmData.length === 0 && !loading && !collectionError && (
        <div className="text-center py-8">
          <Activity className="w-8 h-8 mx-auto mb-3 text-subtle" />
          <p className="text-sm text-subtle">暂无监控数据</p>
          <p className="text-xs text-subtle mt-1">请确保已启动监控采集并等待一个采样周期</p>
        </div>
      )}
    </div>
  )
}

export default VmMonitorTab
