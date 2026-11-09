/**
 * HaVmPriorityList - List of VMs with their HA restart priorities.
 * Allows inline priority editing.
 * v9: New component for VM HA priority management, using Tailwind CSS.
 */
import { useState, useEffect } from 'react'
import { Heart, RefreshCw } from 'lucide-react'
import type { HaVmConfig, HaRestartPriority } from '../../types/xapi'
import { getAuditedFeatureBlockReason } from '../../../../shared/audited-features'

interface HaVmPriorityListProps {
  connectionId: string
  vms: HaVmConfig[]
  loading?: boolean
  onRefresh?: () => void
}

const PRIORITY_LABELS: Record<HaRestartPriority, string> = {
  '': '不重启', 'best-effort': '尽力重启', restart: '按 HA 计划重启',
}
const PRIORITY_COLORS: Record<HaRestartPriority, string> = {
  '': 'bg-subtle', 'best-effort': 'bg-warning-solid', restart: 'bg-primary',
}
const POLICIES: HaRestartPriority[] = ['', 'best-effort', 'restart']

export function HaVmPriorityList({ vms, loading, onRefresh }: HaVmPriorityListProps) {
  const [localConfigs, setLocalConfigs] = useState<HaVmConfig[]>([])
  const guardReason = getAuditedFeatureBlockReason('ha.governance')

  useEffect(() => {
    setLocalConfigs(vms)
  }, [vms])

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
        <div className="w-5 h-5 border-2 border-input border-t-primary rounded-full animate-spin" />
        <span className="text-sm">加载中...</span>
      </div>
    )
  }

  if (!vms.length) {
    return (
      <div className="bg-card border border-border rounded-xl p-8 text-center">
        <Heart className="w-8 h-8 text-subtle mx-auto mb-3" />
        <p className="text-muted-foreground text-sm">没有可管理的 VM</p>
      </div>
    )
  }

  // Sort by priority descending, then by name
  const sortedVms = [...localConfigs].sort((a, b) => {
    if (b.restartPriority !== a.restartPriority) {
      return POLICIES.indexOf(b.restartPriority) - POLICIES.indexOf(a.restartPriority)
    }
    return a.vmName.localeCompare(b.vmName)
  })

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-foreground">VM HA 重启策略</h4>
        {onRefresh && (
          <button
            onClick={onRefresh}
            className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
            title="刷新"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Table header */}
      <div className="grid grid-cols-12 gap-4 text-xs text-subtle px-3">
        <div className="col-span-5">虚拟机</div>
        <div className="col-span-3">重启策略</div>
        <div className="col-span-3">旧版始终运行</div>
        <div className="col-span-1"></div>
      </div>

      {/* VM list */}
      <div className="space-y-1">
        {sortedVms.map((vm) => (
          <div
            key={vm.vmRef}
            className="grid grid-cols-12 gap-4 items-center bg-card border border-border rounded-lg p-3 hover:border-input transition-colors"
          >
            {/* VM name */}
            <div className="col-span-5 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{vm.vmName}</p>
              <p className="text-xs text-subtle truncate">{vm.vmRef}</p>
            </div>

            {/* Priority selector */}
            <div className="col-span-3">
              <select
                disabled
                title={guardReason}
                value={vm.restartPriority}
                className="w-full px-2 py-1.5 text-xs bg-muted border border-input rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {POLICIES.map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABELS[p]}
                  </option>
                ))}
              </select>
            </div>

            {/* Always run toggle */}
            <div className="col-span-3 flex items-center gap-2">
              <button
                disabled
                title={guardReason}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                  vm.alwaysRun ? 'bg-primary' : 'bg-secondary'
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                    vm.alwaysRun ? 'translate-x-4.5' : 'translate-x-0.5'
                  }`}
                />
              </button>
              <span className="text-xs text-muted-foreground">{vm.alwaysRun ? '是' : '否'}</span>
            </div>

            {/* Priority badge */}
            <div className="col-span-1 flex justify-center">
              <span
                className={`inline-block w-2.5 h-2.5 rounded-full ${PRIORITY_COLORS[vm.restartPriority]}`}
                title={`策略: ${PRIORITY_LABELS[vm.restartPriority]}`}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="pt-3 border-t border-border flex gap-4 text-xs text-subtle">
        <span>策略:</span>
        {POLICIES.map((p) => (
          <span key={p} className="flex items-center gap-1">
            <span className={`inline-block w-2 h-2 rounded-full ${PRIORITY_COLORS[p]}`} />
            {PRIORITY_LABELS[p]}
          </span>
        ))}
      </div>
    </div>
  )
}
