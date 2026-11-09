import { beforeEach, describe, expect, it, vi } from 'vitest'
import { vmRebootContract } from '../../src/shared/ipc-contracts/vm'
import { batchSubmitContract } from '../../src/shared/ipc-contracts/infrastructure'
import { runVmPowerAction } from '../../src/main/xapi/services/vm-power.service'
import { createXapiFailureError, describeTransportError } from '../../src/main/xapi/errors'

const { call, client, info, getClient } = vi.hoisted(() => {
  const call = vi.fn()
  const client = { callWithSession: call }
  return { call, client, info: { poolUuid: 'pool', epoch: 1 }, getClient: vi.fn(() => client) }
})
vi.mock('../../src/main/xapi/connection-manager', () => ({ connectionManager: { getClient, getConnectionInfo: () => info } }))
const record = { uuid: 'vm-uuid', power_state: 'Running', is_a_template: false, is_control_domain: false, current_operations: {}, allowed_operations: ['clean_reboot', 'hard_shutdown', 'pause', 'suspend'] }
beforeEach(() => { call.mockReset(); info.epoch = 1; getClient.mockReturnValue(client) })
function sequence(after = { ...record, power_state: 'Running' }) {
  call.mockResolvedValueOnce(record).mockResolvedValueOnce('OpaqueRef:task').mockResolvedValueOnce({ status: 'success' }).mockResolvedValueOnce(after)
}
describe('VM power lifecycle', () => {
  it.each([
    ['start', 'Halted', 'start', 'Running', [false, false]],
    ['shutdown', 'Running', 'clean_shutdown', 'Halted', []],
    ['reboot', 'Running', 'clean_reboot', 'Running', []],
    ['forceShutdown', 'Paused', 'hard_shutdown', 'Halted', []],
    ['pause', 'Running', 'pause', 'Paused', []],
    ['unpause', 'Paused', 'unpause', 'Running', []],
    ['suspend', 'Running', 'suspend', 'Suspended', []],
    ['resume', 'Suspended', 'resume', 'Running', [false, false]],
  ] as const)('observes %s task and verifies final state', async (action, state, operation, finalState, args) => {
    call.mockResolvedValueOnce({ ...record, power_state: state, allowed_operations: [operation] })
      .mockResolvedValueOnce('OpaqueRef:task').mockResolvedValueOnce({ status: 'success' })
      .mockResolvedValueOnce({ ...record, power_state: finalState })
    await runVmPowerAction('connection', 'OpaqueRef:vm', action)
    expect(call.mock.calls.map(([method]) => method)).toEqual(['VM.get_record', `Async.VM.${operation}`, 'task.get_record', 'VM.get_record'])
    expect(call).toHaveBeenCalledWith(`Async.VM.${operation}`, ['OpaqueRef:vm', ...args])
  })
  it.each([
    { ...record, allowed_operations: [] }, { ...record, blocked_operations: { clean_reboot: '管理员禁止' } },
    { ...record, current_operations: { task: 'start' } }, { ...record, is_a_template: true },
    { ...record, is_a_snapshot: true }, { ...record, locked: true },
  ])('rejects a changed capability before any mutation', async (before) => {
    call.mockResolvedValueOnce(before)
    await expect(runVmPowerAction('connection', 'OpaqueRef:vm', 'reboot')).rejects.toMatchObject({ code: 'VM_POWER_PRECHECK_FAILED' })
    expect(call).toHaveBeenCalledTimes(1)
  })
  it('does not replay a request after a lost submission response', async () => {
    call.mockResolvedValueOnce(record).mockRejectedValueOnce(describeTransportError({ code: 'ECONNRESET' }))
    await expect(runVmPowerAction('connection', 'OpaqueRef:vm', 'reboot')).rejects.toMatchObject({ code: 'VM_POWER_OUTCOME_UNKNOWN' })
    expect(call).toHaveBeenCalledTimes(2)
  })
  it('preserves a definite XAPI rejection without forcing the operation', async () => {
    call.mockResolvedValueOnce(record).mockRejectedValueOnce(createXapiFailureError(['VM_MISSING_PV_DRIVERS']))
    await expect(runVmPowerAction('connection', 'OpaqueRef:vm', 'reboot')).rejects.toMatchObject({ code: 'VM_MISSING_PV_DRIVERS' })
    expect(call).toHaveBeenCalledTimes(2)
  })
  it.each([{ status: 'failure', error_info: ['VM_BAD_POWER_STATE'] }, { status: 'cancelled' }])('does not report a failed or cancelled task as success', async (task) => {
    call.mockResolvedValueOnce(record).mockResolvedValueOnce('OpaqueRef:task').mockResolvedValueOnce(task)
    await expect(runVmPowerAction('connection', 'OpaqueRef:vm', 'reboot')).rejects.toMatchObject({ code: task.status === 'failure' ? 'TASK_FAILED' : 'TASK_CANCELLED' })
    expect(call).toHaveBeenCalledTimes(3)
  })
  it('keeps an unreadable task unknown and never resubmits the mutation', async () => {
    call.mockResolvedValueOnce(record).mockResolvedValueOnce('OpaqueRef:task').mockRejectedValue(new Error('lost task read'))
    await expect(runVmPowerAction('connection', 'OpaqueRef:vm', 'reboot')).rejects.toMatchObject({ code: 'TASK_OUTCOME_UNKNOWN' })
    expect(call.mock.calls.filter(([method]) => method.startsWith('Async.'))).toHaveLength(1)
  })
  it('automatically recovers task and final VM reads without replaying the power action', async () => {
    call.mockResolvedValueOnce(record).mockResolvedValueOnce('OpaqueRef:task')
      .mockRejectedValueOnce(new Error('task temporarily unavailable')).mockResolvedValueOnce({ status: 'success' })
      .mockRejectedValueOnce(new Error('VM temporarily unavailable')).mockResolvedValueOnce(record)
    await expect(runVmPowerAction('connection', 'OpaqueRef:vm', 'reboot')).resolves.toBeUndefined()
    expect(call.mock.calls.filter(([method]) => method.startsWith('Async.'))).toHaveLength(1)
    expect(call.mock.calls.filter(([method]) => method === 'task.get_record')).toHaveLength(2)
  })
  it.each([{ ...record, uuid: 'replacement' }, { ...record, power_state: 'Halted' }])('keeps a mismatched postcondition unknown', async (after) => {
    sequence(after)
    await expect(runVmPowerAction('connection', 'OpaqueRef:vm', 'reboot')).rejects.toMatchObject({ code: 'TASK_OUTCOME_UNKNOWN' })
  })
  it.each([{ vmUuid: 'other-vm' }, { vmUuid: 'vm-uuid', epoch: 0 }, { vmUuid: 'vm-uuid', poolUuid: 'other-pool' }])('rejects intent from another VM or connection before submission', async (intent) => {
    call.mockResolvedValueOnce(record)
    await expect(runVmPowerAction('connection', 'OpaqueRef:vm', 'reboot', intent)).rejects.toMatchObject({ code: 'VM_POWER_PRECHECK_FAILED' })
    expect(call).toHaveBeenCalledTimes(1)
  })
  it('accepts validated power intent and rejects arbitrary extra fields at IPC', () => {
    const intent = { vmUuid: 'vm-uuid', poolUuid: 'pool', epoch: 1 }
    expect(vmRebootContract.argsSchema.parse(['connection', 'OpaqueRef:vm', intent])).toEqual(['connection', 'OpaqueRef:vm', intent])
    expect(() => vmRebootContract.argsSchema.parse(['connection', 'OpaqueRef:vm', { ...intent, extra: true }])).toThrow()
  })
  it('carries identity intent in batch targets through the IPC boundary', () => {
    const target = { connectionId: 'connection', vmRef: 'OpaqueRef:vm', vmName: 'VM', intent: { vmUuid: 'vm-uuid', poolUuid: 'pool', epoch: 1 } }
    expect(batchSubmitContract.argsSchema.parse([{ requestId: 'request-1', type: 'reboot', targets: [target] }])[0].targets[0]).toEqual(target)
  })
  it('rejects replacement connections between the read and submission', async () => {
    call.mockImplementationOnce(async () => { info.epoch++; return record })
    await expect(runVmPowerAction('connection', 'OpaqueRef:vm', 'reboot')).rejects.toMatchObject({ code: 'VM_POWER_PRECHECK_FAILED' })
    expect(call).toHaveBeenCalledTimes(1)
  })
  it('deduplicates one VM reached through two connections to the same pool', async () => {
    let finish!: (value: string) => void
    call.mockImplementation(async (method: string) => {
      if (method === 'VM.get_record') return record
      if (method === 'task.get_record') return { status: 'success' }
      return new Promise<string>((resolve) => { finish = resolve })
    })
    const first = runVmPowerAction('connection-a', 'OpaqueRef:vm', 'reboot')
    await vi.waitFor(() => expect(call).toHaveBeenCalledWith('Async.VM.clean_reboot', ['OpaqueRef:vm']))
    await expect(runVmPowerAction('connection-b', 'OpaqueRef:vm', 'reboot')).rejects.toMatchObject({ code: 'VM_POWER_IN_PROGRESS' })
    finish('OpaqueRef:task')
    await first
    expect(call.mock.calls.filter(([method]) => method.startsWith('Async.'))).toHaveLength(1)
  })
  it('reserves the VM before the first await, preventing duplicate submissions', async () => {
    let resolve!: (value: unknown) => void
    call.mockReturnValueOnce(new Promise((done) => { resolve = done }))
      .mockResolvedValueOnce('OpaqueRef:task').mockResolvedValueOnce({ status: 'success' }).mockResolvedValueOnce(record)
    const first = runVmPowerAction('connection', 'OpaqueRef:vm', 'reboot')
    await expect(runVmPowerAction('connection', 'OpaqueRef:vm', 'reboot')).rejects.toMatchObject({ code: 'VM_POWER_IN_PROGRESS' })
    resolve(record)
    await first
    expect(call.mock.calls.filter(([method]) => method.startsWith('Async.'))).toHaveLength(1)
  })
})
