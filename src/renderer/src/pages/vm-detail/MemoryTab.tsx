import { useState } from 'react'
import { ArrowRight, Edit3, MemoryStick } from 'lucide-react'
import type { VmDetailRecord } from '../../types/xapi'
import { formatMemoryBytes } from '../../lib/utils'
import { validateVmMemoryLimits, vmMemoryEditReason, vmMemoryLimits } from '../../../../shared/vm-memory'
import { VmMemoryDialog } from '../../components/vm/VmMemoryDialog'

export function MemoryTab({ vm, connectionId, onUpdated, busy = false }: {
  vm: VmDetailRecord
  connectionId: string
  onUpdated: (record: VmDetailRecord) => void
  busy?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const limits = vmMemoryLimits(vm)
  const fixed = limits.dynamicMin === limits.dynamicMax
  const reason = validateVmMemoryLimits(limits) || vmMemoryEditReason(vm)
  const cards = [
    { label: '当前分配', value: vm.power_state === 'Halted' ? '未运行' : vm.memory_actual === undefined ? '暂不可用' : formatMemoryBytes(vm.memory_actual), detail: '主机分配给 VM 的内存' },
    { label: fixed ? '固定分配' : '动态分配范围', value: fixed ? formatMemoryBytes(limits.dynamicMax) : `${formatMemoryBytes(limits.dynamicMin)} – ${formatMemoryBytes(limits.dynamicMax)}`, detail: fixed ? '动态下限与上限相同' : '根据主机和来宾需求调整' },
    { label: '启动内存上限', value: formatMemoryBytes(limits.staticMax), detail: '修改此上限需要先关机' },
  ]
  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div className="flex items-center gap-3"><div className="rounded-lg bg-accent p-2"><MemoryStick className="h-5 w-5 text-accent-foreground" /></div><div><h2 className="text-sm font-medium text-foreground">内存配置</h2><p className="mt-1 text-xs text-muted-foreground">{fixed ? '固定内存' : '动态内存'} · {vm.power_state === 'Running' ? '运行中' : vm.power_state === 'Halted' ? '已关机' : vm.power_state}</p></div></div>
          <button type="button" disabled={!!reason || busy} title={reason || '调整内存'} onClick={() => setEditing(true)} className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary disabled:cursor-not-allowed disabled:opacity-40"><Edit3 className="h-4 w-4" />调整内存</button>
        </div>
        <dl className="grid grid-cols-1 gap-5 p-5 min-[900px]:grid-cols-3">
          {cards.map((card) => <div key={card.label} className="min-w-0"><dt className="text-xs text-muted-foreground">{card.label}</dt><dd className="mt-2 break-words text-xl font-semibold tracking-tight text-foreground">{card.value}</dd><p className="mt-1.5 text-xs text-subtle">{card.detail}</p></div>)}
        </dl>
      </section>
      <section className="rounded-xl border border-border bg-card p-5">
        <h3 className="text-sm font-medium text-foreground">分配边界</h3>
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-3 text-sm">
          <div><p className="text-xs text-subtle">静态下限</p><p className="mt-1 text-secondary-foreground">{formatMemoryBytes(limits.staticMin)}</p></div>
          <ArrowRight className="h-4 w-4 text-subtle" />
          <div className="rounded-lg border border-primary/20 bg-accent px-4 py-2"><p className="text-xs text-accent-foreground">动态范围</p><p className="mt-1 text-accent-foreground">{formatMemoryBytes(limits.dynamicMin)} – {formatMemoryBytes(limits.dynamicMax)}</p></div>
          <ArrowRight className="h-4 w-4 text-subtle" />
          <div><p className="text-xs text-subtle">启动上限</p><p className="mt-1 text-secondary-foreground">{formatMemoryBytes(limits.staticMax)}</p></div>
        </div>
        <p className="mt-4 text-xs leading-relaxed text-subtle">当前分配来自 XAPI，表示主机分配容量；来宾系统的已用内存请在监控页查看。运行中调整受 XAPI 能力限制，暂停或挂起时需先恢复运行或关机。</p>
        {reason && <p className="mt-3 text-sm text-warning">{reason}</p>}
      </section>
      {editing && <VmMemoryDialog vm={vm} connectionId={connectionId} onClose={() => setEditing(false)} onUpdated={onUpdated} />}
    </div>
  )
}
