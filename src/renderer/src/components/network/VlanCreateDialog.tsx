/**
 * VlanCreateDialog - Dialog for creating VLAN interfaces.
 * v9: Rewritten to use Tailwind CSS + Radix Dialog.
 */
import { useState, useEffect } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { useNetworkAdvancedStore } from '../../store/network-advanced.store'
import { feedback } from '../../store/feedback.store'
import type { NetworkRecord, PifRecord } from '../../types/xapi'
import { formatNetworkOptionLabel } from '../../lib/networkDisplay'
import { NETWORK_TERMS, formatHostInterfaceLabel } from '../../lib/networkTerminology'
import { getAuditedFeatureBlockReason } from '../../../../shared/audited-features'

const topologyBlocked = getAuditedFeatureBlockReason('network.bond-vlan')

interface VlanCreateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  connectionId: string
  pifs: PifRecord[]
  networks: NetworkRecord[]
  onSuccess?: () => void
}

function hostLabel(hostRef?: string): string {
  return hostRef ? hostRef.replace('OpaqueRef:', '').substring(0, 8) : 'unknown'
}

export function VlanCreateDialog({ open, onOpenChange, connectionId, pifs, networks, onSuccess }: VlanCreateDialogProps) {
  const { createVlan } = useNetworkAdvancedStore()

  const [taggedPifRef, setTaggedPifRef] = useState('')
  const [vlanTag, setVlanTag] = useState('')
  const [nameLabel, setNameLabel] = useState('')
  const [nameDescription, setNameDescription] = useState('')
  const [networkRef, setNetworkRef] = useState('')
  const [createNewNetwork, setCreateNewNetwork] = useState(true)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (open) {
      setTaggedPifRef('')
      setVlanTag('')
      setNameLabel('')
      setNameDescription('')
      setNetworkRef('')
      setCreateNewNetwork(true)
    }
  }, [open])

  const handleCreate = async () => {
    if (!connectionId) {
      feedback.error('没有可用连接')
      return
    }

    if (!taggedPifRef) {
      feedback.error(`请选择${NETWORK_TERMS.vlanCarrier}`)
      return
    }

    const tag = parseInt(vlanTag, 10)
    if (isNaN(tag) || tag < 0 || tag > 4094) {
      feedback.error('VLAN 标签必须在 0-4094 之间')
      return
    }

    if (selectedTaggedPif && pifs.some((pif) => pif.ref !== taggedPifRef && pif.device === selectedTaggedPif.device && pif.vlan === tag)) {
      feedback.error('该设备上已经存在相同 VLAN 标签')
      return
    }

    if (createNewNetwork && !nameLabel) {
      feedback.error('请输入网络名称')
      return
    }

    if (!createNewNetwork && !networkRef) {
      feedback.error('请选择网络')
      return
    }

    setCreating(true)
    try {
      await createVlan({
        taggedPifRef,
        vlanTag: tag,
        networkRef: createNewNetwork ? undefined : networkRef,
        nameLabel: createNewNetwork ? nameLabel : undefined,
        nameDescription: createNewNetwork ? nameDescription : undefined,
      }, connectionId)
      feedback.success('VLAN 创建成功')
      onOpenChange(false)
      onSuccess?.()
    } catch (err: any) {
      feedback.error(err.message || '创建 VLAN 失败')
    } finally {
      setCreating(false)
    }
  }

  const vlanPifs = Array.from(
    pifs
      .filter((pif) => pif.isVlanCandidate && !pif.isManagementInterface && !pif.isClusterPif)
      .reduce((byDevice, pif) => {
        if (!byDevice.has(pif.device)) byDevice.set(pif.device, pif)
        return byDevice
      }, new Map<string, PifRecord>()).values()
  )
  const selectedTaggedPif = pifs.find((pif) => pif.ref === taggedPifRef)
  const hasVlanPifs = vlanPifs.length > 0
  const vlanTagNumber = Number(vlanTag)
  const duplicateVlan = selectedTaggedPif && Number.isInteger(vlanTagNumber)
    ? pifs.find((pif) => pif.ref !== taggedPifRef && pif.device === selectedTaggedPif.device && pif.vlan === vlanTagNumber)
    : null
  const attachableNetworks = networks.filter((network) => !network.isBondMember && !network.isGuestInstallerNetwork && !network.isHidden)

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-50" />
        <Dialog.Content aria-describedby={undefined} className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg bg-card border border-border rounded-xl shadow-2xl z-50 focus:outline-none max-h-[85vh] overflow-y-auto">
          <div className="flex items-center justify-between px-6 py-4 border-b border-border">
            <Dialog.Title className="text-lg font-semibold text-foreground">创建 VLAN</Dialog.Title>
            <Dialog.Close className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors">
              <X className="w-4 h-4" />
            </Dialog.Close>
          </div>

          <div className="px-6 py-5 space-y-4">
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">{NETWORK_TERMS.vlanCarrier}</label>
              <select
                value={taggedPifRef}
                onChange={(e) => setTaggedPifRef(e.target.value)}
                disabled={!hasVlanPifs}
                className="w-full px-3 py-2 text-sm bg-muted border border-input rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">{hasVlanPifs ? `选择${NETWORK_TERMS.vlanCarrier}...` : `没有可用${NETWORK_TERMS.vlanCarrier}`}</option>
                {vlanPifs.map((pif) => (
                  <option key={pif.ref} value={pif.ref}>{formatHostInterfaceLabel(pif)} - {hostLabel(pif.host)}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">VLAN 标签</label>
              <input
                type="number"
                min={0}
                max={4094}
                value={vlanTag}
                onChange={(e) => setVlanTag(e.target.value)}
                placeholder="0-4094"
                className="w-full px-3 py-2 text-sm bg-muted border border-input rounded-lg text-foreground placeholder-subtle focus:outline-none focus:ring-1 focus:ring-primary"
              />
              {vlanTag === '0' && (
                <p className="text-xs text-warning mt-1">VLAN 0 仅携带优先级标记，确认交换机策略后再使用。</p>
              )}
              {duplicateVlan && (
                <p className="text-xs text-danger mt-1">该设备上已经存在 VLAN {vlanTag}。</p>
              )}
            </div>

            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">网络选项</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setCreateNewNetwork(true)}
                  className={`flex-1 px-3 py-1.5 text-xs rounded-lg transition-colors ${
                    createNewNetwork ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-secondary'
                  }`}
                >
                  创建新网络
                </button>
                <button
                  onClick={() => setCreateNewNetwork(false)}
                  className={`flex-1 px-3 py-1.5 text-xs rounded-lg transition-colors ${
                    !createNewNetwork ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-secondary'
                  }`}
                >
                  使用现有网络
                </button>
              </div>
            </div>

            {createNewNetwork ? (
              <>
                <div>
                  <label className="text-xs text-muted-foreground mb-1.5 block">网络名称</label>
                  <input
                    value={nameLabel}
                    onChange={(e) => setNameLabel(e.target.value)}
                    placeholder={`VLAN ${vlanTag || '...'}`}
                    className="w-full px-3 py-2 text-sm bg-muted border border-input rounded-lg text-foreground placeholder-subtle focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1.5 block">描述</label>
                  <input
                    value={nameDescription}
                    onChange={(e) => setNameDescription(e.target.value)}
                    placeholder="可选描述"
                    className="w-full px-3 py-2 text-sm bg-muted border border-input rounded-lg text-foreground placeholder-subtle focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
              </>
            ) : (
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">选择网络</label>
                <select
                  value={networkRef}
                  title={attachableNetworks.find((network) => network.ref === networkRef)?.name_label}
                  onChange={(e) => setNetworkRef(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-muted border border-input rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="">选择网络...</option>
                  {attachableNetworks.map((net) => (
                    <option key={net.ref} value={net.ref} title={net.name_label}>{formatNetworkOptionLabel(net)}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-3 px-6 py-4 border-t border-border">
            <p className="mr-auto text-xs text-warning">{topologyBlocked}</p>
            <button onClick={() => onOpenChange(false)} className="px-4 py-2 text-sm bg-muted hover:bg-secondary text-foreground rounded-lg transition-colors">取消</button>
            <button onClick={handleCreate} disabled title={topologyBlocked} className="px-4 py-2 text-sm bg-primary hover:bg-primary-hover disabled:bg-secondary disabled:text-subtle disabled:cursor-not-allowed text-primary-foreground rounded-lg transition-colors">
              {creating ? '创建中...' : '创建 VLAN'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
