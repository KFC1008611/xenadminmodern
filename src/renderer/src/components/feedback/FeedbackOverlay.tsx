/**
 * FeedbackOverlay — renders toast notifications and confirm dialogs
 * from the unified feedback store.
 *
 * Place this component once at the app root (inside AppShell).
 */
import { useFeedbackStore } from '../../store/feedback.store'
import { X, CheckCircle2, AlertCircle, AlertTriangle, Info } from 'lucide-react'
import { DesktopDialog } from '../layout/DesktopDialog'

const TOAST_ICONS = {
  success: CheckCircle2,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
}

const TOAST_COLORS = {
  success: 'bg-success-soft border-success/60 text-success',
  error: 'bg-danger-soft border-danger/60 text-danger',
  warning: 'bg-warning-soft border-warning/60 text-warning',
  info: 'bg-accent border-primary/60 text-accent-foreground',
}

const TOAST_ICON_COLORS = {
  success: 'text-success',
  error: 'text-danger',
  warning: 'text-warning',
  info: 'text-accent-foreground',
}

export function FeedbackOverlay() {
  const { toasts, confirmDialog, dismissToast, resolveConfirm } = useFeedbackStore()

  return (
    <>
      {/* Toast container — top-right corner */}
      {toasts.length > 0 && (
        <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
          {toasts.map((toast) => {
            const Icon = TOAST_ICONS[toast.type]
            return (
              <div
                key={toast.id}
                role={toast.type === 'error' ? 'alert' : 'status'}
                className={`flex items-start gap-3 px-4 py-3 rounded-xl border shadow-lg backdrop-blur-sm animate-in slide-in-from-right ${TOAST_COLORS[toast.type]}`}
              >
                <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${TOAST_ICON_COLORS[toast.type]}`} />
                <p className="min-w-0 break-words text-sm flex-1">{toast.message}</p>
                <button
                  onClick={() => dismissToast(toast.id)}
                  aria-label="关闭通知"
                  className="flex-shrink-0 opacity-50 hover:opacity-100 transition-opacity"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* Confirm dialog — centered modal */}
      {confirmDialog && (
        <DesktopDialog title={confirmDialog.title} onClose={() => resolveConfirm(false)} className="max-w-md">
          <div className="bg-card border border-input rounded-xl p-6 shadow-2xl">
            <h3 className="text-lg font-semibold text-foreground mb-2">{confirmDialog.title}</h3>
            <p className="break-words whitespace-pre-wrap text-sm text-muted-foreground mb-6">{confirmDialog.message}</p>
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => resolveConfirm(false)}
                className="px-4 py-2 text-sm text-secondary-foreground hover:text-foreground bg-muted hover:bg-secondary rounded-lg transition-colors"
              >
                {confirmDialog.cancelLabel || '取消'}
              </button>
              <button
                onClick={() => resolveConfirm(true)}
                className={`px-4 py-2 text-sm rounded-lg transition-colors ${
                  confirmDialog.variant === 'danger'
                    ? 'bg-danger-solid text-on-solid hover:bg-danger-solid'
                    : confirmDialog.variant === 'warning'
                      ? 'bg-warning-solid text-on-solid hover:bg-warning-solid'
                      : 'bg-primary text-primary-foreground hover:bg-primary-hover'
                }`}
              >
                {confirmDialog.confirmLabel || '确认'}
              </button>
            </div>
          </div>
        </DesktopDialog>
      )}
    </>
  )
}
