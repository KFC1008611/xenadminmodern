/**
 * HostDetailPage — detailed view for a single host, accessed via /hosts/:ref.
 * Uses Radix Tabs to switch between Overview, Monitor, Patches, and HA panels.
 * v7: New page — integrates HostMonitorTab for metrics monitoring.
 * v9: Added Patches tab and HA tab.
 */
import { useEffect, useState } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import * as Tabs from '@radix-ui/react-tabs'
import { ArrowLeft, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
import { useMultiDataStore } from '../store/multiData.store'
import { useConnectionManagerStore } from '../store/connectionManager.store'
import { feedback } from '../store/feedback.store'
import { HostMonitorTab } from '../components/host/HostMonitorTab'
import { HostMemorySummary } from '../components/host/HostMemorySummary'
import { HostPatchesTab } from '../components/patch/HostPatchesTab'
import { HaSettingsTab } from '../components/ha/HaSettingsTab'
import type { ConnectedHostRecord } from '../types/xapi'

export default function HostDetailPage() {
  const { ref: encodedRef, connectionId: pathConnectionId } = useParams<{ ref: string; connectionId: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  // feedback used directly

  const hosts = useMultiDataStore((s) => s.hosts)
  const refreshHosts = useMultiDataStore((s) => s.refreshHosts)
  const connections = useConnectionManagerStore((s) => s.connections)

  const [activeTab, setActiveTab] = useState('overview')

  const hostRef = encodedRef ? decodeURIComponent(encodedRef) : ''

  const connectedConnections = connections.filter((c) => c.state === 'connected')
  const searchConnectionId = searchParams.get('connectionId') || ''
  const legacyFallbackConnectionId = connectedConnections.length === 1 ? connectedConnections[0].id : ''
  const connectionId = pathConnectionId || searchConnectionId || legacyFallbackConnectionId
  const connectionResolutionError =
    !pathConnectionId && !searchConnectionId && connectedConnections.length > 1
      ? '旧链接缺少资源池连接，请从左侧资源池或主机列表重新进入'
      : ''
  const backPath = connectionId ? `/pool/${encodeURIComponent(connectionId)}/hosts` : '/hosts'

  // Find host from store
  const host: ConnectedHostRecord | undefined = hosts.find(
    (h) => h.ref === hostRef && h.connectionId === connectionId,
  )

  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!hostRef || !connectionId || connectionResolutionError) {
      setLoading(false)
      return
    }
    setLoading(true)
    refreshHosts()
      .then(() => {
        // After refresh, check if host exists
        // loading will be set to false in the effect below
      })
      .catch((e: any) => {
        feedback.error(`无法加载主机详情：${e?.message || String(e)}`)
      })
      .finally(() => setLoading(false))
  }, [hostRef, connectionId, connectionResolutionError])

  // Also set loading false once hosts are available
  useEffect(() => {
    if (hosts.length > 0 && loading) {
      setLoading(false)
    }
  }, [hosts])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="w-8 h-8 animate-spin text-accent-foreground" />
          <span className="text-sm">加载主机详情中...</span>
        </div>
      </div>
    )
  }

  if (!host) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-4 text-muted-foreground max-w-sm text-center">
          <AlertCircle className="w-10 h-10 text-danger" />
          <div>
            <p className="text-foreground font-medium mb-1">加载失败</p>
            <p className="text-sm text-muted-foreground">
              {connectionResolutionError || '未找到主机或连接已断开'}
            </p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => navigate(backPath)}
              className="px-4 py-2 text-sm bg-muted hover:bg-secondary text-foreground rounded-lg transition-colors"
            >
              返回列表
            </button>
            <button
              onClick={() => refreshHosts()}
              className="px-4 py-2 text-sm bg-primary hover:bg-primary-hover text-primary-foreground rounded-lg transition-colors"
            >
              重试
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Top toolbar */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => navigate(backPath)}
            className="flex-shrink-0 p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
            title="返回主机列表"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-xl font-semibold text-foreground truncate">
                {host.name_label}
              </h1>
              <span className="text-xs px-2 py-0.5 bg-muted text-muted-foreground rounded-md">
                {host.poolName}
              </span>
              {!host.enabled && (
                <span className="text-xs px-2 py-0.5 bg-warning-soft text-warning border border-warning/30 rounded-md">
                  已禁用
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-0.5 truncate">
              {host.address} &middot; {host.hostname}
            </p>
          </div>
        </div>
        <button
          onClick={() => refreshHosts()}
          className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground bg-card hover:bg-muted border border-border rounded-lg transition-colors"
          title="刷新"
        >
          <RefreshCw className="w-4 h-4" />
          刷新
        </button>
      </div>

      {/* Tabs */}
      <Tabs.Root value={activeTab} onValueChange={setActiveTab}>
        <div className="mb-6 overflow-x-auto border-b border-border">
          <Tabs.List className="flex min-w-max gap-1">
            {[
              { value: 'overview', label: '概览' },
              { value: 'monitor', label: '监控' },
              { value: 'patches', label: '补丁' },
              { value: 'ha', label: '高可用' },
            ].map((tab) => (
              <Tabs.Trigger
                key={tab.value}
                value={tab.value}
                className="
                  relative shrink-0 whitespace-nowrap px-4 py-2.5 text-sm font-medium text-muted-foreground
                  hover:text-foreground transition-colors
                  data-[state=active]:text-accent-foreground
                  outline-none focus-visible:ring-1 focus-visible:ring-primary rounded-t-lg
                  after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5
                  after:bg-primary after:scale-x-0 after:transition-transform
                  data-[state=active]:after:scale-x-100
                "
              >
                {tab.label}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
        </div>

        <Tabs.Content value="overview" className="outline-none">
          {/* Host overview */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-card border border-border rounded-xl p-4">
              <div className="text-xs text-muted-foreground mb-1">CPU</div>
              <div className="text-foreground font-medium">
                {host.cpu_info?.cpu_count || '—'} 逻辑处理器
              </div>
              {(host.cpu_info?.modelname || host.cpu_info?.model) && (
                <div title={host.cpu_info.modelname || host.cpu_info.model} className="text-xs text-subtle mt-1 truncate">{host.cpu_info.modelname || host.cpu_info.model}</div>
              )}
            </div>
            <div className="bg-card border border-border rounded-xl p-4">
              <div className="text-xs text-muted-foreground mb-1">内存容量</div>
              <HostMemorySummary host={host} />
            </div>
            <div className="bg-card border border-border rounded-xl p-4">
              <div className="text-xs text-muted-foreground mb-1">VM 数量</div>
              <div className="text-foreground font-medium">{host.resident_VMs?.length || 0}</div>
            </div>
            <div className="bg-card border border-border rounded-xl p-4">
              <div className="text-xs text-muted-foreground mb-1">XCP-ng 版本</div>
              <div className="text-foreground font-medium text-sm">
                {host.software_version?.product_version || '—'}
              </div>
            </div>
          </div>
          <dl className="mt-4 grid min-w-0 gap-x-6 gap-y-3 rounded-xl border border-border bg-card p-4 text-sm sm:grid-cols-2">
            {[
              ['主机名', host.hostname], ['管理地址', host.address], ['UUID', host.uuid],
              ['CPU 插槽', host.cpu_info?.socket_count], ['CPU 频率', host.cpu_info?.speed ? `${host.cpu_info.speed} MHz` : undefined],
              ['系统构建', host.software_version?.build_number],
            ].map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 break-all text-foreground">{value || '暂不可用'}</dd></div>)}
          </dl>
        </Tabs.Content>

        <Tabs.Content value="monitor" className="outline-none">
          <HostMonitorTab connectionId={connectionId} hostRef={hostRef} />
        </Tabs.Content>

        <Tabs.Content value="patches" className="outline-none">
          <HostPatchesTab connectionId={connectionId} hostRef={hostRef} hostName={host.name_label} />
        </Tabs.Content>

        <Tabs.Content value="ha" className="outline-none">
          <HaSettingsTab connectionId={connectionId} />
        </Tabs.Content>
      </Tabs.Root>
    </div>
  )
}
