/** Duration rules are evaluated from complete raw sample windows, scoped to one pool. */
import { connectionManager } from '../connection-manager'
import { getAlertRules, type AlertRule } from './alert-rule.service'
import { initDatabase, getAlertMetricWindow, type MetricDataPoint, type AlertMetricPoint } from './metrics-db.service'
import { createAlertHistory, getAlertHistory, resolveAlert, type AlertHistoryRecord } from './alert-history.db'
import { emitAlertTriggered } from './alert.service'
import { sendAlertNotification } from './alert-notification.service'
import { createLogger } from '../../logger'

const log = createLogger('AlertEngine')
const MAX_SAMPLE_GAP_MS = 45_000
let engineTimer: NodeJS.Timeout | null = null
let inFlight: Promise<AlertHistoryRecord[]> | null = null
let lastEvaluatedAt: number | null = null
let evaluateCount = 0
let lastErrors: string[] = []

type Point = AlertMetricPoint
function metric(point: Point, kind: string): number | null {
  const keys: Record<string, keyof MetricDataPoint> = { cpu: 'cpuPercent', memory: 'memoryPercent', networkRx: 'networkRxBytes', networkTx: 'networkTxBytes', diskRead: 'diskReadBytes', diskWrite: 'diskWriteBytes' }
  if (point.availableMetrics && !point.availableMetrics.includes(keys[kind])) return null
  const value = point[keys[kind]]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
function exceeds(value: number, rule: AlertRule): boolean {
  switch (rule.operator) { case '>': return value > rule.threshold; case '<': return value < rule.threshold; case '>=': return value >= rule.threshold; case '<=': return value <= rule.threshold }
}
function continuousWindow(points: Point[], start: number, now: number): Point[] | null {
  // Include a preceding sample so the entire requested duration is observed.
  const unique = [...new Map(points.map((point) => [point.timestamp, point])).values()].sort((a, b) => a.timestamp - b.timestamp)
  const firstWithin = unique.findIndex((point) => point.timestamp >= start)
  if (firstWithin < 0 || unique.length < 2) return null
  const window = unique.slice(unique[firstWithin].timestamp === start ? firstWithin : Math.max(0, firstWithin - 1))
  if (window[0].timestamp > start || now - window[window.length - 1].timestamp > MAX_SAMPLE_GAP_MS) return null
  if (window.some((point, index) => index > 0 && point.timestamp - window[index - 1].timestamp > MAX_SAMPLE_GAP_MS)) return null
  return window
}

async function notify(record: AlertHistoryRecord, transition: 'triggered' | 'resolved', poolName: string): Promise<void> {
  await sendAlertNotification({
    eventId: record.id, transition, ...(record.poolUuid ? { poolUuid: record.poolUuid } : {}),
    ruleName: record.ruleName, connectionId: record.connectionId, poolName,
    entityRef: record.entityRef, entityName: record.entityName, severity: record.severity,
    message: transition === 'resolved' ? '指标已连续恢复正常' : '指标已持续超过告警阈值',
    metricType: record.metricType, metricValue: record.metricValue, threshold: record.threshold,
    timestamp: transition === 'resolved' ? record.resolvedAt! : record.triggeredAt,
  })
}

async function runEvaluation(): Promise<AlertHistoryRecord[]> {
  await initDatabase()
  const rules = getAlertRules().filter((rule) => rule.enabled)
  const connections = connectionManager.listConnections().filter((conn) => conn.state === 'connected')
  const now = Date.now()
  const newAlerts: AlertHistoryRecord[] = []
  lastErrors = []
  for (const rule of rules) {
    const selected = rule.connectionId ? connections.filter((conn) => conn.id === rule.connectionId) : connections
    if (rule.targetRef && !rule.connectionId && selected.length > 1) {
      lastErrors.push(`${rule.name}: 旧版定向规则未绑定资源池，请编辑并保存`)
      continue
    }
    for (const conn of selected) {
      try {
        const client = connectionManager.getClient(conn.id)
        if (!client) continue
        const kind = rule.targetType || 'host'
        const entities: Array<{ ref: string; name: string }> = []
        if (rule.targetRef) entities.push({ ref: rule.targetRef, name: rule.targetRef })
        else {
          const records = await client.callWithSession('host.get_all_records', [])
          for (const [ref, record] of Object.entries(records)) entities.push({ ref, name: (record as any).name_label || ref })
        }
        for (const entity of entities) {
          const start = now - rule.duration * 60_000
          const points = continuousWindow(getAlertMetricWindow(kind, conn.id, entity.ref, start - MAX_SAMPLE_GAP_MS, now, conn.poolUuid), start, now)
          if (!points) continue
          const values = points.map((point) => metric(point, rule.metricType))
          if (values.some((value) => value === null)) continue
          const active = getAlertHistory({ connectionId: conn.id, status: ['active', 'acknowledged'] })
            .filter((alert) => alert.ruleId === rule.id && alert.entityRef === entity.ref && alert.poolUuid === conn.poolUuid)
          if (values.every((value) => exceeds(value!, rule))) {
            if (active.length) continue
            const record = createAlertHistory({
              ruleId: rule.id, ruleName: rule.name, connectionId: conn.id,
              ...(conn.poolUuid ? { poolUuid: conn.poolUuid } : {}), entityRef: entity.ref, entityName: entity.name,
              metricType: rule.metricType, metricValue: values[values.length - 1]!, threshold: rule.threshold,
              severity: rule.severity, triggeredAt: now, status: 'active',
            })
            newAlerts.push(record); emitAlertTriggered(record)
            await notify(record, 'triggered', conn.poolName || conn.id)
          } else if (values.every((value) => !exceeds(value!, rule))) {
            for (const alert of active) {
              resolveAlert(alert.id)
              const resolved = { ...alert, status: 'resolved' as const, resolvedAt: Date.now(), metricValue: values[values.length - 1]! }
              emitAlertTriggered(resolved)
              await notify(resolved, 'resolved', conn.poolName || conn.id)
            }
          }
        }
      } catch (error) {
        lastErrors.push(`${conn.id}: ${error instanceof Error ? error.message : '告警计算失败'}`)
      }
    }
  }
  evaluateCount++; lastEvaluatedAt = now
  if (lastErrors.length) throw new Error(`ALERT_EVALUATION_PARTIAL: ${lastErrors.join('; ')}`)
  return newAlerts
}

export function evaluateRules(): Promise<AlertHistoryRecord[]> {
  if (!inFlight) inFlight = runEvaluation().finally(() => { inFlight = null })
  return inFlight
}
export function evaluateOnce(): Promise<AlertHistoryRecord[]> { return evaluateRules() }
export function startAlertEngine(intervalMs = 60_000): void {
  stopAlertEngine()
  const run = () => { void evaluateRules().catch((error) => log.error('Alert evaluation did not complete', error)) }
  engineTimer = setInterval(run, intervalMs)
  run()
}
export function stopAlertEngine(): void { if (engineTimer) clearInterval(engineTimer); engineTimer = null }
export function getEngineStatus() { return { isRunning: engineTimer !== null, lastEvaluatedAt, evaluateCount, lastErrors: [...lastErrors] } }
