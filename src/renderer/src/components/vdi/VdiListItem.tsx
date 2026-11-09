/**
 * VdiListItem — List item component for displaying VDI information
 * v6: VDI item with size info, usage bar, and action buttons
 */
import { ArrowRightLeft, HardDrive, Maximize2, Plug, Unplug, Trash2, Power, Lock, Link2Off } from 'lucide-react'
import type { VdiRecord } from '../../types/xapi'
import { formatBytes } from '../../lib/utils'

interface VdiWithVbd extends VdiRecord {
  vbdRef: string
  userdevice: string
  bootable: boolean
  mode: string
  currently_attached: boolean
  unpluggable: boolean
  allowed_operations?: string[]
}

interface VdiListItemProps {
  vdi: VdiWithVbd
  powerState: string
  disabled?: boolean
  onResize: () => void
  onMove: () => void
  onToggleAttached: () => void
  onDetach: () => void
  onRemove: () => void
}

export function VdiListItem({
  vdi,
  powerState,
  disabled = false,
  onResize,
  onMove,
  onToggleAttached,
  onDetach,
  onRemove,
}: VdiListItemProps) {
  const isRunning = powerState === 'Running'
  const allowedOperations = vdi.allowed_operations || []
  const allowsOperation = (operation: string) =>
    allowedOperations.length === 0 || allowedOperations.includes(operation)
  const toggleOperation = vdi.currently_attached ? 'unplug' : 'plug'
  const canToggleAttached =
    isRunning &&
    allowsOperation(toggleOperation) &&
    (!vdi.currently_attached || vdi.unpluggable)
  const canDetach = !vdi.currently_attached
  const canRemove = powerState === 'Halted' && !vdi.currently_attached

  // Calculate usage percentage
  const virtualSize = vdi.virtual_size || 0
  const physicalUsage = vdi.physical_utilisation || 0
  const usagePercent = virtualSize > 0 ? Math.min((physicalUsage / virtualSize) * 100, 100) : 0

  // Determine usage bar color
  const getUsageColor = (percent: number) => {
    if (percent >= 90) return 'bg-danger-solid'
    if (percent >= 70) return 'bg-warning-solid'
    return 'bg-primary'
  }

  // Mode display
  const modeDisplay = vdi.mode || (vdi.read_only ? 'RO' : 'RW')
  const modeColor = modeDisplay === 'RO' ? 'text-warning' : 'text-success'

  return (
    <div className="flex items-center gap-4 p-4 bg-card border border-border rounded-xl hover:border-input transition-colors group">
      {/* Icon */}
      <div className="flex-shrink-0 p-2.5 bg-muted rounded-lg">
        <HardDrive className="w-5 h-5 text-muted-foreground" />
      </div>

      {/* Main Info */}
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <h4 className="text-sm font-medium text-foreground truncate">
            {vdi.name_label || '未命名磁盘'}
          </h4>
          {vdi.bootable && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 bg-accent rounded text-xs text-accent-foreground">
              <Power className="w-3 h-3" />
              启动盘
            </span>
          )}
          {vdi.read_only && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 bg-warning-soft rounded text-xs text-warning">
              <Lock className="w-3 h-3" />
              只读
            </span>
          )}
          <span
            className={`px-1.5 py-0.5 rounded text-xs ${
              vdi.currently_attached
                ? 'bg-success-soft text-success'
                : 'bg-secondary text-secondary-foreground'
            }`}
          >
            {vdi.currently_attached ? '已激活' : '未激活'}
          </span>
        </div>

        {/* Device and Size Info */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="text-subtle">设备:</span>
            <span className="text-secondary-foreground font-mono">{vdi.userdevice || '--'}</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="text-subtle">模式:</span>
            <span className={modeColor}>{modeDisplay}</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="text-subtle">大小:</span>
            <span className="text-secondary-foreground">{formatBytes(virtualSize)}</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="text-subtle">已用:</span>
            <span className="text-secondary-foreground">{formatBytes(physicalUsage)}</span>
          </span>
        </div>

        {/* Usage Progress Bar */}
        <div className="mt-2 flex items-center gap-2">
          <div className="flex-1 bg-muted rounded-full h-1.5 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${getUsageColor(usagePercent)}`}
              style={{ width: `${usagePercent}%` }}
            />
          </div>
          <span className="text-xs text-subtle w-10 text-right">
            {usagePercent.toFixed(0)}%
          </span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1">
        <button
          onClick={onResize}
          disabled={disabled}
          className="p-2 text-muted-foreground hover:text-accent-foreground hover:bg-muted rounded-lg transition-colors"
          title="扩容磁盘"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
        <button
          onClick={onMove}
          disabled={disabled}
          className="p-2 text-muted-foreground hover:text-info hover:bg-muted rounded-lg transition-colors"
          title="移动到 SR"
        >
          <ArrowRightLeft className="w-4 h-4" />
        </button>
        <button
          onClick={onToggleAttached}
          disabled={disabled || !canToggleAttached}
          className={`p-2 rounded-lg transition-colors ${
            canToggleAttached
              ? 'text-muted-foreground hover:text-warning hover:bg-muted'
              : 'text-subtle cursor-not-allowed'
          }`}
          title={
            canToggleAttached
              ? (vdi.currently_attached ? '停用磁盘' : '激活磁盘')
              : '只有运行中的 VM 支持磁盘激活/停用'
          }
        >
          {vdi.currently_attached ? <Unplug className="w-4 h-4" /> : <Plug className="w-4 h-4" />}
        </button>
        <button
          onClick={onDetach}
          disabled={disabled || !canDetach}
          className={`p-2 rounded-lg transition-colors ${
            canDetach
              ? 'text-muted-foreground hover:text-warning hover:bg-muted'
              : 'text-subtle cursor-not-allowed'
          }`}
          title={canDetach ? '分离磁盘连接' : '请先停用磁盘后再分离'}
        >
          <Link2Off className="w-4 h-4" />
        </button>
        <button
          onClick={onRemove}
          disabled={disabled || !canRemove}
          aria-label="删除磁盘"
          className={`p-2 rounded-lg transition-colors ${
            canRemove
              ? 'text-muted-foreground hover:text-danger hover:bg-muted'
              : 'text-subtle cursor-not-allowed'
          }`}
          title={canRemove ? '删除磁盘' : '只有已停止且未激活的磁盘可以删除'}
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
