/**
 * ConsoleTab — VNC console using noVNC RFB for running VMs.
 * Displays an informational card when the VM is not running.
 */
import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react'
import type { ReactNode } from 'react'
import { Monitor, Maximize2, RefreshCw, AlertCircle, Loader2, WifiOff, Keyboard, Disc, ArrowUpFromLine } from 'lucide-react'
import type { IsoImageRecord, VmCdDriveRecord, VmDetailRecord } from '../../types/xapi'
import { cn, getVmStateBadge } from '../../lib/utils'
import { feedback } from '../../store/feedback.store'

// Dynamically import RFB to handle module compatibility
let RFBModule: any = null
const loadRFB = async () => {
  if (!RFBModule) {
    RFBModule = await import('@novnc/novnc/lib/rfb')
  }
  return RFBModule.default || RFBModule
}

interface Props {
  vm: VmDetailRecord
  connectionId: string
  onVmRecordChanged?: (vm: VmDetailRecord) => void
}

type ConnectionStatus = 'connecting' | 'connected' | 'checking' | 'disconnected' | 'error'

const MAX_AUTO_RECONNECT_ATTEMPTS = 5
const RECONNECT_BASE_DELAY_MS = 1_500
const RECONNECT_MAX_DELAY_MS = 15_000
const RUNNING_STABILITY_DELAY_MS = 1_500
const STABLE_CONNECTION_RESET_MS = 30_000
const VM_NOT_RUNNING_DISCONNECT_MESSAGE = 'VM 已停止运行，控制台已断开。'

export function ConsoleTab({ vm, connectionId, onVmRecordChanged }: Props) {
  if (vm.power_state !== 'Running') {
    return (
      <div className="space-y-4">
        <IsoMediaControl connectionId={connectionId} vmRef={vm.ref} />
        <VmNotRunningCard powerState={vm.power_state} />
      </div>
    )
  }

  return (
    <VncConsole
      vm={vm}
      connectionId={connectionId}
      onVmRecordChanged={onVmRecordChanged}
      mediaControl={<IsoMediaControl connectionId={connectionId} vmRef={vm.ref} compact />}
    />
  )
}

function IsoMediaControl({
  connectionId,
  vmRef,
  compact = false,
}: {
  connectionId: string
  vmRef: string
  compact?: boolean
}) {
  const [isos, setIsos] = useState<IsoImageRecord[]>([])
  const [cdDrive, setCdDrive] = useState<VmCdDriveRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<'mount' | 'eject' | null>(null)
  const [readError, setReadError] = useState<string | null>(null)
  const readGeneration = useRef(0)

  const loadMedia = useCallback(async () => {
    if (!connectionId || !vmRef) return

    const generation = ++readGeneration.current
    setLoading(true)
    setReadError(null)
    try {
      const [nextIsos, nextDrive] = await Promise.all([
        window.xapi.iso.listAll(connectionId),
        window.xapi.vm.getCdDrive(connectionId, vmRef),
      ])
      if (generation !== readGeneration.current) return
      setIsos(nextIsos)
      setCdDrive(nextDrive)
    } catch (e: any) {
      if (generation === readGeneration.current) setReadError(e?.message || String(e))
    } finally {
      if (generation === readGeneration.current) setLoading(false)
    }
  }, [connectionId, vmRef])

  useEffect(() => {
    setIsos([])
    setCdDrive(null)
    void loadMedia()
    return () => { readGeneration.current++ }
  }, [loadMedia])

  const performMount = async (isoVdiRef: string) => {
    setBusy('mount')
    try {
      await window.xapi.vm.mountIso(connectionId, vmRef, isoVdiRef)
      feedback.success('ISO 已挂载')
    } catch (e: any) {
      feedback.error(`挂载 ISO 失败：${e?.message || String(e)}`)
    } finally {
      await loadMedia()
      setBusy(null)
    }
  }

  const handleSelectIso = (isoVdiRef: string) => {
    if (!isoVdiRef || busy) return
    if (cdDrive?.vdiRef && cdDrive.vdiRef !== isoVdiRef) {
      const nextIso = isos.find((iso) => iso.ref === isoVdiRef)
      feedback.confirm({
        title: '替换已挂载 ISO',
        message: `当前已挂载 "${cdDrive.isoName || 'ISO'}"，是否替换为 "${nextIso?.name_label || '所选 ISO'}"？`,
        variant: 'warning',
        confirmLabel: '替换',
        onConfirm: () => performMount(isoVdiRef),
      })
      return
    }
    void performMount(isoVdiRef)
  }

  const handleEject = async () => {
    if (!cdDrive?.vdiRef || busy) return

    setBusy('eject')
    try {
      await window.xapi.vm.ejectIso(connectionId, vmRef)
      feedback.success('ISO 已弹出')
    } catch (e: any) {
      feedback.error(`弹出 ISO 失败：${e?.message || String(e)}`)
    } finally {
      await loadMedia()
      setBusy(null)
    }
  }

  const selectedValue = cdDrive?.vdiRef || ''
  const selectedIsoInList = selectedValue ? isos.some((iso) => iso.ref === selectedValue) : true
  const selectDisabled = loading || busy !== null || !!readError || isos.length === 0

  return (
    <div
      className={cn(
        compact
          ? 'flex min-w-[280px] flex-1 items-center gap-2'
          : 'flex flex-wrap items-center justify-between gap-3 px-1'
      )}
    >
      <div className={cn('flex items-center gap-2 min-w-0', compact && 'flex-1')}>
        <Disc className="w-4 h-4 text-subtle flex-shrink-0" />
        <span className="text-sm text-secondary-foreground flex-shrink-0">ISO 镜像</span>
        <select
          value={selectedValue}
          onChange={(e) => handleSelectIso(e.target.value)}
          disabled={selectDisabled}
          className={cn(
            'h-8 bg-card border border-border rounded-lg px-3 text-xs text-foreground outline-none transition-colors hover:border-input focus:border-primary/30 disabled:opacity-60 disabled:cursor-not-allowed',
            compact ? 'min-w-[180px] max-w-[360px] flex-1' : 'min-w-[240px] max-w-[420px]'
          )}
        >
          <option value="">
            {readError ? 'ISO 读取失败' : loading ? '加载 ISO...' : isos.length === 0 ? '没有可用 ISO' : '未挂载 ISO'}
          </option>
          {!selectedIsoInList && cdDrive?.vdiRef && (
            <option value={cdDrive.vdiRef}>{cdDrive.isoName || '当前 ISO'}</option>
          )}
          {isos.map((iso) => (
            <option key={iso.ref} value={iso.ref}>
              {iso.name_label || '(未命名 ISO)'}{iso.srName ? ` · ${iso.srName}` : ''}
            </option>
          ))}
        </select>
      </div>
      {readError && <div role="alert" className="text-xs text-warning break-words">ISO 介质读取失败：{readError}<button onClick={() => void loadMedia()} className="ml-2 underline">重新读取 ISO</button></div>}
      <button
        onClick={handleEject}
        disabled={!cdDrive?.vdiRef || busy !== null || loading || !!readError}
        className="flex h-8 items-center gap-1.5 rounded-lg border border-input bg-muted px-3 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        title="弹出 ISO"
      >
        {busy === 'eject' ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <ArrowUpFromLine className="w-3.5 h-3.5" />
        )}
        <span className={compact ? 'hidden xl:inline' : ''}>弹出</span>
      </button>
    </div>
  )
}

// ── Card shown when VM is not running ────────────────────────────────────────

function VmNotRunningCard({ powerState }: { powerState: string }) {
  const badgeClass = getVmStateBadge(powerState)

  const stateDescriptions: Record<string, string> = {
    Halted: '虚拟机已关机，请先启动 VM 后再访问控制台。',
    Suspended: '虚拟机已挂起，请恢复 VM 后再访问控制台。',
    Paused: '虚拟机已暂停，请继续运行 VM 后再访问控制台。',
  }

  return (
    <div className="flex items-center justify-center min-h-[360px]">
      <div className="flex flex-col items-center gap-5 text-center max-w-sm px-6 py-10 bg-card border border-border rounded-xl">
        <div className="w-16 h-16 flex items-center justify-center rounded-full bg-muted border border-input">
          <Monitor className="w-8 h-8 text-subtle" />
        </div>
        <div className="space-y-2">
          <p className="text-base font-medium text-foreground">VM 未运行，控制台不可用</p>
          <p className="text-sm text-muted-foreground">
            {stateDescriptions[powerState] ?? '虚拟机当前状态不支持控制台访问。'}
          </p>
        </div>
        <span
          className={`inline-flex items-center px-3 py-1 rounded-md text-xs font-medium border ${badgeClass}`}
        >
          当前状态：{powerState}
        </span>
      </div>
    </div>
  )
}

// ── Live VNC Console ──────────────────────────────────────────────────────────

function VncConsole({
  vm,
  connectionId,
  onVmRecordChanged,
  mediaControl,
}: {
  vm: VmDetailRecord
  connectionId: string
  onVmRecordChanged?: (vm: VmDetailRecord) => void
  mediaControl?: ReactNode
}) {
  const consoleFrameRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  // rfbRef holds the noVNC RFB instance; typed as any to avoid missing type declarations
  const rfbRef = useRef<any>(null)
  const sessionIdRef = useRef<string | null>(null)
  const connectAttemptRef = useRef(0)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stableConnectionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autoReconnectAttemptsRef = useRef(0)
  const latestPowerStateRef = useRef(vm.power_state)

  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [consoleHeight, setConsoleHeight] = useState(420)
  const [disconnectNonce, setDisconnectNonce] = useState(0)

  useEffect(() => {
    latestPowerStateRef.current = vm.power_state
  }, [vm.power_state])

  const updateConsoleHeight = useCallback(() => {
    const frame = consoleFrameRef.current
    if (!frame) return

    const bottomPadding = 24
    const minHeight = 300
    const maxHeight = 1200
    const { top } = frame.getBoundingClientRect()
    const availableHeight = window.innerHeight - top - bottomPadding
    const nextHeight = Math.max(minHeight, Math.min(maxHeight, Math.floor(availableHeight)))

    setConsoleHeight((currentHeight) => (currentHeight === nextHeight ? currentHeight : nextHeight))
  }, [])

  const refreshViewport = useCallback(() => {
    const rfb = rfbRef.current
    if (!rfb) return

    window.requestAnimationFrame(() => {
      try {
        rfb._updateClip?.()
        rfb._updateScale?.()
      } catch {
        // noVNC recalculates again on its own ResizeObserver callback.
      }
    })
  }, [])

  const closeSession = useCallback(async (sessionId: string | null) => {
    if (!sessionId) return
    try {
      await window.xapi.console.close(sessionId)
    } catch {
      // Ignore close failures during teardown
    }
  }, [])

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
  }, [])

  const clearStableConnectionTimer = useCallback(() => {
    if (stableConnectionTimerRef.current) {
      clearTimeout(stableConnectionTimerRef.current)
      stableConnectionTimerRef.current = null
    }
  }, [])

  const disconnect = useCallback(async () => {
    clearReconnectTimer()
    clearStableConnectionTimer()
    if (rfbRef.current) {
      try {
        rfbRef.current.disconnect()
      } catch {
        // ignore
      }
      rfbRef.current = null
    }
    const sessionId = sessionIdRef.current
    sessionIdRef.current = null
    await closeSession(sessionId)
  }, [clearReconnectTimer, clearStableConnectionTimer, closeSession])

  const connect = useCallback(
    async (attemptId: number) => {
      if (!canvasRef.current) {
        if (attemptId === connectAttemptRef.current) {
          setStatus('error')
          setErrorMsg('Canvas element not available')
        }
        return
      }

      if (attemptId === connectAttemptRef.current) {
        setStatus('connecting')
        setErrorMsg(null)
      }

      let leasedSessionId: string | null = null

      try {
        if (!connectionId) {
          throw new Error('connectionId is required')
        }

        const { wsUrl, sessionId } = await window.xapi.console.getUrl(connectionId, vm.ref)
        leasedSessionId = sessionId

        // Component already started another connect attempt; release this session.
        if (attemptId !== connectAttemptRef.current) {
          await closeSession(leasedSessionId)
          return
        }

        const RFB = await loadRFB()
        if (!RFB) {
          throw new Error('RFB module failed to load')
        }

        if (attemptId !== connectAttemptRef.current) {
          await closeSession(leasedSessionId)
          return
        }

        const canvas = canvasRef.current
        if (!canvas) {
          throw new Error('Canvas element not available')
        }

        canvas.innerHTML = ''

        const rfb = new RFB(canvas, wsUrl)
        rfb.scaleViewport = true
        rfb.resizeSession = false
        rfb.viewOnly = false

        rfb.addEventListener('connect', () => {
          if (attemptId !== connectAttemptRef.current) return
          clearStableConnectionTimer()
          stableConnectionTimerRef.current = setTimeout(() => {
            stableConnectionTimerRef.current = null
            if (
              attemptId === connectAttemptRef.current &&
              rfbRef.current === rfb &&
              latestPowerStateRef.current === 'Running'
            ) {
              autoReconnectAttemptsRef.current = 0
            }
          }, STABLE_CONNECTION_RESET_MS)
          setStatus('connected')
          refreshViewport()
        })

        rfb.addEventListener('disconnect', () => {
          if (attemptId !== connectAttemptRef.current) return
          clearStableConnectionTimer()
          rfbRef.current = null
          sessionIdRef.current = null
          setStatus('checking')
          setErrorMsg(null)
          setDisconnectNonce((current) => current + 1)
        })

        rfb.addEventListener('securityfailure', (evt: any) => {
          if (attemptId !== connectAttemptRef.current) return
          setStatus('error')
          setErrorMsg(`VNC 认证失败：${evt.detail?.reason || '未知原因'}`)
        })

        rfb.addEventListener('error', (evt: any) => {
          console.error('[ConsoleTab] VNC error:', evt)
        })

        rfbRef.current = rfb
        sessionIdRef.current = leasedSessionId
      } catch (e: any) {
        if (leasedSessionId && sessionIdRef.current !== leasedSessionId) {
          await closeSession(leasedSessionId)
        }
        if (attemptId !== connectAttemptRef.current) return

        setStatus('error')
        setErrorMsg(e?.message || String(e))
      }
    },
    [clearStableConnectionTimer, closeSession, connectionId, refreshViewport, vm.ref]
  )

  const startConnect = useCallback(async () => {
    const attemptId = ++connectAttemptRef.current
    await disconnect()
    await connect(attemptId)
  }, [connect, disconnect])

  useEffect(() => {
    void startConnect()
    return () => {
      connectAttemptRef.current += 1
      void disconnect()
    }
  }, [disconnect, startConnect])

  useEffect(() => {
    if (status !== 'checking' || disconnectNonce === 0) return

    let cancelled = false
    const observedAttemptId = connectAttemptRef.current

    const confirmAndReconnect = async () => {
      try {
        const record = await window.xapi.vm.getRecord(connectionId, vm.ref)
        if (cancelled || observedAttemptId !== connectAttemptRef.current) return

        onVmRecordChanged?.(record)

        if (record.power_state !== 'Running') {
          setStatus('disconnected')
          setErrorMsg(VM_NOT_RUNNING_DISCONNECT_MESSAGE)
          return
        }

        const nextReconnectAttempt = autoReconnectAttemptsRef.current + 1
        autoReconnectAttemptsRef.current = nextReconnectAttempt

        if (nextReconnectAttempt > MAX_AUTO_RECONNECT_ATTEMPTS) {
          setStatus('disconnected')
          setErrorMsg('VM 仍在运行，但控制台未能自动恢复，请手动重新连接。')
          return
        }

        const backoffMs = Math.min(
          RECONNECT_MAX_DELAY_MS,
          RECONNECT_BASE_DELAY_MS * 2 ** (nextReconnectAttempt - 1)
        )

        reconnectTimerRef.current = setTimeout(async () => {
          reconnectTimerRef.current = null
          if (cancelled || observedAttemptId !== connectAttemptRef.current) {
            return
          }

          if (latestPowerStateRef.current !== 'Running') {
            setStatus('disconnected')
            setErrorMsg(VM_NOT_RUNNING_DISCONNECT_MESSAGE)
            return
          }

          try {
            const latestRecord = await window.xapi.vm.getRecord(connectionId, vm.ref)
            if (cancelled || observedAttemptId !== connectAttemptRef.current) return

            onVmRecordChanged?.(latestRecord)
            if (latestRecord.power_state === 'Running') {
              void startConnect()
            } else {
              setStatus('disconnected')
              setErrorMsg(VM_NOT_RUNNING_DISCONNECT_MESSAGE)
            }
          } catch (e: any) {
            if (cancelled || observedAttemptId !== connectAttemptRef.current) return
            setStatus('disconnected')
            setErrorMsg(e?.message || '无法确认 VM 状态')
          }
        }, backoffMs + RUNNING_STABILITY_DELAY_MS)
      } catch (e: any) {
        if (cancelled || observedAttemptId !== connectAttemptRef.current) return
        setStatus('disconnected')
        setErrorMsg(e?.message || '无法确认 VM 状态')
      }
    }

    void confirmAndReconnect()

    return () => {
      cancelled = true
      clearReconnectTimer()
    }
  }, [
    clearReconnectTimer,
    connectionId,
    disconnectNonce,
    onVmRecordChanged,
    startConnect,
    status,
    vm.ref,
  ])

  useLayoutEffect(() => {
    updateConsoleHeight()
  }, [updateConsoleHeight, status])

  useEffect(() => {
    const canvas = canvasRef.current
    const frame = consoleFrameRef.current
    if (!canvas || !frame) return

    const resizeObserver = new ResizeObserver(() => {
      updateConsoleHeight()
      refreshViewport()
    })
    resizeObserver.observe(canvas)
    resizeObserver.observe(frame)

    const handleViewportChange = () => {
      updateConsoleHeight()
      refreshViewport()
    }

    window.addEventListener('resize', handleViewportChange)
    document.addEventListener('fullscreenchange', handleViewportChange)
    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', handleViewportChange)
      document.removeEventListener('fullscreenchange', handleViewportChange)
    }
  }, [refreshViewport, updateConsoleHeight])

  const handleFullscreen = () => {
    canvasRef.current?.requestFullscreen?.()
    updateConsoleHeight()
    refreshViewport()
  }

  const handleRetry = async () => {
    autoReconnectAttemptsRef.current = 0
    clearReconnectTimer()
    clearStableConnectionTimer()
    await startConnect()
  }

  const handleSendCtrlAltDel = () => {
    if (status !== 'connected' || !rfbRef.current) return
    try {
      rfbRef.current.sendCtrlAltDel?.()
    } catch (e: any) {
      setStatus('error')
      setErrorMsg(e?.message || '发送 Ctrl+Alt+Delete 失败')
    }
  }

  return (
    <div className="space-y-2">
      {/* Console header bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <div className="flex min-w-[88px] items-center gap-2.5">
          <StatusDot status={status} />
          <span className="text-sm text-secondary-foreground">{statusLabel(status)}</span>
        </div>
        {mediaControl && (
          <div className="flex min-w-0 flex-1 justify-center xl:justify-start">
            {mediaControl}
          </div>
        )}
        <div className="flex items-center gap-2">
          {(status === 'disconnected' || status === 'error') && (
            <button
              onClick={handleRetry}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground bg-muted hover:bg-secondary border border-input rounded-lg transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              重新连接
            </button>
          )}
          {status === 'connected' && (
            <>
              <button
                onClick={handleSendCtrlAltDel}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground bg-muted hover:bg-secondary border border-input rounded-lg transition-colors"
                title="发送 Ctrl+Alt+Delete"
              >
                <Keyboard className="w-3.5 h-3.5" />
                发送 Ctrl+Alt+Delete
              </button>
              <button
                onClick={handleFullscreen}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground bg-muted hover:bg-secondary border border-input rounded-lg transition-colors"
                title="全屏"
              >
                <Maximize2 className="w-3.5 h-3.5" />
                全屏
              </button>
            </>
          )}
        </div>
      </div>

      {/* VNC canvas container */}
      <div
        ref={consoleFrameRef}
        className="console-viewport relative w-full min-h-[300px] rounded-xl overflow-hidden bg-black border border-border"
        style={{ height: consoleHeight }}
      >
        {/* Canvas div that noVNC mounts into */}
        <div ref={canvasRef} className="vnc-console-target absolute inset-0 w-full h-full" />

        {/* Overlay states */}
        {(status === 'connecting' || status === 'checking') && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80">
            <Loader2 className="w-8 h-8 animate-spin text-accent-foreground" />
            <p className="text-sm text-muted-foreground">
              {status === 'checking' ? '正在确认 VM 状态…' : '正在连接 VNC 控制台…'}
            </p>
          </div>
        )}

        {status === 'disconnected' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/80">
            <WifiOff className="w-10 h-10 text-subtle" />
            <div className="text-center">
              <p className="text-sm font-medium text-foreground">连接已断开</p>
              <p className="text-xs text-subtle mt-1">
                {errorMsg || '点击"重新连接"恢复控制台'}
              </p>
            </div>
          </div>
        )}

        {status === 'error' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/80 px-8">
            <AlertCircle className="w-10 h-10 text-danger" />
            <div className="text-center">
              <p className="text-sm font-medium text-foreground">连接失败</p>
              {errorMsg && (
                <p className="text-xs text-muted-foreground mt-1 max-w-xs break-words">{errorMsg}</p>
              )}
            </div>
          </div>
        )}
      </div>

    </div>
  )
}

// Status dot indicator
function StatusDot({ status }: { status: ConnectionStatus }) {
  const colors: Record<ConnectionStatus, string> = {
    connecting: 'bg-warning-solid animate-pulse',
    connected: 'bg-success-solid',
    checking: 'bg-warning-solid animate-pulse',
    disconnected: 'bg-subtle',
    error: 'bg-danger-solid',
  }
  return <span className={`inline-block w-2 h-2 rounded-full ${colors[status]}`} />
}

function statusLabel(status: ConnectionStatus): string {
  switch (status) {
    case 'connecting':
      return '连接中…'
    case 'connected':
      return '已连接'
    case 'checking':
      return '确认状态…'
    case 'disconnected':
      return '已断开'
    case 'error':
      return '连接失败'
  }
}
