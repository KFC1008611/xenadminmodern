import { copyOperation } from '../helpers/vm-copy-fixtures'
/**
 * Unit tests for vm.service — verifies that the correct XAPI methods are called
 * with the expected parameters and that templates/control domains are filtered out.
 * v4: Updated to mock connectionManager instead of singleton xapiClient.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { vmGetSnapshotsContract } from '../../src/shared/ipc-contracts/vm'

const mockCallWithSession = vi.fn()
const mockClient = { callWithSession: mockCallWithSession }
const mockGetClient = vi.fn(() => mockClient)
const mockGetConnectionInfo = vi.fn(() => ({ poolName: 'Test Pool' }))

const mockStartCopy = vi.fn()
vi.mock('../../src/main/xapi/services/vm-copy.service', () => ({ startVmCopy: mockStartCopy }))

vi.mock('../../src/main/xapi/connection-manager', () => ({
  connectionManager: {
    getClient: mockGetClient,
    getConnectionInfo: mockGetConnectionInfo,
  },
}))

describe('vm.service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCallWithSession.mockReset()
    mockGetConnectionInfo.mockReturnValue({ poolName: 'Test Pool' })
  })

  it('enriches VM IPs with one pool-scoped bulk read and excludes old stopped guest metrics', async () => {
    const record = { power_state: 'Running', guest_metrics: 'OpaqueRef:guest-1' }
    mockCallWithSession.mockResolvedValueOnce({
      'OpaqueRef:vm1': record,
      'OpaqueRef:vm2': { ...record, guest_metrics: 'OpaqueRef:guest-2' },
      'OpaqueRef:stopped': { ...record, power_state: 'Halted' },
    }).mockResolvedValueOnce({
      'OpaqueRef:guest-1': { networks: { '0/ipv4/0': '192.0.2.1' } },
      'OpaqueRef:guest-2': { networks: { '0/ipv6/0': '2001:db8::2' } },
    })
    const { getAllVms } = await import('../../src/main/xapi/services/vm.service')
    const records = await getAllVms('pool-b')
    expect(mockCallWithSession.mock.calls.map(([method]) => method)).toEqual(['VM.get_all_records', 'VM_guest_metrics.get_all_records'])
    expect(records[0].networks).toEqual({ '0/ipv4/0': '192.0.2.1' })
    expect(records[1].networks).toEqual({ '0/ipv6/0': '2001:db8::2' })
    expect(records[2].networks).toBeUndefined()
    expect(records.every(record => record.connectionId === 'pool-b')).toBe(true)
  })

  it('keeps VM inventory available when the optional guest metrics bulk read fails', async () => {
    mockCallWithSession.mockResolvedValueOnce({ 'OpaqueRef:vm': { power_state: 'Running', guest_metrics: 'OpaqueRef:guest' } }).mockRejectedValueOnce(new Error('permission denied'))
    const { getAllVms } = await import('../../src/main/xapi/services/vm.service')
    expect(await getAllVms('pool-a')).toMatchObject([{ ref: 'OpaqueRef:vm', guestMetricsError: '客户机 IP 读取失败，请刷新重试' }])
  })

  it('getAllVms filters out templates and control domains and includes connection metadata', async () => {
    mockCallWithSession.mockResolvedValueOnce({
      'OpaqueRef:vm1': {
        name_label: 'my-vm',
        power_state: 'Running',
        is_a_template: false,
        is_control_domain: false,
        resident_on: 'OpaqueRef:host1',
        VCPUs_max: 2,
        VCPUs_at_startup: 2,
        memory_static_max: 2147483648,
        memory_dynamic_max: 2147483648,
        VBDs: [],
        VIFs: [],
      },
      'OpaqueRef:vm2': {
        name_label: 'another-vm',
        power_state: 'Halted',
        is_a_template: false,
        is_control_domain: false,
        resident_on: '',
        VCPUs_max: 1,
        VCPUs_at_startup: 1,
        memory_static_max: 1073741824,
        memory_dynamic_max: 1073741824,
        VBDs: [],
        VIFs: [],
      },
      'OpaqueRef:tmpl': {
        name_label: 'CentOS 8 template',
        power_state: 'Halted',
        is_a_template: true,
        is_control_domain: false,
        resident_on: '',
        VCPUs_max: 1,
        VCPUs_at_startup: 1,
        memory_static_max: 1073741824,
        memory_dynamic_max: 1073741824,
        VBDs: [],
        VIFs: [],
      },
      'OpaqueRef:snap': {
        name_label: 'my-vm snapshot',
        power_state: 'Halted',
        is_a_template: false,
        is_a_snapshot: true,
        is_control_domain: false,
        resident_on: '',
        VCPUs_max: 1,
        VCPUs_at_startup: 1,
        memory_static_max: 1073741824,
        memory_dynamic_max: 1073741824,
        VBDs: [],
        VIFs: [],
      },
      'OpaqueRef:dom0': {
        name_label: 'Control domain on host',
        power_state: 'Running',
        is_a_template: false,
        is_control_domain: true,
        resident_on: 'OpaqueRef:host1',
        VCPUs_max: 4,
        VCPUs_at_startup: 4,
        memory_static_max: 4294967296,
        memory_dynamic_max: 4294967296,
        VBDs: [],
        VIFs: [],
      },
    })

    const { getAllVms } = await import('../../src/main/xapi/services/vm.service')
    const vms = await getAllVms('conn-123')

    expect(vms).toHaveLength(2)
    expect(vms.every((v) => !v.is_a_template)).toBe(true)
    expect(vms.every((v) => !v.is_a_snapshot)).toBe(true)
    expect(vms.every((v) => !v.is_control_domain)).toBe(true)
    expect(vms[0].name_label).toBe('my-vm')
    expect(vms[0].connectionId).toBe('conn-123')
    expect(vms[0].poolName).toBe('Test Pool')
    expect(vms[1].name_label).toBe('another-vm')
  })

  it('getAllVms throws when connectionId is invalid', async () => {
    mockGetClient.mockReturnValueOnce(undefined)

    const { getAllVms } = await import('../../src/main/xapi/services/vm.service')
    await expect(getAllVms('invalid-id')).rejects.toThrow('No connection found for connectionId: invalid-id')
  })

  it('normalizes XAPI decimal VM sizes for list, detail, and template IPC results', async () => {
    const baseRecord = {
      uuid: 'vm-uuid', name_label: 'VM', name_description: '', power_state: 'Halted',
      resident_on: 'OpaqueRef:NULL', VCPUs_max: '4', VCPUs_at_startup: '2',
      memory_static_min: '0', memory_static_max: '4294967296',
      memory_dynamic_min: '1073741824', memory_dynamic_max: '2147483648',
      is_a_template: false, is_control_domain: false, VBDs: [], VIFs: [],
      metrics: 'OpaqueRef:NULL', guest_metrics: 'OpaqueRef:NULL', consoles: [],
    }
    mockCallWithSession
      .mockResolvedValueOnce({ 'OpaqueRef:vm': baseRecord })
      .mockResolvedValueOnce(baseRecord)
      .mockResolvedValueOnce({ 'OpaqueRef:template': { ...baseRecord, is_a_template: true } })

    const { getAllVms, getVmRecord, getTemplates } = await import('../../src/main/xapi/services/vm.service')
    const { vmListContract, vmGetRecordContract, vmTemplatesContract } = await import('../../src/shared/ipc-contracts/vm')
    const list = await getAllVms('conn-123')
    const detail = await getVmRecord('conn-123', 'OpaqueRef:vm')
    const templates = await getTemplates('conn-123')

    expect(list[0].memory_static_max).toBe(4294967296)
    expect(detail.memory_dynamic_max).toBe(2147483648)
    expect(templates.user[0].VCPUs_max).toBe(4)
    expect(vmListContract.resultSchema.parse(list)).toEqual(list)
    expect(vmGetRecordContract.resultSchema.parse(detail)).toEqual(detail)
    expect(vmTemplatesContract.resultSchema.parse(templates)).toEqual(templates)
  })

  it('startVm calls VM.start with the correct params', async () => {
    mockCallWithSession.mockResolvedValueOnce({ uuid: 'vm', power_state: 'Halted', allowed_operations: ['start'] })
      .mockResolvedValueOnce('OpaqueRef:task').mockResolvedValueOnce({ status: 'success' })
      .mockResolvedValueOnce({ uuid: 'vm', power_state: 'Running' })
    const { startVm } = await import('../../src/main/xapi/services/vm.service')
    await startVm('conn-123', 'OpaqueRef:vm1')
    expect(mockCallWithSession).toHaveBeenCalledWith('Async.VM.start', ['OpaqueRef:vm1', false, false])
  })

  it('shutdownVm calls VM.clean_shutdown', async () => {
    mockCallWithSession.mockResolvedValueOnce({ uuid: 'vm', power_state: 'Running', allowed_operations: ['clean_shutdown'] })
      .mockResolvedValueOnce('OpaqueRef:task').mockResolvedValueOnce({ status: 'success' })
      .mockResolvedValueOnce({ uuid: 'vm', power_state: 'Halted' })
    const { shutdownVm } = await import('../../src/main/xapi/services/vm.service')
    await shutdownVm('conn-123', 'OpaqueRef:vm1')
    expect(mockCallWithSession).toHaveBeenCalledWith('Async.VM.clean_shutdown', ['OpaqueRef:vm1'])
  })

  it('forceShutdownVm calls VM.hard_shutdown', async () => {
    mockCallWithSession.mockResolvedValueOnce({ uuid: 'vm', power_state: 'Running', allowed_operations: ['hard_shutdown'] })
      .mockResolvedValueOnce('OpaqueRef:task').mockResolvedValueOnce({ status: 'success' })
      .mockResolvedValueOnce({ uuid: 'vm', power_state: 'Halted' })
    const { forceShutdownVm } = await import('../../src/main/xapi/services/vm.service')
    await forceShutdownVm('conn-123', 'OpaqueRef:vm1')
    expect(mockCallWithSession).toHaveBeenCalledWith('Async.VM.hard_shutdown', ['OpaqueRef:vm1'])
  })

  it('rebootVm calls VM.clean_reboot', async () => {
    mockCallWithSession.mockResolvedValueOnce({ uuid: 'vm', power_state: 'Running', allowed_operations: ['clean_reboot'] })
      .mockResolvedValueOnce('OpaqueRef:task').mockResolvedValueOnce({ status: 'success' })
      .mockResolvedValueOnce({ uuid: 'vm', power_state: 'Running' })
    const { rebootVm } = await import('../../src/main/xapi/services/vm.service')
    await rebootVm('conn-123', 'OpaqueRef:vm1')
    expect(mockCallWithSession).toHaveBeenCalledWith('Async.VM.clean_reboot', ['OpaqueRef:vm1'])
  })

  it('pauseVm calls VM.pause', async () => {
    mockCallWithSession.mockResolvedValueOnce({ uuid: 'vm', power_state: 'Running', allowed_operations: ['pause'] })
      .mockResolvedValueOnce('OpaqueRef:task').mockResolvedValueOnce({ status: 'success' })
      .mockResolvedValueOnce({ uuid: 'vm', power_state: 'Paused' })
    const { pauseVm } = await import('../../src/main/xapi/services/vm.service')
    await pauseVm('conn-123', 'OpaqueRef:vm1')
    expect(mockCallWithSession).toHaveBeenCalledWith('Async.VM.pause', ['OpaqueRef:vm1'])
  })

  it('unpauseVm calls VM.unpause', async () => {
    mockCallWithSession.mockResolvedValueOnce({ uuid: 'vm', power_state: 'Paused', allowed_operations: ['unpause'] })
      .mockResolvedValueOnce('OpaqueRef:task').mockResolvedValueOnce({ status: 'success' })
      .mockResolvedValueOnce({ uuid: 'vm', power_state: 'Running' })
    const { unpauseVm } = await import('../../src/main/xapi/services/vm.service')
    await unpauseVm('conn-123', 'OpaqueRef:vm1')
    expect(mockCallWithSession).toHaveBeenCalledWith('Async.VM.unpause', ['OpaqueRef:vm1'])
  })

  it('suspendVm calls VM.suspend', async () => {
    mockCallWithSession.mockResolvedValueOnce({ uuid: 'vm', power_state: 'Running', allowed_operations: ['suspend'] })
      .mockResolvedValueOnce('OpaqueRef:task').mockResolvedValueOnce({ status: 'success' })
      .mockResolvedValueOnce({ uuid: 'vm', power_state: 'Suspended' })
    const { suspendVm } = await import('../../src/main/xapi/services/vm.service')
    await suspendVm('conn-123', 'OpaqueRef:vm1')
    expect(mockCallWithSession).toHaveBeenCalledWith('Async.VM.suspend', ['OpaqueRef:vm1'])
  })

  it('resumeVm calls VM.resume', async () => {
    mockCallWithSession.mockResolvedValueOnce({ uuid: 'vm', power_state: 'Suspended', allowed_operations: ['resume'] })
      .mockResolvedValueOnce('OpaqueRef:task').mockResolvedValueOnce({ status: 'success' })
      .mockResolvedValueOnce({ uuid: 'vm', power_state: 'Running' })
    const { resumeVm } = await import('../../src/main/xapi/services/vm.service')
    await resumeVm('conn-123', 'OpaqueRef:vm1')
    expect(mockCallWithSession).toHaveBeenCalledWith('Async.VM.resume', ['OpaqueRef:vm1', false, false])
  })

  it('destroyVm destroys a halted VM without deleting owner disks by default', async () => {
    mockCallWithSession
      .mockResolvedValueOnce({
        is_a_template: false,
        is_control_domain: false,
        power_state: 'Halted',
        allowed_operations: ['destroy'],
        current_operations: {},
        VBDs: ['OpaqueRef:vbd1'],
        suspend_VDI: 'OpaqueRef:NULL',
      })
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(Object.assign(new Error('HANDLE_INVALID'), { code: 'HANDLE_INVALID' }))

    const { destroyVm } = await import('../../src/main/xapi/services/vm.service')
    await destroyVm('conn-123', 'OpaqueRef:vm1')

    expect(mockCallWithSession).toHaveBeenCalledWith('VM.get_record', ['OpaqueRef:vm1'])
    expect(mockCallWithSession).toHaveBeenCalledWith('VM.destroy', ['OpaqueRef:vm1'])
    expect(mockCallWithSession.mock.calls.map((call) => call[0])).not.toContain('VBD.get_record')
    expect(mockCallWithSession.mock.calls.map((call) => call[0])).not.toContain('VDI.destroy')
  })

  it('destroyVm deletes only explicitly selected owner VDIs after VM.destroy', async () => {
    mockCallWithSession
      .mockResolvedValueOnce({
        is_a_template: false,
        is_control_domain: false,
        power_state: 'Halted',
        allowed_operations: ['destroy'],
        current_operations: {},
        VBDs: ['OpaqueRef:vbd1', 'OpaqueRef:vbd2', 'OpaqueRef:cd'],
        suspend_VDI: 'OpaqueRef:NULL',
      })
      .mockResolvedValueOnce({
        type: 'Disk',
        mode: 'RW',
        VDI: 'OpaqueRef:vdi1',
        other_config: { owner: 'true' },
      })
      .mockResolvedValueOnce({
        type: 'Disk',
        VDI: 'OpaqueRef:vdi2',
        other_config: {},
      })
      .mockResolvedValueOnce({
        type: 'CD',
        VDI: 'OpaqueRef:iso',
        other_config: { owner: 'true' },
      })
      .mockResolvedValueOnce({ uuid: 'disk', VBDs: ['OpaqueRef:vbd1'], sharable: false, is_a_snapshot: false, type: 'user' })
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(Object.assign(new Error('HANDLE_INVALID'), { code: 'HANDLE_INVALID' }))
      .mockResolvedValueOnce({ VBDs: [], uuid: 'disk' })
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(Object.assign(new Error('HANDLE_INVALID'), { code: 'HANDLE_INVALID' }))

    const { destroyVm } = await import('../../src/main/xapi/services/vm.service')
    await destroyVm('conn-123', 'OpaqueRef:vm1', {
      vdiRefs: ['OpaqueRef:vdi1', 'OpaqueRef:vdi1'],
    })

    const calls = mockCallWithSession.mock.calls.map((call) => [call[0], call[1]])
    expect(calls).toEqual([
      ['VM.get_record', ['OpaqueRef:vm1']],
      ['VBD.get_record', ['OpaqueRef:vbd1']],
      ['VBD.get_record', ['OpaqueRef:vbd2']],
      ['VBD.get_record', ['OpaqueRef:cd']],
      ['VDI.get_record', ['OpaqueRef:vdi1']],
      ['VM.destroy', ['OpaqueRef:vm1']],
      ['VM.get_record', ['OpaqueRef:vm1']],
      ['VDI.get_record', ['OpaqueRef:vdi1']],
      ['VDI.destroy', ['OpaqueRef:vdi1']],
      ['VDI.get_record', ['OpaqueRef:vdi1']],
    ])
  })

  it.each([
    { sharable: true }, { read_only: true }, { is_a_snapshot: true },
    { VBDs: ['vbd', 'other-vbd'] }, { current_operations: { task: 'copy' } },
  ])('automatic disk cleanup preserves protected disks: %o', async (protectedFields) => {
    let deleted = false
    mockCallWithSession.mockImplementation(async (method) => {
      if (method === 'VM.get_record') {
        if (deleted) throw Object.assign(new Error('HANDLE_INVALID'), { code: 'HANDLE_INVALID' })
        return { power_state: 'Halted', allowed_operations: ['destroy'], VBDs: ['vbd'] }
      }
      if (method === 'VBD.get_record') return { type: 'Disk', mode: 'RW', VDI: 'vdi', other_config: { owner: '' } }
      if (method === 'VDI.get_record') return { uuid: 'disk', type: 'user', VBDs: ['vbd'], ...protectedFields }
      if (method === 'VM.destroy') deleted = true
      return null
    })
    const { destroyVm } = await import('../../src/main/xapi/services/vm.service')
    await expect(destroyVm('conn-123', 'vm', { deleteDisks: true })).resolves.toEqual({ vmDeleted: true, failedVdiRefs: [] })
    expect(mockCallWithSession.mock.calls.map(([method]) => method)).not.toContain('VDI.destroy')
  })

  it('automatically deletes only safe owner disks and confirms VM and disk removal', async () => {
    let vmDeleted = false, diskDeleted = false
    mockCallWithSession.mockImplementation(async (method) => {
      if ((method === 'VM.get_record' && vmDeleted) || (method === 'VDI.get_record' && diskDeleted)) throw Object.assign(new Error('HANDLE_INVALID'), { code: 'HANDLE_INVALID' })
      if (method === 'VM.get_record') return { power_state: 'Halted', allowed_operations: ['destroy'], VBDs: ['vbd'] }
      if (method === 'VBD.get_record') return { type: 'Disk', mode: 'RW', VDI: 'vdi', other_config: { owner: 'true' } }
      if (method === 'VDI.get_record') return { uuid: 'disk', type: 'user', VBDs: vmDeleted ? [] : ['vbd'] }
      if (method === 'VM.destroy') vmDeleted = true
      if (method === 'VDI.destroy') diskDeleted = true
      return null
    })
    const { destroyVm } = await import('../../src/main/xapi/services/vm.service')
    await expect(destroyVm('conn-123', 'vm', { deleteDisks: true })).resolves.toEqual({ vmDeleted: true, failedVdiRefs: [] })
    expect(vmDeleted).toBe(true)
    expect(diskDeleted).toBe(true)
  })

  it('stops deletion when the connection changes while reading the disk plan', async () => {
    mockGetConnectionInfo.mockReturnValue({ poolName: 'Test Pool', poolUuid: 'pool', epoch: 1 } as any)
    mockCallWithSession.mockImplementation(async (method) => {
      if (method === 'VM.get_record') return { uuid: 'vm', power_state: 'Halted', allowed_operations: ['destroy'], VBDs: ['vbd'] }
      if (method === 'VBD.get_record') return { type: 'Disk', mode: 'RW', VDI: 'vdi', other_config: { owner: '' } }
      if (method === 'VDI.get_record') {
        mockGetConnectionInfo.mockReturnValue({ poolName: 'Test Pool', poolUuid: 'pool', epoch: 2 } as any)
        return { uuid: 'disk', type: 'user', VBDs: ['vbd'] }
      }
    })
    const { destroyVm } = await import('../../src/main/xapi/services/vm.service')
    await expect(destroyVm('conn-123', 'vm', { deleteDisks: true, intent: { vmUuid: 'vm', poolUuid: 'pool', epoch: 1 } })).rejects.toThrow('连接已变化')
    expect(mockCallWithSession.mock.calls.map(([method]) => method)).not.toContain('VM.destroy')
  })

  it('destroyVm rejects a selected VDI that is not an owner disk before destroying the VM', async () => {
    mockCallWithSession
      .mockResolvedValueOnce({
        is_a_template: false,
        is_control_domain: false,
        power_state: 'Halted',
        allowed_operations: ['destroy'],
        current_operations: {},
        VBDs: ['OpaqueRef:vbd1'],
        suspend_VDI: 'OpaqueRef:NULL',
      })
      .mockResolvedValueOnce({
        type: 'Disk',
        VDI: 'OpaqueRef:vdi1',
        other_config: {},
      })

    const { destroyVm } = await import('../../src/main/xapi/services/vm.service')
    await expect(
      destroyVm('conn-123', 'OpaqueRef:vm1', { vdiRefs: ['OpaqueRef:vdi1'] }),
    ).rejects.toThrow('所选磁盘不属于该 VM')

    expect(mockCallWithSession.mock.calls.map((call) => call[0])).not.toContain('VM.destroy')
    expect(mockCallWithSession.mock.calls.map((call) => call[0])).not.toContain('VDI.destroy')
  })

  it('destroyVm does not treat owner=false as a deletable disk', async () => {
    mockCallWithSession
      .mockResolvedValueOnce({
        is_a_template: false, is_control_domain: false, power_state: 'Halted',
        allowed_operations: ['destroy'], current_operations: {},
        VBDs: ['OpaqueRef:vbd1'], suspend_VDI: 'OpaqueRef:NULL',
      })
      .mockResolvedValueOnce({
        type: 'Disk', mode: 'RW', VDI: 'OpaqueRef:vdi1', other_config: { owner: 'false' },
      })

    const { destroyVm } = await import('../../src/main/xapi/services/vm.service')
    await expect(destroyVm('conn-123', 'OpaqueRef:vm1', { vdiRefs: ['OpaqueRef:vdi1'] }))
      .rejects.toThrow('所选磁盘不属于该 VM')
    expect(mockCallWithSession.mock.calls.map(([method]) => method)).not.toContain('VM.destroy')
  })

  it('destroyVm rejects an owner-marked disk connected to another VM', async () => {
    mockCallWithSession
      .mockResolvedValueOnce({
        is_a_template: false, is_control_domain: false, power_state: 'Halted',
        allowed_operations: ['destroy'], current_operations: {},
        VBDs: ['OpaqueRef:vbd1'], suspend_VDI: 'OpaqueRef:NULL',
      })
      .mockResolvedValueOnce({
        type: 'Disk', mode: 'RW', VDI: 'OpaqueRef:vdi1', other_config: { owner: 'true' },
      })
      .mockResolvedValueOnce({
        VBDs: ['OpaqueRef:vbd1', 'OpaqueRef:other-vbd'],
        sharable: true, is_a_snapshot: false, type: 'user',
      })

    const { destroyVm } = await import('../../src/main/xapi/services/vm.service')
    await expect(destroyVm('conn-123', 'OpaqueRef:vm1', { vdiRefs: ['OpaqueRef:vdi1'] }))
      .rejects.toThrow('所选磁盘并非可删除的独占拥有磁盘')
    expect(mockCallWithSession.mock.calls.map(([method]) => method)).not.toContain('VM.destroy')
  })

  it('destroyVm reports remaining disks when post-destroy cleanup fails', async () => {
    mockCallWithSession
      .mockResolvedValueOnce({
        is_a_template: false,
        is_control_domain: false,
        power_state: 'Halted',
        allowed_operations: ['destroy'],
        current_operations: {},
        VBDs: ['OpaqueRef:vbd1'],
        suspend_VDI: 'OpaqueRef:NULL',
      })
      .mockResolvedValueOnce({
        type: 'Disk',
        mode: 'RW',
        VDI: 'OpaqueRef:vdi1',
        other_config: { owner: 'true' },
      })
      .mockResolvedValueOnce({ uuid: 'disk', VBDs: ['OpaqueRef:vbd1'], sharable: false, is_a_snapshot: false, type: 'user' })
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(Object.assign(new Error('HANDLE_INVALID'), { code: 'HANDLE_INVALID' }))
      .mockResolvedValueOnce({ uuid: 'disk', VBDs: [] })
      .mockRejectedValueOnce(new Error('VDI_IN_USE'))

    const { destroyVm } = await import('../../src/main/xapi/services/vm.service')
    await expect(destroyVm('conn-123', 'OpaqueRef:vm1', { vdiRefs: ['OpaqueRef:vdi1'] }))
      .resolves.toEqual({ vmDeleted: true, failedVdiRefs: ['OpaqueRef:vdi1'] })

    expect(mockCallWithSession).toHaveBeenCalledWith('VM.destroy', ['OpaqueRef:vm1'])
    expect(mockCallWithSession).toHaveBeenCalledWith('VDI.destroy', ['OpaqueRef:vdi1'])
  })

  it('destroyVm always deletes suspend VDI after VM.destroy', async () => {
    mockCallWithSession
      .mockResolvedValueOnce({
        is_a_template: false,
        is_control_domain: false,
        power_state: 'Halted',
        allowed_operations: ['destroy'],
        current_operations: {},
        VBDs: [],
        suspend_VDI: 'OpaqueRef:suspend-vdi',
      })
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(Object.assign(new Error('HANDLE_INVALID'), { code: 'HANDLE_INVALID' }))
      .mockResolvedValueOnce({ VBDs: [], uuid: 'disk' })
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(Object.assign(new Error('HANDLE_INVALID'), { code: 'HANDLE_INVALID' }))

    const { destroyVm } = await import('../../src/main/xapi/services/vm.service')
    await destroyVm('conn-123', 'OpaqueRef:vm1')

    expect(mockCallWithSession).toHaveBeenCalledWith('VM.destroy', ['OpaqueRef:vm1'])
    expect(mockCallWithSession).toHaveBeenCalledWith('VDI.destroy', ['OpaqueRef:suspend-vdi'])
  })

  it('destroyVm rejects running VMs before calling VM.destroy', async () => {
    mockCallWithSession.mockResolvedValueOnce({
      is_a_template: false,
      is_control_domain: false,
      power_state: 'Running',
      allowed_operations: ['destroy'],
      current_operations: {},
      VBDs: [],
      suspend_VDI: 'OpaqueRef:NULL',
    })

    const { destroyVm } = await import('../../src/main/xapi/services/vm.service')
    await expect(destroyVm('conn-123', 'OpaqueRef:vm1')).rejects.toThrow('只有已停止的 VM 可以删除')
    expect(mockCallWithSession.mock.calls.map((call) => call[0])).not.toContain('VM.destroy')
  })

  it('destroyVm rejects missing allowed operations before deleting', async () => {
    mockCallWithSession.mockResolvedValueOnce({
      is_a_template: false,
      is_control_domain: false,
      power_state: 'Halted',
      current_operations: {},
      VBDs: [],
    })
    const { destroyVm } = await import('../../src/main/xapi/services/vm.service')
    await expect(destroyVm('conn-123', 'OpaqueRef:vm1')).rejects.toThrow('XAPI 当前不允许删除')
    expect(mockCallWithSession).not.toHaveBeenCalledWith('VM.destroy', ['OpaqueRef:vm1'])
  })

  it('snapshotVm calls VM.snapshot with the version-compatible parameters and returns the new ref', async () => {
    mockCallWithSession.mockResolvedValueOnce('OpaqueRef:snapshot1')
    const { snapshotVm } = await import('../../src/main/xapi/services/vm.service')
    const ref = await snapshotVm('conn-123', 'OpaqueRef:vm1', 'my-snapshot')
    expect(ref).toBe('OpaqueRef:snapshot1')
    expect(mockCallWithSession).toHaveBeenCalledWith('VM.snapshot', ['OpaqueRef:vm1', 'my-snapshot'])
  })

  it('snapshotVm verifies the reviewed identity and reads back the created snapshot', async () => {
    mockGetConnectionInfo.mockReturnValue({ poolName: 'Test Pool', poolUuid: 'pool', epoch: 1 } as any)
    mockCallWithSession.mockResolvedValueOnce({ uuid: 'vm', power_state: 'Running', allowed_operations: ['snapshot'] })
      .mockResolvedValueOnce('OpaqueRef:snapshot1')
      .mockResolvedValueOnce({ is_a_snapshot: true, snapshot_of: 'OpaqueRef:vm1' })
    const { snapshotVm } = await import('../../src/main/xapi/services/vm.service')
    await expect(snapshotVm('conn-123', 'OpaqueRef:vm1', 'my-snapshot', { vmUuid: 'vm', poolUuid: 'pool', epoch: 1 })).resolves.toBe('OpaqueRef:snapshot1')
    expect(mockCallWithSession).toHaveBeenLastCalledWith('VM.get_record', ['OpaqueRef:snapshot1'])
  })

  it('snapshotVm rejects a replaced VM before creating a snapshot', async () => {
    mockGetConnectionInfo.mockReturnValue({ poolName: 'Test Pool', poolUuid: 'pool', epoch: 1 } as any)
    mockCallWithSession.mockResolvedValueOnce({ uuid: 'other-vm', power_state: 'Running', allowed_operations: ['snapshot'] })
    const { snapshotVm } = await import('../../src/main/xapi/services/vm.service')
    await expect(snapshotVm('conn-123', 'OpaqueRef:vm1', 'my-snapshot', { vmUuid: 'vm', poolUuid: 'pool', epoch: 1 })).rejects.toThrow('虚拟机或资源池连接已变化')
    expect(mockCallWithSession.mock.calls.map(([method]) => method)).not.toContain('VM.snapshot')
  })

  it('migrateVm calls VM.pool_migrate', async () => {
    mockCallWithSession.mockResolvedValueOnce(null)
    const { migrateVm } = await import('../../src/main/xapi/services/vm.service')
    await migrateVm('conn-123', 'OpaqueRef:vm1', 'OpaqueRef:host2')
    expect(mockCallWithSession).toHaveBeenCalledWith('VM.pool_migrate', ['OpaqueRef:vm1', 'OpaqueRef:host2', {}])
  })

  it('copyVm delegates quick cloning to the durable copy service', async () => {
    mockStartCopy.mockResolvedValueOnce(copyOperation)
    const { copyVm } = await import('../../src/main/xapi/services/vm.service')
    const payload = { vmRef: 'OpaqueRef:vm1', newName: 'Copy', mode: 'clone' as const, nameDescription: 'copied' }
    expect(await copyVm('conn-123', payload)).toEqual(copyOperation)
    expect(mockStartCopy).toHaveBeenCalledWith('conn-123', payload)
    expect(mockCallWithSession).not.toHaveBeenCalled()
  })
  it('copyVm delegates full copy with the requested target SR', async () => {
    mockStartCopy.mockResolvedValueOnce(copyOperation)
    const { copyVm } = await import('../../src/main/xapi/services/vm.service')
    const payload = { vmRef: 'OpaqueRef:vm1', newName: 'Copy', mode: 'copy' as const, targetSrRef: 'OpaqueRef:sr1' }
    expect(await copyVm('conn-123', payload)).toEqual(copyOperation)
    expect(mockStartCopy).toHaveBeenCalledWith('conn-123', payload)
  })
  it('copyVm preserves preflight errors without falling back to synchronous copying', async () => {
    mockStartCopy.mockRejectedValueOnce(new Error('COPY_SR_UNAVAILABLE'))
    const { copyVm } = await import('../../src/main/xapi/services/vm.service')
    await expect(copyVm('conn-123', { vmRef: 'OpaqueRef:vm1', newName: 'Copy', mode: 'copy' })).rejects.toThrow('COPY_SR_UNAVAILABLE')
    expect(mockCallWithSession).not.toHaveBeenCalled()
  })

  it('startVm propagates errors from XAPI', async () => {
    mockCallWithSession.mockRejectedValueOnce(new Error('VM_BAD_POWER_STATE'))
    const { startVm } = await import('../../src/main/xapi/services/vm.service')
    await expect(startVm('conn-123', 'OpaqueRef:vm1')).rejects.toThrow('VM_BAD_POWER_STATE')
  })

  it('shutdownVm propagates errors from XAPI', async () => {
    mockCallWithSession.mockRejectedValueOnce(new Error('VM_BAD_POWER_STATE'))
    const { shutdownVm } = await import('../../src/main/xapi/services/vm.service')
    await expect(shutdownVm('conn-123', 'OpaqueRef:vm1')).rejects.toThrow('VM_BAD_POWER_STATE')
  })

  it('forceShutdownVm propagates errors', async () => {
    mockCallWithSession.mockRejectedValueOnce(new Error('XAPI_ERROR'))
    const { forceShutdownVm } = await import('../../src/main/xapi/services/vm.service')
    await expect(forceShutdownVm('conn-123', 'OpaqueRef:vm1')).rejects.toThrow('XAPI_ERROR')
  })

  it('rebootVm propagates errors', async () => {
    mockCallWithSession.mockRejectedValueOnce(new Error('XAPI_ERROR'))
    const { rebootVm } = await import('../../src/main/xapi/services/vm.service')
    await expect(rebootVm('conn-123', 'OpaqueRef:vm1')).rejects.toThrow('XAPI_ERROR')
  })

  it('suspendVm propagates errors', async () => {
    mockCallWithSession.mockRejectedValueOnce(new Error('XAPI_ERROR'))
    const { suspendVm } = await import('../../src/main/xapi/services/vm.service')
    await expect(suspendVm('conn-123', 'OpaqueRef:vm1')).rejects.toThrow('XAPI_ERROR')
  })

  it('resumeVm propagates errors', async () => {
    mockCallWithSession.mockRejectedValueOnce(new Error('XAPI_ERROR'))
    const { resumeVm } = await import('../../src/main/xapi/services/vm.service')
    await expect(resumeVm('conn-123', 'OpaqueRef:vm1')).rejects.toThrow('XAPI_ERROR')
  })

  it('migrateVm propagates errors', async () => {
    mockCallWithSession.mockRejectedValueOnce(new Error('HOST_NOT_LIVE'))
    const { migrateVm } = await import('../../src/main/xapi/services/vm.service')
    await expect(migrateVm('conn-123', 'OpaqueRef:vm1', 'OpaqueRef:host2')).rejects.toThrow('HOST_NOT_LIVE')
  })

  // v3: getVmRecord
  it('getVmRecord returns detailed record with guest metrics', async () => {
    mockCallWithSession
      .mockResolvedValueOnce({ // VM.get_record
        name_label: 'test-vm',
        power_state: 'Running',
        uuid: 'abc-123',
        name_description: '',
        resident_on: 'OpaqueRef:host1',
        VCPUs_max: 2,
        VCPUs_at_startup: 2,
        memory_static_max: 2147483648,
        memory_static_min: 536870912,
        memory_dynamic_max: 2147483648,
        memory_dynamic_min: 536870912,
        is_a_template: false,
        is_control_domain: false,
        VBDs: [],
        VIFs: [],
        consoles: [],
        metrics: 'OpaqueRef:m1',
        guest_metrics: 'OpaqueRef:gm1',
      })
      .mockResolvedValueOnce({ // VM_guest_metrics.get_record
        os_version: { name: 'Ubuntu 22.04', uname: '5.15.0' },
        networks: { '0/ip': '10.0.0.1' },
      })

    const { getVmRecord } = await import('../../src/main/xapi/services/vm.service')
    const record = await getVmRecord('conn-123', 'OpaqueRef:vm1')

    expect(record.name_label).toBe('test-vm')
    expect(record.os_version.name).toBe('Ubuntu 22.04')
    expect(record.networks['0/ip']).toBe('10.0.0.1')
    expect(record.ref).toBe('OpaqueRef:vm1')
  })

  it('getVmRecord handles missing guest metrics gracefully', async () => {
    mockCallWithSession
      .mockResolvedValueOnce({ // VM.get_record
        name_label: 'test-vm',
        power_state: 'Halted',
        uuid: 'abc-456',
        name_description: '',
        resident_on: '',
        VCPUs_max: 1,
        VCPUs_at_startup: 1,
        memory_static_max: 1073741824,
        memory_static_min: 268435456,
        memory_dynamic_max: 1073741824,
        memory_dynamic_min: 268435456,
        is_a_template: false,
        is_control_domain: false,
        VBDs: [],
        VIFs: [],
        consoles: [],
        metrics: 'OpaqueRef:NULL',
        guest_metrics: 'OpaqueRef:NULL', // NULL ref — no guest metrics
      })
    // No second call expected because guest_metrics is NULL

    const { getVmRecord } = await import('../../src/main/xapi/services/vm.service')
    const record = await getVmRecord('conn-123', 'OpaqueRef:vm2')

    expect(record.name_label).toBe('test-vm')
    expect(record.os_version).toEqual({})
    expect(record.networks).toEqual({})
  })

  // v3: setVmNameLabel
  it('setVmNameLabel calls VM.set_name_label', async () => {
    mockCallWithSession.mockResolvedValueOnce(null)
    const { setVmNameLabel } = await import('../../src/main/xapi/services/vm.service')
    await setVmNameLabel('conn-123', 'OpaqueRef:vm1', 'new-name')
    expect(mockCallWithSession).toHaveBeenCalledWith('VM.set_name_label', ['OpaqueRef:vm1', 'new-name'])
  })

  // v3: setVmNameDescription
  it('setVmNameDescription calls VM.set_name_description', async () => {
    mockCallWithSession.mockResolvedValueOnce(null)
    const { setVmNameDescription } = await import('../../src/main/xapi/services/vm.service')
    await setVmNameDescription('conn-123', 'OpaqueRef:vm1', 'new desc')
    expect(mockCallWithSession).toHaveBeenCalledWith('VM.set_name_description', ['OpaqueRef:vm1', 'new desc'])
  })

  // v3: setVmVcpus
  it('setVmVcpus lowers startup before max to preserve the XAPI invariant', async () => {
    mockCallWithSession.mockResolvedValueOnce({ power_state: 'Halted', VCPUs_at_startup: 8, VCPUs_max: 8 }).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce({ VCPUs_at_startup: 4, VCPUs_max: 4 })
    const { setVmVcpus } = await import('../../src/main/xapi/services/vm.service')
    await setVmVcpus('conn-123', 'OpaqueRef:vm1', 4)
    expect(mockCallWithSession.mock.calls.map(([method]) => method)).toEqual([
      'VM.get_record', 'VM.set_VCPUs_at_startup', 'VM.set_VCPUs_max', 'VM.get_record',
    ])
  })

  it('setVmVcpus raises max before startup', async () => {
    mockCallWithSession.mockResolvedValueOnce({ power_state: 'Halted', VCPUs_at_startup: 2, VCPUs_max: 2 }).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce({ VCPUs_at_startup: 4, VCPUs_max: 4 })
    const { setVmVcpus } = await import('../../src/main/xapi/services/vm.service')
    await setVmVcpus('conn-123', 'OpaqueRef:vm1', 4)
    expect(mockCallWithSession.mock.calls.map(([method]) => method)).toEqual([
      'VM.get_record', 'VM.set_VCPUs_max', 'VM.set_VCPUs_at_startup', 'VM.get_record',
    ])
  })


  it('reports the read-back VCPU configuration after a second-step failure without retrying', async () => {
    mockCallWithSession.mockResolvedValueOnce({ power_state: 'Halted', VCPUs_at_startup: 2, VCPUs_max: 2 })
      .mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('permission denied'))
      .mockResolvedValueOnce({ VCPUs_at_startup: 2, VCPUs_max: 4 })
    const { setVmVcpus } = await import('../../src/main/xapi/services/vm.service')
    await expect(setVmVcpus('conn-123', 'OpaqueRef:vm1', 4)).rejects.toThrow('当前启动数量 2，最大数量 4')
    expect(mockCallWithSession.mock.calls.map(([method]) => method)).toEqual(['VM.get_record', 'VM.set_VCPUs_max', 'VM.set_VCPUs_at_startup', 'VM.get_record'])
  })

  it('reconciles a lost VCPU response only by reading the applied values', async () => {
    mockCallWithSession.mockResolvedValueOnce({ power_state: 'Halted', VCPUs_at_startup: 2, VCPUs_max: 2 })
      .mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce({ VCPUs_at_startup: 4, VCPUs_max: 4 })
    const { setVmVcpus } = await import('../../src/main/xapi/services/vm.service')
    await expect(setVmVcpus('conn-123', 'OpaqueRef:vm1', 4)).resolves.toBeUndefined()
    expect(mockCallWithSession).toHaveBeenCalledTimes(4)
  })

  it('does not retry VCPU writes when the final read fails', async () => {
    mockCallWithSession.mockResolvedValueOnce({ power_state: 'Halted', VCPUs_at_startup: 2, VCPUs_max: 2 })
      .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockRejectedValue(new Error('disconnected'))
    const { setVmVcpus } = await import('../../src/main/xapi/services/vm.service')
    await expect(setVmVcpus('conn-123', 'OpaqueRef:vm1', 4)).rejects.toThrow('无法获取 VCPU 保存结果：disconnected')
    expect(mockCallWithSession).toHaveBeenCalledTimes(6)
  })

  it.each([{ power_state: 'Running' }, { power_state: 'Halted', is_a_template: true }, { power_state: 'Halted', current_operations: { task: 'start' } }, { power_state: 'Halted', allowed_operations: [] }])('rejects a VCPU edit when the current record forbids it (%j)', async (record) => {
    mockCallWithSession.mockResolvedValueOnce({ VCPUs_at_startup: 2, VCPUs_max: 2, ...record })
    const { setVmVcpus } = await import('../../src/main/xapi/services/vm.service')
    await expect(setVmVcpus('conn-123', 'OpaqueRef:vm1', 4)).rejects.toThrow()
    expect(mockCallWithSession).toHaveBeenCalledTimes(1)
  })

  it('rejects destruction of an explicitly protected VM before reading or deleting disks', async () => {
    mockCallWithSession.mockResolvedValueOnce({ power_state: 'Halted', allowed_operations: ['destroy'], blocked_operations: { destroy: 'protected' } })
    const { destroyVm } = await import('../../src/main/xapi/services/vm.service')
    await expect(destroyVm('conn-123', 'OpaqueRef:vm1')).rejects.toThrow('删除保护')
    expect(mockCallWithSession).toHaveBeenCalledTimes(1)
  })

  // v3: setVmMemoryLimits
  it('setVmMemoryLimits calls VM.set_memory_limits with string params', async () => {
    mockCallWithSession.mockResolvedValueOnce({
      power_state: 'Halted', memory_static_min: 268435456,
      memory_dynamic_min: 536870912, memory_dynamic_max: 2147483648,
      memory_static_max: 2147483648, allowed_operations: ['changing_memory_limits'],
    }).mockResolvedValueOnce(null)
    const { setVmMemoryLimits } = await import('../../src/main/xapi/services/vm.service')
    await setVmMemoryLimits('conn-123', 'OpaqueRef:vm1', 268435456, 536870912, 2147483648, 4294967296)
    expect(mockCallWithSession).toHaveBeenCalledWith('VM.set_memory_limits', [
      'OpaqueRef:vm1', '268435456', '4294967296', '536870912', '2147483648'
    ])
  })

  // v3: getVmVBDs
  it('getVmVBDs returns filtered Disk-type VBDs with VDI info', async () => {
    mockCallWithSession
      .mockResolvedValueOnce(['OpaqueRef:vbd1', 'OpaqueRef:vbd2']) // VM.get_VBDs
      .mockResolvedValueOnce({ // VBD.get_record vbd1
        VDI: 'OpaqueRef:vdi1',
        userdevice: '0',
        mode: 'RW',
        type: 'Disk',
        bootable: true,
        currently_attached: true,
        unpluggable: true,
        allowed_operations: ['unplug'],
        other_config: { owner: 'true' },
      })
      .mockResolvedValueOnce({ // VBD.get_record vbd2
        VDI: 'OpaqueRef:NULL',
        userdevice: '3',
        mode: 'RO',
        type: 'CD',
        bootable: false,
      })
      .mockResolvedValueOnce({ // VDI.get_record vdi1
        name_label: 'root-disk',
        virtual_size: '21474836480',
        SR: 'OpaqueRef:sr1',
      })

    const { getVmVBDs } = await import('../../src/main/xapi/services/vm.service')
    const vbds = await getVmVBDs('conn-123', 'OpaqueRef:vm1')

    expect(vbds).toHaveLength(1)
    expect(vbds[0].vdiName).toBe('root-disk')
    expect(vbds[0].vdiSize).toBe(21474836480)
    expect(vbds[0].bootable).toBe(true)
    expect(vbds[0].mode).toBe('RW')
    expect(vbds[0].currently_attached).toBe(true)
    expect(vbds[0].unpluggable).toBe(true)
    expect(vbds[0].allowed_operations).toEqual(['unplug'])
    expect(vbds[0].owner).toBe(true)
  })

  it('plugVbd calls VBD.plug', async () => {
    mockCallWithSession.mockResolvedValueOnce(null)
    const { plugVbd } = await import('../../src/main/xapi/services/vm.service')
    await plugVbd('conn-123', 'OpaqueRef:vbd1')
    expect(mockCallWithSession).toHaveBeenCalledWith('VBD.plug', ['OpaqueRef:vbd1'])
  })

  it('unplugVbd calls VBD.unplug', async () => {
    mockCallWithSession.mockResolvedValueOnce(null)
    const { unplugVbd } = await import('../../src/main/xapi/services/vm.service')
    await unplugVbd('conn-123', 'OpaqueRef:vbd1')
    expect(mockCallWithSession).toHaveBeenCalledWith('VBD.unplug', ['OpaqueRef:vbd1'])
  })

  it('detachVbd unplugs attached VBDs before destroying them', async () => {
    mockCallWithSession
      .mockResolvedValueOnce({ currently_attached: true })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)

    const { detachVbd } = await import('../../src/main/xapi/services/vm.service')
    await detachVbd('conn-123', 'OpaqueRef:vbd1')

    expect(mockCallWithSession.mock.calls).toEqual([
      ['VBD.get_record', ['OpaqueRef:vbd1']],
      ['VBD.unplug', ['OpaqueRef:vbd1']],
      ['VBD.destroy', ['OpaqueRef:vbd1']],
    ])
  })

  it('detachVbd destroys inactive VBDs without unplugging', async () => {
    mockCallWithSession
      .mockResolvedValueOnce({ currently_attached: false })
      .mockResolvedValueOnce(null)

    const { detachVbd } = await import('../../src/main/xapi/services/vm.service')
    await detachVbd('conn-123', 'OpaqueRef:vbd1')

    expect(mockCallWithSession.mock.calls).toEqual([
      ['VBD.get_record', ['OpaqueRef:vbd1']],
      ['VBD.destroy', ['OpaqueRef:vbd1']],
    ])
  })

  // v3: getVmVIFs
  it('getVmVIFs returns VIF records with network names', async () => {
    mockCallWithSession
      .mockResolvedValueOnce(['OpaqueRef:vif1']) // VM.get_VIFs
      .mockResolvedValueOnce({ // VIF.get_record
        device: '0',
        MAC: '00:11:22:33:44:55',
        network: 'OpaqueRef:net1',
        MTU: '1500',
      })
      .mockResolvedValueOnce({ // network.get_record
        name_label: 'Management Network',
      })

    const { getVmVIFs } = await import('../../src/main/xapi/services/vm.service')
    const vifs = await getVmVIFs('conn-123', 'OpaqueRef:vm1')

    expect(vifs).toHaveLength(1)
    expect(vifs[0].MAC).toBe('00:11:22:33:44:55')
    expect(vifs[0].networkName).toBe('Management Network')
    expect(vifs[0].MTU).toBe(1500)
  })

  // v3: getVmSnapshots
  it('getVmSnapshots returns snapshot records sorted newest first', async () => {
    mockCallWithSession
      .mockResolvedValueOnce(['OpaqueRef:snap1', 'OpaqueRef:snap2']) // VM.get_snapshots
      .mockResolvedValueOnce({ // snap1 VM.get_record
        uuid: 'snap-uuid-1',
        name_label: 'snap-1',
        name_description: '',
        snapshot_time: '2026-03-23T06:00:00Z',
        VBDs: [],
      })
      .mockResolvedValueOnce({ // snap2 VM.get_record
        uuid: 'snap-uuid-2',
        name_label: 'snap-2',
        name_description: '',
        snapshot_time: '2026-03-23T05:00:00Z',
        VBDs: [],
      })

    const { getVmSnapshots } = await import('../../src/main/xapi/services/vm.service')
    const snaps = await getVmSnapshots('conn-123', 'OpaqueRef:vm1')

    expect(snaps).toHaveLength(2)
    // Should be sorted newest first
    expect(snaps[0].name_label).toBe('snap-1')
    expect(snaps[1].name_label).toBe('snap-2')
  })

  it('normalizes XML-RPC snapshot dates before sorting and IPC validation', async () => {
    mockCallWithSession
      .mockResolvedValueOnce(['OpaqueRef:snap1', 'OpaqueRef:snap2'])
      .mockResolvedValueOnce({
        uuid: 'snap-uuid-1',
        name_label: 'older',
        name_description: '',
        snapshot_time: new Date('2026-09-28T00:00:00.000Z'),
        VBDs: [],
      })
      .mockResolvedValueOnce({
        uuid: 'snap-uuid-2',
        name_label: 'newer',
        name_description: '',
        snapshot_time: new Date('2026-09-29T00:00:00.000Z'),
        VBDs: [],
      })

    const { getVmSnapshots } = await import('../../src/main/xapi/services/vm.service')
    const snapshots = await getVmSnapshots('conn-123', 'OpaqueRef:vm1')

    expect(snapshots.map(({ name_label }) => name_label)).toEqual(['newer', 'older'])
    expect(snapshots[0].snapshot_time).toBe('2026-09-29T00:00:00.000Z')
    expect(vmGetSnapshotsContract.resultSchema.parse(snapshots)).toEqual(snapshots)
  })

  // v3: revertVmSnapshot
  it('revertVmSnapshot calls VM.revert', async () => {
    mockCallWithSession.mockResolvedValueOnce(null)
    const { revertVmSnapshot } = await import('../../src/main/xapi/services/vm.service')
    await revertVmSnapshot('conn-123', 'OpaqueRef:snap1')
    expect(mockCallWithSession).toHaveBeenCalledWith('VM.revert', ['OpaqueRef:snap1'])
  })

  // v3: deleteVmSnapshot
  it('deleteVmSnapshot destroys the VM record before its exclusive RW VDI', async () => {
    mockCallWithSession
      .mockResolvedValueOnce({ // VM.get_record (snap)
        is_a_snapshot: true,
        allowed_operations: ['destroy'],
        VBDs: ['OpaqueRef:vbd1'],
      })
      .mockResolvedValueOnce({ // VBD.get_record
        VDI: 'OpaqueRef:vdi1',
        type: 'Disk',
        mode: 'RW', other_config: { owner: 'true' },
      })
      .mockResolvedValueOnce({ VBDs: ['OpaqueRef:vbd1'], sharable: false, is_a_snapshot: true, read_only: true }) // VDI.get_record
      .mockResolvedValueOnce(null) // VM.destroy
      .mockResolvedValueOnce(null) // VDI.destroy

    const { deleteVmSnapshot } = await import('../../src/main/xapi/services/vm.service')
    await expect(deleteVmSnapshot('conn-123', 'OpaqueRef:snap1'))
      .resolves.toEqual({ vmDeleted: true, failedVdiRefs: [] })

    expect(mockCallWithSession).toHaveBeenCalledWith('VDI.destroy', ['OpaqueRef:vdi1'])
    expect(mockCallWithSession).toHaveBeenCalledWith('VM.destroy', ['OpaqueRef:snap1'])
    const methods = mockCallWithSession.mock.calls.map((call) => call[0])
    expect(methods.indexOf('VM.destroy')).toBeLessThan(methods.indexOf('VDI.destroy'))
  })

  // v3: renameVmSnapshot
  it('renameVmSnapshot calls VM.set_name_label', async () => {
    mockCallWithSession.mockResolvedValueOnce(null)
    const { renameVmSnapshot } = await import('../../src/main/xapi/services/vm.service')
    await renameVmSnapshot('conn-123', 'OpaqueRef:snap1', 'renamed-snap')
    expect(mockCallWithSession).toHaveBeenCalledWith('VM.set_name_label', ['OpaqueRef:snap1', 'renamed-snap'])
  })

  // getVmConsole
  it('getVmConsole returns console records', async () => {
    mockCallWithSession
      .mockResolvedValueOnce(['OpaqueRef:con1']) // VM.get_consoles
      .mockResolvedValueOnce({ location: 'https://host/console?ref=con1', protocol: 'rfb' }) // console.get_record

    const { getVmConsole } = await import('../../src/main/xapi/services/vm.service')
    const consoles = await getVmConsole('conn-123', 'OpaqueRef:vm1')
    expect(consoles).toHaveLength(1)
    expect(consoles[0].protocol).toBe('rfb')
    expect(consoles[0].location).toBe('https://host/console?ref=con1')
  })

  it('getVmConsole returns empty array when no consoles', async () => {
    mockCallWithSession.mockResolvedValueOnce([]) // VM.get_consoles
    const { getVmConsole } = await import('../../src/main/xapi/services/vm.service')
    const consoles = await getVmConsole('conn-123', 'OpaqueRef:vm1')
    expect(consoles).toHaveLength(0)
  })

  // getVmVBDs error handling
  it('getVmVBDs handles VDI.get_record error gracefully', async () => {
    mockCallWithSession
      .mockResolvedValueOnce(['OpaqueRef:vbd1']) // VM.get_VBDs
      .mockResolvedValueOnce({ // VBD.get_record — type Disk but VDI fetch will fail
        VDI: 'OpaqueRef:vdi1',
        userdevice: '0',
        mode: 'RW',
        type: 'Disk',
        bootable: false,
      })
      .mockRejectedValueOnce(new Error('VDI not found')) // VDI.get_record fails

    const { getVmVBDs } = await import('../../src/main/xapi/services/vm.service')
    const vbds = await getVmVBDs('conn-123', 'OpaqueRef:vm1')
    expect(vbds).toHaveLength(1)
    expect(vbds[0].vdiName).toBe('')
    expect(vbds[0].vdiSize).toBe(0)
  })

  it('listIsoImages returns ISO VDIs with SR names', async () => {
    mockCallWithSession
      .mockResolvedValueOnce({
        'OpaqueRef:sr1': { name_label: 'ISO Library', type: 'nfs', content_type: 'iso' },
        'OpaqueRef:sr2': { name_label: 'Local storage', type: 'ext' },
      })
      .mockResolvedValueOnce({
        'OpaqueRef:iso1': {
          uuid: 'iso-uuid',
          name_label: 'ubuntu.iso',
          name_description: 'installer',
          virtual_size: '1073741824',
          physical_utilisation: '1073741824',
          type: 'user',
          SR: 'OpaqueRef:sr1',
          read_only: true,
        },
        'OpaqueRef:vdi1': {
          uuid: 'disk-uuid',
          name_label: 'disk',
          virtual_size: '2147483648',
          type: 'user',
          SR: 'OpaqueRef:sr2',
        },
      })

    const { listIsoImages } = await import('../../src/main/xapi/services/vm.service')
    const isos = await listIsoImages('conn-123')

    expect(isos).toHaveLength(1)
    expect(isos[0]).toMatchObject({
      ref: 'OpaqueRef:iso1',
      name_label: 'ubuntu.iso',
      srName: 'ISO Library',
      virtual_size: 1073741824,
      connectionId: 'conn-123',
      poolName: 'Test Pool',
    })
  })

  it('mountVmIso inserts an ISO into an empty CD VBD', async () => {
    mockCallWithSession
      .mockResolvedValueOnce({ type: 'user', name_label: 'ubuntu.iso', SR: 'OpaqueRef:sr1' })
      .mockResolvedValueOnce({ name_label: 'ISO Library', type: 'nfs', content_type: 'iso' })
      .mockResolvedValueOnce(['OpaqueRef:cd1'])
      .mockResolvedValueOnce({
        VDI: 'OpaqueRef:NULL',
        userdevice: '3',
        mode: 'RO',
        type: 'CD',
        empty: true,
      })
      .mockResolvedValueOnce(null)

    const { mountVmIso } = await import('../../src/main/xapi/services/vm.service')
    await mountVmIso('conn-123', 'OpaqueRef:vm1', 'OpaqueRef:iso1')

    expect(mockCallWithSession).toHaveBeenCalledWith('VBD.insert', ['OpaqueRef:cd1', 'OpaqueRef:iso1'])
    expect(mockCallWithSession).not.toHaveBeenCalledWith('VBD.eject', expect.anything())
  })

  it('mountVmIso replaces a mounted ISO by ejecting before insert', async () => {
    mockCallWithSession
      .mockResolvedValueOnce({ type: 'user', name_label: 'debian.iso', SR: 'OpaqueRef:sr1' })
      .mockResolvedValueOnce({ name_label: 'ISO Library', type: 'nfs', content_type: 'iso' })
      .mockResolvedValueOnce(['OpaqueRef:cd1'])
      .mockResolvedValueOnce({
        VDI: 'OpaqueRef:old-iso',
        userdevice: '3',
        mode: 'RO',
        type: 'CD',
        empty: false,
      })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)

    const { mountVmIso } = await import('../../src/main/xapi/services/vm.service')
    await mountVmIso('conn-123', 'OpaqueRef:vm1', 'OpaqueRef:new-iso')

    const calls = mockCallWithSession.mock.calls.map(([method, params]) => ({ method, params }))
    expect(calls).toEqual([
      { method: 'VDI.get_record', params: ['OpaqueRef:new-iso'] },
      { method: 'SR.get_record', params: ['OpaqueRef:sr1'] },
      { method: 'VM.get_VBDs', params: ['OpaqueRef:vm1'] },
      { method: 'VBD.get_record', params: ['OpaqueRef:cd1'] },
      { method: 'VBD.eject', params: ['OpaqueRef:cd1'] },
      { method: 'VBD.insert', params: ['OpaqueRef:cd1', 'OpaqueRef:new-iso'] },
    ])
  })

  it('mountVmIso creates an empty CD VBD when the VM has no CD drive', async () => {
    mockCallWithSession
      .mockResolvedValueOnce({ type: 'user', name_label: 'tools.iso', SR: 'OpaqueRef:sr1' })
      .mockResolvedValueOnce({ name_label: 'ISO Library', type: 'nfs', content_type: 'iso' })
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(['4', '3'])
      .mockResolvedValueOnce('OpaqueRef:new-cd')
      .mockResolvedValueOnce(null)

    const { mountVmIso } = await import('../../src/main/xapi/services/vm.service')
    await mountVmIso('conn-123', 'OpaqueRef:vm1', 'OpaqueRef:iso1')

    expect(mockCallWithSession).toHaveBeenCalledWith('VM.get_allowed_VBD_devices', ['OpaqueRef:vm1'])
    expect(mockCallWithSession).toHaveBeenCalledWith('VBD.create', [
      expect.objectContaining({
        VM: 'OpaqueRef:vm1',
        VDI: 'OpaqueRef:NULL',
        userdevice: '3',
        mode: 'RO',
        type: 'CD',
        empty: true,
      }),
    ])
    expect(mockCallWithSession).toHaveBeenCalledWith('VBD.insert', ['OpaqueRef:new-cd', 'OpaqueRef:iso1'])
  })

  it('ejectVmIso ejects a mounted ISO', async () => {
    mockCallWithSession
      .mockResolvedValueOnce(['OpaqueRef:cd1'])
      .mockResolvedValueOnce({
        VDI: 'OpaqueRef:iso1',
        userdevice: '3',
        type: 'CD',
        empty: false,
      })
      .mockResolvedValueOnce(null)

    const { ejectVmIso } = await import('../../src/main/xapi/services/vm.service')
    await ejectVmIso('conn-123', 'OpaqueRef:vm1')

    expect(mockCallWithSession).toHaveBeenCalledWith('VBD.eject', ['OpaqueRef:cd1'])
  })

  it('ejectVmIso treats an empty CD drive as a no-op', async () => {
    mockCallWithSession
      .mockResolvedValueOnce(['OpaqueRef:cd1'])
      .mockResolvedValueOnce({
        VDI: 'OpaqueRef:NULL',
        userdevice: '3',
        type: 'CD',
        empty: true,
      })

    const { ejectVmIso } = await import('../../src/main/xapi/services/vm.service')
    await ejectVmIso('conn-123', 'OpaqueRef:vm1')

    expect(mockCallWithSession).not.toHaveBeenCalledWith('VBD.eject', expect.anything())
  })

  // getVmVIFs error handling
  it('getVmVIFs handles network.get_record error gracefully', async () => {
    mockCallWithSession
      .mockResolvedValueOnce(['OpaqueRef:vif1']) // VM.get_VIFs
      .mockResolvedValueOnce({ // VIF.get_record
        device: '0',
        MAC: 'AA:BB:CC:DD:EE:FF',
        network: 'OpaqueRef:net1',
        MTU: '1500',
      })
      .mockRejectedValueOnce(new Error('network not found')) // network.get_record fails

    const { getVmVIFs } = await import('../../src/main/xapi/services/vm.service')
    const vifs = await getVmVIFs('conn-123', 'OpaqueRef:vm1')
    expect(vifs).toHaveLength(1)
    expect(vifs[0].networkName).toBe('')
    expect(vifs[0].MAC).toBe('AA:BB:CC:DD:EE:FF')
  })

  // getVmSnapshots with VBD sizes
  it('getVmSnapshots calculates size from VBDs', async () => {
    mockCallWithSession
      .mockResolvedValueOnce(['OpaqueRef:snap1']) // VM.get_snapshots
      .mockResolvedValueOnce({ // snap VM.get_record
        uuid: 'snap-uuid-1',
        name_label: 'with-disk',
        name_description: '',
        snapshot_time: '2026-03-23T06:00:00Z',
        VBDs: ['OpaqueRef:vbd1'],
      })
      .mockResolvedValueOnce({ VDI: 'OpaqueRef:vdi1' }) // VBD.get_record
      .mockResolvedValueOnce({ virtual_size: '10737418240' }) // VDI.get_record

    const { getVmSnapshots } = await import('../../src/main/xapi/services/vm.service')
    const snaps = await getVmSnapshots('conn-123', 'OpaqueRef:vm1')
    expect(snaps).toHaveLength(1)
    expect(snaps[0].size).toBe(10737418240)
  })

  // deleteVmSnapshot with NULL VDI
  it('deleteVmSnapshot handles NULL VDI gracefully', async () => {
    mockCallWithSession
      .mockResolvedValueOnce({ is_a_snapshot: true, allowed_operations: ['destroy'], VBDs: ['OpaqueRef:vbd1'] }) // VM.get_record
      .mockResolvedValueOnce({ VDI: 'OpaqueRef:NULL' }) // VBD.get_record → NULL VDI
      .mockResolvedValueOnce(null) // VM.destroy

    const { deleteVmSnapshot } = await import('../../src/main/xapi/services/vm.service')
    await deleteVmSnapshot('conn-123', 'OpaqueRef:snap1')
    // VDI.destroy should NOT be called for NULL VDI
    const calls = mockCallWithSession.mock.calls.map((c) => c[0])
    expect(calls).not.toContain('VDI.destroy')
    expect(calls).toContain('VM.destroy')
  })

  it('deleteVmSnapshot retains shared VDIs and reports them', async () => {
    mockCallWithSession
      .mockResolvedValueOnce({ is_a_snapshot: true, allowed_operations: ['destroy'], VBDs: ['OpaqueRef:vbd1'] })
      .mockResolvedValueOnce({ VDI: 'OpaqueRef:vdi1', type: 'Disk', mode: 'RW' })
      .mockResolvedValueOnce({ VBDs: ['OpaqueRef:vbd1', 'OpaqueRef:other-vbd'], sharable: true })
      .mockResolvedValueOnce(null)

    const { deleteVmSnapshot } = await import('../../src/main/xapi/services/vm.service')
    await expect(deleteVmSnapshot('conn-123', 'OpaqueRef:snap1'))
      .resolves.toEqual({ vmDeleted: true, failedVdiRefs: ['OpaqueRef:vdi1'] })
    expect(mockCallWithSession).not.toHaveBeenCalledWith('VDI.destroy', ['OpaqueRef:vdi1'])
  })

  it('deleteVmSnapshot rejects an ordinary VM before deleting anything', async () => {
    mockCallWithSession.mockResolvedValueOnce({ is_a_snapshot: false, allowed_operations: ['destroy'] })
    const { deleteVmSnapshot } = await import('../../src/main/xapi/services/vm.service')
    await expect(deleteVmSnapshot('conn-123', 'OpaqueRef:vm1')).rejects.toThrow('不是 VM 快照')
    expect(mockCallWithSession).not.toHaveBeenCalledWith('VM.destroy', expect.anything())
  })

  it('getTemplates filters and sorts by name', async () => {
    // 新实现使用 VM.get_all_records 而非 VM.get_all + 逐个 VM.get_record
    mockCallWithSession.mockResolvedValueOnce({
      'OpaqueRef:tpl1': { uuid: 'u1', name_label: 'Ubuntu 22.04', is_a_template: true, is_control_domain: false, is_default_template: true, other_config: {} },
      'OpaqueRef:tpl2': { uuid: 'u2', name_label: 'CentOS 8', is_a_template: true, is_control_domain: false, is_default_template: true, other_config: {} },
      'OpaqueRef:snap1': { uuid: 'u4', name_label: 'My VM snapshot', is_a_template: true, is_a_snapshot: true, is_control_domain: false, is_default_template: false, other_config: {} },
      'OpaqueRef:vm1': { uuid: 'u3', name_label: 'My VM', is_a_template: false, is_control_domain: false, other_config: {} },
      'OpaqueRef:hidden': { uuid: 'u5', name_label: 'Hidden template', is_a_template: true, is_control_domain: false, is_default_template: false, other_config: { HideFromXenCenter: 'true' } },
      'OpaqueRef:internal': { uuid: 'u6', name_label: 'Internal template', is_a_template: true, is_control_domain: false, is_default_template: false, other_config: { xensource_internal: 'false' } },
      'OpaqueRef:visible-false': { uuid: 'u7', name_label: 'Visible custom template', is_a_template: true, is_control_domain: false, is_default_template: false, other_config: { HideFromXenCenter: 'false' } },
    })

    const { getTemplates } = await import('../../src/main/xapi/services/vm.service')
    const result = await getTemplates('conn-123')

    // 所有默认模板应在 system 分类
    expect(result.system).toHaveLength(2)
    expect(result.system[0].name_label).toBe('CentOS 8')  // 字母顺序
    expect(result.system[1].name_label).toBe('Ubuntu 22.04')
    expect(result.user).toHaveLength(1)
    expect(result.user[0].name_label).toBe('Visible custom template')
    expect([...result.user, ...result.system].map((template) => template.ref)).not.toContain('OpaqueRef:hidden')
    expect([...result.user, ...result.system].map((template) => template.ref)).not.toContain('OpaqueRef:internal')
  })
  it('reads back an empty CD drive after eject succeeds and insert fails', async () => {
    mockCallWithSession.mockResolvedValueOnce({ SR: 'OpaqueRef:iso-sr' })
      .mockResolvedValueOnce({ type: 'iso', content_type: 'iso' })
      .mockResolvedValueOnce(['OpaqueRef:cd'])
      .mockResolvedValueOnce({ type: 'CD', empty: false, VDI: 'OpaqueRef:old' })
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(Object.assign(new Error('insert failed'), { code: 'VDI_NOT_AVAILABLE' }))
      .mockResolvedValueOnce({ type: 'CD', empty: true, VDI: 'OpaqueRef:NULL' })
    const { mountVmIso } = await import('../../src/main/xapi/services/vm.service')
    await expect(mountVmIso('conn-123', 'OpaqueRef:vm', 'OpaqueRef:new')).rejects.toMatchObject({ code: 'ISO_REPLACE_INCOMPLETE', details: { actualVdiRef: null } })
    expect(mockCallWithSession.mock.calls.filter(([method]) => method === 'VBD.insert')).toHaveLength(1)
  })

  it('reports the detached VBD state when unplug succeeds and destroy fails', async () => {
    mockCallWithSession.mockResolvedValueOnce({ currently_attached: true }).mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('destroy failed')).mockResolvedValueOnce({ currently_attached: false })
    const { detachVbd } = await import('../../src/main/xapi/services/vm.service')
    await expect(detachVbd('conn-123', 'OpaqueRef:vbd')).rejects.toMatchObject({ code: 'VBD_DETACH_INCOMPLETE', details: { currentlyAttached: false } })
    expect(mockCallWithSession.mock.calls.filter(([method]) => method === 'VBD.unplug')).toHaveLength(1)
  })

  it('releases a suspended checkpoint and removes its owned suspend VDI after the VM record', async () => {
    mockCallWithSession.mockResolvedValueOnce({ is_a_snapshot: true, power_state: 'Suspended', allowed_operations: ['hard_shutdown'], suspend_VDI: 'OpaqueRef:memory', VBDs: [] })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ is_a_snapshot: true, power_state: 'Halted', allowed_operations: ['destroy'], suspend_VDI: 'OpaqueRef:NULL', VBDs: [] })
      .mockResolvedValueOnce(null).mockResolvedValueOnce(null)
    const { deleteVmSnapshot } = await import('../../src/main/xapi/services/vm.service')
    await expect(deleteVmSnapshot('conn-123', 'OpaqueRef:snap')).resolves.toEqual({ vmDeleted: true, failedVdiRefs: [] })
    expect(mockCallWithSession.mock.calls.slice(-2)).toEqual([['VM.destroy', ['OpaqueRef:snap']], ['VDI.destroy', ['OpaqueRef:memory']]])
  })

})

describe('ISO eject response loss', () => {
  it('confirms an empty drive after a lost eject response without repeating the write', async () => {
    mockGetClient.mockReturnValue(mockClient)
    let empty = false
    mockCallWithSession.mockImplementation(async (method: string) => {
      if (method === 'VM.get_VBDs') return ['OpaqueRef:cd']
      if (method === 'VBD.get_record') return { type: 'CD', VDI: empty ? 'OpaqueRef:NULL' : 'OpaqueRef:iso', empty }
      if (method === 'VBD.eject') { empty = true; throw Object.assign(new Error('response lost'), { code: 'ECONNRESET' }) }
      throw new Error(`Unexpected method ${method}`)
    })
    const { ejectVmIso } = await import('../../src/main/xapi/services/vm.service')
    await ejectVmIso('conn-1', 'OpaqueRef:vm')
    expect(mockCallWithSession.mock.calls.filter(([method]) => method === 'VBD.eject')).toHaveLength(1)
  })
})
