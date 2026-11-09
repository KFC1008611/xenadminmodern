/**
 * HaSettingsTab - HA settings tab for the pool/host page.
 * Combines HA status, configuration, VM priorities, and emergency operations.
 * v9: New component for pool HA management, using Tailwind CSS.
 */
import { useState, useEffect } from 'react'
import * as Tabs from '@radix-ui/react-tabs'
import { Heart, ShieldCheck, AlertTriangle, Zap, Loader2 } from 'lucide-react'
import { useHaStore } from '../../store/ha.store'
import { HaStatusBadge } from './HaStatusBadge'
import { HaVmPriorityList } from './HaVmPriorityList'
import { getAuditedFeatureBlockReason } from '../../../../shared/audited-features'

interface HaSettingsTabProps {
  connectionId: string
}

export function HaSettingsTab({ connectionId }: HaSettingsTabProps) {
  const guardReason = getAuditedFeatureBlockReason('ha.governance')
  const {
    haConfig,
    haConfigLoading,
    haConfigError, vmConfigsError, computeResultError, failoverPlanError,
    vmConfigs,
    vmConfigsLoading,
    computeResult,
    computeResultLoading,
    failoverPlan,
    failoverPlanLoading,
    loadHaConfig,
    loadVmConfigs,
    computeHaTolerance,
    loadFailoverPlan,
  } = useHaStore()

  const [activeSubTab, setActiveSubTab] = useState('overview')

  // Load data on mount
  useEffect(() => {
    loadHaConfig(connectionId)
    loadVmConfigs(connectionId)
    computeHaTolerance(connectionId)
    loadFailoverPlan(connectionId)
  }, [connectionId])

  return (
    <div className="space-y-4">
      {[haConfigError, vmConfigsError, computeResultError, failoverPlanError].filter(Boolean).map((error, index) => <p key={index} role="alert" className="text-sm text-danger">{error}</p>)}
      {/* Header with status and config button */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-foreground flex items-center gap-2">
            <Heart className="w-4 h-4 text-danger" />
            高可用性 (HA)
          </h3>
        </div>
        <div className="flex items-center gap-3">
          <HaStatusBadge haConfig={haConfig} loading={haConfigLoading} />
          <button
            disabled
            title={guardReason}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary hover:bg-primary-hover text-primary-foreground rounded-lg transition-colors"
          >
            {haConfig?.enabled ? '配置 HA' : '启用 HA'}
          </button>
        </div>
      </div>

      <Tabs.Root value={activeSubTab} onValueChange={setActiveSubTab}>
        <div className="mb-4 overflow-x-auto border-b border-border">
          <Tabs.List className="flex min-w-max gap-1">
            {[
              { value: 'overview', label: '概览', icon: ShieldCheck },
              { value: 'vms', label: 'VM 优先级', icon: Heart },
              { value: 'plan', label: '故障转移', icon: AlertTriangle },
              { value: 'emergency', label: '紧急操作', icon: Zap },
            ].map((tab) => (
              <Tabs.Trigger
                key={tab.value}
                value={tab.value}
                className="relative flex shrink-0 items-center gap-1.5 whitespace-nowrap px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors data-[state=active]:text-accent-foreground outline-none focus-visible:ring-1 focus-visible:ring-primary rounded-t-lg after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-primary after:scale-x-0 after:transition-transform data-[state=active]:after:scale-x-100"
              >
                <tab.icon className="w-3.5 h-3.5" />
                {tab.label}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
        </div>

        {/* Overview tab */}
        <Tabs.Content value="overview" className="outline-none space-y-4">
          {/* HA configuration info */}
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-border">
              <h4 className="text-sm font-medium text-foreground">HA 配置</h4>
              <p className="text-xs text-subtle mt-0.5">
                {haConfig ? (haConfig.enabled ? 'HA 已启用' : 'HA 未启用') : 'HA 状态未知'}
              </p>
            </div>
            <div className="p-5 space-y-4">
              {haConfig ? (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs text-muted-foreground">状态</p>
                      <p className="text-sm font-medium text-foreground">
                        {haConfig.enabled ? '已启用' : '已禁用'}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">资源超量使用</p>
                      <p className="text-sm font-medium text-foreground">
                        {haConfig.allowOvercommit ? '已启用' : '已禁用'}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">心跳存储库</p>
                      <p className="text-sm font-medium text-foreground">{haConfig.heartbeatSRs.length}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">可容忍主机故障</p>
                      <p className="text-sm font-medium text-foreground">
                        {computeResultLoading ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin inline" />
                        ) : (
                          computeResult?.canHandleHostFailures ?? '—'
                        )}
                      </p>
                    </div>
                  </div>

                  {/* Host status */}
                  {haConfig.hosts && haConfig.hosts.length > 0 && (
                    <>
                      <div className="border-t border-border pt-4">
                        <p className="text-xs text-muted-foreground mb-2">主机状态</p>
                        <div className="flex gap-2 flex-wrap">
                          {haConfig.hosts.map((host) => (
                            <span
                              key={host.hostRef}
                              className={`text-xs px-2.5 py-1 rounded-md border font-medium ${
                                host.failed
                                  ? 'bg-danger-soft text-danger border-danger/30'
                                  : host.live
                                  ? 'bg-success-soft text-success border-success/30'
                                  : 'bg-muted text-muted-foreground border-input'
                              }`}
                            >
                              {host.hostName}
                              {host.failed ? ' (故障)' : host.live ? ' (正常)' : ' (未知)'}
                            </span>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </>
              ) : (
                <p className="text-sm text-subtle">{haConfigLoading ? '加载中...' : '无法读取 HA 配置'}</p>
              )}
            </div>
          </div>

          {/* HA restart controls */}
          {haConfig?.enabled && (
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-border">
                <h4 className="text-sm font-medium text-foreground">HA 重启控制</h4>
                <p className="text-xs text-subtle mt-0.5">临时控制 HA 自动重启行为</p>
              </div>
              <div className="p-5">
                <div className="flex gap-2">
                  <button
                    disabled
                    title={guardReason}
                    className="px-3 py-1.5 text-xs bg-muted hover:bg-secondary text-foreground rounded-lg transition-colors border border-input"
                  >
                    阻止重启 10 分钟
                  </button>
                  <button
                    disabled
                    title={guardReason}
                    className="px-3 py-1.5 text-xs bg-muted hover:bg-secondary text-foreground rounded-lg transition-colors border border-input"
                  >
                    阻止重启 1 小时
                  </button>
                  <button
                    disabled
                    title={guardReason}
                    className="px-3 py-1.5 text-xs bg-muted hover:bg-secondary text-foreground rounded-lg transition-colors border border-input"
                  >
                    恢复 HA 自动重启
                  </button>
                </div>
              </div>
            </div>
          )}
        </Tabs.Content>

        {/* VMs tab */}
        <Tabs.Content value="vms" className="outline-none">
          <HaVmPriorityList
            connectionId={connectionId}
            vms={vmConfigs}
            loading={vmConfigsLoading}
            onRefresh={() => {
              loadVmConfigs(connectionId)
              computeHaTolerance(connectionId)
            }}
          />
        </Tabs.Content>

        {/* Failover plan tab */}
        <Tabs.Content value="plan" className="outline-none space-y-4">
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-border">
              <h4 className="text-sm font-medium text-foreground">HA 重启策略摘要</h4>
              <p className="text-xs text-subtle mt-0.5">
                当前策略摘要，非指定故障场景的放置计划。可容忍 {failoverPlan?.canTolerateFailures ?? '—'} 台主机故障
              </p>
            </div>
            <div className="p-5">
              {failoverPlanLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-sm">计算中...</span>
                </div>
              ) : failoverPlan && failoverPlan.vmsByPriority.length > 0 ? (
                <div className="space-y-4">
                  {failoverPlan.vmsByPriority.map(({ priority, vms }) => (
                    <div key={priority}>
                      <p className="text-sm font-medium text-foreground mb-2">
                        {priority === 'restart' ? '按 HA 计划重启' : '尽力重启'} ({vms.length} 台 VM)
                      </p>
                      <div className="flex gap-2 flex-wrap">
                        {vms.map((vm) => (
                          <span
                            key={vm.vmRef}
                            className="text-xs px-2 py-1 bg-muted text-secondary-foreground border border-input rounded-md"
                          >
                            {vm.vmName}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-subtle">{failoverPlanError ? '无法读取 HA 策略' : '没有配置 HA 重启策略的 VM'}</p>
              )}
            </div>
          </div>
        </Tabs.Content>

        {/* Emergency tab */}
        <Tabs.Content value="emergency" className="outline-none space-y-4">
          <div className="bg-card border border-danger/20 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-border">
              <h4 className="text-sm font-medium text-foreground flex items-center gap-2">
                <Zap className="w-4 h-4 text-danger" />
                紧急操作
              </h4>
              <p className="text-xs text-subtle mt-0.5">
                这些操作仅在紧急情况下使用，请谨慎操作
              </p>
            </div>
            <div className="p-5 space-y-6">
              <div>
                <p className="text-sm font-medium text-foreground">紧急转换为主节点</p>
                <p className="text-xs text-subtle mt-1">
                  当池主节点发生故障且无法恢复时使用。当前主机将接管主节点角色。
                </p>
                <button
                  disabled
                  title={guardReason}
                  className="mt-3 px-3 py-1.5 text-xs bg-danger-solid hover:bg-danger-solid disabled:bg-secondary disabled:text-subtle disabled:cursor-not-allowed text-on-solid rounded-lg transition-colors"
                >
                  紧急转换
                </button>
              </div>

              <div className="border-t border-border pt-6">
                <p className="text-sm font-medium text-foreground">恢复失败的主机</p>
                <p className="text-xs text-subtle mt-1">
                  尝试重新连接并恢复池中失败的主机。
                </p>
                <button
                  disabled
                  title={guardReason}
                  className="mt-3 px-3 py-1.5 text-xs bg-muted hover:bg-secondary text-foreground rounded-lg transition-colors border border-input"
                >
                  恢复主机
                </button>
              </div>
            </div>
          </div>
        </Tabs.Content>
      </Tabs.Root>

    </div>
  )
}
