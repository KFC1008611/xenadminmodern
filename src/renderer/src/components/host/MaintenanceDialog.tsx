import { DesktopDialog } from '../layout/DesktopDialog'
/**
 * MaintenanceDialog — confirmation dialog for entering host maintenance mode.
 * Shows VM migration list, loading state, and result summary.
 */
import { useState } from 'react'
import { AlertTriangle, X, Loader2, CheckCircle2, XCircle } from 'lucide-react'
import type { EvacuateResult } from '../../types/xapi'
import { useToast } from '../toast/useToast'
import { getAuditedFeatureBlockReason } from '../../../../shared/audited-features'

interface MaintenanceDialogProps {
  open: boolean
  onClose: () => void
  connectionId: string
  hostRef: string
  vmNames: string[]
  onComplete: () => void
}

export function MaintenanceDialog({
  open,
  onClose,
  connectionId,
  hostRef,
  vmNames,
  onComplete,
}: MaintenanceDialogProps) {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<EvacuateResult | null>(null)
  const toast = useToast()
  const guardReason = getAuditedFeatureBlockReason('host.maintenance')

  if (!open) return null

  const handleEnterMaintenance = async () => {
    setLoading(true)
    try {
      const evacuateResult = await window.xapi.host.enterMaintenance(connectionId, hostRef)
      setResult(evacuateResult)
      if (evacuateResult.success) {
        toast.success('成功进入维护模式')
      }
    } catch (e: any) {
      toast.error(`维护操作未完成：${e?.message || String(e)}`)
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    if (loading) return
    if (result) {
      onComplete()
    }
    setResult(null)
    onClose()
  }

  return (
    <DesktopDialog title="进入维护模式" onClose={handleClose} busy={loading} className="max-w-lg">
      <div className="bg-card border border-input rounded-xl shadow-2xl w-full max-w-lg">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground">进入维护模式</h2>
          <button
            onClick={handleClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label="关闭"
            disabled={loading}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-5 space-y-4">
          <p className="text-sm text-warning">{guardReason}</p>
          {/* Warning icon */}
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 w-10 h-10 rounded-full bg-warning-soft flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-warning" />
            </div>
            <div>
              {vmNames.length > 0 ? (
                <>
                  <p className="text-foreground text-sm">
                    该主机上运行着{' '}
                    <span className="text-warning font-semibold">{vmNames.length}</span>{' '}
                    台虚拟机。系统将先禁止新任务进入，再疏散虚拟机。
                  </p>
                </>
              ) : (
                <p className="text-foreground text-sm">
                  当前列表没有运行中的虚拟机。
                </p>
              )}
            </div>
          </div>

          {/* VM list */}
          {vmNames.length > 0 && !result && (
            <div className="bg-muted rounded-lg p-3 max-h-40 overflow-y-auto">
              <p className="text-xs text-muted-foreground mb-2">待迁移的虚拟机：</p>
              <ul className="space-y-1">
                {vmNames.map((name, i) => (
                  <li key={i} className="text-sm text-secondary-foreground flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />
                    {name}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Result */}
          {result && (
            <div className="bg-muted rounded-lg p-4 space-y-3">
              {result.success ? (
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-success" />
                  <span className="text-success text-sm font-medium">
                    维护模式已成功启用
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <XCircle className="w-5 h-5 text-danger" />
                  <span className="text-danger text-sm font-medium">
                    维护模式启用时部分失败
                  </span>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="bg-card rounded-md p-2">
                  <div className="text-muted-foreground text-xs">已迁移</div>
                  <div className="text-foreground font-medium">{result.migratedVms.length} 台</div>
                </div>
                <div className="bg-card rounded-md p-2">
                  <div className="text-muted-foreground text-xs">迁移失败</div>
                  <div className="text-foreground font-medium">{result.failedVms.length} 台</div>
                </div>
              </div>
              {result.failedVms.length > 0 && (
                <div className="text-xs text-danger">
                  <p className="mb-1">失败的虚拟机：</p>
                  <ul className="list-disc list-inside space-y-0.5">
                    {result.failedVms.map((f, i) => (
                      <li key={i}>{f.vmRef}: {f.error}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border">
          <button
            onClick={handleClose}
            disabled={loading}
            className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            {result ? '关闭' : '取消'}
          </button>
          {!result && (
            <button
              onClick={handleEnterMaintenance}
              disabled
              title={guardReason}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-warning-solid hover:bg-warning-solid disabled:bg-secondary disabled:text-subtle disabled:cursor-not-allowed text-on-solid rounded-lg transition-colors"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              确认进入维护模式
            </button>
          )}
        </div>
      </div>
    </DesktopDialog>
  )
}
