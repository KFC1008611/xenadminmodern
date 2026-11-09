/**
 * HaConfigDialog - Dialog for enabling/configuring HA on a pool.
 * v9: New component for HA configuration, using Tailwind CSS + Radix Dialog.
 */
import { useState, useEffect } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { useHaStore } from '../../store/ha.store'
import { useMultiDataStore } from '../../store/multiData.store'
import { feedback } from '../../store/feedback.store'
import { getAuditedFeatureBlockReason } from '../../../../shared/audited-features'

interface HaConfigDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  connectionId: string
  srs?: any[]
  onSuccess?: () => void
}

export function HaConfigDialog({ open, onOpenChange, connectionId, srs: _srs, onSuccess }: HaConfigDialogProps) {
  const { haConfig, enableHa, disableHa } = useHaStore()
  const { srs: storeSrs } = useMultiDataStore()
  const guardReason = getAuditedFeatureBlockReason('ha.governance')

  // Use store srs if prop not provided
  const srs = _srs || storeSrs

  const [heartbeatSR, setHeartbeatSR] = useState('')
  const [allowOvercommit, setAllowOvercommit] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [mode, setMode] = useState<'enable' | 'disable' | 'configure'>('configure')

  // Initialize form when dialog opens
  useEffect(() => {
    if (open && haConfig) {
      setMode(haConfig.enabled ? 'configure' : 'enable')
      setHeartbeatSR(haConfig.heartbeatSRs[0] || '')
      setAllowOvercommit(haConfig.allowOvercommit)
    }
  }, [open, haConfig])

  // Filter SRs that can be used for HA heartbeat
  const heartbeatCandidates = srs.filter(
    (sr: any) => sr.physical_size > 0 && !sr.content_type?.includes('iso')
  )

  const handleEnable = async () => {
    if (!heartbeatSR) {
      feedback.error('请选择心跳存储库')
      return
    }

    setProcessing(true)
    try {
      await enableHa({
        heartbeatSRs: [heartbeatSR],
        allowOvercommit,
      }, connectionId)
      feedback.success('HA 已启用')
      onOpenChange(false)
      onSuccess?.()
    } catch (err: any) {
      feedback.error(err.message || '启用 HA 失败')
    } finally {
      setProcessing(false)
    }
  }

  const handleDisable = async () => {
    if (!confirm('确定要禁用 HA 吗？这将降低池的高可用性。')) {
      return
    }

    setProcessing(true)
    try {
      await disableHa(connectionId)
      feedback.success('HA 已禁用')
      onOpenChange(false)
      onSuccess?.()
    } catch (err: any) {
      feedback.error(err.message || '禁用 HA 失败')
    } finally {
      setProcessing(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg bg-card border border-border rounded-xl shadow-2xl z-50 focus:outline-none">
          <div className="flex items-center justify-between px-6 py-4 border-b border-border">
            <Dialog.Title className="text-lg font-semibold text-foreground">
              {haConfig?.enabled ? 'HA 配置' : '启用高可用性 (HA)'}
            </Dialog.Title>
            <Dialog.Close className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors">
              <X className="w-4 h-4" />
            </Dialog.Close>
          </div>

          <div className="px-6 py-5 space-y-6">
            <Dialog.Description className="text-sm text-warning">
              {guardReason}
            </Dialog.Description>
            {/* Mode selection */}
            {haConfig?.enabled && (
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">操作</label>
                <select
                  value={mode}
                  onChange={(e) => setMode(e.target.value as typeof mode)}
                  className="w-full px-3 py-2 text-sm bg-muted border border-input rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="configure">重新配置</option>
                  <option value="disable">禁用 HA</option>
                </select>
              </div>
            )}

            {/* Heartbeat SR */}
            {(mode === 'enable' || mode === 'configure') && (
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">心跳存储库</label>
                <select
                  value={heartbeatSR}
                  onChange={(e) => setHeartbeatSR(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-muted border border-input rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="">选择存储库...</option>
                  {heartbeatCandidates.map((sr: any) => (
                    <option key={sr.ref} value={sr.ref}>
                      {sr.name_label} ({sr.type})
                    </option>
                  ))}
                </select>
                <p className="text-xs text-subtle mt-1">
                  HA 使用共享存储来检测主机故障
                </p>
              </div>
            )}

            {/* Allow overcommit */}
            {(mode === 'enable' || mode === 'configure') && (
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-foreground">允许资源超量使用</p>
                  <p className="text-xs text-subtle">
                    允许启动的 VM 内存超过物理内存
                  </p>
                </div>
                <button
                  onClick={() => setAllowOvercommit(!allowOvercommit)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    allowOvercommit ? 'bg-primary' : 'bg-secondary'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      allowOvercommit ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            )}

            {/* Current status */}
            {haConfig && (
              <div className="bg-muted border border-input rounded-lg p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">当前状态:</span>
                  <span className={`text-sm ${haConfig.enabled ? 'text-success' : 'text-danger'}`}>
                    {haConfig.enabled ? '已启用' : '已禁用'}
                  </span>
                </div>
                {haConfig.enabled && (
                  <>
                    <div className="text-sm text-muted-foreground">
                      可容忍主机故障: <span className="font-medium text-foreground">{haConfig.plannedRepeats}</span>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      心跳存储库: <span className="font-medium text-foreground">{haConfig.heartbeatSRs.length}</span>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-3 px-6 py-4 border-t border-border">
            <button
              onClick={() => onOpenChange(false)}
              className="px-4 py-2 text-sm bg-muted hover:bg-secondary text-foreground rounded-lg transition-colors"
            >
              取消
            </button>
            {mode === 'disable' ? (
              <button
                onClick={handleDisable}
                disabled
                title={guardReason}
                className="px-4 py-2 text-sm bg-danger-solid hover:bg-danger-solid disabled:bg-secondary disabled:text-subtle disabled:cursor-not-allowed text-on-solid rounded-lg transition-colors"
              >
                {processing ? '处理中...' : '禁用 HA'}
              </button>
            ) : (
              <button
                onClick={handleEnable}
                disabled
                title={guardReason}
                className="px-4 py-2 text-sm bg-primary hover:bg-primary-hover disabled:bg-secondary disabled:text-subtle disabled:cursor-not-allowed text-primary-foreground rounded-lg transition-colors"
              >
                {processing ? '处理中...' : haConfig?.enabled ? '更新配置' : '启用 HA'}
              </button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
