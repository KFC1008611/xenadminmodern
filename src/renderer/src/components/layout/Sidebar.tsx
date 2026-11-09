/**
 * Sidebar — navigation panel with pool tree, global nav items, and connection management.
 *
 * UX Architecture Redesign:
 * - Pool-aware tree navigation: expand a pool to see its hosts/VMs/storage/networks
 * - Desktop sidebar can collapse to an icon rail while mobile keeps drawer behavior
 * - Global items (tasks, alerts) at the bottom
 * - Breadcrumb and detail pages use pool-scoped routes
 */
import { useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import {
  LayoutDashboard,
  Server,
  Monitor,
  HardDrive,
  Network,
  ClipboardList,
  ListChecks,
  Bell,
  Cpu,
  Settings,
  History,
  ChevronRight,
  Database,
  Plus,
  PanelLeftClose,
  PanelLeftOpen,
  Shield,
  FolderTree,
} from 'lucide-react'
import { cn } from '../../lib/utils'
import AlertBadge from './AlertBadge'
import { useConnectionManagerStore } from '../../store/connectionManager.store'
import { useMultiDataStore } from '../../store/multiData.store'
import { RememberedServerDialog } from '../connection/RememberedServerDialog'
import { ReconnectConnection } from '../connection/ReconnectConnection'

interface GlobalNavItem {
  to: string
  icon: typeof LayoutDashboard
  label: string
  tab?: string
}

interface SidebarProps {
  open?: boolean
  collapsed?: boolean
  onCollapsedChange?: (collapsed: boolean) => void
  onNavigate?: () => void
}

const globalNavItems: GlobalNavItem[] = [
  { to: '/dashboard', icon: LayoutDashboard, label: '仪表盘' },
  { to: '/tasks', icon: ClipboardList, label: '任务' },
  { to: '/batch-tasks', icon: ListChecks, label: '批量任务' },
  { to: '/rbac', icon: Shield, label: '用户与权限' },
  { to: '/pool-manager', icon: FolderTree, label: '资源池管理' },
  { to: '/alerts', icon: Bell, label: '告警消息', tab: 'alerts' },
  { to: '/alerts?tab=rules', icon: Settings, label: '告警规则', tab: 'rules' },
  { to: '/alerts?tab=history', icon: History, label: '告警历史', tab: 'history' },
]

/** Per-pool resource sub-items */
const poolResourceItems = [
  { segment: 'hosts', icon: Server, label: '主机', globalLabel: '全部主机' },
  { segment: 'vms', icon: Monitor, label: '虚拟机', globalLabel: '全部虚拟机与模板' },
  { segment: 'storage', icon: HardDrive, label: '存储', globalLabel: '全部存储' },
  { segment: 'networks', icon: Network, label: '网络', globalLabel: '全部网络' },
]

export default function Sidebar({
  open = false,
  collapsed = false,
  onCollapsedChange,
  onNavigate,
}: SidebarProps) {
  const location = useLocation()
  const connections = useConnectionManagerStore((s) => s.connections)
  const activeConnectionId = useConnectionManagerStore((s) => s.activeConnectionId)
  const setActiveConnection = useConnectionManagerStore((s) => s.setActiveConnection)
  const hosts = useMultiDataStore((s) => s.hosts)
  const vms = useMultiDataStore((s) => s.vms)
  const tasks = useMultiDataStore((s) => s.tasks)
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const isCollapsed = collapsed && !open

  // Track which pools are expanded
  const [expandedPools, setExpandedPools] = useState<Set<string>>(() => {
    // Auto-expand the active connection
    const initial = new Set<string>()
    const active = useConnectionManagerStore.getState().activeConnectionId
    if (active) initial.add(active)
    return initial
  })

  // Resource links can enter a different pool without using the tree first.
  // Reveal that context so the neighbouring resource pages remain discoverable.
  useEffect(() => {
    const segment = /^\/pool\/([^/]+)(?:\/|$)/.exec(location.pathname)?.[1]
    if (!segment) return
    let connectionId: string
    try { connectionId = decodeURIComponent(segment) } catch { return }
    if (!connections.some((connection) => connection.id === connectionId && connection.state === 'connected')) return
    setActiveConnection(connectionId)
    setExpandedPools((previous) => previous.has(connectionId) ? previous : new Set(previous).add(connectionId))
  }, [location.pathname, connections, setActiveConnection])

  const togglePool = (connectionId: string) => {
    setExpandedPools((prev) => {
      const next = new Set(prev)
      if (next.has(connectionId)) {
        next.delete(connectionId)
      } else {
        next.add(connectionId)
        // Also set as active connection
        setActiveConnection(connectionId)
      }
      return next
    })
  }

  const revealPoolFromRail = (connectionId: string) => {
    setActiveConnection(connectionId)
    setExpandedPools((prev) => new Set(prev).add(connectionId))
    onCollapsedChange?.(false)
  }

  const isItemActive = (item: GlobalNavItem): boolean => {
    const pathname = location.pathname
    if (item.tab) {
      if (pathname !== '/alerts') return false
      const currentTab = new URLSearchParams(location.search).get('tab') || 'alerts'
      return currentTab === item.tab
    }
    if (item.to.includes('?')) {
      return pathname === item.to.split('?')[0]
    }
    return pathname === item.to || pathname.startsWith(item.to + '/')
  }

  // Derive per-pool stats
  const getPoolStats = (connectionId: string) => {
    const poolHosts = hosts.filter((h) => h.connectionId === connectionId)
    const poolVms = vms.filter((v) => v.connectionId === connectionId)
    return {
      hostCount: poolHosts.length,
      vmCount: poolVms.length,
      runningVms: poolVms.filter((v) => v.power_state === 'Running').length,
    }
  }

  // Check if a pool-scoped sub-route is active
  const isPoolSubActive = (connectionId: string, segment: string): boolean => {
    const path = `/pool/${encodeURIComponent(connectionId)}/${segment}`
    return location.pathname === path || location.pathname.startsWith(`${path}/`)
  }

  // Check if any sub-route of this pool is active (for highlighting the pool item)
  const isPoolActive = (connectionId: string): boolean => {
    return location.pathname.startsWith(`/pool/${encodeURIComponent(connectionId)}/`)
  }

  const connectedPools = connections.filter((c) => c.state === 'connected')
  const disconnectedPools = connections.filter((c) => c.state !== 'connected')

  return (
    <aside
      className={cn(
        'fixed bottom-0 left-0 top-[var(--window-top-offset)] z-40 flex w-72 shrink-0 max-w-[calc(100vw-3rem)] flex-col overflow-hidden border-r border-border bg-sidebar shadow-2xl shadow-black/20 transition-[transform,width] duration-200 md:relative md:bottom-auto md:top-auto md:z-auto md:max-w-none md:translate-x-0 md:shadow-none',
        isCollapsed ? 'md:w-16' : 'md:w-[232px]',
        open ? 'translate-x-0' : '-translate-x-full',
      )}
    >
      {/* Brand */}
      <div
        className={cn(
          'h-14 flex items-center border-b border-border shrink-0',
          isCollapsed ? 'justify-center px-2' : 'gap-3 px-4',
        )}
      >
        {isCollapsed ? (
          <button
            type="button"
            aria-label="展开侧边栏"
            title="展开侧边栏"
            className="app-no-drag hidden h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:inline-flex"
            onClick={() => onCollapsedChange?.(false)}
          >
            <PanelLeftOpen className="h-4 w-4" />
          </button>
        ) : (
          <>
            <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center flex-shrink-0 shadow-none">
              <Cpu className="w-4 h-4 text-accent-foreground" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-foreground text-sm tracking-wide truncate">XCP-ng Center</p>
            </div>
            <button
              type="button"
              aria-label="收起侧边栏"
              title="收起侧边栏"
              className="app-no-drag hidden h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-subtle transition-colors hover:bg-muted hover:text-foreground md:inline-flex"
              onClick={() => onCollapsedChange?.(true)}
            >
              <PanelLeftClose className="h-4 w-4" />
            </button>
          </>
        )}
      </div>

      {/* Global navigation */}
      <nav aria-label="主导航" className="shrink-0 p-2 space-y-0.5 border-b border-border">
        {globalNavItems.map((item) => {
          const Icon = item.icon
          const isActive = isItemActive(item)
          return (
            <NavLink
              key={item.to}
              to={item.to}
              aria-label={isCollapsed ? item.label : undefined}
              title={isCollapsed ? item.label : undefined}
              onClick={onNavigate}
              className={cn(
                'relative flex items-center rounded-lg border border-transparent text-[13px] transition-colors',
                isCollapsed ? 'h-9 justify-center px-0' : 'gap-2.5 px-3 py-2',
                isActive
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted',
              )}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              {!isCollapsed && item.label}
              {item.to === '/alerts' && <AlertBadge compact={isCollapsed} />}
            </NavLink>
          )
        })}
      </nav>

      {/* Pool tree */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <nav aria-label="全部资源" className="space-y-0.5 border-b border-border p-2">
          {poolResourceItems.map(({ segment, icon: Icon, globalLabel }) => (
            <NavLink key={segment} to={`/${segment}`} onClick={onNavigate}
              aria-label={globalLabel} title={isCollapsed ? globalLabel : undefined}
              className={cn('flex items-center rounded-lg text-xs transition-colors',
                isCollapsed ? 'h-9 justify-center' : 'gap-2.5 px-3 py-1.5',
                location.pathname === `/${segment}` ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}>
              <Icon className="h-4 w-4 shrink-0" />
              {!isCollapsed && globalLabel}
            </NavLink>
          ))}
        </nav>
        <div
          className={cn(
            'flex items-center sticky top-0 bg-sidebar z-10',
            isCollapsed ? 'justify-center px-2 py-2' : 'justify-between px-3 py-2.5',
          )}
        >
          {!isCollapsed && (
            <h3 className="text-[11px] font-medium text-subtle">
              资源池
            </h3>
          )}
          <button
            type="button"
            aria-label="添加连接"
            onClick={() => setAddDialogOpen(true)}
            className={cn(
              'text-subtle hover:text-foreground hover:bg-muted rounded-md transition-colors',
              isCollapsed ? 'flex h-9 w-9 items-center justify-center' : 'p-1',
            )}
            title="添加连接"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>

        {connections.length === 0 ? (
          isCollapsed ? (
            <div className="mx-2 flex h-9 items-center justify-center rounded-lg border border-dashed border-border">
              <Database className="w-4 h-4 text-subtle" />
            </div>
          ) : (
          <div className="mx-3 px-3 py-4 border border-dashed border-border rounded-lg text-center">
            <Database className="w-6 h-6 text-subtle mx-auto mb-2" />
            <p className="text-xs text-subtle">暂无资源池</p>
            <button
              onClick={() => setAddDialogOpen(true)}
              className="mt-2 text-xs text-accent-foreground hover:text-accent-foreground transition-colors"
            >
              添加连接
            </button>
          </div>
          )
        ) : (
          <div className="px-2 pb-2 space-y-0.5">
            {/* Connected pools — expandable tree */}
            {connectedPools.map((conn) => {
              const isExpanded = expandedPools.has(conn.id)
              const isActive = isPoolActive(conn.id)
              const stats = getPoolStats(conn.id)
              const poolName = conn.poolName || conn.name || conn.host

              if (isCollapsed) {
                const isRailActive = activeConnectionId === conn.id || isActive
                return (
                  <button
                    key={conn.id}
                    type="button"
                    aria-label={`展开资源池 ${poolName}`}
                    title={poolName}
                    onClick={() => revealPoolFromRail(conn.id)}
                    className={cn(
                      'relative mx-auto flex h-9 w-9 items-center justify-center rounded-lg transition-colors',
                      isRailActive
                        ? 'bg-muted text-foreground'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    <Database className="h-4 w-4" />
                    <span className="absolute bottom-1 right-1 h-2 w-2 rounded-full bg-success-solid shadow-none" />
                  </button>
                )
              }

              return (
                <div key={conn.id}>
                  {/* Pool header — clickable to expand */}
                  <button
                    onClick={() => togglePool(conn.id)}
                    className={cn(
                      'w-full flex items-center gap-2 px-2 py-2 rounded-lg text-sm transition-colors text-left',
                      isActive
                        ? 'bg-muted text-foreground'
                        : 'text-secondary-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    <ChevronRight
                      className={cn(
                        'w-3.5 h-3.5 flex-shrink-0 transition-transform text-subtle',
                        isExpanded && 'rotate-90',
                      )}
                    />
                    <div
                      className="w-2 h-2 rounded-full bg-success-solid flex-shrink-0 shadow-none"
                      title="已连接"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="truncate font-medium text-sm">
                        {poolName}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 text-[11px] text-subtle flex-shrink-0">
                      <span>{stats.hostCount}H</span>
                      <span>{stats.runningVms}/{stats.vmCount}V</span>
                    </div>
                  </button>

                  {/* Expanded sub-items */}
                  {isExpanded && (
                    <div className="ml-5 pl-3 border-l border-border space-y-0.5 mt-0.5 mb-1">
                      {poolResourceItems.map((resItem) => {
                        const Icon = resItem.icon
                        const subActive = isPoolSubActive(conn.id, resItem.segment)
                        return (
                          <NavLink
                            key={resItem.segment}
                            to={`/pool/${conn.id}/${resItem.segment}`}
                            onClick={() => { setActiveConnection(conn.id); onNavigate?.() }}
                            className={cn(
                              'flex items-center gap-2.5 px-2 py-1.5 rounded-md text-xs transition-colors',
                              subActive
                                ? 'text-accent-foreground bg-accent'
                                : 'text-subtle hover:text-secondary-foreground hover:bg-muted',
                            )}
                          >
                            <Icon className="w-3.5 h-3.5 flex-shrink-0" />
                            {resItem.label}
                          </NavLink>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}

            {/* Disconnected pools — greyed out with reconnect hint */}
            {disconnectedPools.length > 0 && (
              isCollapsed ? (
                <>
                  {disconnectedPools.map((conn) => (
                    <div key={conn.id} className="flex justify-center"><ReconnectConnection connection={conn} compact /></div>
                  ))}
                </>
              ) : (
                <>
                <div className="pt-2 pb-1 px-2">
                  <span className="text-[11px] text-subtle">未连接</span>
                </div>
                {disconnectedPools.map((conn) => (
                  <div
                    key={conn.id}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm text-subtle"
                  >
                    <div
                      className={cn(
                        'w-2 h-2 rounded-full flex-shrink-0',
                        conn.state === 'error' ? 'bg-danger-soft' : 'bg-secondary',
                      )}
                    />
                    <span className="min-w-0 truncate flex-1" title={conn.errorMessage || conn.host}>{conn.name || conn.host}</span>
                    <ReconnectConnection connection={conn} compact />
                  </div>
                ))}
              </>
              )
            )}
          </div>
        )}
      </div>

      <NavLink to="/tasks" onClick={onNavigate} title="查看任务" aria-label="查看任务"
        className={cn('flex h-11 shrink-0 items-center gap-2 border-t border-border px-4 text-xs text-muted-foreground hover:bg-muted', isCollapsed && 'justify-center px-0')}>
        <ClipboardList className="h-4 w-4 shrink-0" />
        {!isCollapsed && <><span className="flex-1">{connectedPools.length} 个资源池已连接</span><span>{tasks.filter((task) => task.status === 'pending').length} 个任务</span></>}
      </NavLink>
      <RememberedServerDialog
        open={addDialogOpen}
        onClose={() => setAddDialogOpen(false)}
        onConnected={() => {
          const id = useConnectionManagerStore.getState().activeConnectionId
          if (id) {
            setActiveConnection(id)
            setExpandedPools((prev) => new Set(prev).add(id))
          }
        }}
      />
    </aside>
  )
}
