/**
 * useToast — React hook providing convenience wrappers around ToastContext.addToast.
 * Must be used within a ToastProvider tree.
 */
import { useContext } from 'react'
import { ToastContext } from './ToastProvider'

export function useToast(): {
  success: (message: string) => void
  error: (message: string) => void
  info: (message: string) => void
} {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider')
  }

  return {
    success: (message: string) => ctx.addToast('success', message),
    error: (message: string) => ctx.addToast('error', message),
    info: (message: string) => ctx.addToast('info', message),
  }
}
