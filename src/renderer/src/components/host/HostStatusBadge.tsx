/**
 * HostStatusBadge — colored dot + label indicating host operational state.
 */
import { cn } from '../../lib/utils'

interface HostStatusBadgeProps {
  enabled: boolean
  /** When true, renders a smaller dot without text (for inline use). */
  small?: boolean
  /** Optional maintenance/disabled override from getMaintenanceStatus. */
  maintenanceState?: 'enabled' | 'disabled' | 'maintenance'
}

function getStatus(
  enabled: boolean,
  maintenanceState?: 'enabled' | 'disabled' | 'maintenance'
): { color: string; label: string } {
  if (maintenanceState === 'maintenance' || maintenanceState === 'disabled' || !enabled) {
    return { color: 'bg-warning-solid', label: '维护中' }
  }
  if (enabled) {
    return { color: 'bg-success-solid', label: '在线' }
  }
  return { color: 'bg-subtle', label: '离线' }
}

export function HostStatusBadge({ enabled, small, maintenanceState }: HostStatusBadgeProps) {
  const { color, label } = getStatus(enabled, maintenanceState)

  if (small) {
    return (
      <span
        className={cn('inline-block rounded-full', color, small ? 'w-2 h-2' : 'w-2.5 h-2.5')}
        title={label}
      />
    )
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn('inline-block rounded-full w-2.5 h-2.5', color)} />
      <span className="text-xs text-secondary-foreground">{label}</span>
    </span>
  )
}
