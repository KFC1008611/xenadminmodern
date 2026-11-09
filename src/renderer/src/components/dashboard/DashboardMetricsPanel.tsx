/**
 * DashboardMetricsPanel — host metrics overview cards for the Dashboard page.
 * Shows CPU/memory sparklines and stats per host, with expandable detail view.
 * v7: New component
 */
import { useEffect, useState, useCallback } from 'react'
import { ChevronDown, ChevronUp, Activity, Server } from 'lucide-react'
import { useMetricsStore } from '../../store/metrics.store'
import { useConnectionManagerStore } from '../../store/connectionManager.store'
import { useMultiDataStore } from '../../store/multiData.store'
import { MetricsChart } from './MetricsChart'
import { MetricsDetailModal } from './MetricsDetailModal'
import { HostMemorySummary } from '../host/HostMemorySummary'

interface DashboardMetricsPanelProps {
  /** Called when the user wants to start collection */
  onStartCollection?: () => void
}

interface HostCardProps {
  connectionId: string
  hostRef: string
  hostName: string
  timeRange: '1h' | '24h' | '7d'
  onTimeRangeChange: (range: '1h' | '24h' | '7d') => void
  onExpand: (connectionId: string, hostRef: string, hostName: string) => void
}

function HostCard({ connectionId, hostRef, hostName, timeRange, onTimeRangeChange, onExpand }: HostCardProps) {
  const host = useMultiDataStore((state) => state.hosts.find((record) => record.connectionId === connectionId && record.ref === hostRef))
  const { getRangeData, getHostStats, history, fetchRangeData, fetchStats } = useMetricsStore()
  const [expanded, setExpanded] = useState(false)

  // Get real-time data from v6 store for sparklines
  const realtimeData = history.get(`${connectionId}:${hostRef}`) || []
  // Get persistent data from v7 store
  const rangeData = getRangeData(connectionId, hostRef)
  const cpuStats = getHostStats(connectionId, hostRef, 'cpu')
  const memStats = getHostStats(connectionId, hostRef, 'memory')

  // Use range data if available, otherwise fall back to realtime
  const displayData = rangeData.length > 0 ? rangeData : realtimeData

  const handleFetch = useCallback(() => {
    fetchRangeData(connectionId, hostRef)
    fetchStats(connectionId, hostRef, 'cpu')
    fetchStats(connectionId, hostRef, 'memory')
  }, [connectionId, hostRef, fetchRangeData, fetchStats])

  useEffect(() => {
    handleFetch()
  }, [timeRange, handleFetch])

  const latestData = displayData.length > 0 ? displayData[displayData.length - 1] : null
  const cpuPercent = latestData && (!latestData.availableMetrics || latestData.availableMetrics.includes('cpuPercent')) && Number.isFinite(latestData.cpuPercent) ? latestData.cpuPercent : null
  const memPercent = latestData && (!latestData.availableMetrics || latestData.availableMetrics.includes('memoryPercent')) && Number.isFinite(latestData.memoryPercent) ? latestData.memoryPercent : null

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      {/* Card Header */}
      <div className="px-4 py-3 flex items-center justify-between border-b border-border">
        <div className="flex items-center gap-2">
          <Server className="w-4 h-4 text-accent-foreground" />
          <span className="text-sm font-medium text-foreground">{hostName}</span>
        </div>
        <div className="flex items-center gap-2">
          {/* Time range selector */}
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
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-1 rounded hover:bg-muted text-muted-foreground"
            title={expanded ? '收起' : '展开详情'}
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Summary Row */}
      <div className="px-4 py-3 grid grid-cols-2 gap-4">
        <div>
          <div className="text-xs text-subtle mb-1">CPU</div>
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold text-accent-foreground">{cpuPercent === null ? '--' : `${cpuPercent.toFixed(1)}%`}</span>
            {cpuStats && cpuStats.sampleCount !== 0 && (
              <span className="text-xs text-subtle">
                最大 {cpuStats.max.toFixed(1)}% / 平均 {cpuStats.avg.toFixed(1)}%
              </span>
            )}
          </div>
          <div className="mt-1">
            <MetricsChart
              data={displayData.slice(-30)}
              metricType="cpu"
              compact
              stats={cpuStats}
            />
          </div>
        </div>
        <div>
          <div className="text-xs text-subtle mb-1">内存</div>
          {host && <HostMemorySummary host={host} />}
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold text-success">{memPercent === null ? '--' : `${memPercent.toFixed(1)}%`}</span>
            {memStats && memStats.sampleCount !== 0 && (
              <span className="text-xs text-subtle">
                最大 {memStats.max.toFixed(1)}% / 平均 {memStats.avg.toFixed(1)}%
              </span>
            )}
          </div>
          <div className="mt-1">
            <MetricsChart
              data={displayData.slice(-30)}
              metricType="memory"
              compact
              stats={memStats}
            />
          </div>
        </div>
      </div>

      {/* Expanded: 4-dimension charts */}
      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-border pt-4">
          <div className="flex justify-end">
            <button
              onClick={() => onExpand(connectionId, hostRef, hostName)}
              className="text-xs text-accent-foreground hover:text-accent-foreground flex items-center gap-1"
            >
              <Activity className="w-3 h-3" />
              查看详细视图
            </button>
          </div>
          <MetricsChart data={displayData} metricType="cpu" height={150} />
          <MetricsChart data={displayData} metricType="memory" height={150} />
          <MetricsChart data={displayData} metricType="networkRx" height={150} />
          <MetricsChart data={displayData} metricType="diskRead" height={150} />
        </div>
      )}
    </div>
  )
}

export function DashboardMetricsPanel({ onStartCollection }: DashboardMetricsPanelProps) {
  const { collecting, timeRange, setTimeRange, collectionErrors } = useMetricsStore()
  const connections = useConnectionManagerStore((s) => s.connections)
  const hosts = useMultiDataStore((s) => s.hosts)
  const connectedConns = connections.filter((c) => c.state === 'connected')
  const hasErrors = connectedConns.some((c) => collectionErrors?.[c.id])

  // Detail modal state
  const [detailModal, setDetailModal] = useState<{
    connectionId: string
    hostRef: string
    hostName: string
  } | null>(null)

  // Build host list from connected connections
  const hostsByConnection = connectedConns.map((conn) => ({
    connectionId: conn.id,
    poolName: conn.poolName ?? conn.host,
    hosts: hosts.filter((host) => host.connectionId === conn.id).map((h) => ({
      ref: h.ref,
      name: h.name_label,
    })),
  }))

  const allHosts = hostsByConnection.flatMap((c) =>
    c.hosts.map((h) => ({
      connectionId: c.connectionId,
      poolName: c.poolName,
      hostRef: h.ref,
      hostName: h.name,
    })),
  )

  if (!collecting && allHosts.length > 0) {
    return (
      <div className="bg-card border border-border rounded-xl p-8 text-center">
        <Activity className="w-8 h-8 text-subtle mx-auto mb-3" />
        <p className="text-sm text-muted-foreground mb-3">{hasErrors ? '监控启动失败' : '监控未启动'}</p>
        {connectedConns.filter((connection) => collectionErrors?.[connection.id]).map((connection) => (
          <p key={connection.id} role="alert" className="mb-3 break-words text-sm text-warning">{connection.poolName || connection.name}：{collectionErrors[connection.id]}</p>
        ))}
        {onStartCollection && (
          <button
            onClick={onStartCollection}
            className="px-4 py-2 bg-primary hover:bg-primary text-primary-foreground text-sm rounded-lg"
          >
            启动监控
          </button>
        )}
      </div>
    )
  }

  if (allHosts.length === 0) {
    return (
      <div className="bg-card border border-border rounded-xl p-8 text-center">
        <Server className="w-8 h-8 text-subtle mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">无已连接的主机</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Section Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-foreground flex items-center gap-2">
          <Activity className="w-4 h-4 text-accent-foreground" />
          主机性能监控
        </h2>
        {collecting && (
          <span className={`flex items-center gap-1.5 text-xs ${hasErrors ? 'text-warning' : 'text-success'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${hasErrors ? 'bg-warning-solid' : 'bg-success-solid animate-pulse'}`} />
            {hasErrors ? '部分采集失败' : '采集中'}
          </span>
        )}
      </div>

      {/* Host Cards grouped by connection */}
      {hostsByConnection.map((connGroup) => (
        <div key={connGroup.connectionId} className="space-y-2">
          <div className="text-xs text-subtle font-medium">{connGroup.poolName}</div>
          {collectionErrors?.[connGroup.connectionId] && <p role="alert" className="break-words rounded border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-warning">{collectionErrors[connGroup.connectionId]}</p>}
          {connGroup.hosts.map((host) => (
            <HostCard
              key={`${connGroup.connectionId}:${host.ref}`}
              connectionId={connGroup.connectionId}
              hostRef={host.ref}
              hostName={host.name}
              timeRange={timeRange}
              onTimeRangeChange={setTimeRange}
              onExpand={(cid, href, hname) => setDetailModal({ connectionId: cid, hostRef: href, hostName: hname })}
            />
          ))}
        </div>
      ))}

      {/* Detail Modal */}
      {detailModal && (
        <MetricsDetailModal
          connectionId={detailModal.connectionId}
          hostRef={detailModal.hostRef}
          hostName={detailModal.hostName}
          onClose={() => setDetailModal(null)}
        />
      )}
    </div>
  )
}

export default DashboardMetricsPanel
