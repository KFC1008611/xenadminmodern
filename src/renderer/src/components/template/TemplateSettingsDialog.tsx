/**
 * TemplateSettingsDialog — Dialog for editing template properties
 * Includes basic info, CPU/memory configuration, and read-only storage/network info
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, Settings, Loader2, HardDrive, Network } from 'lucide-react'
import { useToast } from '../toast/useToast'
import { feedback } from '../../store/feedback.store'
import { useConnectionManagerStore } from '../../store/connectionManager.store'
import { getConnectionReadIdentity } from '../../store/multiData.store'
import type { VdiRecord } from '../../types/xapi'

const GIB = 1073741824 // bytes per GiB

interface TemplateSettingsDialogProps {
  open: boolean
  onClose: () => void
  template: {
    ref: string
    name_label: string
    name_description: string
    connectionId: string
    VCPUs_max: number
    VCPUs_at_startup: number
    memory_static_max: number
    memory_dynamic_max: number
    memory_dynamic_min?: number
    memory_static_min?: number
    VBDs: string[]
    VIFs: string[]
  } | null
  onSuccess: (connectionId: string) => void | Promise<void>
}

interface DiskInfo {
  vdi: VdiRecord
  srName: string
}

export function TemplateSettingsDialog(props: TemplateSettingsDialogProps) {
  const connection = useConnectionManagerStore((state) => state.connections.find((item) => item.id === props.template?.connectionId))
  return <ScopedTemplateSettingsDialog key={JSON.stringify([props.template?.connectionId, props.template?.ref,
    connection?.poolUuid, connection?.epoch, connection?.connectedAt, connection?.state])} {...props} />
}

function ScopedTemplateSettingsDialog({
  open,
  onClose,
  template,
  onSuccess,
}: TemplateSettingsDialogProps) {
  const toast = useToast()
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveBlocked, setSaveBlocked] = useState(false)
  const submitting = useRef(false)
  const mounted = useRef(true)
  const diskGeneration = useRef(0)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; diskGeneration.current++ }
  }, [])
  
  // Form states
  const [nameLabel, setNameLabel] = useState('')
  const [nameDescription, setNameDescription] = useState('')
  const [vcpusMax, setVcpusMax] = useState(1)
  const [vcpusAtStartup, setVcpusAtStartup] = useState(1)
  const [memoryStaticMax, setMemoryStaticMax] = useState(1)
  const [memoryDynamicMax, setMemoryDynamicMax] = useState(1)
  const [memoryDynamicMin, setMemoryDynamicMin] = useState(1)
  const [memoryStaticMin, setMemoryStaticMin] = useState(1)
  
  // Read-only data
  const [diskInfos, setDiskInfos] = useState<DiskInfo[]>([])
  const [isLoadingDisks, setIsLoadingDisks] = useState(false)
  const [vifCount, setVifCount] = useState(0)
  
  // Validation errors
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Reset form when dialog opens
  useEffect(() => {
    if (open && template) {
      setNameLabel(template.name_label)
      setNameDescription(template.name_description)
      setVcpusMax(template.VCPUs_max)
      setVcpusAtStartup(template.VCPUs_at_startup)
      setMemoryStaticMax(template.memory_static_max / GIB)
      setMemoryDynamicMax(template.memory_dynamic_max / GIB)
      setMemoryDynamicMin((template.memory_dynamic_min ?? template.memory_dynamic_max) / GIB)
      setMemoryStaticMin((template.memory_static_min ?? template.memory_static_max) / GIB)
      setVifCount(template.VIFs?.length || 0)
      setErrors({})
      setSaveError(null)
      setSaveBlocked(false)
      
      // Load disk information
      loadDiskInfo(template)
    }
    return () => { diskGeneration.current++ }
  }, [open, template])

  // Load disk information from SRs/VDIs
  const loadDiskInfo = useCallback(async (tpl: NonNullable<typeof template>) => {
    const generation = ++diskGeneration.current
    if (!tpl.VBDs || tpl.VBDs.length === 0) {
      setDiskInfos([])
      return
    }
    
    setIsLoadingDisks(true)
    try {
      const srs = await window.xapi.storage.listSrs(tpl.connectionId)
      const disks: DiskInfo[] = []
      
      for (const sr of srs) {
        const vdis = await window.xapi.storage.listVdis(tpl.connectionId, sr.ref)
        for (const vdi of vdis) {
          // Check if this VDI is associated with any of the template's VBDs
          if (vdi.VBDs && vdi.VBDs.some(vbdRef => tpl.VBDs.includes(vbdRef))) {
            disks.push({
              vdi,
              srName: sr.name_label,
            })
          }
        }
      }
      
      if (mounted.current && generation === diskGeneration.current) setDiskInfos(disks)
    } catch (err: any) {
      if (mounted.current && generation === diskGeneration.current) toast.error(`加载磁盘信息失败: ${err?.message || String(err)}`)
    } finally {
      if (mounted.current && generation === diskGeneration.current) setIsLoadingDisks(false)
    }
  }, [toast])

  // Validate memory constraints: static_min ≤ dynamic_min ≤ dynamic_max ≤ static_max
  const validateMemory = useCallback(() => {
    const newErrors: Record<string, string> = {}
    
    if (memoryStaticMin > memoryDynamicMin) {
      newErrors.memoryStaticMin = '静态最小内存不能大于动态最小内存'
    }
    if (memoryDynamicMin > memoryDynamicMax) {
      newErrors.memoryDynamicMin = '动态最小内存不能大于动态最大内存'
    }
    if (memoryDynamicMax > memoryStaticMax) {
      newErrors.memoryDynamicMax = '动态最大内存不能大于静态最大内存'
    }
    if (memoryStaticMin > memoryStaticMax) {
      newErrors.memoryStaticMin = '静态最小内存不能大于静态最大内存'
    }
    
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }, [memoryStaticMin, memoryDynamicMin, memoryDynamicMax, memoryStaticMax])

  // Validate on memory changes
  useEffect(() => {
    if (open) {
      validateMemory()
    }
  }, [memoryStaticMin, memoryDynamicMin, memoryDynamicMax, memoryStaticMax, open, validateMemory])

  // Handle vCPUs max change - ensure startup doesn't exceed max
  const handleVcpusMaxChange = (value: number) => {
    const newMax = Math.max(1, Math.min(32, value))
    setVcpusMax(newMax)
    if (vcpusAtStartup > newMax) {
      setVcpusAtStartup(newMax)
    }
  }

  // Handle vCPUs startup change
  const handleVcpusStartupChange = (value: number) => {
    const newStartup = Math.max(1, Math.min(vcpusMax, value))
    setVcpusAtStartup(newStartup)
  }

  // Format bytes to GiB string
  const formatGiB = (bytes: number) => {
    return (bytes / GIB).toFixed(2)
  }

  // Check if any values have changed from original
  const hasChanges = useCallback(() => {
    if (!template) return false
    
    return (
      nameLabel !== template.name_label ||
      nameDescription !== template.name_description ||
      vcpusMax !== template.VCPUs_max ||
      vcpusAtStartup !== template.VCPUs_at_startup ||
      Math.abs(memoryStaticMax - template.memory_static_max / GIB) > 0.001 ||
      Math.abs(memoryDynamicMax - template.memory_dynamic_max / GIB) > 0.001 ||
      Math.abs(memoryDynamicMin - (template.memory_dynamic_min ?? template.memory_dynamic_max) / GIB) > 0.001 ||
      Math.abs(memoryStaticMin - (template.memory_static_min ?? template.memory_static_max) / GIB) > 0.001
    )
  }, [template, nameLabel, nameDescription, vcpusMax, vcpusAtStartup, memoryStaticMax, memoryDynamicMax, memoryDynamicMin, memoryStaticMin])

  // Handle save
  const handleSave = async () => {
    if (!template || submitting.current || saveBlocked || !hasChanges()) return
    
    if (!validateMemory()) {
      toast.error('请修正内存配置错误')
      return
    }
    
    const identity = getConnectionReadIdentity(template.connectionId)
    if (!identity) { setSaveError('资源池连接已断开，请重新连接后再保存。'); return }
    const isCurrent = () => mounted.current && identity === getConnectionReadIdentity(template.connectionId)
    submitting.current = true
    setIsSaving(true)
    setSaveError(null)
    
    try {
      // Build payload with only changed fields
      const payload: {
        templateRef: string
        nameLabel?: string
        nameDescription?: string
        vcpusMax?: number
        vcpusAtStartup?: number
        memoryStaticMax?: number
        memoryDynamicMax?: number
        memoryDynamicMin?: number
        memoryStaticMin?: number
      } = {
        templateRef: template.ref,
      }
      
      if (nameLabel !== template.name_label) {
        payload.nameLabel = nameLabel
      }
      if (nameDescription !== template.name_description) {
        payload.nameDescription = nameDescription
      }
      if (vcpusMax !== template.VCPUs_max) {
        payload.vcpusMax = vcpusMax
      }
      if (vcpusAtStartup !== template.VCPUs_at_startup) {
        payload.vcpusAtStartup = vcpusAtStartup
      }
      if (Math.abs(memoryStaticMax - template.memory_static_max / GIB) > 0.001) {
        payload.memoryStaticMax = Math.round(memoryStaticMax * GIB)
      }
      if (Math.abs(memoryDynamicMax - template.memory_dynamic_max / GIB) > 0.001) {
        payload.memoryDynamicMax = Math.round(memoryDynamicMax * GIB)
      }
      if (Math.abs(memoryDynamicMin - (template.memory_dynamic_min ?? template.memory_dynamic_max) / GIB) > 0.001) {
        payload.memoryDynamicMin = Math.round(memoryDynamicMin * GIB)
      }
      if (Math.abs(memoryStaticMin - (template.memory_static_min ?? template.memory_static_max) / GIB) > 0.001) {
        payload.memoryStaticMin = Math.round(memoryStaticMin * GIB)
      }
      
      await window.xapi.template.updateSettings(template.connectionId, payload)
      if (!isCurrent()) return
      toast.success('模板设置已保存')
      try { await onSuccess(template.connectionId) }
      catch (error: any) {
        if (isCurrent()) feedback.warning(`模板设置已保存，但模板列表刷新失败：${error?.message || String(error)}`)
      }
      if (isCurrent()) onClose()
    } catch (err: any) {
      if (!isCurrent()) return
      setSaveError(err?.message || String(err))
      setSaveBlocked(['RESOURCE_RESULT_READ_FAILED', 'TEMPLATE_SETTINGS_PARTIAL'].includes(err?.code))
    } finally {
      submitting.current = false
      if (isCurrent()) setIsSaving(false)
    }
  }

  const handleClose = () => {
    if (isSaving) return
    onClose()
  }

  if (!template) return null

  return (
    <Dialog.Root open={open} onOpenChange={(open) => !open && handleClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" />
        <Dialog.Content aria-describedby={undefined} onEscapeKeyDown={(event) => { if (isSaving) event.preventDefault() }} onPointerDownOutside={(event) => { if (isSaving) event.preventDefault() }} className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col w-[calc(100%-2rem)] max-w-2xl bg-card border border-input rounded-xl shadow-2xl z-50 max-h-[calc(100dvh-4rem)] overflow-hidden">
          {/* Header */}
          <div className="flex shrink-0 items-center justify-between px-6 py-4 border-b border-border">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-accent rounded-lg">
                <Settings className="w-5 h-5 text-accent-foreground" />
              </div>
              <div>
                <Dialog.Title className="text-lg font-semibold text-foreground">
                  模板设置
                </Dialog.Title>
                <div className="text-sm text-muted-foreground mt-0.5">
                  {template.name_label}
                </div>
              </div>
            </div>
            <Dialog.Close asChild>
              <button
                aria-label="关闭模板设置"
                className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors disabled:opacity-50"
                disabled={isSaving}
              >
                <X className="w-5 h-5" />
              </button>
            </Dialog.Close>
          </div>

          {/* Content */}
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          <fieldset disabled={isSaving || saveBlocked} className="min-w-0 px-6 py-5 space-y-6">
            {/* Basic Info Section */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-foreground border-b border-input pb-2">
                基本信息
              </h3>
              <div className="space-y-3">
                <div>
                  <label htmlFor="nameLabel" className="block text-sm font-medium text-secondary-foreground mb-1.5">
                    名称
                  </label>
                  <input
                    id="nameLabel"
                    type="text"
                    value={nameLabel}
                    onChange={(e) => setNameLabel(e.target.value)}
                    className="w-full px-3 py-2 bg-muted border border-input rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="模板名称"
                  />
                </div>
                <div>
                  <label htmlFor="nameDescription" className="block text-sm font-medium text-secondary-foreground mb-1.5">
                    描述
                  </label>
                  <textarea
                    id="nameDescription"
                    value={nameDescription}
                    onChange={(e) => setNameDescription(e.target.value)}
                    rows={2}
                    className="w-full px-3 py-2 bg-muted border border-input rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                    placeholder="模板描述"
                  />
                </div>
              </div>
            </div>

            {/* CPU Configuration Section */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-foreground border-b border-input pb-2">
                CPU 配置
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="vcpusMax" className="block text-sm font-medium text-secondary-foreground mb-1.5">
                    vCPU 最大值
                  </label>
                  <input
                    id="vcpusMax"
                    type="number"
                    min={1}
                    max={32}
                    value={vcpusMax}
                    onChange={(e) => handleVcpusMaxChange(parseInt(e.target.value) || 1)}
                    className="w-full px-3 py-2 bg-muted border border-input rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                  <span className="text-xs text-subtle mt-1">范围: 1-32</span>
                </div>
                <div>
                  <label htmlFor="vcpusStartup" className="block text-sm font-medium text-secondary-foreground mb-1.5">
                    vCPU 启动值
                  </label>
                  <input
                    id="vcpusStartup"
                    type="number"
                    min={1}
                    max={vcpusMax}
                    value={vcpusAtStartup}
                    onChange={(e) => handleVcpusStartupChange(parseInt(e.target.value) || 1)}
                    className="w-full px-3 py-2 bg-muted border border-input rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                  <span className="text-xs text-subtle mt-1">不超过最大值 ({vcpusMax})</span>
                </div>
              </div>
            </div>

            {/* Memory Configuration Section */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-foreground border-b border-input pb-2">
                内存配置 (GiB)
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="memoryStaticMax" className="block text-sm font-medium text-secondary-foreground mb-1.5">
                    静态最大内存
                  </label>
                  <input
                    id="memoryStaticMax"
                    type="number"
                    min={0.25}
                    step={0.25}
                    value={memoryStaticMax}
                    onChange={(e) => setMemoryStaticMax(parseFloat(e.target.value) || 0.25)}
                    className={`w-full px-3 py-2 bg-muted border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary ${
                      errors.memoryStaticMax ? 'border-danger/30' : 'border-input'
                    }`}
                  />
                  {errors.memoryStaticMax && (
                    <span className="text-xs text-danger mt-1">{errors.memoryStaticMax}</span>
                  )}
                </div>
                <div>
                  <label htmlFor="memoryDynamicMax" className="block text-sm font-medium text-secondary-foreground mb-1.5">
                    动态最大内存
                  </label>
                  <input
                    id="memoryDynamicMax"
                    type="number"
                    min={0.25}
                    step={0.25}
                    value={memoryDynamicMax}
                    onChange={(e) => setMemoryDynamicMax(parseFloat(e.target.value) || 0.25)}
                    className={`w-full px-3 py-2 bg-muted border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary ${
                      errors.memoryDynamicMax ? 'border-danger/30' : 'border-input'
                    }`}
                  />
                  {errors.memoryDynamicMax && (
                    <span className="text-xs text-danger mt-1">{errors.memoryDynamicMax}</span>
                  )}
                </div>
                <div>
                  <label htmlFor="memoryDynamicMin" className="block text-sm font-medium text-secondary-foreground mb-1.5">
                    动态最小内存
                  </label>
                  <input
                    id="memoryDynamicMin"
                    type="number"
                    min={0.25}
                    step={0.25}
                    value={memoryDynamicMin}
                    onChange={(e) => setMemoryDynamicMin(parseFloat(e.target.value) || 0.25)}
                    className={`w-full px-3 py-2 bg-muted border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary ${
                      errors.memoryDynamicMin ? 'border-danger/30' : 'border-input'
                    }`}
                  />
                  {errors.memoryDynamicMin && (
                    <span className="text-xs text-danger mt-1">{errors.memoryDynamicMin}</span>
                  )}
                </div>
                <div>
                  <label htmlFor="memoryStaticMin" className="block text-sm font-medium text-secondary-foreground mb-1.5">
                    静态最小内存
                  </label>
                  <input
                    id="memoryStaticMin"
                    type="number"
                    min={0.25}
                    step={0.25}
                    value={memoryStaticMin}
                    onChange={(e) => setMemoryStaticMin(parseFloat(e.target.value) || 0.25)}
                    className={`w-full px-3 py-2 bg-muted border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary ${
                      errors.memoryStaticMin ? 'border-danger/30' : 'border-input'
                    }`}
                  />
                  {errors.memoryStaticMin && (
                    <span className="text-xs text-danger mt-1">{errors.memoryStaticMin}</span>
                  )}
                </div>
              </div>
              <div className="text-xs text-subtle bg-muted rounded-lg p-3">
                约束: 静态最小 ≤ 动态最小 ≤ 动态最大 ≤ 静态最大
              </div>
            </div>

            {/* Storage Info Section (Read-only) */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-foreground border-b border-input pb-2 flex items-center gap-2">
                <HardDrive className="w-4 h-4" />
                存储信息
                <span className="text-xs font-normal text-subtle">（只读）</span>
              </h3>
              <div className="bg-muted rounded-lg p-4">
                {isLoadingDisks ? (
                  <div className="flex items-center justify-center py-4 text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    加载中...
                  </div>
                ) : diskInfos.length === 0 ? (
                  <div className="text-sm text-subtle py-2">无关联磁盘</div>
                ) : (
                  <div className="space-y-2">
                    {diskInfos.map((disk, index) => (
                      <div
                        key={disk.vdi.ref}
                        className="flex items-center justify-between py-2 px-3 bg-muted rounded-lg"
                      >
                        <div className="flex items-center gap-3">
                          <HardDrive className="w-4 h-4 text-muted-foreground" />
                          <span className="text-sm text-foreground">
                            {disk.vdi.name_label || `磁盘 ${index + 1}`}
                          </span>
                        </div>
                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          <span>{formatGiB(disk.vdi.virtual_size)} GiB</span>
                          <span className="text-subtle">{disk.srName}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Network Info Section (Read-only) */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-foreground border-b border-input pb-2 flex items-center gap-2">
                <Network className="w-4 h-4" />
                网络信息
                <span className="text-xs font-normal text-subtle">（只读）</span>
              </h3>
              <div className="bg-muted rounded-lg p-4">
                <div className="text-sm text-secondary-foreground">
                  {vifCount} 个虚拟网卡
                </div>
              </div>
            </div>
          </fieldset>
          </div>

          {/* Footer */}
          {saveError && <div role="alert" className="max-h-32 shrink-0 overflow-y-auto break-words border-t border-border px-6 py-3 text-sm text-danger">{saveError}{saveBlocked && <p className="mt-1">请关闭窗口，重新读取模板列表后再编辑。</p>}</div>}
          <div className="flex shrink-0 items-center justify-end gap-3 px-6 py-4 border-t border-border bg-card">
            <button
              onClick={handleClose}
              disabled={isSaving}
              className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            >
              取消
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving || saveBlocked || !hasChanges() || !nameLabel.trim() || Object.keys(errors).length > 0}
              className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-hover disabled:bg-secondary disabled:text-subtle disabled:cursor-not-allowed text-primary-foreground text-sm font-medium rounded-lg transition-colors"
            >
              {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
              保存
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
