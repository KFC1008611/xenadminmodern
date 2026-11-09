/**
 * ToastProvider — manages toast state and renders notifications via a React portal.
 * Supports success, error, and info types. Success/info auto-dismiss after 5 seconds.
 */
import { createContext, useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import ToastComponent, { ToastMessage } from './Toast'

const MAX_TOASTS = 5
const AUTO_DISMISS_MS = 5000

export interface ToastContextValue {
  addToast: (type: ToastMessage['type'], message: string) => void
}

export const ToastContext = createContext<ToastContextValue | null>(null)

interface ToastProviderProps {
  children: React.ReactNode
}

export function ToastProvider({ children }: ToastProviderProps) {
  const [toasts, setToasts] = useState<ToastMessage[]>([])
  // Track auto-dismiss timers so we can clean them up
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
    const timer = timers.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.current.delete(id)
    }
  }, [])

  const addToast = useCallback((type: ToastMessage['type'], message: string) => {
    const id = crypto.randomUUID()
    const newToast: ToastMessage = { id, type, message, createdAt: Date.now() }

    setToasts((prev) => {
      const updated = [...prev, newToast]
      // Keep at most MAX_TOASTS by removing the oldest when limit is exceeded
      if (updated.length > MAX_TOASTS) {
        const removed = updated.shift()
        if (removed) {
          const timer = timers.current.get(removed.id)
          if (timer) {
            clearTimeout(timer)
            timers.current.delete(removed.id)
          }
        }
      }
      return updated
    })

    // Auto-dismiss success and info toasts after 5 seconds; errors stay until manually dismissed
    if (type !== 'error') {
      const timer = setTimeout(() => dismiss(id), AUTO_DISMISS_MS)
      timers.current.set(id, timer)
    }
  }, [dismiss])

  // Clean up all timers on unmount
  useEffect(() => {
    return () => {
      timers.current.forEach((timer) => clearTimeout(timer))
    }
  }, [])

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      {createPortal(
        <div
          className="fixed bottom-4 right-4 flex flex-col gap-2 z-50"
          aria-live="polite"
          aria-atomic="false"
        >
          {toasts.map((toast) => (
            <ToastComponent key={toast.id} toast={toast} onDismiss={dismiss} />
          ))}
        </div>,
        document.body
      )}
    </ToastContext.Provider>
  )
}
