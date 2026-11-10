/**
 * Metrics store — manages host metrics collection and history
 * Manages connection-scoped host metrics collection and history
 * v7: Extended with persistent history queries, stats, time range support
 */
import { create } from 'zustand'
import type { MetricDataPoint, MetricStats, MetricType } from '../types/xapi'

export interface MetricsState {
  // Real-time snapshots are isolated by connection and host reference.
  history: Map<string, MetricDataPoint[]>

  // v7: Persistent history data (key = `${connectionId}:${hostRef}`)
  historyData: Map<string, MetricDataPoint[]>
  // v7: Statistics data (key = `${connectionId}:${hostRef}:${metricType}`)
  statsData: Map<string, MetricStats>
  // v7: Current time range
  timeRange: '1h' | '24h' | '7d'
  // v7: Loading state
  loading: boolean
  // v7: Error message
  error: string | null
  collectionErrors: Record<string, string | null>

  // v6: Collection state
  collecting: boolean
  config: {
    interval: number
    maxDataPoints: number
  }

  collectionIntervalIds: Map<string, number>

  // v6 Actions (preserved)
  startCollection: (connectionId: string) => void
  stopCollection: (connectionId?: string) => void
  refreshHistory: (connectionId: string) => Promise<void>
  updateConfig: (config: Partial<MetricsState['config']>) => void

  // v7 Actions
  setTimeRange: (range: '1h' | '24h' | '7d') => void
  fetchRangeData: (connectionId: string, hostRef: string) => Promise<void>
  fetchStats: (connectionId: string, hostRef: string, metricType: MetricType) => Promise<void>
  clearHistoryData: () => void

  // v6 Getters (preserved)
  getHostData: (connectionId: string, hostRef: string) => MetricDataPoint[]
  getLatestCpu: (connectionId: string, hostRef: string) => number | null
  getLatestMemory: (connectionId: string, hostRef: string) => number | null
  getAllHostRefs: (connectionId: string) => string[]

  // v7 Getters
  getRangeKey: (connectionId: string, hostRef: string) => string
  getStatsKey: (connectionId: string, hostRef: string, metricType: string) => string
  getRangeData: (connectionId: string, hostRef: string) => MetricDataPoint[]
  getHostStats: (connectionId: string, hostRef: string, metricType: string) => MetricStats | null
}

const historyRevisions = new Map<string, number>()
const collectionRevisions = new Map<string, number>()

const DEFAULT_CONFIG = {
  interval: 30000, // 30 seconds
  maxDataPoints: 120, // Keep last 120 data points (1 hour at 30s interval)
}

function getTimeRangeMs(range: '1h' | '24h' | '7d'): number {
  switch (range) {
    case '1h':
      return 3600000
    case '24h':
      return 86400000
    case '7d':
      return 604800000
  }
}

function isMetricsDebugEnabled(): boolean {
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
    console.log(`[metrics:debug:renderer] ${event}`, context)
    return
  }
  console.log(`[metrics:debug:renderer] ${event}`)
}

export const useMetricsStore = create<MetricsState>((set, get) => ({
  // v6 state
  history: new Map(),
  collecting: false,
  config: { ...DEFAULT_CONFIG },
  collectionIntervalIds: new Map(),

  // v7 state
  historyData: new Map(),
  statsData: new Map(),
  timeRange: '1h',
  loading: false,
  error: null,
  collectionErrors: {},

  // --- v6 Actions (preserved) ---

  startCollection: (connectionId: string) => {
    if (!connectionId) {
      logMetricsDebug('startCollection:skip-empty-connection')
      return
    }
    const { config, collectionIntervalIds } = get()
    if (collectionIntervalIds.has(connectionId)) {
      logMetricsDebug('startCollection:skip-already-active', { connectionId })
      return
    }

    logMetricsDebug('startCollection:request', {
      connectionId,
      intervalMs: config.interval,
      maxDataPoints: config.maxDataPoints,
    })

    const newIntervalIds = new Map(collectionIntervalIds)
    const revision = (collectionRevisions.get(connectionId) ?? 0) + 1
    collectionRevisions.set(connectionId, revision)

    // Start metrics collection on backend
    void window.xapi.metrics.startCollection(connectionId, {
      interval: config.interval,
      maxDataPoints: config.maxDataPoints,
    }).then(async () => {
      if (collectionRevisions.get(connectionId) === revision) await get().refreshHistory(connectionId)
    }).catch((error: any) => {
      if (collectionRevisions.get(connectionId) !== revision) return
      const intervals = new Map(get().collectionIntervalIds)
      const timer = intervals.get(connectionId)
      if (timer !== undefined) window.clearInterval(timer)
      intervals.delete(connectionId)
      set({ collecting: intervals.size > 0, collectionIntervalIds: intervals,
        collectionErrors: { ...get().collectionErrors, [connectionId]: error?.message || '无法启动指标采集' } })
    })

    // Set up polling interval for history updates
    const intervalId = window.setInterval(() => {
      void get().refreshHistory(connectionId)
    }, config.interval)

    newIntervalIds.set(connectionId, intervalId)

    set({
      collecting: newIntervalIds.size > 0,
      collectionIntervalIds: newIntervalIds,
    })

    logMetricsDebug('startCollection:active', {
      connectionId,
      activeCollectionCount: newIntervalIds.size,
    })

  },

  stopCollection: (connectionId?: string) => {
    const { collectionIntervalIds } = get()
    const newIntervalIds = new Map(collectionIntervalIds)

    logMetricsDebug('stopCollection:request', {
      connectionId: connectionId ?? 'all',
      activeBefore: newIntervalIds.size,
    })

    const stoppedIds = connectionId ? [connectionId] : new Set([...newIntervalIds.keys(), ...historyRevisions.keys()])
    for (const id of stoppedIds) {
      historyRevisions.set(id, (historyRevisions.get(id) ?? 0) + 1)
      collectionRevisions.set(id, (collectionRevisions.get(id) ?? 0) + 1)
    }

    if (connectionId) {
      const intervalId = newIntervalIds.get(connectionId)
      if (intervalId !== undefined) {
        window.clearInterval(intervalId)
        newIntervalIds.delete(connectionId)
      }
      void window.xapi.metrics.stopCollection(connectionId).catch(console.error)
    } else {
      for (const [id, intervalId] of newIntervalIds.entries()) {
        window.clearInterval(intervalId)
        void window.xapi.metrics.stopCollection(id).catch(console.error)
      }
      newIntervalIds.clear()
    }

    const history = new Map([...get().history].filter(([key]) => connectionId ? !key.startsWith(`${connectionId}:`) : false))
    set({
      history,
      collectionErrors: Object.fromEntries(Object.entries(get().collectionErrors).filter(([id]) => connectionId ? id !== connectionId : false)),
      collecting: newIntervalIds.size > 0,
      collectionIntervalIds: newIntervalIds,
    })

    logMetricsDebug('stopCollection:done', {
      connectionId: connectionId ?? 'all',
      activeAfter: newIntervalIds.size,
    })
  },

  refreshHistory: async (connectionId: string) => {
    const revision = (historyRevisions.get(connectionId) ?? 0) + 1
    historyRevisions.set(connectionId, revision)
    try {
      logMetricsDebug('refreshHistory:request', { connectionId })
      const [data, collectionError] = await Promise.all([
        window.xapi.metrics.getHistory(connectionId),
        window.xapi.metrics.getCollectionError(connectionId),
      ])
      if (historyRevisions.get(connectionId) !== revision) return
      const { history, config } = get()
      // getHistory returns a full snapshot, so replace this connection's samples.
      // Appending the same snapshot on every poll duplicated old samples and hid gaps.
      const newHistory = new Map([...history].filter(([key]) => !key.startsWith(`${connectionId}:`)))
      for (const hostData of data) {
        const samples = new Map(hostData.dataPoints.map((point) => [point.timestamp, point]))
        const points = [...samples.values()].sort((a, b) => a.timestamp - b.timestamp).slice(-config.maxDataPoints)
        newHistory.set(get().getRangeKey(connectionId, hostData.hostRef), points)
      }

      set({ history: newHistory, collectionErrors: { ...get().collectionErrors, [connectionId]: collectionError } })

      const totalDataPoints = data.reduce((sum, host) => sum + host.dataPoints.length, 0)
      logMetricsDebug('refreshHistory:success', {
        connectionId,
        hostCount: data.length,
        totalDataPoints,
      })
    } catch (e: any) {
      if (historyRevisions.get(connectionId) === revision) {
        set({ collectionErrors: { ...get().collectionErrors, [connectionId]: e?.message || '无法读取监控状态' } })
      }
      console.error('Failed to refresh metrics:', e?.message || e)
      logMetricsDebug('refreshHistory:error', {
        connectionId,
        message: e?.message || String(e),
      })
    }
  },

  updateConfig: (config) => {
    set((state) => ({
      config: { ...state.config, ...config },
    }))
  },

  // --- v7 Actions ---

  setTimeRange: (range: '1h' | '24h' | '7d') => {
    set({ timeRange: range })
  },

  fetchRangeData: async (connectionId: string, hostRef: string) => {
    const { timeRange } = get()
    const now = Date.now()
    const startTime = now - getTimeRangeMs(timeRange)

    set({ loading: true, error: null })

    logMetricsDebug('fetchRangeData:request', {
      connectionId,
      hostRef,
      timeRange,
      startTime,
      endTime: now,
    })

    try {
      const data = await window.xapi.metrics.getRange(connectionId, hostRef, {
        startTime,
        endTime: now,
      })

      const key = get().getRangeKey(connectionId, hostRef)
      const newHistoryData = new Map(get().historyData)
      newHistoryData.set(key, data)

      set({ historyData: newHistoryData, loading: false })

      logMetricsDebug('fetchRangeData:success', {
        connectionId,
        hostRef,
        rowCount: data.length,
        firstTimestamp: data.length > 0 ? data[0].timestamp : null,
        lastTimestamp: data.length > 0 ? data[data.length - 1].timestamp : null,
      })
    } catch (e: any) {
      console.error('Failed to fetch range data:', e?.message || e)
      logMetricsDebug('fetchRangeData:error', {
        connectionId,
        hostRef,
        message: e?.message || String(e),
      })
      set({ loading: false, error: e?.message || 'Failed to fetch metrics data' })
    }
  },

  fetchStats: async (connectionId: string, hostRef: string, metricType: MetricType) => {
    const { timeRange } = get()
    const now = Date.now()
    const startTime = now - getTimeRangeMs(timeRange)

    logMetricsDebug('fetchStats:request', {
      connectionId,
      hostRef,
      metricType,
      timeRange,
      startTime,
      endTime: now,
    })

    try {
      const stats = await window.xapi.metrics.getStats(connectionId, hostRef, metricType, {
        startTime,
        endTime: now,
      })

      const key = get().getStatsKey(connectionId, hostRef, metricType)
      const newStatsData = new Map(get().statsData)
      newStatsData.set(key, stats)

      set({ statsData: newStatsData })

      logMetricsDebug('fetchStats:success', {
        connectionId,
        hostRef,
        metricType,
        stats,
      })
    } catch (e: any) {
      console.error('Failed to fetch stats:', e?.message || e)
      logMetricsDebug('fetchStats:error', {
        connectionId,
        hostRef,
        metricType,
        message: e?.message || String(e),
      })
    }
  },

  clearHistoryData: () => {
    set({ historyData: new Map(), statsData: new Map() })
  },

  // --- v6 Getters (preserved) ---

  getHostData: (connectionId: string, hostRef: string): MetricDataPoint[] => {
    return get().history.get(get().getRangeKey(connectionId, hostRef)) || []
  },

  getLatestCpu: (connectionId: string, hostRef: string): number | null => {
    const data = get().getHostData(connectionId, hostRef)
    if (!data || data.length === 0) return null
    const latest = data[data.length - 1]
    return (!latest.availableMetrics || latest.availableMetrics.includes('cpuPercent')) && Number.isFinite(latest.cpuPercent) ? latest.cpuPercent : null
  },

  getLatestMemory: (connectionId: string, hostRef: string): number | null => {
    const data = get().getHostData(connectionId, hostRef)
    if (!data || data.length === 0) return null
    const latest = data[data.length - 1]
    return (!latest.availableMetrics || latest.availableMetrics.includes('memoryPercent')) && Number.isFinite(latest.memoryPercent) ? latest.memoryPercent : null
  },

  getAllHostRefs: (connectionId: string): string[] => {
    const prefix = `${connectionId}:`
    return Array.from(get().history.keys()).filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length))
  },

  // --- v7 Getters ---

  getRangeKey: (connectionId: string, hostRef: string): string => {
    return `${connectionId}:${hostRef}`
  },

  getStatsKey: (connectionId: string, hostRef: string, metricType: string): string => {
    return `${connectionId}:${hostRef}:${metricType}`
  },

  getRangeData: (connectionId: string, hostRef: string): MetricDataPoint[] => {
    const key = get().getRangeKey(connectionId, hostRef)
    return get().historyData.get(key) || []
  },

  getHostStats: (connectionId: string, hostRef: string, metricType: string): MetricStats | null => {
    const key = get().getStatsKey(connectionId, hostRef, metricType)
    return get().statsData.get(key) || null
  },
}))
