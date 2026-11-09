import { DesktopDialog } from '../layout/DesktopDialog'
/**
 * AddVifDialog — modal form for adding a VIF to a VM.
 * Provides network selection dropdown and optional MAC address input.
 */
import { useEffect, useRef, useState } from 'react'
import { X, Loader2 } from 'lucide-react'
import type { ConnectedNetworkRecord } from '../../types/xapi'
import { formatNetworkOptionLabel } from '../../lib/networkDisplay'
import { useToast } from '../toast/useToast'

interface AddVifDialogProps {
  open: boolean
  onClose: () => void
  connectionId: string
  vmRef: string
  networks: ConnectedNetworkRecord[]
  onCreated: () => void | Promise<void>
}

export function AddVifDialog({
  open,
  onClose,
  connectionId,
  vmRef,
  networks,
  onCreated,
}: AddVifDialogProps) {
  const [networkRef, setNetworkRef] = useState('')
  const [mac, setMac] = useState('')
  const [loading, setLoading] = useState(false)
  const [readingResult, setReadingResult] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestId = useRef<string | null>(null)
  const toast = useToast()

  useEffect(() => { setNetworkRef(''); setMac(''); setReadingResult(false); setError(null); requestId.current = null }, [open, connectionId, vmRef])
  const availableNetworks = networks.filter((network) => network.connectionId === connectionId)
  const selectedNetworkExists = availableNetworks.some((network) => network.ref === networkRef)
  const macValid = !mac.trim() || /^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(mac.trim())
  if (!open) return null

  const handleCreate = async () => {
    if (!selectedNetworkExists || !macValid || loading) return
    setLoading(true)
    setError(null)
    requestId.current ??= crypto.randomUUID()
    try {
      const result = await window.xapi.vif.create(connectionId, {
        vmRef,
        networkRef,
        mac: mac.trim() || undefined,
        requestId: requestId.current,
      })
      if (result.warning) toast.info(`虚拟网卡已创建，但未能热插拔：${result.warning}`)
      else toast.success('虚拟网卡创建成功')
      setNetworkRef('')
      setMac('')
      onClose()
      try { await onCreated() } catch (error: any) { toast.info(`虚拟网卡已创建，但刷新失败：${error?.message || String(error)}。请重新读取后核对。`) }
    } catch (e: any) {
      if (e?.code === 'VIF_CREATION_REMOVED') requestId.current = null
      setReadingResult(e?.code === 'RESOURCE_RESULT_READ_FAILED')
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    if (loading) return
    setNetworkRef('')
    setMac('')
    onClose()
  }


  return (
    <DesktopDialog title="添加虚拟网卡" onClose={handleClose} busy={loading} className="max-w-md">
      <div className="bg-card border border-input rounded-xl shadow-2xl w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground">添加虚拟网卡</h2>
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
        <div className="px-6 py-5 space-y-4">
          {error && <p role="alert" className="break-words text-sm text-warning">{error}</p>}
          <div>
            <label className="block text-sm font-medium text-secondary-foreground mb-1.5">
              网络 <span className="text-danger">*</span>
            </label>
            <select
              aria-label="网络"
              disabled={loading || readingResult}
              value={networkRef}
              title={availableNetworks.find((network) => network.ref === networkRef)?.name_label}
              onChange={(e) => setNetworkRef(e.target.value)}
              className="w-full px-3 py-2 bg-muted border border-input rounded-lg text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">选择网络...</option>
              {availableNetworks.map((net) => (
                <option key={net.ref} value={net.ref} title={net.name_label}>
                  {formatNetworkOptionLabel(net)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-secondary-foreground mb-1.5">
              MAC 地址
            </label>
            <input
              type="text"
              aria-label="MAC 地址"
              disabled={loading || readingResult}
              value={mac}
              onChange={(e) => setMac(e.target.value)}
              placeholder="自动生成"
              className="w-full px-3 py-2 bg-muted border border-input rounded-lg text-sm text-foreground placeholder-subtle focus:outline-none focus:ring-1 focus:ring-primary font-mono"
            />
            <p className="text-xs text-subtle mt-1">留空则自动分配 MAC 地址</p>
            {!macValid && <p role="alert" className="mt-1 text-xs text-warning">请输入六组十六进制 MAC 地址，例如 02:00:00:00:00:01。</p>}
          </div>
        </div>

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
            onClick={handleCreate}
            disabled={loading || !selectedNetworkExists || !macValid}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-primary hover:bg-primary-hover disabled:bg-secondary disabled:text-subtle disabled:cursor-not-allowed text-primary-foreground rounded-lg transition-colors"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            {readingResult ? '重新读取创建结果' : '创建'}
          </button>
        </div>
      </div>
    </DesktopDialog>
  )
}
