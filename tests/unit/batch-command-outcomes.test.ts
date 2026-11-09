import { beforeEach, describe, expect, it, vi } from 'vitest'
import { executeBatchOperation, precheckBatchOperation } from '../../src/main/batch/batch-command.service'
import { connectionManager } from '../../src/main/xapi/connection-manager'
import { shutdownVm, startVm, rebootVm, suspendVm, resumeVm, pauseVm, unpauseVm, snapshotVm, destroyVm } from '../../src/main/xapi/services/vm.service'
import { createXapiFailureError, describeTransportError, createXapiContractMismatchError } from '../../src/main/xapi/errors'
vi.mock('../../src/main/xapi/connection-manager', () => ({ connectionManager: { getClient: vi.fn(), getConnectionInfo: vi.fn() } }))
vi.mock('../../src/main/xapi/services/vm.service', () => ({ startVm: vi.fn(), shutdownVm: vi.fn(), rebootVm: vi.fn(), suspendVm: vi.fn(), resumeVm: vi.fn(), pauseVm: vi.fn(), unpauseVm: vi.fn(), snapshotVm: vi.fn(), destroyVm: vi.fn() }))
const target = { connectionId: 'pool-1', vmRef: 'OpaqueRef:vm', vmName: 'vm', intent: { vmUuid: 'vm', poolUuid: 'pool', epoch: 1 } }
const call = vi.fn()
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(connectionManager.getClient).mockReturnValue({ callWithSession: call } as any)
  vi.mocked(connectionManager.getConnectionInfo).mockReturnValue({ poolUuid: 'pool', epoch: 1 } as any)
  call.mockResolvedValue({ uuid: 'vm', power_state: 'Halted', allowed_operations: ['start'] })
})
describe('batch mutation outcomes and scope', () => {
  it('deletes eligible disks by default and preserves an explicit opt-out', async () => {
    call.mockResolvedValue({ uuid: 'vm', power_state: 'Halted', allowed_operations: ['destroy'] })
    vi.mocked(destroyVm).mockResolvedValue({ vmDeleted: true, failedVdiRefs: [] })
    expect(await executeBatchOperation({ type: 'delete', target })).toEqual({ success: true })
    expect(destroyVm).toHaveBeenLastCalledWith('pool-1', 'OpaqueRef:vm', { deleteDisks: true, intent: target.intent })
    await executeBatchOperation({ type: 'delete', target, options: { deleteDisks: false } })
    expect(destroyVm).toHaveBeenLastCalledWith('pool-1', 'OpaqueRef:vm', { deleteDisks: false, intent: target.intent })
  })
  it('reports disk cleanup failure as a partial deletion without claiming full success', async () => {
    call.mockResolvedValue({ uuid: 'vm', power_state: 'Halted', allowed_operations: ['destroy'] })
    vi.mocked(destroyVm).mockResolvedValue({ vmDeleted: true, failedVdiRefs: ['OpaqueRef:disk'] })
    expect(await executeBatchOperation({ type: 'delete', target })).toMatchObject({ success: false, error: expect.stringContaining('VM 已删除') })
  })
  it.each([
    { power_state: 'Running', allowed_operations: ['destroy'] },
    { power_state: 'Halted', allowed_operations: [] },
    { power_state: 'Halted', allowed_operations: ['destroy'], locked: true },
    { power_state: 'Halted', allowed_operations: ['destroy'], current_operations: { task: 'snapshot' } },
    { power_state: 'Halted', allowed_operations: ['destroy'], blocked_operations: { destroy: 'protected' } },
    { power_state: 'Halted', allowed_operations: ['destroy'], is_a_template: true },
  ])('rejects ineligible deletion before calling the service: %o', async (record) => {
    call.mockResolvedValue({ uuid: 'vm', ...record })
    expect(await executeBatchOperation({ type: 'delete', target })).toMatchObject({ success: false })
    expect(destroyVm).not.toHaveBeenCalled()
  })
  it('creates snapshots with the frozen target identity', async () => {
    call.mockResolvedValue({ uuid: 'vm', power_state: 'Running', allowed_operations: ['snapshot'] })
    expect(await executeBatchOperation({ type: 'snapshot', target, options: { snapshotName: 'before-change' } })).toEqual({ success: true })
    expect(snapshotVm).toHaveBeenCalledWith('pool-1', 'OpaqueRef:vm', 'before-change', target.intent)
  })
  it.each(['migrate'] as const)('never dispatches removed %s operations, including old history', async (type) => {
    expect(await executeBatchOperation({ type, target })).toMatchObject({ success: false, error: expect.stringContaining('不支持批量') })
    expect(call).not.toHaveBeenCalled()
  })
  it('never upgrades batch shutdown to force, even through a legacy option', async () => {
    expect(await executeBatchOperation({ type: 'stop', target, options: { force: true } })).toMatchObject({ success: false, error: expect.stringContaining('不支持强制断电') })
    expect(call).not.toHaveBeenCalled()
    expect(shutdownVm).not.toHaveBeenCalled()
  })
  it.each([
    ['start', 'Halted', 'start', startVm], ['stop', 'Running', 'clean_shutdown', shutdownVm],
    ['reboot', 'Running', 'clean_reboot', rebootVm], ['suspend', 'Running', 'suspend', suspendVm], ['resume', 'Suspended', 'resume', resumeVm], ['pause', 'Running', 'pause', pauseVm], ['unpause', 'Paused', 'unpause', unpauseVm],
  ] as const)('delegates %s only after identity and ability checks', async (type, state, operation, service) => {
    call.mockResolvedValue({ uuid: 'vm', power_state: state, allowed_operations: [operation] })
    expect(await executeBatchOperation({ type, target })).toEqual({ success: true })
    expect(service).toHaveBeenCalledWith('pool-1', 'OpaqueRef:vm', target.intent)
  })
  it.each([describeTransportError({ code: 'ECONNRESET', message: 'lost reply' }), createXapiContractMismatchError()])('keeps an unconfirmed mutation outcome unknown', async (error) => {
    vi.mocked(startVm).mockRejectedValueOnce(error)
    expect(await executeBatchOperation({ type: 'start', target })).toMatchObject({ success: false, unknown: true })
  })
  it('keeps an explicit server rejection retryable', async () => {
    vi.mocked(startVm).mockRejectedValueOnce(createXapiFailureError(['VM_BAD_POWER_STATE']))
    expect(await executeBatchOperation({ type: 'start', target })).toMatchObject({ success: false, unknown: false })
  })
  it('rejects missing identity before reading', async () => {
    expect(await executeBatchOperation({ type: 'start', target: { ...target, intent: undefined } })).toMatchObject({ success: false })
    expect(call).not.toHaveBeenCalled()
  })
  it('rejects a different VM UUID even if its power state already satisfies the request', async () => {
    call.mockResolvedValue({ uuid: 'different-vm', power_state: 'Running' })
    expect(await executeBatchOperation({ type: 'start', target })).toMatchObject({ success: false, error: expect.stringContaining('已变化') })
    expect(startVm).not.toHaveBeenCalled()
  })
  it('rejects a connection replacement during the precheck', async () => {
    call.mockImplementationOnce(async () => {
      vi.mocked(connectionManager.getConnectionInfo).mockReturnValue({ poolUuid: 'pool', epoch: 2 } as any)
      return { uuid: 'vm', power_state: 'Halted', allowed_operations: ['start'] }
    })
    expect(await executeBatchOperation({ type: 'start', target })).toMatchObject({ success: false, error: expect.stringContaining('已变化') })
    expect(startVm).not.toHaveBeenCalled()
  })
  it('skips an already satisfied state only after verifying the target identity', async () => {
    call.mockResolvedValue({ uuid: 'vm', power_state: 'Running' })
    expect(await executeBatchOperation({ type: 'start', target })).toMatchObject({ success: true, skipped: true })
    expect(startVm).not.toHaveBeenCalled()
  })
  it('cancels during the precheck without submitting a mutation', async () => {
    let release!: (value: unknown) => void
    call.mockReturnValueOnce(new Promise((resolve) => { release = resolve }))
    const controller = new AbortController()
    const result = executeBatchOperation({ type: 'start', target, signal: controller.signal })
    controller.abort()
    release({ uuid: 'vm', power_state: 'Halted', allowed_operations: ['start'] })
    expect(await result).toMatchObject({ success: false, cancelled: true })
    expect(startVm).not.toHaveBeenCalled()
  })
  it('bounds an explicit preview to five reads for 120 VMs', async () => {
    let active = 0, peak = 0
    call.mockImplementation(async (_method, [ref]) => {
      peak = Math.max(peak, ++active)
      await Promise.resolve()
      active--
      return { uuid: ref, power_state: 'Halted', allowed_operations: ['start'] }
    })
    const targets = Array.from({ length: 120 }, (_, i) => ({ ...target, vmRef: 'OpaqueRef:' + i, intent: { ...target.intent, vmUuid: 'OpaqueRef:' + i } }))
    expect((await precheckBatchOperation('start', targets)).size).toBe(120)
    expect(peak).toBe(5)
  })
})
