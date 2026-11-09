/**
 * VmStorageTab — VM storage management tab showing VBD/VDI list
 * v6: Storage tab with VDI management capabilities
 */
import { useEffect, useRef, useState } from 'react'
import { HardDrive, Plus, RefreshCw } from 'lucide-react'
import { VdiListItem } from '../vdi/VdiListItem'
import { VdiCreateDialog } from '../vdi/VdiCreateDialog'
import { VdiResizeDialog } from '../vdi/VdiResizeDialog'
import { VdiAttachDialog } from '../vdi/VdiAttachDialog'
import { VdiMoveDialog } from '../vdi/VdiMoveDialog'
import { executeAction, executeConfirm } from '../../lib/executeAction'
import type { VdiRecord } from '../../types/xapi'
import { useMultiDataStore } from '../../store/multiData.store'

interface VmStorageTabProps {
  connectionId: string
  vmRef: string
  powerState: string
  vbdRefs?: string[]
  refreshKey?: number | string
  disabled?: boolean
  onViewStorage?: (srRef: string) => void
}

interface VdiWithVbd extends VdiRecord {
  vbdRef: string
  userdevice: string
  bootable: boolean
  mode: string
  currently_attached: boolean
  unpluggable: boolean
  allowed_operations?: string[]
}

export function VmStorageTab({ connectionId, vmRef, powerState, vbdRefs, refreshKey = 0, disabled = false, onViewStorage }: VmStorageTabProps) {
  const srs = useMultiDataStore((state) => state.srs)
  const [vdis, setVdis] = useState<VdiWithVbd[]>([])
  const [loading, setLoading] = useState(true)
  const [readError, setReadError] = useState<string | null>(null)
  const readGeneration = useRef(0)
  const actionInFlight = useRef(false)
  const [actionBusy, setActionBusy] = useState(false)
  const vbdKey = JSON.stringify(vbdRefs ?? [])
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [attachDialogOpen, setAttachDialogOpen] = useState(false)
  const [resizeDialogVdi, setResizeDialogVdi] = useState<VdiWithVbd | null>(null)
  const [moveDialogVdi, setMoveDialogVdi] = useState<VdiWithVbd | null>(null)

  const loadVdis = async () => {
    const generation = ++readGeneration.current
    setLoading(true)
    setReadError(null)
    try {
      const vbds = await window.xapi.vm.getVBDs(connectionId, vmRef)
      const disks = vbds.filter((vbd) => vbd.type === 'Disk' && vbd.VDI && vbd.VDI !== 'OpaqueRef:NULL')
      const srRefs = [...new Set(disks.map((vbd) => vbd.srRef))]
      const records = await Promise.all(srRefs.map((ref) => window.xapi.storage.listVdis(connectionId, ref)))
      const vdiList = disks.map((vbd) => {
        const vdi = records.flat().find((item) => item.ref === vbd.VDI)
        if (!vdi) throw new Error(`无法确认磁盘 ${vbd.VDI} 的状态`)
        return { ...vdi, vbdRef: vbd.ref, userdevice: vbd.userdevice, bootable: vbd.bootable,
          mode: vbd.mode, currently_attached: vbd.currently_attached, unpluggable: vbd.unpluggable,
          allowed_operations: vbd.allowed_operations }
      })
      if (generation === readGeneration.current) setVdis(vdiList)
    } catch (error: any) {
      if (generation === readGeneration.current) {
        setVdis([])
        setReadError(error?.message || '无法读取磁盘状态')
      }
    } finally {
      if (generation === readGeneration.current) setLoading(false)
    }
  }

  useEffect(() => {
    setVdis([])
    void loadVdis()
    return () => { readGeneration.current++ }
  }, [connectionId, vmRef, powerState, vbdKey, refreshKey])

  const handleResize = (vdi: VdiWithVbd) => {
    setResizeDialogVdi(vdi)
  }

  const handleMove = (vdi: VdiWithVbd) => {
    setMoveDialogVdi(vdi)
  }

  const handleToggleAttached = async (vdi: VdiWithVbd) => {
    if (actionInFlight.current || loading || disabled) return
    actionInFlight.current = true
    setActionBusy(true)
    try {
      await executeAction({
        label: vdi.currently_attached ? `停用磁盘 "${vdi.name_label}"` : `激活磁盘 "${vdi.name_label}"`,
        action: async () => {
          try {
            if (vdi.currently_attached) await window.xapi.vm.unplugVbd(connectionId, vdi.vbdRef)
            else await window.xapi.vm.plugVbd(connectionId, vdi.vbdRef)
          } finally { await loadVdis() }
        },
      })
    } finally {
      actionInFlight.current = false
      setActionBusy(false)
    }
  }

  const handleDetach = async (vdi: VdiWithVbd) => {
    if (actionInFlight.current || loading || disabled) return
    actionInFlight.current = true
    setActionBusy(true)
    try {
      await executeConfirm({
        title: '分离虚拟磁盘',
        message: `确定要从 VM 分离磁盘 "${vdi.name_label}" 吗？磁盘数据会保留在 SR 中。`,
        variant: 'warning',
        confirmLabel: '分离',
        label: `分离磁盘 "${vdi.name_label}"`,
        action: async () => {
          try { await window.xapi.vm.detachVbd(connectionId, vdi.vbdRef) }
          finally { await loadVdis() }
        },
      })
    } finally {
      actionInFlight.current = false
      setActionBusy(false)
    }
  }

  const handleRemove = async (vdi: VdiWithVbd) => {
    if (actionInFlight.current || loading || disabled) return
    actionInFlight.current = true
    setActionBusy(true)
    try {
      await executeConfirm({
        title: '删除虚拟磁盘',
        message: `确定要删除磁盘 "${vdi.name_label}" 吗？此操作会删除 VDI 数据且不可撤销。`,
        variant: 'danger',
        confirmLabel: '删除',
        label: `删除磁盘 "${vdi.name_label}"`,
        action: async () => {
          try {
            const result = await window.xapi.storage.destroyVdi(connectionId, vdi.ref)
            if (!result.vdiDeleted) throw new Error(`磁盘连接已删除，但 VDI 仍保留在存储仓库：${result.warning || vdi.ref}`)
          } finally { await loadVdis() }
        },
      })
    } finally {
      actionInFlight.current = false
      setActionBusy(false)
    }
  }


  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          {vdis.length} 个虚拟磁盘
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={loadVdis}
            disabled={loading || actionBusy || disabled}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            刷新
          </button>
          <button
            onClick={() => setAttachDialogOpen(true)}
            disabled={loading || actionBusy || disabled}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-secondary-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
          >
            <HardDrive className="w-4 h-4" />
            附加已有磁盘
          </button>
          <button
            onClick={() => setCreateDialogOpen(true)}
            disabled={loading || actionBusy || disabled}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-primary hover:bg-primary-hover text-primary-foreground text-sm font-medium rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            新建虚拟磁盘
          </button>
        </div>
      </div>

      {actionBusy && <p role="status" className="text-sm text-muted-foreground">正在确认或处理磁盘操作…</p>}
      {readError && <div role="alert" className="p-3 text-sm text-warning bg-warning-soft rounded-lg">磁盘状态读取失败：{readError}。请刷新后再操作。</div>}
      {/* VDI List */}
      {loading ? (
        <div role="status" className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-input border-t-primary" />
          正在加载存储信息...
        </div>
      ) : readError ? null : vdis.length > 0 ? (
        <div className="space-y-2">
          {vdis.map((vdi) => (
            <div key={vdi.ref}>
            <VdiListItem
              vdi={vdi}
              powerState={powerState}
              disabled={disabled || actionBusy}
              onResize={() => handleResize(vdi)}
              onMove={() => handleMove(vdi)}
              onToggleAttached={() => handleToggleAttached(vdi)}
              onDetach={() => handleDetach(vdi)}
              onRemove={() => handleRemove(vdi)}
            />
            {onViewStorage && <button type="button" onClick={() => onViewStorage(vdi.SR)} className="mt-1 ml-4 text-xs text-accent-foreground underline">存储仓库：{srs.find((sr) => sr.connectionId === connectionId && sr.ref === vdi.SR)?.name_label || vdi.SR}</button>}
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-12 text-subtle bg-card border border-border rounded-xl">
          <HardDrive className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>没有找到虚拟磁盘</p>
        </div>
      )}

      {/* Create Dialog */}
      <VdiCreateDialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        connectionId={connectionId}
        vmRef={vmRef}
        onCreated={loadVdis}
      />

      <VdiAttachDialog
        open={attachDialogOpen}
        onClose={() => setAttachDialogOpen(false)}
        connectionId={connectionId}
        vmRef={vmRef}
        onAttached={loadVdis}
      />

      {/* Resize Dialog */}
      {resizeDialogVdi && (
        <VdiResizeDialog
          open={!!resizeDialogVdi}
          onClose={() => setResizeDialogVdi(null)}
          connectionId={connectionId}
          vmRef={vmRef}
          vdi={resizeDialogVdi}
          powerState={powerState}
          onResized={loadVdis}
        />
      )}

      {moveDialogVdi && (
        <VdiMoveDialog
          open={!!moveDialogVdi}
          onClose={() => setMoveDialogVdi(null)}
          connectionId={connectionId}
          vdi={moveDialogVdi}
          onMoved={loadVdis}
        />
      )}
    </div>
  )
}
