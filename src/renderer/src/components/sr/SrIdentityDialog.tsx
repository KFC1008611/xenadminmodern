import { useRef, useState } from 'react'
import type { ConnectedSrRecord } from '../../types/xapi'
import { applySrIdentityRecord, getConnectionReadIdentity } from '../../store/multiData.store'
import { DesktopDialog } from '../layout/DesktopDialog'
import { readOperationResult, ReadScopeChangedError } from '../../../../shared/read-operation-result'

export function SrIdentityDialog({ sr, connectionId, disabled, onClose, onSaved }: {
  sr: ConnectedSrRecord; connectionId: string; disabled: boolean; onClose: () => void; onSaved: () => void
}) {
  const connectionIdentity = useRef(getConnectionReadIdentity(connectionId))
  const [baseline, setBaseline] = useState({ nameLabel: sr.name_label, nameDescription: sr.name_description ?? '' })
  const [name, setName] = useState(sr.name_label)
  const [description, setDescription] = useState(sr.name_description ?? '')
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const [needsRead, setNeedsRead] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const changed = name.trim() !== baseline.nameLabel || description !== baseline.nameDescription
  const updateRecord = (nameLabel: string, nameDescription: string) => {
    if (!applySrIdentityRecord(connectionId, sr.ref, { nameLabel, nameDescription }, connectionIdentity.current)) throw new Error('管理连接已变化，请在当前连接中重新读取仓库。')
  }
  const readCurrent = () => readOperationResult(async () => {
    const records = await window.xapi.storage.listSrs(connectionId)
    const actual = records.find((record) => record.ref === sr.ref)
    if (!actual || typeof actual.name_description !== 'string') throw new Error('无法读取仓库的完整名称和描述。')
    if (actual.uuid !== sr.uuid) throw new ReadScopeChangedError()
    return actual
  }, { isCurrent: () => getConnectionReadIdentity(connectionId) === connectionIdentity.current })
  const save = async () => {
    if (inFlight.current || disabled || needsRead || !changed || !name.trim()) return
    inFlight.current = true; setBusy(true); setError(null)
    try {
      const actual = await window.xapi.sr.updateIdentity(connectionId, sr.ref, {
        nameLabel: name.trim(), nameDescription: description,
        expectedNameLabel: baseline.nameLabel, expectedNameDescription: baseline.nameDescription,
      })
      updateRecord(actual.nameLabel, actual.nameDescription)
      onSaved(); onClose()
    } catch (failure) {
      try {
        const actual = await readCurrent()
        updateRecord(actual.name_label, actual.name_description!)
        if (actual.name_label === name.trim() && actual.name_description === description) { onSaved(); onClose(); return }
        setBaseline({ nameLabel: actual.name_label, nameDescription: actual.name_description! })
        setError(`保存未全部完成，当前名称为“${actual.name_label}”。${failure instanceof Error ? failure.message : String(failure)}`)
      } catch (readFailure) {
        setNeedsRead(true)
        setError(`无法获取仓库保存结果：${readFailure instanceof Error ? readFailure.message : String(readFailure)}`)
      }
    } finally { inFlight.current = false; setBusy(false) }
  }
  const reread = async () => {
    if (inFlight.current || disabled) return
    inFlight.current = true; setBusy(true)
    try {
      const actual = await readCurrent()
      updateRecord(actual.name_label, actual.name_description!)
      setBaseline({ nameLabel: actual.name_label, nameDescription: actual.name_description! })
      setName(actual.name_label); setDescription(actual.name_description!); setNeedsRead(false)
      setError(null)
    } catch (failure) { setError(failure instanceof Error ? failure.message : '读取失败') }
    finally { inFlight.current = false; setBusy(false) }
  }
  return <DesktopDialog title="编辑存储仓库信息" onClose={onClose} busy={busy}>
    <form className="space-y-4 rounded-xl border border-input bg-card p-5" onSubmit={(event) => { event.preventDefault(); void save() }}>
      <h3 className="text-lg font-semibold text-foreground">编辑存储仓库信息</h3>
      <p className="text-sm text-muted-foreground">资源池：{sr.poolName || connectionId}</p>
      <label className="block text-sm text-secondary-foreground">存储仓库名称<input aria-label="存储仓库名称" autoFocus value={name} disabled={busy || disabled || needsRead} onChange={(event) => setName(event.target.value)} className="mt-1 block w-full rounded-lg border border-input bg-muted px-3 py-2 text-foreground" /></label>
      <label className="block text-sm text-secondary-foreground">存储仓库描述<textarea aria-label="存储仓库描述" rows={3} value={description} disabled={busy || disabled || needsRead} onChange={(event) => setDescription(event.target.value)} className="mt-1 block w-full rounded-lg border border-input bg-muted px-3 py-2 text-foreground" /></label>
      <p className="text-xs text-subtle">描述留空会清除原有描述。</p>
      {error && <p role="alert" className="break-words text-sm text-warning">{error}</p>}
      <div className="flex flex-wrap justify-end gap-3">
        <button type="button" disabled={busy} onClick={onClose} className="rounded px-3 py-2 text-sm text-secondary-foreground">取消</button>
        {needsRead ? <button type="button" disabled={busy || disabled} onClick={() => void reread()} className="rounded bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50">重新读取仓库信息</button>
          : <button type="submit" disabled={busy || disabled || !changed || !name.trim()} className="rounded bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50">{busy ? '正在保存...' : '保存仓库信息'}</button>}
      </div>
    </form>
  </DesktopDialog>
}
