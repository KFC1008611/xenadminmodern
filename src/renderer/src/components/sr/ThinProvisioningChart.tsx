/**
 * ThinProvisioningChart - Displays thin provisioning statistics for an SR.
 * v9: Rewritten to use project Tailwind style instead of shadcn/ui.
 */
import { useEffect, useState } from 'react'
import { Loader2, AlertTriangle, CheckCircle } from 'lucide-react'
import { useStorageAdvancedStore, type ThinProvisioningStats } from '../../store/storage-advanced.store'
import { useConnectionManagerStore } from '../../store/connectionManager.store'

interface ThinProvisioningChartProps {
  connectionId: string
  srRef: string
  srName: string
  refreshRevision?: number
}

/** Format bytes as GB/TB only — intentional simplification for SR storage display. */
function formatBytes(bytes: number): string {
  if (!bytes) return '0 B'
  const gb = bytes / (1024 * 1024 * 1024)
  if (gb >= 1024) {
    return `${(gb / 1024).toFixed(2)} TB`
  }
  return `${gb.toFixed(2)} GB`
}

function resourceKey(connectionId: string, ref: string): string {
  return `${connectionId}:${ref}`
}

export function ThinProvisioningChart({ connectionId, srRef, srName, refreshRevision = 0 }: ThinProvisioningChartProps) {
  const { thinStats, getThinStats } = useStorageAdvancedStore()
  const connection = useConnectionManagerStore((state) => state.connections.find((item) => item.id === connectionId))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let cancelled = false
    if (connectionId && srRef) {
      setLoading(true)
      setError(null)
      void getThinStats(srRef, connectionId)
        .catch((failure) => { if (!cancelled) setError(failure instanceof Error ? failure.message : '读取容量统计失败') })
        .finally(() => { if (!cancelled) setLoading(false) })
    }
    return () => { cancelled = true }
  }, [connectionId, connection?.state, connection?.epoch, connection?.connectedAt, connection?.poolUuid, srRef, getThinStats, refreshRevision, reload])

  const stats = thinStats[resourceKey(connectionId, srRef)] as ThinProvisioningStats | undefined

  if (loading && !stats) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
        <Loader2 className="w-4 h-4 animate-spin" />
        加载精简配置统计...
      </div>
    )
  }

  const readError = error && <div role="alert" className="rounded border border-warning/50 p-3 text-sm text-warning">
    <p>容量统计读取失败：{error}{stats && '。当前显示上次成功读取的数据。'}</p>
    <button onClick={() => setReload((value) => value + 1)} className="mt-2 text-accent-foreground">重新加载</button>
  </div>
  if (!stats) {
    return readError
  }

  const physicalUsagePercent = stats.physicalSize > 0
    ? (stats.physicalUtilisation / stats.physicalSize) * 100
    : 0

  const virtualAllocationPercent = stats.physicalSize > 0
    ? (stats.virtualAllocation / stats.physicalSize) * 100
    : 0

  return (
    <div className="space-y-4">
      {readError}
      {loading && <p role="status" className="text-xs text-muted-foreground">正在刷新容量统计...</p>}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground">精简配置</h3>
        <span className="break-all text-xs text-subtle">{srName}</span>
      </div>

      {/* Physical usage */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">物理使用</span>
          <span className="text-secondary-foreground">
            {formatBytes(stats.physicalUtilisation)} / {formatBytes(stats.physicalSize)}
          </span>
        </div>
        <div className="w-full bg-muted rounded-full h-2">
          <div
            className={`h-2 rounded-full transition-all ${
              physicalUsagePercent > 85 ? 'bg-danger-solid' : physicalUsagePercent > 70 ? 'bg-warning-solid' : 'bg-primary'
            }`}
            style={{ width: `${Math.min(physicalUsagePercent, 100)}%` }}
          />
        </div>
        <p className="text-xs text-subtle">{physicalUsagePercent.toFixed(1)}% 已使用</p>
      </div>

      {/* Virtual allocation */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">虚拟分配</span>
          <span className="text-secondary-foreground">{formatBytes(stats.virtualAllocation)}</span>
        </div>
        <div className="w-full bg-muted rounded-full h-2">
          <div
            className={`h-2 rounded-full transition-all ${
              virtualAllocationPercent > 100 ? 'bg-danger-solid' : 'bg-primary'
            }`}
            style={{ width: `${Math.min(virtualAllocationPercent, 100)}%` }}
          />
        </div>
        <p className="text-xs text-subtle">{virtualAllocationPercent.toFixed(1)}% 已分配</p>
      </div>

      {/* Overprovision ratio */}
      <div
        className={`rounded-lg p-3 ${
          stats.overprovisionRatio > 1
            ? 'bg-danger-soft border border-danger/20'
            : 'bg-muted border border-input'
        }`}
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-secondary-foreground">超分配比率</span>
          <span
            className={`text-lg font-bold ${
              stats.overprovisionRatio > 1 ? 'text-danger' : 'text-success'
            }`}
          >
            {stats.overprovisionRatio.toFixed(2)}x
          </span>
        </div>
        <div className="flex items-center gap-1.5 mt-1">
          {stats.overprovisionRatio > 1 ? (
            <>
              <AlertTriangle className="w-3 h-3 text-danger" />
              <p className="text-xs text-danger">警告: 虚拟分配超过物理容量</p>
            </>
          ) : (
            <>
              <CheckCircle className="w-3 h-3 text-success" />
              <p className="text-xs text-success">正常: 虚拟分配在物理容量内</p>
            </>
          )}
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-muted rounded-lg p-2.5">
          <p className="text-xs text-subtle">可用物理</p>
          <p className="text-sm font-medium text-foreground mt-0.5">
            {formatBytes(Math.max(0, stats.physicalSize - stats.physicalUtilisation))}
          </p>
        </div>
        <div className="bg-muted rounded-lg p-2.5">
          <p className="text-xs text-subtle">潜在超额</p>
          <p className="text-sm font-medium text-foreground mt-0.5">
            {stats.virtualAllocation > stats.physicalSize
              ? formatBytes(stats.virtualAllocation - stats.physicalSize)
              : '无'}
          </p>
        </div>
      </div>
    </div>
  )
}
