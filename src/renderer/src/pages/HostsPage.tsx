/**
 * HostsPage — scoped host table with maintenance controls and interface details.
 * v5: Switched to useMultiDataStore, added maintenance workflow and PIF list.
 */
import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getConnectionReadIdentity, useMultiDataStore } from '../store/multiData.store'
import { RotateCcw, Wrench, Power, Network, Loader2, Server } from 'lucide-react'
import { HostStatusBadge } from '../components/host/HostStatusBadge'
import { HostMemorySummary } from '../components/host/HostMemorySummary'
import { ResourceActionMenu } from '../components/layout/ResourceActionMenu'
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
  const { hosts: allHosts, vms: allVms, networks: allNetworks, refreshHosts, refreshNetworks } = useMultiDataStore()
  const { connectionId: pathConnectionId } = useParams<{ connectionId?: string }>()

  // Filter by connectionId if specified in path
  const hosts = useMemo(() => pathConnectionId ? allHosts.filter((h) => h.connectionId === pathConnectionId) : allHosts, [allHosts, pathConnectionId])
  const vms = useMemo(() => pathConnectionId ? allVms.filter((v) => v.connectionId === pathConnectionId) : allVms, [allVms, pathConnectionId])
  const lifecycleGuardReason = getAuditedFeatureBlockReason('host.maintenance')
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
      <div className="flex items-baseline gap-3">
        <h1 className="sr-only">主机</h1>
        <span className="text-xs tabular-nums text-muted-foreground">{hosts.length} 台</span>
      </div>
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead><tr className="border-b border-border text-left text-muted-foreground">
              {['名称', '状态', ...(!pathConnectionId ? ['资源池'] : []), 'CPU', '内存容量', '运行中 VM', '版本', '操作'].map((label) => <th key={label} className="px-4 py-3 font-medium">{label}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-border">{hosts.map((host) => {
              const hostKey = resourceKey(host.connectionId, host.ref)
              const status = maintenanceStates[hostKey]
              const inMaintenance = status?.state === 'maintenance' || status?.state === 'disabled' || !host.enabled
              return <Fragment key={hostKey}>
                <tr className="hover:bg-muted">
                  <td className="max-w-64 px-4 py-3">
                    <Link to={`/pool/${encodeURIComponent(host.connectionId)}/hosts/${encodeURIComponent(host.ref)}`} title={host.name_label} className="block truncate font-medium text-foreground hover:text-accent-foreground">{host.name_label}</Link>
                    <p className="mt-1 text-xs text-muted-foreground">{host.address}</p>
                  </td>
                  <td className="px-4 py-3"><HostStatusBadge enabled={host.enabled} maintenanceState={status?.state} /></td>
                  {!pathConnectionId && <td className="max-w-48 px-4 py-3"><span className="block truncate" title={host.poolName}>{host.poolName}</span></td>}
                  <td className="max-w-64 px-4 py-3">
                    <span className="whitespace-nowrap">{host.cpu_info?.cpu_count || '—'} 逻辑处理器</span>
                    <p title={host.cpu_info?.modelname || host.cpu_info?.model} className="mt-1 truncate text-xs text-muted-foreground">{host.cpu_info?.modelname || host.cpu_info?.model || '型号暂不可用'}</p>
                    {host.cpu_info?.socket_count && <p className="mt-1 text-xs text-muted-foreground">{host.cpu_info.socket_count} 插槽</p>}
                  </td>
                  <td className="min-w-48 px-4 py-3"><HostMemorySummary host={host} /></td>
                  <td className="px-4 py-3 tabular-nums">{getVmCount(host.ref, host.connectionId)}</td>
                  <td className="px-4 py-3">{host.software_version?.product_version || '—'}</td>
                  <td className="px-4 py-3"><div className="flex items-center justify-end gap-1">
                    <button type="button" aria-label="主机接口" title="主机接口" aria-expanded={expandedPifs === hostKey} onClick={() => handleViewPifs(host.connectionId, host.ref)} className="rounded-md p-2 text-muted-foreground hover:bg-muted"><Network className="h-4 w-4" /></button>
                    <ResourceActionMenu name={host.name_label} actions={[
                      { label: inMaintenance ? '退出维护' : '进入维护', icon: inMaintenance ? Power : Wrench, disabled: true, reason: lifecycleGuardReason, onSelect: () => {} },
                      { label: '重启', icon: RotateCcw, disabled: true, reason: lifecycleGuardReason, onSelect: () => {} },
                    ]} />
                  </div></td>
                </tr>
                {expandedPifs === hostKey && <tr><td colSpan={pathConnectionId ? 7 : 8} className="px-4 pb-4"><HostInterfacesPanel key={`${hostKey}:${getConnectionReadIdentity(host.connectionId)}`} connectionId={host.connectionId} hostRef={host.ref} networks={allNetworks.filter((network) => network.connectionId === host.connectionId)} /></td></tr>}
              </Fragment>
            })}</tbody>
          </table>
        </div>
      </div>

      {hosts.length === 0 && (
        <div className="text-center py-12">
          <Server className="w-10 h-10 text-subtle mx-auto mb-3" />
          <p className="text-muted-foreground font-medium">没有找到主机</p>
        </div>
      )}


    </div>
  )
}
