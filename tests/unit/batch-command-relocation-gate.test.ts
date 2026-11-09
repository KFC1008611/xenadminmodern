import { describe, expect, it } from 'vitest'
import { canRunOperation, executeBatchOperation } from '../../src/main/batch/batch-command.service'

describe('batch relocation safety gate', () => {
  it('rejects precheck and execution before reading or migrating a VM', async () => {
    await expect(canRunOperation('migrate', 'conn-1', 'OpaqueRef:vm')).resolves.toMatchObject({
      canRun: false,
      reason: expect.stringMatching(/不支持批量/),
    })
    await expect(executeBatchOperation({
      type: 'migrate',
      target: { connectionId: 'conn-1', vmRef: 'OpaqueRef:vm', vmName: 'vm-1' },
      options: { targetHostRef: 'OpaqueRef:host' },
    })).resolves.toMatchObject({
      success: false,
      error: expect.stringMatching(/不支持批量/),
    })
  })
})
