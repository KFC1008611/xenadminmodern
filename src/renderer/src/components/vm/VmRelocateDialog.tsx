import { CopyVmDialog } from './CopyVmDialog'
import { useCopyStore } from '../../store/copy.store'
import { srFreeBytes } from '../../../../shared/storage-capacity'
import { useEffect, useMemo, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { AlertTriangle, ArrowRightLeft, HardDrive, Loader2, Network, Server, X } from 'lucide-react'
import { useConnectionManagerStore } from '../../store/connectionManager.store'
import { feedback } from '../../store/feedback.store'
import { formatBytes } from '../../lib/utils'
import { formatNetworkOptionLabel, formatRawNetworkName } from '../../lib/networkDisplay'
import { formatVifLabel } from '../../lib/networkTerminology'
import type { VmRelocationMode, VmRelocationPlan } from '../../types/xapi'
import { getAuditedFeatureBlockReason } from '../../../../shared/audited-features'

const storageMoveBlocked = getAuditedFeatureBlockReason('vm.storage-move')
const modeBlockedReasons: Record<VmRelocationMode, string> = {
  'pool-migrate': '',
  'storage-move': storageMoveBlocked,
  'cross-pool-migrate': getAuditedFeatureBlockReason('vm.cross-pool-migrate'),
  'cross-pool-copy': '',
}

interface VmRelocateDialogProps {
  open: boolean
  onClose: () => void
  vm: {
    ref: string
    name_label: string
    power_state?: string
    connectionId: string
    poolName?: string
  } | null
  onSuccess: () => void | Promise<void>
}

const modeLabels: Record<VmRelocationMode, string> = {
  'pool-migrate': '同池主机迁移',
  'storage-move': '停机存储移动',
  'cross-pool-migrate': '跨池迁移',
  'cross-pool-copy': '跨池复制',
}

function defaultMode(plan: VmRelocationPlan, current?: VmRelocationMode): VmRelocationMode {
  if (current && plan.allowedModes.includes(current)) return current
  return plan.allowedModes[0] ?? (plan.targetConnectionId === plan.sourceConnectionId ? 'pool-migrate' : 'cross-pool-migrate')
}

function buildStorageMap(plan: VmRelocationPlan, mode: VmRelocationMode): Record<string, string> {
  const firstTargetSr = ''
  const result: Record<string, string> = {}
  for (const disk of plan.disks) {
    result[disk.vdiRef] = mode === 'storage-move' ? disk.sourceSrRef : firstTargetSr
  }
  return result
}

function buildNetworkMap(plan: VmRelocationPlan): Record<string, string> {
  const firstTargetNetwork = ''
  const result: Record<string, string> = {}
  for (const vif of plan.vifs) {
    const sameRef = plan.sourceConnectionId === plan.targetConnectionId ? plan.targetNetworks.find((network) => network.ref === vif.networkRef)?.ref : undefined
    result[vif.vifRef] = sameRef ?? firstTargetNetwork
  }
  return result
}

export function VmRelocateDialog({ open, onClose, vm, onSuccess }: VmRelocateDialogProps) {
  const connections = useConnectionManagerStore((state) => state.connections)
  const connectedConnections = connections.filter((connection) => connection.state === 'connected')
  const [copyOpen, setCopyOpen] = useState(false)
  const [targetConnectionId, setTargetConnectionId] = useState('')
  const [mode, setMode] = useState<VmRelocationMode>('pool-migrate')
  const [plan, setPlan] = useState<VmRelocationPlan | null>(null)
  const [targetHostRef, setTargetHostRef] = useState('')
  const [transferNetworkRef, setTransferNetworkRef] = useState('')
  const [storageMap, setStorageMap] = useState<Record<string, string>>({})
  const [networkMap, setNetworkMap] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !vm) return
    setCopyOpen(false)
    setTargetConnectionId(vm.connectionId)
    setPlan(null)
    setError(null)
    setSaving(false)
  }, [open, vm])

  useEffect(() => {
    if (!open || !vm || !targetConnectionId) return
    let disposed = false
    setPlan(null)
    setTargetHostRef('')
    setTransferNetworkRef('')
    setStorageMap({})
    setNetworkMap({})
    setLoading(true)
    setError(null)

    window.xapi.vm
      .getRelocationPlan(vm.connectionId, vm.ref, targetConnectionId)
      .then((nextPlan) => {
        if (disposed) return
        const nextMode = defaultMode(nextPlan, mode)
        setPlan(nextPlan)
        setMode(nextMode)
        setTargetHostRef('')
        setTransferNetworkRef('')
        setStorageMap(buildStorageMap(nextPlan, nextMode))
        setNetworkMap(buildNetworkMap(nextPlan))
      })
      .catch((e: any) => {
        if (disposed) return
        setPlan(null)
        setError(e?.message || String(e))
      })
      .finally(() => { if (!disposed) setLoading(false) })
    return () => { disposed = true }
  }, [open, vm?.connectionId, vm?.ref, targetConnectionId])

  useEffect(() => {
    if (!plan) return
    setStorageMap((current) => {
      const next = buildStorageMap(plan, mode)
      return { ...next, ...current }
    })
  }, [mode, plan])

  const samePool = plan?.sourceConnectionId === plan?.targetConnectionId
  const modeOptions: VmRelocationMode[] = samePool
    ? ['pool-migrate', 'storage-move']
    : ['cross-pool-migrate', 'cross-pool-copy']

  const requiredDiskRefs = useMemo(() => {
    if (!plan) return []
    if (mode === 'storage-move') return plan.disks.filter((disk) => disk.owner).map((disk) => disk.vdiRef)
    if (mode === 'cross-pool-migrate' || mode === 'cross-pool-copy') return plan.disks.map((disk) => disk.vdiRef)
    return []
  }, [mode, plan])

  const missingDiskMap = requiredDiskRefs.some((ref) => !storageMap[ref])
  const missingNetworkMap =
    (mode === 'cross-pool-migrate' || mode === 'cross-pool-copy') &&
    (plan?.vifs ?? []).some((vif) => !networkMap[vif.vifRef])
  const modeBlocked = modeBlockedReasons[mode]
  const submitDisabled =
    saving ||
    loading ||
    !plan ||
    plan.blockers.length > 0 ||
    !plan.allowedModes.includes(mode) ||
    Boolean(modeBlocked) ||
    (mode !== 'storage-move' && !targetHostRef) ||
    ((mode === 'cross-pool-migrate' || mode === 'cross-pool-copy') && !transferNetworkRef) ||
    missingDiskMap ||
    missingNetworkMap

  const handleModeChange = (nextMode: VmRelocationMode) => {
    setMode(nextMode)
    if (plan) {
      setStorageMap(buildStorageMap(plan, nextMode))
    }
  }

  const handleSubmit = async () => {
    if (!vm || !plan || submitDisabled) return
    setSaving(true)
    setError(null)
    try {
      const result = await window.xapi.vm.relocate({
        mode,
        sourceConnectionId: vm.connectionId,
        targetConnectionId,
        vmRef: vm.ref,
        targetHostRef: mode === 'storage-move' ? undefined : targetHostRef,
        transferNetworkRef: mode === 'cross-pool-migrate' || mode === 'cross-pool-copy' ? transferNetworkRef : undefined,
        storageMap: mode === 'pool-migrate' ? undefined : storageMap,
        networkMap: mode === 'cross-pool-migrate' || mode === 'cross-pool-copy' ? networkMap : undefined,
      })
      if (result.copyOperation) useCopyStore.getState().accept(result.copyOperation)
      else feedback.success(`${modeLabels[mode]}已完成`)
      await onSuccess()
      onClose()
    } catch (e: any) {
      const message = e?.message || String(e)
      setError(message)
      if (e?.code === 'TASK_OUTCOME_UNKNOWN') feedback.warning(message)
      else feedback.error(`${modeLabels[mode]}失败：${message}`)
    } finally {
      setSaving(false)
    }
  }

  const handleClose = () => {
    if (!saving) onClose()
  }

  if (!vm) return null

  if (copyOpen) return <CopyVmDialog open={open} vm={vm} initialTargetConnectionId={targetConnectionId} onClose={() => setCopyOpen(false)} onSuccess={() => { onClose(); return onSuccess() }} />

  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => !nextOpen && handleClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[88vh] w-[calc(100%-3rem)] max-w-3xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-input bg-card shadow-2xl">
          <div className="flex items-center justify-between border-b border-border px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-accent p-2">
                <ArrowRightLeft className="h-5 w-5 text-accent-foreground" />
              </div>
              <div>
                <Dialog.Title className="text-lg font-semibold text-foreground">迁移/移动 VM</Dialog.Title>
                <p className="mt-0.5 text-sm text-muted-foreground">{vm.name_label}</p>
              </div>
            </div>
            <Dialog.Close asChild>
              <button aria-label="关闭迁移窗口" className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50" disabled={saving}>
                <X className="h-5 w-5" />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">
            选择 VM 迁移方式、目标主机以及所需的存储和网络映射。
          </Dialog.Description>

          <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label htmlFor="relocate-pool" className="text-sm font-medium text-secondary-foreground">目标资源池</label>
                <select
                  id="relocate-pool"
                  value={targetConnectionId}
                  onChange={(event) => setTargetConnectionId(event.target.value)}
                  disabled={saving}
                  className="w-full rounded-lg border border-input bg-muted px-3 py-2 text-sm text-foreground focus:border-primary/30 focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
                >
                  {connectedConnections.map((connection) => (
                    <option key={connection.id} value={connection.id}>
                      {connection.poolName || connection.name || connection.id}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-secondary-foreground">操作模式</label>
                <div className="grid grid-cols-2 gap-2">
                  {modeOptions.map((option) => {
                    const blockedReason = modeBlockedReasons[option]
                    const allowed = (option === 'cross-pool-copy' || (plan?.allowedModes.includes(option) ?? false)) && !blockedReason
                    return (
                      <button
                        key={option}
                        type="button"
                        onClick={() => { if (allowed) { if (option === 'cross-pool-copy') setCopyOpen(true); else handleModeChange(option) } }}
                        disabled={!allowed || saving}
                        title={blockedReason}
                        className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                          mode === option
                            ? 'border-primary/30 bg-accent text-foreground'
                            : 'border-input bg-muted text-secondary-foreground hover:border-input'
                        } disabled:cursor-not-allowed disabled:opacity-40`}
                      >
                        {modeLabels[option]}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>

            {loading && (
              <div className="flex items-center gap-2 rounded-lg border border-border bg-background p-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                正在生成迁移预检...
              </div>
            )}

            {plan?.blockers.length ? (
              <div className="rounded-lg border border-danger/30 bg-danger-soft p-3 text-sm text-danger">
                <div className="mb-2 flex items-center gap-2 font-medium text-danger">
                  <AlertTriangle className="h-4 w-4" />
                  当前 VM 不能迁移或移动
                </div>
                <ul className="space-y-1">
                  {plan.blockers.map((blocker) => (
                    <li key={blocker.code}>{blocker.message}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {plan && modeOptions.filter((option) => Boolean(modeBlockedReasons[option])).map((option) => (
              <div key={option} className="rounded-lg border border-warning/30 bg-warning-soft p-3 text-sm text-warning">
                <span className="font-medium">{modeLabels[option]}：</span>{modeBlockedReasons[option]}
              </div>
            ))}

            {plan && !loading && (
              <>
                {mode !== 'storage-move' && (
                  <div className="space-y-2">
                    <label htmlFor="relocate-host" className="flex items-center gap-2 text-sm font-medium text-secondary-foreground">
                      <Server className="h-4 w-4 text-subtle" />
                      目标主机
                    </label>
                    <select
                      id="relocate-host"
                  value={targetHostRef}
                      onChange={(event) => setTargetHostRef(event.target.value)}
                      disabled={saving}
                      className="w-full rounded-lg border border-input bg-muted px-3 py-2 text-sm text-foreground focus:border-primary/30 focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
                    >
                      <option value="">选择目标主机</option>
                      {plan.targetHosts.map((host) => (
                        <option key={host.ref} value={host.ref}>
                          {host.name_label || host.hostname || host.ref}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {(mode === 'cross-pool-migrate' || mode === 'cross-pool-copy') && (
                  <div className="space-y-2">
                    <label htmlFor="relocate-transfer" className="flex items-center gap-2 text-sm font-medium text-secondary-foreground">
                      <Network className="h-4 w-4 text-subtle" />
                      传输网络
                    </label>
                    <select
                      id="relocate-transfer"
                  value={transferNetworkRef}
                      title={plan.targetNetworks.find((network) => network.ref === transferNetworkRef)?.name_label}
                      onChange={(event) => setTransferNetworkRef(event.target.value)}
                      disabled={saving}
                      className="w-full rounded-lg border border-input bg-muted px-3 py-2 text-sm text-foreground focus:border-primary/30 focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
                    >
                      <option value="">选择目标池传输网络</option>
                      {plan.targetNetworks.map((network) => (
                        <option key={network.ref} value={network.ref} title={network.name_label}>
                          {formatNetworkOptionLabel(network)}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {mode !== 'pool-migrate' && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-sm font-medium text-secondary-foreground">
                      <HardDrive className="h-4 w-4 text-subtle" />
                      磁盘到 SR 映射
                    </div>
                    <div className="space-y-2">
                      {plan.disks
                        .filter((disk) => mode !== 'storage-move' || disk.owner)
                        .map((disk) => (
                          <div key={disk.vdiRef} className="grid gap-2 rounded-lg border border-border bg-background p-3 md:grid-cols-[1fr_260px]">
                            <div className="min-w-0 text-sm">
                              <div className="truncate font-medium text-foreground">{disk.nameLabel || disk.vdiRef}</div>
                              <div className="mt-1 text-xs text-subtle">
                                设备 {disk.userdevice || '-'} · {formatBytes(disk.size)}
                              </div>
                            </div>
                            <select
                              value={storageMap[disk.vdiRef] ?? ''}
                              onChange={(event) => setStorageMap((current) => ({ ...current, [disk.vdiRef]: event.target.value }))}
                              disabled={saving}
                              className="rounded-lg border border-input bg-muted px-3 py-2 text-sm text-foreground focus:border-primary/30 focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
                            >
                              <option value="">选择目标 SR</option>
                              {plan.targetSrs.map((sr) => (
                                <option key={sr.ref} value={sr.ref}>
                                  {sr.name_label} ({formatBytes(srFreeBytes(sr))} 可用)
                                </option>
                              ))}
                            </select>
                          </div>
                        ))}
                    </div>
                  </div>
                )}

                {(mode === 'cross-pool-migrate' || mode === 'cross-pool-copy') && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-sm font-medium text-secondary-foreground">
                      <Network className="h-4 w-4 text-subtle" />
                      虚拟网卡到网络映射
                    </div>
                    <div className="space-y-2">
                      {plan.vifs.map((vif) => (
                        <div key={vif.vifRef} className="grid gap-2 rounded-lg border border-border bg-background p-3 md:grid-cols-[1fr_260px]">
                          <div className="min-w-0 text-sm">
                            <div className="truncate font-medium text-foreground">{formatVifLabel(vif.device || '—')}</div>
                            <div className="mt-1 truncate text-xs text-subtle" title={vif.networkName}>接入网络：{formatRawNetworkName(vif.networkName)}</div>
                          </div>
                          <select
                            value={networkMap[vif.vifRef] ?? ''}
                            title={plan.targetNetworks.find((network) => network.ref === networkMap[vif.vifRef])?.name_label}
                            onChange={(event) => setNetworkMap((current) => ({ ...current, [vif.vifRef]: event.target.value }))}
                            disabled={saving}
                            className="rounded-lg border border-input bg-muted px-3 py-2 text-sm text-foreground focus:border-primary/30 focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
                          >
                            <option value="">选择目标网络</option>
                            {plan.targetNetworks.map((network) => (
                              <option key={network.ref} value={network.ref} title={network.name_label}>
                                {formatNetworkOptionLabel(network)}
                              </option>
                            ))}
                          </select>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="rounded-lg border border-border bg-background p-3 text-sm text-secondary-foreground">
                  <div className="mb-2 font-medium text-foreground">复核</div>
                  <div className="grid gap-2 md:grid-cols-2">
                    <div>模式：{modeLabels[mode]}</div>
                    <div>磁盘：{plan.disks.length} 个</div>
                    <div>虚拟网卡：{plan.vifs.length} 个</div>
                    <div>目标资源池：{connectedConnections.find((connection) => connection.id === targetConnectionId)?.poolName || targetConnectionId}</div>
                  </div>
                </div>
              </>
            )}

            {error && (
              <div className="rounded-lg border border-danger/30 bg-danger-soft p-3 text-sm text-danger">
                {error}
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-border bg-card px-6 py-4">
            <button onClick={handleClose} disabled={saving} className="px-4 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50">
              取消
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitDisabled}
              title={modeBlocked}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-secondary disabled:text-subtle"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRightLeft className="h-4 w-4" />}
              提交
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
