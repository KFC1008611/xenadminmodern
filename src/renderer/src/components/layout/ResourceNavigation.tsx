import type { ReactNode } from 'react'
import { NavLink, useMatch } from 'react-router-dom'
import { cn } from '../../lib/utils'
import { useConnectionManagerStore } from '../../store/connectionManager.store'

export const resourcePages = [
  { segment: 'vms', label: '虚拟机' },
  { segment: 'hosts', label: '主机' },
  { segment: 'storage', label: '存储' },
  { segment: 'networks', label: '网络' },
]

export function ResourceNavigation({ fallback = null }: { fallback?: ReactNode }) {
  const pool = useMatch('/pool/:connectionId/:section')
  const global = useMatch('/:section')
  const connections = useConnectionManagerStore((state) => state.connections)
  const section = pool?.params.section || global?.params.section
  if (!resourcePages.some((page) => page.segment === section) && !(pool && section === 'settings')) return fallback
  const base = pool ? `/pool/${encodeURIComponent(pool.params.connectionId!)}` : ''
  const connection = connections.find((item) => item.id === pool?.params.connectionId)
  const scope = pool ? connection?.poolName || connection?.name || connection?.host || pool.params.connectionId : '全部资源'

  return (
    <nav aria-label="资源类型" className="app-no-drag flex h-11 min-w-0 items-center gap-4 overflow-x-auto">
      <span title={scope} className="min-w-0 max-w-32 shrink truncate text-xs text-muted-foreground lg:max-w-48">{scope}</span>
      {resourcePages.map((page) => (
        <NavLink
          key={page.segment}
          to={`${base}/${page.segment}`}
          className={({ isActive }) => cn('flex h-full shrink-0 items-center border-b-2 px-1 text-[13px] transition-colors',
            isActive ? 'border-primary text-accent-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}
        >
          {page.label}
        </NavLink>
      ))}
      {pool && (
        <NavLink
          to={`${base}/settings`}
          className={({ isActive }) => cn('ml-auto flex h-full shrink-0 items-center border-b-2 px-1 text-[13px] transition-colors',
            isActive ? 'border-primary text-accent-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}
        >
          池设置
        </NavLink>
      )}
    </nav>
  )
}
