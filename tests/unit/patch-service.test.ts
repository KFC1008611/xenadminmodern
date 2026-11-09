import { beforeEach, describe, expect, it, vi } from 'vitest'
const { call, getClient } = vi.hoisted(() => ({ call: vi.fn(), getClient: vi.fn() }))
vi.mock('../../src/main/xapi/connection-manager', () => ({ connectionManager: {
  getClient, getConnectionInfo: () => ({ poolName: 'Lab' }),
} }))
import * as patch from '../../src/main/xapi/services/patch.service'
import { patchListContract } from '../../src/shared/ipc-contracts/patch-governance'
let patches: Record<string, any>, hosts: Record<string, any>, hostPatches: Record<string, any>
beforeEach(() => {
  call.mockReset(); getClient.mockReturnValue({ callWithSession: call })
  patches = { 'OpaqueRef:patch': { name_label: 'Hotfix', version: '8.2.1-2', after_apply_guidance: ['restartHost'], pool_applied: true } }
  hosts = { 'OpaqueRef:h1': { name_label: 'one', patches: ['OpaqueRef:hp1'] }, 'OpaqueRef:h2': { name_label: 'two', patches: ['OpaqueRef:hp2'] } }
  hostPatches = { 'OpaqueRef:hp1': { host: 'OpaqueRef:h1', pool_patch: 'OpaqueRef:patch', applied: true, timestamp_applied: new Date('2026-01-02T00:00:00Z') }, 'OpaqueRef:hp2': { host: 'OpaqueRef:h2', pool_patch: 'OpaqueRef:patch', applied: false } }
  call.mockImplementation(async (method) => ({ 'pool_patch.get_all_records': patches, 'host.get_all_records': hosts, 'host_patch.get_all_records': hostPatches })[method])
})
describe('legacy patch inventory contracts', () => {
  it('joins host_patch references to pool_patch and keeps version and guidance exact', async () => {
    const records = patchListContract.resultSchema.parse(await patch.getAllPatches('c'))
    expect(records).toEqual([expect.objectContaining({ ref: 'OpaqueRef:patch', version: '8.2.1-2', after_apply_guides: ['restartHost'], hosts: ['OpaqueRef:h1'], applied: false, upload_date: null, update_url: '', connectionId: 'c' })])
  })
  it('uses applied state, not the pool_applied intention, for every host', async () => {
    hostPatches['OpaqueRef:hp2'].applied = true
    expect((await patch.getAllPatches('c'))[0].applied).toBe(true)
  })
  it('returns real application timestamps and false host applications', async () => {
    expect(await patch.getHostPatchStatus('c')).toEqual([
      { hostRef: 'OpaqueRef:h1', hostName: 'one', patchRef: 'OpaqueRef:patch', patchName: 'Hotfix', applied: true, appliedTimestamp: new Date('2026-01-02T00:00:00Z') },
      { hostRef: 'OpaqueRef:h2', hostName: 'two', patchRef: 'OpaqueRef:patch', patchName: 'Hotfix', applied: false },
    ])
    expect(call).not.toHaveBeenCalledWith('pool_patch.get_record', ['OpaqueRef:hp1'])
  })
  it('does not mark a patch missing just because host_patch and pool_patch refs differ', async () => {
    expect(await patch.getMissingPatchesForHost('c', 'OpaqueRef:h1')).toEqual([])
    expect(await patch.getMissingPatchesForHost('c', 'OpaqueRef:h2')).toHaveLength(1)
  })
  it('rejects an unknown host instead of showing all patches missing', async () => {
    await expect(patch.getMissingPatchesForHost('c', 'OpaqueRef:missing')).rejects.toThrow('HANDLE_INVALID')
  })
  it('returns null only for an absent record in a successfully read inventory', async () => {
    expect(await patch.getPatchRecord('c', 'OpaqueRef:missing')).toBeNull()
    expect(await patch.getPatchRecord('c', 'OpaqueRef:patch')).toMatchObject({ version: '8.2.1-2' })
  })
  it('fails visibly on incomplete inventory', async () => {
    delete patches['OpaqueRef:patch']
    await expect(patch.getHostPatchStatus('c')).rejects.toThrow('PATCH_INVENTORY_INCOMPLETE')
  })
  it.each(['SESSION_INVALID', 'MESSAGE_METHOD_UNKNOWN', 'ETIMEDOUT'])('does not turn %s into an empty inventory', async (message) => {
    call.mockRejectedValue(new Error(message))
    await expect(patch.getAllPatches('c')).rejects.toThrow(message)
  })
  it('rejects numeric patch versions at the XAPI boundary', async () => {
    patches['OpaqueRef:patch'].version = 1
    await expect(patch.getAllPatches('c')).rejects.toThrow('PATCH_CONTRACT_MISMATCH')
  })
  it('returns empty only when the server actually has no patch records', async () => {
    patches = {}; hostPatches = {}
    expect(await patch.getAllPatches('c')).toEqual([])
  })
  it('rejects a disconnected scope', async () => {
    getClient.mockReturnValue(undefined)
    await expect(patch.getAllPatches('c')).rejects.toThrow('No connection')
  })
})
