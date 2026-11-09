/**
 * DashboardPage — multi-pool overview: stat cards, host list, VM power-state summary, and metrics.
 * Polls XAPI every 30 seconds for live data.
 * v7: Integrated DashboardMetricsPanel for host performance monitoring.
 *
 * UX Architecture Redesign:
 * - Now uses multiDataStore to show ALL connections' data (not just active connection)
 * - Hosts and VMs in lists are clickable, linking to detail pages
 * - Pool name shown per item for multi-connection clarity
 */
import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { summarizeSrCapacity } from '../../../shared/storage-capacity'
import { useMultiDataStore, type ResourceDomain } from '../store/multiData.store'
import { useMetricsStore } from '../store/metrics.store'
import { useConnectionManagerStore } from '../store/connectionManager.store'
import { syncManager } from '../store/syncManager.store'
import { formatBytes } from '../lib/utils'
import { Server, Monitor, HardDrive, Activity, ChevronRight, Wifi, AlertTriangle, Cpu } from 'lucide-react'
import { DashboardMetricsPanel } from '../components/dashboard/DashboardMetricsPanel'

export default function DashboardPage() {
  const { hosts, vms, srs, tasks, loading, domainStates } = useMultiDataStore()
  const { startCollection, stopCollection } = useMetricsStore()
  const connections = useConnectionManagerStore((s) => s.connections)

  // SyncManager handles periodic refresh; trigger initial refresh on mount only
  useEffect(() => {
    syncManager.refreshNow()
  }, [])

  // Start metrics collection for connected connections and stop stale ones on state change.
  // Collection intentionally persists across page navigation so HostMonitorTab/VmMonitorTab
  // always have background data. Collection only stops when a connection disconnects.
  useEffect(() => {
    const connectedIds = connections
      .filter((c) => c.state === 'connected')
      .map((c) => c.id)

    for (const connId of connectedIds) {
      startCollection(connId)
    }

    // Stop collection for connections that are no longer active.
    // Read collectionIntervalIds from the store directly to avoid stale closure.
    const { collectionIntervalIds } = useMetricsStore.getState()
    for (const activeConnId of collectionIntervalIds.keys()) {
      if (!connectedIds.includes(activeConnId)) {
        stopCollection(activeConnId)
      }
    }
  }, [connections, startCollection, stopCollection])

  const handleStartCollection = () => {
    const connectedIds = connections
      .filter((c) => c.state === 'connected')
      .map((c) => c.id)
    for (const connId of connectedIds) {
      startCollection(connId)
    }
  }

  const runningVms   = vms.filter((v) => v.power_state === 'Running').length
  const enabledHosts = hosts.filter((h) => h.enabled).length
  const { total: totalStorage, used: usedStorage } = summarizeSrCapacity(srs)
  const readStatus = (domain: ResourceDomain, id?: string) => {
    const scope = id ? connections.filter((c) => c.id === id) : connections
    return {
      available: scope.length > 0 && scope.every((c) => domainStates[c.id]?.[domain]?.lastSuccessAt != null),
      stale: scope.some((c) => c.state !== 'connected' || domainStates[c.id]?.[domain]?.error),
    }
  }
  const hostRead = readStatus('hosts')
  const vmRead = readStatus('vms')
  const srRead = readStatus('srs')
  const taskRead = readStatus('tasks')
  const readLabel = (status: { available: boolean; stale: boolean }, label: string) =>
    !status.available ? '暂不可用' : status.stale ? `上次读取 · ${label}` : label
  const pendingTasks = tasks.filter((t) => t.status === 'pending').length

  const stats = [
    {
      label:    '主机',
      value:    hostRead.available ? `${enabledHosts}/${hosts.length}` : '--',
      sublabel: readLabel(hostRead, `${connections.filter(c => c.state === 'connected').length} 个资源池`),
      icon:     Server,
      color:    'text-accent-foreground',
      bg:       'bg-accent',
    },
    {
      label:    '虚拟机',
      value:    vmRead.available ? `${runningVms}/${vms.length}` : '--',
      sublabel: readLabel(vmRead, '运行中'),
      icon:     Monitor,
      color:    'text-success',
      bg:       'bg-success-soft',
    },
    {
      label:    '存储已用',
      value:    srRead.available ? formatBytes(usedStorage) : '--',
      sublabel: readLabel(srRead, `共 ${formatBytes(totalStorage)}`),
      icon:     HardDrive,
      color:    'text-accent-foreground',
      bg:       'bg-accent',
    },
    {
      label:    '活动任务',
      value:    taskRead.available ? String(pendingTasks) : '--',
      sublabel: readLabel(taskRead, '进行中'),
      icon:     Activity,
      color:    'text-warning',
      bg:       'bg-warning-soft',
    },
  ]

  if (loading && hosts.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="w-12 h-12 rounded-xl bg-accent flex items-center justify-center mx-auto mb-3 animate-pulse">
            <Activity className="w-6 h-6 text-accent-foreground" />
          </div>
          <p className="text-secondary-foreground font-medium">正在加载资源数据</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">
          仪表盘
        </h1>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:gap-4 xl:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-muted-foreground">{stat.label}</span>
              <div className={`p-2 rounded-lg ${stat.bg}`}>
                <stat.icon className={`w-4 h-4 ${stat.color}`} />
              </div>
            </div>
            <div className={`text-2xl font-semibold text-foreground`}>{stat.value}</div>
            <div className="text-xs text-subtle mt-0.5">{stat.sublabel}</div>
          </div>
        ))}
      </div>

      {/* Pool Health Cards — one card per connected pool */}
      {connections.filter(c => c.state === 'connected').length > 0 && (
        <div>
          <h2 className="text-sm font-medium text-foreground mb-3">资源池状态</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:gap-4 xl:grid-cols-3">
            {connections
              .filter((c) => c.state === 'connected')
              .map((conn) => {
                const poolHosts = hosts.filter((h) => h.connectionId === conn.id)
                const poolVms = vms.filter((v) => v.connectionId === conn.id)
                const poolSrs = srs.filter((sr) => sr.connectionId === conn.id)
                const runningVms = poolVms.filter((v) => v.power_state === 'Running').length
                const enabledHosts = poolHosts.filter((h) => h.enabled).length
                const { total: totalStorage, used: usedStorage } = summarizeSrCapacity(poolSrs)
                const srRead = readStatus('srs', conn.id)
                const hostRead = readStatus('hosts', conn.id)
                const vmRead = readStatus('vms', conn.id)
                const incomplete = Object.values(domainStates[conn.id] ?? {}).some((status) => status.error)
                const storagePercent = srRead.available && totalStorage !== null && usedStorage !== null
                  ? `${totalStorage > 0 ? Math.round(usedStorage / totalStorage * 100) : 0}%` : '--'

                return (
                  <Link
                    key={conn.id}
                    className="group block min-w-0 bg-card border border-border rounded-xl p-4 hover:border-input transition-colors"
                    to={`/pool/${encodeURIComponent(conn.id)}/hosts`}
                  >
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-success-soft flex items-center justify-center">
                          <Cpu className="w-4 h-4 text-success" />
                        </div>
                        <div className="min-w-0">
                          <h3 className="truncate text-sm font-medium text-foreground transition-colors group-hover:text-accent-foreground">
                            {conn.poolName || conn.name || conn.host}
                          </h3>
                          <p className="truncate text-xs text-subtle">{conn.host}</p>
                        </div>
                      </div>
                      <Wifi className="w-4 h-4 text-success" />
                    </div>

                    <div className="grid grid-cols-3 gap-3 mb-3">
                      <div>
                        <div className="text-lg font-bold text-foreground">{hostRead.available ? poolHosts.length : '--'}</div>
                        <div className="text-[11px] text-subtle">主机</div>
                      </div>
                      <div>
                        <div className="text-lg font-bold text-foreground">{vmRead.available ? `${runningVms}/${poolVms.length}` : '--'}</div>
                        <div className="text-[11px] text-subtle">运行 VM</div>
                      </div>
                      <div>
                        <div className="text-lg font-bold text-foreground">{storagePercent}</div>
                        <div className="text-[11px] text-subtle">存储使用</div>
                      </div>
                    </div>

                    {/* Mini health indicators */}
                    <div className="flex flex-wrap items-center gap-2 text-[11px]">
                      {incomplete ? <span className="text-warning">资源读取异常</span> : !hostRead.available ? <span className="text-muted-foreground">等待读取主机</span> : poolHosts.length === 0 ? (
                        <span className="text-muted-foreground">暂无主机数据</span>
                      ) : enabledHosts === poolHosts.length ? (
                        <span className="text-success flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-success-solid" />
                          主机已启用
                        </span>
                      ) : (
                        <span className="text-warning flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" />
                          {poolHosts.length - enabledHosts} 台主机异常
                        </span>
                      )}
                      <span className="text-subtle">·</span>
                      <span className="text-subtle">{srRead.available ? `${srRead.stale ? '上次读取 · ' : ''}${formatBytes(usedStorage)} / ${formatBytes(totalStorage)}` : '存储容量暂不可用'}</span>
                    </div>
                  </Link>
                )
              })}
          </div>
        </div>
      )}

      {/* v7: Metrics Panel */}
      <DashboardMetricsPanel onStartCollection={handleStartCollection} />

      {/* Hosts List — clickable, grouped by pool */}
      <div className="bg-card border border-border rounded-xl">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="text-sm font-medium text-foreground">主机</h2>
        </div>
        <div className="divide-y divide-border">
          {hosts.map((host) => (
            <Link
              key={`${host.connectionId}-${host.ref}`}
              className="group flex min-w-0 flex-col gap-3 px-4 py-3 transition-colors hover:bg-muted sm:flex-row sm:items-center sm:justify-between"
              to={`/pool/${encodeURIComponent(host.connectionId)}/hosts/${encodeURIComponent(host.ref)}`}
            >
              <div className="flex min-w-0 items-center gap-3">
                <div
                  className={`h-2 w-2 flex-shrink-0 rounded-full ${host.enabled ? 'bg-success-solid' : 'bg-danger-solid'}`}
                />
                <div className="min-w-0">
                  <div className="flex items-center gap-1 text-sm font-medium text-foreground transition-colors group-hover:text-accent-foreground">
                    <span className="truncate">{host.name_label}</span>
                    <ChevronRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                  <div className="truncate text-xs text-subtle">{host.address} · {host.poolName}</div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-muted-foreground sm:justify-end">
                <span>{host.resident_VMs?.length || 0} 台 VM</span>
                <span className={host.enabled ? 'text-success' : 'text-danger'}>
                  {host.enabled ? '已启用' : '已禁用'}
                </span>
              </div>
            </Link>
          ))}
          {hosts.length === 0 && (
            <div className="text-center py-10">
              <Server className="w-8 h-8 text-subtle mx-auto mb-2" />
              <p className="text-subtle text-sm">暂无主机数据</p>
            </div>
          )}
        </div>
      </div>

      {/* VM Power State Summary */}
      <div className="bg-card border border-border rounded-xl">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="text-sm font-medium text-foreground">虚拟机电源状态</h2>
        </div>
        <div className="p-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(['Running', 'Halted', 'Suspended', 'Paused'] as const).map((state) => {
              const count = vms.filter((v) => v.power_state === state).length
              const colors: Record<string, string> = {
                Running:   'text-success',
                Halted:    'text-muted-foreground',
                Suspended: 'text-warning',
                Paused:    'text-warning',
              }
              return (
                <div key={state} className="text-center">
                  <div className={`text-2xl font-bold ${colors[state]}`}>{count}</div>
                  <div className="text-xs text-subtle mt-0.5">{state}</div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
