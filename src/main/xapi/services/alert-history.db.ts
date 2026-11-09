/**
 * Alert history store service — CRUD operations for alert history records in memory.
 */
import { randomUUID } from 'crypto'
import type { AlertHistoryRecord, AlertHistoryFilters } from '../../../shared/types/xapi'
import { getAlertHistoryStore, getAlertRuleStore, mutateAlertState } from './metrics-db.service'

// Re-export for backward compatibility
export type { AlertHistoryRecord, AlertHistoryFilters }

function cloneRecord(record: AlertHistoryRecord): AlertHistoryRecord {
  return { ...record }
}

export function getAlertHistory(filters?: AlertHistoryFilters): AlertHistoryRecord[] {
  return getAlertHistoryStore()
    .filter((record) => {
      if (filters?.status && filters.status.length > 0 && !filters.status.includes(record.status)) {
        return false
      }
      if (filters?.severity && filters.severity.length > 0 && !filters.severity.includes(record.severity)) {
        return false
      }
      if (filters?.since !== undefined && record.triggeredAt < filters.since) {
        return false
      }
      if (filters?.until !== undefined && record.triggeredAt > filters.until) {
        return false
      }
      if (filters?.connectionId !== undefined && record.connectionId !== filters.connectionId) {
        return false
      }
      return true
    })
    .slice()
    .sort((a, b) => b.triggeredAt - a.triggeredAt)
    .map(cloneRecord)
}

export function createAlertHistory(record: Omit<AlertHistoryRecord, 'id'>): AlertHistoryRecord {
  return mutateAlertState(() => {
    const next: AlertHistoryRecord = {
      id: randomUUID(),
      ...record,
    }
    getAlertHistoryStore().push(next)
    return cloneRecord(next)
  })
}

export function acknowledgeAlert(alertId: string): void {
  return mutateAlertState(() => {
    const history = getAlertHistoryStore()
    const index = history.findIndex((record) => record.id === alertId)
    if (index === -1) {
      throw new Error('ALERT_NOT_FOUND')
    }

    if (history[index].status !== 'active') {
      throw new Error('ALERT_ALREADY_ACKNOWLEDGED')
    }

    history[index] = {
      ...history[index],
      status: 'acknowledged',
      acknowledgedAt: Date.now(),
    }
  })
}

export function resolveAlert(alertId: string): void {
  return mutateAlertState(() => {
    const history = getAlertHistoryStore()
    const index = history.findIndex((record) => record.id === alertId)
    if (index === -1) {
      throw new Error('ALERT_NOT_FOUND')
    }

    if (history[index].status === 'resolved') {
      return
    }

    history[index] = {
      ...history[index],
      status: 'resolved',
      resolvedAt: Date.now(),
    }
  })
}

export function resolveStaleAlerts(): void {
  return mutateAlertState(() => {
    const ruleIds = new Set(getAlertRuleStore().map((rule) => rule.id))
    const history = getAlertHistoryStore()
    const now = Date.now()

    for (let i = 0; i < history.length; i += 1) {
      const record = history[i]
      if ((record.status === 'active' || record.status === 'acknowledged') && !ruleIds.has(record.ruleId)) {
        history[i] = {
          ...record,
          status: 'resolved',
          resolvedAt: now,
        }
      }
    }
  })
}

export function getAlertCountByStatus(): { active: number; acknowledged: number; resolved: number } {
  const counts = { active: 0, acknowledged: 0, resolved: 0 }
  for (const record of getAlertHistoryStore()) {
    counts[record.status] += 1
  }
  return counts
}
