import { useLocation } from 'react-router-dom'
import { useMultiDataStore, type ResourceDomain } from '../../store/multiData.store'
import { useConnectionManagerStore } from '../../store/connectionManager.store'
import { ReconnectConnection } from '../connection/ReconnectConnection'

const labels: Record<ResourceDomain, string> = { vms: '虚拟机', hosts: '主机', srs: '存储仓库', networks: '网络', tasks: '资源池任务', pools: '资源池' }
const routeDomains: Record<string, ResourceDomain[]> = { vms: ['vms'], hosts: ['hosts'], storage: ['srs'], networks: ['networks'], tasks: ['tasks'], dashboard: ['vms', 'hosts', 'srs', 'networks', 'tasks', 'pools'], 'pool-manager': ['hosts', 'pools'] }

export function ResourceReadBanner() {
  const { pathname } = useLocation()
  const states = useMultiDataStore((state) => state.domainStates)
  const refreshConnection = useMultiDataStore((state) => state.refreshConnection)
  const connections = useConnectionManagerStore((state) => state.connections)
  const segments = pathname.split('/').filter(Boolean)
  const poolId = segments[0] === 'pool' ? decodeURIComponent(segments[1] || '') : null
  const domains = routeDomains[poolId ? segments[2] : segments[0]] || []
  const selected = poolId ? connections.filter((item) => item.id === poolId) : connections
  const issues = selected.flatMap((connection) => {
    const name = connection.poolName || connection.name || connection.host
    if (connection.state !== 'connected') return [{ key: connection.id, id: connection.id, message: `${name}：管理连接未连接，暂时无法操作此资源池`, error: true, loading: false, lastSuccessAt: null }]
    return domains.flatMap((domain) => {
      const status = states[connection.id]?.[domain]
      if (!status?.error && (!status?.loading || status.lastSuccessAt !== null)) return []
      return [{ key: `${connection.id}-${domain}`, id: connection.id, message: `${name} · ${labels[domain]}：${status.error || '正在读取'}`, error: !!status.error, loading: status.loading, lastSuccessAt: status.lastSuccessAt }]
    })
  })
  if (domains.length === 0 || issues.length === 0) return null
  const failures = issues.filter((issue) => issue.error).length
  return <div className="mb-4 h-10 min-w-0" aria-label="资源读取状态">
    <details className="relative z-20 rounded-lg border border-border bg-card text-sm text-secondary-foreground">
      <summary className={`h-10 cursor-pointer truncate px-3 py-2 ${failures ? 'text-warning' : ''}`} aria-live="polite">
        {failures ? `${failures} 项资源读取异常` : '正在读取资源…'}
      </summary>
      {issues.length > 0 && <div className="absolute left-0 right-0 top-full mt-1 max-h-64 space-y-2 overflow-y-auto rounded-lg border border-input bg-background p-2 shadow-xl">{issues.map((issue) => <div key={issue.key} role={issue.error ? 'alert' : 'status'} className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm ${issue.error ? 'border-warning/30 bg-warning-soft text-warning' : 'border-input bg-card text-secondary-foreground'}`}>
    <div className="min-w-0 flex-1 break-words"><p>{issue.message}</p>{issue.lastSuccessAt && <p className="mt-1 text-xs opacity-80">最近成功读取：{new Date(issue.lastSuccessAt).toLocaleString()}。{issue.error && '当前显示上次成功读取的数据。'}</p>}</div>
    {issue.error && connections.some((connection) => connection.id === issue.id && connection.state === 'connected') && <button type="button" disabled={issue.loading} onClick={() => void refreshConnection(issue.id)} className="shrink-0 rounded border border-current px-2 py-1 disabled:opacity-50">{issue.loading ? '读取中…' : '重新读取'}</button>}
    {connections.filter((connection) => connection.id === issue.id && connection.state !== 'connected').map((connection) => <ReconnectConnection key={connection.id} connection={connection} />)}
      </div>)}</div>}
    </details>
  </div>
}
