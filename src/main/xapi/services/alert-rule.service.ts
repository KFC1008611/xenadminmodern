/**
 * Alert rule service — manages alert rule CRUD with validation.
 * Delegates persistence to metrics-db.service.
 *
 * v7: New service for alert rule management.
 */
import { areDefaultRulesInitialized, markDefaultRulesInitialized } from './metrics-db.service'
import {
  getAlertRules as dbGetAlertRules,
  createAlertRule as dbCreateAlertRule,
  updateAlertRule as dbUpdateAlertRule,
  deleteAlertRule as dbDeleteAlertRule,
  type AlertRule,
  type AlertRuleInput,
} from './alert-rule.db'

// Re-export types for downstream consumers
export type { AlertRule, AlertRuleInput }

// ============================================================================
// Constants
// ============================================================================

const VALID_METRIC_TYPES = ['cpu', 'memory', 'networkRx', 'networkTx', 'diskRead', 'diskWrite']
const VALID_OPERATORS = ['>', '<', '>=', '<=']
const VALID_SEVERITIES = ['warning', 'error']
const VALID_TARGET_TYPES = ['host', 'vm']

const METRIC_THRESHOLDS: Record<string, { min: number; max: number }> = {
  cpu: { min: 0, max: 100 },
  memory: { min: 0, max: 100 },
  networkRx: { min: 0, max: Infinity },
  networkTx: { min: 0, max: Infinity },
  diskRead: { min: 0, max: Infinity },
  diskWrite: { min: 0, max: Infinity },
}

const DEFAULT_RULES: AlertRuleInput[] = [
  {
    name: 'CPU 使用率过高 (Warning)',
    metricType: 'cpu',
    operator: '>',
    threshold: 90,
    duration: 5,
    severity: 'warning',
    enabled: true,
  },
  {
    name: 'CPU 使用率过高 (Error)',
    metricType: 'cpu',
    operator: '>',
    threshold: 95,
    duration: 3,
    severity: 'error',
    enabled: true,
  },
  {
    name: '内存使用率过高 (Warning)',
    metricType: 'memory',
    operator: '>',
    threshold: 90,
    duration: 5,
    severity: 'warning',
    enabled: true,
  },
  {
    name: '内存使用率过高 (Error)',
    metricType: 'memory',
    operator: '>',
    threshold: 95,
    duration: 3,
    severity: 'error',
    enabled: true,
  },
]


// ============================================================================
// Validation
// ============================================================================

/**
 * Validate alert rule input. Throws descriptive errors on failure.
 */
export function validateAlertRuleInput(input: AlertRuleInput): void {
  // Name validation
  if (!input.name || typeof input.name !== 'string' || input.name.trim().length === 0) {
    throw new Error('RULE_NAME_REQUIRED')
  }
  if (input.name.length > 100) {
    throw new Error('RULE_NAME_REQUIRED')
  }

  // Metric type validation
  if (!VALID_METRIC_TYPES.includes(input.metricType)) {
    throw new Error('THRESHOLD_INVALID')
  }

  // Operator validation
  if (!VALID_OPERATORS.includes(input.operator)) {
    throw new Error('THRESHOLD_INVALID')
  }

  // Threshold validation
  if (typeof input.threshold !== 'number' || !Number.isFinite(input.threshold)) {
    throw new Error('THRESHOLD_INVALID')
  }
  const range = METRIC_THRESHOLDS[input.metricType]
  if (range) {
    if (input.threshold < range.min || input.threshold > range.max) {
      throw new Error('THRESHOLD_INVALID')
    }
  }

  // Duration validation
  if (!Number.isInteger(input.duration) || input.duration < 1 || input.duration > 1440) {
    throw new Error('DURATION_INVALID')
  }

  // Severity validation
  if (!VALID_SEVERITIES.includes(input.severity)) {
    throw new Error('THRESHOLD_INVALID')
  }

  if (input.connectionId !== undefined && (typeof input.connectionId !== 'string' || !input.connectionId.trim())) throw new Error('RULE_CONNECTION_INVALID')

  // Target validation
  if (input.targetRef && !input.targetType) {
    throw new Error('THRESHOLD_INVALID')
  }
  if (input.targetType && !VALID_TARGET_TYPES.includes(input.targetType)) {
    throw new Error('THRESHOLD_INVALID')
  }
}

// ============================================================================
// Service functions
// ============================================================================

/**
 * Get all alert rules. Auto-initializes default rules on first call.
 */
export function getAlertRules(): AlertRule[] {
  if (!areDefaultRulesInitialized()) {
    initDefaultRules()
  }
  return dbGetAlertRules()
}

/**
 * Create a new alert rule with validation.
 */
export function createAlertRule(input: AlertRuleInput): AlertRule {
  validateAlertRuleInput(input)
  return dbCreateAlertRule(input)
}

/**
 * Update an existing alert rule with validation.
 */
export function updateAlertRule(id: string, updates: Partial<AlertRuleInput>): AlertRule {
  const current = dbGetAlertRules().find((rule) => rule.id === id)
  if (!current) throw new Error('RULE_NOT_FOUND')
  validateAlertRuleInput({ ...current, ...updates })

  return dbUpdateAlertRule(id, updates)
}

/**
 * Delete an alert rule (cascade deletes related alert history).
 */
export function deleteAlertRule(id: string): void {
  dbDeleteAlertRule(id)
}

/**
 * Initialize default alert rules if the table is empty.
 */
export function initDefaultRules(): void {
  if (areDefaultRulesInitialized()) return

  const existing = dbGetAlertRules()
  if (existing.length === 0) {
    for (const rule of DEFAULT_RULES) {
      dbCreateAlertRule(rule)
    }
  }

  markDefaultRulesInitialized()
}
