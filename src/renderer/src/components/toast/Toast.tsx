/**
 * Toast component — renders a single notification message with colored border and dismiss button.
 */
import { X } from 'lucide-react'

export interface ToastMessage {
  id: string
  type: 'success' | 'error' | 'info'
  message: string
  createdAt: number
}

interface ToastProps {
  toast: ToastMessage
  onDismiss: (id: string) => void
}

const BORDER_COLORS: Record<ToastMessage['type'], string> = {
  success: 'border-l-success',
  error: 'border-l-danger',
  info: 'border-l-primary',
}

const TEXT_COLORS: Record<ToastMessage['type'], string> = {
  success: 'text-success',
  error: 'text-danger',
  info: 'text-accent-foreground',
}

export default function Toast({ toast, onDismiss }: ToastProps) {
  // role="alert" for errors draws immediate attention; role="status" for non-urgent notifications
  const role = toast.type === 'error' ? 'alert' : 'status'

  return (
    <div
      role={role}
      className={`flex items-start gap-3 bg-muted border border-input border-l-4 ${BORDER_COLORS[toast.type]} rounded-lg px-4 py-3 shadow-lg min-w-72 max-w-sm`}
    >
      <p className={`flex-1 text-sm ${TEXT_COLORS[toast.type]}`}>{toast.message}</p>
      <button
        onClick={() => onDismiss(toast.id)}
        className="text-muted-foreground hover:text-foreground transition-colors mt-0.5 flex-shrink-0"
        aria-label="Dismiss notification"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}
