/**
 * Alert rule store service — CRUD operations for alert rules in memory.
 */
import { randomUUID } from 'crypto'
import type { AlertRule, AlertRuleInput } from '../../../shared/types/xapi'
import { getAlertHistoryStore, getAlertRuleStore, mutateAlertState } from './metrics-db.service'

// Re-export for backward compatibility
export type { AlertRule, AlertRuleInput }

function cloneRule(rule: AlertRule): AlertRule {
  return { ...rule }
}

export function getAlertRules(): AlertRule[] {
  return getAlertRuleStore()
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(cloneRule)
}

export function createAlertRule(input: AlertRuleInput): AlertRule {
  return mutateAlertState(() => {
    const now = Date.now()
    const record: AlertRule = {
      id: randomUUID(),
      name: input.name,
      metricType: input.metricType,
      operator: input.operator,
      threshold: input.threshold,
      duration: input.duration,
      severity: input.severity,
      enabled: input.enabled !== false,
      connectionId: input.connectionId,
      targetRef: input.targetRef,
      targetType: input.targetType,
      createdAt: now,
      updatedAt: now,
    }

    getAlertRuleStore().push(record)
    return cloneRule(record)
  })
}

export function updateAlertRule(id: string, updates: Partial<AlertRuleInput>): AlertRule {
  return mutateAlertState(() => {
    const rules = getAlertRuleStore()
    const index = rules.findIndex((rule) => rule.id === id)
    if (index === -1) {
      throw new Error('RULE_NOT_FOUND')
    }

    const current = rules[index]
    const next: AlertRule = {
      ...current,
      ...(updates.name !== undefined ? { name: updates.name } : {}),
      ...(updates.metricType !== undefined ? { metricType: updates.metricType } : {}),
      ...(updates.operator !== undefined ? { operator: updates.operator } : {}),
      ...(updates.threshold !== undefined ? { threshold: updates.threshold } : {}),
      ...(updates.duration !== undefined ? { duration: updates.duration } : {}),
      ...(updates.severity !== undefined ? { severity: updates.severity } : {}),
      ...(updates.enabled !== undefined ? { enabled: updates.enabled } : {}),
      ...('connectionId' in updates ? { connectionId: updates.connectionId } : {}),
      ...('targetRef' in updates ? { targetRef: updates.targetRef } : {}),
      ...('targetType' in updates ? { targetType: updates.targetType } : {}),
      updatedAt: Date.now(),
    }

    rules[index] = next
    return cloneRule(next)
  })
}

export function deleteAlertRule(id: string): void {
  return mutateAlertState(() => {
    const rules = getAlertRuleStore()
    const index = rules.findIndex((rule) => rule.id === id)
    if (index === -1) {
      throw new Error('RULE_NOT_FOUND')
    }

    rules.splice(index, 1)

    const history = getAlertHistoryStore()
    for (let i = history.length - 1; i >= 0; i -= 1) {
      if (history[i].ruleId === id) {
        if (history[i].status !== 'resolved') history[i] = { ...history[i], status: 'resolved', resolvedAt: Date.now() }
      }
    }
  })
}
