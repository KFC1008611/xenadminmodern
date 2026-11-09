// These assertions reproduce current defects; passing does not mean the defects are fixed.
import { beforeEach, expect, it, vi } from 'vitest'
import { executeBatchOperation, precheckBatchOperation } from '../../../../src/main/batch/batch-command.service'
import { connectionManager } from '../../../../src/main/xapi/connection-manager'
import { snapshotVm } from '../../../../src/main/xapi/services/vm.service'

vi.mock('../../../../src/main/xapi/connection-manager', () => ({ connectionManager: { getClient: vi.fn() } }))
vi.mock('../../../../src/main/xapi/services/vm.service', () => ({
  startVm: vi.fn(), shutdownVm: vi.fn(), forceShutdownVm: vi.fn(), rebootVm: vi.fn(),
  suspendVm: vi.fn(), resumeVm: vi.fn(), destroyVm: vi.fn(), snapshotVm: vi.fn(),
}))

beforeEach(() => vi.resetAllMocks())

it('reproduces 120 simultaneous prechecks outside the five-worker execution queue', async () => {
  let inFlight = 0
  let peak = 0
  const release: Array<() => void> = []
  const callWithSession = vi.fn(() => new Promise((resolve) => {
    peak = Math.max(peak, ++inFlight)
    release.push(() => { inFlight--; resolve({ uuid: 'vm', power_state: 'Halted', allowed_operations: ['start'] }) })
  }))
  vi.mocked(connectionManager.getClient).mockReturnValue({ callWithSession } as any)
  const targets = Array.from({ length: 120 }, (_, i) => ({ connectionId: 'pool', vmRef: `OpaqueRef:${i}`, vmName: `VM ${i}` }))
  const precheck = precheckBatchOperation('start', targets)
  expect(peak).toBe(120)
  release.forEach((done) => done())
  expect((await precheck).size).toBe(120)
})

it('reproduces snapshot dispatch despite an explicitly different confirmed VM UUID', async () => {
  vi.mocked(connectionManager.getClient).mockReturnValue({
    callWithSession: vi.fn().mockResolvedValue({ uuid: 'different-vm', power_state: 'Halted', allowed_operations: ['snapshot'] }),
  } as any)
  vi.mocked(snapshotVm).mockResolvedValue('OpaqueRef:new-snapshot')
  const result = await executeBatchOperation({
    type: 'snapshot', options: { snapshotName: 'before-change' },
    target: { connectionId: 'pool', vmRef: 'OpaqueRef:vm', vmName: 'Confirmed VM', intent: { vmUuid: 'confirmed-vm', poolUuid: 'confirmed-pool', epoch: 1 } },
  })
  expect(result).toEqual({ success: true })
  expect(snapshotVm).toHaveBeenCalledWith('pool', 'OpaqueRef:vm', 'before-change')
})

it('reproduces a successful batch result for an invalid snapshot reference', async () => {
  vi.mocked(connectionManager.getClient).mockReturnValue({
    callWithSession: vi.fn().mockResolvedValue({ uuid: 'vm', power_state: 'Halted', allowed_operations: ['snapshot'] }),
  } as any)
  vi.mocked(snapshotVm).mockResolvedValue('')
  expect(await executeBatchOperation({
    type: 'snapshot', target: { connectionId: 'pool', vmRef: 'OpaqueRef:vm', vmName: 'VM' },
  })).toEqual({ success: true })
})
