/**
 * NetworksPage — table of all pool networks with CRUD operations.
 * v5: Switched to useMultiDataStore, added create/delete/rename actions.
 * v9: Added Bond and VLAN management sections.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMultiDataStore } from '../store/multiData.store'
import { useConnectionManagerStore } from '../store/connectionManager.store'
import type { ConnectedNetworkRecord, PifRecord } from '../types/xapi'
import type { LucideIcon } from 'lucide-react'
import { Activity, Cable, Check, Edit3, Layers, Link2, Loader2, Network, Plus, Server, Trash2, X } from 'lucide-react'
import { executeAction } from '../lib/executeAction'
import { formatNetworkAttachment, formatNetworkName, formatNetworkTypeLabel, isNameOnlyVlanNetwork } from '../lib/networkDisplay'
import { NETWORK_TERMS } from '../lib/networkTerminology'
import { CreateNetworkDialog } from '../components/network/CreateNetworkDialog'
import { BondList } from '../components/network/BondList'
import { VlanList } from '../components/network/VlanList'
import { NetworkDetailsPanel } from '../components/network/NetworkDetailsPanel'
import { DesktopDialog } from '../components/layout/DesktopDialog'


function resourceKey(connectionId: string, ref: string): string {
  return `${connectionId}:${ref}`
}

const LINK_STATUS_LABELS: Record<string, string> = {
  connected: '已连接',
  disconnected: '断开',
  partial: '部分连接',
  unknown: '未知',
  none: '无主机接口',
}

function linkStatusClass(status?: string): string {
  if (status === 'connected') return 'bg-success-soft text-success border-success/30'
  if (status === 'disconnected') return 'bg-danger-soft text-danger border-danger/30'
  if (status === 'partial') return 'bg-warning-soft text-warning border-warning/30'
  return 'bg-muted text-muted-foreground border-input'
}

function networkAccentClass(network: ConnectedNetworkRecord): string {
  if (isNameOnlyVlanNetwork(network)) return 'border-l-warning/70'
  if (network.kind === 'vlan' || network.isVlan) return 'border-l-primary/70'
  if (network.kind === 'bond' || network.isBond) return 'border-l-info/70'
  if (network.kind === 'external') return 'border-l-primary'
  return 'border-l-input'
}

function networkIcon(network: ConnectedNetworkRecord): LucideIcon {
  if (network.kind === 'vlan' || network.isVlan) return Layers
  if (network.kind === 'bond' || network.isBond) return Link2
  if (network.kind === 'external') return Cable
  return Network
}

interface SummaryCellProps {
  icon: LucideIcon
  label: string
  value: string | number
  detail?: string
  tone?: string
}

function SummaryCell({ icon: Icon, label, value, detail, tone = 'text-secondary-foreground' }: SummaryCellProps) {
  return (
    <div className="min-w-0 px-4 py-3">
      <div className="flex items-center gap-2 text-xs text-subtle">
        <Icon className="h-3.5 w-3.5" />
        <span>{label}</span>
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className={`text-lg font-semibold tabular-nums ${tone}`}>{value}</span>
        {detail && <span className="truncate text-xs text-subtle">{detail}</span>}
      </div>
    </div>
  )
}

export default function NetworksPage() {
  const { networks: allNetworks, refreshNetworks, domainStates } = useMultiDataStore()
  const connections = useConnectionManagerStore((s) => s.connections)
  const activeConnectionId = useConnectionManagerStore((s) => s.activeConnectionId)
  const setActiveConnection = useConnectionManagerStore((s) => s.setActiveConnection)
  const { connectionId: pathConnectionId } = useParams<{ connectionId?: string }>()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const connectedConnections = connections.filter((c) => c.state === 'connected')
  const pathConnection = pathConnectionId
    ? connectedConnections.find((c) => c.id === pathConnectionId)
    : null
  const scopedConnectionId = pathConnectionId
    ? pathConnection?.id || ''
    : connectedConnections.length === 1
      ? connectedConnections[0].id
      : ''

  // Filter by connectionId if specified in path
  const networks = pathConnectionId ? allNetworks.filter((n) => n.connectionId === pathConnectionId) : allNetworks
  const poolName = pathConnectionId
    ? connections.find((c) => c.id === pathConnectionId)?.poolName || connections.find((c) => c.id === pathConnectionId)?.name
    : null
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [renamingRef, setRenamingRef] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [pifs, setPifs] = useState<PifRecord[]>([])
  const [pifsDataScope, setPifsDataScope] = useState<string | null>(null)
  const [pifsError, setPifsError] = useState<string | null>(null)
  const [pifsLoading, setPifsLoading] = useState(false)
  const pifRequest = useRef(0)
  const actionInFlight = useRef(false)
  const selectedNetwork = networks.find((network) => network.ref === searchParams.get('network') && network.connectionId === scopedConnectionId)
  const deleteNetwork = networks.find((network) => resourceKey(network.connectionId, network.ref) === deleteConfirm)
  const canDeleteNetwork = !!deleteNetwork && connectedConnections.some((connection) => connection.id === deleteNetwork.connectionId)
    && !domainStates[deleteNetwork.connectionId]?.networks?.error
    && deleteNetwork.allowedActions?.destroy !== false && !deleteNetwork.PIFs?.length && !deleteNetwork.VIFs?.length

  const selectNetwork = (network: ConnectedNetworkRecord) => {
    navigate(`/pool/${encodeURIComponent(network.connectionId)}/networks?network=${encodeURIComponent(network.ref)}`)
  }

  useEffect(() => { refreshNetworks() }, [refreshNetworks])

  const advancedConnectionId = scopedConnectionId
  const advancedConnection = connections.find((connection) => connection.id === advancedConnectionId)
  const pifScope = JSON.stringify([advancedConnectionId, advancedConnection?.connectedAt, advancedConnection?.epoch, advancedConnection?.poolUuid])
  const hostsReadAt = domainStates[advancedConnectionId]?.hosts?.lastSuccessAt
  const networksReadAt = domainStates[advancedConnectionId]?.networks?.lastSuccessAt
  const scopedPifs = pifsDataScope === pifScope ? pifs : []
  const currentPifScope = useRef(pifScope)
  currentPifScope.current = pifScope

  const loadPifs = useCallback(async () => {
    if (!advancedConnectionId || currentPifScope.current !== pifScope) return
    const request = ++pifRequest.current
    const current = () => request === pifRequest.current && currentPifScope.current === pifScope
    setPifsLoading(true)
    setPifsError(null)
    try {
      const records = await window.xapi.network.listPifs(advancedConnectionId)
      if (current()) { setPifs(records); setPifsDataScope(pifScope) }
    } catch (error: any) {
      if (current()) setPifsError(error?.message || String(error))
    } finally {
      if (current()) setPifsLoading(false)
    }
  }, [advancedConnectionId, pifScope])

  const refreshNetworkData = useCallback(async () => {
    await refreshNetworks({ afterMutation: true, connectionId: advancedConnectionId })
    const networkError = useMultiDataStore.getState().domainStates[advancedConnectionId]?.networks?.error
    if (networkError) throw new Error(networkError)
    await loadPifs()
  }, [advancedConnectionId, loadPifs, refreshNetworks])

  useEffect(() => {
    if (pathConnectionId && pathConnection && pathConnectionId !== activeConnectionId) {
      setActiveConnection(pathConnectionId)
    }
  }, [activeConnectionId, pathConnection?.id, pathConnectionId, setActiveConnection])

  useEffect(() => {
    setPifs([])
    setPifsError(null)
    setPifsLoading(false)
    setCreateDialogOpen(false)
    setDeleteConfirm(null)
    setDeleteError(null)
    setRenamingRef(null)
    return () => { ++pifRequest.current }
  }, [loadPifs])

  useEffect(() => { void loadPifs() }, [loadPifs, hostsReadAt, networksReadAt])

  const handleDelete = async (connectionId: string, networkRef: string, networkKey: string, name: string) => {
    if (actionInFlight.current) return
    actionInFlight.current = true
    setActionLoading(networkKey)
    setDeleteError(null)
    await executeAction({
      label: `删除网络 "${name}"`,
      action: () => window.xapi.network.destroy(connectionId, networkRef),
      onError: (error) => setDeleteError(error.message),
      onSuccess: async () => {
        setDeleteConfirm(null)
        if (searchParams.get('network') === networkRef) setSearchParams({})
        await refreshNetworkData()
      },
    })
    setActionLoading(null)
    actionInFlight.current = false
  }

  const handleRename = async (connectionId: string, networkRef: string, networkKey: string) => {
    if (actionInFlight.current) return
    if (!renameValue.trim()) {
      setRenamingRef(null)
      return
    }
    actionInFlight.current = true
    setActionLoading(networkKey)
    await executeAction({
      label: '重命名网络',
      action: () => window.xapi.network.rename(connectionId, networkRef, renameValue.trim()),
      onSuccess: async () => {
        setRenamingRef(null)
        await refreshNetworkData()
      },
    })
    setActionLoading(null)
    actionInFlight.current = false
  }

  const startRename = (networkKey: string, currentName: string) => {
    setRenamingRef(networkKey)
    setRenameValue(currentName)
  }

  const hasScopedConnection = !!scopedConnectionId
  const linkTrackedCount = networks.filter((network) => network.linkStatus && network.linkStatus !== 'none').length
  const connectedLinkCount = networks.filter((network) => network.linkStatus === 'connected').length
  const vlanCount = networks.filter((network) => network.kind === 'vlan' || network.isVlan).length
  const unboundVlanCount = networks.filter(isNameOnlyVlanNetwork).length
  const bondCount = networks.filter((network) => network.kind === 'bond' || network.isBond).length
  const vifCount = networks.reduce((total, network) => total + (network.VIFs?.length || 0), 0)

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-lg border border-border bg-background">
        <div className="flex flex-col gap-3 border-b border-border px-4 py-3 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold text-foreground">{poolName ? `${poolName} · 网络` : '网络'}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
          <label className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            资源池
            <select aria-label="网络资源池" value={pathConnectionId || ''} onChange={(event) => navigate(event.target.value ? `/pool/${encodeURIComponent(event.target.value)}/networks` : '/networks')} className="h-9 max-w-56 rounded-lg border border-input bg-card px-2 text-sm text-foreground">
              <option value="">全部资源池</option>
              {connections.map((connection) => <option key={connection.id} value={connection.id}>{connection.poolName || connection.name}{connection.state !== 'connected' ? '（未连接）' : ''}</option>)}
            </select>
          </label>
          <button
            onClick={() => setCreateDialogOpen(true)}
            disabled={!scopedConnectionId}
            title={!scopedConnectionId ? '请选择资源池' : '创建网络'}
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-muted disabled:text-subtle"
          >
            <Plus className="h-4 w-4" />
            创建网络
          </button>
          </div>
        </div>
        {!scopedConnectionId && connectedConnections.length > 1 && <p className="border-b border-border px-4 py-2 text-xs text-muted-foreground">选择一个资源池后可创建网络、查看该池的网卡绑定和 VLAN。</p>}
        <div className="grid grid-cols-2 divide-x divide-y divide-border md:grid-cols-5 md:divide-y-0">
          <SummaryCell icon={Network} label="总网络" value={networks.length} />
          <SummaryCell
            icon={Activity}
            label="链路已连接"
            value={linkTrackedCount ? `${connectedLinkCount}/${linkTrackedCount}` : '0'}
            tone={connectedLinkCount > 0 ? 'text-success' : 'text-secondary-foreground'}
          />
          <SummaryCell
            icon={Layers}
            label="VLAN"
            value={vlanCount}
            detail={unboundVlanCount ? `${unboundVlanCount} 个仅名称含 VLAN` : undefined}
            tone="text-accent-foreground"
          />
          <SummaryCell icon={Link2} label={NETWORK_TERMS.bond} value={bondCount} tone={bondCount ? 'text-info' : 'text-secondary-foreground'} />
          <SummaryCell icon={Server} label="VM 接入" value={vifCount} detail={NETWORK_TERMS.virtualNic} />
        </div>
      </section>

      {selectedNetwork && <NetworkDetailsPanel key={resourceKey(selectedNetwork.connectionId, selectedNetwork.ref)} network={selectedNetwork} pifs={scopedPifs} pifsLoading={pifsLoading} pifsError={pifsError} onClose={() => setSearchParams({})} />}
      {searchParams.get('network') && scopedConnectionId && !selectedNetwork && <div role="status" className="rounded-lg border border-warning/30 bg-warning-soft p-3 text-sm text-warning">
        当前资源池的清单中尚未找到所选网络。请重新读取后核对，该网络也可能已被删除。
        <button type="button" onClick={() => void refreshNetworks()} className="ml-2 underline">重新读取网络清单</button>
      </div>}

      <div className={`grid gap-4 ${hasScopedConnection ? 'min-[1600px]:grid-cols-[minmax(0,1fr)_360px]' : ''}`}>
        <section className="min-w-0 overflow-hidden rounded-lg border border-border bg-background">
          <h2 className="sr-only">网络清单</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-sm">
              <thead className="bg-card">
                <tr className="border-b border-border">
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">名称</th>
                  <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">类型</th>
                  <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">链路</th>
                  <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">连接关系</th>
                  <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">MTU</th>
                  <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">{NETWORK_TERMS.virtualNic}</th>
                  <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">{NETWORK_TERMS.hostInterfaceCompact}</th>
                  <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">资源池</th>
                  <th className="sticky right-0 z-10 bg-card px-4 py-2.5 text-right font-medium text-muted-foreground">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {networks.map((net) => {
                  const netKey = resourceKey(net.connectionId, net.ref)
                  const connected = connectedConnections.some((connection) => connection.id === net.connectionId)
                  const fresh = !domainStates[net.connectionId]?.networks?.error
                  const canRename = connected && fresh && net.allowedActions?.rename !== false
                  const canDestroy = connected && fresh && net.allowedActions?.destroy !== false && !net.VIFs?.length && !net.PIFs?.length
                  const displayName = formatNetworkName(net)
                  const NetIcon = networkIcon(net)

                  return (
                    <tr key={netKey} className={`transition-colors hover:bg-card ${selectedNetwork === net ? 'bg-accent' : ''}`}>
                      <td className={`max-w-80 border-l-2 px-4 py-3 ${networkAccentClass(net)}`}>
                        {renamingRef === netKey ? (
                          <div className="flex items-center gap-1.5">
                            <input
                              type="text"
                              aria-label={`网络 ${displayName} 的新名称`}
                              value={renameValue}
                              disabled={!!actionLoading}
                              onChange={(e) => setRenameValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleRename(net.connectionId, net.ref, netKey)
                                if (e.key === 'Escape') setRenamingRef(null)
                              }}
                              className="h-8 w-56 rounded-md border border-input bg-card px-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                              autoFocus
                            />
                            <button
                              onClick={() => handleRename(net.connectionId, net.ref, netKey)}
                              disabled={!!actionLoading || !renameValue.trim()}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-success transition-colors hover:bg-success-soft"
                              title="保存"
                            >
                              <Check className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => setRenamingRef(null)}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted"
                              title="取消"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex min-w-0 items-center gap-2.5">
                            <span className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md border border-input bg-card text-accent-foreground">
                              <NetIcon className="h-3.5 w-3.5" />
                            </span>
                            <div className="min-w-0">
                              <button type="button" onClick={() => selectNetwork(net)} className="block max-w-full truncate text-left font-medium text-accent-foreground hover:underline" title={net.name_label} aria-label={`查看网络 ${displayName}`}>{displayName}</button>
                              {displayName !== net.name_label && (
                                <div className="max-w-72 truncate text-[11px] text-subtle">{net.name_label}</div>
                              )}
                            </div>
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <span className="inline-flex rounded-md border border-input bg-card px-2 py-0.5 text-xs text-secondary-foreground">
                          {formatNetworkTypeLabel(net)}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <span className={`inline-flex rounded-md border px-2 py-0.5 text-xs ${linkStatusClass(net.linkStatus)}`}>
                          {LINK_STATUS_LABELS[net.linkStatus || 'unknown'] || '未知'}
                        </span>
                      </td>
                      <td className="max-w-44 px-3 py-3 text-xs text-muted-foreground">
                        <span className="block truncate" title={formatNetworkAttachment(net)}>
                          {formatNetworkAttachment(net)}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">{net.MTU}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">{net.VIFs?.length || 0}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">{net.PIFs?.length || 0}</td>
                      <td className="px-3 py-3">
                        <span className="inline-flex max-w-40 rounded-md bg-card px-2 py-0.5 text-xs text-muted-foreground">
                          <span className="truncate">{net.poolName}</span>
                        </span>
                      </td>
                      <td className="sticky right-0 z-10 bg-card px-4 py-3 shadow-[-6px_0_8px_-8px_hsl(var(--foreground)/0.25)]">
                        <div className="flex h-8 items-center justify-end gap-1">
                          {actionLoading === netKey ? (
                            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                          ) : (
                            <>
                              <button
                                onClick={() => startRename(netKey, net.name_label)}
                                disabled={!canRename || !!actionLoading}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:text-subtle disabled:hover:bg-transparent"
                                title={canRename ? '重命名' : '该网络不能重命名'}
                              >
                                <Edit3 className="h-3.5 w-3.5" />
                              </button>
                              {canDestroy ? (
                                <button
                                  onClick={() => { setDeleteError(null); setDeleteConfirm(netKey) }}
                                  disabled={!!actionLoading}
                                  aria-label={`删除网络 ${displayName}`}
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-md text-danger transition-colors hover:bg-danger-soft"
                                  title="删除网络"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              ) : (
                                <button
                                  disabled
                                  aria-label={`删除网络 ${displayName}`}
                                  className="inline-flex h-8 w-8 cursor-not-allowed items-center justify-center rounded-md text-subtle"
                                  title={!connected ? '资源池未连接' : !fresh ? '网络读取失败，请重新读取后操作' : '该网络已连接主机接口或虚拟网卡，或不允许删除'}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {networks.length === 0 && (
            <div className="px-4 py-10 text-center">
              <Network className="mx-auto mb-3 h-8 w-8 text-subtle" />
              <p className="text-sm font-medium text-muted-foreground">没有找到网络</p>
            </div>
          )}
        </section>

        {hasScopedConnection && advancedConnectionId && (
          <aside className="min-w-0 space-y-4 xl:sticky xl:top-4 xl:self-start">
            {pifsLoading && <p role="status" className="text-sm text-muted-foreground">正在读取主机网络接口…</p>}
            {pifsError && <div role="alert" className="rounded-lg border border-warning/30 bg-warning-soft p-3 text-sm text-warning">
              <p className="break-words">主机网络接口读取失败：{pifsError}</p>
              {pifs.length > 0 && <p className="mt-1 text-xs">当前显示上次成功读取的数据。</p>}
              <button type="button" disabled={pifsLoading} onClick={() => void loadPifs()} className="mt-2 rounded border border-current px-2 py-1 text-xs disabled:opacity-50">重新读取主机接口</button>
            </div>}
            <BondList connectionId={advancedConnectionId} pifs={scopedPifs} networks={networks} onRefresh={() => refreshNetworkData()} />
            <VlanList connectionId={advancedConnectionId} pifs={scopedPifs} networks={networks} onRefresh={() => refreshNetworkData()} />
          </aside>
        )}
      </div>

      <CreateNetworkDialog
        key={scopedConnectionId}
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        connectionId={scopedConnectionId}
        onCreated={async (networkRef) => {
          if (networkRef) setSearchParams({ network: networkRef })
          await refreshNetworkData()
        }}
      />

      {deleteNetwork && <DesktopDialog title="删除网络" onClose={() => { if (!actionLoading) setDeleteConfirm(null) }} busy={!!actionLoading}>
        <div className="rounded-xl border border-input bg-card p-6 text-sm">
          <h2 className="text-lg font-semibold text-foreground">删除网络</h2>
          <dl className="mt-4 space-y-2 break-words text-secondary-foreground">
            <div><dt className="inline text-subtle">资源池：</dt><dd className="inline">{deleteNetwork.poolName}</dd></div>
            <div><dt className="inline text-subtle">网络：</dt><dd className="inline">{formatNetworkName(deleteNetwork)}</dd></div>
            <div><dt className="inline text-subtle">当前接入：</dt><dd className="inline">{deleteNetwork.PIFs?.length || 0} 个主机网络接口，{deleteNetwork.VIFs?.length || 0} 个虚拟网卡</dd></div>
          </dl>
          <p className="mt-4 text-warning">删除后，此网络将从资源池移除，无法再供虚拟机选择。此操作无法撤销。</p>
          {!canDeleteNetwork && <p role="alert" className="mt-3 text-warning">网络状态已变化或资源池不可操作，请取消并重新读取网络清单。</p>}
          {deleteError && <p role="alert" className="mt-3 break-words text-danger">删除网络失败：{deleteError}</p>}
          <div className="mt-6 flex justify-end gap-3">
            <button type="button" onClick={() => setDeleteConfirm(null)} disabled={!!actionLoading} className="rounded-lg border border-input px-3 py-2 text-secondary-foreground disabled:opacity-50">取消</button>
            <button type="button" disabled={!!actionLoading || !canDeleteNetwork} onClick={() => void handleDelete(deleteNetwork.connectionId, deleteNetwork.ref, resourceKey(deleteNetwork.connectionId, deleteNetwork.ref), deleteNetwork.name_label)} className="rounded-lg bg-danger-solid px-3 py-2 text-on-solid disabled:opacity-50">{actionLoading ? '正在删除…' : `确认删除网络 ${formatNetworkName(deleteNetwork)}`}</button>
          </div>
        </div>
      </DesktopDialog>}

    </div>
  )
}
