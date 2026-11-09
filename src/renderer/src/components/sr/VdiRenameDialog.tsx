import { useEffect, useRef, useState } from 'react'
import type { VdiRecord } from '../../types/xapi'
import { DesktopDialog } from '../layout/DesktopDialog'
import { getConnectionReadIdentity } from '../../store/multiData.store'
import { readOperationResult, ReadScopeChangedError } from '../../../../shared/read-operation-result'

export function VdiRenameDialog({ vdi, connectionId, srRef, disabled, onClose, onRead, onSaved }: {
  vdi: VdiRecord
  connectionId: string
  srRef: string
  disabled: boolean
  onClose: () => void
  onRead: (records: VdiRecord[]) => void
  onSaved: (name: string) => void
}) {
  const [name, setName] = useState(vdi.name_label)
  const [currentName, setCurrentName] = useState(vdi.name_label)
  const [saving, setSaving] = useState(false)
  const inFlight = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [needsRead, setNeedsRead] = useState(false)
  const identity = useRef(getConnectionReadIdentity(connectionId))
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const isCurrent = () => mounted.current && getConnectionReadIdentity(connectionId) === identity.current

  const reread = async () => {
    return readOperationResult(async () => {
      const records = await window.xapi.storage.listVdis(connectionId, srRef)
      const current = records.find((record) => record.ref === vdi.ref)
      if (!current) throw new Error('当前存储仓库中已找不到该虚拟磁盘。')
      if (current.uuid !== vdi.uuid) throw new ReadScopeChangedError()
      if (!isCurrent()) throw new ReadScopeChangedError()
      onRead(records)
      return current
    }, { isCurrent })
  }

  const save = async () => {
    if (inFlight.current || disabled || needsRead || !name.trim()) return
    inFlight.current = true
    setSaving(true)
    setError(null)
    let writeError: unknown
    try {
      try { await window.xapi.storage.setVdiNameLabel(connectionId, vdi.ref, name.trim()) }
      catch (failure) { writeError = failure }
      setNeedsRead(true)
      const current = await reread()
      if (current.name_label !== name.trim()) {
        setCurrentName(current.name_label)
        setNeedsRead(false)
        throw new Error(`名称仍为“${current.name_label}”，保存未生效。${writeError instanceof Error ? writeError.message : ''}`)
      }
      onSaved(current.name_label)
      onClose()
    } catch (failure) {
      if (isCurrent()) setError(`无法完成重命名：${failure instanceof Error ? failure.message : String(failure)}`)
    } finally {
      inFlight.current = false
      if (isCurrent()) setSaving(false)
    }
  }

  const reconcile = async () => {
    if (inFlight.current || disabled) return
    inFlight.current = true
    setSaving(true)
    try {
      const current = await reread()
      setName(current.name_label)
      setCurrentName(current.name_label)
      setNeedsRead(false)
      setError(null)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '读取当前名称失败')
    } finally {
      inFlight.current = false
      setSaving(false)
    }
  }

  return <DesktopDialog title="重命名虚拟磁盘" onClose={onClose} busy={saving}>
    <form className="space-y-4 rounded-xl border border-input bg-card p-5" onSubmit={(event) => { event.preventDefault(); void save() }}>
      <h3 className="text-lg font-semibold text-foreground">重命名虚拟磁盘</h3>
      <p className="break-all text-sm text-muted-foreground">当前名称：{currentName || '未命名磁盘'}</p>
      <label className="block text-sm text-secondary-foreground">虚拟磁盘名称
        <input aria-label="虚拟磁盘名称" autoFocus value={name} disabled={saving || needsRead || disabled}
          onChange={(event) => setName(event.target.value)} className="mt-1 block w-full rounded-lg border border-input bg-muted px-3 py-2 text-foreground" />
      </label>
      {error && <p role="alert" className="break-words text-sm text-warning">{error}</p>}
      {disabled && <p role="alert" className="text-sm text-warning">管理连接或磁盘清单不可用，请关闭表单并重新读取。</p>}
      <div className="flex flex-wrap justify-end gap-3">
        <button type="button" disabled={saving} onClick={onClose} className="rounded px-3 py-2 text-sm text-secondary-foreground">取消</button>
        {needsRead ? <button type="button" disabled={saving || disabled} onClick={() => void reconcile()} className="rounded bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50">重新读取当前名称</button>
          : <button type="submit" disabled={saving || disabled || !name.trim() || name.trim() === currentName} className="rounded bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50">{saving ? '正在保存...' : '保存名称'}</button>}
      </div>
    </form>
  </DesktopDialog>
}
