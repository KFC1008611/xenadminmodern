import type { VmTransferMetrics } from '../../../../shared/types/xapi'
import { formatBytes } from '../../lib/utils'

interface TransferProgressProps {
  label: string
  message: string
  progress: number
  metrics?: VmTransferMetrics
  bytesLabel?: string
  warning?: boolean
}

export function TransferProgress({ label, message, progress, metrics, bytesLabel = '已传输', warning = false }: TransferProgressProps) {
  const value = metrics && metrics.bytesTotal > 0 ? metrics.bytesTransferred / metrics.bytesTotal * 100 : progress
  const percentage = value >= 0 ? Math.max(0, Math.min(100, Math.floor(value))) : undefined
  const seconds = Math.floor((metrics?.elapsedMs ?? 0) / 1000)
  const elapsed = seconds < 60 ? `${seconds} 秒` : seconds < 3600 ? `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒` : `${Math.floor(seconds / 3600)} 小时 ${Math.floor(seconds % 3600 / 60)} 分`
  return <div className="space-y-2">
    <div className={`flex flex-wrap justify-between gap-x-3 text-sm ${warning ? 'text-warning' : 'text-muted-foreground'}`}>
      <span className="min-w-0 break-words">{message}</span>{percentage !== undefined && <span className="tabular-nums">{percentage}%</span>}
    </div>
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentage} className="h-2 overflow-hidden rounded bg-border">
      <div className={`h-2 rounded bg-primary ${percentage === undefined ? 'progress-indeterminate' : ''}`} style={{ width: percentage === undefined ? undefined : `${percentage}%` }} />
    </div>
    {metrics && <div className="space-y-1 break-words text-xs text-muted-foreground tabular-nums">
      <p>{bytesLabel} {formatBytes(metrics.bytesTransferred)}{metrics.bytesTotal > 0 ? ` / ${formatBytes(metrics.bytesTotal)}` : ' · 总大小未知'} · 已用 {elapsed}</p>
      {metrics.elapsedMs > 0 && <p>平均速度 {formatBytes(metrics.bytesTransferred / metrics.elapsedMs * 1000)}/s</p>}
    </div>}
  </div>
}
