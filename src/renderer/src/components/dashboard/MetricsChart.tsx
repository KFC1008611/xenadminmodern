/**
 * MetricsChart — reusable time-series chart for host/VM metrics.
 * v6: Compact mode with CPU/memory sparklines.
 * v7: Extended with multi-dimension support, time range selector, and statistics.
 */
import { useMemo, type ReactNode } from 'react'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts'
import type { TooltipValueType } from 'recharts'
import type { MetricDataPoint, MetricStats } from '../../types/xapi'
import { formatBytes } from '../../lib/utils'

export type MetricChartType = 'cpu' | 'memory' | 'networkRx' | 'networkTx' | 'diskRead' | 'diskWrite'

interface MetricsChartProps {
  data: MetricDataPoint[]
  metricType: MetricChartType
  compact?: boolean
  showTimeRangeSelector?: boolean
  timeRange?: '1h' | '24h' | '7d'
  onTimeRangeChange?: (range: '1h' | '24h' | '7d') => void
  stats?: MetricStats | null
  height?: number
}

/** Get the display label for a metric type (Chinese). */
function getMetricLabel(type: MetricChartType): string {
  const labels: Record<MetricChartType, string> = {
    cpu: 'CPU 利用率',
    memory: '内存利用率',
    networkRx: '网络接收',
    networkTx: '网络发送',
    diskRead: '磁盘读取',
    diskWrite: '磁盘写入',
  }
  return labels[type]
}

/** Get the color for a metric type line. */
function getMetricColor(type: MetricChartType): string {
  const colors: Record<MetricChartType, string> = {
    cpu: 'hsl(var(--chart-cpu))',
    memory: 'hsl(var(--chart-memory))',
    networkRx: 'hsl(var(--chart-network-rx))',
    networkTx: 'hsl(var(--chart-network-tx))',
    diskRead: 'hsl(var(--chart-disk-read))',
    diskWrite: 'hsl(var(--chart-disk-write))',
  }
  return colors[type]
}

/** Get the data key for a metric type. */
function getDataKey(type: MetricChartType): string {
  const keys: Record<MetricChartType, string> = {
    cpu: 'cpuPercent',
    memory: 'memoryPercent',
    networkRx: 'networkRxBytes',
    networkTx: 'networkTxBytes',
    diskRead: 'diskReadBytes',
    diskWrite: 'diskWriteBytes',
  }
  return keys[type]
}

/** Check if a metric type uses percentage (cpu/memory). */
function isPercentMetric(type: MetricChartType): boolean {
  return ['cpu', 'memory'].includes(type)
}

/** Format a Y-axis value based on metric type. */
function formatYAxis(value: number, type: MetricChartType): string {
  if (isPercentMetric(type)) {
    return `${value}%`
  }
  return formatBytes(value) + '/s'
}

/** Format a tooltip value based on metric type. */
function formatTooltipValue(value: number, type: MetricChartType): string {
  if (isPercentMetric(type)) {
    return `${value.toFixed(1)}%`
  }
  return formatBytes(value) + '/s'
}

/** Format a timestamp for X-axis display. */
function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Format a timestamp for tooltip display. */
function formatTooltipTimestamp(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function tooltipTimestamp(label: ReactNode): string {
  if (typeof label !== 'number' && typeof label !== 'string') return ''
  const timestamp = Number(label)
  return Number.isFinite(timestamp) ? formatTooltipTimestamp(timestamp) : ''
}

function tooltipNumber(value: TooltipValueType | undefined): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string') return Number(value) || 0
  if (!value) return 0
  const firstValue = value[0]
  return typeof firstValue === 'number' ? firstValue : Number(firstValue) || 0
}

export function MetricsChart({
  data,
  metricType,
  compact = false,
  showTimeRangeSelector = false,
  timeRange = '1h',
  onTimeRangeChange,
  stats,
  height,
}: MetricsChartProps) {
  const color = getMetricColor(metricType)
  const dataKey = getDataKey(metricType)
  const label = getMetricLabel(metricType)
  const useArea = !isPercentMetric(metricType)

  const chartHeight = compact ? 60 : (height ?? 200)
  const observedData = useMemo(() => data.map((point) => point.availableMetrics && !point.availableMetrics.includes(dataKey)
    ? { ...point, [dataKey]: null }
    : point), [data, dataKey])
  const hasObservations = observedData.some((point) => typeof (point as any)[dataKey] === 'number')
  const visibleStats = stats && stats.sampleCount !== 0 && hasObservations ? stats : null

  // Compute Y-axis domain
  const yDomain = useMemo(() => {
    if (isPercentMetric(metricType)) {
      return [0, 100]
    }
    // For bytes metrics, auto-scale based on data
    if (data.length === 0) return [0, 1]
    const values = data.map((d) => (d as any)[dataKey] ?? 0)
    const max = Math.max(...values, 1)
    return [0, Math.ceil(max * 1.1)]
  }, [data, metricType, dataKey])

  if (compact) {
    // Compact sparkline mode
    return (
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <ResponsiveContainer width="100%" height={chartHeight}>
            <LineChart data={observedData} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
              <Line
                type="monotone"
                dataKey={dataKey}
                stroke={color}
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
        {visibleStats && (
          <div className="text-right text-xs">
            <div className="font-medium" style={{ color }}>
              {formatTooltipValue(visibleStats.current, metricType)}
            </div>
          </div>
        )}
      </div>
    )
  }

  // Full chart mode
  return (
    <div className="space-y-2">
      {/* Header: label + time range selector + stats */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground">{label}</h3>
        <div className="flex items-center gap-3">
          {visibleStats && (
            <div className="flex gap-3 text-xs text-muted-foreground">
              <span>当前: {formatTooltipValue(visibleStats.current, metricType)}</span>
              <span>最大: {formatTooltipValue(visibleStats.max, metricType)}</span>
              <span>平均: {formatTooltipValue(visibleStats.avg, metricType)}</span>
            </div>
          )}
          {showTimeRangeSelector && onTimeRangeChange && (
            <div className="flex gap-1">
              {(['1h', '24h', '7d'] as const).map((range) => (
                <button
                  key={range}
                  onClick={() => onTimeRangeChange(range)}
                  className={`px-2 py-0.5 text-xs rounded ${
                    timeRange === range
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:bg-secondary'
                  }`}
                >
                  {range}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Chart */}
      {!hasObservations && <p className="text-xs text-subtle">暂无有效采样</p>}
      <div className="bg-card rounded-lg p-2">
        <ResponsiveContainer width="100%" height={chartHeight}>
          {useArea ? (
            <AreaChart data={observedData} margin={{ top: 4, right: 4, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis
                dataKey="timestamp"
                type="number"
                domain={['dataMin', 'dataMax']}
                tickFormatter={formatTimestamp}
                stroke="hsl(var(--subtle))"
                fontSize={11}
                tickLine={false}
              />
              <YAxis
                domain={yDomain}
                tickFormatter={(v) => formatYAxis(v, metricType)}
                stroke="hsl(var(--subtle))"
                fontSize={11}
                tickLine={false}
                width={60}
              />
              <Tooltip
                labelFormatter={tooltipTimestamp}
                formatter={(value) => [formatTooltipValue(tooltipNumber(value), metricType), label]}
                contentStyle={{
                  backgroundColor: 'hsl(var(--raised))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px',
                  fontSize: '12px',
                  color: 'hsl(var(--foreground))',
                }}
                labelStyle={{ color: 'hsl(var(--muted-foreground))' }}
              />
              <Area
                type="monotone"
                dataKey={dataKey}
                stroke={color}
                fill={color}
                fillOpacity={0.12}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          ) : (
            <LineChart data={observedData} margin={{ top: 4, right: 4, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis
                dataKey="timestamp"
                type="number"
                domain={['dataMin', 'dataMax']}
                tickFormatter={formatTimestamp}
                stroke="hsl(var(--subtle))"
                fontSize={11}
                tickLine={false}
              />
              <YAxis
                domain={yDomain}
                tickFormatter={(v) => formatYAxis(v, metricType)}
                stroke="hsl(var(--subtle))"
                fontSize={11}
                tickLine={false}
                width={60}
              />
              <Tooltip
                labelFormatter={tooltipTimestamp}
                formatter={(value) => [formatTooltipValue(tooltipNumber(value), metricType), label]}
                contentStyle={{
                  backgroundColor: 'hsl(var(--raised))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px',
                  fontSize: '12px',
                  color: 'hsl(var(--foreground))',
                }}
                labelStyle={{ color: 'hsl(var(--muted-foreground))' }}
              />
              <Line
                type="monotone"
                dataKey={dataKey}
                stroke={color}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  )
}

export default MetricsChart
