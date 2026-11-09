/**
 * Unit tests for alert.service — verifies XAPI message.* calls (v5)
 * and v7 EventEmitter/history operations.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCallWithSession = vi.fn()
const mockGetClient = vi.fn(() => ({
  callWithSession: mockCallWithSession,
}))
const mockGetConnectionInfo = vi.fn(() => ({
  poolName: 'Test Pool',
}))

vi.mock('../../src/main/xapi/connection-manager', () => ({
  connectionManager: {
    getClient: mockGetClient,
    getConnectionInfo: mockGetConnectionInfo,
  },
}))

// v7: Mock alert-history store module for history operations
const mockDbGetAlertHistory = vi.fn(() => [])
const mockDbAcknowledgeAlert = vi.fn()
const mockDbResolveAlert = vi.fn()
const mockDbGetAlertCountByStatus = vi.fn(() => ({ active: 0, acknowledged: 0, resolved: 0 }))

vi.mock('../../src/main/xapi/services/alert-history.db', () => ({
  getAlertHistory: mockDbGetAlertHistory,
  acknowledgeAlert: mockDbAcknowledgeAlert,
  resolveAlert: mockDbResolveAlert,
  getAlertCountByStatus: mockDbGetAlertCountByStatus,
}))

describe('alert.service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getAllAlerts', () => {
    it('returns alerts with connection metadata and mapped severity', async () => {
      mockCallWithSession.mockResolvedValueOnce({
        'OpaqueRef:msg1': {
          uuid: 'uuid-msg1',
          name: 'VM_STARTED',
          priority: '1',
          body: 'VM started successfully',
          timestamp: '2026-03-24T10:00:00Z',
          cls: 'VM',
          obj_uuid: 'vm-uuid-1',
        },
        'OpaqueRef:msg2': {
          uuid: 'uuid-msg2',
          name: 'LICENSE_EXPIRING',
          priority: '2',
          body: 'License will expire soon',
          timestamp: '2026-03-24T09:00:00Z',
          cls: 'Host',
          obj_uuid: 'host-uuid-1',
        },
        'OpaqueRef:msg3': {
          uuid: 'uuid-msg3',
          name: 'TASK_COMPLETED',
          priority: '5',
          body: 'Task completed',
          timestamp: '2026-03-24T08:00:00Z',
          cls: 'Task',
          obj_uuid: 'task-uuid-1',
        },
      })

      const { getAllAlerts } = await import('../../src/main/xapi/services/alert.service')
      const alerts = await getAllAlerts('conn-123')

      expect(alerts).toHaveLength(3)
      expect(mockCallWithSession).toHaveBeenCalledWith('message.get_all_records', [])

      // Check priority to severity mapping
      expect(alerts[0].severity).toBe('error') // priority 1
      expect(alerts[1].severity).toBe('warning') // priority 2
      expect(alerts[2].severity).toBe('info') // priority 5

      // Check connection metadata
      expect(alerts[0].connectionId).toBe('conn-123')
      expect(alerts[0].poolName).toBe('Test Pool')

      // Check sorted by timestamp descending
      expect(alerts[0].timestamp).toBeGreaterThan(alerts[1].timestamp)
    })

    it('filters by severity', async () => {
      mockCallWithSession.mockResolvedValueOnce({
        'OpaqueRef:msg1': { priority: '1', name: 'Error', body: '', timestamp: '2026-03-24T10:00:00Z', cls: '', obj_uuid: '' },
        'OpaqueRef:msg2': { priority: '2', name: 'Warning', body: '', timestamp: '2026-03-24T09:00:00Z', cls: '', obj_uuid: '' },
        'OpaqueRef:msg3': { priority: '5', name: 'Info', body: '', timestamp: '2026-03-24T08:00:00Z', cls: '', obj_uuid: '' },
      })

      const { getAllAlerts } = await import('../../src/main/xapi/services/alert.service')
      const alerts = await getAllAlerts('conn-123', { severity: ['error', 'warning'] })

      expect(alerts).toHaveLength(2)
      expect(alerts.every(a => a.severity === 'error' || a.severity === 'warning')).toBe(true)
    })

    it('filters by time range', async () => {
      mockCallWithSession.mockResolvedValueOnce({
        'OpaqueRef:msg1': { priority: '1', name: 'Old', body: '', timestamp: '2026-03-24T08:00:00Z', cls: '', obj_uuid: '' },
        'OpaqueRef:msg2': { priority: '1', name: 'New', body: '', timestamp: '2026-03-24T10:00:00Z', cls: '', obj_uuid: '' },
      })

      const { getAllAlerts } = await import('../../src/main/xapi/services/alert.service')
      const since = new Date('2026-03-24T09:00:00Z').getTime()
      const alerts = await getAllAlerts('conn-123', { since })

      expect(alerts).toHaveLength(1)
      expect(alerts[0].name).toBe('New')
    })

    it('returns empty array when no messages exist', async () => {
      mockCallWithSession.mockResolvedValueOnce({})

      const { getAllAlerts } = await import('../../src/main/xapi/services/alert.service')
      const alerts = await getAllAlerts('conn-123')

      expect(alerts).toHaveLength(0)
    })

    it('throws when connectionId is invalid', async () => {
      mockGetClient.mockReturnValueOnce(undefined)

      const { getAllAlerts } = await import('../../src/main/xapi/services/alert.service')
      await expect(getAllAlerts('invalid-id')).rejects.toThrow('No connection found for connectionId: invalid-id')
    })
  })

  describe('dismissAlert', () => {
    it('calls message.destroy with the correct ref', async () => {
      mockCallWithSession.mockResolvedValueOnce(null)

      const { dismissAlert } = await import('../../src/main/xapi/services/alert.service')
      await dismissAlert('conn-123', 'OpaqueRef:msg1')

      expect(mockCallWithSession).toHaveBeenCalledWith('message.destroy', ['OpaqueRef:msg1'])
    })

    it('silently succeeds when message is already deleted', async () => {
      const error = new Error('HANDLE_INVALID')
      ;(error as any).faultString = 'HANDLE_INVALID'
      mockCallWithSession.mockRejectedValueOnce(error)

      const { dismissAlert } = await import('../../src/main/xapi/services/alert.service')
      await expect(dismissAlert('conn-123', 'OpaqueRef:msg1')).resolves.not.toThrow()
    })

    it('throws on other errors', async () => {
      mockCallWithSession.mockRejectedValueOnce(new Error('XAPI_ERROR'))

      const { dismissAlert } = await import('../../src/main/xapi/services/alert.service')
      await expect(dismissAlert('conn-123', 'OpaqueRef:msg1')).rejects.toThrow('XAPI_ERROR')
    })
  })

  describe('dismissAllAlerts', () => {
    it('deletes all alerts and returns count', async () => {
      mockCallWithSession
        .mockResolvedValueOnce({
          'OpaqueRef:msg1': { priority: '1', name: 'Error1', body: '', timestamp: '2026-03-24T10:00:00Z', cls: '', obj_uuid: '' },
          'OpaqueRef:msg2': { priority: '1', name: 'Error2', body: '', timestamp: '2026-03-24T09:00:00Z', cls: '', obj_uuid: '' },
        })
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)

      const { dismissAllAlerts } = await import('../../src/main/xapi/services/alert.service')
      const count = await dismissAllAlerts('conn-123')

      expect(count).toBe(2)
      expect(mockCallWithSession).toHaveBeenCalledTimes(3) // get_all_records + 2 destroy
    })

    it('returns 0 when no alerts match filters', async () => {
      mockCallWithSession.mockResolvedValueOnce({
        'OpaqueRef:msg1': { priority: '5', name: 'Info', body: '', timestamp: '2026-03-24T10:00:00Z', cls: '', obj_uuid: '' },
      })

      const { dismissAllAlerts } = await import('../../src/main/xapi/services/alert.service')
      const count = await dismissAllAlerts('conn-123', { severity: ['error'] })

      expect(count).toBe(0)
    })

    it('reports partial failure after continuing independent dismissals', async () => {
      mockCallWithSession
        .mockResolvedValueOnce({
          'OpaqueRef:msg1': { priority: '1', name: 'Error1', body: '', timestamp: '2026-03-24T10:00:00Z', cls: '', obj_uuid: '' },
          'OpaqueRef:msg2': { priority: '1', name: 'Error2', body: '', timestamp: '2026-03-24T09:00:00Z', cls: '', obj_uuid: '' },
        })
        .mockRejectedValueOnce(new Error('DELETE_FAILED'))
        .mockResolvedValueOnce(null)

      const { dismissAllAlerts } = await import('../../src/main/xapi/services/alert.service')
      await expect(dismissAllAlerts('conn-123')).rejects.toThrow('ALERT_DISMISS_PARTIAL')
      expect(mockCallWithSession).toHaveBeenCalledWith('message.destroy', ['OpaqueRef:msg2'])
    })
  })

  // ========================================================================
  // v7: EventEmitter and alert history operations
  // ========================================================================

  describe('v7: EventEmitter', () => {
    it('emitAlertTriggered fires onAlertTriggered callback', async () => {
      const { onAlertTriggered, emitAlertTriggered, removeAlertTriggeredListener } =
        await import('../../src/main/xapi/services/alert.service')

      const callback = vi.fn()
      onAlertTriggered(callback)

      const record = {
        id: 'alert-1',
        ruleId: 'rule-1',
        ruleName: 'Test Rule',
        connectionId: 'conn-1',
        entityRef: 'h1',
        entityName: 'Host 1',
        metricType: 'cpu',
        metricValue: 95,
        threshold: 90,
        severity: 'warning' as const,
        triggeredAt: Date.now(),
        status: 'active' as const,
      }

      emitAlertTriggered(record)
      expect(callback).toHaveBeenCalledWith(record)

      // Cleanup
      removeAlertTriggeredListener(callback)
    })

    it('removeAlertTriggeredListener stops receiving events', async () => {
      const { onAlertTriggered, emitAlertTriggered, removeAlertTriggeredListener } =
        await import('../../src/main/xapi/services/alert.service')

      const callback = vi.fn()
      onAlertTriggered(callback)
      removeAlertTriggeredListener(callback)

      emitAlertTriggered({
        id: 'alert-2',
        ruleId: 'rule-1',
        ruleName: 'Test',
        connectionId: 'c1',
        entityRef: 'h1',
        entityName: 'H1',
        metricType: 'cpu',
        metricValue: 95,
        threshold: 90,
        severity: 'error',
        triggeredAt: Date.now(),
        status: 'active',
      })

      expect(callback).not.toHaveBeenCalled()
    })
  })

  describe('v7: Alert history operations', () => {
    it('getAlertHistory delegates to alert-history store', async () => {
      const mockRecords = [{ id: 'a1', status: 'active' }]
      mockDbGetAlertHistory.mockReturnValueOnce(mockRecords)

      const { getAlertHistory } = await import('../../src/main/xapi/services/alert.service')
      const result = getAlertHistory({ status: ['active'] })

      expect(mockDbGetAlertHistory).toHaveBeenCalledWith({ status: ['active'] })
      expect(result).toEqual(mockRecords)
    })

    it('acknowledgeAlert delegates to alert-history store', async () => {
      const { acknowledgeAlert } = await import('../../src/main/xapi/services/alert.service')
      acknowledgeAlert('alert-1')

      expect(mockDbAcknowledgeAlert).toHaveBeenCalledWith('alert-1')
    })

    it('resolveAlert delegates to alert-history store', async () => {
      const { resolveAlert } = await import('../../src/main/xapi/services/alert.service')
      resolveAlert('alert-1')

      expect(mockDbResolveAlert).toHaveBeenCalledWith('alert-1')
    })

    it('getAlertCountByStatus delegates to alert-history store', async () => {
      mockDbGetAlertCountByStatus.mockReturnValueOnce({ active: 2, acknowledged: 1, resolved: 5 })

      const { getAlertCountByStatus } = await import('../../src/main/xapi/services/alert.service')
      const counts = getAlertCountByStatus()

      expect(counts).toEqual({ active: 2, acknowledged: 1, resolved: 5 })
    })
  })
})
