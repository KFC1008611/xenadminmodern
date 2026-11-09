import { srFreeBytes } from '../../../../shared/storage-capacity'
import { useEffect, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { ArrowRightLeft, Loader2, X } from 'lucide-react'
import type { ConnectedSrRecord, VdiRecord } from '../../types/xapi'
import { formatBytes } from '../../lib/utils'
import { feedback } from '../../store/feedback.store'
import { getConnectionReadIdentity } from '../../store/multiData.store'
import { useConnectionManagerStore } from '../../store/connectionManager.store'

interface VdiMoveDialogProps {
  open: boolean
  onClose: () => void
  connectionId: string
  vdi: VdiRecord | null
  onMoved: () => void | Promise<void>
}

export function VdiMoveDialog(props: VdiMoveDialogProps) {
  return props.open && props.vdi ? <ScopedVdiMoveDialog key={`${props.connectionId}:${props.vdi.ref}:${props.vdi.uuid}`} {...props} vdi={props.vdi} /> : null
}

function ScopedVdiMoveDialog({ open, onClose, connectionId, vdi, onMoved }: VdiMoveDialogProps & { vdi: VdiRecord }) {
  const [srs, setSrs] = useState<ConnectedSrRecord[]>([])
  const [targetSrRef, setTargetSrRef] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [readError, setReadError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const [blocked, setBlocked] = useState(false)
  const generation = useRef(0)
  const submitted = useRef(false)
  const settled = useRef(false)
  const resourcesIdentity = useRef<string | null>(null)
  const connection = useConnectionManagerStore((state) => state.connections.find((item) => item.id === connectionId))
  const identity = JSON.stringify([connection?.state, connection?.connectedAt, connection?.epoch, connection?.poolUuid])

  useEffect(() => {
    const version = ++generation.current
    let current = true
    const readIdentity = getConnectionReadIdentity(connectionId)
    const isCurrent = () => current && generation.current === version && getConnectionReadIdentity(connectionId) === readIdentity
    if (submitted.current) {
      if (!settled.current) {
        setSaving(false)
        setBlocked(true)
        setError('磁盘位置或管理连接已变化，无法读取原移动请求的结果。')
      }
      return () => { current = false; generation.current++ }
    }
    setSrs([])
    resourcesIdentity.current = null
    setTargetSrRef('')
    setReadError(null)
    setLoading(true)
    if (!readIdentity) {
      setLoading(false)
      setReadError('管理连接未连接，请恢复连接后重新读取存储仓库。')
      return () => { current = false; generation.current++ }
    }

    window.xapi.storage
      .listSrs(connectionId)
      .then((records) => {
        if (!isCurrent()) return
        const targets = records.filter((sr) => sr.ref !== vdi.SR && !['iso', 'udev'].includes(sr.type) && sr.content_type !== 'iso')
        resourcesIdentity.current = readIdentity
        setSrs(targets)
        setTargetSrRef(targets[0]?.ref ?? '')
      })
      .catch((e: any) => {
        if (isCurrent()) setReadError(e?.message || String(e))
      })
      .finally(() => { if (isCurrent()) setLoading(false) })
    return () => { current = false; generation.current++; resourcesIdentity.current = null }
  }, [connectionId, identity, vdi.SR, reload])

  const handleSubmit = async () => {
    if (submitted.current || loading || readError || blocked || !resourcesIdentity.current || resourcesIdentity.current !== getConnectionReadIdentity(connectionId)
      || !srs.some((sr) => sr.ref === targetSrRef) || targetSrRef === vdi.SR) return
    const version = generation.current
    const submissionIdentity = getConnectionReadIdentity(connectionId)
    const isCurrent = () => generation.current === version && getConnectionReadIdentity(connectionId) === submissionIdentity
    submitted.current = true
    setSaving(true)
    setError(null)
    try {
      await window.xapi.storage.moveVdi(connectionId, {
        vdiRef: vdi.ref,
        targetSrRef,
      })
      if (!isCurrent()) return
      settled.current = true
      feedback.success(`磁盘 "${vdi.name_label || vdi.ref}" 移动完成`)
      try { await onMoved() } catch {
        if (isCurrent()) feedback.warning('磁盘移动完成，列表刷新失败。')
      }
      if (isCurrent()) onClose()
    } catch (e: any) {
      if (!isCurrent()) return
      settled.current = true
      const message = e?.message || String(e)
      setError(message)
      setBlocked(true)
      if (e?.code === 'TASK_OUTCOME_UNKNOWN') feedback.warning(message)
      else feedback.error(`移动磁盘失败：${message}`)
    } finally {
      if (isCurrent()) setSaving(false)
    }
  }

  const handleClose = () => {
    if (saving || submitted.current && !settled.current && resourcesIdentity.current
      && resourcesIdentity.current === getConnectionReadIdentity(connectionId)) return
    onClose()
  }

  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => !nextOpen && handleClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 max-h-[calc(100dvh-4rem)] overflow-y-auto rounded-xl border border-input bg-card shadow-2xl">
          <div className="flex items-center justify-between border-b border-border px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-info-soft p-2">
                <ArrowRightLeft className="h-5 w-5 text-info" />
              </div>
              <div>
                <Dialog.Title className="text-lg font-semibold text-foreground">移动磁盘到 SR</Dialog.Title>
                <p className="mt-0.5 text-sm text-muted-foreground">{vdi.name_label || vdi.ref}</p>
              </div>
            </div>
            <Dialog.Close asChild>
              <button className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50" disabled={saving}>
                <X className="h-5 w-5" />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">选择目标 SR 并移动磁盘。</Dialog.Description>

          <div className="space-y-4 px-6 py-5">
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                正在加载 SR...
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-secondary-foreground">目标 SR</label>
                  <select
                    aria-label="目标 SR"
                    value={targetSrRef}
                    onChange={(event) => setTargetSrRef(event.target.value)}
                    disabled={saving || blocked || !!readError}
                    className="w-full rounded-lg border border-input bg-muted px-3 py-2 text-sm text-foreground focus:border-primary/30 focus:outline-none focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <option value="">选择目标 SR</option>
                    {srs.map((sr) => (
                      <option key={sr.ref} value={sr.ref} disabled={sr.ref === vdi.SR}>
                        {sr.name_label} ({srFreeBytes(sr) === null ? '容量暂不可用' : `${formatBytes(srFreeBytes(sr))} 可用`})
                      </option>
                    ))}
                  </select>
                  {!readError && srs.length === 0 && <p role="status" className="text-sm text-warning">没有其他可移动到的磁盘存储仓库。</p>}
                </div>


              </>
            )}

            {readError && <div role="alert" className="rounded-lg border border-warning/30 bg-warning-soft p-3 text-sm text-warning break-words">
              存储仓库读取失败：{readError}
              <button type="button" onClick={() => setReload((value) => value + 1)} className="ml-2 underline">重新读取存储仓库</button>
            </div>}
            {error && (
              <div role="alert" className="rounded-lg border border-danger/30 bg-danger-soft p-3 text-sm text-danger break-words">
                <p>{error}</p>
                <p>请关闭窗口，重新读取原虚拟机磁盘和存储清单后再操作。</p>
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-border bg-card px-6 py-4">
            <button onClick={handleClose} disabled={saving} className="px-4 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50">
              取消
            </button>
            <button
              onClick={handleSubmit}
              disabled={saving || loading || blocked || !!readError || !getConnectionReadIdentity(connectionId) || !targetSrRef || targetSrRef === vdi.SR}
              className="flex items-center gap-2 rounded-lg bg-info-solid px-4 py-2 text-sm font-medium text-on-solid transition-colors hover:bg-info-solid disabled:cursor-not-allowed disabled:bg-secondary disabled:text-subtle"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRightLeft className="h-4 w-4" />}
              移动
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
