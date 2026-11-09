/**
 * Alert service — wraps XAPI message.* methods for system alerts/messages management.
 * All functions accept connectionId as the first parameter for multi-connection support.
 *
 * v7: Extended with EventEmitter for alert event push and alert history operations.
 */
import { EventEmitter } from 'events'
import { connectionManager } from '../connection-manager'
import {
  getAlertHistory as dbGetAlertHistory,
  acknowledgeAlert as dbAcknowledgeAlert,
  resolveAlert as dbResolveAlert,
  getAlertCountByStatus as dbGetAlertCountByStatus,
  type AlertHistoryRecord,
  type AlertHistoryFilters,
} from './alert-history.db'

// Re-export types for consumers
export type { AlertHistoryRecord, AlertHistoryFilters } from './alert-history.db'

export interface AlertRecord {
  ref: string
  uuid: string
  name: string
  priority: number
  severity: 'error' | 'warning' | 'info'
  body: string
  timestamp: number
  cls: string
  objUuid: string
}

export interface ConnectedAlertRecord extends AlertRecord {
  connectionId: string
  poolName: string
}

export interface AlertFilters {
  severity?: ('error' | 'warning' | 'info')[]
  since?: number
  until?: number
  objUuid?: string
}

function getClient(connectionId: string) {
  const client = connectionManager.getClient(connectionId)
  if (!client) {
    throw new Error(`No connection found for connectionId: ${connectionId}`)
  }
  return client
}

function getPoolName(connectionId: string): string {
  return connectionManager.getConnectionInfo(connectionId)?.poolName ?? connectionId
}

/**
 * Map XAPI message priority to severity level.
 * priority 1 -> 'error'
 * priority 2 -> 'warning'
 * priority 3,4,5 -> 'info'
 */
function mapPriorityToSeverity(priority: number): 'error' | 'warning' | 'info' {
  if (priority === 1) return 'error'
  if (priority === 2) return 'warning'
  return 'info'
}

/**
 * Get all alerts from XAPI message records.
 * Results are sorted by timestamp descending (newest first).
 */
export async function getAllAlerts(
  connectionId: string,
  filters?: AlertFilters
): Promise<ConnectedAlertRecord[]> {
  const client = getClient(connectionId)
  const poolName = getPoolName(connectionId)

  const records: Record<string, any> = await client.callWithSession('message.get_all_records', [])

  let alerts: ConnectedAlertRecord[] = Object.entries(records).map(([ref, record]) => {
    const parsedPriority = Number(record.priority)
    const priority = record.priority !== undefined && Number.isFinite(parsedPriority) ? parsedPriority : 5
    return {
      ref,
      uuid: record.uuid || '',
      name: record.name || '',
      priority,
      severity: mapPriorityToSeverity(priority),
      body: record.body || '',
      timestamp: record.timestamp ? new Date(record.timestamp).getTime() : Date.now(),
      cls: record.cls || '',
      objUuid: record.obj_uuid || '',
      connectionId,
      poolName,
    }
  })

  // Apply filters
  if (filters?.severity && filters.severity.length > 0) {
    alerts = alerts.filter(a => filters.severity!.includes(a.severity))
  }

  if (filters?.since) {
    alerts = alerts.filter(a => a.timestamp >= filters.since!)
  }

  if (filters?.until) {
    alerts = alerts.filter(a => a.timestamp <= filters.until!)
  }

  if (filters?.objUuid) {
    alerts = alerts.filter(a => a.objUuid === filters.objUuid)
  }

  // Sort by timestamp descending
  alerts.sort((a, b) => b.timestamp - a.timestamp)

  return alerts
}

/**
 * Dismiss (delete) a single alert by ref.
 * Silently succeeds if the message is already deleted.
 */
export async function dismissAlert(connectionId: string, alertRef: string): Promise<void> {
  const client = getClient(connectionId)

  try {
    await client.callWithSession('message.destroy', [alertRef])
  } catch (err: any) {
    // Silently ignore if message already deleted
    if (err?.faultString?.includes('HANDLE_INVALID') || err?.message?.includes('HANDLE_INVALID')) {
      return
    }
    throw err
  }
}

/**
 * Dismiss all alerts matching the given filters.
 * Returns the number of alerts actually deleted.
 */
export async function dismissAllAlerts(
  connectionId: string,
  filters?: AlertFilters
): Promise<number> {
  const alerts = await getAllAlerts(connectionId, filters)

  let deletedCount = 0
  let failedCount = 0
  for (const alert of alerts) {
    try {
      await dismissAlert(connectionId, alert.ref)
      deletedCount++
    } catch {
      failedCount++
    }
  }

  if (failedCount) throw new Error(`ALERT_DISMISS_PARTIAL: 已清除 ${deletedCount} 条，${failedCount} 条未完成，请刷新核对`)

  return deletedCount
}

// ============================================================================
// v7: Alert event push and history operations
// ============================================================================

/** Shared EventEmitter instance for alert events */
export const alertEmitter = new EventEmitter()

/**
 * Register a callback for alert triggered events.
 */
export function onAlertTriggered(callback: (record: AlertHistoryRecord) => void): void {
  alertEmitter.on('alertTriggered', callback)
}

/**
 * Emit an alert triggered event.
 */
export function emitAlertTriggered(record: AlertHistoryRecord): void {
  alertEmitter.emit('alertTriggered', record)
}

/**
 * Remove an alert triggered listener.
 */
export function removeAlertTriggeredListener(callback: Function): void {
  alertEmitter.removeListener('alertTriggered', callback as (...args: any[]) => void)
}

// ============================================================================
// v7: Alert history operations (delegates to metrics-db.service)
// ============================================================================

/**
 * Get alert history with optional filters.
 */
export function getAlertHistory(filters?: AlertHistoryFilters): AlertHistoryRecord[] {
  return dbGetAlertHistory(filters)
}

/**
 * Acknowledge an alert (active -> acknowledged).
 */
export function acknowledgeAlert(alertId: string): void {
  dbAcknowledgeAlert(alertId)
}

/**
 * Resolve an alert (active/acknowledged -> resolved).
 */
export function resolveAlert(alertId: string): void {
  dbResolveAlert(alertId)
}

/**
 * Get alert counts grouped by status.
 */
export function getAlertCountByStatus(): { active: number; acknowledged: number; resolved: number } {
  return dbGetAlertCountByStatus()
}
