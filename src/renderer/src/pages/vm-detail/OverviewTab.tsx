/**
 * OverviewTab — displays VM metadata, configuration summaries and devices.
 */
import { useEffect, useState } from 'react'
import {
  Server,
  HardDrive,
  Network,
  Edit3,
  Save,
  X,
  Cpu,
  MemoryStick,
  Globe,
  CheckCircle,
  XCircle,
} from 'lucide-react'
import type { ConnectedNetworkRecord, VmDetailRecord, VBDRecord, VIFRecord } from '../../types/xapi'
import { formatVifNetworkName, getGuestIpAddresses } from '../../lib/networkDisplay'
import { formatVifLabel } from '../../lib/networkTerminology'
import { formatBytes, formatMemoryBytes } from '../../lib/utils'
import { executeAction } from '../../lib/executeAction'

interface Props {
  vm: VmDetailRecord
  connectionId: string
  networks: ConnectedNetworkRecord[]
  onUpdated: () => void | Promise<void>
  onEditIdentity?: () => void
  onViewMemory?: () => void
  hostName?: string
  onViewHost?: () => void
  onManageStorage?: () => void
  onManageNetwork?: () => void
  onViewStorage?: (srRef: string) => void
  onViewNetwork?: (networkRef: string) => void
}

// Reusable section card
function SectionCard({
  title,
  icon: Icon,
  children,
  action,
}: {
  title: string
  icon: React.ElementType
  children: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="flex flex-wrap items-center gap-2.5 px-5 py-3.5 border-b border-border">
        <Icon className="w-4 h-4 text-muted-foreground" />
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        <div className="ml-auto">{action}</div>
      </div>
      <div className="p-5">{children}</div>
    </div>
  )
}

// Key-value info row
function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-subtle font-medium uppercase tracking-wider">{label}</dt>
      <dd className="text-sm text-foreground">{value}</dd>
    </div>
  )
}

export function OverviewTab({ vm, connectionId, networks, onUpdated, onEditIdentity, onViewMemory, hostName, onViewHost, onManageStorage, onManageNetwork, onViewStorage, onViewNetwork }: Props) {
  // VBDs & VIFs
  const [vbds, setVbds] = useState<VBDRecord[]>([])
  const [vifs, setVifs] = useState<VIFRecord[]>([])
  const [vbdLoading, setVbdLoading] = useState(true)
  const [vifLoading, setVifLoading] = useState(true)
  const [vbdError, setVbdError] = useState<string | null>(null)
  const [vifError, setVifError] = useState<string | null>(null)
  const [deviceReload, setDeviceReload] = useState(0)

  const [editingCpu, setEditingCpu] = useState(false)
  const [saving, setSaving] = useState(false)
  const [cpuError, setCpuError] = useState<string | null>(null)
  const [editVcpus, setEditVcpus] = useState(String(vm.VCPUs_max))
  const canEditCpu = vm.power_state === 'Halted' && !vm.is_a_template && !vm.is_a_snapshot
    && !vm.is_control_domain && !vm.locked && !vm.Locked && Object.keys(vm.current_operations ?? {}).length === 0
  const cpuCount = Number(editVcpus)
  const cpuValid = Number.isInteger(cpuCount) && cpuCount > 0 && (cpuCount !== vm.VCPUs_max || cpuCount !== vm.VCPUs_at_startup)

  useEffect(() => {
    if (!connectionId) return
    let current = true
    setVbdLoading(true)
    setVifLoading(true)
    setVbdError(null)
    setVifError(null)
    window.xapi.vm.getVBDs(connectionId, vm.ref)
      .then((data) => { if (current) setVbds(data) })
      .catch((error) => { if (current) setVbdError(error?.message || String(error)) })
      .finally(() => { if (current) setVbdLoading(false) })
    window.xapi.vm.getVIFs(connectionId, vm.ref)
      .then((data) => { if (current) setVifs(data) })
      .catch((error) => { if (current) setVifError(error?.message || String(error)) })
      .finally(() => { if (current) setVifLoading(false) })
    return () => { current = false }
  }, [vm.ref, connectionId, deviceReload])

  const saveCpu = async () => {
    if (!canEditCpu || !cpuValid || saving) return
    setSaving(true)
    try {
      const succeeded = await executeAction({
        label: '保存 vCPU 配置',
        action: () => window.xapi.vm.setVcpus(connectionId, vm.ref, cpuCount),
        onError: (error) => { setCpuError(error.message) },
        onSuccess: async () => { setEditingCpu(false); await onUpdated() },
      })
      if (!succeeded) {
        try { await onUpdated() } catch { setCpuError((error) => `${error}；刷新配置失败，请重新读取后核对`) }
      }
    } finally { setSaving(false) }
  }

  const ipAddresses = getGuestIpAddresses(vm.networks || {})

  const guestAgentInstalled = vm.guest_metrics && vm.guest_metrics !== 'OpaqueRef:NULL'

  return (
    <div className="space-y-5">
      {/* Basic Info */}
      <SectionCard title="基本信息" icon={Server} action={onEditIdentity && <button type="button" onClick={onEditIdentity} disabled={vm.is_control_domain || vm.is_a_template || vm.is_a_snapshot || vm.locked || vm.Locked} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-accent-foreground hover:bg-muted disabled:opacity-40"><Edit3 className="h-3.5 w-3.5" />编辑名称和简介</button>}>
        <dl className="grid grid-cols-2 gap-x-8 gap-y-4 lg:grid-cols-3">
          <InfoRow label="名称" value={<span className="break-all">{vm.name_label}</span>} />
          <div className="col-span-2 lg:col-span-2"><InfoRow label="简介" value={<span className="whitespace-pre-wrap break-words">{vm.name_description || <span className="text-subtle">未填写简介</span>}</span>} /></div>
          <InfoRow
            label="UUID"
            value={
              <span className="font-mono text-xs text-secondary-foreground break-all">{vm.uuid}</span>
            }
          />
          <InfoRow label="电源状态" value={vm.power_state} />
          <InfoRow
            label="操作系统"
            value={vm.os_version?.name || vm.os_version?.distro || '未知'}
          />
          <InfoRow
            label="Guest Agent"
            value={
              <span
                className={`inline-flex items-center gap-1 text-sm ${guestAgentInstalled ? 'text-success' : 'text-muted-foreground'}`}
              >
                {guestAgentInstalled ? (
                  <CheckCircle className="w-3.5 h-3.5" />
                ) : (
                  <XCircle className="w-3.5 h-3.5" />
                )}
                {guestAgentInstalled ? '已安装' : '未安装'}
              </span>
            }
          />
          <InfoRow
            label="运行主机"
            value={
              vm.power_state !== 'Halted' && vm.resident_on && vm.resident_on !== 'OpaqueRef:NULL'
                ? onViewHost ? <button type="button" onClick={onViewHost} className="text-accent-foreground underline break-words">{hostName || vm.resident_on}</button> : <span className="break-all">{hostName || vm.resident_on}</span>
                : '—'
            }
          />
          <InfoRow
            label="vCPU"
            value={
              <span className="flex items-center gap-1">
                <Cpu className="w-3.5 h-3.5 text-muted-foreground" />
                启动 {vm.VCPUs_at_startup} / 最大 {vm.VCPUs_max}
                {canEditCpu && <button type="button" aria-label="编辑 vCPU" onClick={() => { setEditVcpus(String(vm.VCPUs_max)); setCpuError(null); setEditingCpu(true) }} className="ml-2 rounded p-1 text-accent-foreground hover:bg-muted"><Edit3 className="h-3.5 w-3.5" /></button>}
              </span>
            }
          />
          <InfoRow
            label="内存"
            value={
              <span className="flex items-center gap-1">
                <MemoryStick className="w-3.5 h-3.5 text-muted-foreground" />
                {vm.memory_dynamic_min === vm.memory_dynamic_max ? formatMemoryBytes(vm.memory_dynamic_max) : `${formatMemoryBytes(vm.memory_dynamic_min)} – ${formatMemoryBytes(vm.memory_dynamic_max)}`}
                {onViewMemory && <button type="button" onClick={onViewMemory} className="ml-2 rounded px-2 py-1 text-xs text-accent-foreground hover:bg-muted">查看与调整</button>}
              </span>
            }
          />
        </dl>
        {cpuError && <p role="alert" className="mt-4 text-sm text-warning break-words">{cpuError}</p>}
        {editingCpu && <p className="mt-4 text-xs text-muted-foreground">此设置会同时修改启动数量和最大数量；保存后两者相同，不再保留扩展余量。</p>}
        {editingCpu && <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-border pt-4">
          <div><label htmlFor="vm-vcpus" className="mb-1.5 block text-xs text-muted-foreground">vCPU 数量</label><input id="vm-vcpus" type="number" min="1" step="1" value={editVcpus} disabled={saving} onChange={(event) => setEditVcpus(event.target.value)} className="w-28 rounded-lg border border-input bg-muted px-3 py-2 text-sm text-foreground" /></div>
          <button type="button" onClick={() => void saveCpu()} disabled={saving || !cpuValid || !canEditCpu || !!cpuError} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-40"><Save className="h-4 w-4" />{saving ? '保存中…' : '保存'}</button>
          <button type="button" onClick={() => setEditingCpu(false)} disabled={saving} className="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-muted-foreground"><X className="h-4 w-4" />取消</button>
        </div>}
      </SectionCard>

      {/* IP Addresses */}
      <SectionCard title="IP 地址" icon={Globe}>
        {ipAddresses.length === 0 ? (
          <p className="text-sm text-subtle italic">
            无来宾上报 IP（需安装并运行 Guest Tools）
          </p>
        ) : (
          <ul className="space-y-1.5">
            {ipAddresses.map(({ device, family, address }) => (
              <li key={`${device}-${family}-${address}`} className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-xs text-subtle flex-shrink-0">
                  {formatVifLabel(device)}
                </span>
                <span className="text-xs text-subtle">{family}</span>
                <span className="font-mono text-sm text-foreground break-all">{address}</span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {/* Storage (VBDs) */}
      <SectionCard title="存储设备" icon={HardDrive} action={onManageStorage && <button type="button" onClick={onManageStorage} className="text-xs text-accent-foreground underline">管理磁盘与存储</button>}>
        {vbdError ? <p role="alert" className="text-sm text-warning break-words">存储设备读取失败：{vbdError}。<button type="button" onClick={() => setDeviceReload((value) => value + 1)} className="underline">重新读取设备</button></p> : vbdLoading ? (
          <p className="text-sm text-subtle">加载中…</p>
        ) : vbds.length === 0 ? (
          <p className="text-sm text-subtle italic">无存储设备</p>
        ) : (
          <div className="overflow-x-auto -mx-5">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-5 py-2 text-xs text-subtle font-medium uppercase tracking-wider">
                    设备号
                  </th>
                  <th className="text-left px-5 py-2 text-xs text-subtle font-medium uppercase tracking-wider">
                    VDI 名称
                  </th>
                  <th className="text-left px-5 py-2 text-xs text-subtle font-medium uppercase tracking-wider">
                    大小
                  </th>
                  <th className="text-left px-5 py-2 text-xs text-subtle font-medium uppercase tracking-wider">
                    模式
                  </th>
                  <th className="text-left px-5 py-2 text-xs text-subtle font-medium uppercase tracking-wider">
                    启动盘
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {vbds.map((vbd) => (
                  <tr key={vbd.ref} className="hover:bg-muted transition-colors">
                    <td className="px-5 py-2.5 font-mono text-secondary-foreground text-xs">
                      {vbd.userdevice}
                    </td>
                    <td className="px-5 py-2.5 text-foreground">{vbd.vdiName || (vbd.type === 'CD' ? '空光驱' : '—')}{vbd.srRef && vbd.srRef !== 'OpaqueRef:NULL' && onViewStorage && <button type="button" onClick={() => onViewStorage(vbd.srRef)} className="mt-1 block text-xs text-accent-foreground underline">查看存储仓库</button>}</td>
                    <td className="px-5 py-2.5 text-secondary-foreground">
                      {vbd.vdiSize > 0 ? formatBytes(vbd.vdiSize) : '—'}
                    </td>
                    <td className="px-5 py-2.5">
                      <span
                        className={`inline-flex px-1.5 py-0.5 rounded text-xs font-medium ${
                          vbd.mode === 'RW'
                            ? 'bg-accent text-accent-foreground'
                            : 'bg-secondary text-muted-foreground'
                        }`}
                      >
                        {vbd.mode}
                      </span>
                    </td>
                    <td className="px-5 py-2.5">
                      {vbd.bootable ? (
                        <CheckCircle className="w-4 h-4 text-success" />
                      ) : (
                        <span className="text-subtle">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* Network Interfaces (VIFs) */}
      <SectionCard title="虚拟网卡" icon={Network} action={onManageNetwork && <button type="button" onClick={onManageNetwork} className="text-xs text-accent-foreground underline">管理虚拟网卡</button>}>
        {vifError ? <p role="alert" className="text-sm text-warning break-words">虚拟网卡读取失败：{vifError}。<button type="button" onClick={() => setDeviceReload((value) => value + 1)} className="underline">重新读取设备</button></p> : vifLoading ? (
          <p className="text-sm text-subtle">加载中…</p>
        ) : vifs.length === 0 ? (
          <p className="text-sm text-subtle italic">无虚拟网卡</p>
        ) : (
          <div className="overflow-x-auto -mx-5">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-5 py-2 text-xs text-subtle font-medium uppercase tracking-wider">
                    设备号
                  </th>
                  <th className="text-left px-5 py-2 text-xs text-subtle font-medium uppercase tracking-wider">
                    MAC 地址
                  </th>
                  <th className="text-left px-5 py-2 text-xs text-subtle font-medium uppercase tracking-wider">
                    网络
                  </th>
                  <th className="text-left px-5 py-2 text-xs text-subtle font-medium uppercase tracking-wider">
                    MTU
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {vifs.map((vif) => (
                  <tr key={vif.ref} className="hover:bg-muted transition-colors">
                    <td className="px-5 py-2.5 text-secondary-foreground text-xs whitespace-nowrap">
                      {formatVifLabel(vif.device)}
                    </td>
                    <td className="px-5 py-2.5 font-mono text-secondary-foreground text-xs">{vif.MAC}</td>
                    <td className="px-5 py-2.5 text-foreground" title={networks.find((network) => network.ref === vif.network)?.name_label || vif.networkName}>{onViewNetwork ? <button type="button" onClick={() => onViewNetwork(vif.network)} className="text-accent-foreground underline">{formatVifNetworkName(vif, networks)}</button> : formatVifNetworkName(vif, networks)}</td>
                    <td className="px-5 py-2.5 text-muted-foreground">{vif.MTU}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

    </div>
  )
}
