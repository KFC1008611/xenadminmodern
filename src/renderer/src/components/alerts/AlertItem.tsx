/**
 * AlertItem — displays a single alert row with severity badge,
 * timestamp, message body, source pool, and dismiss action.
 */
import { X, AlertTriangle, AlertCircle, Info } from 'lucide-react'
import { cn } from '../../lib/utils'
import type { ConnectedAlertRecord } from '../../types/xapi'

interface AlertItemProps {
  alert: ConnectedAlertRecord
  onDismiss: (connectionId: string, alertRef: string) => void
}

const severityConfig = {
  error: {
    badge: 'bg-danger-soft text-danger border-danger/30',
    icon: AlertCircle,
    iconColor: 'text-danger',
    label: 'Error',
  },
  warning: {
    badge: 'bg-warning-soft text-warning border-warning/30',
    icon: AlertTriangle,
    iconColor: 'text-warning',
    label: 'Warning',
  },
  info: {
    badge: 'bg-accent text-accent-foreground border-primary/30',
    icon: Info,
    iconColor: 'text-accent-foreground',
    label: 'Info',
  },
} as const

/** Format a timestamp (ms epoch) into a relative or datetime string. */
function formatTimestamp(ts: number): string {
  const now = Date.now()
  const diff = now - ts

  if (diff < 60000) return 'just now'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`

  // Fall back to locale date string for older alerts
  return new Date(ts).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function AlertItem({ alert, onDismiss }: AlertItemProps) {
  const config = severityConfig[alert.severity]
  const SeverityIcon = config.icon

  return (
    <div className="bg-card border border-border rounded-xl p-4 hover:border-input transition-colors">
      <div className="flex items-start gap-3">
        {/* Severity icon */}
        <SeverityIcon className={cn('w-4 h-4 mt-0.5 flex-shrink-0', config.iconColor)} />

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {/* Severity badge */}
            <span
              className={cn(
                'inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full border',
                config.badge,
              )}
            >
              {config.label}
            </span>

            {/* Timestamp */}
            <span className="text-xs text-subtle">
              {formatTimestamp(alert.timestamp)}
            </span>

            {/* Source pool */}
            {alert.poolName && (
              <>
                <span className="text-subtle text-xs">·</span>
                <span className="text-xs text-subtle truncate max-w-[200px]">
                  {alert.poolName}
                </span>
              </>
            )}
          </div>

          {/* Alert name */}
          {alert.name && (
            <div className="text-sm text-foreground font-medium mb-0.5 truncate">
              {alert.name}
            </div>
          )}

          {/* Body / message */}
          {alert.body && (
            <p className="text-sm text-muted-foreground break-words line-clamp-3">
              {alert.body}
            </p>
          )}
        </div>

        {/* Dismiss button */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            onDismiss(alert.connectionId, alert.ref)
          }}
          className="flex-shrink-0 p-1 text-subtle hover:text-secondary-foreground hover:bg-muted rounded-lg transition-colors"
          title="Dismiss alert"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}
