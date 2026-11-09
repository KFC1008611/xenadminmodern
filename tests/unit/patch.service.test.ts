import { beforeEach, describe, expect, it, vi } from 'vitest'
const { call } = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../../src/main/xapi/connection-manager', () => ({ connectionManager: {
  getClient: () => ({ callWithSession: call }), getConnectionInfo: () => ({ poolName: 'Lab' }),
} }))
import * as patch from '../../src/main/xapi/services/patch.service'
let applied: boolean
beforeEach(() => {
  call.mockReset(); applied = false
  call.mockImplementation(async (method, args) => {
    const patchRecord = { name_label: 'Fix', version: '1.1', after_apply_guidance: ['restartHost'] }
    switch (method) {
      case 'pool_patch.get_record': return patchRecord
      case 'pool_patch.get_all_records': return { 'OpaqueRef:p': patchRecord }
      case 'host.get_all_records': return { 'OpaqueRef:h': { name_label: 'Host' } }
      case 'host_patch.get_all_records': return { 'OpaqueRef:hp': { host: 'OpaqueRef:h', pool_patch: 'OpaqueRef:p', applied } }
      case 'pool_patch.apply': applied = true; return ''
      default: return undefined
    }
  })
})
describe('patch mutation semantics while guarded', () => {
  it('prechecks each host using pool_patch.precheck(patch, host)', async () => {
    expect(await patch.precheckPatch('c', 'OpaqueRef:p')).toMatchObject({ compatible: true, afterApplyGuides: ['restartHost'] })
    expect(call).toHaveBeenCalledWith('pool_patch.precheck', ['OpaqueRef:p', 'OpaqueRef:h'])
    expect(call.mock.calls.some(([method]) => method.startsWith('host_patch.precheck'))).toBe(false)
  })
  it('records an explicit patch incompatibility', async () => {
    const original = call.getMockImplementation()!
    call.mockImplementation((method, args) => method === 'pool_patch.precheck' ? Promise.reject(Object.assign(new Error('PATCH_PRECHECK_FAILED'), { code: 'PATCH_PRECHECK_FAILED' })) : original(method, args))
    expect(await patch.precheckPatch('c', 'OpaqueRef:p')).toMatchObject({ compatible: false, incompatibilities: [{ hostRef: 'OpaqueRef:h', reason: 'PATCH_PRECHECK_FAILED' }] })
  })
  it('propagates connection failures without declaring incompatibility', async () => {
    const original = call.getMockImplementation()!
    call.mockImplementation((method, args) => method === 'pool_patch.precheck' ? Promise.reject(new Error('SESSION_INVALID')) : original(method, args))
    await expect(patch.precheckPatch('c', 'OpaqueRef:p')).rejects.toThrow('SESSION_INVALID')
  })
  it('applies through pool_patch and confirms host_patch afterward', async () => {
    await patch.applyPatchToHost('c', 'OpaqueRef:h', 'OpaqueRef:p')
    expect(call).toHaveBeenCalledWith('pool_patch.apply', ['OpaqueRef:p', 'OpaqueRef:h'])
    expect(call.mock.calls.findIndex(([method]) => method === 'pool_patch.precheck')).toBeLessThan(call.mock.calls.findIndex(([method]) => method === 'pool_patch.apply'))
  })
  it('does not call success when the host inventory does not confirm application', async () => {
    const original = call.getMockImplementation()!
    call.mockImplementation((method, args) => method === 'pool_patch.apply' ? Promise.resolve('') : original(method, args))
    await expect(patch.applyPatchToHost('c', 'OpaqueRef:h', 'OpaqueRef:p')).rejects.toThrow('PATCH_APPLY_UNCONFIRMED')
  })
  it('returns aggregate success only for confirmed applications', async () => {
    expect(await patch.applyPatch('c', 'OpaqueRef:p')).toEqual({ patchRef: 'OpaqueRef:p', success: true, hostResults: [{ hostRef: 'OpaqueRef:h', hostName: 'Host', success: true }] })
  })
  it('stops a batch after a lost response and never retries that mutation', async () => {
    const original = call.getMockImplementation()!
    call.mockImplementation((method, args) => method === 'pool_patch.apply' ? Promise.reject(new Error('ETIMEDOUT')) : original(method, args))
    await expect(patch.applyPatchesBatch('c', ['OpaqueRef:p', 'OpaqueRef:next'])).rejects.toThrow('ETIMEDOUT')
    expect(call.mock.calls.filter(([method]) => method === 'pool_patch.apply')).toHaveLength(1)
  })
  it('cleans uploaded files with the published RPC', async () => {
    await patch.cleanPatch('c', 'OpaqueRef:p')
    expect(call).toHaveBeenCalledWith('pool_patch.clean', ['OpaqueRef:p'])
  })
  it('destroys an unapplied patch record', async () => {
    await patch.destroyPatch('c', 'OpaqueRef:p')
    expect(call).toHaveBeenCalledWith('pool_patch.destroy', ['OpaqueRef:p'])
  })
  it('refuses to label patch destruction as uninstall', async () => {
    applied = true
    await expect(patch.destroyPatch('c', 'OpaqueRef:p')).rejects.toThrow('PATCH_ALREADY_APPLIED')
    expect(call).not.toHaveBeenCalledWith('pool_patch.destroy', expect.anything())
    await expect(patch.destroyPatchFromHost('c', 'OpaqueRef:h', 'OpaqueRef:p')).rejects.toThrow('PATCH_UNINSTALL_UNSUPPORTED')
  })
  it('never sends a local file path to a nonexistent upload RPC', async () => {
    await expect(patch.uploadPatch('c', '/local/patch.xsupdate')).rejects.toThrow('PATCH_UPLOAD_UNAVAILABLE')
    expect(call).not.toHaveBeenCalled()
  })
})
