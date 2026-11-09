import { srUsedPercent } from '../../../../shared/storage-capacity'
/**
 * SrDetailPanel — right-side detail panel displayed when an SR is selected.
 * Shows SR metadata, storage usage, VDI table with search, ISO library, PBD management, and thin provisioning stats.
 * v9: Added ISO Library, PBD Management, and Thin Provisioning tabs.
 */
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMultiDataStore } from '../../store/multiData.store'
import { useConnectionManagerStore } from '../../store/connectionManager.store'
import { VdiRenameDialog } from './VdiRenameDialog'
import { SrIdentityDialog } from './SrIdentityDialog'
import { X, Search, HardDrive, Share2, Fingerprint, Disc, Link2, BarChart3 } from 'lucide-react'
import type { ConnectedSrRecord, VdiRecord } from '../../types/xapi'
import { formatBytes, cn } from '../../lib/utils'
import { IsoLibraryTab } from './IsoLibraryTab'
import { PbdManagementPanel } from './PbdManagementPanel'
import { ThinProvisioningChart } from './ThinProvisioningChart'

interface SrDetailPanelProps {
  sr: ConnectedSrRecord
  connectionId: string
  onClose: () => void
  refreshRevision?: number
}

export default function SrDetailPanel({
  sr,
  connectionId,
  onClose,
  refreshRevision = 0,
}: SrDetailPanelProps) {
  const isIso = sr.type === 'iso'
  const vms = useMultiDataStore((state) => state.vms)
  const srReadState = useMultiDataStore((state) => state.domainStates[connectionId]?.srs)
  const vmReadState = useMultiDataStore((state) => state.domainStates[connectionId]?.vms)
  const connected = useConnectionManagerStore((state) => state.connections.find((item) => item.id === connectionId)?.state === 'connected')
  const refreshConnection = useMultiDataStore((state) => state.refreshConnection)
  const [editingSr, setEditingSr] = useState(false)
  const [srSaved, setSrSaved] = useState(false)
  const vdiReadGeneration = useRef(0)
  const [editingVdi, setEditingVdi] = useState<VdiRecord | null>(null)
  const [savedName, setSavedName] = useState<string | null>(null)
  const [vdis, setVdis] = useState<VdiRecord[]>([])
  const [loadingVdis, setLoadingVdis] = useState(false)
  const [vdiError, setVdiError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState<'vdis' | 'iso' | 'pbd' | 'thin'>('vdis')

  useEffect(() => { if (connected) void refreshConnection(connectionId) }, [connectionId, connected, refreshConnection])

  useEffect(() => { setActiveTab(isIso ? 'iso' : 'vdis') }, [connectionId, sr.ref, isIso])

  useEffect(() => {
    let cancelled = false
    const generation = ++vdiReadGeneration.current
    const loadVdis = async () => {
      if (isIso || editingVdi) return
      if (!connected) { setVdiError('管理连接未连接，请重新连接后读取虚拟磁盘。'); setLoadingVdis(false); return }
      setLoadingVdis(true)
      setVdiError(null)
      try {
        const result = await window.xapi.storage.listVdis(connectionId, sr.ref)
        if (!cancelled && generation === vdiReadGeneration.current) setVdis(result)
      } catch (error) {
        if (!cancelled && generation === vdiReadGeneration.current) setVdiError(error instanceof Error ? error.message : '读取虚拟磁盘失败')
      } finally {
        if (!cancelled && generation === vdiReadGeneration.current) setLoadingVdis(false)
      }
    }
    loadVdis()
    return () => {
      cancelled = true
    }
  }, [connectionId, sr.ref, sr.VDIs, isIso, connected, refreshRevision, reload, editingVdi])

  const usedPercent = srUsedPercent(sr)

  const filteredVdis = vdis.filter((vdi) =>
    vdi.name_label.toLowerCase().includes(searchQuery.toLowerCase())
  )

  return (
    <div className="bg-card border border-border rounded-xl flex flex-col h-full">
      {/* Header */}
      <div className="px-5 py-4 border-b border-border flex items-center justify-between flex-shrink-0">
        <div className="flex min-w-0 items-center gap-3">
          <HardDrive className="w-5 h-5 text-accent-foreground" />
          <div className="min-w-0">
            <h2 className="break-all text-base font-semibold text-foreground">{sr.name_label}</h2>
            <p className="break-all text-xs text-subtle">{sr.poolName || connectionId}</p>
            <div className="flex items-center gap-3 mt-0.5">
              <span className="text-xs text-subtle">{sr.type}</span>
              <span className="flex items-center gap-1 text-xs text-subtle">
                <Share2 className="w-3 h-3" />
                {sr.shared ? '共享' : '本地'}
              </span>
            </div>
          </div>
        </div>
        <button
          onClick={onClose}
          className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
          aria-label="关闭存储仓库详情"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Metadata */}
      <div className="px-5 py-4 space-y-4 border-b border-border flex-shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="min-w-0 break-words text-sm text-muted-foreground">{sr.name_description || '暂无描述'}</p>
          <button type="button" disabled={!connected || Boolean(srReadState?.error) || srReadState?.loading} onClick={() => { setSrSaved(false); setEditingSr(true) }} className="shrink-0 text-xs text-accent-foreground disabled:opacity-50">编辑仓库信息</button>
        </div>
        {srReadState?.error && <div role="alert" className="text-xs text-warning"><p>仓库信息读取失败，当前显示上次成功读取的信息。{srReadState.error}</p><button type="button" onClick={() => void refreshConnection(connectionId)} className="mt-1 text-accent-foreground">重新读取仓库信息</button></div>}
        {srSaved && <p role="status" className="text-xs text-success">存储仓库名称和描述已保存。</p>}
        {/* UUID */}
        <div className="flex items-center gap-2">
          <Fingerprint className="w-4 h-4 text-subtle" />
          <span className="break-all text-xs text-subtle font-mono">{sr.uuid}</span>
        </div>

        {/* Storage usage */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-sm text-secondary-foreground">存储使用量</span>
            <span className="text-sm text-muted-foreground">
              {formatBytes(sr.physical_utilisation)} / {formatBytes(sr.physical_size)}
            </span>
          </div>
          <div className="w-full bg-muted rounded-full h-2">
            <div
              className={cn(
                'h-2 rounded-full transition-all',
                (usedPercent ?? 0) > 85
                  ? 'bg-danger-solid'
                  : (usedPercent ?? 0) > 70
                  ? 'bg-warning-solid'
                  : 'bg-primary'
              )}
              style={{ width: `${Math.min(100, Math.max(0, usedPercent ?? 0))}%` }}
            />
          </div>
          <div className="flex items-center justify-between mt-1">
            <span className="text-xs text-subtle">{usedPercent === null ? '容量未知' : `已用 ${usedPercent}%`}</span>
            <span className="text-xs text-subtle">
              {sr.VDIs?.length || 0} VDIs
            </span>
          </div>
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 flex flex-col min-h-0">
        {/* Tab bar */}
        <div className="flex-shrink-0 overflow-x-auto border-b border-border px-5 py-2">
          <div className="flex min-w-max items-center gap-1">
            {([
              { key: 'vdis' as const, icon: HardDrive, label: '虚拟磁盘' },
              { key: 'iso' as const, icon: Disc, label: 'ISO 镜像' },
              { key: 'pbd' as const, icon: Link2, label: '主机接入' },
              { key: 'thin' as const, icon: BarChart3, label: '精简配置' },
            ]).filter((tab) => isIso ? tab.key === 'iso' || tab.key === 'pbd' : tab.key !== 'iso').map((tab) => {
              const Icon = tab.icon
              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={cn(
                    'flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3 py-1.5 text-xs rounded-md transition-colors',
                    activeTab === tab.key
                      ? 'bg-secondary text-foreground'
                      : 'text-subtle hover:text-secondary-foreground hover:bg-muted'
                  )}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {tab.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Tab panels */}
        <div className="flex-1 overflow-y-auto">
          {activeTab === 'vdis' && (
            <div className="flex flex-col h-full">
              <div className="space-y-1 px-5 pt-3 text-xs text-muted-foreground">
                {vmReadState?.error && <div role="alert" className="text-warning"><p>关联虚拟机清单读取失败，以下名称可能来自上次成功读取。{vmReadState.error}</p><button type="button" disabled={vmReadState.loading} onClick={() => void refreshConnection(connectionId)} className="mt-1 text-accent-foreground">重新读取关联虚拟机</button></div>}
                {savedName && <p role="status" className="text-success">虚拟磁盘名称已保存为“{savedName}”。</p>}
              </div>
              {/* Search */}
              <div className="px-5 py-3 border-b border-border">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-subtle" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    aria-label="搜索虚拟磁盘"
                    placeholder="搜索虚拟磁盘..."
                    className="w-full bg-muted border border-input rounded-lg pl-9 pr-3 py-1.5 text-sm text-foreground placeholder-subtle focus:outline-none focus:border-primary/30 transition-colors"
                  />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto">
                {vdiError && <div role="alert" className="m-4 rounded border border-warning/50 p-3 text-sm text-warning">
                  <p>虚拟磁盘读取失败：{vdiError}{vdis.length > 0 && '。当前显示上次成功读取的数据。'}</p>
                  <button onClick={() => setReload((value) => value + 1)} className="mt-2 text-accent-foreground">重新加载</button>
                </div>}
                {loadingVdis && vdis.length === 0 ? (
                  <div className="p-8 text-center text-subtle text-sm">加载中...</div>
                ) : filteredVdis.length === 0 && !vdiError ? (
                  <div className="p-8 text-center text-subtle text-sm">
                    {searchQuery ? '没有匹配的虚拟磁盘' : '此仓库还没有虚拟磁盘，可从虚拟机的存储设备页创建。'}
                  </div>
                ) : (
                  filteredVdis.length > 0 && <div className="space-y-3 p-4">
                    {filteredVdis.map((vdi) => {
                      const relatedVms = vms.filter((vm) => vm.connectionId === connectionId && vm.VBDs?.some((ref) => vdi.VBDs?.includes(ref)))
                      const unmatchedAttachments = (vdi.VBDs ?? []).filter((ref) => !relatedVms.some((vm) => vm.VBDs.includes(ref))).length
                      return <article key={vdi.ref} aria-label={`虚拟磁盘 ${vdi.name_label || '未命名'}`} className="space-y-3 rounded-lg border border-border p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h3 className="break-words text-sm font-medium text-foreground">{vdi.name_label || '未命名磁盘'}</h3>
                            <p className="mt-1 text-xs text-subtle">{vdi.type} · {vdi.read_only ? '只读' : '可读写'}</p>
                          </div>
                          <button type="button" aria-label={`重命名虚拟磁盘 ${vdi.name_label}`} disabled={!connected || loadingVdis || Boolean(vdiError)} onClick={() => { setSavedName(null); setEditingVdi(vdi) }} className="shrink-0 text-xs text-accent-foreground disabled:opacity-50">重命名</button>
                        </div>
                        <dl className="grid grid-cols-2 gap-3 text-xs">
                          <div><dt className="text-subtle">虚拟大小</dt><dd className="mt-1 text-secondary-foreground">{formatBytes(vdi.virtual_size)}</dd></div>
                          <div><dt className="text-subtle">实际占用</dt><dd className="mt-1 text-secondary-foreground">{formatBytes(vdi.physical_utilisation)}</dd></div>
                        </dl>
                        <div className="space-y-1 border-t border-border pt-2 text-xs text-muted-foreground">
                          <p>关联虚拟机</p>
                          {relatedVms.map((vm) => <Link key={vm.ref} className="block break-words text-accent-foreground hover:underline" to={`/pool/${encodeURIComponent(connectionId)}/vms/${encodeURIComponent(vm.ref)}?tab=storage`}>{vm.name_label}</Link>)}
                          {unmatchedAttachments > 0 && <p>{unmatchedAttachments} 个挂载关系未匹配到普通虚拟机</p>}
                          {vdi.VBDs === undefined ? <p>挂载关系未上报</p> : vdi.VBDs.length === 0 ? <p>未挂载</p> : null}
                        </div>
                      </article>
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'iso' && (
            <div className="p-4">
              <IsoLibraryTab srRef={sr.ref} connectionId={connectionId} refreshRevision={refreshRevision} />
            </div>
          )}

          {activeTab === 'pbd' && (
            <div className="p-4">
              <PbdManagementPanel srRef={sr.ref} connectionId={connectionId} refreshRevision={refreshRevision} />
            </div>
          )}

          {activeTab === 'thin' && (
            <div className="p-4">
              <ThinProvisioningChart srRef={sr.ref} srName={sr.name_label} connectionId={connectionId} refreshRevision={refreshRevision} />
            </div>
          )}
        </div>
      </div>
      {editingSr && <SrIdentityDialog sr={sr} connectionId={connectionId} disabled={!connected || Boolean(srReadState?.error)} onClose={() => setEditingSr(false)} onSaved={() => setSrSaved(true)} />}
      {editingVdi && <VdiRenameDialog key={editingVdi.ref} vdi={editingVdi} connectionId={connectionId} srRef={sr.ref}
        disabled={!connected || Boolean(vdiError)} onClose={() => setEditingVdi(null)}
        onRead={(records) => { vdiReadGeneration.current++; setVdis(records); setLoadingVdis(false) }} onSaved={setSavedName} />}
    </div>
  )
}
