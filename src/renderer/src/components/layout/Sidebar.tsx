import { useEffect, useId, useRef, useState } from 'react'
import { NavLink, useLocation, useMatch } from 'react-router-dom'
import { Bell, ChevronRight, Database, Layers, LogOut, Plus, PanelLeftClose, PanelLeftOpen, Server } from 'lucide-react'
import { cn } from '../../lib/utils'
import { useConnectionManagerStore } from '../../store/connectionManager.store'
import { useAlertStore } from '../../store/alert.store'
import { RememberedServerDialog } from '../connection/RememberedServerDialog'
import { ReconnectConnection } from '../connection/ReconnectConnection'
import { ResourceActionMenu } from './ResourceActionMenu'
import { SettingsLink } from './SettingsLink'
import { resourcePages } from './ResourceNavigation'
import { feedback } from '../../store/feedback.store'
import { useMultiDataStore } from '../../store/multiData.store'

interface SidebarProps {
  open?: boolean
  collapsed?: boolean
  onCollapsedChange?: (collapsed: boolean) => void
  onNavigate?: () => void
}

export default function Sidebar({ open = false, collapsed = false, onCollapsedChange, onNavigate }: SidebarProps) {
  const { pathname, search } = useLocation()
  const pool = useMatch('/pool/:connectionId/:section/*')
  const selectedHost = useMatch('/pool/:connectionId/hosts/:ref')
  const hosts = useMultiDataStore((s) => s.hosts)
  const hostReads = useMultiDataStore((s) => s.domainStates)
  const refreshHosts = useMultiDataStore((s) => s.refreshHosts)
  const connections = useConnectionManagerStore((s) => s.connections)
  const setActiveConnection = useConnectionManagerStore((s) => s.setActiveConnection)
  const disconnect = useConnectionManagerStore((s) => s.disconnect)
  const unreadCount = useAlertStore((s) => s.unreadCount)
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [disconnecting, setDisconnecting] = useState<string | null>(null)
  const [closedPools, setClosedPools] = useState<Record<string, boolean>>({})
  const treeId = useId()
  const disconnectPending = useRef(false)
  const isCollapsed = collapsed && !open
  const currentSection = pool?.params.section || pathname.split('/')[1]
  const section = resourcePages.some((page) => page.segment === currentSection) ? currentSection : 'vms'
  const poolSection = pool?.params.section === 'settings' ? 'settings' : section
  const connectionId = pool?.params.connectionId
  const hostTab = selectedHost ? new URLSearchParams(search).get('tab') : null

  useEffect(() => {
    if (selectedHost?.params.connectionId) {
      const id = selectedHost.params.connectionId
      setClosedPools((previous) => previous[id] ? { ...previous, [id]: false } : previous)
    }
  }, [selectedHost?.params.connectionId, selectedHost?.params.ref])

  useEffect(() => {
    if (connectionId && connections.some((connection) => connection.id === connectionId && connection.state === 'connected')) setActiveConnection(connectionId)
  }, [connectionId, connections, setActiveConnection])

  const handleDisconnect = async (id: string) => {
    if (disconnectPending.current) return
    disconnectPending.current = true
    setDisconnecting(id)
    try { await disconnect(id) }
    catch (error) { feedback.error(error instanceof Error ? error.message : '断开失败') }
    finally { disconnectPending.current = false; setDisconnecting(null) }
  }
  const linkClass = (active: boolean) => cn('relative flex min-w-0 items-center rounded-md text-[13px] transition-colors',
    isCollapsed ? 'h-9 justify-center px-0' : 'gap-2.5 px-3 py-2',
    active ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground')

  return <aside className={cn(
    'fixed bottom-0 left-0 top-[var(--window-top-offset)] z-40 flex w-72 shrink-0 max-w-[calc(100vw-3rem)] flex-col overflow-hidden border-r border-border bg-sidebar transition-[transform,width] duration-200 md:relative md:bottom-auto md:top-auto md:z-auto md:max-w-none md:translate-x-0',
    isCollapsed ? 'md:w-16' : 'md:w-[232px]', open ? 'translate-x-0' : '-translate-x-full',
  )}>
    <div className={cn('flex h-11 shrink-0 items-center', isCollapsed ? 'justify-center px-2' : 'justify-end px-4')}>
      <button type="button" aria-label={isCollapsed ? '展开侧边栏' : '收起侧边栏'} title={isCollapsed ? '展开侧边栏' : '收起侧边栏'}
        className="app-no-drag hidden h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground md:inline-flex"
        onClick={() => onCollapsedChange?.(!isCollapsed)}>
        {isCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
      </button>
    </div>
    <nav aria-label="资源范围" className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
      <NavLink to={`/${section}`} aria-label="全部资源" title={isCollapsed ? '全部资源' : undefined} onClick={onNavigate}
        className={linkClass(!pool && resourcePages.some((page) => pathname === `/${page.segment}`))}>
        <Layers className="h-4 w-4 shrink-0" />{!isCollapsed && '全部资源'}
      </NavLink>
      <ul className="space-y-1 pt-3">
        {connections.map((connection) => {
          const name = connection.poolName || connection.name || connection.host
          const connected = connection.state === 'connected'
          const expanded = !closedPools[connection.id]
          const poolHosts = hosts.filter((host) => host.connectionId === connection.id)
          const read = hostReads[connection.id]?.hosts
          const groupId = `${treeId}-${encodeURIComponent(connection.id)}`
          return <li key={connection.id}>
          <div className={cn('flex min-w-0 items-center gap-1', isCollapsed && 'flex-col')}>
            {!isCollapsed && <button type="button" aria-label={`${expanded ? '收起' : '展开'}资源池 ${name}`} aria-expanded={expanded} aria-controls={groupId}
              onClick={() => setClosedPools((previous) => ({ ...previous, [connection.id]: expanded }))}
              className="flex h-8 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted">
              <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-90')} />
            </button>}
            <NavLink end to={`/pool/${encodeURIComponent(connection.id)}/${poolSection}`} aria-label={`资源池 ${name}`} title={name} onClick={onNavigate}
              className={cn(linkClass(connectionId === connection.id && !selectedHost), isCollapsed ? 'w-full' : 'flex-1 !gap-2 !px-2')}>
              <Database className="h-4 w-4 shrink-0" />
              {!isCollapsed && <span className="min-w-0 flex-1 truncate">{name}</span>}
              {!connected && <span className="text-warning">{!isCollapsed ? '未连接' : <span aria-label="未连接">·</span>}</span>}
            </NavLink>
            {connected ? <ResourceActionMenu name={name} disabled={disconnecting !== null} actions={[{
              label: disconnecting === connection.id ? '正在断开…' : '断开连接', icon: LogOut,
              onSelect: () => { void handleDisconnect(connection.id) },
            }]} /> : <ReconnectConnection connection={connection} compact />}
          </div>
          {!isCollapsed && <ul id={groupId} hidden={!expanded} className="ml-6 space-y-0.5 border-l border-border pl-2">
            {poolHosts.map((host) => <li key={host.ref}>
              <NavLink end to={`/pool/${encodeURIComponent(connection.id)}/hosts/${encodeURIComponent(host.ref)}${hostTab ? `?tab=${encodeURIComponent(hostTab)}` : ''}`}
                aria-label={`主机 ${host.name_label}`} title={`${host.name_label} · ${host.address || ''}`} onClick={onNavigate}
                className={cn(linkClass(selectedHost?.params.connectionId === connection.id && selectedHost.params.ref === host.ref), '!gap-2 !px-2')}>
                <Server className="h-3.5 w-3.5 shrink-0" /><span className="min-w-0 truncate">{host.name_label}</span>
              </NavLink>
            </li>)}
            {read?.loading && !read.lastSuccessAt && <li role="status" className="px-2 py-2 text-xs text-muted-foreground">正在读取主机…</li>}
            {read?.error && <li role="alert" className="break-words px-2 py-2 text-xs text-warning">
              {read.error}
              {connected && <button type="button" disabled={read.loading} onClick={() => void refreshHosts({ connectionId: connection.id })} className="ml-2 underline disabled:opacity-50">重新读取主机</button>}
            </li>}
          </ul>}
          </li>
        })}
      </ul>
      <button type="button" aria-label="添加连接" title={isCollapsed ? '添加连接' : undefined} onClick={() => setAddDialogOpen(true)} className={cn(linkClass(false), 'w-full')}>
        <Plus className="h-4 w-4 shrink-0" />{!isCollapsed && '添加连接'}
      </button>
    </nav>
    <div className="shrink-0 space-y-1 border-t border-border p-2">
      <NavLink to="/alerts" aria-label={unreadCount ? `告警，${unreadCount} 条` : '告警'} title="告警" onClick={onNavigate} className={({ isActive }) => linkClass(isActive)}>
        <Bell className="h-4 w-4 shrink-0" />{!isCollapsed && <span className="flex-1">告警</span>}
        {unreadCount > 0 && <span className={cn('text-xs tabular-nums text-warning', isCollapsed && 'absolute right-0 top-0')}>{unreadCount > 99 ? '99+' : unreadCount}</span>}
      </NavLink>
      <SettingsLink compact={isCollapsed} onNavigate={onNavigate} />
    </div>
    <RememberedServerDialog open={addDialogOpen} onClose={() => setAddDialogOpen(false)} />
  </aside>
}
