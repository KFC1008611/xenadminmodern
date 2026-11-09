/**
 * Unit tests for alert-rule.service — validates alert rule CRUD and input validation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('alert-rule.service', () => {
  let alertRuleService: typeof import('../../src/main/xapi/services/alert-rule.service')
  let metricsDb: typeof import('../../src/main/xapi/services/metrics-db.service')

  beforeEach(async () => {
    vi.resetModules()
    metricsDb = await import('../../src/main/xapi/services/metrics-db.service')
    metricsDb.initDatabase()
    alertRuleService = await import('../../src/main/xapi/services/alert-rule.service')
  })

  afterEach(async () => {
    await metricsDb.closeDatabase()
  })

  // ========================================================================
  // Default rules initialization
  // ========================================================================

  describe('initDefaultRules', () => {
    it('creates 4 default rules on empty database', () => {
      alertRuleService.initDefaultRules()
      const rules = alertRuleService.getAlertRules()
      expect(rules.length).toBeGreaterThanOrEqual(4)

      const cpuWarning = rules.find(r => r.name.includes('CPU') && r.severity === 'warning')
      const cpuError = rules.find(r => r.name.includes('CPU') && r.severity === 'error')
      const memWarning = rules.find(r => r.name.includes('内存') && r.severity === 'warning')
      const memError = rules.find(r => r.name.includes('内存') && r.severity === 'error')

      expect(cpuWarning).toBeDefined()
      expect(cpuError).toBeDefined()
      expect(memWarning).toBeDefined()
      expect(memError).toBeDefined()
    })

    it('does not duplicate rules on repeated calls', () => {
      alertRuleService.initDefaultRules()
      alertRuleService.initDefaultRules()
      const rules = alertRuleService.getAlertRules()
      // Should still be 4 default rules
      expect(rules).toHaveLength(4)
    })
  })

  // ========================================================================
  // Validation
  // ========================================================================

  describe('validateAlertRuleInput', () => {
    const validInput = {
      name: 'Test Rule',
      metricType: 'cpu',
      operator: '>',
      threshold: 80,
      duration: 5,
      severity: 'warning',
    }

    it('accepts valid input without throwing', () => {
      expect(() => alertRuleService.validateAlertRuleInput(validInput)).not.toThrow()
    })

    it('throws RULE_NAME_REQUIRED for empty name', () => {
      expect(() => alertRuleService.validateAlertRuleInput({ ...validInput, name: '' }))
        .toThrow('RULE_NAME_REQUIRED')
    })

    it('throws RULE_NAME_REQUIRED for name > 100 chars', () => {
      expect(() => alertRuleService.validateAlertRuleInput({ ...validInput, name: 'x'.repeat(101) }))
        .toThrow('RULE_NAME_REQUIRED')
    })

    it('throws THRESHOLD_INVALID for invalid metricType', () => {
      expect(() => alertRuleService.validateAlertRuleInput({ ...validInput, metricType: 'invalid' }))
        .toThrow('THRESHOLD_INVALID')
    })

    it('throws THRESHOLD_INVALID for invalid operator', () => {
      expect(() => alertRuleService.validateAlertRuleInput({ ...validInput, operator: '==' }))
        .toThrow('THRESHOLD_INVALID')
    })

    it('throws THRESHOLD_INVALID for cpu threshold > 100', () => {
      expect(() => alertRuleService.validateAlertRuleInput({ ...validInput, metricType: 'cpu', threshold: 101 }))
        .toThrow('THRESHOLD_INVALID')
    })

    it('throws THRESHOLD_INVALID for negative threshold', () => {
      expect(() => alertRuleService.validateAlertRuleInput({ ...validInput, threshold: -1 }))
        .toThrow('THRESHOLD_INVALID')
    })

    it('throws DURATION_INVALID for duration < 1', () => {
      expect(() => alertRuleService.validateAlertRuleInput({ ...validInput, duration: 0 }))
        .toThrow('DURATION_INVALID')
    })

    it('throws DURATION_INVALID for duration > 1440', () => {
      expect(() => alertRuleService.validateAlertRuleInput({ ...validInput, duration: 1441 }))
        .toThrow('DURATION_INVALID')
    })

    it('throws THRESHOLD_INVALID for invalid severity', () => {
      expect(() => alertRuleService.validateAlertRuleInput({ ...validInput, severity: 'critical' }))
        .toThrow('THRESHOLD_INVALID')
    })

    it('throws THRESHOLD_INVALID when targetRef is set without targetType', () => {
      expect(() => alertRuleService.validateAlertRuleInput({ ...validInput, targetRef: 'h1' }))
        .toThrow('THRESHOLD_INVALID')
    })

    it('throws THRESHOLD_INVALID for invalid targetType', () => {
      expect(() => alertRuleService.validateAlertRuleInput({ ...validInput, targetRef: 'h1', targetType: 'invalid' }))
        .toThrow('THRESHOLD_INVALID')
    })
  })

  // ========================================================================
  // CRUD operations
  // ========================================================================

  describe('createAlertRule', () => {
    it('creates a rule and returns it with id', () => {
      const rule = alertRuleService.createAlertRule({
        name: 'High CPU',
        metricType: 'cpu',
        operator: '>',
        threshold: 85,
        duration: 10,
        severity: 'error',
      })

      expect(rule.id).toBeDefined()
      expect(rule.name).toBe('High CPU')
      expect(rule.threshold).toBe(85)
    })

    it('rejects invalid input on create', () => {
      expect(() => alertRuleService.createAlertRule({
        name: '',
        metricType: 'cpu',
        operator: '>',
        threshold: 50,
        duration: 5,
        severity: 'warning',
      })).toThrow('RULE_NAME_REQUIRED')
    })
  })

  describe('updateAlertRule', () => {
    it('updates name and threshold', () => {
      const rule = alertRuleService.createAlertRule({
        name: 'Original',
        metricType: 'cpu',
        operator: '>',
        threshold: 80,
        duration: 5,
        severity: 'warning',
      })

      const updated = alertRuleService.updateAlertRule(rule.id, { name: 'Updated', threshold: 90 })
      expect(updated.name).toBe('Updated')
      expect(updated.threshold).toBe(90)
    })

    it('validates partial updates', () => {
      const rule = alertRuleService.createAlertRule({
        name: 'Original',
        metricType: 'cpu',
        operator: '>',
        threshold: 80,
        duration: 5,
        severity: 'warning',
      })

      expect(() => alertRuleService.updateAlertRule(rule.id, { duration: 0 }))
        .toThrow('DURATION_INVALID')
    })

    it('rejects an update that is invalid when merged with the stored rule', () => {
      const rule = alertRuleService.createAlertRule({
        name: 'Original',
        metricType: 'cpu',
        operator: '>',
        threshold: 80,
        duration: 5,
        severity: 'warning',
      })

      expect(() => alertRuleService.updateAlertRule(rule.id, { threshold: 101 }))
        .toThrow('THRESHOLD_INVALID')
      expect(alertRuleService.getAlertRules().find(({ id }) => id === rule.id)?.threshold)
        .toBe(80)
    })
  })

  describe('deleteAlertRule', () => {
    it('removes the rule from the list', () => {
      const rule = alertRuleService.createAlertRule({
        name: 'To Delete',
        metricType: 'memory',
        operator: '>',
        threshold: 90,
        duration: 5,
        severity: 'error',
      })

      alertRuleService.deleteAlertRule(rule.id)
      const rules = alertRuleService.getAlertRules()
      expect(rules.find(r => r.id === rule.id)).toBeUndefined()
    })
  })
})
