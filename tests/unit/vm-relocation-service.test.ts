import { copyOperation } from '../helpers/vm-copy-fixtures'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const sourceCallWithSession = vi.fn()
const targetCallWithSession = vi.fn()
const sourceClient = { callWithSession: sourceCallWithSession }
const targetClient = { callWithSession: targetCallWithSession }
const mockGetClient = vi.fn((connectionId: string) => {
  if (connectionId === 'source') return sourceClient
  if (connectionId === 'target') return targetClient
  return undefined
})

const mockStartCopy = vi.fn()
vi.mock('../../src/main/xapi/services/vm-copy.service', () => ({ startVmCopy: mockStartCopy }))

vi.mock('../../src/main/xapi/connection-manager', () => ({
  connectionManager: {
    getClient: mockGetClient,
    getConnectionInfo: vi.fn((connectionId: string) => ({
      poolName: connectionId === 'target' ? 'Target Pool' : 'Source Pool',
    })),
  },
}))

describe('vm-relocation.service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('builds an IPC-valid plan from XAPI host metrics and decimal capacity fields', async () => {
    sourceCallWithSession.mockImplementation(async (method: string) => {
      if (method === 'VM.get_record') return {
        name_label: 'vm1', power_state: 'Running', allowed_operations: ['pool_migrate'],
        resident_on: 'OpaqueRef:host1', VBDs: [], VIFs: [], current_operations: {},
      }
      if (method === 'host.get_all_records') return {
        'OpaqueRef:host1': {
          uuid: 'host-uuid', name_label: 'host1', hostname: 'host1.example', address: '192.0.2.1',
          enabled: true, resident_VMs: ['OpaqueRef:vm'], metrics: 'OpaqueRef:metrics',
          suspend_image_sr: 'OpaqueRef:NULL', cpu_info: {}, software_version: {},
        },
      }
      if (method === 'host_metrics.get_record') return { memory_total: '17179869184', memory_free: '8589934592' }
      if (method === 'SR.get_all_records') return {
        'OpaqueRef:sr': {
          uuid: 'sr-uuid', name_label: 'SR', type: 'nfs', PBDs: ['OpaqueRef:pbd'],
          VDIs: [], shared: true, physical_size: '1000', physical_utilisation: '200',
          virtual_allocation: '300',
        },
      }
      if (method === 'network.get_all_records') return {
        'OpaqueRef:network': {
          uuid: 'network-uuid', name_label: 'Network', name_description: '', bridge: 'xenbr0',
          VIFs: [], PIFs: [], MTU: '1500',
        },
      }
      throw new Error(`unexpected method ${method}`)
    })

    const { getVmRelocationPlan } = await import('../../src/main/xapi/services/vm-relocation.service')
    const { vmGetRelocationPlanContract } = await import('../../src/shared/ipc-contracts/vm')
    const plan = await getVmRelocationPlan('source', 'OpaqueRef:vm')
    expect(plan.allowedModes).toContain('pool-migrate')
    expect(plan.targetHosts[0].memory_total).toBe(17179869184)
    expect(plan.targetSrs[0].physical_size).toBe(1000)
    expect(plan.targetNetworks[0].MTU).toBe(1500)
    expect(vmGetRelocationPlanContract.resultSchema.parse(plan)).toEqual(plan)
  })

  it('uses Async.VM.pool_migrate for same-pool host migration', async () => {
    let vmReadCount = 0
    sourceCallWithSession.mockImplementation(async (method: string) => {
      if (method === 'VM.get_record') {
        vmReadCount++
        return {
          name_label: 'vm1',
          power_state: 'Running',
          resident_on: vmReadCount === 1 ? 'OpaqueRef:host1' : 'OpaqueRef:host2',
          allowed_operations: ['pool_migrate'],
          VBDs: [],
          VIFs: [],
          current_operations: {},
        }
      }
      if (method === 'host.get_record') return { enabled: true }
      if (method === 'VM.assert_can_boot_here') return null
      if (method === 'Async.VM.pool_migrate') return 'OpaqueRef:task'
      if (method === 'task.get_record') return { status: 'success' }
      throw new Error(`unexpected method ${method}`)
    })

    const { relocateVm } = await import('../../src/main/xapi/services/vm-relocation.service')
    const result = await relocateVm({
      mode: 'pool-migrate',
      sourceConnectionId: 'source',
      vmRef: 'OpaqueRef:vm',
      targetHostRef: 'OpaqueRef:host2',
    })

    expect(result.taskRef).toBe('OpaqueRef:task')
    expect(sourceCallWithSession).toHaveBeenCalledWith('Async.VM.pool_migrate', [
      'OpaqueRef:vm',
      'OpaqueRef:host2',
      {},
    ])
    expect(vmReadCount).toBe(2)
  })

  it('reports an unknown outcome when the completed migration has not changed host', async () => {
    sourceCallWithSession.mockImplementation(async (method: string) => {
      if (method === 'VM.get_record') return {
        resident_on: 'OpaqueRef:host1', allowed_operations: ['pool_migrate'], current_operations: {},
      }
      if (method === 'host.get_record') return { enabled: true }
      if (method === 'VM.assert_can_boot_here') return null
      if (method === 'Async.VM.pool_migrate') return 'OpaqueRef:task'
      if (method === 'task.get_record') return { status: 'success' }
      throw new Error(`unexpected method ${method}`)
    })
    const { relocateVm } = await import('../../src/main/xapi/services/vm-relocation.service')
    await expect(relocateVm({
      mode: 'pool-migrate', sourceConnectionId: 'source', vmRef: 'OpaqueRef:vm',
      targetHostRef: 'OpaqueRef:host2',
    })).rejects.toMatchObject({ code: 'TASK_OUTCOME_UNKNOWN', details: { taskRef: 'OpaqueRef:task' } })
  })

  it('refuses same-pool migration when XAPI does not advertise it', async () => {
    sourceCallWithSession.mockResolvedValueOnce({
      name_label: 'vm1', power_state: 'Running', resident_on: 'OpaqueRef:host1',
      allowed_operations: [], VBDs: [], VIFs: [], current_operations: {},
    })
    const { relocateVm } = await import('../../src/main/xapi/services/vm-relocation.service')
    await expect(relocateVm({
      mode: 'pool-migrate', sourceConnectionId: 'source', vmRef: 'OpaqueRef:vm',
      targetHostRef: 'OpaqueRef:host2',
    })).rejects.toMatchObject({ code: 'POOL_MIGRATE_NOT_ALLOWED' })
    expect(sourceCallWithSession).not.toHaveBeenCalledWith('Async.VM.pool_migrate', expect.anything())
  })

  it('moves halted owner disks through pool_migrate and preserves VBD identity', async () => {
    let moved = false
    sourceCallWithSession.mockImplementation(async (method: string, params: any[]) => {
      if (method === 'VM.get_record') return { power_state: 'Halted', VBDs: ['OpaqueRef:vbd1'], VIFs: [], current_operations: {} }
      if (method === 'VBD.get_record') return { VM: 'OpaqueRef:vm', VDI: moved ? 'OpaqueRef:new' : 'OpaqueRef:old', userdevice: '0', mode: 'RW', type: 'Disk', other_config: { owner: 'true' } }
      if (method === 'VDI.get_record') return { SR: params[0] === 'OpaqueRef:new' ? 'OpaqueRef:target-sr' : 'OpaqueRef:old-sr', VBDs: ['OpaqueRef:vbd1'], current_operations: {}, sharable: false }
      if (method === 'SR.get_record') return { type: 'nfs', PBDs: ['pbd'] }
      if (method === 'Async.VDI.pool_migrate') { moved = true; return 'OpaqueRef:task' }
      if (method === 'task.get_record') return { status: 'success', result: '<value>OpaqueRef:new</value>' }
      throw new Error(`unexpected method ${method}`)
    })
    const { relocateVm } = await import('../../src/main/xapi/services/vm-relocation.service')
    await expect(relocateVm({ mode: 'storage-move', sourceConnectionId: 'source', vmRef: 'OpaqueRef:vm',
      storageMap: { 'OpaqueRef:old': 'OpaqueRef:target-sr' },
    })).resolves.toEqual({ movedVdis: ['OpaqueRef:new'] })
    expect(sourceCallWithSession).toHaveBeenCalledWith('Async.VDI.pool_migrate', ['OpaqueRef:old', 'OpaqueRef:target-sr', {}])
    expect(sourceCallWithSession).not.toHaveBeenCalledWith('VBD.create', expect.anything())
    expect(sourceCallWithSession).not.toHaveBeenCalledWith('VDI.destroy', expect.anything())
  })

  it('routes cross-pool copy through the durable copy workflow', async () => {
    sourceCallWithSession.mockResolvedValueOnce({ name_label: 'Source' })
    mockStartCopy.mockResolvedValueOnce(copyOperation)
    const { relocateVm } = await import('../../src/main/xapi/services/vm-relocation.service')
    const payload = { mode: 'cross-pool-copy' as const, sourceConnectionId: 'source', targetConnectionId: 'target', vmRef: 'OpaqueRef:vm', targetHostRef: 'OpaqueRef:host', transferNetworkRef: 'OpaqueRef:network', storageMap: {}, networkMap: {} }
    expect(await relocateVm(payload)).toEqual({ copyOperation })
    expect(mockStartCopy).toHaveBeenCalledWith('source', expect.objectContaining({ mode: 'cross-pool-copy', newName: 'Copy of Source', targetConnectionId: 'target' }))
  })

  it('blocks same-pool migration before mutation when server target validation fails', async () => {
    sourceCallWithSession.mockImplementation(async (method: string) => {
      if (method === 'VM.get_record') return { resident_on: 'old-host', allowed_operations: ['pool_migrate'], current_operations: {} }
      if (method === 'host.get_record') return { enabled: true }
      if (method === 'VM.assert_can_boot_here') throw new Error('VM_REQUIRES_SR')
      throw new Error(`unexpected method ${method}`)
    })
    const { relocateVm } = await import('../../src/main/xapi/services/vm-relocation.service')
    await expect(relocateVm({ mode: 'pool-migrate', sourceConnectionId: 'source', vmRef: 'OpaqueRef:vm', targetHostRef: 'target-host' })).rejects.toThrow('VM_REQUIRES_SR')
    expect(sourceCallWithSession).not.toHaveBeenCalledWith('Async.VM.pool_migrate', expect.anything())
  })

})
