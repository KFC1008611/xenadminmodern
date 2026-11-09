/**
 * TopBar — minimal top bar with refresh and disconnect controls.
 *
 * Connection management is handled by the Sidebar pool tree.
 * Disconnect follows the visible pool route; global pages use the active connection.
 */
import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useConnectionManagerStore } from '../../store/connectionManager.store'
import { useMultiDataStore } from '../../store/multiData.store'
import { Menu, RefreshCw, LogOut } from 'lucide-react'
import { cn } from '../../lib/utils'
import { TaskCenter } from './TaskCenter'
import { feedback } from '../../store/feedback.store'
import Breadcrumb from './Breadcrumb'
import { SettingsLink } from './SettingsLink'
import { AppearanceMenu } from './AppearanceMenu'

interface TopBarProps {
  onOpenSidebar?: () => void
}

export default function TopBar({ onOpenSidebar }: TopBarProps) {
  const {
    disconnect,
    activeConnectionId,
    connections,
  } = useConnectionManagerStore()
  const refreshAll = useMultiDataStore((s) => s.refreshAll)
  const [refreshing, setRefreshing] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const { pathname } = useLocation()
  const routeConnectionId = pathname.match(/^\/pool\/([^/]+)/)?.[1]
  const targetId = routeConnectionId ? decodeURIComponent(routeConnectionId) : activeConnectionId
  const target = connections.find((connection) => connection.id === targetId)
  const targetName = target?.poolName || target?.name || target?.host

  const hasAnyConnected = connections.some((c) => c.state === 'connected')

  const handleRefresh = async () => {
    setRefreshing(true)
    try { await refreshAll() } catch (error: any) { feedback.error(error?.message || '刷新失败') }
    finally { setRefreshing(false) }
  }

  const handleDisconnect = async () => {
    if (!targetId || disconnecting) return
    setDisconnecting(true)
    try { await disconnect(targetId) } catch (error: any) { feedback.error(error?.message || '断开失败') }
    finally { setDisconnecting(false) }
  }

  return (
    <header className="app-drag-region relative z-[45] flex h-14 shrink-0 items-center gap-3 border-b border-border bg-card px-3 sm:px-4 lg:px-6">
      <button
        type="button"
        onClick={onOpenSidebar}
        className="app-no-drag inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:hidden"
        aria-label="打开导航"
      >
        <Menu className="h-4 w-4" />
      </button>
      <div className="app-no-drag min-w-0 flex-1">
        <Breadcrumb />
        <p className="min-w-0 truncate text-[11px] text-subtle" title={targetName}>
          {!routeConnectionId && <>活动资源池：{targetName || '未选择'}</>}
          {target && <span className={routeConnectionId ? undefined : 'ml-2'}>{target.state === 'connected' ? '已连接' : '未连接'}</span>}
        </p>
      </div>
      <div className="app-no-drag flex shrink-0 items-center gap-1.5">
        <TaskCenter />
        <button
          onClick={handleRefresh}
          disabled={!hasAnyConnected || refreshing}
          className="flex items-center gap-1.5 rounded-lg border border-transparent px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:border-input hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 sm:px-3"
        >
          <RefreshCw className={cn('w-3.5 h-3.5', refreshing && 'animate-spin')} />
          <span className="hidden sm:inline">刷新</span>
        </button>
        <button
          onClick={handleDisconnect}
          disabled={target?.state !== 'connected' || disconnecting}
          aria-label={`断开资源池 ${targetName || ''}`}
          title={`断开资源池 ${targetName || ''}`}
          className="flex items-center gap-1.5 rounded-lg border border-transparent px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:border-input hover:bg-muted hover:text-danger disabled:cursor-not-allowed disabled:opacity-40 sm:px-3"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">断开</span>
        </button>
        <span className="mx-1 h-4 border-l border-border" aria-hidden="true" />
        <SettingsLink />
        <AppearanceMenu />
      </div>
    </header>
  )
}
