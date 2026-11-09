/**
 * BulkActionBar — shows count of visible alerts and provides
 * a "Dismiss All" action with confirmation step.
 */
import { useState } from 'react'
import { useAlertStore } from '../../store/alert.store'
import { Trash2, AlertTriangle } from 'lucide-react'
import { cn } from '../../lib/utils'

export default function BulkActionBar() {
  const alerts = useAlertStore((s) => s.alerts)
  const loading = useAlertStore((s) => s.loading)
  const dismissAll = useAlertStore((s) => s.dismissAll)
  const filters = useAlertStore((s) => s.filters)
  const [confirming, setConfirming] = useState(false)
  const [dismissing, setDismissing] = useState(false)

  const handleDismissAll = async () => {
    setDismissing(true)
    try {
      await dismissAll(filters.sourceConnectionId)
    } finally {
      setDismissing(false)
      setConfirming(false)
    }
  }

  if (alerts.length === 0 && !loading) return null

  return (
    <div className="sticky bottom-0 bg-card backdrop-blur border-t border-border rounded-b-xl px-4 py-3 flex items-center justify-between">
      {/* Alert count */}
      <span className="text-sm text-muted-foreground">
        {alerts.length} alert{alerts.length !== 1 ? 's' : ''}
      </span>

      {/* Dismiss action */}
      {confirming ? (
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5 text-warning" />
          <span className="text-xs text-warning">Dismiss all alerts?</span>
          <button
            onClick={handleDismissAll}
            disabled={dismissing}
            className={cn(
              'px-3 py-1 text-xs font-medium rounded-lg transition-colors',
              'bg-danger-soft text-danger border border-danger/30 hover:bg-danger-soft',
              dismissing && 'opacity-50 cursor-not-allowed',
            )}
          >
            {dismissing ? 'Dismissing...' : 'Confirm'}
          </button>
          <button
            onClick={() => setConfirming(false)}
            disabled={dismissing}
            className="px-3 py-1 text-xs text-muted-foreground hover:text-foreground rounded-lg transition-colors"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={() => setConfirming(true)}
          disabled={loading || alerts.length === 0}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors',
            'text-muted-foreground hover:text-danger hover:bg-danger-soft',
            (loading || alerts.length === 0) && 'opacity-50 cursor-not-allowed',
          )}
        >
          <Trash2 className="w-3.5 h-3.5" />
          Dismiss All
        </button>
      )}
    </div>
  )
}
