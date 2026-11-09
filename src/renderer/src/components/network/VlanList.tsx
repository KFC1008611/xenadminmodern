/**
 * VlanList - Displays list of VLAN interfaces with actions.
 * v9: Rewritten to use Tailwind CSS.
 */
import { useEffect, useState } from 'react'
import { Layers, Plus, Trash2, Loader2 } from 'lucide-react'
import { useConnectionManagerStore } from '../../store/connectionManager.store'
import { useNetworkAdvancedStore } from '../../store/network-advanced.store'
import { feedback } from '../../store/feedback.store'
import { VlanCreateDialog } from './VlanCreateDialog'
import type { NetworkRecord, PifRecord, VlanRecord } from '../../types/xapi'
import { NAME_ONLY_VLAN_WARNING, formatNetworkName, isNameOnlyVlanNetwork } from '../../lib/networkDisplay'
import { formatVlanLabel } from '../../lib/networkTerminology'
import { getAuditedFeatureBlockReason } from '../../../../shared/audited-features'

const topologyBlocked = getAuditedFeatureBlockReason('network.bond-vlan')

interface VlanListProps {
  connectionId: string
  pifs: PifRecord[]
  networks: NetworkRecord[]
  onRefresh?: () => void
}

function resourceKey(connectionId: string, ref: string): string {
  return `${connectionId}:${ref}`
}

export function VlanList({ connectionId, pifs, networks, onRefresh }: VlanListProps) {
  const { vlans: allRecords, vlansConnectionId, vlansLoading, vlansError, loadVlans, destroyVlanNetwork } = useNetworkAdvancedStore()
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const vlans = vlansConnectionId === connectionId ? allRecords : []
  const connectionScope = useConnectionManagerStore((state) => {
    const connection = state.connections.find((item) => item.id === connectionId)
    return JSON.stringify([connection?.state, connection?.connectedAt, connection?.epoch, connection?.poolUuid])
  })

  useEffect(() => {
    loadVlans(connectionId)
  }, [connectionId, connectionScope, loadVlans])

  function getPifName(pifRef: string): string {
    return pifs.find((p) => p.ref === pifRef)?.device || ''
  }

  function getNetworkName(networkRef: string): string {
    const network = networks.find((n) => n.ref === networkRef)
    return network ? formatNetworkName(network) : '—'
  }

  const vlanGroups = Array.from(
    vlans.reduce((groups, vlan) => {
      const device = vlan.taggedDevice || getPifName(vlan.tagged_PIF)
      const key = `${vlan.network}:${vlan.tag}:${device}`
      const group = groups.get(key) || {
        key,
        representative: vlan,
        vlans: [] as VlanRecord[],
        device,
      }
      group.vlans.push(vlan)
      groups.set(key, group)
      return groups
    }, new Map<string, {
      key: string
      representative: VlanRecord
      vlans: VlanRecord[]
      device: string
    }>()).values()
  )
  const nameOnlyVlanNetworks = networks.filter(isNameOnlyVlanNetwork)

  const handleDestroy = async (networkRef: string) => {
    if (!confirm('确定要删除该资源池范围的 VLAN 吗？')) return

    try {
      await destroyVlanNetwork(networkRef, connectionId)
      feedback.success('VLAN 已删除')
      onRefresh?.()
    } catch (err: any) {
      feedback.error(err.message || '删除失败')
    }
  }

  const handleDestroyNameOnlyNetwork = async (network: NetworkRecord) => {
    if (!confirm(`确定要删除网络 "${formatNetworkName(network)}" 吗？`)) return

    try {
      await window.xapi.network.destroy(connectionId, network.ref)
      feedback.success('网络已删除')
      onRefresh?.()
    } catch (err: any) {
      feedback.error(err.message || '删除失败')
    }
  }

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-background">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Layers className="h-4 w-4 text-accent-foreground" />
          VLAN
        </h2>
        <button
          onClick={() => setCreateDialogOpen(true)}
          disabled
          title={topologyBlocked}
          className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-primary px-2.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
        >
          <Plus className="h-3.5 w-3.5" />
          创建 VLAN
        </button>
      </div>

      {vlansError && vlansConnectionId === connectionId && (
        <div role="alert" className="m-3 rounded-lg border border-warning/30 bg-warning-soft p-3 text-sm text-warning">
          <p className="break-words">VLAN读取失败：{vlansError}</p>
          {vlans.length > 0 && <p className="mt-1 text-xs">当前显示上次成功读取的数据。</p>}
          <button type="button" disabled={vlansLoading} onClick={() => void loadVlans(connectionId)} className="mt-2 rounded border border-current px-2 py-1 text-xs disabled:opacity-50">重新读取</button>
        </div>
      )}
      {vlansLoading ? (
        <div className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          加载中...
        </div>
      ) : vlanGroups.length === 0 && nameOnlyVlanNetworks.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-subtle">
          <Layers className="mx-auto mb-2 h-6 w-6 text-subtle" />
          {vlansError ? '无法确认 VLAN 清单' : '没有 VLAN'}
        </div>
      ) : (
        <div className="divide-y divide-border">
          {vlanGroups.map((group) => (
            <div key={resourceKey(connectionId, group.key)} className="px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-foreground">{formatVlanLabel(group.representative.tag)}</div>
                  <div className="mt-1 truncate text-xs text-subtle" title={networks.find((network) => network.ref === group.representative.network)?.name_label}>关联网络：{getNetworkName(group.representative.network)}</div>
                </div>
                <button
                  onClick={() => handleDestroy(group.representative.network)}
                  disabled
                  aria-label="删除 VLAN"
                  className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-danger transition-colors hover:bg-danger-soft"
                  title={topologyBlocked}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {group.device && <span className="rounded-md border border-input bg-card px-2 py-0.5 text-xs text-secondary-foreground">
                  承载接口 {group.device}
                </span>}
                <span className="rounded-md border border-primary/30 bg-accent px-2 py-0.5 text-xs text-accent-foreground">
                  {group.vlans.length} 台主机
                </span>
              </div>
            </div>
          ))}
          {nameOnlyVlanNetworks.map((network) => {
            return (
              <div key={resourceKey(connectionId, network.ref)} className="border-l-2 border-l-warning/70 px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">{formatNetworkName(network)}</div>
                    <div className="mt-1 truncate text-xs text-subtle">{network.bridge ? `桥接设备 ${network.bridge}` : '未连接主机接口'}</div>
                  </div>
                  <button
                    onClick={() => handleDestroyNameOnlyNetwork(network)}
                    disabled
                    aria-label="删除网络"
                    title={topologyBlocked}
                    className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-danger transition-colors hover:bg-danger-soft disabled:text-subtle disabled:hover:bg-transparent"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <span className="rounded-md border border-warning/25 bg-warning-soft px-2 py-0.5 text-xs text-warning">
                    {NAME_ONLY_VLAN_WARNING}
                  </span>
                  <span className="rounded-md border border-input bg-card px-2 py-0.5 text-xs text-secondary-foreground">
                    {network.VIFs?.length || 0} 个虚拟网卡
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <VlanCreateDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        connectionId={connectionId}
        pifs={pifs}
        networks={networks}
        onSuccess={() => {
          loadVlans(connectionId)
          onRefresh?.()
        }}
      />
    </section>
  )
}
