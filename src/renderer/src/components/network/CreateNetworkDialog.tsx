import { DesktopDialog } from '../layout/DesktopDialog'
/**
 * CreateNetworkDialog — modal form for creating a new network.
 */
import { useRef, useState } from 'react'
import { X, Loader2 } from 'lucide-react'
import { useToast } from '../toast/useToast'
import { useConnectionManagerStore } from '../../store/connectionManager.store'

interface CreateNetworkDialogProps {
  open: boolean
  onClose: () => void
  connectionId: string
  onCreated: (networkRef?: string) => void | Promise<void>
}

export function CreateNetworkDialog({
  open,
  onClose,
  connectionId,
  onCreated,
}: CreateNetworkDialogProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)
  const [unconfirmed, setUnconfirmed] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const creating = useRef(false)
  const toast = useToast()
  const connection = useConnectionManagerStore((state) => state.connections.find((item) => item.id === connectionId))

  if (!open) return null

  const handleCreate = async () => {
    if (!name.trim() || creating.current || unconfirmed) return
    creating.current = true
    setLoading(true)
    setError(null)
    try {
      const networkRef = await window.xapi.network.create(connectionId, name.trim(), description.trim())
      toast.success(`网络 "${name.trim()}" 创建成功`)
      setName('')
      setDescription('')
      try { await onCreated(networkRef) }
      catch (refreshError: any) { toast.info(`网络已创建，清单刷新失败：${refreshError?.message || String(refreshError)}。请重新读取清单。`) }
      onClose()
    } catch (e: any) {
      if (['NETWORK_CREATE_OUTCOME_UNKNOWN', 'NETWORK_CREATED_UNCONFIRMED'].some((code) => e?.code === code || e?.message?.includes(code))) {
        setUnconfirmed(e?.message || '无法获取网络创建结果，服务器未返回可用的网络信息。')
        try { await onCreated() } catch { /* The unknown result remains visible for reconciliation. */ }
      } else {
        setError(`创建网络失败：${e?.message || String(e)}`)
      }
    } finally {
      setLoading(false)
      creating.current = false
    }
  }

  const handleClose = () => {
    if (loading) return
    setName('')
    setDescription('')
    setUnconfirmed(null)
    setError(null)
    onClose()
  }

  return (
    <DesktopDialog title="创建网络" onClose={handleClose} busy={loading} className="max-w-md">
      <div className="bg-card border border-input rounded-xl shadow-2xl w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground">创建网络</h2>
          <button
            onClick={handleClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label="关闭"
            disabled={loading}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form id="network-create-form" onSubmit={(event) => { event.preventDefault(); void handleCreate() }} className="px-6 py-5 space-y-4">
          <p className="text-sm text-secondary-foreground break-words">目标资源池：{connection?.poolName || connection?.name || connectionId}</p>
          <p className="text-sm text-muted-foreground">内部网络；物理出口和 VLAN 需单独配置。</p>
          {unconfirmed && <div role="alert" className="rounded-lg border border-warning/30 bg-warning-soft p-3 text-sm text-warning break-words">{unconfirmed}</div>}
          {error && <div role="alert" className="rounded-lg border border-danger/30 bg-danger-soft p-3 text-sm text-danger break-words">{error}</div>}
          <div>
            <label htmlFor="network-create-name" className="block text-sm font-medium text-secondary-foreground mb-1.5">
              名称 <span className="text-danger">*</span>
            </label>
            <input
              id="network-create-name"
              type="text"
              disabled={loading || !!unconfirmed}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="网络名称"
              className="w-full px-3 py-2 bg-muted border border-input rounded-lg text-sm text-foreground placeholder-subtle focus:outline-none focus:ring-1 focus:ring-primary"
              autoFocus
            />
          </div>

          <div>
            <label htmlFor="network-create-description" className="block text-sm font-medium text-secondary-foreground mb-1.5">
              描述
            </label>
            <input
              id="network-create-description"
              type="text"
              disabled={loading || !!unconfirmed}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="可选描述"
              className="w-full px-3 py-2 bg-muted border border-input rounded-lg text-sm text-foreground placeholder-subtle focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </form>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border">
          <button
            onClick={handleClose}
            disabled={loading}
            className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="submit"
            form="network-create-form"
            disabled={loading || !!unconfirmed || !name.trim()}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-primary hover:bg-primary-hover disabled:bg-secondary disabled:text-subtle disabled:cursor-not-allowed text-primary-foreground rounded-lg transition-colors"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            创建
          </button>
        </div>
      </div>
    </DesktopDialog>
  )
}
