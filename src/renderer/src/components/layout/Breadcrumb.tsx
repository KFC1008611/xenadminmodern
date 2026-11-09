/**
 * Breadcrumb — auto-generated navigation breadcrumb based on current route.
 *
 * Derives breadcrumb items from the URL path and displays them
 * with clickable links for easy back-navigation.
 *
 * Supports the new pool-scoped route structure:
 *   /pool/:connectionId/hosts/:ref
 *   /pool/:connectionId/vms/:ref
 */
import { NavLink, useLocation } from 'react-router-dom'
import { ChevronRight, Home } from 'lucide-react'
import { useMultiDataStore } from '../../store/multiData.store'
import { useConnectionManagerStore } from '../../store/connectionManager.store'

interface BreadcrumbItem {
  label: string
  path: string
}

/**
 * Route label mapping for breadcrumb generation.
 */
const ROUTE_LABELS: Record<string, string> = {
  dashboard: '仪表盘',
  settings: '设置',
  hosts: '主机',
  vms: '虚拟机',
  storage: '存储',
  networks: '网络',
  tasks: '任务',
  'batch-tasks': '批量任务',
  alerts: '告警',
  rbac: '用户与权限',
  'pool-manager': '资源池管理',
}

/**
 * Resolve a dynamic :ref segment to a human-readable name.
 * This is a pure function (no hooks) used inside the render path.
 */
function resolveRefLabel(segment: string, hosts: any[], vms: any[], connectionId: string | null): string {
  let decodedSegment = segment
  try {
    decodedSegment = decodeURIComponent(segment)
  } catch {
    decodedSegment = segment
  }

  const host = hosts.find((h: any) => h.ref === decodedSegment && (!connectionId || h.connectionId === connectionId))
  if (host) return host.name_label

  const vm = vms.find((v: any) => v.ref === decodedSegment && (!connectionId || v.connectionId === connectionId))
  if (vm) return vm.name_label

  if (decodedSegment.startsWith('OpaqueRef:')) {
    return decodedSegment.slice(0, 16) + '...'
  }

  return decodedSegment
}

/**
 * Resolve a connectionId to a pool name.
 */
function resolvePoolName(connectionId: string, connections: any[], pools: any[]): string {
  const conn = connections.find((c: any) => c.id === connectionId)
  if (conn?.poolName) return conn.poolName

  const pool = pools.find((p: any) => p.connectionId === connectionId)
  if (pool?.name_label) return pool.name_label

  return conn?.host || connectionId.slice(0, 8) + '…'
}

export default function Breadcrumb() {
  const location = useLocation()
  const pathname = location.pathname
  const hosts = useMultiDataStore((s) => s.hosts)
  const vms = useMultiDataStore((s) => s.vms)
  const pools = useMultiDataStore((s) => s.pools)
  const connections = useConnectionManagerStore((s) => s.connections)

  // Don't show breadcrumb on connect page
  if (pathname === '/' || pathname === '/connect') {
    return null
  }

  // On dashboard, show a simple "仪表盘" breadcrumb
  if (pathname === '/dashboard') {
    return (
      <nav className="flex items-center gap-1.5 text-xs min-w-0 overflow-hidden" aria-label="面包屑导航">
        <NavLink
          to="/dashboard"
          aria-label="仪表盘首页"
          className="text-subtle hover:text-secondary-foreground transition-colors flex-shrink-0"
        >
          <Home className="w-3.5 h-3.5" />
        </NavLink>
        <ChevronRight className="w-3 h-3 text-subtle flex-shrink-0" />
        <span className="text-secondary-foreground font-medium">仪表盘</span>
      </nav>
    )
  }

  const segments = pathname.split('/').filter(Boolean)
  const items: BreadcrumbItem[] = []

  let currentPath = ''

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]

    // Handle /pool/:connectionId — show pool name, skip the "pool" literal
    if (segment === 'pool') {
      const connectionId = segments[i + 1]
      if (connectionId) {
        currentPath += `/pool/${connectionId}`
        items.push({
          label: resolvePoolName(connectionId, connections, pools),
          path: `${currentPath}/hosts`,
        })
        i += 1
      }
      continue
    }

    currentPath += `/${segment}`

    // Check if this is a known route label
    const label = ROUTE_LABELS[segment]
    if (label) {
      items.push({ label, path: currentPath })
    } else {
      // This is a dynamic :ref segment — resolve to entity name
      // Try to extract connectionId from the path (/pool/:connectionId/...)
      const poolIndex = segments.indexOf('pool')
      const pathConnectionId = poolIndex >= 0 && poolIndex + 1 < segments.length
        ? segments[poolIndex + 1]
        : null

      const resolvedLabel = resolveRefLabel(segment, hosts, vms, pathConnectionId)
      items.push({
        label: resolvedLabel,
        path: currentPath,
      })
    }
  }

  if (items.length === 0) return null

  return (
    <nav className="flex items-center gap-1.5 text-xs min-w-0 overflow-hidden" aria-label="面包屑导航">
      <NavLink
        to="/dashboard"
        aria-label="仪表盘首页"
        className="text-subtle hover:text-secondary-foreground transition-colors flex-shrink-0"
      >
        <Home className="w-3.5 h-3.5" />
      </NavLink>
      {items.map((item, index) => {
        const isLast = index === items.length - 1
        return (
          <div key={`${index}-${item.path}`} className="flex items-center gap-1.5 min-w-0">
            <ChevronRight className="w-3 h-3 text-subtle flex-shrink-0" />
            {isLast ? (
              <span title={item.label} className="text-secondary-foreground font-medium truncate">{item.label}</span>
            ) : (
              <NavLink
                to={item.path}
                title={item.label}
                className="text-subtle hover:text-secondary-foreground transition-colors truncate"
              >
                {item.label}
              </NavLink>
            )}
          </div>
        )
      })}
    </nav>
  )
}
