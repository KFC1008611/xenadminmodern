/**
 * SrActions — action buttons for an SR: Scan, Set as Default, Detach, Destroy.
 * Destructive actions (Detach, Destroy) require confirmation.
 */
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { RefreshCw, Star, Unplug, Trash2, Loader2, AlertTriangle } from 'lucide-react'
import type { ConnectedSrRecord } from '../../types/xapi'
import { cn } from '../../lib/utils'
import { getAuditedFeatureBlockReason } from '../../../../shared/audited-features'

const lifecycleBlockedReason = getAuditedFeatureBlockReason('storage.lifecycle')

interface SrActionsProps {
  sr: ConnectedSrRecord
  connectionId: string
  poolRef?: string
  isDefault?: boolean
  disabled?: boolean
  onActionComplete: () => void | Promise<void>
}

type ActionType = 'scan' | 'setDefault' | 'detach' | 'destroy'
type ConfirmPosition = { top: number; left: number }

const CONFIRM_WIDTH = 256
const CONFIRM_ESTIMATED_HEIGHT = 164
const CONFIRM_MARGIN = 8

function getConfirmPosition(rect: DOMRect): ConfirmPosition {
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const left = Math.max(
    CONFIRM_MARGIN,
    Math.min(rect.right - CONFIRM_WIDTH, viewportWidth - CONFIRM_WIDTH - CONFIRM_MARGIN),
  )
  const belowTop = rect.bottom + 6
  const aboveTop = rect.top - CONFIRM_ESTIMATED_HEIGHT - 6
  const top = belowTop + CONFIRM_ESTIMATED_HEIGHT <= viewportHeight - CONFIRM_MARGIN
    ? belowTop
    : Math.max(CONFIRM_MARGIN, aboveTop)

  return { top, left }
}

export default function SrActions({
  sr,
  connectionId,
  poolRef,
  isDefault = false,
  disabled = false,
  onActionComplete,
}: SrActionsProps) {
  const [loadingAction, setLoadingAction] = useState<ActionType | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const [confirmAction, setConfirmAction] = useState<ActionType | null>(null)
  const [confirmPosition, setConfirmPosition] = useState<ConfirmPosition | null>(null)

  const executeAction = async (action: ActionType) => {
    setLoadingAction(action)
    setError(null)
    setResult(null)
    try {
      switch (action) {
        case 'scan':
          await window.xapi.sr.scan(connectionId, sr.ref)
          break
        case 'setDefault': {
          if (!poolRef) {
            throw new Error('资源池引用不可用')
          }
          await window.xapi.sr.setDefault(connectionId, poolRef, sr.ref)
          break
        }
        case 'detach':
          await window.xapi.sr.detach(connectionId, sr.ref)
          break
        case 'destroy':
          await window.xapi.sr.destroy(connectionId, sr.ref)
          break
      }
      setResult(action === 'scan' ? `已扫描存储仓库“${sr.name_label}”。` : action === 'setDefault' ? `已将“${sr.name_label}”设为该资源池的默认存储仓库。` : '操作已完成。')
      setConfirmAction(null)
      setConfirmPosition(null)
    } catch (e: any) {
      setError(e?.message || `操作失败: ${action}`)
    } finally {
      setLoadingAction(null)
      try { await onActionComplete() } catch (refreshError) {
        setError(`清单刷新失败，请重新读取以核对状态。${refreshError instanceof Error ? refreshError.message : ''}`)
      }
    }
  }

  const closeConfirm = () => {
    setConfirmAction(null)
    setConfirmPosition(null)
  }

  const handleActionClick = (action: ActionType, event?: React.MouseEvent<HTMLButtonElement>) => {
    if (action === 'detach' || action === 'destroy') {
      setConfirmAction(action)
      if (event) {
        setConfirmPosition(getConfirmPosition(event.currentTarget.getBoundingClientRect()))
      }
    } else {
      executeAction(action)
    }
  }

  const isLoading = loadingAction !== null

  return (
    <div className="relative">
      <div className="flex flex-wrap items-center gap-1.5">
        <ActionButton
          icon={RefreshCw}
          label="扫描"
          loading={loadingAction === 'scan'}
          disabled={isLoading || disabled}
          onClick={(event) => handleActionClick('scan', event)}
        />
        <ActionButton
          icon={Star}
          label="设为默认"
          loading={loadingAction === 'setDefault'}
          disabled={isLoading || disabled || isDefault || !poolRef || sr.type === 'iso' || sr.type === 'udev'}
          blockedReason={isDefault ? '当前默认存储仓库' : sr.type === 'iso' || sr.type === 'udev' ? '此类存储仓库不能作为默认虚拟磁盘存储' : !poolRef ? '资源池信息尚未就绪' : undefined}
          onClick={(event) => handleActionClick('setDefault', event)}
        />
        {isDefault && <span className="text-xs text-warning">默认存储仓库</span>}
        <ActionButton
          icon={Unplug}
          label="分离"
          loading={loadingAction === 'detach'}
          disabled
          blockedReason={lifecycleBlockedReason}
          onClick={(event) => handleActionClick('detach', event)}
          destructive
        />
        <ActionButton
          icon={Trash2}
          label="销毁"
          loading={loadingAction === 'destroy'}
          disabled
          blockedReason={lifecycleBlockedReason}
          onClick={(event) => handleActionClick('destroy', event)}
          destructive
        />
      </div>

      {result && <p role="status" className="mt-2 break-words text-xs text-success">{result}</p>}
      <p className="mt-2 text-xs text-subtle">分离与销毁暂不可用；分离保留数据，销毁会永久删除仓库及其内容。</p>

      {/* Error display */}
      {error && (
        <div role="alert" className="mt-2 break-words text-xs text-danger bg-danger-soft border border-danger/40 rounded px-2 py-1">
          {error}
        </div>
      )}

      {/* Confirmation dialog overlay */}
      {confirmAction && confirmPosition && createPortal(
        <div
          className="fixed z-50 w-64 rounded-lg border border-input bg-muted p-4 shadow-xl"
          style={{ top: confirmPosition.top, left: confirmPosition.left }}
        >
          <div className="flex items-start gap-2 mb-3">
            <AlertTriangle className="w-5 h-5 text-danger flex-shrink-0" />
            <div>
              <p className="text-sm text-foreground font-medium">
                {confirmAction === 'destroy' ? '销毁存储仓库' : '分离存储仓库'}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {confirmAction === 'destroy'
                  ? '这将永久删除此存储仓库及其所有数据。此操作无法撤销。'
                  : '这将从资源池中分离存储仓库。数据不会被删除。'}
              </p>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={closeConfirm}
              disabled={isLoading}
              className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              取消
            </button>
            <button
              onClick={() => executeAction(confirmAction)}
              disabled={isLoading}
              className="px-3 py-1.5 text-xs bg-danger-solid hover:bg-danger-solid text-on-solid rounded transition-colors flex items-center gap-1.5"
            >
              {loadingAction === confirmAction && (
                <Loader2 className="w-3 h-3 animate-spin" />
              )}
              {confirmAction === 'destroy' ? '销毁' : '分离'}
            </button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}

function ActionButton({
  icon: Icon,
  label,
  loading,
  disabled,
  onClick,
  destructive,
  blockedReason,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  loading: boolean
  disabled: boolean
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void
  destructive?: boolean
  blockedReason?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      aria-label={label}
      title={blockedReason ?? label}
      className={cn(
        'flex items-center gap-1.5 px-2 py-1.5 text-xs rounded-md transition-colors disabled:opacity-50',
        destructive
          ? 'text-subtle hover:text-danger hover:bg-danger-soft'
          : 'text-subtle hover:text-secondary-foreground hover:bg-muted'
      )}
    >
      {loading ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : (
        <Icon className="w-4 h-4" />
      )}
      <span>{loading ? `${label}中...` : label}</span>
    </button>
  )
}
