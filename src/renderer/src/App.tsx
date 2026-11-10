/**
 * Root application component — handles routing with unified connection state.
 *
 * UX Architecture Redesign:
 * - Uses ConnectionManagerStore to determine connection state (not legacy ConnectionStore)
 * - /connect is only the disconnected entry; connected sessions return to /vms
 * - Detail pages use path param :connectionId instead of search params
 */
import { Routes, Route, Navigate, useParams, Link } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import { useConnectionManagerStore } from './store/connectionManager.store'
import { syncManager } from './store/syncManager.store'
import { useMultiDataStore } from './store/multiData.store'
import ConnectPage from './pages/ConnectPage'
import SettingsPage from './pages/SettingsPage'
import AppShell from './components/layout/AppShell'
import HostsPage from './pages/HostsPage'
import HostDetailPage from './pages/HostDetailPage'
import VmsPage from './pages/VmsPage'
import VmDetailPage from './pages/VmDetailPage'
import StoragePage from './pages/StoragePage'
import NetworksPage from './pages/NetworksPage'
import TaskHistoryPage from './pages/TaskHistoryPage'
import AlertsPage from './pages/AlertsPage'
import PoolSettingsPage from './pages/PoolSettingsPage'
import { useMetricsStore } from './store/metrics.store'
import { useAlertStore } from './store/alert.store'
import { feedback } from './store/feedback.store'
import { ToastProvider } from './components/toast/ToastProvider'
import { ErrorBoundary } from './components/ErrorBoundary'

function PoolHome() {
  const { connectionId } = useParams()
  return <Navigate to={`/pool/${encodeURIComponent(connectionId || '')}/vms`} replace />
}

function LegacyPoolSettings({ tab = 'general' }: { tab?: string }) {
  const connections = useConnectionManagerStore((s) => s.connections)
  const activeId = useConnectionManagerStore((s) => s.activeConnectionId)
  const connection = connections.find((item) => item.id === activeId && item.state === 'connected') || connections.find((item) => item.state === 'connected')
  return connection ? <Navigate to={`/pool/${encodeURIComponent(connection.id)}/settings?tab=${tab}`} replace /> : <Navigate to="/vms" replace />
}

export default function App() {
  const connections = useConnectionManagerStore((s) => s.connections)
  const refreshConnections = useConnectionManagerStore((s) => s.refreshConnections)
  const handleVmChangeEvent = useMultiDataStore((s) => s.handleVmChangeEvent)
  const metricScopes = useRef(new Map<string, string>())
  const [connectionsRestored, setConnectionsRestored] = useState(false)
  const hasConnected = connections.some((c) => c.state === 'connected')
  const hasWorkspace = connections.some((c) => c.state === 'connected' || c.connectedAt != null)
  const connectionReadKey = connections.filter((c) => c.state === 'connected')
    .map((c) => JSON.stringify([c.id, c.epoch, c.connectedAt, c.poolUuid])).join('|')

  useEffect(() => {
    if (connectionsRestored && hasConnected) void useMultiDataStore.getState().refreshAll()
  }, [connectionsRestored, hasConnected, connectionReadKey])

  // A closed macOS window can leave main-process XAPI connections alive while
  // the recreated renderer starts with an empty store. Restore from main first.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        await refreshConnections().catch(() => undefined)
        if (cancelled) return
        // Render the connection page before credential access. Keychain approval
        // or one slow server must not hide the entire desktop workspace.
        setConnectionsRestored(true)
        await useConnectionManagerStore.getState().loadSavedConnections()
      } finally {
        if (!cancelled) {
          setConnectionsRestored(true)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [refreshConnections])

  useEffect(() => {
    const timer = setInterval(() => { void refreshConnections().catch(() => undefined) }, 5000)
    return () => clearInterval(timer)
  }, [refreshConnections])

  // Start/stop SyncManager based on connection state
  useEffect(() => {
    if (hasConnected && connectionsRestored) syncManager.start()
    else syncManager.stop()
    return () => syncManager.stop()
  }, [hasConnected, connectionsRestored])

  useEffect(() => {
    if (!hasConnected) return
    return window.xapi.onVmChanged(handleVmChangeEvent)
  }, [hasConnected, handleVmChangeEvent])

  useEffect(() => {
    if (!connectionsRestored) return
    const metrics = useMetricsStore.getState()
    const connected = connections.filter((connection) => connection.state === 'connected')
    for (const id of new Set([...metricScopes.current.keys(), ...metrics.collectionIntervalIds.keys()])) {
      const connection = connected.find((item) => item.id === id)
      const identity = connection && JSON.stringify([connection.epoch, connection.connectedAt, connection.poolUuid])
      if (!identity || metricScopes.current.has(id) && metricScopes.current.get(id) !== identity) {
        metrics.stopCollection(id)
        metricScopes.current.delete(id)
      }
    }
    for (const connection of connected) {
      metricScopes.current.set(connection.id, JSON.stringify([connection.epoch, connection.connectedAt, connection.poolUuid]))
      metrics.startCollection(connection.id)
    }
  }, [connections, connectionsRestored])

  useEffect(() => () => { useMetricsStore.getState().stopCollection() }, [])

  useEffect(() => {
    if (!connectionsRestored || !hasConnected) return
    const alerts = useAlertStore.getState()
    alerts.startPolling()
    alerts.startAlertListener()
    const unsubscribe = window.xapi.onAlertTriggered((record) => {
      if (record.status === 'resolved') feedback.success(`告警恢复：${record.ruleName} · ${record.entityName}`)
      else feedback.error(`[${record.severity === 'error' ? '严重' : '警告'}] ${record.ruleName}: ${record.entityName} - ${record.metricType} 超过阈值`)
    })
    return () => { alerts.stopPolling(); alerts.stopAlertListener(); unsubscribe() }
  }, [connectionsRestored, hasConnected])

  if (!connectionsRestored) {
    return <div role="status" className="min-h-screen bg-background p-8 pt-[var(--window-top-offset)] text-secondary-foreground">正在恢复服务器连接…</div>
  }

  if (!hasWorkspace) {
    return (
      <ErrorBoundary>
        <ToastProvider>
          <Routes>
            <Route path="/settings" element={<SettingsPage standalone />} />
            <Route path="*" element={<ConnectPage />} />
          </Routes>
        </ToastProvider>
      </ErrorBoundary>
    )
  }

  return (
    <ErrorBoundary>
      <ToastProvider>
        <AppShell>
          <Routes>
            <Route path="/" element={<Navigate to="/vms" replace />} />
            <Route path="/connect" element={<Navigate to="/vms" replace />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/dashboard" element={<Navigate to="/vms" replace />} />
            <Route path="/hosts" element={<HostsPage />} />
            <Route path="/vms" element={<VmsPage />} />
            <Route path="/pool/:connectionId" element={<PoolHome />} />
            {/* Pool-scoped resource list routes */}
            <Route path="/pool/:connectionId/hosts" element={<HostsPage />} />
            <Route path="/pool/:connectionId/vms" element={<VmsPage />} />
            <Route path="/pool/:connectionId/storage" element={<StoragePage />} />
            <Route path="/pool/:connectionId/networks" element={<NetworksPage />} />
            {/* Pool-scoped detail routes — connectionId as path param for stable context */}
            <Route path="/pool/:connectionId/hosts/:ref" element={<HostDetailPage />} />
            <Route path="/pool/:connectionId/vms/:ref" element={<VmDetailPage />} />
            {/* Legacy search-param routes — redirect to path-param format */}
            <Route path="/hosts/:ref" element={<HostDetailPage />} />
            <Route path="/vms/:ref" element={<VmDetailPage />} />
            <Route path="/storage" element={<StoragePage />} />
            <Route path="/networks" element={<NetworksPage />} />
            <Route path="/tasks" element={<TaskHistoryPage />} />
            <Route path="/batch-tasks" element={<Navigate to="/tasks?tab=batch" replace />} />
            <Route path="/rbac" element={<LegacyPoolSettings tab="access" />} />
            <Route path="/pool-manager" element={<LegacyPoolSettings />} />
            <Route path="/pool/:connectionId/settings" element={<PoolSettingsPage />} />
            <Route path="/alerts" element={<AlertsPage />} />
            <Route path="*" element={<div className="p-6">找不到此页面。<Link className="text-accent-foreground underline" to="/vms">返回虚拟机</Link></div>} />
          </Routes>
        </AppShell>
      </ToastProvider>
    </ErrorBoundary>
  )
}
