/**
 * Alert store — manages alert state across all connections.
 * v5: Aggregates alerts from every connected pool, supports polling,
 *     client-side filtering, and dismiss operations.
 * v7: Extended with rule engine alert history, acknowledge, and real-time listener.
 */
import { create } from 'zustand'
import type { ConnectedAlertRecord, AlertHistoryRecord, AlertHistoryFilters } from '../types/xapi'
import { useConnectionManagerStore } from './connectionManager.store'

type Severity = 'error' | 'warning' | 'info'
type TimeRange = '1h' | '24h' | '7d' | 'all'

interface AlertFilterState {
  severity?: Severity[]
  timeRange?: TimeRange
  sourceConnectionId?: string
}

interface AlertStore {
  // v5: XAPI message alerts
  alerts: ConnectedAlertRecord[]
  unreadCount: number
  errorCount: number
  warningCount: number
  loading: boolean
  error: string | null
  lastRefresh: Date | null
  filters: AlertFilterState
  pollingInterval: number | null

  // v7: Rule engine alert history
  history: AlertHistoryRecord[]
  historyFilters: AlertHistoryFilters
  historyLoading: boolean
  historyError: string | null
  activeAlertCount: number

  // v5 Actions
  refreshAlerts: () => Promise<void>
  startPolling: (intervalMs?: number) => void
  stopPolling: () => void
  dismissAlert: (connectionId: string, alertRef: string) => Promise<void>
  dismissAll: (connectionId?: string) => Promise<void>
  setFilters: (filters: Partial<AlertFilterState>) => void

  // v7 Actions
  loadHistory: (filters?: AlertHistoryFilters) => Promise<void>
  acknowledgeAlert: (alertId: string) => Promise<void>
  setHistoryFilters: (filters: AlertHistoryFilters) => void
  refreshActiveCount: () => void
  addTriggeredAlert: (record: AlertHistoryRecord) => void

  // v7: Listener lifecycle
  startAlertListener: () => void
  stopAlertListener: () => void
}

/** Convert a TimeRange value to a millisecond offset from now. */
function timeRangeToSince(range: TimeRange): number | undefined {
  const now = Date.now()
  switch (range) {
    case '1h':
      return now - 3600000
    case '24h':
      return now - 86400000
    case '7d':
      return now - 604800000
    case 'all':
    default:
      return undefined
  }
}

/** Apply client-side filters to the full alert list. */
function applyFilters(
  alerts: ConnectedAlertRecord[],
  filters: AlertFilterState,
): ConnectedAlertRecord[] {
  let filtered = alerts

  if (filters.sourceConnectionId) {
    filtered = filtered.filter((a) => a.connectionId === filters.sourceConnectionId)
  }

  if (filters.severity && filters.severity.length > 0) {
    filtered = filtered.filter((a) => filters.severity!.includes(a.severity))
  }

  if (filters.timeRange && filters.timeRange !== 'all') {
    const since = timeRangeToSince(filters.timeRange)
    if (since !== undefined) {
      filtered = filtered.filter((a) => a.timestamp >= since)
    }
  }

  return filtered
}

/** Compute counts from a filtered alert list. */
function computeCounts(alerts: ConnectedAlertRecord[]) {
  let errorCount = 0
  let warningCount = 0
  let unreadCount = 0

  for (const alert of alerts) {
    if (alert.severity === 'error') {
      errorCount++
      unreadCount++
    } else if (alert.severity === 'warning') {
      warningCount++
      unreadCount++
    }
    // 'info' alerts do not contribute to unread
  }

  return { errorCount, warningCount, unreadCount }
}

export const useAlertStore = create<AlertStore>((set, get) => ({
  // v5 state
  alerts: [],
  unreadCount: 0,
  errorCount: 0,
  warningCount: 0,
  loading: false,
  error: null,
  lastRefresh: null,
  filters: {},
  pollingInterval: null,

  // v7 state
  history: [],
  historyFilters: {},
  historyLoading: false,
  historyError: null,
  activeAlertCount: 0,
  _unsubscribeAlert: null as unknown as (() => void) | null,

  refreshAlerts: async () => {
    const connections = useConnectionManagerStore.getState().connections
    const connectedIds = connections
      .filter((c) => c.state === 'connected')
      .map((c) => c.id)

    if (connectedIds.length === 0) {
      const counts = computeCounts([])
      set({ alerts: [], loading: false, ...counts })
      return
    }

    set({ loading: true, error: null })

    const results = await Promise.allSettled(
      connectedIds.map(async (connectionId) => {
        const conn = connections.find((c) => c.id === connectionId)!
        const poolName = conn.poolName ?? conn.host
        const alerts = await window.xapi.alerts.getAll(connectionId)
        return { connectionId, poolName, alerts }
      }),
    )

    const allAlerts: ConnectedAlertRecord[] = []
    const failedIds: string[] = []
    for (let i = 0; i < connectedIds.length; i++) {
      const result = results[i]
      if (result.status === 'fulfilled') {
        const { connectionId, poolName, alerts } = result.value
        allAlerts.push(...alerts.map((a) => ({ ...a, connectionId, poolName })))
      } else {
        failedIds.push(connectedIds[i])
        allAlerts.push(...get().alerts.filter((alert) => alert.connectionId === connectedIds[i]))
      }
    }

    // Sort by timestamp descending (newest first)
    allAlerts.sort((a, b) => b.timestamp - a.timestamp)

    // Apply current filters
    const filtered = applyFilters(allAlerts, get().filters)
    const counts = computeCounts(filtered)

    set({
      alerts: allAlerts,
      loading: false,
      lastRefresh: new Date(),
      error: failedIds.length ? `部分资源池读取失败，保留上次告警：${failedIds.join(', ')}` : null,
      ...counts,
    })
  },

  startPolling: (intervalMs = 30000) => {
    const { pollingInterval } = get()
    // Clear any existing interval before starting a new one
    if (pollingInterval !== null) {
      clearInterval(pollingInterval)
    }

    // Immediately refresh, then set up the interval
    get().refreshAlerts()

    const id = window.setInterval(() => {
      get().refreshAlerts()
    }, intervalMs)

    set({ pollingInterval: id })
  },

  stopPolling: () => {
    const { pollingInterval } = get()
    if (pollingInterval !== null) {
      clearInterval(pollingInterval)
      set({ pollingInterval: null })
    }
  },

  dismissAlert: async (connectionId: string, alertRef: string) => {
    await window.xapi.alerts.dismiss(connectionId, alertRef)
    // Remove the dismissed alert from local state immediately
    const updated = get().alerts.filter(
      (a) => !(a.connectionId === connectionId && a.ref === alertRef),
    )
    const filtered = applyFilters(updated, get().filters)
    const counts = computeCounts(filtered)
    set({ alerts: updated, ...counts })
  },

  dismissAll: async (connectionId?: string) => {
    const connections = useConnectionManagerStore.getState().connections
    const connectedIds = connectionId
      ? [connectionId]
      : connections.filter((c) => c.state === 'connected').map((c) => c.id)

    const results = await Promise.allSettled(
      connectedIds.map((id) => window.xapi.alerts.dismissAll(id)),
    )

    const completed = connectedIds.filter((_, index) => results[index].status === 'fulfilled')
    const updated = get().alerts.filter((alert) => !completed.includes(alert.connectionId))
    const filtered = applyFilters(updated, get().filters)
    const counts = computeCounts(filtered)
    set({ alerts: updated, error: completed.length < connectedIds.length ? '部分告警清除未完成，请刷新核对。' : null, ...counts })
  },

  setFilters: (newFilters: Partial<AlertFilterState>) => {
    const filters = { ...get().filters, ...newFilters }
    const filtered = applyFilters(get().alerts, filters)
    const counts = computeCounts(filtered)
    set({ filters, ...counts })
  },

  // --- v7 Actions ---

  loadHistory: async (filters?: AlertHistoryFilters) => {
    set({ historyLoading: true, historyError: null })
    try {
      const records = await window.xapi.alertHistory.list(filters)
      set({ history: records, historyLoading: false })
      get().refreshActiveCount()
    } catch (e: any) {
      console.error('Failed to load alert history:', e?.message || e)
      set({ historyLoading: false, historyError: e?.message || '加载告警历史失败' })
    }
  },

  acknowledgeAlert: async (alertId: string) => {
    set({ historyError: null })
    try {
      await window.xapi.alertHistory.acknowledge(alertId)
      // Update local state: mark the alert as acknowledged
      const updated = get().history.map((h) =>
        h.id === alertId
          ? { ...h, status: 'acknowledged' as const, acknowledgedAt: Date.now() }
          : h,
      )
      set({ history: updated })
      get().refreshActiveCount()
    } catch (e: any) {
      console.error('Failed to acknowledge alert:', e?.message || e)
      set({ historyError: e?.message || '确认告警失败' })
    }
  },

  setHistoryFilters: (filters: AlertHistoryFilters) => {
    set({ historyFilters: filters })
    get().loadHistory(filters)
  },

  refreshActiveCount: () => {
    const count = get().history.filter((h) => h.status !== 'resolved').length
    set({ activeAlertCount: count })
  },

  addTriggeredAlert: (record: AlertHistoryRecord) => {
    // A recovery is a state update to the same incident, not a new incident.
    set((state) => ({ history: [record, ...state.history.filter((item) => item.id !== record.id)] }))
    get().refreshActiveCount()
  },

  startAlertListener: () => {
    // Clean up any existing listener
    const existing = (get() as any)._unsubscribeAlert
    if (existing) {
      existing()
    }

    const unsubscribe = window.xapi.onAlertTriggered((record: AlertHistoryRecord) => {
      get().addTriggeredAlert(record)
    })

    // Store the unsubscribe function (cast to access internal field)
    ;(get() as any)._unsubscribeAlert = unsubscribe
  },

  stopAlertListener: () => {
    const unsub = (get() as any)._unsubscribeAlert
    if (unsub) {
      unsub()
      ;(get() as any)._unsubscribeAlert = null
    }
  },
}))
