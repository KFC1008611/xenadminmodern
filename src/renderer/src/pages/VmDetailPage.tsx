/**
 * VmDetailPage — detailed view for a single VM, accessed via /vms/:ref.
 * Includes VM management controls and Radix Tabs for Overview, Console, Snapshots, Network, Storage, and Advanced Settings panels.
 * v5: Added Network tab with VIF management.
 * v9: Added Storage tab and Advanced Settings tab.
 */
import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useNavigate, useSearchParams, useLocation } from 'react-router-dom'
import * as Tabs from '@radix-ui/react-tabs'
import {
  ArrowLeft,
  RefreshCw,
  AlertCircle,
  Loader2,
  Download,
  Play,
  Square,
  RotateCcw,
  Camera,
  Power,
  Copy,
  FileCode,
  Trash2,
  Pause,
  ArrowRightLeft,
  Edit3,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { VmDetailRecord, VIFRecord } from '../types/xapi'
import { cn, getVmStateBadge } from '../lib/utils'
import { feedback } from '../store/feedback.store'
import { executeAction, executeConfirm } from '../lib/executeAction'
import { vmPowerConfirmation } from '../lib/vmPowerConfirmation'
import { canRunVmAction, type VmActionGuardResult } from '../lib/vmActionGuard'
import { useMultiDataStore } from '../store/multiData.store'
import { useConnectionManagerStore } from '../store/connectionManager.store'
import { OverviewTab } from './vm-detail/OverviewTab'
import { MemoryTab } from './vm-detail/MemoryTab'
import { VmIdentityDialog } from '../components/vm/VmIdentityDialog'
import { ConsoleTab } from './vm-detail/ConsoleTab'
import { SnapshotsTab } from './vm-detail/SnapshotsTab'
import { VifManager } from '../components/vm/VifManager'
import { VmMonitorTab } from '../components/vm/VmMonitorTab'
import { VmStorageTab } from '../components/vm/VmStorageTab'
import { VmAdvancedSettingsTab } from '../components/vm/VmAdvancedSettingsTab'
import { VmExportDialog } from '../components/vm/VmExportDialog'
import { CopyVmDialog } from '../components/vm/CopyVmDialog'
import { DeleteVmDialog } from '../components/vm/DeleteVmDialog'
import { VmRelocateDialog } from '../components/vm/VmRelocateDialog'
import { DesktopDialog } from '../components/layout/DesktopDialog'
import { VmActionMenu } from '../components/vm/VmActionMenu'

interface DetailActionButtonProps {
  icon: LucideIcon
  label: string
  guard: VmActionGuardResult
  loading: boolean
  busy: boolean
  busyReason?: string
  onClick: () => void
  className: string
  compact?: boolean
}

const VM_TABS = ['overview', 'memory', 'console', 'snapshots', 'network', 'storage', 'monitor', 'advanced']

function DetailActionButton({
  icon: Icon,
  label,
  guard,
  loading,
  busy,
  busyReason,
  onClick,
  className,
  compact = false,
}: DetailActionButtonProps) {
  const disabled = busy || !guard.canRun

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={loading ? '处理中…' : busy ? busyReason : guard.canRun ? label : guard.reason}
      className={cn(
        'inline-flex items-center rounded-lg border border-border bg-card text-sm font-medium text-secondary-foreground transition-colors hover:border-input hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border disabled:hover:bg-card',
        compact ? 'h-8 w-8 justify-center' : 'h-9 gap-1.5 px-3',
        className,
      )}
      aria-label={label}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Icon className="h-4 w-4" />
      )}
      <span className={compact ? 'sr-only' : ''}>{label}</span>
    </button>
  )
}

export default function VmDetailPage() {
  const { ref, connectionId } = useParams<{ ref: string; connectionId: string }>()
  const [searchParams] = useSearchParams()
  const connections = useConnectionManagerStore((state) => state.connections)
  const connected = connections.filter((connection) => connection.state === 'connected')
  const resolvedConnection = connectionId || searchParams.get('connectionId') || (connected.length === 1 ? connected[0].id : '')
  const connection = connections.find((item) => item.id === resolvedConnection)
  // Local tabs, drafts and confirmations belong to one connection lifetime and VM.
  return <VmDetailView key={JSON.stringify([resolvedConnection, connection?.poolUuid, connection?.epoch, connection?.connectedAt, connection?.state, ref])} />
}

function VmDetailView() {
  const { ref: encodedRef, connectionId: pathConnectionId } = useParams<{ ref: string; connectionId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  // feedback used directly

  const { networks: allNetworks, hosts: allHosts, domainStates, refreshNetworks, refreshVms } = useMultiDataStore()
  const connections = useConnectionManagerStore((s) => s.connections)

  const [vm, setVm] = useState<VmDetailRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const requestedTab = searchParams.get('tab') || 'overview'
  const activeTab = VM_TABS.includes(requestedTab) ? requestedTab : 'overview'
  const setActiveTab = (tab: string) => {
    if (!VM_TABS.includes(tab)) return
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous)
      if (tab === 'overview') next.delete('tab')
      else next.set('tab', tab)
      return next
    })
  }
  const [vifs, setVifs] = useState<VIFRecord[]>([])
  const [vifsLoading, setVifsLoading] = useState(false)
  const [vifsError, setVifsError] = useState<string | null>(null)
  const vmReadGeneration = useRef(0)
  const vifReadGeneration = useRef(0)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; vmReadGeneration.current++; vifReadGeneration.current++ }
  }, [])
  const [isExportOpen, setIsExportOpen] = useState(false)
  const [isCopyOpen, setIsCopyOpen] = useState(false)
  const [isRelocateOpen, setIsRelocateOpen] = useState(false)
  const [isDeleteOpen, setIsDeleteOpen] = useState(false)
  const [isConvertOpen, setIsConvertOpen] = useState(false)
  const [isIdentityOpen, setIsIdentityOpen] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [detailRefreshKey, setDetailRefreshKey] = useState(0)

  const vmRef = encodedRef ? decodeURIComponent(encodedRef) : ''

  const connectedConnections = connections.filter((c) => c.state === 'connected')
  const searchConnectionId = searchParams.get('connectionId') || ''
  const legacyFallbackConnectionId = connectedConnections.length === 1 ? connectedConnections[0].id : ''
  const connectionId = pathConnectionId || searchConnectionId || legacyFallbackConnectionId
  const networks = allNetworks.filter((network) => network.connectionId === connectionId)
  const connectionResolutionError =
    !pathConnectionId && !searchConnectionId && connectedConnections.length > 1
      ? '旧链接缺少资源池连接，请从左侧资源池或 VM 列表重新进入'
      : ''
  const listPath = location.state?.vmListPath
  const hostList = typeof listPath === 'string' && listPath.startsWith(`/pool/${encodeURIComponent(connectionId)}/hosts/`)
    && /^\/pool\/[^/]+\/hosts\/[^/?]+\?/.test(listPath) && new URLSearchParams(listPath.split('?')[1]).get('tab') === 'vms'
  const backPath = typeof listPath === 'string' && (/^\/(?:pool\/[^/]+\/)?vms(?:\?|$)/.test(listPath) || hostList)
    ? listPath : connectionId ? `/pool/${encodeURIComponent(connectionId)}/vms` : '/vms'
  const connection = connectionId ? connections.find((c) => c.id === connectionId) : null
  const vmsReadAt = domainStates[connectionId]?.vms?.lastSuccessAt
  const deviceRefreshKey = `${detailRefreshKey}:${vmsReadAt ?? ''}`
  const poolName = connection?.poolName || connection?.name || connectionId
  const host = allHosts.find((item) => item.connectionId === connectionId && item.ref === vm?.resident_on)
  const viewNetwork = (networkRef: string) => navigate(`/pool/${encodeURIComponent(connectionId)}/networks?network=${encodeURIComponent(networkRef)}`)
  const viewStorage = (srRef: string) => navigate(`/pool/${encodeURIComponent(connectionId)}/storage?sr=${encodeURIComponent(srRef)}`)

  const loadVm = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent === true
    const generation = ++vmReadGeneration.current
    if (!vmRef || !connectionId || connectionResolutionError) {
      if (!silent) {
        setError(
          !vmRef
            ? '缺少 VM 标识'
            : connectionResolutionError || '没有可用的资源池连接，无法加载 VM 详情',
        )
        setLoading(false)
      }
      return
    }
    if (!silent) {
      setLoading(true)
      setError(null)
    }
    try {
      const record = await window.xapi.vm.getRecord(connectionId, vmRef)
      if (!mounted.current || generation !== vmReadGeneration.current) return
      setVm(record)
      setError(null)
    } catch (e: any) {
      const msg = e?.message || String(e)
      if (!mounted.current || generation !== vmReadGeneration.current) return
      setError(msg)
    } finally {
      if (mounted.current && generation === vmReadGeneration.current) setLoading(false)
    }
  }, [vmRef, connectionId, connectionResolutionError])

  const loadVifs = useCallback(async () => {
    if (!vmRef || !connectionId) return
    const generation = ++vifReadGeneration.current
    setVifsLoading(true)
    setVifsError(null)
    try {
      const vifRecords = await window.xapi.vm.getVIFs(connectionId, vmRef)
      if (mounted.current && generation === vifReadGeneration.current) setVifs(vifRecords)
    } catch (error: any) {
      if (mounted.current && generation === vifReadGeneration.current) setVifsError(error?.message || String(error))
    } finally {
      if (mounted.current && generation === vifReadGeneration.current) setVifsLoading(false)
    }
  }, [vmRef, connectionId])

  const refreshNetworkTab = useCallback(async () => {
    await Promise.all([loadVm({ silent: true }), loadVifs()])
  }, [loadVm, loadVifs])

  useEffect(() => {
    loadVm()
  }, [loadVm])

  useEffect(() => {
    if (vmsReadAt) void loadVm({ silent: true })
  }, [loadVm, vmsReadAt])

  // Event delivery can be interrupted; keep all tabs' power capabilities fresh.
  useEffect(() => {
    if (connection?.state !== 'connected') return
    let reading = false
    const refresh = async () => {
      if (reading || actionLoading !== null || document.visibilityState === 'hidden') return
      reading = true
      try { await loadVm({ silent: true }) } finally { reading = false }
    }
    const timer = setInterval(() => void refresh(), 5000)
    window.addEventListener('focus', refresh)
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh) }
  }, [connection?.state, actionLoading, loadVm])

  useEffect(() => {
    if (!connectionId || !vmRef) return

    return window.xapi.onVmChanged((event) => {
      if (event.connectionId !== connectionId || event.ref !== vmRef) return

      if (event.operation === 'del') {
        vmReadGeneration.current++
        vifReadGeneration.current++
        setVm(null)
        setError('VM 已删除')
        setLoading(false)
        return
      }

      if (event.snapshot) {
        setVm((current) =>
          current
            ? ({ ...current, ...event.snapshot, ref: vmRef } as VmDetailRecord)
            : current
        )
      }

      void loadVm({ silent: true })
    })
  }, [connectionId, loadVm, vmRef])

  useEffect(() => {
    if (connectionId) {
      refreshNetworks()
    }
  }, [connectionId])

  // Guest IPs and VIFs can change independently while the VM is running.
  useEffect(() => {
    if (activeTab === 'network') {
      void refreshNetworkTab()
    }
  }, [activeTab, refreshNetworkTab, vmsReadAt])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="w-8 h-8 animate-spin text-accent-foreground" />
          <span className="text-sm">加载 VM 详情中…</span>
        </div>
      </div>
    )
  }

  if (!vm) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-4 text-muted-foreground max-w-sm text-center">
          <AlertCircle className="w-10 h-10 text-danger" />
          <div>
            <p className="text-foreground font-medium mb-1">加载失败</p>
            <p className="text-sm text-muted-foreground">{error || '未知错误'}</p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => navigate(backPath)}
              className="px-4 py-2 text-sm bg-muted hover:bg-secondary text-foreground rounded-lg transition-colors"
            >
              返回列表
            </button>
            <button
              onClick={() => loadVm()}
              className="px-4 py-2 text-sm bg-primary hover:bg-primary-hover text-primary-foreground rounded-lg transition-colors"
            >
              重试
            </button>
          </div>
        </div>
      </div>
    )
  }

  const guards = {
    start: canRunVmAction(vm, 'start'),
    shutdown: canRunVmAction(vm, 'shutdown'),
    reboot: canRunVmAction(vm, 'reboot'),
    forceShutdown: canRunVmAction(vm, 'forceShutdown'),
    pause: canRunVmAction(vm, 'pause'),
    unpause: canRunVmAction(vm, 'unpause'),
    suspend: canRunVmAction(vm, 'suspend'),
    resume: canRunVmAction(vm, 'resume'),
    snapshot: canRunVmAction(vm, 'snapshot'),
    export: canRunVmAction(vm, 'export'),
    copy: canRunVmAction(vm, 'copy'),
    relocate:
      vm.is_a_template || vm.is_a_snapshot || vm.is_control_domain || vm.locked || vm.Locked || Object.keys(vm.current_operations ?? {}).length > 0
        ? { canRun: false, reason: '当前 VM 不能迁移或移动' }
        : { canRun: true },
    delete: canRunVmAction(vm, 'delete'),
  }
  const actionBusyReason = actionLoading !== null ? '正在确认或执行 VM 操作，请等待结果'
    : connection?.state !== 'connected' ? '资源池连接已断开，请重新连接'
      : error !== null ? 'VM 状态读取失败，请刷新后再操作' : undefined
  const actionBusy = !!actionBusyReason
  const applyConfiguration = (record: VmDetailRecord) => {
    setVm(record)
    void refreshVms({ afterMutation: true, connectionId })
  }
  const canConvert = vm.power_state === 'Halted' && !vm.is_a_template && !vm.is_a_snapshot
    && !vm.is_control_domain && !vm.locked && !vm.Locked
    && Object.keys(vm.current_operations ?? {}).length === 0

  const convertToTemplate = async () => {
    if (!canConvert) return
    setActionLoading('convert')
    try {
      await window.xapi.vm.markAsTemplate(connectionId, vm.ref)
      await refreshVms({ afterMutation: true, connectionId })
      feedback.success(`已将 ${vm.name_label} 转换为模板`)
      if (mounted.current) navigate(backPath)
    } catch (error: any) {
      feedback.error(`转换为模板失败：${error?.message || String(error)}`)
    } finally {
      setActionLoading(null)
      setIsConvertOpen(false)
    }
  }

  const refreshVmAfterAction = async () => {
    await loadVm({ silent: true })
    await refreshVms({ afterMutation: true, connectionId })
  }

  const doVmAction = async (
    actionKey: string,
    operationLabel: string,
    action: () => Promise<void>,
    onSuccess?: () => void | Promise<void>,
  ) => {
    setActionLoading(actionKey)
    try {
      const confirmation = vmPowerConfirmation(operationLabel, vm.name_label, poolName)
      const options = {
        label: `${operationLabel} VM "${vm.name_label}"`,
        action,
        context: poolName,
        trackProgress: true,
        onSuccess: async () => {
          await refreshVmAfterAction()
          await onSuccess?.()
        },
      }
      if (confirmation) await executeConfirm({ ...options, ...confirmation })
      else await executeAction(options)
    } finally {
      setActionLoading(null)
    }
  }

  const powerIntent = { vmUuid: vm.uuid, poolUuid: connection?.poolUuid, epoch: connection?.epoch }
  const powerActions = [
    {
      key: 'start',
      label: '启动',
      icon: Play,
      guard: guards.start,
      className: 'text-success hover:text-success',
      onClick: () => doVmAction('start', '启动', () => window.xapi.vm.start(connectionId, vm.ref, powerIntent)),
    },
    {
      key: 'shutdown',
      label: '关闭',
      icon: Power,
      guard: guards.shutdown,
      className: 'text-warning hover:text-warning',
      onClick: () => doVmAction('shutdown', '关闭', () => window.xapi.vm.shutdown(connectionId, vm.ref, powerIntent)),
    },
    {
      key: 'reboot',
      label: '重启',
      icon: RotateCcw,
      guard: guards.reboot,
      className: 'text-accent-foreground hover:text-accent-foreground',
      onClick: () => doVmAction('reboot', '重启', () => window.xapi.vm.reboot(connectionId, vm.ref, powerIntent)),
    },
    {
      key: 'forceShutdown',
      label: '强制关闭',
      icon: Square,
      guard: guards.forceShutdown,
      className: 'text-danger hover:text-danger',
      onClick: () =>
        doVmAction('forceShutdown', '强制关闭', () =>
          window.xapi.vm.forceShutdown(connectionId, vm.ref, powerIntent)
        ),
    },
    {
      key: 'pause',
      label: '暂停',
      icon: Pause,
      guard: guards.pause,
      className: 'text-secondary-foreground hover:text-foreground',
      onClick: () => doVmAction('pause', '暂停', () => window.xapi.vm.pause(connectionId, vm.ref, powerIntent)),
    },
    {
      key: 'unpause',
      label: '继续运行',
      icon: Play,
      guard: guards.unpause,
      className: 'text-success hover:text-success',
      onClick: () => doVmAction('unpause', '继续运行', () => window.xapi.vm.unpause(connectionId, vm.ref, powerIntent)),
    },
    {
      key: 'suspend', label: '挂起', icon: Pause, guard: guards.suspend,
      className: 'text-warning hover:text-warning',
      onClick: () => doVmAction('suspend', '挂起', () => window.xapi.vm.suspend(connectionId, vm.ref, powerIntent)),
    },
    {
      key: 'resume', label: '从挂起恢复', icon: Play, guard: guards.resume,
      className: 'text-success hover:text-success',
      onClick: () => doVmAction('resume', '从挂起恢复', () => window.xapi.vm.resume(connectionId, vm.ref, powerIntent)),
    },
  ]

  const managementActions = [
    {
      key: 'snapshot',
      label: '创建快照',
      icon: Camera,
      guard: guards.snapshot,
      className: 'text-accent-foreground hover:text-accent-foreground',
      onClick: () =>
        doVmAction(
          'snapshot',
          '快照创建',
          () =>
            window.xapi.vm
              .snapshot(connectionId, vm.ref, `${vm.name_label}-snapshot-${Date.now()}`)
              .then(() => {}),
          () => setDetailRefreshKey((key) => key + 1),
        ),
    },
    {
      key: 'export',
      label: '导出',
      icon: Download,
      guard: guards.export,
      className: 'text-info hover:text-info',
      onClick: () => setIsExportOpen(true),
    },
    {
      key: 'relocate',
      label: '迁移/移动',
      icon: ArrowRightLeft,
      guard: guards.relocate,
      className: 'text-info hover:text-info',
      onClick: () => setIsRelocateOpen(true),
    },
    {
      key: 'copy',
      label: '复制',
      icon: Copy,
      guard: guards.copy,
      className: 'text-accent-foreground hover:text-accent-foreground',
      onClick: () => setIsCopyOpen(true),
    },
    {
      key: 'convert',
      label: '转换为模板',
      icon: FileCode,
      guard: { canRun: canConvert, reason: '仅可转换已关闭且无进行中操作的普通 VM' },
      className: 'text-warning hover:text-warning',
      onClick: () => setIsConvertOpen(true),
    },
    {
      key: 'delete',
      label: '删除',
      icon: Trash2,
      guard: guards.delete,
      className: 'text-danger hover:text-danger',
      onClick: () => setIsDeleteOpen(true),
    },
  ]
  const primaryPowerKeys = vm.power_state === 'Running' ? ['shutdown', 'reboot']
    : vm.power_state === 'Paused' ? ['unpause']
      : vm.power_state === 'Suspended' ? ['resume'] : ['start']
  const actionButton = (action: Pick<DetailActionButtonProps, 'icon' | 'label' | 'guard' | 'onClick' | 'className'> & { key: string }, menu = false) => (
    <DetailActionButton key={action.key} icon={action.icon} label={action.label} guard={action.guard}
      loading={actionLoading === action.key} busy={actionBusy} busyReason={actionBusyReason}
      onClick={action.onClick} className={cn(action.className, menu && 'w-full justify-start border-transparent bg-transparent hover:bg-muted')} />
  )
  return (
    <div className="space-y-3">
      {error && <div role="alert" className="rounded-lg border border-warning/30 bg-warning-soft p-3 text-sm text-warning break-words">VM 状态读取失败：{error}。当前显示最近一次成功读取的数据，请刷新后再操作。</div>}
      {connection?.state !== 'connected' && <div role="alert" className="rounded-lg border border-warning/30 p-3 text-sm text-warning">资源池连接已断开，请重新连接后再操作。</div>}
      {Object.keys(vm.current_operations ?? {}).length > 0 && <p role="status" className="rounded-lg border border-primary/30 bg-accent p-3 text-sm text-accent-foreground">VM 正在执行：{Object.values(vm.current_operations ?? {}).join('、')}。</p>}
      {/* Top toolbar */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => navigate(backPath)}
            className="flex-shrink-0 p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
            title="返回 VM 列表"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-xl font-semibold text-foreground break-all">
                {vm.name_label}
              </h1>
              <span
                className={`inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-medium border flex-shrink-0 ${getVmStateBadge(vm.power_state)}`}
              >
                {vm.power_state}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground break-words">资源池：{poolName}</p>
            {vm.name_description && (
              <p className="text-sm text-muted-foreground mt-0.5 truncate">
                {vm.name_description}
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <button
            onClick={() => {
              setDetailRefreshKey((key) => key + 1)
              if (activeTab === 'network') void refreshNetworkTab()
              else void loadVm({ silent: true })
            }}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="刷新"
          >
            <RefreshCw className="w-4 h-4" />
            刷新
          </button>
        </div>
      </div>

      {/* VM management actions */}
      <div
        aria-label="虚拟机操作"
        className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card p-3"
      >
        <div className="flex flex-wrap gap-1.5">
          {powerActions.filter((action) => primaryPowerKeys.includes(action.key)).map((action) => actionButton(action))}
          <span className="mx-1 self-stretch border-l border-border" />
          <button type="button" onClick={() => setActiveTab('console')} className="h-9 rounded-lg px-3 text-sm text-secondary-foreground hover:bg-muted">打开控制台</button>
          {managementActions.filter((action) => action.key === 'snapshot').map((action) => actionButton(action))}
        </div>
        <VmActionMenu>
          <div role="group" aria-label="电源操作">
            <p className="px-3 py-1.5 text-xs text-subtle">电源操作</p>
            {powerActions.filter((action) => !primaryPowerKeys.includes(action.key) && action.key !== 'forceShutdown').map((action) => actionButton(action, true))}
          </div>
          <div role="group" aria-label="管理操作" className="mt-2 border-t border-border pt-2">
            <p className="px-3 py-1.5 text-xs text-subtle">管理操作</p>
            {actionButton({ key: 'identity', label: '编辑名称和简介', icon: Edit3,
              guard: { canRun: !vm.is_control_domain && !vm.is_a_template && !vm.is_a_snapshot && !vm.locked && !vm.Locked, reason: '当前对象不可编辑名称和简介' },
              className: 'text-secondary-foreground', onClick: () => setIsIdentityOpen(true) }, true)}
            {managementActions.filter((action) => action.key !== 'snapshot' && action.key !== 'delete').map((action) => actionButton(action, true))}
          </div>
          <div role="group" aria-label="危险操作" className="mt-2 border-t border-border pt-2">
            <p className="px-3 py-1.5 text-xs text-danger">危险操作</p>
            {powerActions.filter((action) => action.key === 'forceShutdown').map((action) => actionButton(action, true))}
            {managementActions.filter((action) => action.key === 'delete').map((action) => actionButton(action, true))}
          </div>
        </VmActionMenu>
      </div>

      {/* Tabs */}
      <Tabs.Root value={activeTab} onValueChange={setActiveTab}>
        <div className="mb-3 overflow-x-auto border-b border-border">
          <Tabs.List className="flex min-w-max gap-1">
            {[
              { value: 'overview', label: '概览' },
              { value: 'memory', label: '内存' },
              { value: 'console', label: '控制台' },
              { value: 'snapshots', label: '快照' },
              { value: 'network', label: '网络' },
              { value: 'storage', label: '存储' },
              { value: 'monitor', label: '监控' },
              { value: 'advanced', label: '高级设置' },
            ].map((tab) => (
              <Tabs.Trigger
                key={tab.value}
                value={tab.value}
                className="relative shrink-0 whitespace-nowrap px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors data-[state=active]:text-accent-foreground outline-none focus-visible:ring-1 focus-visible:ring-primary rounded-t-lg after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-primary after:scale-x-0 after:transition-transform data-[state=active]:after:scale-x-100"
              >
                {tab.label}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
        </div>

        <Tabs.Content value="overview" className="outline-none">
          <OverviewTab vm={vm} connectionId={connectionId} networks={networks} hostName={host?.name_label} onViewHost={host ? () => navigate(`/pool/${encodeURIComponent(connectionId)}/hosts/${encodeURIComponent(host.ref)}`) : undefined} onViewNetwork={viewNetwork} onViewStorage={viewStorage} onManageStorage={() => setActiveTab('storage')} onManageNetwork={() => setActiveTab('network')} onUpdated={refreshVmAfterAction} onEditIdentity={() => setIsIdentityOpen(true)} onViewMemory={() => setActiveTab('memory')} />
        </Tabs.Content>

        <Tabs.Content value="memory" className="outline-none">
          <MemoryTab key={`${connectionId}:${vm.ref}`} vm={vm} connectionId={connectionId} onUpdated={applyConfiguration} busy={actionBusy} />
        </Tabs.Content>

        <Tabs.Content value="console" className="outline-none">
          <ConsoleTab vm={vm} connectionId={connectionId} onVmRecordChanged={setVm} />
        </Tabs.Content>

        <Tabs.Content value="snapshots" className="outline-none">
          <SnapshotsTab
            vmRef={vm.ref}
            connectionId={connectionId}
            powerState={vm.power_state}
            refreshKey={deviceRefreshKey}
            canCreate={guards.snapshot.canRun && !actionBusy}
          />
        </Tabs.Content>

        <Tabs.Content value="network" className="outline-none">
          {connectionId ? (
            vifsLoading ? <p role="status" className="py-8 text-sm text-muted-foreground">正在读取虚拟网卡…</p> : vifsError ? <div role="alert" className="rounded-lg border border-warning/30 p-3 text-sm text-warning break-words">虚拟网卡读取失败：{vifsError}。请刷新后再操作。</div> : <VifManager
              connectionId={connectionId}
              vmRef={vmRef}
              vifs={vifs}
              networks={networks}
              guestNetworks={vm.networks}
              onChanged={refreshNetworkTab}
              disabled={actionBusy}
              onViewNetwork={viewNetwork}
            />
          ) : (
            <div className="text-center py-12 text-subtle">
              无法确定连接，请返回 VM 列表重新进入
            </div>
          )}
        </Tabs.Content>

        <Tabs.Content value="storage" className="outline-none">
          {connectionId ? (
            <VmStorageTab
              connectionId={connectionId}
              vmRef={vmRef}
              powerState={vm.power_state}
              vbdRefs={vm.VBDs}
              refreshKey={deviceRefreshKey}
              disabled={actionBusy}
              onViewStorage={viewStorage}
            />
          ) : (
            <div className="text-center py-12 text-subtle">
              无法确定连接，请返回 VM 列表重新进入
            </div>
          )}
        </Tabs.Content>

        <Tabs.Content value="monitor" className="outline-none">
          <VmMonitorTab connectionId={connectionId} vmRef={vmRef} />
        </Tabs.Content>

        <Tabs.Content value="advanced" className="outline-none">
          {connectionId ? (
            <VmAdvancedSettingsTab
              connectionId={connectionId}
              vmRef={vmRef}
              powerState={vm.power_state}
            />
          ) : (
            <div className="text-center py-12 text-subtle">
              无法确定连接，请返回 VM 列表重新进入
            </div>
          )}
        </Tabs.Content>
      </Tabs.Root>

      {/* Export Dialog */}
      {isIdentityOpen && <VmIdentityDialog key={`${connectionId}:${vm.ref}`} vm={vm} connectionId={connectionId} onClose={() => setIsIdentityOpen(false)} onUpdated={applyConfiguration} />}
      {isConvertOpen && (
        <DesktopDialog title="转换为模板" onClose={() => setIsConvertOpen(false)} busy={actionBusy} className="max-w-md">
          <div className="w-full max-w-md rounded-xl border border-input bg-card p-6 space-y-4">
            <h2 className="text-lg font-semibold text-foreground">转换为模板</h2>
            <p className="text-sm text-secondary-foreground">将已关闭的虚拟机“{vm.name_label}”转换为用户模板。转换后原虚拟机将移至模板列表，不能再直接启动。</p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setIsConvertOpen(false)} disabled={actionBusy} className="px-4 py-2 text-sm text-secondary-foreground">取消</button>
              <button onClick={() => void convertToTemplate()} disabled={actionBusy} className="rounded-lg bg-warning-solid px-4 py-2 text-sm text-on-solid disabled:opacity-50">转换</button>
            </div>
          </div>
        </DesktopDialog>
      )}
      {vm && (
        <VmExportDialog
          open={isExportOpen}
          onClose={() => setIsExportOpen(false)}
          vmRef={vm.ref}
          vmName={vm.name_label}
          vmRecord={vm}
          powerState={vm.power_state as any}
          connectionId={connectionId}
        />
      )}

      <CopyVmDialog
        open={isCopyOpen}
        onClose={() => setIsCopyOpen(false)}
        vm={
          vm
            ? {
                ref: vm.ref,
                name_label: vm.name_label,
                name_description: vm.name_description,
                connectionId,
              }
            : null
        }
        onSuccess={() => refreshVms({ afterMutation: true, connectionId })}
      />

      <VmRelocateDialog
        open={isRelocateOpen}
        onClose={() => setIsRelocateOpen(false)}
        vm={
          vm
            ? {
                ref: vm.ref,
                name_label: vm.name_label,
                power_state: vm.power_state,
                connectionId,
                poolName,
              }
            : null
        }
        onSuccess={refreshVmAfterAction}
      />

      <DeleteVmDialog
        open={isDeleteOpen}
        onClose={() => setIsDeleteOpen(false)}
        vm={
          vm
            ? {
                ref: vm.ref,
                uuid: vm.uuid,
                name_label: vm.name_label,
                connectionId,
                poolName,
              }
            : null
        }
        onSuccess={async () => {
          await refreshVms({ afterMutation: true, connectionId })
          if (mounted.current) navigate(backPath)
        }}
      />
    </div>
  )
}
