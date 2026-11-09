import { describe, expect, it } from 'vitest'
import * as Ch from '../../src/shared/channels'
import {
  patchApplyBatchContract,
  patchApplyContract,
  patchApplyToHostContract,
  patchCleanContract,
  patchDestroyContract,
  patchDestroyFromHostContract,
  patchGetHostStatusContract,
  patchGetMissingContract,
  patchGetRecordContract,
  patchGovernanceContracts,
  patchListContract,
  patchPrecheckContract,
  patchUploadContract,
} from '../../src/shared/ipc-contracts/patch-governance'

const patchRecord = {
  ref: 'OpaqueRef:patch',
  uuid: 'patch-uuid',
  name_label: 'Security update',
  name_description: '',
  size: 1024,
  version: '1.2.3',
  update_url: 'https://updates.example.test/patch',
  applied: false,
  after_apply_guides: ['restartHost'],
  upload_date: new Date('2026-08-01T00:00:00Z'),
  hosts: ['OpaqueRef:host'],
  connectionId: 'pool-1',
  poolName: 'Lab Pool',
}

const applyResult = {
  patchRef: 'OpaqueRef:patch',
  success: true,
  hostResults: [{
    hostRef: 'OpaqueRef:host',
    hostName: 'xcp-1',
    success: true,
  }],
}

function expectRejected(schema: { parse(value: unknown): unknown }, values: unknown[]): void {
  for (const value of values) expect(() => schema.parse(value)).toThrow()
}

describe('patch governance IPC contracts', () => {
  it('exports the exact twelve ordered invoke descriptors and source redaction', () => {
    const expected = [
      [patchListContract, Ch.PATCH_LIST],
      [patchGetRecordContract, Ch.PATCH_GET_RECORD],
      [patchGetHostStatusContract, Ch.PATCH_GET_HOST_STATUS],
      [patchGetMissingContract, Ch.PATCH_GET_MISSING],
      [patchUploadContract, Ch.PATCH_UPLOAD],
      [patchPrecheckContract, Ch.PATCH_PRECHECK],
      [patchApplyContract, Ch.PATCH_APPLY],
      [patchApplyToHostContract, Ch.PATCH_APPLY_TO_HOST],
      [patchCleanContract, Ch.PATCH_CLEAN],
      [patchDestroyContract, Ch.PATCH_DESTROY],
      [patchDestroyFromHostContract, Ch.PATCH_DESTROY_FROM_HOST],
      [patchApplyBatchContract, Ch.PATCH_APPLY_BATCH],
    ] as const

    expect(patchGovernanceContracts).toEqual(expected.map(([contract]) => contract))
    expect(new Set(patchGovernanceContracts.map(({ channel }) => channel))).toHaveLength(12)
    for (const [contract, channel] of expected) {
      expect(contract).toMatchObject({
        channel,
        direction: 'invoke',
        callerPolicy: 'app-window-main-frame',
        errorShape: 'ipc-error-response-v1',
      })
    }
    expect(patchUploadContract.redaction).toEqual(['storage-secret'])
    expect(patchGovernanceContracts.filter(({ channel }) => channel !== Ch.PATCH_UPLOAD)
      .every(({ redaction }) => redaction[0] === 'none')).toBe(true)
  })

  it('strictly parses patch references, host pairs, file paths, and batches', () => {
    expect(patchUploadContract.argsSchema.parse(['pool-1', '/tmp/update.xsupdate']))
      .toEqual(['pool-1', '/tmp/update.xsupdate'])
    expect(patchApplyToHostContract.argsSchema.parse([
      'pool-1', 'OpaqueRef:host', 'OpaqueRef:patch',
    ])).toEqual(['pool-1', 'OpaqueRef:host', 'OpaqueRef:patch'])
    expect(patchApplyBatchContract.argsSchema.parse([
      'pool-1', ['OpaqueRef:patch-1', 'OpaqueRef:patch-2'],
    ])).toEqual(['pool-1', ['OpaqueRef:patch-1', 'OpaqueRef:patch-2']])

    expectRejected(patchUploadContract.argsSchema, [
      ['pool-1', ''], ['pool-1', 12], ['pool-1', '/tmp/update', 'extra'],
    ])
    expectRejected(patchApplyToHostContract.argsSchema, [
      ['pool-1', 'OpaqueRef:NULL', 'OpaqueRef:patch'],
      ['pool-1', 'OpaqueRef:host'],
    ])
    expectRejected(patchApplyBatchContract.argsSchema, [
      ['pool-1', 'OpaqueRef:patch'],
      ['pool-1', ['OpaqueRef:NULL']],
      ['pool-1', [1]],
    ])
  })

  it('validates patch records, host status, compatibility, apply, and batch results', () => {
    expect(patchListContract.resultSchema.parse([patchRecord])).toEqual([patchRecord])
    expect(patchGetRecordContract.resultSchema.parse(null)).toBeNull()
    expect(patchGetHostStatusContract.resultSchema.parse([{
      hostRef: 'OpaqueRef:host',
      hostName: 'xcp-1',
      patchRef: 'OpaqueRef:patch',
      patchName: 'Security update',
      applied: true,
      appliedTimestamp: new Date('2026-08-01T01:00:00Z'),
    }])).toHaveLength(1)
    expect(patchPrecheckContract.resultSchema.parse({
      patchRef: 'OpaqueRef:patch',
      patchName: 'Security update',
      compatible: false,
      incompatibilities: [{
        hostRef: 'OpaqueRef:host',
        hostName: 'xcp-1',
        reason: 'Restart required',
      }],
      afterApplyGuides: ['restartHost'],
    })).toMatchObject({ compatible: false })
    expect(patchApplyContract.resultSchema.parse(applyResult)).toEqual(applyResult)
    expect(patchApplyBatchContract.resultSchema.parse([{
      patchRef: 'OpaqueRef:patch', result: applyResult,
    }])).toHaveLength(1)

    expectRejected(patchListContract.resultSchema, [
      [{ ...patchRecord, unknown: true }],
      [{ ...patchRecord, upload_date: '2026-08-01' }],
      [{ ...patchRecord, size: -1 }],
    ])
    expectRejected(patchGetHostStatusContract.resultSchema, [[{
      hostRef: 'OpaqueRef:host',
      hostName: 'xcp-1',
      patchRef: 'OpaqueRef:patch',
      patchName: 'Security update',
      applied: 'yes',
    }]])
    expectRejected(patchApplyContract.resultSchema, [
      { ...applyResult, hostResults: [{ ...applyResult.hostResults[0], error: 1 }] },
      { ...applyResult, unknown: true },
    ])
  })

  it('accepts only undefined for the four void mutation results', () => {
    for (const contract of [
      patchApplyToHostContract,
      patchCleanContract,
      patchDestroyContract,
      patchDestroyFromHostContract,
    ]) {
      expect(contract.resultSchema.parse(undefined)).toBeUndefined()
      expectRejected(contract.resultSchema, [null, false, {}])
    }
  })
})
