import { useEffect, useMemo, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { HardDrive, Link, Loader2, X } from 'lucide-react'
import type { AttachableVdiRecord } from '../../types/xapi'
import { formatBytes } from '../../lib/utils'
import { feedback } from '../../store/feedback.store'
import { useConnectionManagerStore } from '../../store/connectionManager.store'
import { getConnectionReadIdentity } from '../../store/multiData.store'

interface VdiAttachDialogProps {
  open: boolean
  onClose: () => void
  connectionId: string
  vmRef: string
  onAttached: () => void | Promise<void>
}

export function VdiAttachDialog({ open, onClose, connectionId, vmRef, onAttached }: VdiAttachDialogProps) {
  const [vdis, setVdis] = useState<AttachableVdiRecord[]>([])
  const [selectedVdiRef, setSelectedVdiRef] = useState('')
  const [readOnly, setReadOnly] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const inFlight = useRef(false)
  const generation = useRef(0)
  const connection = useConnectionManagerStore((state) => state.connections.find((item) => item.id === connectionId))
  const identity = JSON.stringify([connection?.state, connection?.connectedAt, connection?.epoch, connection?.poolUuid])

  useEffect(() => {
    const version = ++generation.current
    if (!open) return
    let current = true
    const readIdentity = getConnectionReadIdentity(connectionId)
    const isCurrent = () => current && getConnectionReadIdentity(connectionId) === readIdentity
    setVdis([])
    setSelectedVdiRef('')
    setReadOnly(false)
    setError(null)
    setSaving(inFlight.current)
    setLoading(true)

    window.xapi.storage
      .listAttachableVdis(connectionId, vmRef)
      .then((records) => {
        if (!isCurrent()) return
        setVdis(records)
        const first = records[0]
        if (first) {
          setSelectedVdiRef(first.ref)
          setReadOnly(first.forceReadOnly)
        }
      })
      .catch((e: any) => {
        if (!isCurrent()) return
        setVdis([])
        setError(e?.message || String(e))
      })
      .finally(() => { if (isCurrent()) setLoading(false) })
    return () => { current = false; if (generation.current === version) generation.current += 1 }
  }, [open, connectionId, vmRef, identity, reload])

  const selected = useMemo(
    () => vdis.find((vdi) => vdi.ref === selectedVdiRef) ?? null,
    [selectedVdiRef, vdis]
  )

  useEffect(() => {
    if (selected?.forceReadOnly) {
      setReadOnly(true)
    }
  }, [selected])

  const handleSubmit = async () => {
    if (!open || !selected || loading || error || inFlight.current) return
    const version = generation.current
    const submissionIdentity = getConnectionReadIdentity(connectionId)
    const isCurrent = () => generation.current === version && getConnectionReadIdentity(connectionId) === submissionIdentity
    inFlight.current = true
    setSaving(true)
    setError(null)
    try {
      const result = await window.xapi.storage.attachExistingVdi(connectionId, {
        vmRef,
        vdiRef: selected.ref,
        readOnly,
      })
      if (!isCurrent()) return
      if (result.warning) {
        feedback.warning(`磁盘已附加，但热插拔失败：${result.warning}`)
      } else {
        feedback.success(`磁盘 "${selected.name_label || selected.ref}" 已附加`)
      }
      try { await onAttached() } catch {
        feedback.warning('磁盘已附加，列表刷新失败，请重新读取磁盘列表。')
      }
      if (isCurrent()) onClose()
    } catch (e: any) {
      if (!isCurrent()) return
      const message = e?.message || String(e)
      setError(message)
      feedback.error(`附加磁盘失败：${message}`)
    } finally {
      inFlight.current = false
      setSaving(false)
    }
  }

  const handleClose = () => {
    if (!saving) onClose()
  }

  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => !nextOpen && handleClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
        <Dialog.Content aria-describedby={undefined} className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 max-h-[calc(100dvh-4rem)] overflow-y-auto rounded-xl border border-input bg-card shadow-2xl">
          <div className="flex items-center justify-between border-b border-border px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-accent p-2">
                <Link className="h-5 w-5 text-accent-foreground" />
              </div>
              <Dialog.Title className="text-lg font-semibold text-foreground">附加已有磁盘</Dialog.Title>
            </div>
            <Dialog.Close asChild>
              <button className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50" disabled={saving}>
                <X className="h-5 w-5" />
              </button>
            </Dialog.Close>
          </div>

          <div className="space-y-4 px-6 py-5">
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                正在加载可附加磁盘...
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-secondary-foreground">磁盘</label>
                  <select aria-label="附加磁盘"
                    value={selectedVdiRef}
                    onChange={(event) => setSelectedVdiRef(event.target.value)}
                    disabled={saving || vdis.length === 0}
                    className="w-full rounded-lg border border-input bg-muted px-3 py-2 text-sm text-foreground focus:border-primary/30 focus:outline-none focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {vdis.length === 0 && <option value="">没有可附加磁盘</option>}
                    {vdis.map((vdi) => (
                      <option key={vdi.ref} value={vdi.ref}>
                        {vdi.name_label || vdi.ref} · {vdi.srName} · {formatBytes(Number(vdi.virtual_size) || 0)}
                      </option>
                    ))}
                  </select>
                </div>

                {selected && (
                  <div className="rounded-lg border border-border bg-background p-3 text-sm text-secondary-foreground">
                    <div className="flex items-center gap-2">
                      <HardDrive className="h-4 w-4 text-subtle" />
                      <span>{formatBytes(Number(selected.virtual_size) || 0)}</span>
                      <span className="text-subtle">/</span>
                      <span>{selected.srName}</span>
                    </div>
                    {selected.forceReadOnly && (
                      <p className="mt-2 text-xs text-warning">该磁盘已被其他 VBD 使用，将以只读方式附加。</p>
                    )}
                  </div>
                )}

                <label className="flex items-center gap-2 text-sm text-secondary-foreground">
                  <input
                    type="checkbox"
                    checked={readOnly}
                    onChange={(event) => setReadOnly(event.target.checked)}
                    disabled={saving || selected?.forceReadOnly}
                    className="h-4 w-4 rounded border-input bg-muted text-accent-foreground focus:ring-primary"
                  />
                  只读附加
                </label>
              </>
            )}

            {error && (
              <div role="alert" className="rounded-lg border border-danger/30 bg-danger-soft p-3 text-sm text-danger">
                {error}
                {!saving && <button type="button" onClick={() => setReload((value) => value + 1)} className="ml-2 underline">重新读取可附加磁盘</button>}
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-border bg-card px-6 py-4">
            <button onClick={handleClose} disabled={saving} className="px-4 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50">
              取消
            </button>
            <button
              onClick={handleSubmit}
              disabled={saving || loading || !!error || !selected}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-secondary disabled:text-subtle"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link className="h-4 w-4" />}
              附加
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
