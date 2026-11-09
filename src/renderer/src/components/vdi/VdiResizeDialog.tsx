import { srFreeBytes } from '../../../../shared/storage-capacity'
/**
 * VdiResizeDialog — Dialog for resizing a VDI (virtual disk) to a larger size
 * v6: Resize dialog with size input, unit conversion, SR space validation, and progress tracking
 */
import { useState, useEffect, useRef } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import {
  X,
  Maximize2,
  AlertCircle,
  CheckCircle,
  Info,
  Loader2,
  HardDrive,
} from 'lucide-react'
import type { VdiRecord, ConnectedSrRecord, ConnectedTaskRecord } from '../../types/xapi'
import { formatBytes } from '../../lib/utils'
import { getConnectionReadIdentity } from '../../store/multiData.store'
import { useConnectionManagerStore } from '../../store/connectionManager.store'

interface VdiWithVbd extends VdiRecord {
  vbdRef: string
  userdevice: string
  bootable: boolean
  mode: string
}

interface VdiResizeDialogProps {
  open: boolean
  onClose: () => void
  connectionId: string
  vmRef: string
  vdi: VdiWithVbd
  powerState: string
  onResized: () => void
}

type ResizeState = 'idle' | 'resizing' | 'completed' | 'error' | 'cancelled' | 'unknown'
interface ResizeOperation {
  connectionId: string
  identity: string | null
  vdiRef: string
  uuid: string
  srRef: string
  size: number
  initialSize: number
  taskRef: string | null
  taskSucceeded: boolean
  notified: boolean
  startedAt: number
  readFailures: number
}
type SizeUnit = 'GB' | 'MB'

const BYTES_PER_GB = 1073741824
const BYTES_PER_MB = 1048576

export function VdiResizeDialog({
  open,
  onClose,
  connectionId,
  vmRef,
  vdi,
  powerState,
  onResized,
}: VdiResizeDialogProps) {
  const [sizeInput, setSizeInput] = useState('')
  const [unit, setUnit] = useState<SizeUnit>('GB')
  const [resizeState, setResizeState] = useState<ResizeState>('idle')
  const [progress, setProgress] = useState(-1)
  const [actualSize, setActualSize] = useState<number | null>(null)
  const [taskRef, setTaskRef] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [srInfo, setSrInfo] = useState<ConnectedSrRecord | null>(null)
  const [resizeAllowed, setResizeAllowed] = useState<boolean | null>(null)
  const pollMisses = useRef(0)
  const operation = useRef<ResizeOperation | null>(null)
  const submitting = useRef(false)
  const [observing, setObserving] = useState(false)
  const connection = useConnectionManagerStore((state) => state.connections.find((item) => item.id === connectionId))
  const identity = JSON.stringify([connection?.state, connection?.connectedAt, connection?.epoch, connection?.poolUuid])
  const view = useRef(0)
  const callbacks = useRef({ onResized })
  callbacks.current = { onResized }


  const currentSizeBytes = operation.current?.initialSize ?? vdi.virtual_size
  const currentSizeDisplay = formatBytes(currentSizeBytes)

  // Convert input to bytes
  const newSizeBytes = (() => {
    const val = parseFloat(sizeInput)
    const bytes = Math.round(val * (unit === 'GB' ? BYTES_PER_GB : BYTES_PER_MB))
    return Number.isFinite(val) && val > 0 && Number.isSafeInteger(bytes) ? bytes : 0
  })()

  // Invalidate every read when the view or connection lifecycle changes.
  useEffect(() => {
    const version = ++view.current
    if (!open) return
    let current = true
    const readIdentity = getConnectionReadIdentity(connectionId)
    const isCurrent = () => current && view.current === version && getConnectionReadIdentity(connectionId) === readIdentity
    const previous = operation.current
    if (!previous || previous.connectionId !== connectionId || previous.vdiRef !== vdi.ref || previous.uuid !== vdi.uuid) {
      operation.current = null
      setSizeInput('')
      setUnit('GB')
      setResizeState('idle')
      setProgress(-1)
      setActualSize(null)
      setTaskRef(null)
      setObserving(false)
      setError(null)
    } else if (!previous.notified) {
      if (previous.identity === readIdentity) {
        setResizeState('resizing')
        setObserving(!submitting.current)
      } else {
        setResizeState('unknown')
        setObserving(false)
        setError('管理连接已变化，无法获取原扩容操作的执行结果。')
      }
    }
    pollMisses.current = 0
    setSrInfo(null)
    setResizeAllowed(null)
    window.xapi.storage.listSrs(connectionId).then((srs) => {
      if (isCurrent()) setSrInfo(srs.find((sr) => sr.ref === vdi.SR) ?? null)
    }).catch(() => { if (isCurrent()) setSrInfo(null) })
    window.xapi.storage.getAllowedOperations(connectionId, vdi.ref, vmRef).then((ops) => {
      if (isCurrent()) setResizeAllowed(powerState === 'Running' ? ops.onlineResize : powerState === 'Halted' ? ops.resize : false)
    }).catch(() => { if (isCurrent()) setResizeAllowed(false) })
    return () => { current = false; view.current += 1 }
  }, [open, connectionId, vdi.ref, vdi.uuid, vdi.SR, vmRef, powerState, identity])

  // Serial polling: a slow read never overlaps the next read. Recovery uses the
  // frozen operation, never the editable input and never a second resize call.
  useEffect(() => {
    const op = operation.current
    if (!open || resizeState !== 'resizing' || !op || !observing) return
    let current = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const version = view.current
    const isCurrent = () => current && view.current === version && operation.current === op
    const check = async () => {
      try {
        if (getConnectionReadIdentity(op.connectionId) !== op.identity) throw new Error('管理连接已变化，无法获取原扩容操作的执行结果')
        if (Date.now() - op.startedAt >= 10 * 60 * 1000) throw new Error('等待扩容执行结果超时')
        if (op.taskRef && !op.taskSucceeded) {
          const tasks = await window.xapi.tasks.list(op.connectionId)
          if (!isCurrent()) return
          const task = tasks.find((item: ConnectedTaskRecord) => item.ref === op.taskRef)
          if (!task) {
            if (++pollMisses.current < 10) { timer = setTimeout(check, 1000); return }
            // Tasks may be collected; actual capacity can still prove success.
          } else {
            pollMisses.current = 0
            const value = Number(task.progress)
            setProgress(task.progress !== undefined && Number.isFinite(value) ? Math.max(0, Math.min(100, value * 100)) : -1)
            if (task.status === 'failure' || task.status === 'cancelled') {
              setResizeState(task.status === 'cancelled' ? 'cancelled' : 'error')
              setError(task.error_info?.join('；') || '服务器确认扩容未完成')
              return
            }
            if (task.status === 'pending' || task.status === 'cancelling') {
              op.readFailures = 0
              timer = setTimeout(check, 1000)
              return
            }
            if (task.status !== 'success') throw new Error(`服务器返回无效任务状态：${task.status}`)
            op.taskSucceeded = true
          }
        }
        const records = await window.xapi.storage.listVdis(op.connectionId, op.srRef)
        if (!isCurrent() || getConnectionReadIdentity(op.connectionId) !== op.identity) return
        const disk = records.find((item) => item.ref === op.vdiRef && item.uuid === op.uuid)
        if (!disk || !Number.isFinite(Number(disk.virtual_size)) || Number(disk.virtual_size) < op.size) {
          throw new Error(!disk ? '未找到原 UUID 的磁盘记录' : `磁盘实际容量 ${formatBytes(Number(disk.virtual_size))} 尚未达到目标 ${formatBytes(op.size)}`)
        }
        setResizeState('completed')
        setActualSize(Number(disk.virtual_size))
        setProgress(100)
        setError(null)
        if (!op.notified) {
          op.notified = true
          try { await callbacks.current.onResized() } catch {
            if (isCurrent()) setError('扩容已确认完成，列表刷新失败，请重新读取磁盘列表。')
          }
        }
      } catch (failure) {
        if (!isCurrent()) return
        if (++op.readFailures < 3 && Date.now() - op.startedAt < 10 * 60 * 1000
          && getConnectionReadIdentity(op.connectionId) === op.identity) {
          timer = setTimeout(check, 1000)
          return
        }
        setResizeState('unknown')
        setError(`${op.taskSucceeded ? '服务器任务已成功；' : ''}无法获取扩容结果：${failure instanceof Error ? failure.message : String(failure)}`)
      }
    }
    void check()
    return () => { current = false; if (timer) clearTimeout(timer) }
  }, [open, resizeState, taskRef, observing, identity, vdi.name_label])

  // Validation
  const sizeExceedsCurrent = newSizeBytes > currentSizeBytes
  const srFreeSpace = srInfo
    ? srFreeBytes(srInfo)
    : null
  const requiredAdditionalSpace = newSizeBytes - currentSizeBytes
  const spaceSufficient =
    srFreeSpace !== null && requiredAdditionalSpace <= srFreeSpace
  const isVmRunning = powerState === 'Running'
  const inputValid =
    sizeInput.trim() !== '' && newSizeBytes > 0 && sizeExceedsCurrent

  const handleStartResize = async () => {
    if (!inputValid || !resizeAllowed || !spaceSufficient || submitting.current || operation.current) return
    submitting.current = true
    const op: ResizeOperation = {
      connectionId, identity: getConnectionReadIdentity(connectionId), vdiRef: vdi.ref,
      uuid: vdi.uuid, srRef: vdi.SR, size: newSizeBytes, taskRef: null, taskSucceeded: false, notified: false,
      startedAt: Date.now(), readFailures: 0,
      initialSize: vdi.virtual_size,
    }
    operation.current = op
    const version = view.current
    const isCurrent = () => view.current === version && operation.current === op && getConnectionReadIdentity(connectionId) === op.identity
    setResizeState('resizing')
    setProgress(-1)
    setError(null)
    try {
      const ref = await window.xapi.storage.resizeVdi(connectionId, { vdiRef: op.vdiRef, newSize: op.size })
      op.taskRef = ref || null
      if (!isCurrent()) return
      setTaskRef(ref)
      setObserving(true)
    } catch (failure) {
      if (!isCurrent()) return
      const rejection = failure as { code?: string; details?: { kind?: string } } | null
      // XAPI/preflight rejections and local argument validation prove that no
      // resize was accepted. Keep their actionable error instead of polling.
      if (rejection?.details?.kind === 'xapi' || rejection?.code === 'IPC_SCHEMA_INVALID') {
        operation.current = null
        setResizeState('error')
        setError(failure instanceof Error ? failure.message : String(failure))
        return
      }
      // A lost acceptance reply can follow a successful resize. Read capacity
      // in this same operation rather than asking the user to submit again.
      setObserving(true)
    } finally {
      submitting.current = false
    }
  }

  const handleClose = () => {
    if (resizeState === 'resizing') return
    onClose()
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && handleClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex max-h-[calc(100dvh-4rem)] w-[calc(100%-2rem)] max-w-lg flex-col bg-card border border-input rounded-xl shadow-2xl z-50 overflow-hidden">
          {/* Header */}
          <div className="flex shrink-0 items-center justify-between px-6 py-4 border-b border-border">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-accent rounded-lg">
                <Maximize2 className="w-5 h-5 text-accent-foreground" />
              </div>
              <div>
                <Dialog.Title className="text-lg font-semibold text-foreground">
                  扩容虚拟磁盘
                </Dialog.Title>
                <div className="text-sm text-muted-foreground mt-0.5">
                  {vdi.name_label}
                </div>
              </div>
            </div>
            <Dialog.Close asChild>
              <button
                className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors disabled:opacity-50"
                disabled={resizeState === 'resizing'}
              >
                <X className="w-5 h-5" />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">输入新的磁盘大小并提交扩容操作。</Dialog.Description>

          {/* Content */}
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 space-y-5">
            {resizeAllowed === false && (
              <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-soft p-3 text-sm text-warning">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <span>XAPI 当前不允许扩容该磁盘</span>
              </div>
            )}
            {/* Current Size */}
            <div className="flex items-center gap-3 p-3 bg-muted border border-input rounded-lg">
              <HardDrive className="w-5 h-5 text-muted-foreground flex-shrink-0" />
              <div className="flex-1">
                <div className="text-xs text-muted-foreground">{resizeState === 'idle' ? '当前大小' : '扩容前大小'}</div>
                <div className="text-foreground font-medium">{currentSizeDisplay}</div>
              </div>
              {isVmRunning && (
                <div className="flex items-center gap-1.5 px-2.5 py-1 bg-accent rounded-md">
                  <div className="w-1.5 h-1.5 rounded-full bg-success-solid animate-pulse" />
                  <span className="text-xs text-accent-foreground">VM 运行中</span>
                </div>
              )}
            </div>

            {/* New Size Input */}
            {resizeState === 'idle' && (
              <div className="space-y-3">
                <label className="text-sm font-medium text-secondary-foreground">
                  新大小
                </label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    min="0"
                    step={unit === 'GB' ? '0.1' : '1'}
                    value={sizeInput}
                    onChange={(e) => setSizeInput(e.target.value)}
                    placeholder={`输入大小（${unit}）`}
                    className="flex-1 px-3 py-2 bg-muted border border-input rounded-lg text-foreground text-sm placeholder-subtle focus:outline-none focus:ring-1 focus:ring-primary"
                    aria-label="New size value"
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

                {/* Validation Messages */}
                {sizeInput.trim() !== '' && newSizeBytes > 0 && (
                  <div className="space-y-2">
                    {!sizeExceedsCurrent && (
                      <div className="flex items-start gap-2 p-2.5 bg-danger-soft border border-danger/20 rounded-lg">
                        <AlertCircle className="w-4 h-4 text-danger flex-shrink-0 mt-0.5" />
                        <span className="text-sm text-danger">
                          新大小 ({formatBytes(newSizeBytes)}) 必须大于当前大小 ({currentSizeDisplay})
                        </span>
                      </div>
                    )}
                    {sizeExceedsCurrent && !spaceSufficient && srFreeSpace !== null && (
                      <div className="flex items-start gap-2 p-2.5 bg-warning-soft border border-warning/20 rounded-lg">
                        <AlertCircle className="w-4 h-4 text-warning flex-shrink-0 mt-0.5" />
                        <span className="text-sm text-warning">
                          SR 剩余空间不足: 需要 {formatBytes(requiredAdditionalSpace)}，可用 {formatBytes(srFreeSpace)}
                        </span>
                      </div>
                    )}
                    {sizeExceedsCurrent && spaceSufficient && (
                      <div className="flex items-start gap-2 p-2.5 bg-success-soft border border-success/20 rounded-lg">
                        <CheckCircle className="w-4 h-4 text-success flex-shrink-0 mt-0.5" />
                        <span className="text-sm text-success">
                          将扩容 {formatBytes(requiredAdditionalSpace)}（从 {currentSizeDisplay} 到 {formatBytes(newSizeBytes)}）
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* SR Space Info */}
            {resizeState === 'idle' && srInfo && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">目标 SR</span>
                  <span className="text-foreground">{srInfo.name_label}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">剩余空间</span>
                  <span className={spaceSufficient ? 'text-success' : 'text-warning'}>
                    {srFreeSpace !== null ? formatBytes(srFreeSpace) : '--'}
                  </span>
                </div>
                {/* Space usage bar */}
                {srFreeSpace === null && <p role="alert" className="text-sm text-warning">目标存储容量未知，暂时无法确认扩容空间。</p>}
                {srInfo && srFreeSpace !== null && (
                  <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        srFreeSpace / srInfo.physical_size < 0.1
                          ? 'bg-warning-solid'
                          : 'bg-primary'
                      }`}
                      style={{
                        width: `${((srInfo.physical_utilisation) / srInfo.physical_size) * 100}%`,
                      }}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Online Resize Notice */}
            {resizeState === 'idle' && isVmRunning && inputValid && (
              <div className="flex items-start gap-2 p-3 bg-accent border border-primary/20 rounded-lg">
                <Info className="w-4 h-4 text-accent-foreground flex-shrink-0 mt-0.5" />
                <div className="text-sm text-accent-foreground">
                  VM 正在运行中，将在在线状态下扩容。扩容完成后，请在 VM 内手动扩展文件系统以使用新增空间。
                </div>
              </div>
            )}

            {/* Resizing State */}
            {resizeState === 'resizing' && (
              <div className="space-y-4 py-4">
                <div className="flex items-center justify-center">
                  <div className="relative">
                    <Loader2 className="w-12 h-12 text-accent-foreground animate-spin" />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-xs font-medium text-foreground">
                        {progress >= 0 && `${Math.floor(progress)}%`}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-foreground font-medium">正在扩容...</div>
                  <div className="text-sm text-muted-foreground mt-1">
                    {currentSizeDisplay} → {formatBytes(newSizeBytes)}
                  </div>
                </div>
                <div role="progressbar" aria-label="磁盘扩容进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress >= 0 ? progress : undefined} className="w-full bg-muted rounded-full h-2 overflow-hidden">
                  <div
                    className={`bg-primary h-full rounded-full transition-all duration-300 ${progress < 0 ? 'progress-indeterminate' : ''}`}
                    style={{ width: progress < 0 ? undefined : `${progress}%` }}
                  />
                </div>
              </div>
            )}

            {/* Completed State */}
            {resizeState === 'completed' && (
              <div className="space-y-4 py-4 text-center">
                <div className="flex justify-center">
                  <div className="p-4 bg-success-soft rounded-full">
                    <CheckCircle className="w-12 h-12 text-success" />
                  </div>
                </div>
                <div>
                  <div className="text-foreground font-medium">扩容完成</div>
                  <div className="text-sm text-muted-foreground mt-1">
                    {vdi.name_label}: {currentSizeDisplay} → {formatBytes(actualSize ?? newSizeBytes)}
                  </div>
                </div>
                {error && <div role="alert" className="text-sm text-warning">{error}</div>}
                {isVmRunning && (
                  <div className="flex items-start gap-2 p-3 bg-warning-soft border border-warning/20 rounded-lg text-left">
                    <Info className="w-4 h-4 text-warning flex-shrink-0 mt-0.5" />
                    <span className="text-sm text-warning">
                      请在 VM 内扩展文件系统以识别新增的磁盘空间
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Error State */}
            {(resizeState === 'error' || resizeState === 'cancelled' || resizeState === 'unknown') && (
              <div className="space-y-4 py-4 text-center">
                <div className="flex justify-center">
                  <div className="p-4 bg-danger-soft rounded-full">
                    <AlertCircle className="w-12 h-12 text-danger" />
                  </div>
                </div>
                <div>
                  <div className="text-foreground font-medium">{resizeState === 'unknown' ? '无法获取扩容结果' : resizeState === 'cancelled' ? '扩容已取消' : '扩容失败'}</div>
                  <div role="alert" className="text-sm text-warning mt-1">{error}</div>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex shrink-0 items-center justify-end gap-3 px-6 py-4 border-t border-border bg-card">
            {resizeState === 'idle' && (
              <>
                <button
                  onClick={handleClose}
                  className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleStartResize}
                  disabled={!resizeAllowed || !inputValid || !spaceSufficient}
                  className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-hover disabled:bg-secondary disabled:text-subtle disabled:cursor-not-allowed text-primary-foreground text-sm font-medium rounded-lg transition-colors"
                >
                  <Maximize2 className="w-4 h-4" />
                  确认扩容
                </button>
              </>
            )}
            {resizeState !== 'idle' && resizeState !== 'resizing' && (
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
