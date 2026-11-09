import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, HardDrive, Loader2, X } from 'lucide-react'
import { useToast } from '../toast/useToast'
import { formatBytes } from '../../lib/utils'
import type { VBDRecord } from '../../types/xapi'
import type { VmPowerIntent } from '../../../../shared/types/xapi'
import { useConnectionManagerStore } from '../../store/connectionManager.store'
import { DesktopDialog } from '../layout/DesktopDialog'

interface DeleteVmTarget {
  ref: string
  name_label: string
  connectionId: string
  poolName?: string
  uuid?: string
}

interface DeleteVmDialogProps {
  open: boolean
  onClose: () => void
  vm: DeleteVmTarget | null
  onSuccess: () => void | Promise<void>
}

export function DeleteVmDialog({ open, onClose, vm, onSuccess }: DeleteVmDialogProps) {
  const [disks, setDisks] = useState<VBDRecord[]>([])
  const [selectedVdiRefs, setSelectedVdiRefs] = useState<Set<string>>(new Set())
  const [isLoadingDisks, setIsLoadingDisks] = useState(false)
  const [diskLoadError, setDiskLoadError] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [finished, setFinished] = useState(false)
  const [intent, setIntent] = useState<VmPowerIntent | undefined>()
  const request = useRef(0)
  const submitting = useRef(false)
  const connections = useConnectionManagerStore((state) => state.connections)
  const toast = useToast()

  useEffect(() => {
    const revision = ++request.current
    if (!open || !vm) return

    let cancelled = false
    setDisks([])
    setSelectedVdiRefs(new Set())
    setIsLoadingDisks(true)
    setDiskLoadError(null)
    setIsDeleting(false)
    setError(null)
    setFinished(false)
    submitting.current = false
    const connection = useConnectionManagerStore.getState().connections.find((item) => item.id === vm.connectionId)
    setIntent(vm.uuid ? { vmUuid: vm.uuid, poolUuid: connection?.poolUuid, epoch: connection?.epoch } : undefined)

    void window.xapi.vm.getVBDs(vm.connectionId, vm.ref)
      .then((records) => {
        if (cancelled || revision !== request.current) return
        const ownerDisks = records.filter((vbd) =>
          vbd.owner && vbd.VDI && vbd.VDI !== 'OpaqueRef:NULL'
        )
        setDisks(ownerDisks)
        setSelectedVdiRefs(new Set(ownerDisks.filter((disk) => !disk.deleteReason).map((disk) => disk.VDI)))
      })
      .catch((e: any) => {
        if (cancelled) return
        setDiskLoadError(`加载磁盘失败: ${e?.message || String(e)}`)
      })
      .finally(() => {
        if (!cancelled) setIsLoadingDisks(false)
      })

    return () => {
      cancelled = true
    }
  }, [open, vm?.connectionId, vm?.ref, vm?.uuid])

  const toggleDisk = (vdiRef: string) => {
    setSelectedVdiRefs((current) => {
      const next = new Set(current)
      if (next.has(vdiRef)) next.delete(vdiRef)
      else next.add(vdiRef)
      return next
    })
  }

  const handleDelete = async () => {
    if (!vm || submitting.current || finished || isLoadingDisks || diskLoadError || connectionChanged) return

    submitting.current = true
    const revision = request.current
    setIsDeleting(true)
    setError(null)

    try {
      const result = await window.xapi.vm.destroy(vm.connectionId, vm.ref, {
        vdiRefs: [...selectedVdiRefs],
        ...(intent ? { intent } : {}),
      })
      if (revision !== request.current) return
      setFinished(true)
      let refreshError = ''
      try { await onSuccess() } catch (e: any) { refreshError = `清单刷新失败：${e?.message || String(e)}` }
      if (revision !== request.current) return
      if (result.failedVdiRefs.length > 0) {
        setError(`VM 已删除，但以下磁盘仍需清理：${result.failedVdiRefs.join('、')}。请到存储中检查。${refreshError}`)
        return
      }
      if (refreshError) { setError(`VM 及所选磁盘已删除。${refreshError}`); return }
      toast.success(`VM "${vm.name_label}" 删除成功`)
      onClose()
    } catch (e: any) {
      if (revision !== request.current) return
      const errorMessage = e?.message || String(e)
      setFinished(true)
      setError(`${errorMessage}。请关闭窗口并重新读取虚拟机与存储清单后再操作。`)
    } finally {
      if (revision === request.current) { setIsDeleting(false); submitting.current = false }
    }
  }

  const handleClose = () => {
    if (!isDeleting) onClose()
  }

  if (!vm) return null
  const connection = connections.find((item) => item.id === vm.connectionId)
  const connectionChanged = !!intent && (!intent.poolUuid || !Number.isFinite(intent.epoch)
    || connection?.state !== 'connected' || connection.poolUuid !== intent.poolUuid || connection.epoch !== intent.epoch)

  return (
    <DesktopDialog open={open} title="删除虚拟机" onClose={handleClose} busy={isDeleting} className="max-w-md border border-input bg-card shadow-2xl">
          <div className="flex items-center justify-between border-b border-input px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-danger-soft p-2">
                <AlertTriangle className="h-5 w-5 text-danger" />
              </div>
              <h2 className="text-lg font-semibold text-foreground">
                删除虚拟机
              </h2>
            </div>
              <button
                type="button"
                onClick={handleClose}
                className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50"
                disabled={isDeleting}
                aria-label="关闭"
              >
                <X className="h-5 w-5" />
              </button>
          </div>

          <div className="space-y-5 px-6 py-5">
            <div>
              <p className="break-words text-secondary-foreground">
                确定要删除 VM <span className="font-medium text-foreground">"{vm.name_label}"</span> 吗？
              </p>
              <p className="mt-2 text-xs text-subtle">
                VM 记录删除后不可恢复。所属硬盘默认勾选删除，可取消勾选以保留数据。快照及光驱介质保留。
              </p>
            </div>

            <div>
              <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
                <HardDrive className="h-4 w-4 text-muted-foreground" />
                选择同时删除的虚拟磁盘
              </div>
              {isLoadingDisks ? (
                <div className="flex items-center gap-2 rounded-lg border border-input bg-card p-3 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  正在加载磁盘...
                </div>
              ) : diskLoadError ? (
                <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-soft p-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-danger" />
                  <p className="text-sm text-danger">{diskLoadError}</p>
                </div>
              ) : disks.length === 0 ? (
                <div className="rounded-lg border border-input bg-card p-3 text-sm text-muted-foreground">
                  没有可删除的所属磁盘
                </div>
              ) : (
                <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
                  {disks.map((disk) => (
                    <label
                      key={disk.VDI}
                      className="flex cursor-pointer items-start gap-3 rounded-lg border border-input bg-secondary p-3 transition-colors hover:bg-secondary"
                    >
                      <input
                        type="checkbox"
                        checked={selectedVdiRefs.has(disk.VDI)}
                        onChange={() => toggleDisk(disk.VDI)}
                        disabled={isDeleting || finished || !!disk.deleteReason}
                        className="mt-0.5"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-foreground">
                          {disk.vdiName || '未命名磁盘'}
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          设备 {disk.userdevice || '—'} · {formatBytes(disk.vdiSize)}
                        </p>
                        {disk.deleteReason && <p className="mt-1 break-words text-xs text-warning">{disk.deleteReason}</p>}
                      </div>
                    </label>
                  ))}
                </div>
              )}
              <p className="mt-2 text-xs text-subtle">
                勾选的硬盘数据将永久删除。共享、只读、快照和归属不明的磁盘保留。
              </p>
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-soft p-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-danger" />
                <p className="text-sm text-danger">{error}</p>
              </div>
            )}
            {connectionChanged && !isDeleting && <p role="alert" className="break-words text-sm text-danger">资源池连接已变化，请关闭窗口并重新读取虚拟机与存储清单。</p>}
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-input bg-muted px-6 py-4">
            <button
              type="button"
              onClick={handleClose}
              disabled={isDeleting}
              className="px-4 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={isDeleting || finished || isLoadingDisks || diskLoadError !== null || connectionChanged}
              className="flex items-center gap-2 rounded-lg bg-danger-solid px-4 py-2 text-sm font-medium text-on-solid transition-colors hover:bg-danger-solid disabled:cursor-not-allowed disabled:bg-secondary disabled:text-subtle"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  删除中...
                </>
              ) : (
                '删除'
              )}
            </button>
          </div>
    </DesktopDialog>
  )
}
