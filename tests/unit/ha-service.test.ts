import { beforeEach, describe, expect, it, vi } from 'vitest'
const { call, getClient } = vi.hoisted(() => ({ call: vi.fn(), getClient: vi.fn() }))
vi.mock('../../src/main/xapi/connection-manager', () => ({ connectionManager: {
  getClient, getConnectionInfo: () => ({ poolName: 'Lab' }),
} }))
import * as ha from '../../src/main/xapi/services/ha.service'
import { haComputeToleranceContract, haGetVmConfigsContract } from '../../src/shared/ipc-contracts/ha-governance'

beforeEach(() => { call.mockReset(); getClient.mockReturnValue({ callWithSession: call }) })

describe('HA Published API contracts', () => {
  it('preserves integer failure tolerance through the real service and IPC schema', async () => {
    call.mockResolvedValue(2)
    const result = haComputeToleranceContract.resultSchema.parse(await ha.computeHaTolerance('c'))
    expect(result).toEqual({ canHandleHostFailures: 2, vmsThatCouldBeRestarted: null, vmsThatWouldNotBeRestarted: null })
    expect(call).toHaveBeenCalledWith('pool.ha_compute_max_host_failures_to_tolerate', [])
  })
  it.each([{}, '2', -1, 1.5, null])('rejects malformed tolerance %j instead of claiming zero', async (value) => {
    call.mockResolvedValue(value)
    await expect(ha.computeHaTolerance('c')).rejects.toThrow('HA_CONTRACT_MISMATCH')
  })
  it('resolves heartbeat VDIs to SRs and derives liveness from host_metrics', async () => {
    call.mockImplementation(async (method, args) => ({
      'pool.get_all': ['OpaqueRef:pool'],
      'pool.get_record': { ha_enabled: true, ha_allow_overcommit: false, ha_plan_exists_for: 2, ha_statefiles: ['statefile-uuid'] },
      'host.get_all_records': { 'OpaqueRef:host': { name_label: 'host', metrics: 'OpaqueRef:metrics' }, 'OpaqueRef:unknown': { name_label: 'unknown', metrics: 'OpaqueRef:missing' } },
      'host_metrics.get_all_records': { 'OpaqueRef:metrics': { live: true } },
      'VDI.get_by_uuid': 'OpaqueRef:statefile', 'VDI.get_record': { SR: 'OpaqueRef:sr' },
    })[method])
    const result = await ha.getHaConfiguration('c')
    expect(result).toMatchObject({ enabled: true, heartbeatSRs: ['OpaqueRef:sr'], hosts: [
      { live: true, failed: false, failureMode: 'unknown' }, { live: null, failed: null, failureMode: 'unknown' },
    ] })
    expect(call).not.toHaveBeenCalledWith('host.get_ha_state', expect.anything())
  })
  it('returns null only for a genuinely empty pool inventory', async () => {
    call.mockResolvedValueOnce([])
    expect(await ha.getHaConfiguration('c')).toBeNull()
  })
  it('propagates unreadable host metrics instead of hiding hosts', async () => {
    call.mockResolvedValueOnce(['OpaqueRef:pool']).mockResolvedValueOnce({}).mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('SESSION_INVALID'))
    await expect(ha.getHaConfiguration('c')).rejects.toThrow('SESSION_INVALID')
  })
  it('uses string restart policies and excludes snapshots, templates, and control domains', async () => {
    call.mockResolvedValue({
      'OpaqueRef:a': { name_label: 'a', ha_restart_priority: 'restart', ha_always_run: true },
      'OpaqueRef:b': { name_label: 'b', ha_restart_priority: 'best-effort' },
      'OpaqueRef:c': { name_label: 'c', ha_restart_priority: '' },
      'OpaqueRef:t': { is_a_template: true }, 'OpaqueRef:s': { is_a_snapshot: true }, 'OpaqueRef:d': { is_control_domain: true },
    })
    const configs = haGetVmConfigsContract.resultSchema.parse(await ha.getHaVmConfigs('c'))
    expect(configs.map((vm) => vm.restartPriority)).toEqual(['restart', 'best-effort', ''])
  })
  it('rejects legacy numeric or unknown policies', async () => {
    call.mockResolvedValue({ 'OpaqueRef:a': { ha_restart_priority: '3' } })
    await expect(ha.getHaVmConfigs('c')).rejects.toThrow('HA_CONTRACT_MISMATCH')
  })
  it.each(['', 'restart', 'best-effort'] as const)('writes the exact policy %j', async (policy) => {
    await ha.setHaVmRestartPriority('c', 'OpaqueRef:vm', policy)
    expect(call).toHaveBeenCalledWith('VM.set_ha_restart_priority', ['OpaqueRef:vm', policy])
  })
  it('groups policy summaries without claiming a VM placement plan', async () => {
    call.mockResolvedValueOnce({ 'OpaqueRef:a': { ha_restart_priority: 'restart' }, 'OpaqueRef:b': { ha_restart_priority: '' }, 'OpaqueRef:c': { ha_restart_priority: 'best-effort' } }).mockResolvedValueOnce(2)
    const result = await ha.getHaFailoverPlan('c')
    expect(result.canTolerateFailures).toBe(2)
    expect(result.vmsByPriority.map((group) => group.priority)).toEqual(['restart', 'best-effort'])
  })
  it('does not turn a failed calculation into a zero-failure plan', async () => {
    call.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('SESSION_INVALID'))
    await expect(ha.getHaFailoverPlan('c')).rejects.toThrow('SESSION_INVALID')
  })
  it('enables HA with heartbeat SR references', async () => {
    call.mockResolvedValueOnce(['OpaqueRef:pool']).mockResolvedValueOnce({ ha_allow_overcommit: false })
    await ha.enableHa('c', { heartbeatSRs: ['OpaqueRef:sr'], allowOvercommit: true })
    expect(call.mock.calls.slice(-2)).toEqual([['pool.set_ha_allow_overcommit', ['OpaqueRef:pool', true]], ['pool.enable_ha', [['OpaqueRef:sr'], {}]]])
  })
  it('does not blindly roll back settings after a lost enable response', async () => {
    call.mockResolvedValueOnce(['OpaqueRef:pool']).mockResolvedValueOnce({ ha_allow_overcommit: false }).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('ETIMEDOUT'))
    await expect(ha.enableHa('c', { heartbeatSRs: ['OpaqueRef:sr'], allowOvercommit: true })).rejects.toThrow('ETIMEDOUT')
    expect(call.mock.calls.filter(([method]) => method === 'pool.set_ha_allow_overcommit')).toHaveLength(1)
  })
  it('rejects enabling without a pool', async () => {
    call.mockResolvedValueOnce([])
    await expect(ha.enableHa('c', { heartbeatSRs: [] })).rejects.toThrow('POOL_NOT_FOUND')
  })
  it('resumes restart policy with zero seconds', async () => {
    await ha.haAlwaysRestart('c')
    expect(call).toHaveBeenCalledWith('pool.ha_prevent_restarts_for', [0])
  })
  it('keeps disable, emergency, and legacy always-run RPCs explicit', async () => {
    await ha.disableHa('c'); await ha.emergencyTransitionToMaster('c'); await ha.recoverHaSlaves('c'); await ha.setHaVmAlwaysRun('c', 'OpaqueRef:vm', false)
    expect(call.mock.calls.map(([method]) => method)).toEqual(['pool.disable_ha', 'pool.emergency_transition_to_master', 'pool.recover_slaves', 'VM.set_ha_always_run'])
    call.mockResolvedValueOnce({ ha_always_run: true }); expect(await ha.getHaVmAlwaysRun('c', 'OpaqueRef:vm')).toBe(true)
  })
  it('rejects an absent connection before RPC', async () => {
    getClient.mockReturnValue(undefined)
    await expect(ha.computeHaTolerance('missing')).rejects.toThrow('No connection')
    expect(call).not.toHaveBeenCalled()
  })
})
