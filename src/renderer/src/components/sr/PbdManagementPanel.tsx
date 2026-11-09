/**
 * PbdManagementPanel - PBD (Physical Block Device) management component.
 * v9: Rewritten to use project Tailwind style instead of shadcn/ui.
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plug, Unplug, Trash2, Loader2, Link2 } from 'lucide-react'
import { useStorageAdvancedStore } from '../../store/storage-advanced.store'
import { useMultiDataStore } from '../../store/multiData.store'
import { useConnectionManagerStore } from '../../store/connectionManager.store'
import { feedback } from '../../store/feedback.store'
import { getAuditedFeatureBlockReason } from '../../../../shared/audited-features'

const pbdMutationBlocked = getAuditedFeatureBlockReason('storage.pbd-iso')

interface PbdManagementPanelProps {
  connectionId: string
  srRef?: string
  hostRef?: string
  refreshRevision?: number
}

function resourceKey(connectionId: string, ref: string): string {
  return `${connectionId}:${ref}`
}

export function PbdManagementPanel({ connectionId, srRef, hostRef, refreshRevision = 0 }: PbdManagementPanelProps) {
  const { pbdStates, loadPbds, plugPbd, unplugPbd, destroyPbd } = useStorageAdvancedStore()
  const hosts = useMultiDataStore((state) => state.hosts)
  const srs = useMultiDataStore((state) => state.srs)
  const connection = useConnectionManagerStore((state) => state.connections.find((item) => item.id === connectionId))
  const state = pbdStates[connectionId]
  const pbds = state?.items ?? []
  const pbdsLoading = state?.loading ?? true
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  useEffect(() => {
    if (connection?.state === 'connected') void loadPbds(connectionId)
  }, [connectionId, connection?.state, connection?.epoch, connection?.connectedAt, connection?.poolUuid, loadPbds, refreshRevision])

  // Filter PBDs by SR or host if provided
  const filteredPbds = pbds.filter((pbd) => {
    if (pbd.connectionId !== connectionId) return false
    if (srRef && pbd.SR !== srRef) return false
    if (hostRef && pbd.host !== hostRef) return false
    return true
  })

  const handlePlug = async (pbdRef: string) => {
    const key = resourceKey(connectionId, pbdRef)
    setActionLoading(key)
    try {
      await plugPbd(pbdRef, connectionId)
      feedback.success('PBD 已连接')
    } catch (err: any) {
      feedback.error(err.message || '连接失败')
    } finally {
      setActionLoading(null)
    }
  }

  const handleUnplug = async (pbdRef: string) => {
    const key = resourceKey(connectionId, pbdRef)
    setActionLoading(key)
    try {
      await unplugPbd(pbdRef, connectionId)
      feedback.success('PBD 已断开')
    } catch (err: any) {
      feedback.error(err.message || '断开失败')
    } finally {
      setActionLoading(null)
    }
  }

  const handleDestroy = async (pbdRef: string) => {
    if (!confirm('确定要删除此 PBD 吗？')) return

    const key = resourceKey(connectionId, pbdRef)
    setActionLoading(key)
    try {
      await destroyPbd(pbdRef, connectionId)
      feedback.success('PBD 已删除')
    } catch (err: any) {
      feedback.error(err.message || '删除失败')
    } finally {
      setActionLoading(null)
    }
  }

  if (connection?.state !== 'connected') return <p role="alert" className="py-4 text-sm text-warning">管理连接未连接，请重新连接后查看物理存储连接。</p>

  if (pbdsLoading && !filteredPbds.length) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
        <Loader2 className="w-4 h-4 animate-spin" />
        加载 PBD 连接...
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground">物理存储连接 (PBD)</h3>
        <span className="text-xs text-subtle">{filteredPbds.length} 个连接</span>
      </div>

      <p className="text-xs text-muted-foreground">每条连接表示一台主机对此存储仓库的接入。已连接表示该主机已接通仓库；断开和删除接入暂不可用。</p>

      {state?.error && <div role="alert" className="break-words rounded border border-warning/50 bg-warning-soft p-3 text-xs text-warning">
        <p>物理存储连接读取失败：{state.error}{filteredPbds.length > 0 && '。当前显示上次成功读取的数据，请重新读取后操作。'}</p>
        <button onClick={() => void loadPbds(connectionId)} className="mt-2 text-accent-foreground">重新加载</button>
      </div>}
      {pbdsLoading && <p role="status" className="text-xs text-muted-foreground">正在刷新物理存储连接...</p>}

      {filteredPbds.length === 0 && !state?.error ? (
        <div className="text-center py-6">
          <Link2 className="w-8 h-8 text-subtle mx-auto mb-2" />
          <p className="text-sm text-subtle">没有 PBD 连接</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredPbds.map((pbd) => {
            const pbdKey = resourceKey(connectionId, pbd.ref)
            return (
            <div
              key={pbdKey}
              className="bg-muted border border-input rounded-lg p-3"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-foreground font-mono">{pbd.uuid.substring(0, 8)}</span>
                <span
                  className={`text-xs px-1.5 py-0.5 rounded ${
                    pbd.currently_attached
                      ? 'bg-success-soft text-success'
                      : 'bg-secondary text-muted-foreground'
                  }`}
                >
                  {pbd.currently_attached ? '已连接' : '未连接'}
                </span>
              </div>
              <div className="text-xs text-subtle space-y-0.5 mb-2">
                <p className="break-all" title={pbd.host}>主机：<Link className="text-accent-foreground hover:underline" to={`/pool/${encodeURIComponent(connectionId)}/hosts/${encodeURIComponent(pbd.host)}`}>{hosts.find((host) => host.connectionId === connectionId && host.ref === pbd.host)?.name_label || pbd.host}</Link></p>
                <p className="break-all" title={pbd.SR}>存储仓库：{srs.find((sr) => sr.connectionId === connectionId && sr.ref === pbd.SR)?.name_label || pbd.SR}</p>
              </div>
              <div className="flex gap-2">
                {!pbd.currently_attached && (
                  <button
                    onClick={() => handlePlug(pbd.ref)}
                    disabled={actionLoading !== null || pbdsLoading || Boolean(state?.error) || connection?.state !== 'connected'}
                    className="flex items-center gap-1 px-2 py-1 text-xs bg-primary hover:bg-primary-hover disabled:opacity-50 text-primary-foreground rounded transition-colors"
                  >
                    {actionLoading === pbdKey ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Plug className="w-3 h-3" />
                    )}
                    连接
                  </button>
                )}
                {pbd.currently_attached && (
                  <button
                    onClick={() => handleUnplug(pbd.ref)}
                    disabled
                    title={pbdMutationBlocked}
                    className="flex items-center gap-1 px-2 py-1 text-xs bg-secondary hover:bg-secondary text-secondary-foreground rounded transition-colors disabled:opacity-50"
                  >
                    {actionLoading === pbdKey ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Unplug className="w-3 h-3" />
                    )}
                    断开
                  </button>
                )}
                <button
                  onClick={() => handleDestroy(pbd.ref)}
                  disabled
                  title={pbdMutationBlocked}
                  className="flex items-center gap-1 px-2 py-1 text-xs bg-danger-soft hover:bg-danger-soft text-danger rounded transition-colors disabled:opacity-50"
                >
                  {actionLoading === pbdKey ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Trash2 className="w-3 h-3" />
                  )}
                  删除
                </button>
              </div>
            </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
