/**
 * AlertsPage — full alert center page with tabs for XAPI alerts, alert rules, and alert history.
 * v5: XAPI message alerts with filters, pagination, bulk actions.
 * v7: Added tabs for alert rules (AlertRuleList) and alert history (AlertHistoryList),
 *     real-time toast notifications via onAlertTriggered listener.
 */
import { useEffect, useState, useMemo, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import * as Tabs from '@radix-ui/react-tabs'
import { useAlertStore } from '../store/alert.store'
import AlertItem from '../components/alerts/AlertItem'
import AlertFilters from '../components/alerts/AlertFilters'
import BulkActionBar from '../components/alerts/BulkActionBar'
import { AlertRuleList } from '../components/alerts/AlertRuleList'
import { AlertHistoryList } from '../components/alerts/AlertHistoryList'
import { NotificationConfigPanel } from '../components/alerts/NotificationConfigPanel'
import { RefreshCw, BellOff, Bell, Settings, History, Mail } from 'lucide-react'
import { cn } from '../lib/utils'
import { feedback } from '../store/feedback.store'

const PAGE_SIZE = 50

export default function AlertsPage() {
  const alerts = useAlertStore((s) => s.alerts)
  const loading = useAlertStore((s) => s.loading)
  const alertError = useAlertStore((s) => s.error)
  const refreshAlerts = useAlertStore((s) => s.refreshAlerts)
  const startPolling = useAlertStore((s) => s.startPolling)
  const stopPolling = useAlertStore((s) => s.stopPolling)
  const dismissAlert = useAlertStore((s) => s.dismissAlert)
  const filters = useAlertStore((s) => s.filters)
  const setFilters = useAlertStore((s) => s.setFilters)
  const startAlertListener = useAlertStore((s) => s.startAlertListener)
  const stopAlertListener = useAlertStore((s) => s.stopAlertListener)

  // feedback used directly
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedTab = searchParams.get('tab') || 'alerts'
  const activeTab = ['alerts', 'rules', 'history', 'notify'].includes(requestedTab) ? requestedTab : 'alerts'
  const setActiveTab = useCallback(
    (tab: string) => {
      setSearchParams(tab === 'alerts' ? {} : { tab })
    },
    [setSearchParams],
  )
  const [page, setPage] = useState(1)

  // Reset page when filters change
  useEffect(() => {
    setPage(1)
  }, [filters])

  // Start/stop XAPI alert polling on mount/unmount
  useEffect(() => {
    startPolling()
    return () => stopPolling()
  }, [])

  // v7: Start alert triggered listener for toast notifications
  useEffect(() => {
    startAlertListener()
    return () => stopAlertListener()
  }, [])

  // v7: Toast notification for triggered alerts
  useEffect(() => {
    const unsubscribe = window.xapi.onAlertTriggered((record) => {
      if (record.status === 'resolved') {
        feedback.success(`告警恢复：${record.ruleName} · ${record.entityName}`)
        return
      }
      const severityLabel = record.severity === 'error' ? '严重' : '警告'
      feedback.error(
        `[${severityLabel}] ${record.ruleName}: ${record.entityName} - ${record.metricType} 超过阈值`,
      )
    })
    return () => unsubscribe()
  }, [])

  // Apply client-side filters
  const filteredAlerts = useMemo(() => {
    let result = alerts

    if (filters.sourceConnectionId) {
      result = result.filter((a) => a.connectionId === filters.sourceConnectionId)
    }
    if (filters.severity && filters.severity.length > 0) {
      result = result.filter((a) => filters.severity!.includes(a.severity))
    }
    if (filters.timeRange && filters.timeRange !== 'all') {
      const now = Date.now()
      let since: number | undefined
      switch (filters.timeRange) {
        case '1h':
          since = now - 3600000
          break
        case '24h':
          since = now - 86400000
          break
        case '7d':
          since = now - 604800000
          break
      }
      if (since !== undefined) {
        result = result.filter((a) => a.timestamp >= since)
      }
    }

    return result
  }, [alerts, filters])

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filteredAlerts.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const paginatedAlerts = filteredAlerts.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  )

  // Page number window (show at most 7 page buttons)
  const pageWindow = useMemo(() => {
    const pages: number[] = []
    const start = Math.max(1, safePage - 3)
    const end = Math.min(totalPages, start + 6)
    for (let i = start; i <= end; i++) {
      pages.push(i)
    }
    return pages
  }, [safePage, totalPages])

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-foreground">告警中心</h1>
      </div>

      {/* Tabs */}
      <Tabs.Root value={activeTab} onValueChange={setActiveTab}>
        <div className="mb-4 overflow-x-auto border-b border-border">
          <Tabs.List className="flex min-w-max gap-1">
            <Tabs.Trigger
              value="alerts"
              className={cn(
                'flex shrink-0 items-center gap-1.5 whitespace-nowrap px-4 py-2.5 text-sm border-b-2 transition-colors -mb-px',
                activeTab === 'alerts'
                  ? 'border-primary/30 text-accent-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              <Bell className="w-4 h-4" />
              告警消息
              {filteredAlerts.length > 0 && (
                <span className="ml-1 px-1.5 py-0.5 text-xs bg-muted rounded-full">
                  {filteredAlerts.length}
                </span>
              )}
            </Tabs.Trigger>
            <Tabs.Trigger
              value="rules"
              className={cn(
                'flex shrink-0 items-center gap-1.5 whitespace-nowrap px-4 py-2.5 text-sm border-b-2 transition-colors -mb-px',
                activeTab === 'rules'
                  ? 'border-primary/30 text-accent-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              <Settings className="w-4 h-4" />
              告警规则
            </Tabs.Trigger>
            <Tabs.Trigger
              value="history"
              className={cn(
                'flex shrink-0 items-center gap-1.5 whitespace-nowrap px-4 py-2.5 text-sm border-b-2 transition-colors -mb-px',
                activeTab === 'history'
                  ? 'border-primary/30 text-accent-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              <History className="w-4 h-4" />
              告警历史
            </Tabs.Trigger>
            <Tabs.Trigger
              value="notify"
              className={cn(
                'flex shrink-0 items-center gap-1.5 whitespace-nowrap px-4 py-2.5 text-sm border-b-2 transition-colors -mb-px',
                activeTab === 'notify'
                  ? 'border-primary/30 text-accent-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              <Mail className="w-4 h-4" />
              通知配置
            </Tabs.Trigger>
          </Tabs.List>
        </div>

        {/* Tab: XAPI Alert Messages */}
        <Tabs.Content value="alerts" className="outline-none space-y-4">
          {alertError && <div role="alert" className="rounded-md border border-danger/30 bg-danger-soft p-3 text-sm text-danger">{alertError}</div>}
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {filteredAlerts.length} 条告警
              {filters.severity && filters.severity.length > 0 && ' (已筛选)'}
            </p>
            <button
              onClick={refreshAlerts}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
            >
              <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
              刷新
            </button>
          </div>

          {/* Filters */}
          <AlertFilters />

          {/* Content area */}
          <div className="bg-background border border-border rounded-xl overflow-hidden">
            {loading && alerts.length === 0 ? (
              /* Loading spinner */
              <div className="flex flex-col items-center justify-center py-16">
                <RefreshCw className="w-6 h-6 text-subtle animate-spin mb-3" />
                <p className="text-sm text-subtle">加载告警中...</p>
              </div>
            ) : filteredAlerts.length === 0 ? (
              /* Empty state */
              <div className="flex flex-col items-center justify-center py-16">
                <BellOff className="w-8 h-8 text-subtle mb-3" />
                <p className="text-sm text-subtle">
                  {alerts.length === 0 ? '暂无告警' : '没有匹配当前筛选条件的告警'}
                </p>
                {alerts.length > 0 && (
                  <button
                    onClick={() =>
                      setFilters({
                        severity: undefined,
                        timeRange: 'all',
                        sourceConnectionId: undefined,
                      })
                    }
                    className="mt-2 text-xs text-accent-foreground hover:text-accent-foreground transition-colors"
                  >
                    清除筛选
                  </button>
                )}
              </div>
            ) : (
              <>
                {/* Alert list */}
                <div className="divide-y divide-border">
                  {paginatedAlerts.map((alert) => (
                    <AlertItem
                      key={`${alert.connectionId}-${alert.ref}`}
                      alert={alert}
                      onDismiss={dismissAlert}
                    />
                  ))}
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between px-4 py-3 border-t border-border">
                    <span className="text-xs text-subtle">
                      第 {(safePage - 1) * PAGE_SIZE + 1}
                      -{Math.min(safePage * PAGE_SIZE, filteredAlerts.length)} 条，共{' '}
                      {filteredAlerts.length} 条
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        disabled={safePage <= 1}
                        className={cn(
                          'px-2.5 py-1 text-xs rounded-lg transition-colors',
                          safePage <= 1
                            ? 'text-subtle cursor-not-allowed'
                            : 'text-muted-foreground hover:text-foreground hover:bg-muted',
                        )}
                      >
                        上一页
                      </button>
                      {pageWindow.map((p) => (
                        <button
                          key={p}
                          onClick={() => setPage(p)}
                          className={cn(
                            'px-2.5 py-1 text-xs rounded-lg transition-colors min-w-[28px]',
                            p === safePage
                              ? 'bg-primary text-primary-foreground'
                              : 'text-muted-foreground hover:text-foreground hover:bg-muted',
                          )}
                        >
                          {p}
                        </button>
                      ))}
                      <button
                        onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                        disabled={safePage >= totalPages}
                        className={cn(
                          'px-2.5 py-1 text-xs rounded-lg transition-colors',
                          safePage >= totalPages
                            ? 'text-subtle cursor-not-allowed'
                            : 'text-muted-foreground hover:text-foreground hover:bg-muted',
                        )}
                      >
                        下一页
                      </button>
                    </div>
                  </div>
                )}

                {/* Bulk actions */}
                <BulkActionBar />
              </>
            )}
          </div>
        </Tabs.Content>

        {/* Tab: Alert Rules */}
        <Tabs.Content value="rules" className="outline-none">
          <AlertRuleList />
        </Tabs.Content>

        {/* Tab: Alert History */}
        <Tabs.Content value="history" className="outline-none">
          <AlertHistoryList />
        </Tabs.Content>

        {/* Tab: Notification Config */}
        <Tabs.Content value="notify" className="outline-none">
          <NotificationConfigPanel />
        </Tabs.Content>
      </Tabs.Root>
    </div>
  )
}
