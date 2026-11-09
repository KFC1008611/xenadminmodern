/**
 * AlertBadge — navigation badge showing unread alert count with
 * severity-based coloring. Clickable to navigate to /alerts.
 */
import { useNavigate } from 'react-router-dom'
import { Bell } from 'lucide-react'
import { useAlertStore } from '../../store/alert.store'
import { cn } from '../../lib/utils'

interface AlertBadgeProps {
  compact?: boolean
}

export default function AlertBadge({ compact = false }: AlertBadgeProps) {
  const navigate = useNavigate()
  const unreadCount = useAlertStore((s) => s.unreadCount)
  const errorCount = useAlertStore((s) => s.errorCount)
  const warningCount = useAlertStore((s) => s.warningCount)

  // Determine badge color based on highest severity present
  const badgeColor = (() => {
    if (errorCount > 0) return 'bg-danger-solid'
    if (warningCount > 0) return 'bg-warning-solid'
    return 'bg-subtle'
  })()

  const label = `${unreadCount} unread alert${unreadCount !== 1 ? 's' : ''}`

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    navigate('/alerts')
  }

  if (compact) {
    if (unreadCount === 0) return null
    return (
      <span
        aria-hidden="true"
        className={cn(
          'absolute right-1 top-1 min-w-[12px] h-3 flex items-center justify-center',
          'rounded-full px-0.5 text-[11px] font-bold leading-none text-on-solid',
          badgeColor,
        )}
        title={label}
      >
        {unreadCount > 99 ? '99+' : unreadCount}
      </span>
    )
  }

  return (
    <button
      onClick={handleClick}
      className="relative inline-flex items-center justify-center flex-shrink-0"
      title={label}
    >
      <Bell className="w-4 h-4 text-muted-foreground" />
      {unreadCount > 0 && (
        <span
          className={cn(
            'absolute -top-1.5 -right-2 min-w-[16px] h-4 flex items-center justify-center',
            'text-[11px] font-bold text-on-solid rounded-full px-1',
            badgeColor,
          )}
        >
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </button>
  )
}
