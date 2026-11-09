/**
 * VifManager — table of VIFs with plug/unplug/remove controls and add-VIF dialog.
 */
import { useRef, useState } from 'react'
import { Plus, Trash2, Cable, Unplug, Loader2, ArrowRightLeft } from 'lucide-react'
import type { VIFRecord, ConnectedNetworkRecord } from '../../types/xapi'
import { formatVifNetworkName, getGuestIpAddresses, type GuestIpAddress } from '../../lib/networkDisplay'
import { formatVifLabel } from '../../lib/networkTerminology'
import { useToast } from '../toast/useToast'
import { AddVifDialog } from './AddVifDialog'
import { DesktopDialog } from '../layout/DesktopDialog'

interface VifManagerProps {
  connectionId: string
  vmRef: string
  vifs: VIFRecord[]
  networks: ConnectedNetworkRecord[]
  guestNetworks: Record<string, string>
  onChanged: () => void | Promise<void>
  disabled?: boolean
  onViewNetwork?: (networkRef: string) => void
}

function VifIpCell({ addresses }: { addresses: GuestIpAddress[] }) {
  return (
    <td className="px-4 py-3 text-xs">
      {addresses.length === 0 ? (
        <span className="text-subtle">未上报</span>
      ) : (
        <div className="flex flex-col gap-1">
          {addresses.map((ip) => (
            <span key={`${ip.family}-${ip.address}`} className="font-mono text-foreground break-all">
              <span className="mr-1.5 font-sans text-subtle">{ip.family}</span>
              {ip.address}
            </span>
          ))}
        </div>
      )}
    </td>
  )
}

export function VifManager({
  connectionId,
  vmRef,
  vifs,
  networks,
  guestNetworks,
  onChanged,
  disabled = false,
  onViewNetwork,
}: VifManagerProps) {
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [moveTarget, setMoveTarget] = useState<string | null>(null)
  const [targetNetworkRef, setTargetNetworkRef] = useState('')
  const actionInFlight = useRef(false)
  const toast = useToast()
  const busy = disabled || actionLoading !== null
  const guestIps = getGuestIpAddresses(guestNetworks)
  const removeTarget = vifs.find((vif) => vif.ref === confirmRemove)

  const runVifAction = async (vifRef: string, label: string, action: () => Promise<void>) => {
    if (busy || actionInFlight.current) return
    actionInFlight.current = true
    setActionLoading(vifRef)
    try {
      await action()
      toast.success(`${label}成功`)
      setConfirmRemove(null)
      setMoveTarget(null)
    } catch (error: any) {
      toast.error(`${label}失败：${error?.message || String(error)}`)
    } finally {
      try { await onChanged() }
      catch (error: any) { toast.info(`操作后无法刷新虚拟网卡状态：${error?.message || String(error)}。请重新读取后核对。`) }
      setActionLoading(null)
      actionInFlight.current = false
    }
  }
  const handlePlug = (vifRef: string) => runVifAction(vifRef, '连接虚拟网卡', () => window.xapi.vif.plug(connectionId, vifRef))
  const handleUnplug = (vifRef: string) => runVifAction(vifRef, '断开虚拟网卡', () => window.xapi.vif.unplug(connectionId, vifRef))
  const handleRemove = (vifRef: string) => runVifAction(vifRef, '删除虚拟网卡', () => window.xapi.vif.destroy(connectionId, vifRef))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-secondary-foreground">
          虚拟网卡 ({vifs.length})
        </h3>
        <button
          onClick={() => setAddDialogOpen(true)}
          disabled={busy}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary hover:bg-primary-hover text-primary-foreground rounded-lg transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          添加虚拟网卡
        </button>
      </div>

      <p className="text-xs text-subtle">
        IP 地址由虚拟机内的 Guest Tools 上报；未上报时请检查工具运行状态，或刷新后重试。
      </p>

      {vifs.length === 0 ? (
        <div className="text-center py-8 text-subtle text-sm">
          此虚拟机没有配置虚拟网卡
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="overflow-x-auto">
          <table className="min-w-[820px] w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-4 py-3 text-muted-foreground font-medium">虚拟网卡</th>
                <th className="text-left px-4 py-3 text-muted-foreground font-medium">MAC 地址</th>
                <th className="text-left px-4 py-3 text-muted-foreground font-medium">网络</th>
                <th className="text-left px-4 py-3 text-muted-foreground font-medium">IP 地址</th>
                <th className="text-left px-4 py-3 text-muted-foreground font-medium">MTU</th>
                <th className="text-left px-4 py-3 text-muted-foreground font-medium">状态</th>
                <th className="sticky right-0 z-10 bg-card text-right px-4 py-3 text-muted-foreground font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {vifs.map((vif) => (
                <tr key={vif.ref} className="hover:bg-muted transition-colors">
                  <td className="px-4 py-3 text-foreground text-xs whitespace-nowrap">{formatVifLabel(vif.device)}</td>
                  <td className="px-4 py-3 text-secondary-foreground font-mono text-xs">{vif.MAC}</td>
                  <td className="px-4 py-3 text-secondary-foreground text-xs" title={networks.find((network) => network.ref === vif.network)?.name_label || vif.networkName}>
                    {onViewNetwork ? <button type="button" onClick={() => onViewNetwork(vif.network)} className="text-accent-foreground underline">{formatVifNetworkName(vif, networks)}</button> : formatVifNetworkName(vif, networks)}
                  </td>
                  <VifIpCell addresses={guestIps.filter((ip) => ip.device === vif.device)} />
                  <td className="px-4 py-3 text-muted-foreground">{vif.MTU || '—'}</td>
                  <td className="px-4 py-3 text-xs text-secondary-foreground whitespace-nowrap">{vif.currently_attached ? '已连接' : '未连接'}</td>
                  <td className="sticky right-0 bg-card px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {actionLoading === vif.ref ? (
                        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                      ) : (
                        <>
                          <button type="button" aria-label="更换网卡网络" title="更换网络，保留网卡和 MAC 地址" disabled={busy}
                            onClick={() => { setMoveTarget(vif.ref); setTargetNetworkRef(vif.network) }} className="p-1.5 text-muted-foreground hover:bg-muted rounded-lg">
                            <ArrowRightLeft className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handlePlug(vif.ref)}
                            disabled={busy || vif.currently_attached}
                            aria-label="连接虚拟网卡"
                            className="p-1.5 text-success hover:bg-success-soft rounded-lg transition-colors"
                            title={vif.currently_attached ? '虚拟网卡已连接' : '连接虚拟网卡'}
                          >
                            <Cable className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleUnplug(vif.ref)}
                            disabled={busy || !vif.currently_attached}
                            aria-label="断开虚拟网卡"
                            className="p-1.5 text-warning hover:bg-warning-soft rounded-lg transition-colors"
                            title={!vif.currently_attached ? '虚拟网卡未连接' : '断开虚拟网卡'}
                          >
                            <Unplug className="w-3.5 h-3.5" />
                          </button>
                            <button
                              onClick={() => setConfirmRemove(vif.ref)}
                              disabled={busy}
                              aria-label="删除虚拟网卡"
                              className="p-1.5 text-danger hover:bg-danger-soft rounded-lg transition-colors"
                              title="删除虚拟网卡"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      <AddVifDialog
        open={addDialogOpen}
        onClose={() => setAddDialogOpen(false)}
        connectionId={connectionId}
        vmRef={vmRef}
        networks={networks}
        onCreated={onChanged}
      />
      {moveTarget && <DesktopDialog open title="更换网卡网络" onClose={() => setMoveTarget(null)} busy={actionLoading !== null} className="max-w-md">
        <div className="rounded-xl border border-input bg-card p-6 space-y-4">
          <h2 className="text-lg font-semibold text-foreground">更换网卡网络</h2>
          <p className="text-sm text-secondary-foreground">更换网络会中断此网卡的现有连接，网卡和 MAC 地址保持不变。</p>
          <label className="block text-sm">目标网络<select aria-label="目标网络" value={targetNetworkRef} disabled={busy} onChange={(event) => setTargetNetworkRef(event.target.value)} className="mt-2 w-full rounded-lg border border-input bg-muted px-3 py-2">
            {networks.filter((network) => network.connectionId === connectionId).map((network) => <option key={network.ref} value={network.ref}>{network.name_label}</option>)}
          </select></label>
          <div className="flex justify-end gap-3"><button type="button" disabled={busy} onClick={() => setMoveTarget(null)} className="px-3 py-2 text-sm">取消</button>
            <button type="button" disabled={busy || !targetNetworkRef || vifs.find((vif) => vif.ref === moveTarget)?.network === targetNetworkRef}
              onClick={() => void runVifAction(moveTarget, '更换网卡网络', () => window.xapi.vif.move(connectionId, moveTarget, targetNetworkRef))} className="rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50">确认更换</button></div>
        </div>
      </DesktopDialog>}
      {removeTarget && <DesktopDialog open title="删除虚拟网卡" onClose={() => setConfirmRemove(null)} busy={actionLoading !== null} className="max-w-md">
        <div className="rounded-xl border border-input bg-card p-6 space-y-4">
          <h2 className="text-lg font-semibold text-foreground">删除虚拟网卡</h2>
          <p className="text-sm text-secondary-foreground break-words">将移除 {formatVifLabel(removeTarget.device)}（{removeTarget.MAC}）及其与网络“{formatVifNetworkName(removeTarget, networks)}”的连接。客户机将失去此网卡，网络本身会保留。</p>
          <p className="text-xs text-muted-foreground">如果只需暂时停用，请取消并使用“断开虚拟网卡”。</p>
          <div className="flex justify-end gap-3"><button type="button" disabled={actionLoading !== null} onClick={() => setConfirmRemove(null)} className="px-3 py-2 text-sm text-secondary-foreground">取消</button><button type="button" disabled={busy} onClick={() => handleRemove(removeTarget.ref)} className="rounded-lg bg-danger-solid px-3 py-2 text-sm text-on-solid disabled:opacity-50">确认删除</button></div>
        </div>
      </DesktopDialog>}
    </div>
  )
}
