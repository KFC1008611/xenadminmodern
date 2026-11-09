import { describe, expect, it } from 'vitest'
import { vmCopyContract } from '../../src/shared/ipc-contracts/vm'
import { vmCopyPlanContract, vmCopyOperationsContract, vmCancelCopyContract } from '../../src/shared/ipc-contracts/vm-copy'
import { copyOperation, copyPlan } from '../helpers/vm-copy-fixtures'
describe('copy operation IPC contracts', () => {
  it('preserves task, result identity and partial-success warnings', () => {
    const operation = { ...copyOperation, status: 'completed', taskRef: 'OpaqueRef:task', vmRef: 'OpaqueRef:copy', vmUuid: 'copy-uuid', warnings: ['description unconfirmed'] }
    expect(vmCopyContract.resultSchema.parse(operation)).toEqual(operation)
    expect(() => vmCopyContract.resultSchema.parse({ ...operation, vmUuid: undefined })).toThrow()
    expect(() => vmCopyContract.resultSchema.parse({ ...operation, targetPoolUuid: undefined })).toThrow()
    expect(() => vmCopyContract.resultSchema.parse('OpaqueRef:copy')).toThrow()
  })
  it('rejects incomplete cross-pool branches and secret-shaped extras', () => {
    const payload = { vmRef: 'OpaqueRef:vm', newName: 'Copy', mode: 'cross-pool-copy', targetConnectionId: 'target', targetHostRef: 'OpaqueRef:host', transferNetworkRef: 'OpaqueRef:net', storageMap: {}, networkMap: {} }
    expect(vmCopyContract.argsSchema.parse(['source', payload])).toEqual(['source', payload])
    expect(() => vmCopyContract.argsSchema.parse(['source', { ...payload, networkMap: undefined }])).toThrow()
    expect(() => vmCopyContract.argsSchema.parse(['source', { ...payload, session: 'secret' }])).toThrow()
    expect(() => vmCopyContract.argsSchema.parse(['source', { vmRef: 'OpaqueRef:vm', newName: 'Copy', mode: 'clone', storageMap: {} }])).toThrow()
  })
  it('validates scoped plans and historical device properties', () => {
    expect(vmCopyPlanContract.argsSchema.parse(['source', 'OpaqueRef:vm', 'target'])).toHaveLength(3)
    expect(vmCopyPlanContract.resultSchema.parse(copyPlan)).toEqual(copyPlan)
    expect(() => vmCopyPlanContract.resultSchema.parse({ ...copyPlan, srs: [{ ...copyPlan.srs[0], freeBytes: -1 }] })).toThrow()
    expect(() => vmCopyPlanContract.resultSchema.parse({ ...copyPlan, unknown: true })).toThrow()
  })
  it('validates list and cancellation identities without accepting arbitrary task references', () => {
    expect(vmCopyOperationsContract.argsSchema.parse([])).toEqual([])
    expect(vmCopyOperationsContract.resultSchema.parse([copyOperation])).toEqual([copyOperation])
    expect(vmCancelCopyContract.argsSchema.parse(['copy-id'])).toEqual(['copy-id'])
    expect(() => vmCancelCopyContract.argsSchema.parse(['copy-id', 'OpaqueRef:task'])).toThrow()
    expect(() => vmCopyOperationsContract.argsSchema.parse(['source'])).toThrow()
  })
})
