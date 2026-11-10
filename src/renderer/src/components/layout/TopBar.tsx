import { useRef, useState } from 'react'
import { useConnectionManagerStore } from '../../store/connectionManager.store'
import { useMultiDataStore } from '../../store/multiData.store'
import { Menu, RefreshCw } from 'lucide-react'
import { cn } from '../../lib/utils'
import { TaskCenter } from './TaskCenter'
import { feedback } from '../../store/feedback.store'
import Breadcrumb from './Breadcrumb'
import { ResourceNavigation } from './ResourceNavigation'

export default function TopBar({ onOpenSidebar }: { onOpenSidebar?: () => void }) {
  const connections = useConnectionManagerStore((s) => s.connections)
  const refreshAll = useMultiDataStore((s) => s.refreshAll)
  const pending = useRef(false)
  const [refreshing, setRefreshing] = useState(false)
  const handleRefresh = async () => {
    if (pending.current) return
    pending.current = true
    setRefreshing(true)
    try { await refreshAll() }
    catch (error) { feedback.error(error instanceof Error ? error.message : '刷新失败') }
    finally { pending.current = false; setRefreshing(false) }
  }

  return <header className="app-drag-region relative z-[45] flex h-11 shrink-0 items-center gap-3 border-b border-border bg-card px-4 lg:px-6">
    <button type="button" onClick={onOpenSidebar} aria-label="打开导航" className="app-no-drag inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted md:hidden"><Menu className="h-4 w-4" /></button>
    <div className="min-w-0 flex-1"><ResourceNavigation fallback={<div className="app-no-drag"><Breadcrumb /></div>} /></div>
    <div className="app-no-drag flex shrink-0 items-center gap-1">
      <button type="button" onClick={() => { void handleRefresh() }} aria-label="刷新资源" title="刷新资源" disabled={refreshing || !connections.some((c) => c.state === 'connected')}
        className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40">
        <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
      </button>
      <TaskCenter />
    </div>
  </header>
}
