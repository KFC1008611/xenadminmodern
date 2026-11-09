/**
 * BondCreateDialog - Dialog for creating network bonds from multiple PIFs.
 * v9: Rewritten to use Tailwind CSS + Radix Dialog.
 */
import { useState, useEffect } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, Trash2 } from 'lucide-react'
import { useNetworkAdvancedStore } from '../../store/network-advanced.store'
import { feedback } from '../../store/feedback.store'
import type { PifRecord } from '../../types/xapi'
import { formatHostInterfaceLabel } from '../../lib/networkTerminology'
import { getAuditedFeatureBlockReason } from '../../../../shared/audited-features'

const topologyBlocked = getAuditedFeatureBlockReason('network.bond-vlan')

interface BondCreateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  connectionId: string
  pifs: PifRecord[]
  onSuccess?: () => void
}

type BondMode = 'active-backup' | 'balance-slb' | 'lacp'

const BOND_MODES: { value: BondMode; label: string; description: string }[] = [
  { value: 'active-backup', label: 'Active-Backup', description: '只有一个物理网卡处于活动状态，其他作为备份' },
  { value: 'balance-slb', label: 'Balance SLB', description: '基于源 MAC 地址的负载均衡' },
  { value: 'lacp', label: 'LACP (802.3ad)', description: '链路聚合控制协议，需要交换机支持' },
]

function formatSpeed(speed?: number): string {
  if (!speed || speed <= 0) return '未知'
  if (speed >= 1000) return `${speed / 1000} Gbps`
  return `${speed} Mbps`
}

function hostLabel(hostRef?: string): string {
  return hostRef ? hostRef.replace('OpaqueRef:', '').substring(0, 8) : 'unknown'
}

export function BondCreateDialog({ open, onOpenChange, connectionId, pifs, onSuccess }: BondCreateDialogProps) {
  const { createBond } = useNetworkAdvancedStore()
  const [selectedPifs, setSelectedPifs] = useState<string[]>([])
  const [mode, setMode] = useState<BondMode>('active-backup')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (open) {
      setSelectedPifs([])
      setMode('active-backup')
    }
  }, [open])

  const selectedDevices = new Set(
    selectedPifs
      .map((ref) => pifs.find((pif) => pif.ref === ref)?.device)
      .filter(Boolean)
  )
  const candidatePifs = pifs.filter((pif) =>
    pif.isBondCandidate &&
    !pif.isManagementInterface &&
    !pif.isClusterPif
  )
  const availablePifs = Array.from(
    candidatePifs.reduce((byDevice, pif) => {
      if (!byDevice.has(pif.device)) byDevice.set(pif.device, pif)
      return byDevice
    }, new Map<string, PifRecord>()).values()
  ).filter((pif) => !selectedPifs.includes(pif.ref) && !selectedDevices.has(pif.device))

  const handleAddPif = (pifRef: string) => {
    if (selectedPifs.length >= 4) {
      feedback.error('最多支持 4 个物理网卡绑定')
      return
    }
    setSelectedPifs([...selectedPifs, pifRef])
  }

  const handleRemovePif = (pifRef: string) => {
    setSelectedPifs(selectedPifs.filter((ref) => ref !== pifRef))
  }

  const handleCreate = async () => {
    if (!connectionId) {
      feedback.error('没有可用连接')
      return
    }

    if (selectedPifs.length < 2) {
      feedback.error('绑定至少需要 2 个物理网卡')
      return
    }

    setCreating(true)
    try {
      await createBond({ pifRefs: selectedPifs, mode }, connectionId)
      feedback.success('网卡绑定创建成功')
      onOpenChange(false)
      onSuccess?.()
    } catch (err: any) {
      feedback.error(err.message || '创建网卡绑定失败')
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-50" />
        <Dialog.Content aria-describedby={undefined} className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-2xl bg-card border border-border rounded-xl shadow-2xl z-50 focus:outline-none max-h-[85vh] overflow-y-auto">
          <div className="flex items-center justify-between px-6 py-4 border-b border-border">
            <Dialog.Title className="text-lg font-semibold text-foreground">创建网卡绑定（Bond）</Dialog.Title>
            <Dialog.Close className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors">
              <X className="w-4 h-4" />
            </Dialog.Close>
          </div>

          <div className="px-6 py-5 space-y-5">
            {/* Bond Mode */}
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">绑定模式</label>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as BondMode)}
                className="w-full px-3 py-2 text-sm bg-muted border border-input rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {BOND_MODES.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
              <p className="text-xs text-subtle mt-1">
                {BOND_MODES.find((m) => m.value === mode)?.description}
              </p>
            </div>

            {/* Selected PIFs */}
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">已选择的物理网卡 ({selectedPifs.length}/4)</label>
              {selectedPifs.length > 0 ? (
                <div className="space-y-2">
                  {selectedPifs.map((pifRef) => {
                    const pif = pifs.find((p) => p.ref === pifRef)
                    if (!pif) return null
                    return (
                      <div key={pifRef} className="flex items-center justify-between bg-muted border border-input rounded-lg p-3">
                        <div>
                          <p className="text-sm font-medium text-foreground">{formatHostInterfaceLabel(pif)}</p>
                          <p className="text-xs text-subtle">主机: {hostLabel(pif.host)} | MAC: {pif.MAC} | 速度: {formatSpeed(pif.speed)}</p>
                        </div>
                        <button onClick={() => handleRemovePif(pifRef)} className="p-1 text-muted-foreground hover:text-danger hover:bg-danger-soft rounded transition-colors">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p className="text-sm text-subtle">请从下方选择要绑定的物理网卡</p>
              )}
            </div>

            {/* Available PIFs */}
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">可用物理网卡</label>
              {availablePifs.length > 0 ? (
                <select
                  onChange={(e) => { if (e.target.value) { handleAddPif(e.target.value); e.target.value = '' } }}
                  className="w-full px-3 py-2 text-sm bg-muted border border-input rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  defaultValue=""
                >
                  <option value="" disabled>选择物理网卡...</option>
                  {availablePifs.map((pif) => (
                    <option key={pif.ref} value={pif.ref}>{formatHostInterfaceLabel(pif)} - {pif.MAC} ({formatSpeed(pif.speed)})</option>
                  ))}
                </select>
              ) : (
                <p className="text-sm text-subtle">没有可用的物理网卡</p>
              )}
            </div>
          </div>

          <div className="flex justify-end gap-3 px-6 py-4 border-t border-border">
            <p className="mr-auto text-xs text-warning">{topologyBlocked}</p>
            <button onClick={() => onOpenChange(false)} className="px-4 py-2 text-sm bg-muted hover:bg-secondary text-foreground rounded-lg transition-colors">取消</button>
            <button onClick={handleCreate} disabled title={topologyBlocked} className="px-4 py-2 text-sm bg-primary hover:bg-primary-hover disabled:bg-secondary disabled:text-subtle disabled:cursor-not-allowed text-primary-foreground rounded-lg transition-colors">
              {creating ? '创建中...' : '创建绑定'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
