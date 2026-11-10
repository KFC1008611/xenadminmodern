import { srUsedPercent } from '../../../shared/storage-capacity'
/**
 * StoragePage — list of Storage Repositories with detail panel and SR actions.
 * Uses useMultiDataStore for multi-connection support.
 */
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { HardDrive, Plus } from 'lucide-react'
import { useMultiDataStore } from '../store/multiData.store'
import { useConnectionManagerStore } from '../store/connectionManager.store'
import { formatBytes, cn } from '../lib/utils'
import CreateSrWizard from '../components/sr/CreateSrWizard'
import SrDetailPanel from '../components/sr/SrDetailPanel'
import SrActions from '../components/sr/SrActions'
import type { ConnectedPbdRecord } from '../types/xapi'

function resourceKey(connectionId: string, ref: string): string {
  return `${connectionId}:${ref}`
}

export default function StoragePage({ hostRef, connectionId: hostConnectionId }: { hostRef?: string; connectionId?: string } = {}) {
  const { srs: allSrs, hosts: allHosts, refreshSrs, refreshHosts, pools: allPools, domainStates } = useMultiDataStore()
  const connections = useConnectionManagerStore((s) => s.connections)
  const { connectionId: routeConnectionId } = useParams<{ connectionId?: string }>()
  const pathConnectionId = hostConnectionId || routeConnectionId
  const connection = connections.find((item) => item.id === pathConnectionId)
  const pbdScope = JSON.stringify([pathConnectionId, hostRef, connection?.state, connection?.epoch, connection?.connectedAt, connection?.poolUuid])
  const [pbds, setPbds] = useState<{ scope: string; records: ConnectedPbdRecord[] } | null>(null)
  const [pbdError, setPbdError] = useState<string | null>(null)
  const [pbdLoading, setPbdLoading] = useState(false)
  const [pbdRevision, setPbdRevision] = useState(0)
  const storageReadAt = domainStates[pathConnectionId || '']?.srs?.lastSuccessAt

  useEffect(() => {
    let cancelled = false
    if (!hostRef || !pathConnectionId || connection?.state !== 'connected') return
    setPbdLoading(true)
    setPbdError(null)
    window.xapi.pbd.list(pathConnectionId).then((records) => {
      if (!cancelled) setPbds({ scope: pbdScope, records })
    }).catch((error) => {
      if (!cancelled) setPbdError(error instanceof Error ? error.message : String(error))
    }).finally(() => { if (!cancelled) setPbdLoading(false) })
    return () => { cancelled = true }
  }, [pbdScope, pathConnectionId, hostRef, connection?.state, storageReadAt, pbdRevision])

  // Filter by connectionId if specified in path
  const currentPbds = pbds?.scope === pbdScope ? pbds.records.filter((pbd) => pbd.host === hostRef) : []
  const srs = allSrs.filter((sr) => (!pathConnectionId || sr.connectionId === pathConnectionId) && (!hostRef || currentPbds.some((pbd) => pbd.SR === sr.ref)))
  const pools = pathConnectionId ? allPools.filter((p) => p.connectionId === pathConnectionId) : allPools

  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedSrRef = searchParams.get('sr')
  const selectedKey = pathConnectionId && requestedSrRef ? resourceKey(pathConnectionId, requestedSrRef) : null
  const selectedSr = srs.find((sr) => resourceKey(sr.connectionId, sr.ref) === selectedKey) ?? null
  const selectedConnection = connections.find((connection) => connection.id === selectedSr?.connectionId)
  const [wizardOpen, setWizardOpen] = useState(false)
  const detailContainer = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (selectedKey) detailContainer.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }, [selectedKey, selectedSr?.ref])
  const [wizardTarget, setWizardTarget] = useState({ connectionId: '', hostRef: '' })
  const [detailRevision, setDetailRevision] = useState(0)

  useEffect(() => {
    refreshSrs()
    refreshHosts()
  }, [refreshHosts, refreshSrs])

  const connectedConnections = connections.filter((c) => c.state === 'connected')
  const scopedConnection = pathConnectionId
    ? connectedConnections.find((c) => c.id === pathConnectionId)
    : connectedConnections.length === 1 ? connectedConnections[0] : null
  const wizardConnectionId = scopedConnection?.id ?? ''
  const wizardHostRef = hostRef || allHosts.find((h) => h.connectionId === wizardConnectionId)?.ref || ''
  const wizardTitle = wizardConnectionId
    ? `目标资源池：${scopedConnection?.poolName || scopedConnection?.name || wizardConnectionId}`
    : '请先选择单个资源池'

  // Find poolRef for a given connectionId
  const getPoolRef = (connectionId: string): string | undefined => {
    const pool = pools.find((p) => p.connectionId === connectionId)
    return pool?.ref
  }

  const closeDetails = () => {
    const next = new URLSearchParams(searchParams)
    next.delete('sr')
    setSearchParams(next)
  }
  const selectSr = (connectionId: string, srRef: string) => {
    if (pathConnectionId !== connectionId) {
      navigate(`/pool/${encodeURIComponent(connectionId)}/storage?sr=${encodeURIComponent(srRef)}`)
      return
    }
    const next = new URLSearchParams(searchParams)
    next.set('sr', srRef)
    setSearchParams(next)
  }

  const handleSrCreated = (srRef: string) => {
    setWizardOpen(false)
    selectSr(wizardTarget.connectionId, srRef)
    void refreshSrs({ afterMutation: true, connectionId: wizardTarget.connectionId })
  }

  return (
    <div className="space-y-4">
      {hostRef && pbdLoading && <p role="status" className="text-sm text-muted-foreground">正在读取主机存储连接…</p>}
      {hostRef && pbdError && <div role="alert" className="break-words text-sm text-warning">主机存储连接读取失败。{pbdError}
        <button type="button" onClick={() => setPbdRevision((value) => value + 1)} className="ml-2 underline">重新读取存储连接</button>
      </div>}
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="sr-only">存储</h1>
        <span className="text-xs tabular-nums text-muted-foreground">{srs.length} 个</span>
        <div className="flex flex-wrap items-end gap-2">
        <button
          onClick={() => {
            setWizardTarget({ connectionId: wizardConnectionId, hostRef: wizardHostRef })
            setWizardOpen(true)
          }}
          disabled={!wizardConnectionId || !wizardHostRef || !!(hostRef && (pbdLoading || pbdError))}
          title={wizardTitle}
          className="flex items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-secondary disabled:text-subtle sm:justify-start"
        >
          <Plus className="w-4 h-4" />
          新建存储
        </button>
        </div>
      </div>

      {/* Content area: SR list + optional detail panel */}
      <div className={cn('grid min-w-0 grid-cols-1 gap-4', selectedSr && 'xl:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]')}>
        {/* SR list */}
        <div className="order-2 grid min-w-0 grid-cols-1 content-start gap-3 xl:order-1">
          {srs.map((sr) => {
            const usedPercent = srUsedPercent(sr)
            const srKey = resourceKey(sr.connectionId, sr.ref)
            const isSelected = selectedSr
              ? resourceKey(selectedSr.connectionId, selectedSr.ref) === srKey
              : false
            const poolRef = getPoolRef(sr.connectionId)

            return (
              <div
                key={srKey}
                className={cn(
                  'min-w-0 bg-card border rounded-xl p-4 transition-colors',
                  isSelected
                    ? 'border-primary/30'
                    : 'border-border hover:border-input'
                )}
              >
                <button
                  type="button"
                  className="min-w-0 max-w-full w-full text-left"
                  aria-expanded={isSelected}
                  aria-label={`查看存储仓库 ${sr.name_label}`}
                  onClick={() => isSelected ? closeDetails() : selectSr(sr.connectionId, sr.ref)}
                >
                  <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <h3 className="truncate font-medium text-foreground">{sr.name_label}</h3>
                      <p className="text-subtle text-sm">
                        {sr.type} · {sr.shared ? '共享' : '本地'}
                        {hostRef && currentPbds.some((pbd) => pbd.SR === sr.ref && !pbd.currently_attached) && <span className="ml-2 text-warning">未连接</span>}
                      </p>
                      {!pathConnectionId && <p className="truncate text-xs text-subtle">{sr.poolName || sr.connectionId}</p>}
                    </div>
                    <span className="text-sm text-muted-foreground sm:flex-shrink-0">
                      {formatBytes(sr.physical_utilisation)} /{' '}
                      {formatBytes(sr.physical_size)}
                    </span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-1.5">
                    <div
                      className={cn(
                        'h-1.5 rounded-full transition-all',
                        (usedPercent ?? 0) > 85
                          ? 'bg-danger-solid'
                          : (usedPercent ?? 0) > 70
                          ? 'bg-warning-solid'
                          : 'bg-primary'
                      )}
                      style={{ width: `${Math.min(100, Math.max(0, usedPercent ?? 0))}%` }}
                    />
                  </div>
                  <div className="text-xs text-subtle mt-1">
                    {usedPercent === null ? '容量未知' : `已用 ${usedPercent}%`} · {sr.VDIs?.length || 0} 个{sr.type === 'iso' ? ' ISO 镜像' : '虚拟磁盘'}
                  </div>
                </button>

                {/* SR action buttons */}
                <div className="mt-3 pt-3 border-t border-border">
                  <SrActions
                    sr={sr}
                    connectionId={sr.connectionId}
                    poolRef={poolRef}
                    isDefault={pools.some((pool) => pool.connectionId === sr.connectionId && pool.default_SR === sr.ref)}
                    disabled={connections.find((connection) => connection.id === sr.connectionId)?.state !== 'connected' || !!(hostRef && (pbdLoading || pbdError))}
                    onActionComplete={async () => {
                      await useMultiDataStore.getState().refreshConnection(sr.connectionId, { afterMutation: true })
                      setDetailRevision((revision) => revision + 1)
                      const states = useMultiDataStore.getState().domainStates[sr.connectionId]
                      const refreshError = states?.srs?.error || states?.pools?.error
                      if (refreshError) throw new Error(refreshError)
                    }}
                  />
                </div>
              </div>
            )
          })}

          {srs.length === 0 && (!hostRef || !pbdLoading && !pbdError) && (
            <div className="bg-card border border-border rounded-xl p-8 text-center">
              <HardDrive className="w-10 h-10 text-subtle mx-auto mb-3" />
              <p className="text-muted-foreground font-medium">未找到存储仓库</p>
            </div>
          )}
        </div>

        {/* Detail panel */}
        {selectedSr && (
          <div ref={detailContainer} className="order-1 min-w-0 xl:order-2">
            <SrDetailPanel
              key={JSON.stringify([selectedSr.connectionId, selectedSr.ref, selectedConnection?.state, selectedConnection?.epoch, selectedConnection?.connectedAt, selectedConnection?.poolUuid])}
              sr={selectedSr}
              connectionId={selectedSr.connectionId}
              refreshRevision={detailRevision}
              onClose={closeDetails}
            />
          </div>
        )}
      </div>

      {/* Create SR wizard */}
      <CreateSrWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onCreated={handleSrCreated}
        connectionId={wizardOpen ? wizardTarget.connectionId : wizardConnectionId}
        hostRef={wizardOpen ? wizardTarget.hostRef : wizardHostRef}
      />
    </div>
  )
}
