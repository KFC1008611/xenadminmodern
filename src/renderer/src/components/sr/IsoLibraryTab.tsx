/**
 * IsoLibraryTab - ISO library management component.
 * v9: Rewritten to use project Tailwind style instead of shadcn/ui.
 */
import { useEffect, useState } from 'react'
import { Trash2, Loader2, Disc, RefreshCw } from 'lucide-react'
import { isoResourceKey, useStorageAdvancedStore } from '../../store/storage-advanced.store'
import { useConnectionManagerStore } from '../../store/connectionManager.store'
import { feedback } from '../../store/feedback.store'
import { getAuditedFeatureBlockReason } from '../../../../shared/audited-features'

const isoDeleteBlocked = getAuditedFeatureBlockReason('storage.pbd-iso')

interface IsoLibraryTabProps {
  srRef: string
  connectionId: string
  refreshRevision?: number
}

export function IsoLibraryTab({ srRef, connectionId, refreshRevision = 0 }: IsoLibraryTabProps) {
  const { isoStates, loadIsos, deleteIso } = useStorageAdvancedStore()
  const connection = useConnectionManagerStore((store) => store.connections.find((item) => item.id === connectionId))
  const state = isoStates[isoResourceKey(connectionId, srRef)]
  const isos = state?.items ?? []
  const isosLoading = state?.loading ?? true
  const [deleting, setDeleting] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const [scanResult, setScanResult] = useState<string | null>(null)
  const [scanError, setScanError] = useState<string | null>(null)

  const scan = async () => {
    if (scanning || connection?.state !== 'connected') return
    setScanning(true)
    setScanResult(null)
    setScanError(null)
    try {
      await window.xapi.sr.scan(connectionId, srRef)
      setScanResult('仓库扫描已完成。')
      await loadIsos(connectionId, srRef)
    } catch (error) {
      setScanError(error instanceof Error ? error.message : '扫描失败')
    } finally { setScanning(false) }
  }

  useEffect(() => {
    if (srRef) {
      void loadIsos(connectionId, srRef)
    }
  }, [connectionId, connection?.state, connection?.epoch, connection?.connectedAt, connection?.poolUuid, srRef, loadIsos, refreshRevision])

  const handleDelete = async (iso: any) => {
    if (!confirm(`确定要删除 ISO "${iso.name_label}" 吗？`)) return

    setDeleting(iso.ref)
    try {
      await deleteIso(connectionId, iso.ref)
      feedback.success('ISO 已删除')
      await loadIsos(connectionId, srRef)
    } catch (err: any) {
      feedback.error(err.message || '删除失败')
    } finally {
      setDeleting(null)
    }
  }

  const formatSize = (bytes: number) => {
    if (!bytes) return '未知'
    const gb = bytes / (1024 * 1024 * 1024)
    return `${gb.toFixed(2)} GB`
  }

  if (isosLoading && isos.length === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
        <Loader2 className="w-4 h-4 animate-spin" />
        加载 ISO 列表...
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground">ISO 库</h3>
        <span className="text-xs text-subtle">{isos.length} 个 ISO 镜像</span>
      </div>

      <p className="text-xs text-muted-foreground">将 ISO 文件放入此仓库的共享目录后，点击“扫描 ISO 仓库”。安装介质可在虚拟机的存储设备页挂载。</p>
      <button type="button" onClick={() => void scan()} disabled={scanning || isosLoading || connection?.state !== 'connected'} className="flex items-center gap-2 rounded bg-muted px-3 py-2 text-xs text-foreground disabled:opacity-50">
        <RefreshCw className={`h-3.5 w-3.5 ${scanning ? 'animate-spin' : ''}`} />{scanning ? '正在扫描 ISO 仓库...' : '扫描 ISO 仓库'}
      </button>
      {scanResult && <p role="status" className="text-xs text-success">{scanResult}</p>}
      {scanError && <p role="alert" className="break-words text-xs text-danger">扫描失败：{scanError}</p>}
      {isosLoading && <p role="status" className="text-xs text-muted-foreground">正在刷新 ISO 列表...</p>}
      {state?.error && (
        <div role="alert" className="text-sm text-danger py-4">
          <p>ISO 列表读取失败：{state.error}{isos.length > 0 && '。当前显示上次成功读取的数据。'}</p>
          <button onClick={() => void loadIsos(connectionId, srRef)} className="mt-2 text-accent-foreground">重新加载</button>
        </div>
      )}
      {isos.length === 0 && !state?.error ? (
        <div className="text-center py-6">
          <Disc className="w-8 h-8 text-subtle mx-auto mb-2" />
          <p className="text-sm text-subtle">没有 ISO 镜像</p>
          <p className="text-xs text-subtle mt-1">将 ISO 放入该 ISO 存储仓库后，扫描存储仓库刷新列表。</p>
        </div>
      ) : (
        <div className="space-y-2">
          {isos.map((iso: any) => (
            <div
              key={iso.ref}
              className="bg-muted border border-input rounded-lg p-3 flex items-center justify-between"
            >
              <div className="flex min-w-0 items-center gap-3">
                <Disc className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="break-all text-sm text-foreground">{iso.name_label}</p>
                  <div className="flex flex-wrap items-center gap-2 mt-0.5">
                    <span className="text-xs text-subtle">{formatSize(iso.virtual_size)}</span>
                    {iso.name_description && (
                      <span className="break-all text-xs text-subtle">· {iso.name_description}</span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-xs bg-accent text-accent-foreground px-1.5 py-0.5 rounded">ISO</span>
                <button
                  onClick={() => handleDelete(iso)}
                  disabled
                  className="p-1.5 text-danger hover:bg-danger-soft rounded-lg transition-colors disabled:opacity-50"
                  aria-label={`删除 ${iso.name_label}`}
                  title={isoDeleteBlocked}
                >
                  {deleting === iso.ref ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
