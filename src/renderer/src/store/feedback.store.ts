/**
 * ActionFeedback — unified operation feedback system.
 *
 * Provides 4 levels of feedback to replace the inconsistent mix of
 * inline text, dialogs, progress panels, and no-feedback patterns:
 *
 * Level 1 — Micro:  toast notifications (auto-dismiss, non-blocking)
 * Level 2 — Light:  inline status badges (spinner → check/error)
 * Level 3 — Medium: progress bar for multi-step operations
 * Level 4 — Heavy:  full-screen dialog for destructive/long operations
 *
 * Usage:
 *   import { feedback } from '../store/feedback.store'
 *   feedback.toast('操作成功', 'success')
 *   feedback.progress('import-1', '正在导入...', 50)
 *   feedback.confirm({ title: '确认删除', message: '...', onConfirm: () => {} })
 */

import { create } from 'zustand'

// ============================================================================
// Types
// ============================================================================

export type ToastType = 'success' | 'error' | 'warning' | 'info'
export type ConfirmVariant = 'danger' | 'warning' | 'default'

export interface ToastMessage {
  id: string
  message: string
  type: ToastType
  createdAt: Date
}

export interface ProgressEntry {
  id: string
  label: string
  progress: number // 0-100, -1 = indeterminate
  status: 'pending' | 'running' | 'completed' | 'failed' | 'unknown'
  error?: string
}


export interface ConfirmOptions {
  title: string
  message: string
  variant?: ConfirmVariant
  confirmLabel?: string
  cancelLabel?: string
  onConfirm: () => void | Promise<void>
  onCancel?: () => void
}

interface FeedbackState {
  toasts: ToastMessage[]
  progress: ProgressEntry[]
  confirmDialog: (ConfirmOptions & { id: string }) | null

  // Actions
  toast: (message: string, type?: ToastType, durationMs?: number) => void
  dismissToast: (id: string) => void

  startProgress: (id: string, label: string, progress?: number) => void
  updateProgress: (id: string, progress: number) => void
  completeProgress: (id: string) => void
  failProgress: (id: string, error: string) => void
  unknownProgress: (id: string, error: string) => void
  removeProgress: (id: string) => void

  confirm: (options: ConfirmOptions) => void
  resolveConfirm: (confirmed: boolean) => void
}

// ============================================================================
// Store
// ============================================================================

let toastCounter = 0
let confirmCounter = 0

export const useFeedbackStore = create<FeedbackState>((set, get) => ({
  toasts: [],
  progress: [],
  confirmDialog: null,

  // Level 1 — Toast (micro feedback)
  toast: (message, type = 'info', durationMs = 4000) => {
    const id = `toast-${++toastCounter}`
    const entry: ToastMessage = { id, message, type, createdAt: new Date() }
    set((s) => ({ toasts: [...s.toasts, entry] }))

    // Auto-dismiss
    if (durationMs > 0) {
      setTimeout(() => get().dismissToast(id), durationMs)
    }
  },

  dismissToast: (id) => {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
  },

  // Level 3 — Progress (medium feedback)
  startProgress: (id, label, progress = -1) => {
    const entry: ProgressEntry = { id, label, progress, status: 'running' }
    set((s) => ({
      progress: [...s.progress.filter((p) => p.id !== id), entry],
    }))
  },

  updateProgress: (id, progress) => {
    set((s) => ({
      progress: s.progress.map((p) =>
        p.id === id ? { ...p, progress, status: 'running' as const } : p,
      ),
    }))
  },

  completeProgress: (id) => {
    const entry = get().progress.find((p) => p.id === id)
    if (!entry) return
    const completed: ProgressEntry = { ...entry, progress: 100, status: 'completed' }
    set((s) => ({
      progress: s.progress.map((p) => p === entry ? completed : p),
    }))
  },

  failProgress: (id, error) => {
    set((s) => ({
      progress: s.progress.map((p) =>
        p.id === id ? { ...p, status: 'failed' as const, error } : p,
      ),
    }))
  },

  unknownProgress: (id, error) => {
    set((s) => ({ progress: s.progress.map((p) => p.id === id ? { ...p, status: 'unknown' as const, error } : p) }))
  },

  removeProgress: (id) => {
    set((s) => ({ progress: s.progress.filter((p) => p.id !== id || p.status === 'running' || p.status === 'pending') }))
  },

  // Level 4 — Confirm dialog (heavy feedback)
  confirm: (options) => {
    const id = `confirm-${++confirmCounter}`
    const previous = get().confirmDialog
    set({ confirmDialog: { ...options, id } })
    // Replacing a pending confirmation cancels its caller; it must not leave
    // executeConfirm awaiting a dialog that the user can no longer answer.
    previous?.onCancel?.()
  },

  resolveConfirm: (confirmed) => {
    const dialog = get().confirmDialog
    if (!dialog) return

    set({ confirmDialog: null })

    if (confirmed) {
      dialog.onConfirm()
    } else {
      dialog.onCancel?.()
    }
  },
}))

// ============================================================================
// Convenience singleton (for use outside React components)
// ============================================================================

export const feedback = {
  unknownProgress: (id: string, error: string) => useFeedbackStore.getState().unknownProgress(id, error),
  toast: (message: string, type: ToastType = 'info', durationMs?: number) =>
    useFeedbackStore.getState().toast(message, type, durationMs),
  success: (message: string) =>
    useFeedbackStore.getState().toast(message, 'success'),
  error: (message: string) =>
    useFeedbackStore.getState().toast(message, 'error', 8000),
  warning: (message: string) =>
    useFeedbackStore.getState().toast(message, 'warning', 6000),
  info: (message: string) =>
    useFeedbackStore.getState().toast(message, 'info'),

  startProgress: (id: string, label: string, progress?: number) =>
    useFeedbackStore.getState().startProgress(id, label, progress),
  updateProgress: (id: string, progress: number) =>
    useFeedbackStore.getState().updateProgress(id, progress),
  completeProgress: (id: string) =>
    useFeedbackStore.getState().completeProgress(id),
  failProgress: (id: string, error: string) =>
    useFeedbackStore.getState().failProgress(id, error),

  confirm: (options: ConfirmOptions) =>
    useFeedbackStore.getState().confirm(options),
}
