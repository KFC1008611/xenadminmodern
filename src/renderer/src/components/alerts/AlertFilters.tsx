/**
 * AlertFilters — severity toggle buttons, time range buttons,
 * and source connection dropdown. Reads and writes alert store filters.
 */
import { useMemo } from 'react'
import { useAlertStore } from '../../store/alert.store'
import { cn } from '../../lib/utils'
import { Filter } from 'lucide-react'

type Severity = 'error' | 'warning' | 'info'
type TimeRange = '1h' | '24h' | '7d' | 'all'

const severityOptions: { value: Severity; label: string; activeClass: string }[] = [
  { value: 'error', label: '错误', activeClass: 'bg-danger-soft text-danger border-danger/40' },
  { value: 'warning', label: '警告', activeClass: 'bg-warning-soft text-warning border-warning/40' },
  { value: 'info', label: '信息', activeClass: 'bg-accent text-accent-foreground border-primary/40' },
]

const timeRangeOptions: { value: TimeRange; label: string }[] = [
  { value: '1h', label: '1h' },
  { value: '24h', label: '24h' },
  { value: '7d', label: '7d' },
  { value: 'all', label: '全部' },
]

export default function AlertFilters() {
  const filters = useAlertStore((s) => s.filters)
  const alerts = useAlertStore((s) => s.alerts)
  const setFilters = useAlertStore((s) => s.setFilters)

  // Extract unique source connections from current alerts
  const sources = useMemo(() => {
    const map = new Map<string, string>()
    for (const alert of alerts) {
      if (!map.has(alert.connectionId)) {
        map.set(alert.connectionId, alert.poolName || alert.connectionId)
      }
    }
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]))
  }, [alerts])

  const activeSeverities = filters.severity ?? []

  const toggleSeverity = (sev: Severity) => {
    const current = activeSeverities
    if (current.includes(sev)) {
      const next = current.filter((s) => s !== sev)
      setFilters({ severity: next.length > 0 ? next : undefined })
    } else {
      setFilters({ severity: [...current, sev] })
    }
  }

  const setTimeRange = (range: TimeRange) => {
    setFilters({ timeRange: range })
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Filter icon label */}
      <div className="flex items-center gap-1.5 text-subtle text-xs">
        <Filter className="w-3.5 h-3.5" />
        <span>筛选:</span>
      </div>

      {/* Severity toggles */}
      <div className="flex items-center gap-1">
        {severityOptions.map(({ value, label, activeClass }) => {
          const isActive = activeSeverities.includes(value)
          return (
            <button
              key={value}
              onClick={() => toggleSeverity(value)}
              className={cn(
                'px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors',
                isActive
                  ? activeClass
                  : 'border-input text-subtle hover:text-secondary-foreground hover:border-input',
              )}
            >
              {label}
            </button>
          )
        })}
      </div>

      {/* Separator */}
      <div className="w-px h-5 bg-muted" />

      {/* Time range */}
      <div className="flex items-center gap-1">
        {timeRangeOptions.map(({ value, label }) => {
          const isActive = (filters.timeRange ?? 'all') === value
          return (
            <button
              key={value}
              onClick={() => setTimeRange(value)}
              className={cn(
                'px-2.5 py-1 text-xs font-medium rounded-lg transition-colors',
                isActive
                  ? 'bg-secondary text-foreground'
                  : 'text-subtle hover:text-secondary-foreground hover:bg-muted',
              )}
            >
              {label}
            </button>
          )
        })}
      </div>

      {/* Source dropdown (only if multiple connections) */}
      {sources.length > 1 && (
        <>
          <div className="w-px h-5 bg-muted" />
          <select
            value={filters.sourceConnectionId ?? ''}
            onChange={(e) =>
              setFilters({
                sourceConnectionId: e.target.value || undefined,
              })
            }
            className="bg-muted border border-input text-sm text-secondary-foreground rounded-lg px-2.5 py-1 focus:outline-none focus:border-primary/30 transition-colors"
          >
            <option value="">全部来源</option>
            {sources.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </>
      )}
    </div>
  )
}
