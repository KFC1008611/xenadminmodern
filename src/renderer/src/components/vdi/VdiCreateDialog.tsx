import { srFreeBytes } from '../../../../shared/storage-capacity'
/**
 * VdiCreateDialog — Dialog for creating a new VDI and attaching it to a VM
 * v6: Create dialog with name, description, size, SR selection, and type options
 */
import { useState, useEffect, useRef } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import {
  X,
  Plus,
  AlertCircle,
  CheckCircle,
  Loader2,
} from 'lucide-react'
import { useToast } from '../toast/useToast'
import type { ConnectedSrRecord } from '../../types/xapi'
import { formatBytes } from '../../lib/utils'
import { getConnectionReadIdentity } from '../../store/multiData.store'
import { useConnectionManagerStore } from '../../store/connectionManager.store'

interface VdiCreateDialogProps {
  open: boolean
  onClose: () => void
  connectionId: string
  vmRef: string
  onCreated: () => void | Promise<void>
}

type CreateState = 'idle' | 'creating' | 'completed' | 'error' | 'partial' | 'read-failed'
type SizeUnit = 'GB' | 'MB'
type VdiType = 'user' | 'system'

const BYTES_PER_GB = 1073741824
const BYTES_PER_MB = 1048576

export function VdiCreateDialog(props: VdiCreateDialogProps) {
  return props.open ? <ScopedVdiCreateDialog key={`${props.connectionId}:${props.vmRef}`} {...props} /> : null
}

function ScopedVdiCreateDialog({
  open,
  onClose,
  connectionId,
  vmRef,
  onCreated,
}: VdiCreateDialogProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [sizeInput, setSizeInput] = useState('10')
  const [unit, setUnit] = useState<SizeUnit>('GB')
  const [vdiType, setVdiType] = useState<VdiType>('user')
  const [selectedSrRef, setSelectedSrRef] = useState('')
  const [sharable, setSharable] = useState(false)
  const [readOnly, setReadOnly] = useState(false)
  const [srs, setSrs] = useState<ConnectedSrRecord[]>([])
  const [createState, setCreateState] = useState<CreateState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [plugWarning, setPlugWarning] = useState<string | null>(null)
  const [srLoading, setSrLoading] = useState(false)
  const [srError, setSrError] = useState<string | null>(null)
  const [srReload, setSrReload] = useState(0)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const generation = useRef(0)
  const submitted = useRef(false)
  const settled = useRef(false)
  const resourcesIdentity = useRef<string | null>(null)
  const connection = useConnectionManagerStore((state) => state.connections.find((item) => item.id === connectionId))
  const identity = JSON.stringify([connection?.state, connection?.connectedAt, connection?.epoch, connection?.poolUuid])

  const toast = useToast()

  // Convert input to bytes
  const sizeBytes = (() => {
    const val = parseFloat(sizeInput)
    if (!Number.isFinite(val) || val <= 0) return 0
    return Math.round(val * (unit === 'GB' ? BYTES_PER_GB : BYTES_PER_MB))
  })()

  // ISO libraries and physical device repositories cannot allocate VM disks.
  useEffect(() => {
    const version = ++generation.current
    let current = true
    const readIdentity = getConnectionReadIdentity(connectionId)
    const isCurrent = () => current && generation.current === version && getConnectionReadIdentity(connectionId) === readIdentity
    if (submitted.current) {
      if (!settled.current) {
        setCreateState('read-failed')
        setError('管理连接已变化，无法读取原创建请求的结果。请关闭窗口，重新读取原虚拟机磁盘和存储清单后核对。')
      }
      return () => { current = false; generation.current++ }
    }
    setSrs([])
    resourcesIdentity.current = null
    setSelectedSrRef('')
    setSrLoading(true)
    setSrError(null)
    if (!readIdentity) {
      setSrLoading(false)
      setSrError('管理连接未连接，请恢复连接后重新读取存储仓库。')
      return () => { current = false; generation.current++ }
    }
    window.xapi.storage.listSrs(connectionId).then((srList) => {
      if (!isCurrent()) return
      const writable = srList.filter((sr) => !['iso', 'udev'].includes(sr.type) && sr.content_type !== 'iso')
      resourcesIdentity.current = readIdentity
      setSrs(writable)
      setSelectedSrRef(writable[0]?.ref ?? '')
    }).catch((error: any) => {
      if (isCurrent()) setSrError(error?.message || String(error))
    }).finally(() => { if (isCurrent()) setSrLoading(false) })
    return () => { current = false; generation.current++; resourcesIdentity.current = null }
  }, [connectionId, identity, srReload])

  const selectedSr = srs.find((sr) => sr.ref === selectedSrRef)
  const srFreeSpace = selectedSr
    ? srFreeBytes(selectedSr)
    : null
  const spaceSufficient = srFreeSpace !== null && sizeBytes <= srFreeSpace
  const nameValid = name.trim() !== ''
  const sizeValid = Number.isSafeInteger(sizeBytes) && sizeBytes > 0
  const formValid =
    nameValid && sizeValid && !!selectedSr && spaceSufficient && !srLoading && !srError
      && !!resourcesIdentity.current && resourcesIdentity.current === getConnectionReadIdentity(connectionId)

  const handleCreate = async () => {
    if (!formValid || createState !== 'idle' || submitted.current || resourcesIdentity.current !== getConnectionReadIdentity(connectionId)) return
    const version = generation.current
    const submissionIdentity = getConnectionReadIdentity(connectionId)
    const isCurrent = () => generation.current === version && getConnectionReadIdentity(connectionId) === submissionIdentity
    submitted.current = true

    setCreateState('creating')
    setError(null)

    const refreshCreated = async () => {
      try { await onCreated() } catch (refreshFailure: any) {
        if (isCurrent()) setRefreshError(`磁盘已创建，但列表刷新失败：${refreshFailure?.message || String(refreshFailure)}。请重新读取磁盘列表。`)
      }
    }
    try {
      const result = await window.xapi.storage.createForVm(connectionId, {
        nameLabel: name.trim(),
        nameDescription: description.trim(),
        srRef: selectedSrRef,
        size: sizeBytes,
        type: vdiType,
        sharable,
        readOnly,
      }, vmRef)

      if (!isCurrent()) return
      settled.current = true
      setCreateState('completed')
      setPlugWarning(result.warning ?? null)
      if (!result.warning) {
        toast.success(`虚拟磁盘 "${name}" 创建成功`)
      }
      await refreshCreated()
    } catch (e: any) {
      if (!isCurrent()) return
      settled.current = true
      const diskCreated = e?.code === 'VDI_CREATED_ATTACH_INCOMPLETE'
      setCreateState(diskCreated ? e?.details?.outcome === 'unknown' ? 'read-failed' : 'partial' : 'error')
      setError(e?.message || '创建失败')
      if (diskCreated) {
        toast.info(e?.message || String(e))
        await refreshCreated()
      } else toast.error(`创建失败: ${e?.message || String(e)}`)
    }
  }

  const handleClose = () => {
    if (createState === 'creating' || submitted.current && !settled.current && resourcesIdentity.current
      && resourcesIdentity.current === getConnectionReadIdentity(connectionId)) return
    onClose()
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && handleClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" />
        <Dialog.Content aria-describedby={undefined} className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex max-h-[calc(100dvh-4rem)] w-[calc(100%-2rem)] max-w-lg flex-col bg-card border border-input rounded-xl shadow-2xl z-50 overflow-hidden">
          {/* Header */}
          <div className="flex shrink-0 items-center justify-between px-6 py-4 border-b border-border">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-success-soft rounded-lg">
                <Plus className="w-5 h-5 text-success" />
              </div>
              <Dialog.Title className="text-lg font-semibold text-foreground">
                新建虚拟磁盘
              </Dialog.Title>
            </div>
            <Dialog.Close asChild>
              <button
                className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors disabled:opacity-50"
                disabled={createState === 'creating'}
              >
                <X className="w-5 h-5" />
              </button>
            </Dialog.Close>
          </div>

          {/* Content */}
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 space-y-4">
            {createState === 'idle' && (
              <>
                {/* Name */}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-secondary-foreground">
                    名称 <span className="text-danger">*</span>
                  </label>
                  <input
                    aria-label="名称"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="磁盘名称"
                    className="w-full px-3 py-2 bg-muted border border-input rounded-lg text-foreground text-sm placeholder-subtle focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>

                {/* Description */}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-secondary-foreground">
                    描述
                  </label>
                  <input
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="可选描述"
                    className="w-full px-3 py-2 bg-muted border border-input rounded-lg text-foreground text-sm placeholder-subtle focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>

                {/* Size and Unit */}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-secondary-foreground">
                    大小 <span className="text-danger">*</span>
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      min="0"
                      step={unit === 'GB' ? '0.1' : '1'}
                      value={sizeInput}
                      onChange={(e) => setSizeInput(e.target.value)}
                      className="flex-1 px-3 py-2 bg-muted border border-input rounded-lg text-foreground text-sm placeholder-subtle focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    <div className="flex rounded-lg overflow-hidden border border-input">
                      <button
                        onClick={() => setUnit('GB')}
                        className={`px-3 py-2 text-sm font-medium transition-colors ${
                          unit === 'GB'
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        GB
                      </button>
                      <button
                        onClick={() => setUnit('MB')}
                        className={`px-3 py-2 text-sm font-medium transition-colors border-l border-input ${
                          unit === 'MB'
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        MB
                      </button>
                    </div>
                  </div>
                </div>

                {/* SR Selection */}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-secondary-foreground">
                    目标 SR <span className="text-danger">*</span>
                  </label>
                  <select
                    aria-label="目标 SR"
                    disabled={srLoading || !!srError}
                    value={selectedSrRef}
                    onChange={(e) => setSelectedSrRef(e.target.value)}
                    className="w-full px-3 py-2 bg-muted border border-input rounded-lg text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value="">{srLoading ? '正在读取存储仓库…' : '选择存储仓库…'}</option>
                    {srs.map((sr) => (
                      <option key={sr.ref} value={sr.ref}>
                        {sr.name_label} ({formatBytes(srFreeBytes(sr))} 可用)
                      </option>
                    ))}
                  </select>
                  {!srLoading && !srError && srs.length === 0 && <p role="status" className="text-sm text-warning">没有可新建磁盘的存储仓库。</p>}
                </div>

                {srError && <div role="alert" className="text-sm text-warning break-words">存储仓库读取失败：{srError}<button onClick={() => setSrReload((value) => value + 1)} className="ml-2 underline">重新读取存储仓库</button></div>}
                {selectedSr && srFreeSpace === null && <p role="alert" className="text-sm text-warning">目标存储容量未知，暂时无法确认可用空间。</p>}
                {/* SR Space Info */}
                {selectedSr && srFreeSpace !== null && (
                  <div className="p-3 bg-muted border border-input rounded-lg space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">SR 剩余空间</span>
                      <span
                        className={
                          spaceSufficient ? 'text-success' : 'text-warning'
                        }
                      >
                        {formatBytes(srFreeSpace)}
                      </span>
                    </div>
                    {sizeBytes > 0 && !spaceSufficient && (
                      <div className="flex items-start gap-2 text-sm">
                        <AlertCircle className="w-4 h-4 text-warning flex-shrink-0 mt-0.5" />
                        <span className="text-warning">
                          空间不足: 需要 {formatBytes(sizeBytes)}
                        </span>
                      </div>
                    )}
                    <div className="w-full bg-secondary rounded-full h-1.5 overflow-hidden">
                      <div
                        className="bg-primary h-full rounded-full"
                        style={{
                          width: `${(selectedSr.physical_utilisation / selectedSr.physical_size) * 100}%`,
                        }}
                      />
                    </div>
                  </div>
                )}

                {/* Type and Options */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-secondary-foreground">
                      类型
                    </label>
                    <select
                      value={vdiType}
                      onChange={(e) => setVdiType(e.target.value as VdiType)}
                      className="w-full px-3 py-2 bg-muted border border-input rounded-lg text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                    >
                      <option value="user">用户数据</option>
                      <option value="system">系统</option>
                    </select>
                  </div>
                  <div className="space-y-3 pt-5">
                    <label className="flex items-center gap-2 text-sm text-secondary-foreground cursor-pointer">
                      <input
                        type="checkbox"
                        checked={sharable}
                        onChange={(e) => setSharable(e.target.checked)}
                        className="rounded border-input bg-muted"
                      />
                      可共享
                    </label>
                    <label className="flex items-center gap-2 text-sm text-secondary-foreground cursor-pointer">
                      <input
                        type="checkbox"
                        checked={readOnly}
                        onChange={(e) => setReadOnly(e.target.checked)}
                        className="rounded border-input bg-muted"
                      />
                      只读
                    </label>
                  </div>
                </div>
              </>
            )}

            {/* Creating State */}
            {createState === 'creating' && (
              <div className="space-y-4 py-8 text-center">
                <Loader2 className="w-10 h-10 text-success animate-spin mx-auto" />
                <div className="text-foreground font-medium">正在创建虚拟磁盘...</div>
              </div>
            )}

            {/* Completed State */}
            {createState === 'completed' && (
              <div className="space-y-4 py-8 text-center">
                <div className="flex justify-center">
                  <div className="p-4 bg-success-soft rounded-full">
                    <CheckCircle className="w-12 h-12 text-success" />
                  </div>
                </div>
                <div>
                  <div className="text-foreground font-medium">创建成功</div>
                  <div className="text-sm text-muted-foreground mt-1">
                    {name} ({formatBytes(sizeBytes)})
                  </div>
                  {plugWarning && (
                    <div role="alert" className="text-sm text-warning mt-2 break-words">{plugWarning}</div>
                  )}
                </div>
              </div>
            )}

            {/* Error State */}
            {['error', 'partial', 'read-failed'].includes(createState) && (
              <div className="space-y-4 py-8 text-center">
                <div className="flex justify-center">
                  <div className="p-4 bg-danger-soft rounded-full">
                    <AlertCircle className="w-12 h-12 text-danger" />
                  </div>
                </div>
                <div>
                  <div className="text-foreground font-medium">{createState === 'partial' ? '磁盘已创建，附加未完成' : createState === 'read-failed' ? '读取创建结果失败' : '创建失败'}</div>
                  <div role="alert" className="text-sm text-danger mt-1 break-words">{error}</div>
                </div>
              </div>
            )}
            {refreshError && <p role="alert" className="text-sm text-warning break-words">{refreshError}</p>}
          </div>

          {/* Footer */}
          <div className="flex shrink-0 items-center justify-end gap-3 px-6 py-4 border-t border-border bg-card">
            {createState === 'idle' && (
              <>
                <button
                  onClick={handleClose}
                  className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleCreate}
                  disabled={!formValid}
                  className="flex items-center gap-2 px-4 py-2 bg-success-solid hover:bg-success-solid disabled:bg-secondary disabled:text-subtle disabled:cursor-not-allowed text-on-solid text-sm font-medium rounded-lg transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  创建
                </button>
              </>
            )}
            {createState !== 'idle' && createState !== 'creating' && (
              <button
                onClick={handleClose}
                className="px-4 py-2 bg-primary hover:bg-primary-hover text-primary-foreground text-sm font-medium rounded-lg transition-colors"
              >
                关闭
              </button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
