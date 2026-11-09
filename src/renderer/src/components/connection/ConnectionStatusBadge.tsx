/**
 * ConnectionStatusBadge — small badge showing a connection's state with color coding.
 */
import type { ConnectionInfo } from '../../types/xapi'

interface Props {
  state: ConnectionInfo['state']
  showLabel?: boolean
}

const STATE_CONFIG: Record<ConnectionInfo['state'], { dot: string; label: string }> = {
  connecting: {
    dot: 'bg-warning-solid animate-pulse',
    label: '连接中',
  },
  connected: {
    dot: 'bg-success-solid',
    label: '已连接',
  },
  disconnected: {
    dot: 'bg-subtle',
    label: '已断开',
  },
  error: {
    dot: 'bg-danger-solid',
    label: '错误',
  },
}

export function ConnectionStatusBadge({ state, showLabel = false }: Props) {
  const config = STATE_CONFIG[state] ?? STATE_CONFIG.disconnected

  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${config.dot}`} />
      {showLabel && (
        <span className="text-xs text-muted-foreground">{config.label}</span>
      )}
    </span>
  )
}
