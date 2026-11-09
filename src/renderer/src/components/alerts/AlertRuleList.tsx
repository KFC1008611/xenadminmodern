/**
 * AlertRuleList — alert rule management list with search, toggle, edit, delete.
 * v7: New component for alert rule CRUD display.
 */
import { useEffect, useState, useMemo } from 'react'
import {
  Plus,
  Search,
  Trash2,
  Edit2,
  AlertTriangle,
  AlertCircle,
  Server,
  Monitor,
  Zap,
  Clock,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import { useAlertRuleStore } from '../../store/alertRule.store'
import { AlertRuleDialog } from './AlertRuleDialog'
import type { AlertRule, MetricType, AlertOperator, AlertSeverity } from '../../types/xapi'

/** Chinese labels for metric types. */
const metricTypeLabels: Record<MetricType, string> = {
  cpu: 'CPU 利用率',
  memory: '内存利用率',
  networkRx: '网络接收',
  networkTx: '网络发送',
  diskRead: '磁盘读取',
  diskWrite: '磁盘写入',
}

/** Chinese labels for operators. */
const operatorLabels: Record<AlertOperator, string> = {
  '>': '>',
  '<': '<',
  '>=': '>=',
  '<=': '<=',
}

/** Format threshold based on metric type. */
function formatThreshold(metricType: MetricType, threshold: number): string {
  if (['cpu', 'memory'].includes(metricType)) {
    return `${threshold}%`
  }
  if (threshold === 0) return '0 B/s'
  const k = 1024
  const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s']
  const i = Math.floor(Math.log(threshold) / Math.log(k))
  return `${(threshold / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

/** Severity badge configuration. */
const severityConfig: Record<
  AlertSeverity,
  { badge: string; icon: typeof AlertTriangle; label: string }
> = {
  warning: {
    badge: 'bg-warning-soft text-warning border-warning/30',
    icon: AlertTriangle,
    label: '警告',
  },
  error: {
    badge: 'bg-danger-soft text-danger border-danger/30',
    icon: AlertCircle,
    label: '严重',
  },
}

export function AlertRuleList() {
  const {
    rules,
    loading,
    error,
    loadRules,
    deleteRule,
    updateRule,
    createDialogOpen,
    editDialogOpen,
    editingRule,
    openCreateDialog,
    closeCreateDialog,
    openEditDialog,
    closeEditDialog,
    confirmDelete,
    cancelDelete,
    deleteConfirmId,
  } = useAlertRuleStore()

  const [searchQuery, setSearchQuery] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  useEffect(() => {
    loadRules()
  }, [])

  // Filter rules by search query
  const filteredRules = useMemo(() => {
    if (!searchQuery.trim()) return rules
    const q = searchQuery.toLowerCase()
    return rules.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        metricTypeLabels[r.metricType].toLowerCase().includes(q),
    )
  }, [rules, searchQuery])

  const handleToggleEnabled = async (rule: AlertRule) => {
    await updateRule(rule.id, { enabled: !rule.enabled })
  }

  const handleDelete = async (id: string) => {
    await deleteRule(id)
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-subtle" />
          <input
            type="text"
            placeholder="搜索规则..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-muted border border-input rounded-lg text-sm text-foreground placeholder-subtle focus:outline-none focus:border-primary/30 transition-colors"
          />
        </div>
        <button
          onClick={openCreateDialog}
          className="flex items-center gap-1.5 px-4 py-2 bg-primary hover:bg-primary text-primary-foreground text-sm rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          创建规则
        </button>
      </div>

      {/* Error message */}
      {error && (
        <div className="bg-danger-soft border border-danger/30 rounded-lg p-3 text-sm text-danger">
          {error}
        </div>
      )}

      {/* Loading state */}
      {loading && rules.length === 0 ? (
        <div className="text-center py-12 text-subtle">
          <Zap className="w-6 h-6 mx-auto mb-2 animate-pulse" />
          <p className="text-sm">加载规则中...</p>
        </div>
      ) : filteredRules.length === 0 ? (
        /* Empty state */
        <div className="text-center py-12">
          <Zap className="w-8 h-8 mx-auto mb-3 text-subtle" />
          <p className="text-sm text-subtle mb-2">
            {searchQuery ? '没有匹配的规则' : '暂无告警规则，点击创建'}
          </p>
          {!searchQuery && (
            <button
              onClick={openCreateDialog}
              className="text-xs text-accent-foreground hover:text-accent-foreground transition-colors"
            >
              创建第一条规则
            </button>
          )}
        </div>
      ) : (
        /* Rule list */
        <div className="divide-y divide-border border border-border rounded-xl overflow-hidden">
          {filteredRules.map((rule) => {
            const sevConfig = severityConfig[rule.severity]
            const SevIcon = sevConfig.icon
            const isExpanded = expandedId === rule.id

            return (
              <div key={rule.id} className="bg-card">
                {/* Main row */}
                <div className="px-4 py-3 flex items-center gap-4">
                  {/* Enabled toggle */}
                  <button
                    onClick={() => handleToggleEnabled(rule)}
                    className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${
                      rule.enabled ? 'bg-primary' : 'bg-secondary'
                    }`}
                    title={rule.enabled ? '已启用' : '已禁用'}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
                        rule.enabled ? 'translate-x-4' : 'translate-x-0'
                      }`}
                    />
                  </button>

                  {/* Severity badge */}
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full border flex-shrink-0 ${sevConfig.badge}`}
                  >
                    <SevIcon className="w-3 h-3" />
                    {sevConfig.label}
                  </span>

                  {/* Rule info */}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-foreground truncate">{rule.name}</div>
                    <div className="text-xs text-subtle mt-0.5 flex items-center gap-3">
                      <span>{metricTypeLabels[rule.metricType]}</span>
                      <span className="text-subtle">|</span>
                      <span>
                        {operatorLabels[rule.operator]}{' '}
                        {formatThreshold(rule.metricType, rule.threshold)}
                      </span>
                      <span className="text-subtle">|</span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        持续 {rule.duration} 分钟
                      </span>
                    </div>
                  </div>

                  {/* Target scope */}
                  <div className="text-xs text-subtle flex-shrink-0">
                    {rule.targetType && rule.targetRef ? (
                      <span className="flex items-center gap-1">
                        {rule.targetType === 'host' ? (
                          <Server className="w-3 h-3" />
                        ) : (
                          <Monitor className="w-3 h-3" />
                        )}
                        特定{rule.targetType === 'host' ? '主机' : 'VM'}
                      </span>
                    ) : (
                      <span className="text-subtle">全局</span>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : rule.id)}
                      className="p-1.5 text-subtle hover:text-secondary-foreground hover:bg-muted rounded-lg transition-colors"
                      title={isExpanded ? '收起' : '展开'}
                    >
                      {isExpanded ? (
                        <ChevronUp className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5" />
                      )}
                    </button>
                    <button
                      onClick={() => openEditDialog(rule)}
                      className="p-1.5 text-subtle hover:text-accent-foreground hover:bg-accent rounded-lg transition-colors"
                      title="编辑"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => confirmDelete(rule.id)}
                      className="p-1.5 text-subtle hover:text-danger hover:bg-danger-soft rounded-lg transition-colors"
                      title="删除"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="px-4 pb-3 ml-[52px]">
                    <div className="bg-muted rounded-lg p-3 space-y-1.5 text-xs text-muted-foreground">
                      <div>创建时间: {new Date(rule.createdAt).toLocaleString()}</div>
                      <div>更新时间: {new Date(rule.updatedAt).toLocaleString()}</div>
                      <div>ID: {rule.id}</div>
                    </div>
                  </div>
                )}

                {/* Delete confirmation */}
                {deleteConfirmId === rule.id && (
                  <div className="px-4 pb-3 ml-[52px]">
                    <div className="bg-danger-soft border border-danger/30 rounded-lg p-3 flex items-center justify-between">
                      <span className="text-xs text-danger">确定删除此规则？</span>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleDelete(rule.id)}
                          className="px-3 py-1 text-xs bg-danger-solid hover:bg-danger-solid text-on-solid rounded-lg transition-colors"
                        >
                          确认删除
                        </button>
                        <button
                          onClick={cancelDelete}
                          className="px-3 py-1 text-xs text-muted-foreground hover:text-foreground rounded-lg transition-colors"
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Create Dialog */}
      {createDialogOpen && <AlertRuleDialog open={createDialogOpen} onClose={closeCreateDialog} />}

      {/* Edit Dialog */}
      {editDialogOpen && editingRule && (
        <AlertRuleDialog open={editDialogOpen} onClose={closeEditDialog} editingRule={editingRule} />
      )}
    </div>
  )
}

export default AlertRuleList
