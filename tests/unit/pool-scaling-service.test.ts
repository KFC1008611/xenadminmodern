import { beforeEach, describe, expect, it, vi } from 'vitest'
const { destinationCall, targetCall, targetConnect, disconnect, connectedHost, evacuate } = vi.hoisted(() => ({ destinationCall: vi.fn(), targetCall: vi.fn(), targetConnect: vi.fn(), disconnect: vi.fn(), connectedHost: vi.fn(), evacuate: vi.fn() }))
vi.mock('../../src/main/xapi/connection-manager', () => ({ connectionManager: {
  getClient: () => ({ callWithSession: destinationCall }),
  getConnectionOptions: () => ({ host: '192.0.2.10', port: 443, scheme: 'https:', allowSelfSigned: false, username: 'pool-admin', password: 'destination-password' }),
} }))
vi.mock('../../src/main/xapi/client', () => ({ XapiClient: class { callWithSession = targetCall; connect = targetConnect; disconnect = disconnect; getConnectedHost = connectedHost } }))
vi.mock('../../src/main/xapi/services/host.service', () => ({ evacuateHost: evacuate }))
import * as pool from '../../src/main/xapi/services/pool.service'
const params = { targetHost: '192.0.2.20', masterAddress: '192.0.2.10', username: 'root', password: 'target-password' }
let joined: boolean, hostEnabled: boolean, residents: string[], targetVersion: string, targetTaskState: string
beforeEach(() => {
  vi.resetAllMocks(); joined = false; hostEnabled = false; residents = []; targetVersion = '8.3'; targetTaskState = 'success'
  connectedHost.mockReturnValue(params.targetHost)
  destinationCall.mockImplementation(async (method, args) => {
    switch (method) {
      case 'pool.get_all': return ['OpaqueRef:pool']
      case 'pool.get_record': return { master: 'OpaqueRef:master' }
      case 'host.get_record': return args[0] === 'OpaqueRef:master' ? { address: params.masterAddress, uuid: 'master-uuid', enabled: true, software_version: { product_version: '8.3' } } : { enabled: hostEnabled, resident_VMs: residents }
      case 'host.get_all_records': return joined ? { 'OpaqueRef:joined': { uuid: 'target-uuid' } } : {}
      case 'VM.get_record': return { is_control_domain: args[0] === 'OpaqueRef:dom0', power_state: 'Paused' }
      case 'Async.pool.eject': return 'OpaqueRef:eject'
      case 'Async.pool.designate_new_master': return 'OpaqueRef:transfer'
      default: throw new Error(`Unexpected destination RPC ${method}`)
    }
  })
  targetCall.mockImplementation(async (method) => {
    switch (method) {
      case 'host.get_all_records': return { 'OpaqueRef:target': { uuid: 'target-uuid', software_version: { product_version: targetVersion } } }
      case 'Async.pool.join': case 'Async.pool.join_force': return 'OpaqueRef:join-task'
      case 'task.get_record': joined = targetTaskState === 'success'; return { status: targetTaskState, error_info: ['JOIN_FAILED'] }
      default: throw new Error(`Unexpected target RPC ${method}`)
    }
  })
})
describe('pool scaling targeting and verification', () => {
  it('joins on the standalone target with destination credentials and verifies pool membership', async () => {
    expect(await pool.addHostToPool('c', params)).toBe('OpaqueRef:join-task')
    expect(targetConnect).toHaveBeenCalledWith(expect.objectContaining({ host: params.targetHost, username: 'root', password: 'target-password', allowSelfSigned: false }))
    expect(targetCall).toHaveBeenCalledWith('Async.pool.join', [params.masterAddress, 'pool-admin', 'destination-password'])
    expect(destinationCall.mock.calls.some(([method]) => method.startsWith('Async.pool.join'))).toBe(false)
    expect(disconnect).toHaveBeenCalledOnce()
  })
  it('uses join_force only for an explicit force request', async () => {
    targetVersion = '8.2'
    expect(await pool.addHostToPool('c', { ...params, forceJoin: true })).toBe('OpaqueRef:join-task')
    expect(targetCall).toHaveBeenCalledWith('Async.pool.join_force', expect.any(Array))
  })
  it('checks both server versions before normal join', async () => {
    targetVersion = '8.2'
    await expect(pool.addHostToPool('c', params)).rejects.toMatchObject({ code: 'HOST_VERSION_INCOMPATIBLE' })
    expect(targetCall).not.toHaveBeenCalledWith('Async.pool.join', expect.anything())
    expect(disconnect).toHaveBeenCalledOnce()
  })
  it('rejects a coordinator redirect so joining cannot mutate the wrong pool', async () => {
    connectedHost.mockReturnValue('192.0.2.99')
    await expect(pool.addHostToPool('c', params)).rejects.toMatchObject({ code: 'HOST_ALREADY_IN_POOL' })
    expect(targetCall).not.toHaveBeenCalled()
  })
  it('refuses an unrelated master address', async () => {
    await expect(pool.addHostToPool('c', { ...params, masterAddress: '192.0.2.99' })).rejects.toMatchObject({ code: 'POOL_MASTER_MISMATCH' })
    expect(targetConnect).not.toHaveBeenCalled()
  })
  it('does not retry join after an unreadable source task', async () => {
    const original = targetCall.getMockImplementation()!
    targetCall.mockImplementation((method, args) => method === 'task.get_record' ? Promise.reject(new Error('SESSION_INVALID')) : original(method, args))
    await expect(pool.addHostToPool('c', params)).rejects.toMatchObject({ code: 'TASK_OUTCOME_UNKNOWN' })
    expect(targetCall.mock.calls.filter(([method]) => method === 'Async.pool.join')).toHaveLength(1)
    expect(disconnect).toHaveBeenCalledOnce()
  })
  it('does not report joined when the target is missing from destination inventory', async () => {
    const original = destinationCall.getMockImplementation()!
    destinationCall.mockImplementation((method, args) => method === 'host.get_all_records' ? Promise.resolve({}) : original(method, args))
    await expect(pool.addHostToPool('c', params)).rejects.toMatchObject({ code: 'TASK_OUTCOME_UNKNOWN' })
  })
  it('ejects only a disabled empty non-coordinator', async () => {
    expect(await pool.removeHostFromPool('c', 'OpaqueRef:target')).toBe('OpaqueRef:eject')
    await expect(pool.removeHostFromPool('c', 'OpaqueRef:master')).rejects.toMatchObject({ code: 'HOST_IS_MASTER' })
  })
  it('blocks ejection of an enabled host or a paused resident VM', async () => {
    hostEnabled = true
    await expect(pool.removeHostFromPool('c', 'OpaqueRef:target')).rejects.toMatchObject({ code: 'HOST_NOT_DISABLED' })
    hostEnabled = false; residents = ['OpaqueRef:vm']
    await expect(pool.removeHostFromPool('c', 'OpaqueRef:target')).rejects.toMatchObject({ code: 'HOST_HAS_RESIDENT_VMS' })
    expect(destinationCall).not.toHaveBeenCalledWith('Async.pool.eject', expect.anything())
  })
  it('keeps transfer read failures distinct from a missing host', async () => {
    destinationCall.mockRejectedValue(new Error('SESSION_INVALID'))
    await expect(pool.transferPoolMaster('c', 'OpaqueRef:target')).rejects.toThrow('SESSION_INVALID')
  })
  it('requires an enabled transfer candidate', async () => {
    await expect(pool.transferPoolMaster('c', 'OpaqueRef:target')).rejects.toMatchObject({ code: 'HOST_NOT_ENABLED' })
    hostEnabled = true
    expect(await pool.transferPoolMaster('c', 'OpaqueRef:target')).toBe('OpaqueRef:transfer')
  })
  it('shares evacuation semantics with the verified host workflow', async () => {
    evacuate.mockResolvedValue({ success: true, migratedVms: ['OpaqueRef:vm'], failedVms: [] })
    expect(await pool.evacuateHostForRemoval('c', 'OpaqueRef:target')).toMatchObject({ success: true })
    expect(evacuate).toHaveBeenCalledWith('c', 'OpaqueRef:target')
  })
})
