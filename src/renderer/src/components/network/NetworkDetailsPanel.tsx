import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { X } from 'lucide-react'
import type { ConnectedNetworkRecord, PifRecord } from '../../types/xapi'
import { useMultiDataStore } from '../../store/multiData.store'
import { formatNetworkName, formatNetworkTypeLabel } from '../../lib/networkDisplay'
import { formatHostInterfaceLabel, formatHostInterfaceStatuses } from '../../lib/networkTerminology'

export function NetworkDetailsPanel({ network, pifs, pifsLoading, pifsError, onClose }: {
  network: ConnectedNetworkRecord
  pifs: PifRecord[]
  pifsLoading: boolean
  pifsError: string | null
  onClose: () => void
}) {
  const { hosts, vms, domainStates, refreshHosts, refreshVms } = useMultiDataStore()
  const panel = useRef<HTMLElement>(null)
  const connectionId = network.connectionId
  const readStates = domainStates[connectionId]
  const interfaces = pifs.filter((pif) => pif.network === network.ref)
  const relatedVms = vms.filter((vm) => vm.connectionId === connectionId && vm.VIFs?.some((ref) => network.VIFs?.includes(ref)))
  const matchedVifs = new Set(relatedVms.flatMap((vm) => vm.VIFs.filter((ref) => network.VIFs?.includes(ref))))
  const missingVifs = (network.VIFs?.length || 0) - matchedVifs.size
  const missingPifs = (network.PIFs || []).filter((ref) => !interfaces.some((pif) => pif.ref === ref)).length

  useEffect(() => {
    void refreshHosts()
    void refreshVms()
    panel.current?.focus({ preventScroll: true })
    panel.current?.scrollIntoView?.({ block: 'nearest' })
  }, [connectionId, network.ref, refreshHosts, refreshVms])

  return <section ref={panel} tabIndex={-1} aria-label={`网络详情 ${formatNetworkName(network)}`} className="min-w-0 rounded-lg border border-primary/40 bg-background outline-none">
    <div className="flex items-start justify-between gap-3 border-b border-border p-4">
      <div className="min-w-0">
        <h2 className="break-words text-base font-semibold text-foreground">{formatNetworkName(network)}</h2>
        <p className="mt-1 break-words text-sm text-muted-foreground">{network.poolName} · {formatNetworkTypeLabel(network)} · MTU {network.MTU}</p>
        {network.name_description && <p className="mt-2 break-words text-sm text-secondary-foreground">{network.name_description}</p>}
        <p className="mt-2 break-all text-xs text-subtle">UUID：{network.uuid}</p>
      </div>
      <button type="button" onClick={onClose} aria-label="关闭网络详情" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"><X className="h-4 w-4" /></button>
    </div>
    <div className="grid gap-5 p-4 xl:grid-cols-2">
      <div className="min-w-0 space-y-3">
        <h3 className="text-sm font-medium text-foreground">主机接入（{network.PIFs?.length || 0} 个主机网络接口）</h3>
        {pifsLoading && <p role="status" className="text-sm text-muted-foreground">正在读取主机接入…</p>}
        {pifsError && <p className="text-sm text-warning">主机接口读取失败，下面的接入信息可能不完整。</p>}
        {readStates?.hosts?.error && <div role="alert" className="text-sm text-warning break-words">主机名称读取失败：{readStates.hosts.error} <button type="button" onClick={() => void refreshHosts()} className="underline">重新读取主机</button></div>}
        {interfaces.map((pif) => {
          const host = hosts.find((item) => item.connectionId === connectionId && item.ref === pif.host)
          const statuses = formatHostInterfaceStatuses(pif)
          return <div key={pif.ref} className="rounded-lg border border-border p-3 text-sm">
            {host ? <Link to={`/pool/${encodeURIComponent(connectionId)}/hosts/${encodeURIComponent(host.ref)}`} className="break-words text-accent-foreground hover:underline">{host.name_label}</Link> : <p className="break-all text-muted-foreground">主机未在当前清单中：{pif.host}</p>}
            <p className="mt-1 break-words text-foreground">{formatHostInterfaceLabel(pif)}{statuses.length > 0 && ` · ${statuses.join('、')}`}</p>
            <p className="mt-1 break-all text-xs text-muted-foreground">IP：{pif.IP || '未配置'} · 链路：{pif.linkState === 'connected' ? '已连接' : pif.linkState === 'disconnected' ? '断开' : '未知'}</p>
          </div>
        })}
        {missingPifs > 0 && <p className="text-xs text-warning">另有 {missingPifs} 个主机网络接口尚未读取到，请重新读取主机接口后核对。</p>}
        {!pifsLoading && !pifsError && !network.PIFs?.length && interfaces.length === 0 && <p className="text-sm text-muted-foreground">未连接主机网络接口。此网络没有物理网络出口。</p>}
      </div>
      <div className="min-w-0 space-y-3">
        <h3 className="text-sm font-medium text-foreground">虚拟机接入（{network.VIFs?.length || 0} 个虚拟网卡）</h3>
        <p className="text-xs text-muted-foreground">接入数量包含已关机虚拟机的网卡。</p>
        {readStates?.vms?.loading && <p role="status" className="text-sm text-muted-foreground">正在读取虚拟机接入…</p>}
        {readStates?.vms?.error && <div role="alert" className="text-sm text-warning break-words">虚拟机清单读取失败：{readStates.vms.error} <button type="button" onClick={() => void refreshVms()} className="underline">重新读取虚拟机</button></div>}
        {relatedVms.map((vm) => <Link key={vm.ref} to={`/pool/${encodeURIComponent(connectionId)}/vms/${encodeURIComponent(vm.ref)}?tab=network`} className="block rounded-lg border border-border p-3 hover:bg-muted">
          <span className="break-words text-sm text-accent-foreground">{vm.name_label}</span>
          <span className="mt-1 block text-xs text-muted-foreground">{vm.VIFs.filter((ref) => network.VIFs?.includes(ref)).length} 个虚拟网卡 · 查看网络设备</span>
        </Link>)}
        {missingVifs > 0 && <p className="text-xs text-warning">另有 {missingVifs} 个虚拟网卡未匹配到当前虚拟机清单，可能属于模板、控制域或尚未读取的虚拟机。</p>}
        {!network.VIFs?.length && <p className="text-sm text-muted-foreground">尚无虚拟网卡接入。<Link to={`/pool/${encodeURIComponent(connectionId)}/vms`} className="text-accent-foreground underline">打开此资源池的虚拟机</Link>，在目标虚拟机的网络页添加虚拟网卡并选择此网络。</p>}
      </div>
    </div>
  </section>
}
