/**
 * SnapshotsTab — list, create, rename, revert and delete VM snapshots.
 * Uses Radix Dialog for confirmation prompts.
 */
import { useCallback, useEffect, useState, useRef } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import {
  Camera,
  RefreshCw,
  Trash2,
  RotateCcw,
  Pencil,
  Check,
  X,
  AlertTriangle,
  ImageOff,
  Loader2,
} from 'lucide-react'
import type { SnapshotRecord } from '../../types/xapi'
import { formatBytes } from '../../lib/utils'
import { feedback } from '../../store/feedback.store'
import { executeAction } from '../../lib/executeAction'

interface Props {
  vmRef: string
  connectionId: string
  powerState: string
  refreshKey?: number | string
  canCreate?: boolean
}

// ── Confirmation Dialog ────────────────────────────────────────────────────────

interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  confirmLabel?: string
  danger?: boolean
  onConfirm: () => void | Promise<void>
}

function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = '确认',
  danger = false,
  onConfirm,
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { if (open) setError(null) }, [open])

  const handleConfirm = async () => {
    setBusy(true)
    try {
      await onConfirm()
      onOpenChange(false)
    } catch (error: any) {
      setError(error?.message || String(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next) }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content onEscapeKeyDown={(event) => { if (busy) event.preventDefault() }} onPointerDownOutside={(event) => { if (busy) event.preventDefault() }} className="max-h-[calc(100dvh-4rem)] overflow-y-auto fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[calc(100%-2rem)] max-w-md bg-card border border-input rounded-xl shadow-2xl p-6 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">
          <div className="flex items-start gap-4">
            <div
              className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${danger ? 'bg-danger-soft' : 'bg-accent'}`}
            >
              <AlertTriangle
                className={`w-5 h-5 ${danger ? 'text-danger' : 'text-accent-foreground'}`}
              />
            </div>
            <div className="flex-1 min-w-0">
              <Dialog.Title className="text-base font-semibold text-foreground">{title}</Dialog.Title>
              <Dialog.Description className="mt-1.5 text-sm text-muted-foreground">
                {description}
              </Dialog.Description>
            </div>
          </div>

          {error && <p role="alert" className="mt-4 break-words text-sm text-danger">{error}</p>}
          <div className="flex items-center justify-end gap-3 mt-6">
            <Dialog.Close asChild>
              <button
                disabled={busy}
                className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground bg-muted hover:bg-secondary rounded-lg transition-colors"
              >
                取消
              </button>
            </Dialog.Close>
            <button
              onClick={handleConfirm}
              disabled={busy || !!error}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
                danger
                  ? 'bg-danger-solid text-on-solid hover:bg-danger-solid'
                  : 'bg-primary text-primary-foreground hover:bg-primary-hover'
              }`}
            >
              {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {confirmLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

// ── Snapshots Tab ─────────────────────────────────────────────────────────────

export function SnapshotsTab(props: Props) {
  return <ScopedSnapshotsTab key={`${props.connectionId}:${props.vmRef}`} {...props} />
}

function ScopedSnapshotsTab({ vmRef, connectionId, powerState: _powerState, refreshKey = 0, canCreate = true }: Props) {
  // feedback used directly

  const [snapshots, setSnapshots] = useState<SnapshotRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [readError, setReadError] = useState<string | null>(null)
  const readGeneration = useRef(0)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // Inline rename state
  const [renamingRef, setRenamingRef] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)

  // Action busy state
  const [actionBusy, setActionBusy] = useState(false)

  // Snapshot creation
  const [snapping, setSnapping] = useState(false)

  // Confirm dialog state
  const [confirmState, setConfirmState] = useState<{
    open: boolean
    title: string
    description: string
    confirmLabel: string
    danger: boolean
    onConfirm: () => Promise<void>
  }>({
    open: false,
    title: '',
    description: '',
    confirmLabel: '确认',
    danger: false,
    onConfirm: async () => {},
  })

  const refresh = useCallback(async () => {
    if (!connectionId) return
    const generation = ++readGeneration.current
    setLoading(true)
    setReadError(null)
    try {
      const data = await window.xapi.vm.getSnapshots(connectionId, vmRef)
      if (generation !== readGeneration.current) return
      setSnapshots(data)
      setSelected(new Set())
    } catch (e: any) {
      if (generation === readGeneration.current) setReadError(e?.message || String(e))
    } finally {
      if (generation === readGeneration.current) setLoading(false)
    }
  }, [connectionId, vmRef])

  useEffect(() => {
    void refresh()
    return () => { readGeneration.current++ }
  }, [refresh, refreshKey])

  // Focus rename input when entering rename mode
  useEffect(() => {
    if (renamingRef) {
      const timer = setTimeout(() => renameInputRef.current?.focus(), 50)
      return () => clearTimeout(timer)
    }
    return undefined
  }, [renamingRef])

  const handleTakeSnapshot = async () => {
    if (!connectionId || !canCreate || snapping || actionBusy || loading || readError) return
    const name = `snapshot-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`
    setSnapping(true)
    await executeAction({
      label: '创建快照',
      action: () => window.xapi.vm.snapshot(connectionId, vmRef, name).then(() => {}),
      onSuccess: () => refresh(),
    })
    setSnapping(false)
  }

  const startRename = (snap: SnapshotRecord) => {
    setRenamingRef(snap.ref)
    setRenameValue(snap.name_label)
  }

  const commitRename = async (snap: SnapshotRecord) => {
    if (!connectionId) return
    const trimmed = renameValue.trim()
    if (!trimmed || trimmed === snap.name_label) {
      setRenamingRef(null)
      return
    }
    setActionBusy(true)
    await executeAction({
      label: '重命名快照',
      action: () => window.xapi.vm.renameSnapshot(connectionId, snap.ref, trimmed),
      onSuccess: () => refresh(),
    })
    setActionBusy(false)
    setRenamingRef(null)
  }

  const confirmRevert = (snap: SnapshotRecord) => {
    if (!connectionId) return
    setConfirmState({
      open: true,
      title: '确认恢复快照',
      description: `将把 VM 恢复到快照"${snap.name_label}"的状态。当前运行状态和数据将丢失，此操作不可撤销。`,
      confirmLabel: '恢复',
      danger: true,
      onConfirm: async () => {
        await window.xapi.vm.revertSnapshot(connectionId, snap.ref)
        feedback.success(`已恢复到快照：${snap.name_label}`)
        await refresh()
      },
    })
  }

  const confirmDelete = (refs: string[], label?: string) => {
    if (!connectionId) return
    const count = refs.length
    setConfirmState({
      open: true,
      title: count > 1 ? `确认删除 ${count} 个快照` : '确认删除快照',
      description:
        count > 1
          ? `将永久删除选中的 ${count} 个快照，此操作不可撤销。`
          : `将永久删除快照"${label}"，此操作不可撤销。`,
      confirmLabel: '删除',
      danger: true,
      onConfirm: async () => {
        const failedSnapshots: string[] = []
        const retainedDisks: string[] = []
        for (const ref of refs) {
          try {
            const result = await window.xapi.vm.deleteSnapshot(connectionId, ref)
            retainedDisks.push(...result.failedVdiRefs)
          } catch {
            failedSnapshots.push(ref)
          }
        }
        await refresh()
        if (failedSnapshots.length || retainedDisks.length) {
          feedback.error(`已删除 ${count - failedSnapshots.length} 个快照；${failedSnapshots.length} 个删除失败，${retainedDisks.length} 个磁盘仍保留。请检查快照和存储列表。`)
        } else {
          feedback.success(count > 1 ? `已删除 ${count} 个快照` : '快照已删除')
        }
      },
    })
  }

  const toggleSelect = (ref: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(ref)) next.delete(ref)
      else next.add(ref)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selected.size === snapshots.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(snapshots.map((s) => s.ref)))
    }
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-medium text-foreground">
            快照{loading ? '' : ` (${snapshots.length})`}
          </h3>
          {selected.size > 0 && (
            <button
              disabled={loading || !!readError || actionBusy || snapping}
              onClick={() =>
                confirmDelete(
                  Array.from(selected),
                )
              }
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-danger hover:text-danger bg-danger-soft hover:bg-danger-soft rounded-lg transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              删除选中 ({selected.size})
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={refresh}
            disabled={loading}
            className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
            title="刷新"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={handleTakeSnapshot}
            disabled={snapping || actionBusy || loading || !!readError || !canCreate}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-primary-foreground bg-primary hover:bg-primary-hover disabled:bg-accent disabled:text-subtle disabled:cursor-not-allowed rounded-lg transition-colors"
          >
            {snapping ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Camera className="w-4 h-4" />
            )}
            {snapping ? '拍摄中…' : '拍摄快照'}
          </button>
        </div>
      </div>

      {readError && <div role="alert" className="rounded-lg border border-warning/30 p-3 text-sm text-warning break-words">快照读取失败：{readError}。请刷新后再操作。</div>}
      {/* Snapshots table */}
      {readError ? null : loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="flex flex-col items-center gap-3 text-subtle">
            <Loader2 className="w-6 h-6 animate-spin text-accent-foreground" />
            <span className="text-sm">加载快照列表…</span>
          </div>
        </div>
      ) : snapshots.length === 0 ? (
        <div className="flex flex-col items-center gap-4 py-16 text-center">
          <div className="w-14 h-14 flex items-center justify-center rounded-full bg-card border border-border">
            <ImageOff className="w-7 h-7 text-subtle" />
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground">此 VM 暂无快照</p>
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="overflow-x-auto">
          <table className="min-w-[720px] w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={selected.size === snapshots.length && snapshots.length > 0}
                    onChange={toggleSelectAll}
                    className="rounded border-input bg-muted text-accent-foreground focus:ring-primary focus:ring-offset-card cursor-pointer"
                    aria-label="全选"
                  />
                </th>
                <th className="text-left px-4 py-3 text-xs text-subtle font-medium uppercase tracking-wider">
                  名称
                </th>
                <th className="text-left px-4 py-3 text-xs text-subtle font-medium uppercase tracking-wider">
                  创建时间
                </th>
                <th className="text-left px-4 py-3 text-xs text-subtle font-medium uppercase tracking-wider">
                  大小
                </th>
                <th className="sticky right-0 z-10 bg-card text-right px-4 py-3 text-xs text-subtle font-medium uppercase tracking-wider">
                  操作
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {snapshots.map((snap) => (
                <tr
                  key={snap.ref}
                  className={`hover:bg-muted transition-colors ${selected.has(snap.ref) ? 'bg-accent' : ''}`}
                >
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selected.has(snap.ref)}
                      onChange={() => toggleSelect(snap.ref)}
                      className="rounded border-input bg-muted text-accent-foreground focus:ring-primary focus:ring-offset-card cursor-pointer"
                      aria-label={`选择快照 ${snap.name_label}`}
                    />
                  </td>
                  <td className="px-4 py-3">
                    {renamingRef === snap.ref ? (
                      <div className="flex items-center gap-2">
                        <input
                          ref={renameInputRef}
                          type="text"
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitRename(snap)
                            if (e.key === 'Escape') setRenamingRef(null)
                          }}
                          className="flex-1 px-2 py-1 bg-muted border border-primary/30 rounded text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary min-w-0"
                          disabled={actionBusy}
                        />
                        <button
                          onClick={() => commitRename(snap)}
                          disabled={actionBusy}
                          className="p-1 text-success hover:text-success hover:bg-success-soft rounded transition-colors"
                          title="确认"
                        >
                          {actionBusy ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Check className="w-4 h-4" />
                          )}
                        </button>
                        <button
                          onClick={() => setRenamingRef(null)}
                          disabled={actionBusy}
                          className="p-1 text-muted-foreground hover:text-foreground hover:bg-secondary rounded transition-colors"
                          title="取消"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => startRename(snap)}
                        className="group flex items-center gap-1.5 text-left text-foreground hover:text-accent-foreground transition-colors"
                        title="点击重命名"
                      >
                        <span className="truncate max-w-xs">{snap.name_label}</span>
                        <Pencil className="w-3.5 h-3.5 opacity-0 group-hover:opacity-60 transition-opacity flex-shrink-0" />
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-sm whitespace-nowrap">
                    {snap.snapshot_time
                      ? new Date(snap.snapshot_time).toLocaleString('zh-CN')
                      : '—'}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-sm">
                    {snap.size > 0 ? formatBytes(snap.size) : '—'}
                  </td>
                  <td className="sticky right-0 bg-card px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => confirmRevert(snap)}
                        disabled={actionBusy || snapping}
                        className="flex items-center gap-1 px-2 py-1 text-xs text-warning hover:text-warning hover:bg-warning-soft rounded-lg transition-colors"
                        title="恢复到此快照"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        恢复
                      </button>
                      <button
                        onClick={() => confirmDelete([snap.ref], snap.name_label)}
                        disabled={actionBusy || snapping}
                        className="flex items-center gap-1 px-2 py-1 text-xs text-danger hover:text-danger hover:bg-danger-soft rounded-lg transition-colors"
                        title="删除快照及其独占磁盘"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {/* Confirm dialog */}
      <ConfirmDialog
        open={confirmState.open}
        onOpenChange={(open) => setConfirmState((s) => ({ ...s, open }))}
        title={confirmState.title}
        description={confirmState.description}
        confirmLabel={confirmState.confirmLabel}
        danger={confirmState.danger}
        onConfirm={confirmState.onConfirm}
      />
    </div>
  )
}
