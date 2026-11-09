/**
 * AlertHistoryList — rule engine alert history with filters and acknowledge.
 * v7: New component for alert history display.
 */
import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  Clock,
  Filter,
  Search,
  Zap,
} from 'lucide-react'
import { useAlertStore } from '../../store/alert.store'
import type { AlertSeverity } from '../../types/xapi'

/** Chinese labels for metric types. */
const metricLabels: Record<string, string> = {
  cpu: 'CPU',
  memory: '内存',
  networkRx: '网络接收',
  networkTx: '网络发送',
  diskRead: '磁盘读取',
  diskWrite: '磁盘写入',
}

/** Severity config. */
const severityConfig: Record<
  AlertSeverity,
  { badge: string; icon: typeof AlertTriangle; label: string }
> = {
  warning: {
    badge: 'bg-warning-soft text-warning border-warning/30',
    icon: AlertTriangle,
    label: '警告',
  },
  error: {
    badge: 'bg-danger-soft text-danger border-danger/30',
    icon: AlertCircle,
    label: '严重',
  },
}

/** Status config. */
const statusConfig: Record<
  string,
  { badge: string; icon: typeof CheckCircle2; label: string }
> = {
  active: {
    badge: 'bg-danger-soft text-danger',
    icon: AlertCircle,
    label: '活跃',
  },
  acknowledged: {
    badge: 'bg-accent text-accent-foreground',
    icon: CheckCircle2,
    label: '已确认',
  },
  resolved: {
    badge: 'bg-success-soft text-success',
    icon: CheckCircle2,
    label: '已解决',
  },
}

/** Format timestamp to relative time. */
function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`
  if (diff < 604800000) return `${Math.floor(diff / 86400000)} 天前`
  return new Date(ts).toLocaleString()
}

/** Format metric value with unit. */
function formatMetricValue(metricType: string, value: number): string {
  if (['cpu', 'memory'].includes(metricType)) {
    return `${value.toFixed(1)}%`
  }
  if (value === 0) return '0 B/s'
  const k = 1024
  const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s']
  const i = Math.floor(Math.log(value) / Math.log(k))
  return `${(value / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

type StatusFilter = 'all' | 'active' | 'acknowledged' | 'resolved'
type SeverityFilter = 'all' | 'warning' | 'error'

export function AlertHistoryList() {
  const {
    history,
    historyLoading,
    historyError,
    loadHistory,
    acknowledgeAlert,
    activeAlertCount,
    startAlertListener,
    stopAlertListener,
  } = useAlertStore()

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all')
  const [searchQuery, setSearchQuery] = useState('')

  // Load history and start listener on mount
  useEffect(() => {
    loadHistory()
    startAlertListener()
    return () => stopAlertListener()
  }, [])

  // Apply client-side filters
  const filteredHistory = useMemo(() => {
    let result = history

    if (statusFilter !== 'all') {
      result = result.filter((r) => r.status === statusFilter)
    }
    if (severityFilter !== 'all') {
      result = result.filter((r) => r.severity === severityFilter)
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter(
        (r) =>
          r.ruleName.toLowerCase().includes(q) ||
          r.entityName.toLowerCase().includes(q) ||
          (metricLabels[r.metricType] || r.metricType).toLowerCase().includes(q),
      )
    }

    return result
  }, [history, statusFilter, severityFilter, searchQuery])

  const handleAcknowledge = async (alertId: string) => {
    await acknowledgeAlert(alertId)
  }

  return (
    <div className="space-y-4">
      {historyError && <div role="alert" className="rounded-md border border-danger/30 bg-danger-soft p-3 text-sm text-danger">{historyError}</div>}
      {/* Header with active count */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-medium text-foreground">告警历史</h3>
          {activeAlertCount > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-danger-soft text-danger rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-danger-solid animate-pulse" />
              {activeAlertCount} 活跃
            </span>
          )}
        </div>
      </div>

      {/* Filters bar */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-subtle" />
          <input
            type="text"
            placeholder="搜索规则名、主机名..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-muted border border-input rounded-lg text-sm text-foreground placeholder-subtle focus:outline-none focus:border-primary/30 transition-colors"
          />
        </div>

        {/* Status filter */}
        <div className="flex items-center gap-1">
          <Filter className="w-3.5 h-3.5 text-subtle" />
          {(['all', 'active', 'acknowledged', 'resolved'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-2.5 py-1 text-xs rounded-lg transition-colors ${
                statusFilter === s
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-secondary'
              }`}
            >
              {s === 'all' ? '全部' : statusConfig[s]?.label || s}
            </button>
          ))}
        </div>

        {/* Severity filter */}
        <div className="flex items-center gap-1">
          {(['all', 'warning', 'error'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSeverityFilter(s)}
              className={`px-2.5 py-1 text-xs rounded-lg transition-colors ${
                severityFilter === s
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-secondary'
              }`}
            >
              {s === 'all' ? '全部级别' : severityConfig[s]?.label || s}
            </button>
          ))}
        </div>
      </div>

      {/* Loading state */}
      {historyLoading && history.length === 0 ? (
        <div className="text-center py-12 text-subtle">
          <Zap className="w-6 h-6 mx-auto mb-2 animate-pulse" />
          <p className="text-sm">加载告警历史...</p>
        </div>
      ) : filteredHistory.length === 0 ? (
        /* Empty state */
        <div className="text-center py-12">
          <CheckCircle2 className="w-8 h-8 mx-auto mb-3 text-subtle" />
          <p className="text-sm text-subtle">
            {searchQuery || statusFilter !== 'all' || severityFilter !== 'all'
              ? '没有匹配的告警记录'
              : '暂无告警历史'}
          </p>
        </div>
      ) : (
        /* History list */
        <div className="divide-y divide-border border border-border rounded-xl overflow-hidden">
          {filteredHistory.map((record) => {
            const sevConfig = severityConfig[record.severity]
            const statConfig = statusConfig[record.status] || statusConfig.active
            const SevIcon = sevConfig.icon
            const StatIcon = statConfig.icon

            return (
              <div key={record.id} className="bg-card px-4 py-3">
                <div className="flex items-start gap-3">
                  {/* Severity icon */}
                  <SevIcon
                    className={`w-4 h-4 mt-0.5 flex-shrink-0 ${
                      record.severity === 'error' ? 'text-danger' : 'text-warning'
                    }`}
                  />

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      {/* Severity badge */}
                      <span
                        className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full border ${sevConfig.badge}`}
                      >
                        {sevConfig.label}
                      </span>

                      {/* Status badge */}
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full ${statConfig.badge}`}
                      >
                        <StatIcon className="w-3 h-3" />
                        {statConfig.label}
                      </span>

                      {/* Time */}
                      <span className="text-xs text-subtle flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatRelativeTime(record.triggeredAt)}
                      </span>
                    </div>

                    {/* Rule name + entity */}
                    <div className="text-sm text-foreground font-medium truncate">
                      {record.ruleName}
                    </div>
                    <div className="text-xs text-subtle mt-0.5 flex items-center gap-3">
                      <span>实体: {record.entityName}</span>
                      <span className="text-subtle">|</span>
                      <span>
                        指标: {metricLabels[record.metricType] || record.metricType}{' '}
                        <span className="text-foreground">
                          {formatMetricValue(record.metricType, record.metricValue)}
                        </span>
                        {' '}(阈值 {formatMetricValue(record.metricType, record.threshold)})
                      </span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex-shrink-0">
                    {record.status === 'active' && (
                      <button
                        onClick={() => handleAcknowledge(record.id)}
                        className="px-3 py-1.5 text-xs bg-accent hover:bg-accent text-accent-foreground rounded-lg border border-primary/30 transition-colors"
                      >
                        确认
                      </button>
                    )}
                    {record.status === 'acknowledged' && (
                      <span className="text-xs text-subtle">
                        {record.acknowledgedAt
                          ? `${formatRelativeTime(record.acknowledgedAt)} 确认`
                          : '已确认'}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default AlertHistoryList
