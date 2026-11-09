/**
 * HostsPage — card list of all pool hosts with maintenance controls, PIF viewer.
 * v5: Switched to useMultiDataStore, added maintenance workflow and PIF list.
 */
import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getConnectionReadIdentity, useMultiDataStore } from '../store/multiData.store'
import { useConnectionManagerStore } from '../store/connectionManager.store'
import { RotateCcw, Wrench, Power, Network, ChevronDown, ChevronUp, Loader2, Server } from 'lucide-react'
import { HostStatusBadge } from '../components/host/HostStatusBadge'
import { HostMemorySummary } from '../components/host/HostMemorySummary'
import { MaintenanceDialog } from '../components/host/MaintenanceDialog'
import { PifList } from '../components/network/PifList'
import type { NetworkRecord, PifRecord, MaintenanceStatus } from '../types/xapi'
import { getAuditedFeatureBlockReason } from '../../../shared/audited-features'

function resourceKey(connectionId: string, ref: string): string {
  return `${connectionId}:${ref}`
}

function HostInterfacesPanel({ connectionId, hostRef, networks }: { connectionId: string; hostRef: string; networks: NetworkRecord[] }) {
  const [pifs, setPifs] = useState<PifRecord[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [reload, setReload] = useState(0)
  const hostsReadAt = useMultiDataStore((state) => state.domainStates[connectionId]?.hosts?.lastSuccessAt)
  const networksReadAt = useMultiDataStore((state) => state.domainStates[connectionId]?.networks?.lastSuccessAt)

  useEffect(() => {
    let current = true
    const identity = getConnectionReadIdentity(connectionId)
    const isCurrent = () => current && identity === getConnectionReadIdentity(connectionId)
    if (!identity) {
      setLoading(false)
      setError('资源池连接已断开，请重新连接后读取主机接口。')
      return
    }
    setLoading(true)
    setError(null)
    window.xapi.network.listPifs(connectionId).then((records) => {
      if (isCurrent()) setPifs(records.filter((record) => record.host === hostRef))
    }).catch((failure: any) => {
      if (isCurrent()) setError(failure?.message || '主机接口读取失败')
    }).finally(() => { if (isCurrent()) setLoading(false) })
    return () => { current = false }
  }, [connectionId, hostRef, hostsReadAt, networksReadAt, reload])

  return (
    <div className="mt-4 min-w-0 space-y-3 rounded-lg bg-muted p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-medium text-muted-foreground">主机网络接口</h4>
        <button type="button" disabled={loading || !getConnectionReadIdentity(connectionId)} onClick={() => setReload((value) => value + 1)} className="rounded border border-input px-2 py-1 text-xs text-secondary-foreground disabled:opacity-40">重新读取主机接口</button>
      </div>
      {error && <p role="alert" className="break-words text-sm text-warning">主机接口读取失败：{error}{pifs ? ' 当前保留上次数据。' : ''}</p>}
      {loading && <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />正在读取主机接口…</p>}
      {pifs !== null && <PifList pifs={pifs} networks={networks} />}
    </div>
  )
}

export default function HostsPage() {
  const { hosts: allHosts, vms: allVms, networks: allNetworks, refreshHosts, refreshNetworks, refreshVms } = useMultiDataStore()
  const { connectionId: pathConnectionId } = useParams<{ connectionId?: string }>()

  // Filter by connectionId if specified in path
  const hosts = useMemo(() => pathConnectionId ? allHosts.filter((h) => h.connectionId === pathConnectionId) : allHosts, [allHosts, pathConnectionId])
  const vms = useMemo(() => pathConnectionId ? allVms.filter((v) => v.connectionId === pathConnectionId) : allVms, [allVms, pathConnectionId])
  const connections = useConnectionManagerStore((s) => s.connections)
  const lifecycleGuardReason = getAuditedFeatureBlockReason('host.maintenance')
  const poolName = pathConnectionId
    ? connections.find((c) => c.id === pathConnectionId)?.poolName || connections.find((c) => c.id === pathConnectionId)?.name
    : null
  const [actionLoading] = useState<string | null>(null)
  const [maintenanceDialog, setMaintenanceDialog] = useState<{
    open: boolean
    connectionId: string
    hostRef: string
    vmNames: string[]
  }>({ open: false, connectionId: '', hostRef: '', vmNames: [] })
  const [expandedPifs, setExpandedPifs] = useState<string | null>(null)
  const [maintenanceStates, setMaintenanceStates] = useState<Record<string, MaintenanceStatus>>({})

  useEffect(() => { refreshHosts(); refreshNetworks() }, [])

  // Load maintenance status for all hosts
  useEffect(() => {
    let cancelled = false
    const loadMaintenanceStatus = async () => {
      const states: Record<string, MaintenanceStatus> = {}
      for (const host of hosts) {
        try {
          const status = await window.xapi.host.getMaintenanceStatus(host.connectionId, host.ref)
          states[resourceKey(host.connectionId, host.ref)] = status
        } catch {
          // If getMaintenanceStatus fails, fall back to enabled field
        }
      }
      if (!cancelled) setMaintenanceStates(states)
    }
    if (hosts.length > 0) {
      loadMaintenanceStatus()
    }
    return () => { cancelled = true }
  }, [hosts])

  const handleViewPifs = (connectionId: string, hostRef: string) => {
    const hostKey = resourceKey(connectionId, hostRef)
    setExpandedPifs((previous) => previous === hostKey ? null : hostKey)
  }

  const getVmCount = (hostRef: string, connectionId: string) => {
    return vms.filter(
      (vm) => vm.resident_on === hostRef && vm.connectionId === connectionId && vm.power_state === 'Running' && !vm.is_control_domain
    ).length
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-foreground">
          {poolName ? `${poolName} · 主机` : '主机'}
        </h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          {hosts.length} 台主机
        </p>
      </div>

      <div className="grid gap-4">
        {hosts.map((host) => {
          const hostKey = resourceKey(host.connectionId, host.ref)
          const ms = maintenanceStates[hostKey]
          const isInMaintenance = ms?.state === 'maintenance' || ms?.state === 'disabled' || !host.enabled

          return (
            <div key={hostKey} className="min-w-0 bg-card border border-border rounded-xl p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <HostStatusBadge enabled={host.enabled} maintenanceState={ms?.state} />
                  <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <h3 className="min-w-0 truncate font-medium text-foreground">
                        <Link to={`/pool/${encodeURIComponent(host.connectionId)}/hosts/${encodeURIComponent(host.ref)}`} title={host.name_label}
                          className="rounded transition-colors hover:text-accent-foreground">{host.name_label}</Link>
                      </h3>
                      <span className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                        {host.poolName}
                      </span>
                    </div>
                    <p className="truncate text-sm text-subtle">{host.address} &middot; {host.hostname}</p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1 lg:justify-end">
                  {actionLoading === hostKey ? (
                    <span className="flex items-center gap-1.5 text-xs text-subtle px-2">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      处理中...
                    </span>
                  ) : (
                    <>
                      {isInMaintenance ? (
                        <button
                          disabled
                          title={lifecycleGuardReason}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-success opacity-50 cursor-not-allowed rounded-lg transition-colors"
                        >
                          <Power className="w-3 h-3" />
                          退出维护
                        </button>
                      ) : (
                        <button
                          disabled
                          title={lifecycleGuardReason}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-warning opacity-50 cursor-not-allowed rounded-lg transition-colors"
                        >
                          <Wrench className="w-3 h-3" />
                          进入维护
                        </button>
                      )}
                      <button
                        disabled
                        title={lifecycleGuardReason}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-accent-foreground opacity-50 cursor-not-allowed rounded-lg transition-colors"
                      >
                        <RotateCcw className="w-3 h-3" />
                        重启
                      </button>
                      <button
                        onClick={() => handleViewPifs(host.connectionId, host.ref)}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted rounded-lg transition-colors"
                      >
                        <Network className="w-3 h-3" />
                        主机接口
                        {expandedPifs === hostKey ? (
                          <ChevronUp className="w-3 h-3" />
                        ) : (
                          <ChevronDown className="w-3 h-3" />
                        )}
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4 lg:gap-4">
                <div className="bg-muted rounded-lg p-3">
                  <div className="text-xs text-muted-foreground mb-1">CPU</div>
                  <div className="text-foreground font-medium">
                    {host.cpu_info?.cpu_count || '—'} 逻辑处理器
                  </div>
                  <p title={host.cpu_info?.modelname || host.cpu_info?.model} className="mt-1 truncate text-xs text-muted-foreground">{host.cpu_info?.modelname || host.cpu_info?.model || '型号暂不可用'}</p>
                  {host.cpu_info?.socket_count && <p className="mt-1 text-xs text-muted-foreground">{host.cpu_info.socket_count} 插槽</p>}
                </div>
                <div className="min-w-0 bg-muted rounded-lg p-3">
                  <div className="text-xs text-muted-foreground mb-1">内存容量</div>
                  <HostMemorySummary host={host} />
                </div>
                <div className="bg-muted rounded-lg p-3">
                  <div className="text-xs text-muted-foreground mb-1">运行中 VM</div>
                  <div className="text-foreground font-medium">{getVmCount(host.ref, host.connectionId)}</div>
                </div>
                <div className="bg-muted rounded-lg p-3">
                  <div className="text-xs text-muted-foreground mb-1">XCP-ng 版本</div>
                  <div className="text-foreground font-medium text-xs">
                    {host.software_version?.product_version || '—'}
                  </div>
                </div>
              </div>

              {/* PIF expansion panel */}
              {expandedPifs === hostKey && (
                <HostInterfacesPanel key={`${hostKey}:${getConnectionReadIdentity(host.connectionId)}`}
                  connectionId={host.connectionId} hostRef={host.ref} networks={allNetworks.filter((network) => network.connectionId === host.connectionId)} />
              )}
            </div>
          )
        })}
      </div>

      {hosts.length === 0 && (
        <div className="text-center py-12">
          <Server className="w-10 h-10 text-subtle mx-auto mb-3" />
          <p className="text-muted-foreground font-medium">没有找到主机</p>
        </div>
      )}

      <MaintenanceDialog
        open={maintenanceDialog.open}
        onClose={() => setMaintenanceDialog((prev) => ({ ...prev, open: false }))}
        connectionId={maintenanceDialog.connectionId}
        hostRef={maintenanceDialog.hostRef}
        vmNames={maintenanceDialog.vmNames}
        onComplete={() => {
          refreshHosts({ afterMutation: true, connectionId: maintenanceDialog.connectionId })
          refreshVms({ afterMutation: true, connectionId: maintenanceDialog.connectionId })
        }}
      />
    </div>
  )
}
