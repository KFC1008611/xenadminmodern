/**
 * BondList - Displays list of bond interfaces with actions.
 * v9: Rewritten to use Tailwind CSS.
 */
import { useEffect, useState } from 'react'
import { Link2, Plus, Trash2, Loader2 } from 'lucide-react'
import { useConnectionManagerStore } from '../../store/connectionManager.store'
import { useNetworkAdvancedStore } from '../../store/network-advanced.store'
import { feedback } from '../../store/feedback.store'
import { BondCreateDialog } from './BondCreateDialog'
import type { BondRecord, NetworkRecord, PifRecord } from '../../types/xapi'
import { formatNetworkName } from '../../lib/networkDisplay'
import { formatBondLabel, formatPhysicalNicLabel } from '../../lib/networkTerminology'
import { getAuditedFeatureBlockReason } from '../../../../shared/audited-features'

const topologyBlocked = getAuditedFeatureBlockReason('network.bond-vlan')

interface BondListProps {
  connectionId: string
  pifs: PifRecord[]
  networks: NetworkRecord[]
  onRefresh?: () => void
}

const BOND_MODE_LABELS: Record<string, string> = {
  'active-backup': '主备',
  'balance-slb': '负载均衡',
  'lacp': 'LACP',
}

function resourceKey(connectionId: string, ref: string): string {
  return `${connectionId}:${ref}`
}

export function BondList({ connectionId, pifs, networks, onRefresh }: BondListProps) {
  const { bonds: allRecords, bondsConnectionId, bondsLoading, bondsError, loadBonds, destroyBondGroup } = useNetworkAdvancedStore()
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const bonds = bondsConnectionId === connectionId ? allRecords : []
  const connectionScope = useConnectionManagerStore((state) => {
    const connection = state.connections.find((item) => item.id === connectionId)
    return JSON.stringify([connection?.state, connection?.connectedAt, connection?.epoch, connection?.poolUuid])
  })

  useEffect(() => {
    loadBonds(connectionId)
  }, [connectionId, connectionScope, loadBonds])

  const bondGroups = Array.from(
    bonds.reduce((groups, bond) => {
      const devices = bond.devices?.length ? bond.devices : getBondPifDevices(bond)
      const signature = [...new Set(devices)].sort().join('+') || bond.ref
      const key = `${signature}:${bond.network || ''}`
      const group = groups.get(key) || {
        key,
        representative: bond,
        bonds: [] as BondRecord[],
        devices,
        linksUp: 0,
        hasManagement: false,
        hasClusterPif: false,
      }
      group.bonds.push(bond)
      group.linksUp += bond.links_up || 0
      group.hasManagement ||= !!bond.hasManagement
      group.hasClusterPif ||= !!bond.hasClusterPif
      groups.set(key, group)
      return groups
    }, new Map<string, {
      key: string
      representative: BondRecord
      bonds: BondRecord[]
      devices: string[]
      linksUp: number
      hasManagement: boolean
      hasClusterPif: boolean
    }>()).values()
  )

  const handleDestroy = async (bondRef: string) => {
    if (!confirm('确定要删除该资源池范围的网卡绑定吗？')) return

    try {
      await destroyBondGroup(bondRef, connectionId)
      feedback.success('网卡绑定已删除')
      onRefresh?.()
    } catch (err: any) {
      feedback.error(err.message || '删除失败')
    }
  }

  function getBondPifDevices(bond: BondRecord): string[] {
    return (bond.slaves || [])
      .map((ref) => pifs.find((p) => p.ref === ref)?.device)
      .filter((device): device is string => Boolean(device))
  }

  const getBondPifNames = (pifRefs: string[]) => {
    return pifRefs
      .map((ref) => pifs.find((p) => p.ref === ref)?.device)
      .filter((device): device is string => Boolean(device))
      .map(formatPhysicalNicLabel)
      .join('、') || '—'
  }

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-background">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Link2 className="h-4 w-4 text-info" />
          网卡绑定（Bond）
        </h2>
        <button
          onClick={() => setCreateDialogOpen(true)}
          disabled
          title={topologyBlocked}
          className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-primary px-2.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
        >
          <Plus className="h-3.5 w-3.5" />
          创建绑定
        </button>
      </div>

      {bondsError && bondsConnectionId === connectionId && (
        <div role="alert" className="m-3 rounded-lg border border-warning/30 bg-warning-soft p-3 text-sm text-warning">
          <p className="break-words">网卡绑定读取失败：{bondsError}</p>
          {bonds.length > 0 && <p className="mt-1 text-xs">当前显示上次成功读取的数据。</p>}
          <button type="button" disabled={bondsLoading} onClick={() => void loadBonds(connectionId)} className="mt-2 rounded border border-current px-2 py-1 text-xs disabled:opacity-50">重新读取</button>
        </div>
      )}
      {bondsLoading ? (
        <div className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          加载中...
        </div>
      ) : bondGroups.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-subtle">
          <Link2 className="mx-auto mb-2 h-6 w-6 text-subtle" />
          {bondsError ? '无法确认网卡绑定清单' : '没有网卡绑定'}
        </div>
      ) : (
        <div className="divide-y divide-border">
          {bondGroups.map((group) => (
            <div key={resourceKey(connectionId, group.key)} className="px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-foreground" title={formatBondLabel(group.devices)}>
                    {formatBondLabel(group.devices)}
                  </div>
                  <div className="mt-1 truncate text-xs text-subtle">
                    成员：{group.devices.length ? group.devices.map(formatPhysicalNicLabel).join('、') : getBondPifNames(group.representative.slaves)}
                  </div>
                  {networks.find((network) => network.ref === group.representative.network) && (
                    <div className="mt-1 truncate text-xs text-subtle" title={networks.find((network) => network.ref === group.representative.network)?.name_label}>关联网络：{formatNetworkName(networks.find((network) => network.ref === group.representative.network)!)}</div>
                  )}
                </div>
                <button
                  onClick={() => handleDestroy(group.representative.ref)}
                  disabled
                  aria-label="删除绑定"
                  title={topologyBlocked}
                  className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-danger transition-colors hover:bg-danger-soft disabled:text-subtle disabled:hover:bg-transparent"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <span className="rounded-md border border-input bg-card px-2 py-0.5 text-xs text-secondary-foreground">
                    {BOND_MODE_LABELS[group.representative.mode] || group.representative.mode}
                </span>
                <span className={`rounded-md border px-2 py-0.5 text-xs ${
                    group.linksUp > 0
                      ? 'bg-success-soft text-success border-success/30'
                      : 'bg-danger-soft text-danger border-danger/30'
                  }`}>
                  {group.linksUp} 活跃
                </span>
                <span className="rounded-md border border-input bg-card px-2 py-0.5 text-xs text-secondary-foreground">
                    {group.bonds.length} 台主机
                </span>
                {group.hasManagement && (
                  <span className="rounded-md border border-warning/25 bg-warning-soft px-2 py-0.5 text-xs text-warning">
                    管理口
                  </span>
                )}
                {group.hasClusterPif && (
                  <span className="rounded-md border border-warning/25 bg-warning-soft px-2 py-0.5 text-xs text-warning">
                    Cluster
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <BondCreateDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        connectionId={connectionId}
        pifs={pifs}
        onSuccess={() => {
          loadBonds(connectionId)
          onRefresh?.()
        }}
      />
    </section>
  )
}
