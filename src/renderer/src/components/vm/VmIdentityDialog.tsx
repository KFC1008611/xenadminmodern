import { useEffect, useRef, useState } from 'react'
import type { VmDetailRecord } from '../../types/xapi'
import { feedback } from '../../store/feedback.store'
import { VmSettingsDialog, vmSettingsInput } from './VmSettingsDialog'
import { readOperationResult, ReadScopeChangedError } from '../../../../shared/read-operation-result'
import { getConnectionReadIdentity } from '../../store/multiData.store'

export function VmIdentityDialog({ vm, connectionId, onClose, onUpdated }: {
  vm: VmDetailRecord
  connectionId: string
  onClose: () => void
  onUpdated: (record: VmDetailRecord) => void
}) {
  const [baseline, setBaseline] = useState(vm)
  const [name, setName] = useState(vm.name_label)
  const [description, setDescription] = useState(vm.name_description)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [unknown, setUnknown] = useState(false)
  const inFlight = useRef(false)
  const scope = JSON.stringify([connectionId, vm.ref, vm.uuid])
  const currentScope = useRef(scope)
  currentScope.current = scope
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const changed = name.trim() !== baseline.name_label || description !== baseline.name_description
  const blocked = vm.is_control_domain || vm.is_a_snapshot || vm.is_a_template || vm.locked || vm.Locked

  const save = async () => {
    if (inFlight.current || !changed || !name.trim() || blocked || unknown) return
    inFlight.current = true
    setSaving(true)
    setError(null)
    const desiredName = name.trim()
    const identity = getConnectionReadIdentity(connectionId)
    const isCurrent = () => mounted.current && currentScope.current === scope && getConnectionReadIdentity(connectionId) === identity
    const read = () => readOperationResult(async () => {
      const record = await window.xapi.vm.getRecord(connectionId, vm.ref)
      if (record.uuid !== vm.uuid) throw new ReadScopeChangedError()
      return record
    }, { isCurrent })
    const nameChanged = desiredName !== baseline.name_label
    const descriptionChanged = description !== baseline.name_description
    const matchesDesired = (record: VmDetailRecord) => (!nameChanged || record.name_label === desiredName)
      && (!descriptionChanged || record.name_description === description)
    const complete = (record: VmDetailRecord) => {
      onUpdated(record)
      feedback.success('虚拟机名称和简介已保存')
      onClose()
    }
    try {
      const current = await read()
      if (current.is_control_domain || current.is_a_template || current.is_a_snapshot || current.locked || current.Locked) {
        throw new Error('当前虚拟机不可编辑，请关闭窗口并刷新。')
      }
      if ((nameChanged && current.name_label !== baseline.name_label && current.name_label !== desiredName)
        || (descriptionChanged && current.name_description !== baseline.name_description && current.name_description !== description)) {
        setUnknown(true)
        throw new Error('名称或简介已被其他操作修改，请关闭窗口并重新编辑。')
      }
      // Each field is independent. Never submit CPU or memory from an identity edit.
      if (nameChanged && desiredName !== current.name_label) await window.xapi.vm.setNameLabel(connectionId, vm.ref, desiredName)
      if (descriptionChanged && description !== current.name_description) await window.xapi.vm.setNameDescription(connectionId, vm.ref, description)
      const updated = await read()
      if (!matchesDesired(updated)) throw new Error('服务器返回的名称或简介与提交值不一致。')
      complete(updated)
    } catch (cause) {
      if (!isCurrent()) return
      const message = cause instanceof Error ? cause.message : String(cause)
      try {
        const actual = await read()
        if (matchesDesired(actual)) { complete(actual); return }
        const applied: string[] = []
        const pending: string[] = []
        if (desiredName !== baseline.name_label) (actual.name_label === desiredName ? applied : pending).push('名称')
        if (description !== baseline.name_description) (actual.name_description === description ? applied : pending).push('简介')
        setBaseline(actual)
        onUpdated(actual)
        setError(`${applied.length ? `${applied.join('、')}已生效。` : ''}${pending.length ? `未完成：${pending.join('、')}。` : ''}${message}`)
      } catch {
        setUnknown(true)
        if (isCurrent()) setError(`无法获取保存结果：${message}`)
      }
    } finally {
      inFlight.current = false
      if (isCurrent()) setSaving(false)
    }
  }

  return (
    <VmSettingsDialog title="编辑名称和简介" description={vm.name_label} saving={saving}
      disabled={!changed || !name.trim() || !!blocked || unknown} error={error} onClose={onClose} onSave={() => void save()}>
      <div>
        <label htmlFor="vm-name" className="mb-2 block text-sm font-medium text-secondary-foreground">虚拟机名称</label>
        <input id="vm-name" required value={name} onChange={(event) => setName(event.target.value)} className={vmSettingsInput} autoFocus />
        {!name.trim() && <p className="mt-2 text-xs text-danger">名称不能为空。</p>}
      </div>
      <div>
        <label htmlFor="vm-description" className="mb-2 block text-sm font-medium text-secondary-foreground">简介 <span className="font-normal text-subtle">（可选）</span></label>
        <textarea id="vm-description" rows={4} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="例如：生产环境 Web 服务，负责人及维护说明" className={`${vmSettingsInput} resize-y`} />
        <p className="mt-2 text-xs text-subtle">留空可清除现有简介。</p>
      </div>
    </VmSettingsDialog>
  )
}
