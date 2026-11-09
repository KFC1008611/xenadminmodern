import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAlertStore } from '../../src/renderer/src/store/alert.store'
import { useAlertRuleStore } from '../../src/renderer/src/store/alertRule.store'
import { useConnectionManagerStore } from '../../src/renderer/src/store/connectionManager.store'
import type { AlertHistoryRecord } from '../../src/shared/types/xapi'
const api = { alerts: { getAll: vi.fn(), dismissAll: vi.fn() }, alertHistory: { list: vi.fn(), acknowledge: vi.fn() }, alertRules: { evaluate: vi.fn() } }
const incident: AlertHistoryRecord = { id: 'a1', ruleId: 'r1', ruleName: 'CPU', connectionId: 'c1', poolUuid: 'pool-a', entityRef: 'h1', entityName: 'H1', metricType: 'cpu', metricValue: 90, threshold: 80, severity: 'warning', status: 'active', triggeredAt: 1 }
beforeEach(() => {
  vi.clearAllMocks()
  ;(globalThis as any).window = { xapi: api }
  useAlertStore.setState({ alerts: [], history: [], historyError: null, error: null, activeAlertCount: 0, filters: {} })
  useAlertRuleStore.setState({ error: null })
  useConnectionManagerStore.setState({ connections: [{ id: 'c1', state: 'connected' }, { id: 'c2', state: 'connected' }] as any })
})
describe('alert presentation state', () => {
  it('upserts recovery into the same incident and retains acknowledged incidents in active count', () => {
    const store = useAlertStore.getState()
    store.addTriggeredAlert(incident)
    store.addTriggeredAlert({ ...incident, status: 'acknowledged' })
    expect(useAlertStore.getState().history).toHaveLength(1)
    expect(useAlertStore.getState().activeAlertCount).toBe(1)
    store.addTriggeredAlert({ ...incident, status: 'resolved', resolvedAt: 2 })
    expect(useAlertStore.getState().history).toHaveLength(1)
    expect(useAlertStore.getState().history[0].status).toBe('resolved')
    expect(useAlertStore.getState().activeAlertCount).toBe(0)
  })
  it('keeps failed pool alert data and exposes partial read failure', async () => {
    useAlertStore.setState({ alerts: [{ connectionId: 'c1', ref: 'old', severity: 'warning' }] as any })
    api.alerts.getAll.mockImplementation(async (id) => { if (id === 'c1') throw new Error('offline'); return [{ ref: 'new', severity: 'error', timestamp: 2 }] })
    await useAlertStore.getState().refreshAlerts()
    expect(useAlertStore.getState().alerts.map((a) => a.ref)).toEqual(expect.arrayContaining(['old', 'new']))
    expect(useAlertStore.getState().error).toContain('c1')
  })
  it('does not erase alert rows when dismissal is unconfirmed', async () => {
    useAlertStore.setState({ alerts: [{ connectionId: 'c1', ref: 'keep' }, { connectionId: 'c2', ref: 'done' }] as any })
    api.alerts.dismissAll.mockImplementation(async (id) => { if (id === 'c1') throw new Error('timeout') })
    await useAlertStore.getState().dismissAll()
    expect(useAlertStore.getState().alerts.map((a) => a.ref)).toEqual(['keep'])
    expect(useAlertStore.getState().error).toBeTruthy()
  })
  it('exposes history, acknowledge, and evaluation failures to the UI', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      api.alertHistory.list.mockRejectedValue(new Error('history unavailable'))
      await useAlertStore.getState().loadHistory()
      expect(useAlertStore.getState().historyError).toBe('history unavailable')
      api.alertHistory.acknowledge.mockRejectedValue(new Error('cannot save'))
      await useAlertStore.getState().acknowledgeAlert('a1')
      expect(useAlertStore.getState().historyError).toBe('cannot save')
      api.alertRules.evaluate.mockRejectedValue(new Error('partial evaluation'))
      await useAlertRuleStore.getState().evaluateNow()
      expect(useAlertRuleStore.getState().error).toBe('partial evaluation')
      expect(errorLog.mock.calls).toEqual([
        ['Failed to load alert history:', 'history unavailable'],
        ['Failed to acknowledge alert:', 'cannot save'],
        ['Failed to evaluate alert rules:', 'partial evaluation'],
      ])
    } finally {
      errorLog.mockRestore()
    }
  })
})
