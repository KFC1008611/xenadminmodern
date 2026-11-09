import { useEffect, useRef, useState } from 'react'
import { Info } from 'lucide-react'
import type { VmDetailRecord } from '../../types/xapi'
import { GIB, sameVmMemory, validateVmMemoryLimits, vmMemoryEditReason, vmMemoryLimits } from '../../../../shared/vm-memory'
import { feedback } from '../../store/feedback.store'
import { formatMemoryBytes } from '../../lib/utils'
import { VmSettingsDialog, vmSettingsInput } from './VmSettingsDialog'
import { readOperationResult, ReadScopeChangedError } from '../../../../shared/read-operation-result'
import { getConnectionReadIdentity } from '../../store/multiData.store'

export function VmMemoryDialog({ vm, connectionId, onClose, onUpdated }: {
  vm: VmDetailRecord
  connectionId: string
  onClose: () => void
  onUpdated: (record: VmDetailRecord) => void
}) {
  const [baseline] = useState(() => vmMemoryLimits(vm))
  const [mode, setMode] = useState<'fixed' | 'dynamic'>(baseline.dynamicMin === baseline.dynamicMax ? 'fixed' : 'dynamic')
  const [minimum, setMinimum] = useState(String(baseline.dynamicMin / GIB))
  const [maximum, setMaximum] = useState(String(baseline.dynamicMax / GIB))
  const [startupMax, setStartupMax] = useState(String(baseline.staticMax / GIB))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [needsReload, setNeedsReload] = useState(false)
  const inFlight = useRef(false)
  const scope = JSON.stringify([connectionId, vm.ref, vm.uuid])
  const currentScope = useRef(scope)
  currentScope.current = scope
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const halted = vm.power_state === 'Halted'
  const bytes = (value: string) => value.trim() ? Number(value) * GIB : NaN
  const fixedCapacityChanged = mode === 'fixed'
    && (baseline.dynamicMin !== baseline.dynamicMax || bytes(maximum) !== baseline.dynamicMax)
  const limits = {
    staticMin: baseline.staticMin,
    dynamicMin: mode === 'fixed' ? bytes(maximum) : bytes(minimum),
    dynamicMax: bytes(maximum),
    staticMax: halted ? (fixedCapacityChanged ? bytes(maximum) : bytes(startupMax)) : baseline.staticMax,
  }
  const validation = validateVmMemoryLimits(limits)
  const reason = vmMemoryEditReason(vm, limits)
  const changed = !sameVmMemory(baseline, limits)

  const save = async () => {
    if (inFlight.current || validation || reason || !changed || needsReload) return
    inFlight.current = true
    setSaving(true)
    setError(null)
    const identity = getConnectionReadIdentity(connectionId)
    const isCurrent = () => mounted.current && currentScope.current === scope && getConnectionReadIdentity(connectionId) === identity
    const read = () => readOperationResult(async () => {
      const record = await window.xapi.vm.getRecord(connectionId, vm.ref)
      if (record.uuid !== vm.uuid) throw new ReadScopeChangedError()
      return record
    }, { isCurrent })
    const complete = (record: VmDetailRecord) => {
      onUpdated(record)
      feedback.success('虚拟机内存配置已保存')
      onClose()
    }
    try {
      const current = await read()
      if (!sameVmMemory(vmMemoryLimits(current), baseline)) {
        throw new Error('内存配置已被其他操作修改，请关闭窗口并重新编辑。')
      }
      const currentReason = vmMemoryEditReason(current, limits)
      if (currentReason) throw new Error(currentReason)
      await window.xapi.vm.setMemoryLimits(connectionId, vm.ref, limits.staticMin, limits.dynamicMin, limits.dynamicMax, limits.staticMax)
      const updated = await read()
      if (!sameVmMemory(vmMemoryLimits(updated), limits)) throw new Error('读回的内存配置与提交值不一致。')
      complete(updated)
    } catch (cause) {
      if (!isCurrent()) return
      const message = cause instanceof Error ? cause.message : String(cause)
      // A transport/readback failure can follow a successful mutation; do not offer blind retry.
      setNeedsReload(true)
      try {
        const actual = await read()
        if (sameVmMemory(vmMemoryLimits(actual), limits)) { complete(actual); return }
        onUpdated(actual)
        setError(message)
      } catch {
        if (isCurrent()) setError(`无法获取保存结果：${message}`)
      }
    } finally {
      inFlight.current = false
      if (isCurrent()) setSaving(false)
    }
  }

  const field = (id: string, label: string, value: string, update: (value: string) => void) => (
    <div>
      <label htmlFor={id} className="mb-2 block text-sm font-medium text-secondary-foreground">{label}</label>
      <div className="relative">
        <input id={id} type="number" min="0" step="any" required value={value} onChange={(event) => update(event.target.value)} className={`${vmSettingsInput} pr-14`} />
        <span className="pointer-events-none absolute right-3 top-3 text-xs text-subtle">GiB</span>
      </div>
    </div>
  )

  return (
    <VmSettingsDialog title="调整内存" description={vm.name_label} saving={saving} disabled={!!validation || !!reason || !changed || needsReload} error={error}
      onClose={onClose} onSave={() => void save()}>
      <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="内存分配方式">
        {([{ value: 'fixed', title: '固定内存', detail: '始终分配同一容量' }, { value: 'dynamic', title: '动态内存', detail: '在指定范围内分配' }] as const).map((option) => (
          <label key={option.value} className={`cursor-pointer rounded-xl border p-3 transition ${mode === option.value ? 'border-primary/30 bg-accent' : 'border-input hover:border-input'}`}>
            <span className="flex items-center gap-2 text-sm font-medium text-foreground"><input type="radio" name="memory-mode" checked={mode === option.value} onChange={() => setMode(option.value)} className="accent-primary" />{option.title}</span>
            <span className="mt-1.5 block text-xs text-muted-foreground">{option.detail}</span>
          </label>
        ))}
      </div>
      {mode === 'fixed' ? field('memory-fixed', '分配内存', maximum, setMaximum) : (
        <div className="grid grid-cols-2 gap-4">{field('memory-min', '动态下限', minimum, setMinimum)}{field('memory-max', '动态上限', maximum, setMaximum)}</div>
      )}
      {halted && mode === 'dynamic' && <div>{field('memory-startup', '启动内存上限', startupMax, setStartupMax)}<p className="mt-2 text-xs text-subtle">为动态调整预留的上限，不能低于动态上限。</p></div>}
      <div className="flex gap-2.5 rounded-xl bg-muted p-3 text-xs leading-relaxed text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent-foreground" />
        <p>{halted ? '保存后将在下次启动时使用新配置。' : `运行中可在 ${formatMemoryBytes(baseline.staticMin)} 至 ${formatMemoryBytes(baseline.staticMax)} 内调整。修改启动上限需先关机。`}
          {' '}静态下限 {formatMemoryBytes(baseline.staticMin)} 由平台保留。1 GiB = 1024 MiB。动态分配依赖来宾内存驱动，实际分配可能延后变化。</p>
      </div>
      {(validation || reason) && <p role="status" className="text-sm text-warning">{validation || reason}</p>}
    </VmSettingsDialog>
  )
}
