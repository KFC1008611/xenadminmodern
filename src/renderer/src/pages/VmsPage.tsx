/**
 * VmsPage — unified list of all VMs and templates with inline power controls.
 * v9: Merged VM and template views into a single unified list with type filter.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useParams, useSearchParams, useLocation } from 'react-router-dom'
import { useShallow } from 'zustand/react/shallow'
import { getConnectionReadIdentity, useMultiDataStore } from '../store/multiData.store'
import { useConnectionManagerStore } from '../store/connectionManager.store'
import { useBatchStore } from '../store/batch.store'
import { formatBytes, getVmStateBadge } from '../lib/utils'
import { getGuestIpAddresses } from '../lib/networkDisplay'
import {
  Play, Square, RotateCcw, Camera, Power, Plus, ChevronRight, Download,
  Lock, MoreVertical, Copy, Settings, Trash2, PlayCircle, Monitor, Upload, FileCode,
  Filter, ChevronDown,
  Pause,
  ArrowRightLeft,
  Zap,
  ArrowDown, ArrowUp, ArrowUpDown,
} from 'lucide-react'
import { feedback } from '../store/feedback.store'
import { executeAction, executeConfirm } from '../lib/executeAction'
import { vmPowerConfirmation } from '../lib/vmPowerConfirmation'
import { canRunVmAction, type VmActionGuardResult, type VmActionRecord } from '../lib/vmActionGuard'
import { CreateVmWizard } from '../components/wizard/CreateVmWizard'
import { BatchToolbar } from '../components/batch/BatchToolbar'
import { VmExportDialog } from '../components/vm/VmExportDialog'
import { CopyVmDialog } from '../components/vm/CopyVmDialog'
import { DeleteVmDialog } from '../components/vm/DeleteVmDialog'
import { CloneTemplateDialog } from '../components/template/CloneTemplateDialog'
import { DeleteTemplateDialog } from '../components/template/DeleteTemplateDialog'
import { TemplateSettingsDialog } from '../components/template/TemplateSettingsDialog'
import { VmImportDialog } from '../components/vm/VmImportDialog'
import { VmRelocateDialog } from '../components/vm/VmRelocateDialog'
import type { VmRecord } from '../types/xapi'
import { ResourceActionMenu, type ResourceAction } from '../components/layout/ResourceActionMenu'
import { templateQuickCreateGuard } from '../../../shared/template-quick-create'
import { useHostVmScope } from '../lib/useHostVmScope'

// ── Types ──────────────────────────────────────────────────────────────────────
type ItemType = 'vm' | 'user-template' | 'system-template'
type SortKey = 'itemType' | 'name_label' | 'power_state' | 'ip' | 'poolName' | 'host' | 'VCPUs_max' | 'memory_static_max'
type TemplateSelection = VmRecord & { connectionId?: string }
type DropdownPosition = { top: number; left: number }
interface TemplateReadState {
  identity: string | null
  user: (VmRecord & { connectionId: string; poolName: string })[]
  system: (VmRecord & { connectionId: string; poolName: string })[]
  loading: boolean
  error: string | null
  lastSuccessAt: number | null
}

const TEMPLATE_MENU_WIDTH = 192
const TEMPLATE_MENU_ESTIMATED_HEIGHT = 302
const TEMPLATE_MENU_MARGIN = 8
const listCollator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })
const sortColumns: Array<{ key: SortKey; label: string }> = [
  { key: 'itemType', label: '类型' },
  { key: 'name_label', label: '名称' },
  { key: 'power_state', label: '状态' },
  { key: 'ip', label: 'IP 地址' },
  { key: 'poolName', label: '资源池' },
  { key: 'host', label: '主机' },
  { key: 'VCPUs_max', label: 'vCPU' },
  { key: 'memory_static_max', label: '内存' },
]

const typeOptions: Array<{
  value: ItemType
  label: string
  icon: 'vm' | 'template' | 'system-template'
}> = [
  { value: 'vm', label: '虚拟机', icon: 'vm' },
  { value: 'user-template', label: '用户模板', icon: 'template' },
  { value: 'system-template', label: '系统模板', icon: 'system-template' },
]

interface ListItem {
  ref: string
  uuid?: string
  connectionId: string
  poolName: string
  name_label: string
  name_description?: string
  itemType: ItemType
  // VM specific
  power_state?: VmRecord['power_state']
  resident_on?: string
  affinity?: string
  VCPUs_max?: string | number
  memory_static_max?: string | number
  is_a_template?: boolean
  is_a_snapshot?: boolean
  is_control_domain?: boolean
  allowed_operations?: string[]
  current_operations?: Record<string, string>
  blocked_operations?: Record<string, string>
  locked?: boolean
  Locked?: boolean
  networks?: Record<string, string>
  guestMetricsError?: string
  // template specific
  is_default_template?: boolean
  other_config?: Record<string, string>
}

function actionButtonClass(colorClass: string, guard: VmActionGuardResult): string {
  const disabledClass = guard.canRun
    ? ''
    : ' opacity-40 cursor-not-allowed hover:bg-transparent'
  return `inline-flex h-8 w-8 items-center justify-center ${colorClass} rounded-lg transition-colors${disabledClass}`
}

function toVmActionRecord(item: ListItem): VmActionRecord {
  return {
    is_a_template: item.is_a_template ?? false,
    is_control_domain: item.is_control_domain ?? false,
    allowed_operations: item.allowed_operations,
    current_operations: item.current_operations,
    blocked_operations: item.blocked_operations,
    locked: item.locked,
    Locked: item.Locked,
    power_state: item.power_state,
  }
}

function resourceKey(connectionId: string, ref: string): string {
  return `${connectionId}:${ref}`
}

function getTemplateMenuPosition(rect: DOMRect): DropdownPosition {
  const maxLeft = window.innerWidth - TEMPLATE_MENU_WIDTH - TEMPLATE_MENU_MARGIN
  const left = Math.max(
    TEMPLATE_MENU_MARGIN,
    Math.min(rect.right - TEMPLATE_MENU_WIDTH, maxLeft),
  )
  const belowTop = rect.bottom + 4
  const aboveTop = rect.top - TEMPLATE_MENU_ESTIMATED_HEIGHT - 4
  const top = belowTop + TEMPLATE_MENU_ESTIMATED_HEIGHT <= window.innerHeight - TEMPLATE_MENU_MARGIN
    ? belowTop
    : Math.max(TEMPLATE_MENU_MARGIN, aboveTop)

  return { top, left }
}

export default function VmsPage({ hostRef, connectionId: hostConnectionId }: { hostRef?: string; connectionId?: string } = {}) {
  const { vms: allVms, hosts: allHosts, refreshVms, templateRevision } = useMultiDataStore(useShallow(
    ({ vms, hosts, refreshVms, templateRevision }) => ({ vms, hosts, refreshVms, templateRevision }),
  ))
  const vmReadStates = useMultiDataStore(useShallow((state) => Object.fromEntries(
    Object.entries(state.domainStates).filter(([, domains]) => domains.vms).map(([id, domains]) => [id, domains.vms]),
  )))
  const connections = useConnectionManagerStore((s) => s.connections)
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const location = useLocation()
  const copySearch = searchParams.get('search') || ''
  const { connectionId: routeConnectionId } = useParams<{ connectionId?: string }>()
  const pathConnectionId = hostConnectionId || routeConnectionId
  const hostScope = useHostVmScope(pathConnectionId, hostRef)

  const connectedConnections = connections.filter((c) => c.state === 'connected')
  const connectedConnectionKey = useMemo(
    () => connections
      .filter((c) => c.state === 'connected')
      .map((c) => JSON.stringify([c.id, c.connectedAt, c.epoch, c.poolUuid]))
      .sort()
      .join('\0'),
    [connections],
  )
  const pathConnection = pathConnectionId
    ? connectedConnections.find((c) => c.id === pathConnectionId)
    : null

  // Filter by connectionId if specified in path
  const vms = allVms.filter((vm) => (!pathConnectionId || vm.connectionId === pathConnectionId) && (!hostRef || hostScope.refs.has(vm.ref)))
  const hosts = pathConnectionId ? allHosts.filter((h) => h.connectionId === pathConnectionId) : allHosts

  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const filter = copySearch
  const sort = searchParams.get('sort')?.split(',').flatMap((value) => {
    const [key, direction] = value.split('.')
    return sortColumns.some((column) => column.key === key) && ['asc', 'desc'].includes(direction)
      ? [{ key: key as SortKey, ascending: direction === 'asc' }] : []
  }) || []
  if (!sort.length) sort.push({ key: 'name_label', ascending: true })
  const setSort = (update: (previous: typeof sort) => typeof sort) => {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous)
      next.set('sort', update(sort).map((entry) => `${entry.key}.${entry.ascending ? 'asc' : 'desc'}`).join(','))
      return next
    }, { replace: true })
  }
  const typeFilter = searchParams.get('types')
  const selectedTypes: Record<ItemType, boolean> = typeFilter === null
    ? { vm: true, 'user-template': true, 'system-template': false }
    : { vm: typeFilter.split(',').includes('vm'), 'user-template': typeFilter.split(',').includes('user-template'), 'system-template': typeFilter.split(',').includes('system-template') }
  const [isWizardOpen, setIsWizardOpen] = useState(false)
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateSelection | null>(null)
  const [exportTarget, setExportTarget] = useState<{
    vmRef: string
    vmName: string
    powerState: string
    connectionId: string
    isTemplate?: boolean
  } | null>(null)
  const [copyTarget, setCopyTarget] = useState<ListItem | null>(null)
  const [relocateTarget, setRelocateTarget] = useState<ListItem | null>(null)
  const [deleteVmTarget, setDeleteVmTarget] = useState<ListItem | null>(null)
  const [convertTarget, setConvertTarget] = useState<ListItem | null>(null)
  const [templateReads, setTemplateReads] = useState<Record<string, TemplateReadState>>({})
  const templateRequests = useRef(new Map<string, number>())
  const templateRequestSequence = useRef(0)
  const templatesMounted = useRef(true)
  useEffect(() => {
    templatesMounted.current = true
    return () => { templatesMounted.current = false; templateRequests.current.clear() }
  }, [])
  const currentTemplateReads = connectedConnections.flatMap((connection) => {
    const read = templateReads[connection.id]
    return read && read.identity === getConnectionReadIdentity(connection.id) ? [{ connection, read }] : []
  })
  const scopedTemplateReads = currentTemplateReads.filter(({ connection }) => !pathConnectionId || connection.id === pathConnectionId)
  const userTemplates = currentTemplateReads.flatMap(({ read }) => read.user)
  const systemTemplates = currentTemplateReads.flatMap(({ read }) => read.system)
  const [cloneTarget, setCloneTarget] = useState<any | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null)
  const [settingsTarget, setSettingsTarget] = useState<any | null>(null)
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null)
  const quickCreatingKeysRef = useRef(new Set<string>())
  const [quickCreatingKeys, setQuickCreatingKeys] = useState<Set<string>>(() => new Set())
  const [isTypeDropdownOpen, setIsTypeDropdownOpen] = useState(false)
  const [dropdownPosition, setDropdownPosition] = useState<DropdownPosition>({ top: 0, left: 0 })
  const [importDialogOpen, setImportDialogOpen] = useState(false)

  // v8: Batch selection
  const {
    selectedVms,
    selectAll,
    refreshTasks,
    isSubmitting,
  } = useBatchStore(useShallow(({ selectedVms, selectAll, refreshTasks, isSubmitting }) => (
    { selectedVms, selectAll, refreshTasks, isSubmitting }
  )))
  const selectionAnchor = useRef<string | null>(null)
  const selectedKeys = useMemo(() => new Set(selectedVms.map((vm) => resourceKey(vm.connectionId, vm.vmRef))), [selectedVms])
  const isSelected = (connectionId: string, ref: string) => selectedKeys.has(resourceKey(connectionId, ref))

  const singleConnectionId = connectedConnections.length === 1 ? connectedConnections[0].id : ''
  const scopedConnectionId = pathConnectionId
    ? pathConnection?.id || ''
    : singleConnectionId
  const scopedConnectionName = connectedConnections.find((conn) => conn.id === scopedConnectionId)
  const hasScopedConnection = !!scopedConnectionId
  const scopedActionTitle = hasScopedConnection
    ? `目标资源池：${scopedConnectionName?.poolName || scopedConnectionName?.name || scopedConnectionId}`
    : '请先选择单个资源池'

  // Each pool has its own ordering and last successful template list.
  const loadTemplates = useCallback(async (onlyConnectionId?: string) => {
    const connected = useConnectionManagerStore.getState().connections
      .filter((connection) => connection.state === 'connected' && (!onlyConnectionId || connection.id === onlyConnectionId))
    setTemplateReads((previous) => Object.fromEntries(Object.entries(previous).filter(([id, read]) => read.identity === getConnectionReadIdentity(id) && read.identity !== null)))
    await Promise.all(connected.map(async (connection) => {
      const identity = getConnectionReadIdentity(connection.id)
      const request = ++templateRequestSequence.current
      templateRequests.current.set(connection.id, request)
      const current = () => templatesMounted.current && templateRequests.current.get(connection.id) === request
        && getConnectionReadIdentity(connection.id) === identity
      setTemplateReads((previous) => ({ ...previous, [connection.id]: {
        ...(previous[connection.id]?.identity === identity ? previous[connection.id] : { identity, user: [], system: [], error: null, lastSuccessAt: null }), loading: true,
      } }))
      try {
        const result = await window.xapi.vm.templates(connection.id)
        if (!current()) return
        const scoped = (record: VmRecord) => ({ ...record, connectionId: connection.id, poolName: connection.poolName || connection.name })
        setTemplateReads((previous) => ({ ...previous, [connection.id]: {
          identity, user: result.user.map(scoped), system: result.system.map(scoped), loading: false, error: null, lastSuccessAt: Date.now(),
        } }))
      } catch (error: any) {
        if (!current()) return
        setTemplateReads((previous) => ({ ...previous, [connection.id]: {
          ...previous[connection.id], loading: false, error: error?.message || '模板读取失败',
        } }))
      }
    }))
  }, [])

  useEffect(() => {
    const completed = (event: Event) => {
      const operation = (event as CustomEvent<import('../../../shared/types/xapi').VmCopyOperation>).detail
      if (operation.isTemplate) void loadTemplates(operation.targetConnectionId)
    }
    window.addEventListener('vm-copy-completed', completed)
    return () => window.removeEventListener('vm-copy-completed', completed)
  }, [loadTemplates])

  const quickCreate = async (item: ListItem) => {
    const key = resourceKey(item.connectionId, item.ref)
    if (quickCreatingKeysRef.current.has(key)) return
    quickCreatingKeysRef.current.add(key)
    setActiveDropdown(null)
    setQuickCreatingKeys((current) => new Set(current).add(key))
    const identity = getConnectionReadIdentity(item.connectionId)
    try {
      const vmRef = await window.xapi.vm.quickCreateFromTemplate(item.connectionId, item.ref)
      if (getConnectionReadIdentity(item.connectionId) !== identity) {
        feedback.info(`${item.poolName} 的虚拟机已创建并启动（${vmRef}），请连接原资源池查看`)
        return
      }
      try {
        await refreshVms({ afterMutation: true, connectionId: item.connectionId })
      } catch {
        feedback.info(`虚拟机已创建并启动（${vmRef}），列表刷新失败，请手动刷新`)
        return
      }
      feedback.success(`已从模板创建并启动虚拟机：${item.name_label}`)
    } catch (error: any) {
      // A provision result may be uncertain; refresh so a retained VM is visible for review.
      if (getConnectionReadIdentity(item.connectionId) === identity) {
        try { await refreshVms({ afterMutation: true, connectionId: item.connectionId }) } catch { /* keep the original operation error */ }
      }
      if (['VM_CREATED_START_INCOMPLETE', 'VM_QUICK_CREATE_INCOMPLETE', 'VM_QUICK_CREATE_OUTCOME_UNKNOWN'].includes(error?.code)) {
        feedback.warning(error.message)
      } else feedback.error(`快速创建失败：${error?.message || String(error)}`)
    } finally {
      quickCreatingKeysRef.current.delete(key)
      setQuickCreatingKeys((current) => {
        const next = new Set(current)
        next.delete(key)
        return next
      })
    }
  }

  const enableQuickCreate = async (item: ListItem) => {
    const key = resourceKey(item.connectionId, item.ref)
    if (quickCreatingKeysRef.current.has(key)) return
    quickCreatingKeysRef.current.add(key)
    setActiveDropdown(null)
    setQuickCreatingKeys((current) => new Set(current).add(key))
    const identity = getConnectionReadIdentity(item.connectionId)
    try {
      await window.xapi.template.enableInstantCreate(item.connectionId, item.ref)
      if (getConnectionReadIdentity(item.connectionId) === identity) await loadTemplates(item.connectionId)
      feedback.success(`已启用快速创建：${item.name_label}`)
    } catch (error: any) {
      feedback.error(`启用快速创建失败：${error?.message || String(error)}`)
    } finally {
      quickCreatingKeysRef.current.delete(key)
      setQuickCreatingKeys((current) => { const next = new Set(current); next.delete(key); return next })
    }
  }

  const convertToTemplate = async () => {
    if (!convertTarget) return
    const item = convertTarget
    const key = resourceKey(item.connectionId, item.ref)
    setActionLoading(key)
    try {
      await window.xapi.vm.markAsTemplate(item.connectionId, item.ref)
      await Promise.all([refreshVms({ afterMutation: true, connectionId: item.connectionId }), loadTemplates()])
      setConvertTarget(null)
      feedback.success(`已将 ${item.name_label} 转换为模板`)
    } catch (error: any) {
      feedback.error(`转换为模板失败：${error?.message || String(error)}`)
    } finally {
      setActionLoading(null)
    }
  }

  // Load VMs when the connected pool set changes.
  useEffect(() => {
    refreshVms()
  }, [connectedConnectionKey, refreshVms])

  useEffect(() => {
    if (!connectedConnectionKey) return
    let reading = false
    const refresh = async () => {
      if (reading || actionLoading !== null || document.visibilityState === 'hidden') return
      reading = true
      try { await refreshVms() } finally { reading = false }
    }
    const timer = setInterval(() => void refresh(), 5000)
    window.addEventListener('focus', refresh)
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh) }
  }, [connectedConnectionKey, actionLoading, refreshVms])

  // Templates have their own invalidation; unrelated domain completions must not reload them.
  useEffect(() => {
    loadTemplates()
  }, [connectedConnectionKey, templateRevision, loadTemplates])

  useEffect(() => { refreshTasks() }, [])

  // ── Merged data ──────────────────────────────────────────────────────────────
  const visibleUserTemplates = pathConnectionId
    ? userTemplates.filter((template) => template.connectionId === pathConnectionId)
    : userTemplates
  const visibleSystemTemplates = pathConnectionId
    ? systemTemplates.filter((template) => template.connectionId === pathConnectionId)
    : systemTemplates

  const seenItems = new Set<string>()
  const allItems: ListItem[] = [
    ...vms.map(vm => ({ ...vm, itemType: 'vm' as const })),
    ...(!hostRef ? visibleUserTemplates.map(t => ({ ...t, itemType: 'user-template' as const })) : []),
    ...(!hostRef ? visibleSystemTemplates.map(t => ({ ...t, itemType: 'system-template' as const })) : []),
  ].filter((item) => {
    // VM reads supersede an older template cache for the same XAPI object.
    const key = resourceKey(item.connectionId, item.ref)
    if (seenItems.has(key)) return false
    seenItems.add(key)
    return true
  })

  // Unified filter
  const filtered = allItems.filter((item) => {
    const nameMatch = item.name_label.toLowerCase().includes(filter.toLowerCase()) ||
      (item.itemType === 'vm' && getGuestIpAddresses(item.networks ?? {}).some(({ address }) => address.toLowerCase().includes(filter.toLowerCase())))
    const typeMatch = !!hostRef || selectedTypes[item.itemType]
    return nameMatch && typeMatch
  })

  const isDefaultTypeSelection =
    selectedTypes.vm && selectedTypes['user-template'] && !selectedTypes['system-template']

  const selectedTypeCount = typeOptions.filter((option) => selectedTypes[option.value]).length
  const selectedTypeLabel = selectedTypeCount === typeOptions.length
    ? '全部类型'
    : selectedTypeCount === 0
      ? '未选择类型'
      : typeOptions
        .filter((option) => selectedTypes[option.value])
        .map((option) => option.label)
        .join('、')

  const toggleType = (type: ItemType) => {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous)
      next.set('types', typeOptions.filter((option) => option.value === type ? !selectedTypes[type] : selectedTypes[option.value]).map((option) => option.value).join(','))
      return next
    }, { replace: true })
  }

  // Only VMs for select-all logic
  const filteredVms = filtered.filter(item => item.itemType === 'vm')

  const getHostName = (hostRef: string | undefined, connectionId: string) => {
    if (!hostRef) return '—'
    const host = hosts.find((h) => h.ref === hostRef && h.connectionId === connectionId)
    return host?.name_label || '—'
  }

  const sortValue = (item: ListItem, key: SortKey): string | number | null => {
    switch (key) {
      case 'itemType': return typeOptions.findIndex((option) => option.value === item.itemType)
      case 'power_state': return item.itemType === 'vm' ? item.power_state || null : '模板'
      case 'ip': return item.itemType === 'vm' && ['Running', 'Paused'].includes(item.power_state ?? '') && !item.guestMetricsError
        ? [...new Set(getGuestIpAddresses(item.networks ?? {}).map(({ address }) => address))].join(' ') || null : null
      case 'host': {
        const name = item.itemType === 'vm' && item.power_state === 'Running' ? getHostName(item.resident_on, item.connectionId) : '—'
        return name === '—' ? null : name
      }
      case 'VCPUs_max':
      case 'memory_static_max': {
        const value = item[key]
        return value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null
      }
      default: return item[key] || null
    }
  }
  const sortedItems = filtered.map((item) => ({ item, values: sort.map(({ key }) => sortValue(item, key)) })).sort((a, b) => {
    for (let index = 0; index < sort.length; index++) {
      const left = a.values[index], right = b.values[index]
      if (left === null && right !== null) return 1
      if (right === null && left !== null) return -1
      const compared = typeof left === 'number' && typeof right === 'number'
        ? left - right : listCollator.compare(String(left), String(right))
      if (compared) return compared * (sort[index].ascending ? 1 : -1)
    }
    return listCollator.compare(resourceKey(a.item.connectionId, a.item.ref), resourceKey(b.item.connectionId, b.item.ref))
  }).map(({ item }) => item)

  const powerIntentFor = (item: ListItem) => {
    const pool = connections.find((entry) => entry.id === item.connectionId)
    return item.uuid ? { vmUuid: item.uuid, poolUuid: pool?.poolUuid, epoch: pool?.epoch } : undefined
  }

  const doAction = async (
    action: () => Promise<void>,
    loadingKey: string,
    vmName: string,
    operationLabel: string,
    poolName: string,
    connectionId: string
  ) => {
    setActionLoading(loadingKey)
    const confirmation = vmPowerConfirmation(operationLabel, vmName, poolName)
    const options = {
      label: `${operationLabel} VM "${vmName}"`,
      action,
      context: poolName,
      trackProgress: true,
      onSuccess: () => refreshVms({ afterMutation: true, connectionId }),
    }
    if (confirmation) await executeConfirm({ ...options, ...confirmation })
    else await executeAction(options)
    setActionLoading(null)
  }

  const handleVmCreated = (vmRef: string) => {
    const targetConnectionId = selectedTemplate?.connectionId || scopedConnectionId
    setIsWizardOpen(false)
    setSelectedTemplate(null)
    void refreshVms({ afterMutation: true, connectionId: targetConnectionId })
    navigate(`/pool/${encodeURIComponent(targetConnectionId)}/vms/${encodeURIComponent(vmRef)}`)
  }

  const openCreateWizard = (template: TemplateSelection | null = null) => {
    setSelectedTemplate(template)
    setIsWizardOpen(true)
  }

  // v8: Check if all filtered VMs are selected
  const allSelected = filteredVms.length > 0 && filteredVms.every((vm) =>
    isSelected(vm.connectionId, vm.ref)
  )

  // v8: Handle select all checkbox
  const handleSelectAll = () => {
    if (useBatchStore.getState().isSubmitting) return
    selectionAnchor.current = null
    if (allSelected) {
      const filteredIds = new Set(filteredVms.map((vm) => resourceKey(vm.connectionId, vm.ref)))
      const newSelection = selectedVms.filter(
        (vm) => !filteredIds.has(resourceKey(vm.connectionId, vm.vmRef))
      )
      selectAll(newSelection)
    } else {
      const newVms = filteredVms
        .filter((vm) => !isSelected(vm.connectionId, vm.ref))
        .map((vm) => ({
          connectionId: vm.connectionId,
          vmRef: vm.ref,
          vmName: vm.name_label,
          intent: powerIntentFor(vm),
        }))
      selectAll([...selectedVms, ...newVms])
    }
  }

  const handleSelectVm = (item: ListItem, event: MouseEvent, checkbox = false) => {
    if (useBatchStore.getState().isSubmitting) return
    const key = resourceKey(item.connectionId, item.ref)
    const visible = sortedItems.filter((row) => row.itemType === 'vm')
    const anchor = visible.findIndex((row) => resourceKey(row.connectionId, row.ref) === selectionAnchor.current)
    const index = visible.findIndex((row) => resourceKey(row.connectionId, row.ref) === key)
    const targets = (rows: ListItem[]) => rows.map((row) => ({ connectionId: row.connectionId, vmRef: row.ref, vmName: row.name_label, intent: powerIntentFor(row) }))
    if (event.shiftKey) {
      const range = anchor >= 0 ? visible.slice(Math.min(anchor, index), Math.max(anchor, index) + 1) : [item]
      const keys = new Set(range.map((row) => resourceKey(row.connectionId, row.ref)))
      selectAll([...selectedVms.filter((vm) => !keys.has(resourceKey(vm.connectionId, vm.vmRef))), ...targets(range)])
      if (anchor < 0) selectionAnchor.current = key
    } else {
      if (checkbox || event.ctrlKey || event.metaKey) {
        selectAll(isSelected(item.connectionId, item.ref) ? selectedVms.filter((vm) => resourceKey(vm.connectionId, vm.vmRef) !== key) : [...selectedVms, ...targets([item])])
      } else selectAll(targets([item]))
      selectionAnchor.current = key
    }
  }

  return (
    <div className="space-y-4">
      {hostRef && hostScope.loading && <p role="status" className="text-sm text-muted-foreground">正在读取虚拟机归属…</p>}
      {hostRef && hostScope.error && <div role="alert" className="text-sm text-warning">虚拟机存储归属读取失败。{hostScope.error}
        <button type="button" onClick={hostScope.retry} className="ml-2 underline">重新读取虚拟机归属</button>
      </div>}
      {currentTemplateReads.filter(({ connection, read }) => read.error && (!pathConnectionId || connection.id === pathConnectionId)).map(({ connection, read }) => (
        <div key={connection.id} role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-warning/30 bg-warning-soft p-3 text-sm text-warning">
          <span className="min-w-0 flex-1 break-words">{connection.poolName || connection.name} 的模板读取失败：{read.error}。{read.lastSuccessAt ? '保留上次模板数据，请重新读取后操作。' : '尚未取得模板清单，请重新读取。'}</span>
          <button type="button" disabled={read.loading} onClick={() => void loadTemplates(connection.id)} className="rounded border border-warning/30 px-3 py-1 disabled:opacity-40">重新读取模板</button>
        </div>
      ))}
      {Object.entries(vmReadStates).filter(([id, state]) => state?.error && (!pathConnectionId || id === pathConnectionId)).map(([id, state]) => (
        <div key={id} role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-warning/30 bg-warning-soft p-3 text-sm text-warning">
          <span className="min-w-0 flex-1 break-words">{connections.find((pool) => pool.id === id)?.poolName || id} 的 VM 列表读取失败：{state?.error}。当前显示上次数据，请刷新后再操作。</span>
          <button type="button" onClick={() => void refreshVms()} className="rounded border border-warning/30 px-3 py-1">重新读取 VM 列表</button>
        </div>
      ))}
      {/* v8: Batch Toolbar */}
      <BatchToolbar visibleVms={filteredVms} />

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="sr-only">虚拟机与模板</h1>
        <span className="text-xs tabular-nums text-muted-foreground">{filtered.length} 项</span>

        {/* ── Toolbar ──────────────────────────────────────────────────────── */}
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {/* Type filters */}
          {!hostRef && <div className="relative">
            <button
              type="button"
              onClick={() => setIsTypeDropdownOpen((open) => !open)}
              className="flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-foreground transition-colors hover:border-input hover:bg-muted focus:outline-none focus:ring-1 focus:ring-primary sm:w-auto sm:min-w-[170px]"
              aria-haspopup="menu"
              aria-expanded={isTypeDropdownOpen}
            >
              <span className="flex min-w-0 items-center gap-2">
                <Filter className="h-4 w-4 shrink-0 text-subtle" />
                <span className="truncate">{selectedTypeLabel}</span>
              </span>
              <ChevronDown
                className={`h-4 w-4 shrink-0 text-subtle transition-transform ${isTypeDropdownOpen ? 'rotate-180' : ''}`}
              />
            </button>

            {isTypeDropdownOpen && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setIsTypeDropdownOpen(false)}
                />
                <div className="absolute left-0 top-full z-50 mt-2 w-56 overflow-hidden rounded-lg border border-input bg-card shadow-xl shadow-black/30">
                  <div className="border-b border-border px-3 py-2">
                    <div className="text-xs font-medium text-secondary-foreground">显示类型</div>
                  </div>
                  <div className="p-1.5">
                    {typeOptions.map((option) => {
                      const checked = selectedTypes[option.value]

                      return (
                        <label
                          key={option.value}
                          className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm text-secondary-foreground transition-colors hover:bg-muted hover:text-foreground"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleType(option.value)}
                            className="h-4 w-4 rounded border-input bg-background text-accent-foreground focus:ring-1 focus:ring-primary focus:ring-offset-0"
                          />
                          {option.icon === 'vm' ? (
                            <Monitor className="h-4 w-4 text-accent-foreground" />
                          ) : option.icon === 'system-template' ? (
                            <span className="inline-flex w-4 items-center">
                              <FileCode className="h-4 w-4 text-muted-foreground" />
                              <Lock className="-ml-1.5 h-2.5 w-2.5 text-subtle" />
                            </span>
                          ) : (
                            <FileCode className="h-4 w-4 text-warning" />
                          )}
                          <span>{option.label}</span>
                        </label>
                      )
                    })}
                  </div>
                </div>
              </>
            )}
          </div>}

          {/* Search */}
          <input
            type="text"
            placeholder="搜索名称或 IP…"
            value={filter}
            onChange={(event) => setSearchParams((previous) => {
              const next = new URLSearchParams(previous)
              if (event.target.value) next.set('search', event.target.value)
              else next.delete('search')
              return next
            }, { replace: true })}
            className="w-full rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-foreground placeholder-subtle focus:outline-none focus:ring-1 focus:ring-primary sm:w-48"
            aria-label="Filter items"
          />

          {/* Import button */}
          <button
            onClick={() => setImportDialogOpen(true)}
            disabled={!hasScopedConnection}
            title={hasScopedConnection ? scopedActionTitle : '请先选择单个资源池'}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-secondary px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:bg-muted disabled:text-subtle sm:w-auto"
            aria-label="Import virtual machine"
          >
            <Upload className="w-4 h-4" />
            导入
          </button>

          {/* Create VM button */}
          <button
            onClick={() => openCreateWizard()}
            disabled={!hasScopedConnection}
            title={hasScopedConnection ? scopedActionTitle : '请先选择单个资源池'}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-secondary disabled:text-subtle sm:w-auto"
            aria-label="Create new virtual machine"
          >
            <Plus className="w-4 h-4" />
            新建虚拟机
          </button>
        </div>
      </div>

      {/* ── Unified Table ────────────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="overflow-x-auto">
        <table className="min-w-[940px] w-full whitespace-nowrap text-[13px]">
          <thead>
            <tr className="border-b border-border">
              {/* Checkbox — header always present, only VM rows show actual checkbox */}
              <th className="text-left px-4 py-3 w-10">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(input) => { if (input) input.indeterminate = !allSelected && filteredVms.some((vm) => isSelected(vm.connectionId, vm.ref)) }}
                  disabled={isSubmitting || !filteredVms.length}
                  onChange={handleSelectAll}
                  className="w-4 h-4 rounded border-input bg-muted text-accent-foreground focus:ring-primary focus:ring-offset-card"
                  aria-label="Select all VMs"
                />
              </th>
              {sortColumns.filter((column) => !pathConnectionId || column.key !== 'poolName').map(({ key, label }) => {
                const index = sort.findIndex((entry) => entry.key === key)
                const current = sort[index]
                const SortIcon = current ? current.ascending ? ArrowUp : ArrowDown : ArrowUpDown
                return <th key={key} scope="col" title="点击排序，Shift + 点击添加排序列" aria-sort={index === 0 ? current.ascending ? 'ascending' : 'descending' : undefined}
                  className={`text-left py-3 text-muted-foreground font-medium ${key === 'itemType' ? 'px-2' : 'px-4'}`}>
                  <button type="button" title={current ? `第 ${index + 1} 排序：${current.ascending ? '升序' : '降序'}；Shift + 点击保留其他排序` : '点击排序；Shift + 点击添加排序'}
                    aria-description={current ? `第 ${index + 1} 排序，${current.ascending ? '升序' : '降序'}` : undefined}
                    onClick={(event) => {
                      const additive = event.shiftKey
                      setSort((previous) => {
                        const existing = previous.find((entry) => entry.key === key)
                        const next = { key, ascending: existing ? !existing.ascending : true }
                        return additive ? existing ? previous.map((entry) => entry.key === key ? next : entry) : [...previous, next] : [next]
                      })
                    }}
                    className="inline-flex items-center gap-1 rounded hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                    {label}<SortIcon className="h-3.5 w-3.5" aria-hidden="true" />
                    {sort.length > 1 && index >= 0 && <span aria-hidden="true" className="text-[11px] tabular-nums">{index + 1}</span>}
                  </button>
                </th>
              })}
              <th className="sticky right-0 z-10 bg-card text-right px-4 py-3 text-muted-foreground font-medium">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {sortedItems.map((item) => {
              const isVm = item.itemType === 'vm'
              const isSystemTemplate = item.itemType === 'system-template'
              const templateReadError = templateReads[item.connectionId]?.error
              const itemKey = resourceKey(item.connectionId, item.ref)
              const actionRecord = isVm ? toVmActionRecord(item) : null
              const guardAction = (action: Parameters<typeof canRunVmAction>[1]) => {
                if (!connectedConnections.some((pool) => pool.id === item.connectionId)) return { canRun: false, reason: '资源池连接已断开，请重新连接' }
                if (vmReadStates[item.connectionId]?.error) return { canRun: false, reason: 'VM 列表读取失败，请刷新后再操作' }
                if (actionLoading !== null) return { canRun: false, reason: '正在确认或执行 VM 操作，请等待结果' }
                return canRunVmAction(actionRecord!, action)
              }
              const guards = isVm
                ? {
                    start: guardAction('start'),
                    suspend: guardAction('suspend'),
                    resume: guardAction('resume'),
                    shutdown: guardAction('shutdown'),
                    reboot: guardAction('reboot'),
                    forceShutdown: guardAction('forceShutdown'),
                    pause: guardAction('pause'),
                    unpause: guardAction('unpause'),
                    snapshot: guardAction('snapshot'),
                    export: guardAction('export'),
                    copy: guardAction('copy'),
                    delete: guardAction('delete'),
                  }
                : null

              const primaryAction = !guards ? null
                : item.power_state === 'Halted' ? { label: '启动', action: 'start' as const, icon: Play, guard: guards.start }
                  : item.power_state === 'Running' ? { label: '关闭', action: 'shutdown' as const, icon: Power, guard: guards.shutdown }
                    : item.power_state === 'Paused' ? { label: '继续运行', action: 'unpause' as const, icon: Play, guard: guards.unpause }
                      : item.power_state === 'Suspended' ? { label: '从挂起恢复', action: 'resume' as const, icon: Play, guard: guards.resume } : null
              const powerAction = (label: string, action: 'suspend' | 'reboot' | 'forceShutdown' | 'pause', icon: ResourceAction['icon']): ResourceAction => ({
                label, icon, disabled: !guards?.[action].canRun, reason: guards?.[action].reason,
                danger: action === 'forceShutdown',
                onSelect: () => { if (guards?.[action].canRun) void doAction(() => window.xapi.vm[action](item.connectionId, item.ref, powerIntentFor(item)), itemKey, item.name_label, label, item.poolName, item.connectionId) },
              })
              const rowActions: ResourceAction[] = !isVm ? [] : [
                ...(item.power_state === 'Running' ? [powerAction('挂起', 'suspend', Pause), powerAction('重启', 'reboot', RotateCcw), powerAction('暂停', 'pause', Pause)] : []),
                ...(['Running', 'Paused', 'Suspended'].includes(item.power_state || '') ? [powerAction('强制关闭', 'forceShutdown', Square)] : []),
                { label: '创建快照', icon: Camera, disabled: !guards?.snapshot.canRun, reason: guards?.snapshot.reason,
                  onSelect: () => { if (guards?.snapshot.canRun) void doAction(() => window.xapi.vm.snapshot(item.connectionId, item.ref, `${item.name_label}-snapshot-${Date.now()}`).then(() => {}), itemKey, item.name_label, '快照创建', item.poolName, item.connectionId) } },
                { label: '导出', icon: Download, disabled: !guards?.export.canRun, reason: guards?.export.reason,
                  onSelect: () => { if (guards?.export.canRun) setExportTarget({ vmRef: item.ref, vmName: item.name_label, powerState: item.power_state || 'Halted', connectionId: item.connectionId }) } },
                { label: '迁移/移动 VM', icon: ArrowRightLeft, onSelect: () => setRelocateTarget(item) },
                { label: '复制 VM', icon: Copy, disabled: !guards?.copy.canRun, reason: guards?.copy.reason,
                  onSelect: () => { if (guards?.copy.canRun) setCopyTarget(item) } },
                ...(item.power_state === 'Halted' ? [
                  { label: '转换为模板', icon: FileCode, disabled: !!actionLoading || !!item.locked || !!item.Locked || !!Object.keys(item.current_operations ?? {}).length, reason: '虚拟机被锁定或有操作正在进行', onSelect: () => setConvertTarget(item) },
                  { label: '删除', icon: Trash2, danger: true, disabled: !guards?.delete.canRun, reason: guards?.delete.reason, onSelect: () => { if (guards?.delete.canRun) setDeleteVmTarget(item) } },
                ] : []),
              ]

              return (
                <tr key={itemKey} aria-selected={isVm ? isSelected(item.connectionId, item.ref) : undefined}
                  className={'transition-colors group ' + (isVm && isSelected(item.connectionId, item.ref) ? 'bg-accent' : 'hover:bg-muted')}
                  onMouseDown={(event) => { if (isVm && event.shiftKey && !(event.target as HTMLElement).closest('input,button,a')) event.preventDefault() }}
                  onContextMenu={(event) => {
                    const control = (event.target as HTMLElement).closest('input,button,a,select,textarea')
                    if (!isVm || !event.ctrlKey || (control && !control.hasAttribute('data-vm-name') && !control.matches('input[type="checkbox"]'))) return
                    event.preventDefault()
                    handleSelectVm(item, event, control?.matches('input[type="checkbox"]'))
                  }}
                  onClickCapture={(event) => {
                    if (!isVm) return
                    const control = (event.target as HTMLElement).closest('input,button,a,select,textarea')
                    const modifier = event.shiftKey || event.ctrlKey || event.metaKey
                    if (control && !(modifier && control.hasAttribute('data-vm-name'))) return
                    event.preventDefault(); event.stopPropagation()
                    handleSelectVm(item, event)
                  }}>
                  {/* Checkbox — only for VMs */}
                  <td className="px-4 py-3">
                    {isVm ? (
                      <input
                        type="checkbox"
                        checked={isSelected(item.connectionId, item.ref)}
                        disabled={isSubmitting}
                        onChange={() => {}}
                        onClick={(event) => handleSelectVm(item, event, true)}
                        className="w-4 h-4 rounded border-input bg-muted text-accent-foreground focus:ring-primary focus:ring-offset-card"
                        aria-label={`Select ${item.name_label}`}
                      />
                    ) : (
                      <span className="block w-4 h-4" />
                    )}
                  </td>

                  {/* Type icon */}
                  <td className="px-2 py-3">
                    {isVm ? (
                      <Monitor className="w-4 h-4 text-accent-foreground" />
                    ) : isSystemTemplate ? (
                      <span className="inline-flex items-center gap-0.5">
                        <FileCode className="w-4 h-4 text-muted-foreground" />
                        <Lock className="w-3 h-3 text-subtle" />
                      </span>
                    ) : (
                      <FileCode className="w-4 h-4 text-warning" />
                    )}
                  </td>

                  {/* Name */}
                  <td className="px-4 py-3">
                    {isVm ? (
                      <button
                        data-vm-name
                        className="text-left group/name"
                        onClick={() => navigate(`/pool/${encodeURIComponent(item.connectionId)}/vms/${encodeURIComponent(item.ref)}`, { state: { vmListPath: location.pathname + location.search } })}
                      >
                        <div className="text-foreground font-medium group-hover/name:text-accent-foreground transition-colors flex items-center gap-1">
                          {item.name_label}
                          <ChevronRight className="w-3.5 h-3.5 opacity-0 group-hover/name:opacity-100 transition-opacity" />
                        </div>
                      </button>
                    ) : (
                      <div>
                        <div className="text-foreground font-medium">{item.name_label}</div>
                      </div>
                    )}
                  </td>

                  {/* Status */}
                  <td className="px-4 py-3">
                    {isVm ? (
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border ${getVmStateBadge(item.power_state ?? '')}`}
                      >
                        {item.power_state}
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border border-warning/30 bg-warning-soft text-warning">
                        模板
                      </span>
                    )}
                  </td>

                  <td className="px-4 py-3 text-muted-foreground">
                    {!isVm || (item.power_state !== 'Running' && item.power_state !== 'Paused') ? '—'
                      : item.guestMetricsError ? <span className="text-warning" title={item.guestMetricsError}>读取失败</span>
                        : getGuestIpAddresses(item.networks ?? {}).length ? (
                          <div className="min-w-[140px] max-w-[240px] space-y-0.5 font-mono text-xs">
                            {[...new Set(getGuestIpAddresses(item.networks ?? {}).map(({ address }) => address))].map((address) => <div key={address} className="break-all select-text">{address}</div>)}
                          </div>
                        ) : <span title="Guest Tools 尚未上报 IP 地址">未上报</span>}
                  </td>

                  {/* Pool */}
                  {!pathConnectionId && <td className="px-4 py-3 text-muted-foreground">{item.poolName}</td>}

                  {/* Host */}
                  <td className="px-4 py-3 text-muted-foreground">
                    {isVm
                      ? (item.power_state === 'Running' ? getHostName(item.resident_on, item.connectionId) : '—')
                      : '—'
                    }
                  </td>

                  {/* vCPU */}
                  <td className="px-4 py-3 text-muted-foreground">
                    {item.VCPUs_max ?? '—'}
                  </td>

                  {/* Memory */}
                  <td className="px-4 py-3 text-muted-foreground">
                    {item.memory_static_max ? formatBytes(Number(item.memory_static_max)) : '—'}
                  </td>

                  {/* Actions */}
                  <td className="sticky right-0 z-10 bg-card px-4 py-3 shadow-[-6px_0_8px_-8px_hsl(var(--foreground)/0.25)]">
                    {isVm ? (
                      <div className="flex items-center justify-end gap-1" aria-busy={actionLoading === itemKey || undefined}>
                          {primaryAction && <button type="button"
                            onClick={() => primaryAction.guard.canRun && void doAction(() => window.xapi.vm[primaryAction.action](item.connectionId, item.ref, powerIntentFor(item)), itemKey, item.name_label, primaryAction.label, item.poolName, item.connectionId)}
                            disabled={!primaryAction.guard.canRun}
                            className={actionButtonClass('text-muted-foreground hover:bg-muted hover:text-accent-foreground', primaryAction.guard)}
                            aria-label={primaryAction.label} title={primaryAction.guard.canRun ? primaryAction.label : primaryAction.guard.reason}>
                            <primaryAction.icon className="h-4 w-4" />
                          </button>}
                          <ResourceActionMenu name={item.name_label} actions={rowActions} disabled={actionLoading !== null} />
                          {actionLoading === itemKey && <span role="status" className="sr-only">处理中...</span>}
                      </div>
                    ) : (
                      /* ── Template actions dropdown ── */
                      <div className="flex items-center justify-end relative">
                        {quickCreatingKeys.has(itemKey) ? (
                          <span className="text-xs text-subtle">处理中...</span>
                        ) : (
                          <>
                            <button
                              onClick={(e) => {
                                const rect = e.currentTarget.getBoundingClientRect()
                                setDropdownPosition(getTemplateMenuPosition(rect))
                                setActiveDropdown(activeDropdown === itemKey ? null : itemKey)
                              }}
                              className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg transition-colors"
                              title="操作"
                              disabled={!!templateReadError}
                            >
                              <MoreVertical className="w-4 h-4" />
                            </button>
                            {activeDropdown === itemKey && !templateReadError && createPortal(
                              <>
                                <div
                                  className="fixed inset-0 z-40"
                                  onClick={() => setActiveDropdown(null)}
                                />
                                <div
                                  className="fixed w-48 bg-muted border border-input rounded-lg shadow-xl z-50 py-1"
                                  style={{ top: dropdownPosition.top, left: dropdownPosition.left }}
                                >
                                  <button
                                    onClick={() => {
                                      setActiveDropdown(null)
                                      openCreateWizard(item as unknown as TemplateSelection)
                                    }}
                                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-secondary-foreground hover:bg-secondary hover:text-foreground transition-colors"
                                  >
                                    <PlayCircle className="w-4 h-4" />
                                    从模板创建VM
                                  </button>
                                  {item.itemType === 'user-template' && (
                                    <button
                                      type="button"
                                      disabled={!templateQuickCreateGuard(item, false).canRun}
                                      title={templateQuickCreateGuard(item, false).reason || (item.other_config?.instant === 'true' ? '沿用模板配置创建并启动 VM' : '启用后可沿用模板配置创建并启动 VM')}
                                      onClick={() => void (item.other_config?.instant === 'true' ? quickCreate(item) : enableQuickCreate(item))}
                                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-secondary-foreground hover:bg-secondary hover:text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                      <Zap className="w-4 h-4" />
                                      {item.other_config?.instant === 'true' ? '快速创建 VM' : '启用快速创建'}
                                    </button>
                                  )}
                                  <button
                                    onClick={() => {
                                      setActiveDropdown(null)
                                      setCloneTarget(item)
                                    }}
                                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-secondary-foreground hover:bg-secondary hover:text-foreground transition-colors"
                                  >
                                    <Copy className="w-4 h-4" />
                                    复制模板
                                  </button>
                                  <button
                                    onClick={() => {
                                      setActiveDropdown(null)
                                      setSettingsTarget(item)
                                    }}
                                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-secondary-foreground hover:bg-secondary hover:text-foreground transition-colors"
                                  >
                                    <Settings className="w-4 h-4" />
                                    模板设置
                                  </button>
                                  <button
                                    onClick={() => {
                                      setActiveDropdown(null)
                                      setExportTarget({
                                        vmRef: item.ref,
                                        vmName: item.name_label,
                                        powerState: 'Halted',
                                        connectionId: item.connectionId,
                                        isTemplate: true,
                                      })
                                    }}
                                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-secondary-foreground hover:bg-secondary hover:text-foreground transition-colors"
                                  >
                                    <Download className="w-4 h-4" />
                                    导出模板
                                  </button>
                                  <div className="border-t border-input my-1" />
                                  <button
                                    onClick={() => { setDeleteTarget(item); setActiveDropdown(null) }}
                                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-danger hover:bg-secondary transition-colors"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                    删除模板
                                  </button>
                                </div>
                              </>,
                              document.body,
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        </div>

        {/* Empty state */}
        {filtered.length === 0 && (!hostRef || !hostScope.loading && !hostScope.error) && (
          <div className="text-center py-12">
            <Monitor className="w-10 h-10 text-subtle mx-auto mb-3" />
            <p className="text-muted-foreground font-medium">
              {hostRef ? '没有找到此主机的虚拟机' : scopedTemplateReads.some(({ read }) => read.loading) ? '正在读取虚拟机与模板…' : scopedTemplateReads.some(({ read }) => read.error) ? '模板清单读取失败，请重新读取' : filter || !isDefaultTypeSelection ? '没有匹配筛选条件的项目' : '没有找到虚拟机或模板'}
            </p>
          </div>
        )}
      </div>

      {/* ── Dialogs ──────────────────────────────────────────────────────────── */}
      <CreateVmWizard
        open={isWizardOpen}
        onClose={() => {
          setIsWizardOpen(false)
          setSelectedTemplate(null)
        }}
        onCreated={handleVmCreated}
        connectionId={selectedTemplate?.connectionId || scopedConnectionId}
        initialTemplate={selectedTemplate}
        initialHostRef={hostRef}
      />

      {exportTarget && (
        <VmExportDialog
          open={!!exportTarget}
          onClose={() => setExportTarget(null)}
          vmRef={exportTarget.vmRef}
          vmName={exportTarget.vmName}
          powerState={exportTarget.powerState as any}
          connectionId={exportTarget.connectionId}
          isTemplate={exportTarget.isTemplate}
          vmRecord={allItems.find((item) => item.connectionId === exportTarget.connectionId && item.ref === exportTarget.vmRef) as VmActionRecord | undefined}
        />
      )}

      <CopyVmDialog
        open={!!copyTarget}
        onClose={() => setCopyTarget(null)}
        vm={copyTarget}
        onSuccess={() => refreshVms({ afterMutation: true, connectionId: copyTarget?.connectionId })}
      />

      <VmRelocateDialog
        open={!!relocateTarget}
        onClose={() => setRelocateTarget(null)}
        vm={relocateTarget}
        onSuccess={() => refreshVms({ afterMutation: true, connectionId: relocateTarget?.connectionId })}
      />

      <DeleteVmDialog
        open={!!deleteVmTarget}
        onClose={() => setDeleteVmTarget(null)}
        vm={deleteVmTarget}
        onSuccess={() => refreshVms({ afterMutation: true, connectionId: deleteVmTarget?.connectionId })}
      />

      {convertTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="转换为模板">
          <div className="w-full max-w-md rounded-xl border border-input bg-card p-6 space-y-4">
            <h2 className="text-lg font-semibold text-foreground">转换为模板</h2>
            <p className="text-sm text-secondary-foreground">将已关闭的虚拟机“{convertTarget.name_label}”转换为用户模板。转换后原虚拟机将从虚拟机列表移至模板列表，不能再直接启动。</p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setConvertTarget(null)} disabled={!!actionLoading} className="px-4 py-2 text-sm text-secondary-foreground">取消</button>
              <button onClick={() => void convertToTemplate()} disabled={!!actionLoading} className="rounded-lg bg-warning-solid px-4 py-2 text-sm text-on-solid disabled:opacity-50">转换</button>
            </div>
          </div>
        </div>
      )}

      <CloneTemplateDialog
        open={!!cloneTarget}
        onClose={() => setCloneTarget(null)}
        template={cloneTarget}
        onSuccess={() => loadTemplates(cloneTarget?.connectionId)}
      />

      <DeleteTemplateDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        template={deleteTarget}
        onSuccess={loadTemplates}
      />

      <TemplateSettingsDialog
        open={!!settingsTarget}
        onClose={() => setSettingsTarget(null)}
        template={settingsTarget}
        onSuccess={loadTemplates}
      />

      {/* v8: Batch Progress Dialog */}

      {/* VM Import Dialog */}
      <VmImportDialog
        open={importDialogOpen}
        onClose={() => setImportDialogOpen(false)}
        connectionId={scopedConnectionId}
        onViewObject={(id, ref) => navigate(`/pool/${encodeURIComponent(id)}/vms/${encodeURIComponent(ref)}`)}
        onImported={(id) => loadTemplates(id)}
      />
    </div>
  )
}
