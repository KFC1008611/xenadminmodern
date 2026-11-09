/**
 * Unit tests for rrd-uuid-cache.service.ts
 *
 * Tests cache invalidation and TTL logic.
 * Actual XAPI calls are not tested (would require a live server).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
const { callWithSession } = vi.hoisted(() => ({ callWithSession: vi.fn() }))
vi.mock('../../src/main/xapi/connection-manager', () => ({ connectionManager: { getClient: () => ({ callWithSession }) } }))
import {
  getRunningVmUuids,
  invalidateConnection,
  invalidateVm,
  isVmSweepNeeded,
} from '../../src/main/xapi/services/rrd-uuid-cache.service'

describe('rrd-uuid-cache', () => {
  beforeEach(() => {
    // Clear all caches between tests
    invalidateConnection('test-conn-1')
    invalidateConnection('test-conn-2')
    callWithSession.mockReset()
  })

  it('takes valid memory limits from one bulk VM read and excludes stopped and hidden records', async () => {
    const running = { uuid: 'uuid', name_label: 'VM', power_state: 'Running', memory_dynamic_max: '2147483648' }
    callWithSession.mockResolvedValue({ v1: running, v2: { ...running, uuid: 'uuid2', memory_dynamic_max: 'invalid' },
      stopped: { ...running, power_state: 'Halted' }, template: { ...running, is_a_template: true }, dom0: { ...running, is_control_domain: true } })
    expect(await getRunningVmUuids('test-conn-1')).toEqual([
      { vmRef: 'v1', vmUuid: 'uuid', vmName: 'VM', memoryDynamicMax: 2147483648 },
      { vmRef: 'v2', vmUuid: 'uuid2', vmName: 'VM' },
    ])
    expect(callWithSession.mock.calls).toEqual([['VM.get_all_records', []]])
  })

  describe('isVmSweepNeeded', () => {
    it('returns true when no sweep has been done', () => {
      expect(isVmSweepNeeded('test-conn-1')).toBe(true)
    })
  })

  describe('invalidateConnection', () => {
    it('removes all cached data for a connection', () => {
      // After invalidation, sweep should be needed again
      invalidateConnection('test-conn-1')
      expect(isVmSweepNeeded('test-conn-1')).toBe(true)
    })
  })

  describe('invalidateVm', () => {
    it('does not throw for unknown connection/vm', () => {
      expect(() => invalidateVm('nonexistent-conn', 'OpaqueRef:nonexistent')).not.toThrow()
    })
  })
})
