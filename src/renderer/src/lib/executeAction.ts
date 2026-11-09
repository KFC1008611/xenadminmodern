/**
 * executeAction — unified operation executor with feedback integration.
 *
 * Replaces the repetitive try/catch + useState(loading) + toast pattern
 * found in every page component. Provides consistent:
 * - Loading state management via feedback.progress
 * - Success/error feedback via feedback toast
 * - Optional refresh after success
 *
 * Usage:
 *   // Simple action (just toast feedback)
 *   await executeAction({
 *     label: '启动 VM',
 *     action: () => window.xapi.vm.start(connId, vmRef),
 *     onSuccess: () => refreshVms(),
 *   })
 *
 *   // Action with progress tracking
 *   await executeAction({
 *     label: '导入虚拟机',
 *     action: () => window.xapi.vm.import(...),
 *     trackProgress: true,
 *     onSuccess: () => refreshVms(),
 *   })
 */

import { feedback } from '../store/feedback.store'

export interface ActionOptions {
  /** Human-readable label for the operation (shown in progress/toast) */
  label: string
  /** The async operation to execute */
  action: () => Promise<void>
  /** Called after successful execution (e.g., refresh data) */
  onSuccess?: () => void | Promise<void>
  /** Called if the operation fails. Defaults to feedback.error(). */
  onError?: (error: Error) => void
  /** If true, show progress indicator during the operation */
  trackProgress?: boolean
  /** Optional unique ID for progress tracking (defaults to auto-generated) */
  progressId?: string
  /** Context info appended to success message (e.g., pool name) */
  context?: string
}

let actionCounter = 0

/**
 * Execute an async operation with unified feedback.
 *
 * Returns true if the operation succeeded, false otherwise.
 */
export async function executeAction({
  label,
  action,
  onSuccess,
  onError,
  trackProgress = false,
  progressId,
  context,
}: ActionOptions): Promise<boolean> {
  const id = progressId || `action-${++actionCounter}`
  const contextSuffix = context ? ` (${context})` : ''
  if (trackProgress) {
    feedback.startProgress(id, `${label}${contextSuffix}`, -1)
  }

  try {
    await action()
  } catch (e: any) {
    const errorMessage = e?.message || e?.faultString || String(e)

    const unknown = /OUTCOME_UNKNOWN/.test(e?.code ?? '')
    const readFailed = e?.code === 'RESOURCE_RESULT_READ_FAILED'
    if (trackProgress) {
      if (unknown || readFailed) feedback.unknownProgress(id, errorMessage)
      else feedback.failProgress(id, errorMessage)
    }

    if (onError) {
      onError(e instanceof Error ? e : new Error(errorMessage))
    } else {
      if (readFailed) feedback.warning(errorMessage)
      else if (unknown) feedback.warning(`${label}${contextSuffix}状态读取失败：${errorMessage}`)
      else feedback.error(`${label}${contextSuffix}失败：${errorMessage}`)
    }

    return false
  }

  if (trackProgress) feedback.completeProgress(id)

  // The mutation has completed. A failed read or UI callback must not turn it
  // into a failed operation and invite the user to submit the mutation again.
  try {
    await onSuccess?.()
  } catch (e: any) {
    feedback.warning(`${label}${contextSuffix}已完成，但后续刷新失败：${e?.message || e?.faultString || String(e)}。请重新读取状态，勿重复提交操作。`)
    return true
  }

  // A tracked action already has a completed result card; avoid stacking the
  // same success over the next operation's controls in another screen corner.
  if (!trackProgress) feedback.success(`${label}${contextSuffix}成功`)
  return true
}

/**
 * executeConfirm — show a confirmation dialog before executing an action.
 *
 * Usage:
 *   await executeConfirm({
 *     title: '确认删除',
 *     message: '此操作不可撤销',
 *     variant: 'danger',
 *     label: '删除网络',
 *     action: () => window.xapi.network.destroy(connId, ref),
 *     onSuccess: () => refreshNetworks(),
 *   })
 */
export async function executeConfirm({
  title,
  message,
  variant = 'default',
  confirmLabel,
  cancelLabel,
  ...actionOptions
}: ActionOptions & {
  title: string
  message: string
  variant?: 'danger' | 'warning' | 'default'
  confirmLabel?: string
  cancelLabel?: string
}): Promise<boolean> {
  return new Promise((resolve) => {
    feedback.confirm({
      title,
      message,
      variant,
      confirmLabel,
      cancelLabel,
      onConfirm: async () => {
        const result = await executeAction(actionOptions)
        resolve(result)
      },
      onCancel: () => {
        resolve(false)
      },
    })
  })
}
