import { useEffect, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Copy, Loader2, X } from 'lucide-react'
import type { VmCopyPayload, VmCopyPlan } from '../../../../shared/types/xapi'
import { useConnectionManagerStore } from '../../store/connectionManager.store'
import { useCopyStore } from '../../store/copy.store'
import { formatBytes } from '../../lib/utils'
import { feedback } from '../../store/feedback.store'

interface CopyVmDialogProps {
  open: boolean
  onClose: () => void
  vm: { ref: string; name_label: string; name_description?: string; connectionId: string; poolName?: string } | null
  onSuccess?: () => void | Promise<void>
  isTemplate?: boolean
  initialTargetConnectionId?: string
}
const field = 'w-full min-w-0 rounded-lg border border-input bg-muted px-3 py-2 text-sm text-foreground disabled:opacity-50'
export function CopyVmDialog({ open, onClose, vm, onSuccess, isTemplate = false, initialTargetConnectionId }: CopyVmDialogProps) {
  const connections = useConnectionManagerStore((s) => s.connections)
  const [newName, setNewName] = useState('')
  const [description, setDescription] = useState('')
  const [targetId, setTargetId] = useState('')
  const [mode, setMode] = useState<'clone' | 'copy'>('clone')
  const [targetSrRef, setTargetSrRef] = useState('')
  const [hostRef, setHostRef] = useState('')
  const [transferRef, setTransferRef] = useState('')
  const [storageMap, setStorageMap] = useState<Record<string, string>>({})
  const [networkMap, setNetworkMap] = useState<Record<string, string>>({})
  const [plan, setPlan] = useState<VmCopyPlan | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const submitting = useRef<symbol | null>(null)
  const sourceId = vm?.connectionId
  const vmRef = vm?.ref
  const poolIdentity = [sourceId, targetId].map((id) => {
    const c = connections.find((connection) => connection.id === id)
    return `${id}:${c?.epoch}:${c?.poolUuid}:${c?.state}`
  }).join('|')
  const scope = `${open}:${vm?.connectionId}:${vm?.ref}:${targetId}:${poolIdentity}`
  const currentScope = useRef(scope)
  currentScope.current = scope
  useEffect(() => {
    submitting.current = null
    setSaving(false)
    if (!open || !vm) return
    setNewName(`Copy of ${vm.name_label}`); setDescription(vm.name_description || '')
    setTargetId(initialTargetConnectionId || vm.connectionId); setMode('clone')
    setError(''); setPlan(null)
    return () => { submitting.current = null }
  }, [open, sourceId, vmRef, initialTargetConnectionId])
  useEffect(() => {
    if (!open || !sourceId || !vmRef || !targetId) return
    let disposed = false
    setPlan(null); setTargetSrRef(''); setHostRef(''); setTransferRef('')
    setStorageMap({}); setNetworkMap({}); setError(''); setLoading(true)
    void window.xapi.vm.copyPlan(sourceId, vmRef, targetId).then((next) => {
      if (disposed) return
      setPlan(next)
      setMode(next.allowedModes.includes('clone') ? 'clone' : 'copy')
    }).catch((e) => { if (!disposed) setError(`复制预检读取失败：${e.message}`) })
      .finally(() => { if (!disposed) setLoading(false) })
    return () => { disposed = true }
  }, [open, sourceId, vmRef, targetId, poolIdentity, revision])
  const currentPlan = plan && plan.sourceConnectionId === sourceId && plan.vmRef === vmRef && plan.targetConnectionId === targetId ? plan : null
  const cross = Boolean(currentPlan?.allowedModes.includes('cross-pool-copy'))
  const effectiveMode = cross ? 'cross-pool-copy' : mode
  const eligibleSrs = currentPlan?.srs.filter((s) => !cross || s.hostRefs.includes(hostRef)) ?? []
  const eligibleNetworks = currentPlan?.networks.filter((n) => n.hostRefs.includes(hostRef)) ?? []
  const transferNetworks = currentPlan?.networks.filter((n) => n.transferHostRefs.includes(hostRef)) ?? []
  const missingMappings = cross && (!hostRef || !transferNetworks.some((n) => n.ref === transferRef)
    || currentPlan!.disks.some((d) => !eligibleSrs.some((s) => s.ref === storageMap[d.vdiRef]))
    || currentPlan!.vifs.some((v) => !eligibleNetworks.some((n) => n.ref === networkMap[v.vifRef])))
  const disabled = saving || loading || !currentPlan || !newName.trim() || !currentPlan.allowedModes.includes(effectiveMode)
    || !cross && mode === 'copy' && !eligibleSrs.some((s) => s.ref === targetSrRef) || missingMappings
  const close = () => { if (!submitting.current) onClose() }
  const submit = async () => {
    if (!vm || disabled || submitting.current) return
    const request = Symbol('copy-request')
    submitting.current = request; setSaving(true); setError('')
    const submittedScope = scope
    const payload: VmCopyPayload = { vmRef: vm.ref, newName: newName.trim(), nameDescription: description, mode: effectiveMode, targetConnectionId: targetId,
      ...(cross ? { targetHostRef: hostRef, transferNetworkRef: transferRef, storageMap, networkMap } : mode === 'copy' ? { targetSrRef } : {}) }
    try {
      const operation = await window.xapi.vm.copy(vm.connectionId, payload)
      useCopyStore.getState().accept(operation)
      feedback.info(operation.message)
      if (submitting.current === request && currentScope.current === submittedScope) {
        onClose()
        if (onSuccess) void Promise.resolve(onSuccess()).catch(() => feedback.warning('复制任务已记录，列表刷新失败，请在任务完成后刷新'))
      }
    } catch (e: any) {
      if (submitting.current === request && currentScope.current === submittedScope) setError(e.message)
      feedback.error(`复制请求未确认：${e.message}。请查看复制任务后再决定下一步。`)
      // The start acknowledgement can be lost; expose any durable accepted record.
      void window.xapi.vm.copyOperations().then((ops) => {
        useCopyStore.setState({ operations: ops })
      }).catch(() => {})
    } finally {
      // A connection change invalidates form results, but the owning request must still unlock it.
      if (submitting.current === request) { submitting.current = null; setSaving(false) }
    }
  }
  if (!vm) return null
  const kind = isTemplate ? '模板' : 'VM'
  const sourceName = vm.poolName || connections.find((c) => c.id === vm.connectionId)?.poolName || vm.connectionId
  const changeHost = (ref: string) => { setHostRef(ref); setTransferRef(''); setStorageMap({}); setNetworkMap({}) }
  return <Dialog.Root open={open} onOpenChange={(next) => { if (!next) close() }}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
      <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100dvh-3rem)] w-[calc(100%-3rem)] max-w-3xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-input bg-card shadow-2xl">
        <div className="flex shrink-0 items-start gap-3 border-b border-border px-6 py-4">
          <Copy className="mt-1 h-5 w-5 shrink-0 text-accent-foreground" />
          <div className="min-w-0 flex-1"><Dialog.Title className="text-lg font-semibold text-foreground">复制{isTemplate ? '模板' : ' VM'}</Dialog.Title>
            <Dialog.Description className="mt-1 break-words text-sm text-muted-foreground">源：{sourceName} · {vm.name_label}</Dialog.Description></div>
          <button type="button" aria-label="关闭复制窗口" disabled={saving} onClick={close} className="shrink-0 rounded p-2 text-muted-foreground hover:bg-muted"><X className="h-5 w-5" /></button>
        </div>
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => { event.preventDefault(); void submit() }}>
          <div className="space-y-4 overflow-y-auto px-6 py-5">
            <div className="grid grid-cols-2 gap-4">
              <div className="min-w-0 space-y-2"><label htmlFor="copy-name" className="text-sm text-secondary-foreground">新{kind}名称</label><input id="copy-name" required value={newName} disabled={saving} onChange={(e) => setNewName(e.target.value)} className={field} /></div>
              <div className="min-w-0 space-y-2"><label htmlFor="copy-pool" className="text-sm text-secondary-foreground">目标资源池</label>
                <select id="copy-pool" value={targetId} onChange={(e) => setTargetId(e.target.value)} disabled={saving} className={field}>
                  {!connections.some((c) => c.id === vm.connectionId) && <option value={vm.connectionId}>{sourceName}（源池）</option>}
                  {connections.filter((c) => c.state === 'connected').map((c) => <option key={c.id} value={c.id}>{c.poolName || c.name || c.id}{c.id === vm.connectionId ? '（源池）' : ''}</option>)}
                </select></div>
            </div>
            <div className="space-y-2"><label htmlFor="copy-description" className="text-sm text-secondary-foreground">副本描述</label><textarea id="copy-description" value={description} onChange={(e) => setDescription(e.target.value)} disabled={saving} rows={2} className={field} /></div>
            {loading && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />正在读取源设备及目标池能力…</p>}
            {error && <div role="alert" className="break-words rounded-lg border border-danger/30 p-3 text-sm text-danger">{error}</div>}
            {currentPlan?.blockers.map((b) => <p role="alert" key={b} className="text-sm text-warning">{b}</p>)}
            {currentPlan && currentPlan.allowedModes.length > 0 && !cross && <fieldset disabled={saving} className="space-y-2"><legend className="mb-2 text-sm text-secondary-foreground">复制方式</legend><div className="flex gap-5">{(['clone', 'copy'] as const).map((m) => <label key={m} className="flex items-center gap-2 text-sm text-foreground"><input type="radio" name="copy-mode" checked={mode === m} disabled={!currentPlan.allowedModes.includes(m)} onChange={() => setMode(m)} />{m === 'clone' ? '快速克隆' : '完整复制'}</label>)}</div><p className="text-xs text-muted-foreground">快速克隆使用原 SR 的写时复制能力；完整复制写入所选 SR，耗时和空间占用通常更高。</p></fieldset>}
            {currentPlan && currentPlan.allowedModes.length > 0 && !cross && mode === 'copy' && <div className="space-y-2"><label htmlFor="copy-sr" className="text-sm text-secondary-foreground">目标 SR</label><select id="copy-sr" className={field} value={targetSrRef} disabled={saving} onChange={(e) => setTargetSrRef(e.target.value)}><option value="">请选择可写 SR</option>{eligibleSrs.map((s) => <option key={s.ref} value={s.ref}>{s.name} · {formatBytes(s.freeBytes)} 可用</option>)}</select></div>}
            {cross && currentPlan && <>
              <p className="text-sm text-accent-foreground">跨池完整复制 · 不保留快照历史 · 源对象保留</p>
              <div className="grid grid-cols-2 gap-4"><div className="space-y-2"><label htmlFor="copy-host" className="text-sm text-secondary-foreground">目标主机</label><select id="copy-host" value={hostRef} onChange={(e) => changeHost(e.target.value)} disabled={saving} className={field}><option value="">请选择主机</option>{currentPlan.hosts.map((h) => <option key={h.ref} value={h.ref}>{h.name}</option>)}</select></div>
                <div className="space-y-2"><label htmlFor="copy-transfer" className="text-sm text-secondary-foreground">传输网络</label><select id="copy-transfer" value={transferRef} onChange={(e) => setTransferRef(e.target.value)} disabled={saving || !hostRef} className={field}><option value="">请选择已配置 IP 的网络</option>{transferNetworks.map((n) => <option key={n.ref} value={n.ref}>{n.name}</option>)}</select></div></div>
              <fieldset disabled={saving || !hostRef} className="space-y-2"><legend className="mb-2 text-sm text-secondary-foreground">磁盘到目标 SR 映射</legend>
                {currentPlan.disks.map((d, i) => <div key={`${d.vdiRef}:${i}`} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-3 rounded bg-background p-3"><label htmlFor={`copy-disk-${i}`} className="min-w-0 break-words text-sm text-secondary-foreground">{d.name}<span className="mt-1 block text-xs text-subtle">{d.history ? `历史 · ${d.vmName}` : '当前'} · {d.suspend ? '挂起镜像' : `设备 ${d.device}`} · {formatBytes(d.size)}</span></label><select id={`copy-disk-${i}`} value={storageMap[d.vdiRef] || ''} onChange={(e) => setStorageMap((s) => ({ ...s, [d.vdiRef]: e.target.value }))} className={field}><option value="">请选择 SR</option>{eligibleSrs.map((s) => <option key={s.ref} value={s.ref}>{s.name} · {formatBytes(s.freeBytes)} 可用</option>)}</select></div>)}
              </fieldset>
              <fieldset disabled={saving || !hostRef} className="space-y-2"><legend className="mb-2 text-sm text-secondary-foreground">网卡到目标网络映射</legend>
                {currentPlan.vifs.map((v, i) => <div key={v.vifRef} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-3 rounded bg-background p-3"><label htmlFor={`copy-vif-${i}`} className="min-w-0 break-words text-sm text-secondary-foreground">网卡 {v.device} · {v.networkName}<span className="block text-xs text-subtle">{v.history ? `历史 · ${v.vmName}` : '当前'}</span></label><select id={`copy-vif-${i}`} value={networkMap[v.vifRef] || ''} onChange={(e) => setNetworkMap((s) => ({ ...s, [v.vifRef]: e.target.value }))} className={field}><option value="">请选择业务网络</option>{eligibleNetworks.map((n) => <option key={n.ref} value={n.ref}>{n.name}</option>)}</select></div>)}
              </fieldset>
            </>}
            {currentPlan?.warnings.map((w) => <p key={w} className="text-xs text-muted-foreground">{w}</p>)}
            <button type="button" onClick={() => setRevision((n) => n + 1)} disabled={saving || loading} className="text-sm text-accent-foreground disabled:opacity-40">重新读取预检</button>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-3 border-t border-border px-6 py-4">
            <p className="w-full text-xs text-muted-foreground">提交后可关闭窗口，在“复制任务”中查看进度、核对结果或请求取消。</p>
            <button type="button" onClick={close} disabled={saving} className="shrink-0 whitespace-nowrap px-4 py-2 text-sm text-secondary-foreground">取消</button>
            <button type="submit" disabled={Boolean(disabled)} className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:bg-secondary disabled:text-subtle disabled:opacity-50">{saving && <Loader2 className="h-4 w-4 animate-spin" />}开始复制</button>
          </div>
        </form>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
}
