/**
 * HaStatusBadge - Displays HA status indicator for a pool.
 * v9: New component for HA status display, using Tailwind CSS.
 */
import { Loader2 } from 'lucide-react'
import type { ConnectedHaConfiguration } from '../../types/xapi'

interface HaStatusBadgeProps {
  haConfig: ConnectedHaConfiguration | null
  loading?: boolean
  className?: string
}

export function HaStatusBadge({ haConfig, loading, className = '' }: HaStatusBadgeProps) {
  if (loading) {
    return (
      <span className={`text-xs px-2.5 py-1 bg-muted text-muted-foreground border border-input rounded-md ${className}`}>
        <Loader2 className="w-3 h-3 animate-spin inline mr-1" />
        加载中...
      </span>
    )
  }

  if (!haConfig) {
    return (
      <span className={`text-xs px-2.5 py-1 bg-muted text-muted-foreground border border-input rounded-md ${className}`}>
        HA 未知
      </span>
    )
  }

  if (!haConfig.enabled) {
    return (
      <span className={`text-xs px-2.5 py-1 bg-muted text-muted-foreground border border-input rounded-md ${className}`} title="此池未启用高可用性">
        HA 未启用
      </span>
    )
  }

  // Count failed hosts
  const failedHosts = haConfig.hosts.filter((h) => h.failed).length
  const totalHosts = haConfig.hosts.length
  const unknownHosts = haConfig.hosts.filter((h) => h.live === null).length
  const hasIssues = failedHosts > 0 || unknownHosts > 0

  const tooltipText = `主机: ${totalHosts - failedHosts - unknownHosts}/${totalHosts} 在线，${unknownHosts} 未知 | 可容忍故障: ${haConfig.plannedRepeats} 台 | 心跳SR: ${haConfig.heartbeatSRs.length}`

  return (
    <span
      className={`text-xs px-2.5 py-1 rounded-md border font-medium ${
        hasIssues
          ? 'bg-danger-soft text-danger border-danger/30'
          : 'bg-success-soft text-success border-success/30'
      } ${className}`}
      title={tooltipText}
    >
      {failedHosts > 0 ? 'HA 主机离线' : unknownHosts > 0 ? 'HA 状态不完整' : 'HA 已启用'}
    </span>
  )
}
