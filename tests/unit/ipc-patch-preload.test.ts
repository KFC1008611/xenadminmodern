import { describe, expect, it, vi } from 'vitest'
import { createPatchApi } from '../../src/preload/patch-api'

const patchRecord = {
  ref: 'OpaqueRef:patch',
  uuid: 'patch-uuid',
  name_label: 'Security update',
  name_description: '',
  size: 1024,
  version: '1.2.3',
  update_url: '',
  applied: false,
  after_apply_guides: [],
  upload_date: new Date('2026-08-01T00:00:00Z'),
  connectionId: 'pool-1',
  poolName: 'Lab Pool',
}

describe('patch governance preload IPC contracts', () => {
  it('exposes and routes the exact twelve patch methods through descriptors', async () => {
    const applyResult = { patchRef: 'OpaqueRef:patch', success: true, hostResults: [] }
    const invoke = vi.fn(async (channel: string) => ({
      'patch:list': [patchRecord],
      'patch:getRecord': patchRecord,
      'patch:hostStatus': [],
      'patch:getMissing': [],
      'patch:upload': { patchRef: 'OpaqueRef:patch', uuid: 'patch-uuid', nameLabel: 'Patch' },
      'patch:precheck': {
        patchRef: 'OpaqueRef:patch',
        patchName: 'Patch',
        compatible: true,
        incompatibilities: [],
        afterApplyGuides: [],
      },
      'patch:apply': applyResult,
      'patch:applyToHost': undefined,
      'patch:clean': undefined,
      'patch:destroy': undefined,
      'patch:destroyFromHost': undefined,
      'patch:applyBatch': [{ patchRef: 'OpaqueRef:patch', result: applyResult }],
    })[channel])
    const api = createPatchApi({ invoke })

    expect(Object.keys(api)).toEqual(['patch'])
    expect(Object.keys(api.patch)).toEqual([
      'list', 'getRecord', 'getHostStatus', 'getMissing', 'upload', 'precheck',
      'apply', 'applyToHost', 'clean', 'destroy', 'destroyFromHost', 'applyBatch',
    ])

    await api.patch.list('pool-1')
    await api.patch.getRecord('pool-1', 'OpaqueRef:patch')
    await api.patch.getHostStatus('pool-1')
    await api.patch.getMissing('pool-1', 'OpaqueRef:host')
    await api.patch.upload('pool-1', '/tmp/update.xsupdate')
    await api.patch.precheck('pool-1', 'OpaqueRef:patch')
    await api.patch.apply('pool-1', 'OpaqueRef:patch')
    await api.patch.applyToHost('pool-1', 'OpaqueRef:host', 'OpaqueRef:patch')
    await api.patch.clean('pool-1', 'OpaqueRef:patch')
    await api.patch.destroy('pool-1', 'OpaqueRef:patch')
    await api.patch.destroyFromHost('pool-1', 'OpaqueRef:host', 'OpaqueRef:patch')
    await api.patch.applyBatch('pool-1', ['OpaqueRef:patch'])

    expect(invoke.mock.calls.map(([channel]) => channel)).toEqual([
      'patch:list', 'patch:getRecord', 'patch:hostStatus', 'patch:getMissing',
      'patch:upload', 'patch:precheck', 'patch:apply', 'patch:applyToHost',
      'patch:clean', 'patch:destroy', 'patch:destroyFromHost', 'patch:applyBatch',
    ])
  })

  it('rejects malformed arguments before transport and malformed results after it', async () => {
    const invoke = vi.fn()
    const api = createPatchApi({ invoke })

    await expect(api.patch.upload('pool-1', ''))
      .rejects.toMatchObject({ code: 'IPC_SCHEMA_INVALID' })
    await expect(api.patch.applyToHost('pool-1', 'OpaqueRef:NULL', 'OpaqueRef:patch'))
      .rejects.toMatchObject({ code: 'IPC_SCHEMA_INVALID' })
    expect(invoke).not.toHaveBeenCalled()

    invoke.mockResolvedValueOnce([{ ...patchRecord, upload_date: 'invalid' }])
    await expect(api.patch.list('pool-1'))
      .rejects.toMatchObject({ code: 'IPC_RESULT_INVALID' })
  })
})
