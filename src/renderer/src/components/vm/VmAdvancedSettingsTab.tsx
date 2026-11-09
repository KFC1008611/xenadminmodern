/**
 * VmAdvancedSettingsTab — VM advanced settings including affinity, protection,
 * VCPU hotplug, boot order, and platform settings.
 * v9: New component for VM advanced features.
 */
import { useEffect, useState } from 'react'
import { Shield, Cpu, HardDrive, Settings, Tag, Clock, AlertCircle } from 'lucide-react'
import { useToast } from '../toast/useToast'
import { useVmAdvancedStore, vmAdvancedKey } from '../../store/vm-advanced.store'
import type { VmAdvancedConfig } from '../../types/xapi'
import { VmAffinityDialog } from './VmAffinityDialog'
import { VmBootOrderDialog } from './VmBootOrderDialog'

interface VmAdvancedSettingsTabProps {
  connectionId: string
  vmRef: string
  powerState: string
}

export function VmAdvancedSettingsTab({ connectionId, vmRef, powerState }: VmAdvancedSettingsTabProps) {
  const toast = useToast()
  const { vmConfigs, vmConfigReads, loadVmConfig, enableVmProtection, disableVmProtection, setVmViridian } = useVmAdvancedStore()

  const [affinityDialogOpen, setAffinityDialogOpen] = useState(false)
  const [bootOrderDialogOpen, setBootOrderDialogOpen] = useState(false)
  const [viridianEnabled, setViridianEnabled] = useState(false)
  const [actionBusy, setActionBusy] = useState(false)
  const readState = vmConfigReads[vmAdvancedKey(connectionId, vmRef)]
  const busy = actionBusy || readState?.loading === true || !!readState?.error

  const config = vmConfigs[vmAdvancedKey(connectionId, vmRef)] as VmAdvancedConfig | undefined

  useEffect(() => {
    loadVmConfig(connectionId, vmRef)
  }, [connectionId, vmRef, loadVmConfig])

  useEffect(() => {
    if (config) {
      setViridianEnabled(config.platform?.viridian === 'true')
    }
  }, [config])

  const handleToggleProtection = async () => {
    if (busy) return
    setActionBusy(true)
    try {
      if (config?.isProtected) {
        await disableVmProtection(connectionId, vmRef)
        toast.success('VM保护已禁用')
      } else {
        await enableVmProtection(connectionId, vmRef)
        toast.success('VM保护已启用')
      }
    } catch (err: any) {
      toast.error(err.message || '操作失败')
      await loadVmConfig(connectionId, vmRef)
    } finally { setActionBusy(false) }
  }

  const handleToggleViridian = async () => {
    if (busy) return
    setActionBusy(true)
    try {
      await setVmViridian(connectionId, vmRef, !viridianEnabled)
      setViridianEnabled(!viridianEnabled)
      toast.success(viridianEnabled ? 'Viridian已禁用' : 'Viridian已启用')
    } catch (err: any) {
      toast.error(err.message || '操作失败')
      await loadVmConfig(connectionId, vmRef)
    } finally { setActionBusy(false) }
  }

  if (readState?.error && !config) return <div role="alert" className="space-y-3 p-4 text-sm text-warning break-words">高级配置读取失败：{readState.error}<button type="button" onClick={() => void loadVmConfig(connectionId, vmRef)} className="block rounded bg-muted px-3 py-2">重新读取</button></div>

  if (!config) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">加载高级配置...</div>
      </div>
    )
  }

  const bootOrderLabels: Record<string, string> = {
    c: '硬盘',
    d: '光驱',
    n: '网络',
  }

  const bootOrderDisplay = config.bootOrder
    ? config.bootOrder.split('').map((c) => bootOrderLabels[c] || c).join(' → ')
    : '默认'

  return (
    <div className="space-y-6">
      {readState?.error && <div role="alert" className="space-y-2 text-sm text-warning break-words">高级配置读取失败：{readState.error}。当前显示最近一次成功读取的数据。<button onClick={() => void loadVmConfig(connectionId, vmRef)} className="block rounded bg-muted px-3 py-2">重新读取</button></div>}
      {/* 保护设置 */}
      <div className="rounded-lg border bg-card">
        <div className="p-4 border-b">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            <h3 className="text-sm font-semibold">保护设置</h3>
          </div>
        </div>
        <div className="p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 break-words">
              <div className="text-sm font-medium">VM保护</div>
              <div className="text-xs text-muted-foreground">
                防止从管理工具删除 VM；不改变高可用策略。其他工具设置的保护需在原来源解除。
              </div>
            </div>
            <button
              onClick={handleToggleProtection}
              disabled={busy}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                config.isProtected
                  ? 'bg-danger-soft text-danger hover:bg-danger-soft'
                  : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
              }`}
            >
              {config.isProtected ? '已启用' : '已禁用'}
            </button>
          </div>
        </div>
      </div>

      {/* 主机亲和性 */}
      <div className="rounded-lg border bg-card">
        <div className="p-4 border-b">
          <div className="flex items-center gap-2">
            <Settings className="h-5 w-5 text-primary" />
            <h3 className="text-sm font-semibold">主机亲和性</h3>
          </div>
        </div>
        <div className="p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 break-words">
              <div className="text-sm font-medium">亲和主机</div>
              <div className="text-xs text-muted-foreground">
                {config.affinity ? `偏好主机：${config.affinity}` : '自动放置'}
              </div>
            </div>
            <button
              onClick={() => setAffinityDialogOpen(true)}
              disabled={busy}
              className="px-3 py-1.5 text-xs font-medium rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80"
            >
              配置
            </button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 break-words">
              <div className="text-sm font-medium">Anti-Affinity</div>
              <div className="text-xs text-muted-foreground">
                {config.antiAffinitySupported !== true ? '服务器未提供 VM Group 信息' : config.antiAffinity.length > 0
                  ? `${config.antiAffinity.length} 个VM`
                  : '未发现其他反亲和成员'}
              </div>
            </div>
            <button
              onClick={() => setAffinityDialogOpen(true)}
              disabled
              title="此客户端仅查询 VM Group 反亲和信息；请使用支持 VM Group 的工具修改策略"
              className="px-3 py-1.5 text-xs font-medium rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80"
            >
              只读
            </button>
          </div>
        </div>
      </div>

      {/* VCPU和内存 */}
      <div className="rounded-lg border bg-card">
        <div className="p-4 border-b">
          <div className="flex items-center gap-2">
            <Cpu className="h-5 w-5 text-primary" />
            <h3 className="text-sm font-semibold">VCPU设置</h3>
          </div>
        </div>
        <div className="p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 break-words">
              <div className="text-sm font-medium">vCPU 扩展空间</div>
              <div className="text-xs text-muted-foreground">
                {config.vcpusHotplug ? '最大数量高于启动数量，已预留扩展空间' : '最大数量与启动数量相同，未预留扩展空间'}
              </div>
            </div>
            <div className={`px-2 py-1 text-xs rounded ${
              config.vcpusHotplug ? 'bg-success-soft text-success' : 'bg-warning-soft text-warning'
            }`}>
              {config.vcpusHotplug ? '已预留' : '未预留'}
            </div>
          </div>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">预留数量不代表支持在线增减 vCPU；实际能力取决于主机与来宾系统。</p>
      {/* 启动设置 */}
      <div className="rounded-lg border bg-card">
        <div className="p-4 border-b">
          <div className="flex items-center gap-2">
            <HardDrive className="h-5 w-5 text-primary" />
            <h3 className="text-sm font-semibold">启动设置</h3>
          </div>
        </div>
        <div className="p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 break-words">
              <div className="text-sm font-medium">启动顺序</div>
              <div className="text-xs text-muted-foreground">
                {bootOrderDisplay}
              </div>
            </div>
            <button
              onClick={() => setBootOrderDialogOpen(true)}
              className="px-3 py-1.5 text-xs font-medium rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80"
              disabled={busy || powerState !== 'Halted'}
            >
              配置
            </button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 break-words">
              <div className="text-sm font-medium">启动延迟</div>
              <div className="text-xs text-muted-foreground">
                <Clock className="h-3 w-3 inline mr-1" />
                {config.startDelay}秒
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 平台设置 */}
      <div className="rounded-lg border bg-card">
        <div className="p-4 border-b">
          <div className="flex items-center gap-2">
            <Settings className="h-5 w-5 text-primary" />
            <h3 className="text-sm font-semibold">平台设置</h3>
          </div>
        </div>
        <div className="p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 break-words">
              <div className="text-sm font-medium">Viridian (Hyper-V兼容)</div>
              <div className="text-xs text-muted-foreground">
                Windows VM优化
              </div>
            </div>
            <button
              onClick={handleToggleViridian}
              disabled={busy}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                viridianEnabled
                  ? 'bg-success-soft text-success hover:bg-success-soft'
                  : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
              }`}
            >
              {viridianEnabled ? '已启用' : '已禁用'}
            </button>
          </div>
        </div>
      </div>

      {/* 标签 */}
      <div className="rounded-lg border bg-card">
        <div className="p-4 border-b">
          <div className="flex items-center gap-2">
            <Tag className="h-5 w-5 text-primary" />
            <h3 className="text-sm font-semibold">标签</h3>
          </div>
        </div>
        <div className="p-4">
          {config.otherConfig?.tags ? (
            <div className="flex flex-wrap gap-2">
              {config.otherConfig.tags.split(',').map((tag, i) => (
                <span
                  key={i}
                  className="px-2 py-1 text-xs rounded-md bg-primary/10 text-primary"
                >
                  {tag.trim()}
                </span>
              ))}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">无标签</div>
          )}
        </div>
      </div>

      {/* 状态提示 */}
      {powerState !== 'Halted' && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-warning-soft border border-warning/20">
          <AlertCircle className="h-4 w-4 text-warning mt-0.5 flex-shrink-0" />
          <div className="text-xs text-warning">
            注意: 更改启动顺序和最大VCPU数需要VM处于关闭状态
          </div>
        </div>
      )}

      {/* Affinity对话框 */}
      <VmAffinityDialog
        open={affinityDialogOpen}
        onOpenChange={setAffinityDialogOpen}
        vmRef={vmRef}
        connectionId={connectionId}
      />

      {/* 启动顺序对话框 */}
      <VmBootOrderDialog
        open={bootOrderDialogOpen}
        onOpenChange={setBootOrderDialogOpen}
        connectionId={connectionId}
        vmRef={vmRef}
        currentOrder={config.bootOrder}
      />
    </div>
  )
}
