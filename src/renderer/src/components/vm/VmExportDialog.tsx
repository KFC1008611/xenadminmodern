/**
 * VmExportDialog — Dialog for exporting a VM to XVA file format
 * v7: Simplified dialog - just configuration (mode + file path)
 * Progress tracking is now handled by ExportPanel in background
 */
import { canRunVmExport, type VmActionRecord } from '../../lib/vmActionGuard'
import { useState, useEffect } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, Download, File, FolderOpen, Loader2 } from 'lucide-react'
import { useToast } from '../toast/useToast'
import { useExportPanelStore } from '../../store/exportPanel.store'

interface VmExportDialogProps {
  open: boolean
  onClose: () => void
  vmRef: string
  vmName: string
  powerState?: 'Running' | 'Halted' | 'Suspended' | 'Paused'
  connectionId: string
  isTemplate?: boolean
  vmRecord?: VmActionRecord
}

type ExportMode = 'shutdown' | 'snapshot' | 'force'

function getDefaultExportMode(powerState: string, vmRecord?: VmActionRecord): ExportMode {
  if (powerState !== 'Running') return 'force'
  if (vmRecord && !canRunVmExport(vmRecord, 'shutdown').canRun && canRunVmExport(vmRecord, 'snapshot').canRun) return 'snapshot'
  return 'shutdown'
}

export function VmExportDialog({
  open,
  onClose,
  vmRef,
  vmName,
  powerState,
  connectionId,
  isTemplate = false,
  vmRecord,
}: VmExportDialogProps) {
  const effectivePowerState = isTemplate ? 'Halted' : (powerState || 'Halted')
  const [exportMode, setExportMode] = useState<ExportMode>(
    () => getDefaultExportMode(effectivePowerState, vmRecord)
  )
  const [filePath, setFilePath] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isStarting, setIsStarting] = useState(false)

  const exportGuard = (mode: ExportMode) => vmRecord ? canRunVmExport(vmRecord, mode) : { canRun: true, reason: undefined }
  const modeMatchesPowerState = effectivePowerState === 'Running' ? exportMode !== 'force' : exportMode === 'force'
  const modeGuard = modeMatchesPowerState ? exportGuard(exportMode)
    : { canRun: false, reason: 'VM 电源状态已变化，请重新选择导出模式' }
  const toast = useToast()
  const addTask = useExportPanelStore((s) => s.addTask)

  // Choose defaults only for a new dialog/target; refreshes must preserve the selected mode.
  useEffect(() => {
    if (open) {
      setExportMode(getDefaultExportMode(effectivePowerState, vmRecord))
      setFilePath('')
      setError(null)
      setIsStarting(false)
    }
  }, [open, connectionId, vmRef, isTemplate])

  const handleSelectFile = async () => {
    try {
      const result = await window.xapi.dialog.showSaveDialog({
        defaultPath: `${vmName}.xva`,
        filters: [
          { name: 'XVA Files', extensions: ['xva'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      })

      if (result && !result.canceled && result.filePath) {
        setFilePath(result.filePath)
      }
    } catch (e: any) {
      toast.error(`选择文件失败: ${e?.message || String(e)}`)
    }
  }

  const handleStartExport = async () => {
    if (isStarting || !modeGuard.canRun) return
    if (!filePath) {
      toast.error('请选择保存位置')
      return
    }

    setIsStarting(true)
    setError(null)

    try {
      const result = await window.xapi.vm.export(connectionId, {
        vmRef,
        filePath,
        powerState: effectivePowerState,
        exportMode,
      })

      // Add to background export panel
      addTask({
        exportId: result.exportId,
        vmName,
        connectionId,
        progress: 0,
        phase: 'preparing',
        status: 'running',
        bytesTransferred: 0,
        bytesTotal: 0,
        message: '正在准备导出...',
        filePath,
        startedAt: Date.now(),
      })

      toast.info(`开始导出 ${isTemplate ? '模板' : 'VM'} "${vmName}"...`)

      // Close dialog immediately - progress is handled by ExportPanel
      onClose()
    } catch (e: any) {
      setError(e?.message || '导出失败')
      toast.error(`导出失败: ${e?.message || String(e)}`)
    } finally {
      setIsStarting(false)
    }
  }

  const getPowerStateBadge = () => {
    const colors: Record<string, string> = {
      Running: 'bg-success-soft text-success border-success/30',
      Halted: 'bg-muted text-muted-foreground border-input',
      Suspended: 'bg-warning-soft text-warning border-warning/30',
      Paused: 'bg-warning-soft text-warning border-warning/30',
    }
    return colors[effectivePowerState] || colors.Halted
  }

  return (
    <Dialog.Root open={open} onOpenChange={(open) => { if (!open && !isStarting) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" />
        <Dialog.Content onEscapeKeyDown={(event) => { if (isStarting) event.preventDefault() }} onPointerDownOutside={(event) => { if (isStarting) event.preventDefault() }} className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100%-2rem)] max-w-lg bg-card border border-input rounded-xl shadow-2xl z-50 max-h-[calc(100dvh-4rem)] overflow-y-auto">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-border">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-info-soft rounded-lg">
                <Download className="w-5 h-5 text-info" />
              </div>
              <div>
                <Dialog.Title className="text-lg font-semibold text-foreground">
                  导出 {isTemplate ? '模板' : 'VM'}
                </Dialog.Title>
                <Dialog.Description className="sr-only">
                  选择保存位置并开始导出，准备与传输均可在后台查看。
                </Dialog.Description>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-sm text-muted-foreground break-all">{vmName}</span>
                  {!isTemplate && (
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${getPowerStateBadge()}`}>
                      {effectivePowerState}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <Dialog.Close asChild>
              <button
                className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors disabled:opacity-50"
                disabled={isStarting}
              >
                <X className="w-5 h-5" />
              </button>
            </Dialog.Close>
          </div>

          {/* Content */}
          <div className="px-6 py-5 space-y-5">
            {/* Export Mode Selection */}
            {!isTemplate && (
              <div className="space-y-3">
                <label className="text-sm font-medium text-secondary-foreground">导出模式</label>
                <div className="space-y-2">
                  {effectivePowerState === 'Running' && (
                    <label className="flex items-start gap-3 p-3 bg-muted border border-input rounded-lg cursor-pointer hover:bg-muted transition-colors">
                      <input
                        type="radio"
                        disabled={isStarting || !exportGuard('shutdown').canRun}
                        title={exportGuard('shutdown').reason}
                        name="exportMode"
                        value="shutdown"
                        checked={exportMode === 'shutdown'}
                        onChange={(e) => setExportMode(e.target.value as ExportMode)}
                        className="mt-1"
                      />
                      <div>
                        <div className="text-sm font-medium text-foreground">关机后导出</div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          先正常关闭 VM，然后导出；完成后 VM 保持关闭
                          {!exportGuard('shutdown').canRun && <span className="block text-warning">{exportGuard('shutdown').reason}</span>}
                        </div>
                      </div>
                    </label>
                  )}
                  {effectivePowerState === 'Running' && (
                    <label className="flex items-start gap-3 p-3 bg-muted border border-input rounded-lg cursor-pointer hover:bg-muted transition-colors">
                      <input
                        type="radio"
                        disabled={isStarting || !exportGuard('snapshot').canRun}
                        title={exportGuard('snapshot').reason}
                        name="exportMode"
                        value="snapshot"
                        checked={exportMode === 'snapshot'}
                        onChange={(e) => setExportMode(e.target.value as ExportMode)}
                        className="mt-1"
                      />
                      <div>
                        <div className="text-sm font-medium text-foreground">导出快照</div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          创建包含内存的检查点后导出，期间会短暂挂起并恢复 VM
                          {!exportGuard('snapshot').canRun && <span className="block text-warning">{exportGuard('snapshot').reason}</span>}
                        </div>
                      </div>
                    </label>
                  )}
                  {effectivePowerState !== 'Running' && <label className="flex items-start gap-3 p-3 bg-muted border border-input rounded-lg cursor-pointer hover:bg-muted transition-colors">
                    <input
                      type="radio"
                      disabled={isStarting}
                      name="exportMode"
                      value="force"
                      checked={exportMode === 'force'}
                      onChange={(e) => setExportMode(e.target.value as ExportMode)}
                      className="mt-1"
                    />
                    <div>
                        <div className="text-sm font-medium text-foreground">直接导出</div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                        导出已关闭或已挂起的虚拟机
                      </div>
                    </div>
                  </label>}
                </div>
              </div>
            )}

            {!modeGuard.canRun && !isStarting && (
              <p role="status" className="text-sm text-warning">
                当前导出模式不可用，请重新选择或等待状态恢复。{modeGuard.reason}
              </p>
            )}

            {/* File Path Selection */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-secondary-foreground">保存位置（使用新的文件名）</label>
              <div className="flex gap-2">
                <div className="min-w-0 flex-1 flex items-center gap-2 px-3 py-2 bg-muted border border-input rounded-lg text-sm">
                  <File className="w-4 h-4 text-subtle flex-shrink-0" />
                  <span className={filePath ? 'text-foreground truncate' : 'text-subtle'}>
                    {filePath || '选择保存位置...'}
                  </span>
                </div>
                <button
                  onClick={handleSelectFile}
                  disabled={isStarting}
                  className="flex items-center gap-2 px-4 py-2 bg-muted hover:bg-secondary border border-input text-foreground text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                >
                  <FolderOpen className="w-4 h-4" />
                  浏览
                </button>
              </div>
            </div>

            {/* Error display */}
            {error && (
              <div className="p-3 bg-danger-soft border border-danger/30 rounded-lg">
                <p className="text-sm text-danger">{error}</p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border bg-card">
            <button
              onClick={onClose}
              disabled={isStarting}
              className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            >
              取消
            </button>
            <button
              onClick={handleStartExport}
              disabled={!filePath || isStarting || !modeGuard.canRun} title={modeGuard.reason}
              className="flex items-center gap-2 px-4 py-2 bg-info-solid hover:bg-info-solid disabled:bg-secondary disabled:text-subtle disabled:cursor-not-allowed text-on-solid text-sm font-medium rounded-lg transition-colors"
            >
              {isStarting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  启动中...
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  开始导出
                </>
              )}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
