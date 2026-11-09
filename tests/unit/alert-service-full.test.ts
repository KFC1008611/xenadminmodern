/**
 * Unit tests for alert.service — verifies XAPI message.* calls and alert event/history operations.
 * Reference: https://xapi-project.github.io/xen-api/ (message class)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCallWithSession = vi.fn()
const mockGetClient = vi.fn(() => ({
  callWithSession: mockCallWithSession,
}))

vi.mock('../../src/main/xapi/connection-manager', () => ({
  connectionManager: {
    getClient: mockGetClient,
    getConnectionInfo: vi.fn(() => ({ poolName: 'Test Pool' })),
  },
}))

// Mock alert-history.db to avoid SQLite dependency
vi.mock('../../src/main/xapi/services/alert-history.db', () => ({
  getAlertHistory: vi.fn(() => [
    { id: '1', ruleId: 'r1', ruleName: 'CPU High', connectionId: 'conn-123', entityRef: 'OpaqueRef:host1', entityName: 'host1', metricType: 'cpu', metricValue: 95, threshold: 90, severity: 'warning', triggeredAt: Date.now(), status: 'active' },
  ]),
  acknowledgeAlert: vi.fn(),
  resolveAlert: vi.fn(),
  getAlertCountByStatus: vi.fn(() => ({ active: 5, acknowledged: 2, resolved: 10 })),
}))

describe('alert.service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ============================================================================
  // getAllAlerts
  // ============================================================================

  describe('getAllAlerts', () => {
    it('returns alerts with severity mapped from priority', async () => {
      mockCallWithSession.mockResolvedValueOnce({
        'OpaqueRef:msg1': {
          uuid: 'uuid-msg1',
          name: 'HOST_OFFLINE',
          priority: 1,
          body: 'Host xcp-1 went offline',
          timestamp: '2026-04-15T10:00:00Z',
          cls: 'Host', // XenAPI message.cls enum: VM/Host/SR/Pool/VMPP
          obj_uuid: 'uuid-host1',
        },
        'OpaqueRef:msg2': {
          uuid: 'uuid-msg2',
          name: 'SR_SPACE_LOW',
          priority: 2,
          body: 'SR local-storage is running low on space',
          timestamp: '2026-04-15T11:00:00Z',
          cls: 'SR', // XenAPI message.cls enum
          obj_uuid: 'uuid-sr1',
        },
        'OpaqueRef:msg3': {
          uuid: 'uuid-msg3',
          name: 'VM_RECOVERED',
          priority: 3,
          body: 'VM test-vm has been recovered',
          timestamp: '2026-04-15T12:00:00Z',
          cls: 'VM', // XenAPI message.cls enum
          obj_uuid: 'uuid-vm1',
        },
      })

      const { getAllAlerts } = await import('../../src/main/xapi/services/alert.service')
      const alerts = await getAllAlerts('conn-123')

      expect(alerts).toHaveLength(3)
      expect(alerts[0].severity).toBe('info') // priority 3, sorted newest first
      expect(alerts[1].severity).toBe('warning') // priority 2
      expect(alerts[2].severity).toBe('error') // priority 1
      expect(alerts.every(a => a.connectionId === 'conn-123')).toBe(true)
    })

    it('filters by severity', async () => {
      mockCallWithSession.mockResolvedValueOnce({
        'OpaqueRef:msg1': { uuid: 'u1', name: 'A1', priority: 1, body: '', timestamp: '2026-04-15T10:00:00Z', cls: '', obj_uuid: '' },
        'OpaqueRef:msg2': { uuid: 'u2', name: 'A2', priority: 3, body: '', timestamp: '2026-04-15T11:00:00Z', cls: '', obj_uuid: '' },
      })

      const { getAllAlerts } = await import('../../src/main/xapi/services/alert.service')
      const alerts = await getAllAlerts('conn-123', { severity: ['error'] })

      expect(alerts).toHaveLength(1)
      expect(alerts[0].severity).toBe('error')
    })

    it('filters by time range', async () => {
      const t1 = new Date('2026-04-15T10:00:00Z').getTime()
      const t2 = new Date('2026-04-15T12:00:00Z').getTime()
      const t3 = new Date('2026-04-15T14:00:00Z').getTime()

      mockCallWithSession.mockResolvedValueOnce({
        'OpaqueRef:msg1': { uuid: 'u1', name: 'A1', priority: 1, body: '', timestamp: '2026-04-15T10:00:00Z', cls: '', obj_uuid: '' },
        'OpaqueRef:msg2': { uuid: 'u2', name: 'A2', priority: 2, body: '', timestamp: '2026-04-15T12:00:00Z', cls: '', obj_uuid: '' },
        'OpaqueRef:msg3': { uuid: 'u3', name: 'A3', priority: 3, body: '', timestamp: '2026-04-15T14:00:00Z', cls: '', obj_uuid: '' },
      })

      const { getAllAlerts } = await import('../../src/main/xapi/services/alert.service')
      const since = t1 + 1
      const until = t3 - 1
      const alerts = await getAllAlerts('conn-123', { since, until })

      // Only the middle alert should be in range
      expect(alerts).toHaveLength(1)
    })

    it('filters by objUuid', async () => {
      mockCallWithSession.mockResolvedValueOnce({
        'OpaqueRef:msg1': { uuid: 'u1', name: 'A1', priority: 1, body: '', timestamp: '2026-04-15T10:00:00Z', cls: '', obj_uuid: 'uuid-host1' },
        'OpaqueRef:msg2': { uuid: 'u2', name: 'A2', priority: 2, body: '', timestamp: '2026-04-15T11:00:00Z', cls: '', obj_uuid: 'uuid-host2' },
      })

      const { getAllAlerts } = await import('../../src/main/xapi/services/alert.service')
      const alerts = await getAllAlerts('conn-123', { objUuid: 'uuid-host1' })

      expect(alerts).toHaveLength(1)
      expect(alerts[0].objUuid).toBe('uuid-host1')
    })

    it('sorts alerts by timestamp descending', async () => {
      mockCallWithSession.mockResolvedValueOnce({
        'OpaqueRef:msg1': { uuid: 'u1', name: 'Old Alert', priority: 1, body: '', timestamp: '2026-04-14T10:00:00Z', cls: '', obj_uuid: '' },
        'OpaqueRef:msg2': { uuid: 'u2', name: 'New Alert', priority: 1, body: '', timestamp: '2026-04-16T10:00:00Z', cls: '', obj_uuid: '' },
      })

      const { getAllAlerts } = await import('../../src/main/xapi/services/alert.service')
      const alerts = await getAllAlerts('conn-123')

      expect(alerts[0].name).toBe('New Alert')
      expect(alerts[1].name).toBe('Old Alert')
    })

    it('throws when connectionId is invalid', async () => {
      mockGetClient.mockReturnValueOnce(undefined)

      const { getAllAlerts } = await import('../../src/main/xapi/services/alert.service')
      await expect(getAllAlerts('invalid-id')).rejects.toThrow('No connection found')
    })
  })

  // ============================================================================
  // dismissAlert
  // ============================================================================

  describe('dismissAlert', () => {
    it('calls message.destroy for the alert ref', async () => {
      mockCallWithSession.mockResolvedValueOnce(null)

      const { dismissAlert } = await import('../../src/main/xapi/services/alert.service')
      await dismissAlert('conn-123', 'OpaqueRef:msg1')

      expect(mockCallWithSession).toHaveBeenCalledWith('message.destroy', ['OpaqueRef:msg1'])
    })

    it('silently ignores HANDLE_INVALID error', async () => {
      const error = new Error('HANDLE_INVALID')
      ;(error as any).faultString = 'HANDLE_INVALID'
      mockCallWithSession.mockRejectedValueOnce(error)

      const { dismissAlert } = await import('../../src/main/xapi/services/alert.service')
      await expect(dismissAlert('conn-123', 'OpaqueRef:msg1')).resolves.not.toThrow()
    })

    it('propagates other errors', async () => {
      mockCallWithSession.mockRejectedValueOnce(new Error('PERMISSION_DENIED'))

      const { dismissAlert } = await import('../../src/main/xapi/services/alert.service')
      await expect(dismissAlert('conn-123', 'OpaqueRef:msg1')).rejects.toThrow('PERMISSION_DENIED')
    })
  })

  // ============================================================================
  // dismissAllAlerts
  // ============================================================================

  describe('dismissAllAlerts', () => {
    it('dismisses all matching alerts and returns count', async () => {
      mockCallWithSession
        .mockResolvedValueOnce({ // getAllAlerts
          'OpaqueRef:msg1': { uuid: 'u1', name: 'A1', priority: 1, body: '', timestamp: '2026-04-15T10:00:00Z', cls: '', obj_uuid: '' },
          'OpaqueRef:msg2': { uuid: 'u2', name: 'A2', priority: 2, body: '', timestamp: '2026-04-15T11:00:00Z', cls: '', obj_uuid: '' },
        })
        .mockResolvedValueOnce(null) // dismiss msg1
        .mockResolvedValueOnce(null) // dismiss msg2

      const { dismissAllAlerts } = await import('../../src/main/xapi/services/alert.service')
      const count = await dismissAllAlerts('conn-123')

      expect(count).toBe(2)
    })

    it('reports partial dismissal after continuing independent items', async () => {
      mockCallWithSession
        .mockResolvedValueOnce({ // getAllAlerts
          'OpaqueRef:msg1': { uuid: 'u1', name: 'A1', priority: 1, body: '', timestamp: '2026-04-15T10:00:00Z', cls: '', obj_uuid: '' },
          'OpaqueRef:msg2': { uuid: 'u2', name: 'A2', priority: 2, body: '', timestamp: '2026-04-15T11:00:00Z', cls: '', obj_uuid: '' },
        })
        .mockRejectedValueOnce(new Error('PERMISSION_DENIED')) // dismiss msg1 fails
        .mockResolvedValueOnce(null) // dismiss msg2 succeeds

      const { dismissAllAlerts } = await import('../../src/main/xapi/services/alert.service')
      await expect(dismissAllAlerts('conn-123')).rejects.toThrow('ALERT_DISMISS_PARTIAL')
      expect(mockCallWithSession.mock.calls.filter(([method]) => method === 'message.destroy')).toHaveLength(2)
    })
  })

  // ============================================================================
  // Alert event emitter
  // ============================================================================

  describe('alertEmitter', () => {
    it('emits and receives alertTriggered events', async () => {
      const { alertEmitter, onAlertTriggered, removeAlertTriggeredListener } = await import('../../src/main/xapi/services/alert.service')
      const callback = vi.fn()
      const record = { id: '1', ruleId: 'r1', ruleName: 'CPU High', connectionId: 'conn-123', entityRef: 'OpaqueRef:host1', entityName: 'host1', metricType: 'cpu', metricValue: 95, threshold: 90, severity: 'warning' as const, triggeredAt: Date.now(), status: 'active' as const }

      onAlertTriggered(callback)
      alertEmitter.emit('alertTriggered', record)

      expect(callback).toHaveBeenCalledWith(record)

      removeAlertTriggeredListener(callback)
    })
  })

  // ============================================================================
  // Alert history operations (delegates to DB)
  // ============================================================================

  describe('getAlertHistory', () => {
    it('delegates to dbGetAlertHistory', async () => {
      const { getAlertHistory } = await import('../../src/main/xapi/services/alert.service')
      const history = getAlertHistory()

      expect(history).toHaveLength(1)
      expect(history[0].ruleName).toBe('CPU High')
    })
  })

  describe('acknowledgeAlert', () => {
    it('delegates to dbAcknowledgeAlert', async () => {
      const { acknowledgeAlert } = await import('../../src/main/xapi/services/alert.service')
      acknowledgeAlert('alert-1')

      const { acknowledgeAlert: dbAck } = await import('../../src/main/xapi/services/alert-history.db')
      expect(dbAck).toHaveBeenCalledWith('alert-1')
    })
  })

  describe('resolveAlert', () => {
    it('delegates to dbResolveAlert', async () => {
      const { resolveAlert } = await import('../../src/main/xapi/services/alert.service')
      resolveAlert('alert-1')

      const { resolveAlert: dbResolve } = await import('../../src/main/xapi/services/alert-history.db')
      expect(dbResolve).toHaveBeenCalledWith('alert-1')
    })
  })

  describe('getAlertCountByStatus', () => {
    it('delegates to dbGetAlertCountByStatus', async () => {
      const { getAlertCountByStatus } = await import('../../src/main/xapi/services/alert.service')
      const counts = getAlertCountByStatus()

      expect(counts.active).toBe(5)
      expect(counts.acknowledged).toBe(2)
      expect(counts.resolved).toBe(10)
    })
  })
})
