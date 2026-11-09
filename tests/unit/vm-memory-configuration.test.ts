import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getVmRecord, setVmMemoryLimits, setVmNameLabel } from '../../src/main/xapi/services/vm.service'
import { GIB } from '../../src/shared/vm-memory'

const { call } = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../../src/main/xapi/connection-manager', () => ({
  connectionManager: { getClient: vi.fn(() => ({ callWithSession: call })) },
}))
const base = {
  power_state: 'Halted', memory_static_min: String(GIB / 4), memory_dynamic_min: String(GIB),
  memory_dynamic_max: String(2 * GIB), memory_static_max: String(4 * GIB),
  allowed_operations: ['changing_memory_limits', 'changing_dynamic_range'], current_operations: {},
  is_control_domain: false, is_a_template: false, is_a_snapshot: false,
  guest_metrics: 'OpaqueRef:NULL', metrics: 'OpaqueRef:metrics',
}
beforeEach(() => { call.mockReset(); call.mockResolvedValue(undefined) })

describe('VM memory configuration', () => {
  it('changes halted static limits in XAPI parameter order and preserves the static minimum', async () => {
    call.mockResolvedValueOnce(base)
    await setVmMemoryLimits('pool-a', 'OpaqueRef:vm', GIB / 4, GIB / 2, GIB / 2, GIB / 2)
    expect(call.mock.calls).toEqual([
      ['VM.get_record', ['OpaqueRef:vm']],
      ['VM.set_memory_limits', ['OpaqueRef:vm', String(GIB / 4), String(GIB / 2), String(GIB / 2), String(GIB / 2)]],
    ])
  })
  it.each(['Running', 'Halted'])('uses dynamic range when static limits are unchanged (%s)', async (power_state) => {
    call.mockResolvedValueOnce({ ...base, power_state })
    await setVmMemoryLimits('pool-a', 'OpaqueRef:vm', GIB / 4, GIB / 2, 3 * GIB, 4 * GIB)
    expect(call).toHaveBeenLastCalledWith('VM.set_memory_dynamic_range', ['OpaqueRef:vm', String(GIB / 2), String(3 * GIB)])
    expect(call).toHaveBeenCalledTimes(2)
  })
  it('does not mutate an unchanged configuration', async () => {
    call.mockResolvedValueOnce(base)
    await setVmMemoryLimits('pool-a', 'OpaqueRef:vm', GIB / 4, GIB, 2 * GIB, 4 * GIB)
    expect(call).toHaveBeenCalledTimes(1)
  })
  it('rechecks power state before changing a static limit', async () => {
    call.mockResolvedValueOnce({ ...base, power_state: 'Running' })
    await expect(setVmMemoryLimits('pool-a', 'OpaqueRef:vm', GIB / 4, GIB, 2 * GIB, 6 * GIB)).rejects.toThrow('关')
    expect(call).toHaveBeenCalledTimes(1)
  })
  it('rejects changing the static minimum', async () => {
    call.mockResolvedValueOnce(base)
    await expect(setVmMemoryLimits('pool-a', 'OpaqueRef:vm', 0, GIB, 3 * GIB, 4 * GIB)).rejects.toThrow('静态内存下限')
    expect(call).toHaveBeenCalledTimes(1)
  })
  it.each([
    { power_state: 'Paused' }, { power_state: 'Suspended' }, { allowed_operations: [] },
    { allowed_operations: undefined }, { blocked_operations: { changing_dynamic_range: 'blocked' } },
    { locked: true }, { current_operations: { task: 'migrate' } },
    { is_control_domain: true }, { is_a_template: true }, { is_a_snapshot: true },
  ])('rejects a prohibited runtime edit: %j', async (override) => {
    call.mockResolvedValueOnce({ ...base, ...override })
    await expect(setVmMemoryLimits('pool-a', 'OpaqueRef:vm', GIB / 4, GIB, 3 * GIB, 4 * GIB)).rejects.toThrow()
    expect(call).toHaveBeenCalledTimes(1)
  })
  it.each([
    [0, 0, 0, 0], [0, 0.5, 2, 3], [0, 1, 2, Infinity], [0, 1, 2, NaN],
    [0, 1, 2, Number.MAX_SAFE_INTEGER + 1], [-1, 1, 2, 3], [0, 3, 2, 4],
  ])('rejects invalid byte values before calling XAPI: %j %j %j %j', async (...limits) => {
    await expect(setVmMemoryLimits('pool-a', 'OpaqueRef:vm', ...limits as [number, number, number, number])).rejects.toThrow()
    expect(call).not.toHaveBeenCalled()
  })
  it('reads actual allocation from VM_metrics independently of guest metrics', async () => {
    call.mockResolvedValueOnce({ ...base, power_state: 'Running' }).mockResolvedValueOnce({ memory_actual: String(1.5 * GIB) })
    const vm = await getVmRecord('pool-a', 'OpaqueRef:vm')
    expect(vm.memory_actual).toBe(1.5 * GIB)
    expect(call).toHaveBeenLastCalledWith('VM_metrics.get_record', ['OpaqueRef:metrics'])
  })
  it('keeps memory configuration available when allocation metrics cannot be read', async () => {
    call.mockResolvedValueOnce({ ...base, power_state: 'Running' }).mockRejectedValueOnce(new Error('unavailable'))
    const vm = await getVmRecord('pool-a', 'OpaqueRef:vm')
    expect(vm.memory_actual).toBeUndefined()
    expect(vm.memory_static_max).toBe(4 * GIB)
  })
  it('does not report stale runtime allocation for a halted VM', async () => {
    call.mockResolvedValueOnce(base)
    expect((await getVmRecord('pool-a', 'OpaqueRef:vm')).memory_actual).toBeUndefined()
    expect(call).toHaveBeenCalledTimes(1)
  })
  it('rejects a blank VM name at the service boundary', async () => {
    await expect(setVmNameLabel('pool-a', 'OpaqueRef:vm', '  ')).rejects.toThrow('名称不能为空')
    expect(call).not.toHaveBeenCalled()
  })
})
