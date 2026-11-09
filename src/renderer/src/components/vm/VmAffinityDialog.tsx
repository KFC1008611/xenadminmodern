import { DesktopDialog } from '../layout/DesktopDialog'
/**
 * VmAffinityDialog — Dialog for configuring VM affinity and anti-affinity rules.
 * v9: New dialog for VM affinity configuration.
 */
import { useEffect, useState } from 'react'
import { X, Server } from 'lucide-react'
import { useToast } from '../toast/useToast'
import { useVmAdvancedStore, vmAdvancedKey } from '../../store/vm-advanced.store'
import { useConnectionManagerStore } from '../../store/connectionManager.store'

interface VmAffinityDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  vmRef: string
  connectionId: string
}

interface HostOption {
  ref: string
  name: string
}

export function VmAffinityDialog({ open, onOpenChange, vmRef, connectionId }: VmAffinityDialogProps) {
  const toast = useToast()
  const { affinityConfig, affinityConfigKey, affinityConfigLoading, affinityConfigError, loadAffinityConfig, setVmAffinity } = useVmAdvancedStore()
  const connection = useConnectionManagerStore((state) => state.connections.find((item) => item.id === connectionId))

  const [hosts, setHosts] = useState<HostOption[]>([])
  const [selectedHost, setSelectedHost] = useState<string>('')
  const [loading, setLoading] = useState(false)

  const [resourcesLoading, setResourcesLoading] = useState(true)
  const [resourcesError, setResourcesError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const configCurrent = affinityConfigKey === vmAdvancedKey(connectionId, vmRef) && affinityConfig?.vmRef === vmRef
  const ready = connection?.state === 'connected' && configCurrent && !affinityConfigLoading && !affinityConfigError && !resourcesLoading && !resourcesError

  useEffect(() => {
    if (!open || !vmRef) return
    let disposed = false
    setSelectedHost(''); setHosts([]); setResourcesLoading(true); setResourcesError(null)
    if (connection?.state !== 'connected') {
      setResourcesLoading(false); setResourcesError('管理连接未连接，请恢复连接后重新读取')
      return
    }
    void loadAffinityConfig(connectionId, vmRef)
    void window.xapi.host.list(connectionId).then((hostList) => {
      if (!disposed) setHosts(hostList.map((host) => ({ ref: host.ref, name: host.name_label })))
    }).catch((error) => { if (!disposed) setResourcesError(error.message || '主机读取失败') })
      .finally(() => { if (!disposed) setResourcesLoading(false) })
    return () => { disposed = true }
  }, [connectionId, connection?.state, connection?.epoch, connection?.poolUuid, open, vmRef, loadAffinityConfig, revision])

  useEffect(() => {
    if (configCurrent && affinityConfig) setSelectedHost(affinityConfig.hostRef || '')
  }, [configCurrent, affinityConfig])

  const handleSaveAffinity = async () => {
    if (!ready || loading || selectedHost && !hosts.some((host) => host.ref === selectedHost)) return
    setLoading(true)
    try {
      await setVmAffinity(connectionId, vmRef, selectedHost || null)
      toast.success('亲和主机已更新')
      onOpenChange(false)
    } catch (err: any) {
      toast.error(err.message || '保存失败')
    } finally {
      setLoading(false)
    }
  }

  if (!open) return null

  return (
    <DesktopDialog title="配置亲和主机" onClose={() => onOpenChange(false)} busy={loading} className="max-w-2xl">
      <div className="relative bg-card border rounded-lg shadow-lg w-full max-w-2xl ">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold">配置亲和主机</h2>
          <button
            aria-label="关闭"
            disabled={loading}
            onClick={() => onOpenChange(false)}
            className="p-1 hover:bg-secondary rounded"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 overflow-y-auto max-h-[60vh] space-y-6">
          {/* 亲和主机 */}
          <div>
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Server className="h-4 w-4" />
              亲和主机
            </h3>
            <div className="text-xs text-muted-foreground mb-3">
              设置 VM 优先放置或启动的主机；资源池仍会依据当前条件决定放置位置
            </div>
            <select
              aria-label="亲和主机"
              disabled={loading || !ready}
              value={selectedHost}
              onChange={(e) => setSelectedHost(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-background border rounded-md"
            >
              <option value="">自动选择主机</option>
              {hosts.map((host) => (
                <option key={host.ref} value={host.ref}>
                  {host.name}
                </option>
              ))}
            </select>
          </div>

          {(affinityConfigError || resourcesError) && <div role="alert" className="space-y-2 text-sm text-warning break-words">
            <p>配置读取失败：{affinityConfigError || resourcesError}</p>
            <button type="button" onClick={() => setRevision((value) => value + 1)} className="underline">重新读取</button>
          </div>}
          {(resourcesLoading || affinityConfigLoading) && <p role="status" className="text-sm text-muted-foreground">正在读取亲和主机配置...</p>}

        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 p-4 border-t">
          <button
            onClick={() => onOpenChange(false)}
            className="px-4 py-2 text-sm font-medium rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80"
            disabled={loading}
          >
            取消
          </button>
          <button
            onClick={handleSaveAffinity}
            className="px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
            disabled={loading || !ready || !!selectedHost && !hosts.some((host) => host.ref === selectedHost)}
          >
            {loading ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </DesktopDialog>
  )
}
