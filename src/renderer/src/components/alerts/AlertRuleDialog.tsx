import { DesktopDialog } from '../layout/DesktopDialog'
/**
 * AlertRuleDialog — create/edit dialog for alert rules.
 * v7: New component for alert rule CRUD form.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { X, AlertTriangle, AlertCircle } from 'lucide-react'
import { useConnectionManagerStore } from '../../store/connectionManager.store'
import { useAlertRuleStore } from '../../store/alertRule.store'
import type { AlertRule, AlertRuleInput, MetricType, AlertOperator, AlertSeverity } from '../../types/xapi'

interface AlertRuleDialogProps {
  open: boolean
  onClose: () => void
  editingRule?: AlertRule
}

/** Metric type options with Chinese labels. */
const metricTypeOptions: { value: MetricType; label: string }[] = [
  { value: 'cpu', label: 'CPU 利用率' },
  { value: 'memory', label: '内存利用率' },
  { value: 'networkRx', label: '网络接收' },
  { value: 'networkTx', label: '网络发送' },
  { value: 'diskRead', label: '磁盘读取' },
  { value: 'diskWrite', label: '磁盘写入' },
]

/** Operator options. */
const operatorOptions: { value: AlertOperator; label: string }[] = [
  { value: '>', label: '大于 (>)' },
  { value: '>=', label: '大于等于 (>=)' },
  { value: '<', label: '小于 (<)' },
  { value: '<=', label: '小于等于 (<=)' },
]

/** Default threshold by metric type (percentage for cpu/memory, bytes/s for network/disk). */
function getDefaultThreshold(metricType: MetricType): number {
  if (metricType === 'cpu' || metricType === 'memory') return 80
  return 10485760 // 10 MB/s
}

/** Get threshold unit label. */
function getThresholdUnit(metricType: MetricType): string {
  if (metricType === 'cpu' || metricType === 'memory') return '%'
  return 'B/s'
}

export function AlertRuleDialog({ open, onClose, editingRule }: AlertRuleDialogProps) {
  const { createRule, updateRule } = useAlertRuleStore()
  const isEdit = !!editingRule
  const activeConnectionId = useConnectionManagerStore((state) => state.activeConnectionId)

  // Form state
  const [name, setName] = useState('')
  const [metricType, setMetricType] = useState<MetricType>('cpu')
  const [operator, setOperator] = useState<AlertOperator>('>')
  const [threshold, setThreshold] = useState(80)
  const [duration, setDuration] = useState(5)
  const [severity, setSeverity] = useState<AlertSeverity>('warning')
  const [enabled, setEnabled] = useState(true)
  const [targetType, setTargetType] = useState<'host' | 'vm' | ''>('')
  const [targetRef, setTargetRef] = useState('')

  // UI state
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(false)

  // Pre-fill form when editing
  useEffect(() => {
    if (editingRule) {
      setName(editingRule.name)
      setMetricType(editingRule.metricType)
      setOperator(editingRule.operator)
      setThreshold(editingRule.threshold)
      setDuration(editingRule.duration)
      setSeverity(editingRule.severity)
      setEnabled(editingRule.enabled)
      setTargetType(editingRule.targetType || '')
      setTargetRef(editingRule.targetRef || '')
    } else {
      // Reset for create mode
      setName('')
      setMetricType('cpu')
      setOperator('>')
      setThreshold(80)
      setDuration(5)
      setSeverity('warning')
      setEnabled(true)
      setTargetType('')
      setTargetRef('')
    }
    setError(null)
  }, [editingRule, open])

  // Update threshold when metric type changes (only in create mode)
  const handleMetricTypeChange = useCallback(
    (value: MetricType) => {
      setMetricType(value)
      if (!isEdit) {
        setThreshold(getDefaultThreshold(value))
      }
    },
    [isEdit],
  )


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (inFlight.current) return
    setError(null)

    // Validation
    if (!name.trim()) {
      setError('规则名称不能为空')
      return
    }
    if (!Number.isInteger(duration) || duration < 1 || duration > 1440) {
      setError('持续时间必须为 1–1440 分钟的整数')
      return
    }
    if (!Number.isFinite(threshold) || threshold < 0 || ((metricType === 'cpu' || metricType === 'memory') && threshold > 100)) {
      setError(metricType === 'cpu' || metricType === 'memory' ? '阈值必须在 0–100% 之间' : '阈值必须为非负数')
      return
    }
    if (targetType && !(editingRule?.connectionId || activeConnectionId)) {
      setError('请先选择该目标所属的活动资源池')
      return
    }
    if (targetType && !targetRef.trim()) {
      setError('指定目标类型时必须填写目标引用')
      return
    }

    const input: AlertRuleInput = {
      name: name.trim(),
      metricType,
      operator,
      threshold,
      duration,
      severity,
      enabled,
      connectionId: targetType ? (editingRule?.connectionId || activeConnectionId || undefined) : undefined,
      targetType: targetType || undefined, targetRef: targetType ? targetRef.trim() : undefined,
    }

    inFlight.current = true
    setSubmitting(true)
    try {
      if (isEdit && editingRule) {
        await updateRule(editingRule.id, input)
      } else {
        await createRule(input)
      }
      onClose()
    } catch (err: any) {
      setError(err?.message || '操作失败，请重试')
    } finally {
      inFlight.current = false
      setSubmitting(false)
    }
  }

  if (!open) return null

  return (
    <DesktopDialog title="告警规则" onClose={onClose} busy={submitting} className="max-w-[520px]">
      <div className="w-full max-w-[520px] overflow-y-auto rounded-xl border border-input bg-card shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 bg-card border-b border-border px-6 py-4 flex items-center justify-between z-10">
          <h2 className="text-base font-semibold text-foreground">
            {isEdit ? '编辑告警规则' : '创建告警规则'}
          </h2>
          <button
            onClick={onClose}
            disabled={submitting}
            aria-label="关闭"
            className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Error message */}
          {error && (
            <div role="alert" className="bg-danger-soft border border-danger/30 rounded-lg p-3 text-sm text-danger">
              {error}
            </div>
          )}

          <fieldset disabled={submitting} className="min-w-0 space-y-5">
          {/* Rule name */}
          <div>
            <label className="block text-sm text-muted-foreground mb-1.5">
              规则名称 <span className="text-danger">*</span>
            </label>
            <input
              type="text"
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如: CPU 过载告警"
              className="w-full px-3 py-2 bg-muted border border-input rounded-lg text-sm text-foreground placeholder-subtle focus:outline-none focus:border-primary/30 transition-colors"
            />
          </div>

          {/* Metric type + Operator row */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-muted-foreground mb-1.5">监控指标</label>
              <select
                value={metricType}
                onChange={(e) => handleMetricTypeChange(e.target.value as MetricType)}
                className="w-full px-3 py-2 bg-muted border border-input rounded-lg text-sm text-foreground focus:outline-none focus:border-primary/30 transition-colors appearance-none"
              >
                {metricTypeOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-muted-foreground mb-1.5">运算符</label>
              <select
                value={operator}
                onChange={(e) => setOperator(e.target.value as AlertOperator)}
                className="w-full px-3 py-2 bg-muted border border-input rounded-lg text-sm text-foreground focus:outline-none focus:border-primary/30 transition-colors appearance-none"
              >
                {operatorOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Threshold + Duration row */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-muted-foreground mb-1.5">
                阈值 ({getThresholdUnit(metricType)})
              </label>
              <input
                type="number"
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
                min={0}
                max={metricType === 'cpu' || metricType === 'memory' ? 100 : undefined}
                step="any"
                required
                className="w-full px-3 py-2 bg-muted border border-input rounded-lg text-sm text-foreground focus:outline-none focus:border-primary/30 transition-colors"
              />
            </div>
            <div>
              <label className="block text-sm text-muted-foreground mb-1.5">
                持续时间 (分钟)
              </label>
              <input
                type="number"
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                min={1}
                max={1440}
                step={1}
                className="w-full px-3 py-2 bg-muted border border-input rounded-lg text-sm text-foreground focus:outline-none focus:border-primary/30 transition-colors"
              />
            </div>
          </div>

          {/* Severity */}
          <div>
            <label className="block text-sm text-muted-foreground mb-1.5">告警级别</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setSeverity('warning')}
                className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors ${
                  severity === 'warning'
                    ? 'bg-warning-soft border-warning/30 text-warning'
                    : 'bg-muted border-input text-muted-foreground hover:bg-secondary'
                }`}
              >
                <AlertTriangle className="w-4 h-4" />
                警告
              </button>
              <button
                type="button"
                onClick={() => setSeverity('error')}
                className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors ${
                  severity === 'error'
                    ? 'bg-danger-soft border-danger/30 text-danger'
                    : 'bg-muted border-input text-muted-foreground hover:bg-secondary'
                }`}
              >
                <AlertCircle className="w-4 h-4" />
                严重
              </button>
            </div>
          </div>

          {/* Enabled toggle */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">启用规则</span>
            <button
              type="button"
              onClick={() => setEnabled(!enabled)}
              role="switch"
              aria-label="启用规则"
              aria-checked={enabled}
              className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${
                enabled ? 'bg-primary' : 'bg-secondary'
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
                  enabled ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* Target scope (optional) */}
          <div>
            <label className="block text-sm text-muted-foreground mb-1.5">目标范围 (可选)</label>
            <div className="grid grid-cols-2 gap-4">
              <select
                value={targetType}
                onChange={(e) => {
                  const val = e.target.value as 'host' | 'vm' | ''
                  setTargetType(val)
                  if (!val) setTargetRef('')
                }}
                className="w-full px-3 py-2 bg-muted border border-input rounded-lg text-sm text-foreground focus:outline-none focus:border-primary/30 transition-colors appearance-none"
              >
                <option value="">全局 (所有主机/VM)</option>
                <option value="host">特定主机</option>
                <option value="vm">特定 VM</option>
              </select>
              <input
                type="text"
                value={targetRef}
                onChange={(e) => setTargetRef(e.target.value)}
                placeholder={targetType ? `${targetType === 'host' ? '主机' : 'VM'} 引用 ID` : '选择目标类型后填写'}
                disabled={!targetType}
                className="w-full px-3 py-2 bg-muted border border-input rounded-lg text-sm text-foreground placeholder-subtle focus:outline-none focus:border-primary/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              />
            </div>
            <p className="text-xs text-subtle mt-1">留空则对所有主机和 VM 生效</p>
          </div>
          </fieldset>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground rounded-lg transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 bg-primary hover:bg-primary disabled:bg-accent disabled:text-subtle text-primary-foreground text-sm rounded-lg transition-colors"
            >
              {submitting ? '保存中...' : isEdit ? '保存修改' : '创建规则'}
            </button>
          </div>
        </form>
      </div>
    </DesktopDialog>
  )
}

export default AlertRuleDialog
