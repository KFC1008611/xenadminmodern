/**
 * Unit tests for vdi.service — verifies XAPI VDI resize, create-for-VM, and allowed-operations.
 * Reference: https://xapi-project.github.io/xen-api/ (VDI class)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCallWithSession = vi.fn()
const mockClient = { callWithSession: mockCallWithSession }
const mockGetClient = vi.fn(() => mockClient)

vi.mock('../../src/main/xapi/connection-manager', () => ({
  connectionManager: {
    getClient: mockGetClient,
    getConnectionInfo: vi.fn(() => ({ poolName: 'Test Pool' })),
  },
}))

describe('vdi.service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCallWithSession.mockReset()
  })

  // ============================================================================
  // resizeVdi
  // ============================================================================

  describe('resizeVdi', () => {
    it('resizes VDI when new size is greater and SR has enough space', async () => {
      mockCallWithSession
        .mockResolvedValueOnce({ virtual_size: '10737418240', SR: 'OpaqueRef:sr1', VBDs: [], current_operations: {}, allowed_operations: ['resize'] }) // VDI.get_record
        .mockResolvedValueOnce({ physical_size: 107374182400, physical_utilisation: 53687091200 }) // SR.get_record
        .mockResolvedValueOnce('OpaqueRef:task1') // Async.VDI.resize

      const { resizeVdi } = await import('../../src/main/xapi/services/vdi.service')
      const taskRef = await resizeVdi('conn-123', { vdiRef: 'OpaqueRef:vdi1', newSize: 21474836480 })

      expect(taskRef).toBe('OpaqueRef:task1')
      expect(mockCallWithSession).toHaveBeenCalledWith('Async.VDI.resize', [
        'OpaqueRef:vdi1',
        '21474836480',
      ])
    })

    it('throws VDI_SIZE_INVALID when new size is not greater', async () => {
      mockCallWithSession.mockResolvedValueOnce({ virtual_size: '21474836480', SR: 'OpaqueRef:sr1', VBDs: [], current_operations: {}, allowed_operations: ['resize'] })

      const { resizeVdi } = await import('../../src/main/xapi/services/vdi.service')
      await expect(resizeVdi('conn-123', { vdiRef: 'OpaqueRef:vdi1', newSize: 10737418240 }))
        .rejects.toMatchObject({ code: 'VDI_SIZE_INVALID' })
    })

    it('throws VDI_SIZE_INVALID when new size equals current', async () => {
      mockCallWithSession.mockResolvedValueOnce({ virtual_size: '10737418240', SR: 'OpaqueRef:sr1', VBDs: [], current_operations: {}, allowed_operations: ['resize'] })

      const { resizeVdi } = await import('../../src/main/xapi/services/vdi.service')
      await expect(resizeVdi('conn-123', { vdiRef: 'OpaqueRef:vdi1', newSize: 10737418240 }))
        .rejects.toMatchObject({ code: 'VDI_SIZE_INVALID' })
    })

    it('throws SR_SPACE_INSUFFICIENT when SR does not have enough free space', async () => {
      mockCallWithSession
        .mockResolvedValueOnce({ virtual_size: '10737418240', SR: 'OpaqueRef:sr1', VBDs: [], current_operations: {}, allowed_operations: ['resize'] }) // VDI.get_record
        .mockResolvedValueOnce({ physical_size: 10737418240, physical_utilisation: 5368709120 }) // SR.get_record — only 5GB free

      const { resizeVdi } = await import('../../src/main/xapi/services/vdi.service')
      await expect(resizeVdi('conn-123', { vdiRef: 'OpaqueRef:vdi1', newSize: 32212254720 }))
        .rejects.toMatchObject({ code: 'SR_SPACE_INSUFFICIENT' })
    })

    it('throws VM_ONLINE_RESIZE_NOT_SUPPORTED when running VM does not support it', async () => {
      mockCallWithSession
        .mockResolvedValueOnce({ virtual_size: '10737418240', SR: 'OpaqueRef:sr1', VBDs: ['OpaqueRef:vbd1'], current_operations: {}, allowed_operations: ['resize'] }) // VDI.get_record
        .mockResolvedValueOnce({ physical_size: 107374182400, physical_utilisation: 53687091200 }) // SR.get_record
        .mockResolvedValueOnce({ VM: 'OpaqueRef:vm1', currently_attached: true }) // VBD.get_record
        .mockResolvedValueOnce({ power_state: 'Running', name_label: 'test-vm' }) // VM.get_record

      const { resizeVdi } = await import('../../src/main/xapi/services/vdi.service')
      await expect(resizeVdi('conn-123', { vdiRef: 'OpaqueRef:vdi1', newSize: 21474836480 }))
        .rejects.toMatchObject({ code: 'VM_ONLINE_RESIZE_NOT_SUPPORTED' })
    })

    it('allows resize when VM is halted', async () => {
      mockCallWithSession
        .mockResolvedValueOnce({ virtual_size: '10737418240', SR: 'OpaqueRef:sr1', VBDs: ['OpaqueRef:vbd1'], current_operations: {}, allowed_operations: ['resize'] }) // VDI.get_record
        .mockResolvedValueOnce({ physical_size: 107374182400, physical_utilisation: 53687091200 }) // SR.get_record
        .mockResolvedValueOnce({ VM: 'OpaqueRef:vm1', currently_attached: true }) // VBD.get_record
        .mockResolvedValueOnce({ power_state: 'Halted', name_label: 'halted-vm' }) // VM.get_record
        .mockResolvedValueOnce('OpaqueRef:task-resize') // Async.VDI.resize

      const { resizeVdi } = await import('../../src/main/xapi/services/vdi.service')
      const taskRef = await resizeVdi('conn-123', { vdiRef: 'OpaqueRef:vdi1', newSize: 21474836480 })

      expect(taskRef).toBe('OpaqueRef:task-resize')
    })

    it('throws when connectionId is invalid', async () => {
      mockGetClient.mockReturnValueOnce(undefined)

      const { resizeVdi } = await import('../../src/main/xapi/services/vdi.service')
      await expect(resizeVdi('invalid-id', { vdiRef: 'OpaqueRef:vdi1', newSize: 21474836480 }))
        .rejects.toThrow('No connection found')
    })

    it('selects the published online operation only when a running VM is attached', async () => {
      mockCallWithSession
        .mockResolvedValueOnce({ virtual_size: '100', SR: 'OpaqueRef:sr1', VBDs: ['OpaqueRef:vbd1'], allowed_operations: ['resize_online'] })
        .mockResolvedValueOnce({ physical_size: 1000, physical_utilisation: 100 })
        .mockResolvedValueOnce({ VM: 'OpaqueRef:vm1', currently_attached: true })
        .mockResolvedValueOnce({ power_state: 'Running' })
        .mockResolvedValueOnce('OpaqueRef:task-online')
      const { resizeVdi } = await import('../../src/main/xapi/services/vdi.service')
      await expect(resizeVdi('conn-123', { vdiRef: 'OpaqueRef:vdi1', newSize: 200 }))
        .resolves.toBe('OpaqueRef:task-online')
      expect(mockCallWithSession).toHaveBeenCalledWith('Async.VDI.resize_online', ['OpaqueRef:vdi1', '200'])
      expect(mockCallWithSession).not.toHaveBeenCalledWith('VM.get_allowed_VDI_operations', expect.anything())
    })

    it('rejects a VDI with unknown resize capability before submitting a task', async () => {
      mockCallWithSession
        .mockResolvedValueOnce({ virtual_size: '100', SR: 'OpaqueRef:sr1', VBDs: [] })
        .mockResolvedValueOnce({ physical_size: 1000, physical_utilisation: 100 })
      const { resizeVdi } = await import('../../src/main/xapi/services/vdi.service')
      await expect(resizeVdi('conn-123', { vdiRef: 'OpaqueRef:vdi1', newSize: 200 }))
        .rejects.toMatchObject({ code: 'VDI_RESIZE_NOT_ALLOWED' })
      expect(mockCallWithSession.mock.calls.every(([method]) => !method.startsWith('Async.VDI.'))).toBe(true)
    })
  })

  // ============================================================================
  // createVdiForVm
  // ============================================================================

  describe('createVdiForVm', () => {
    it('creates VDI and VBD for a halted VM without plugging', async () => {
      mockCallWithSession
        .mockResolvedValueOnce({ physical_size: 107374182400, physical_utilisation: 53687091200, PBDs: ['OpaqueRef:pbd1'] }) // SR.get_record
        .mockResolvedValueOnce({ power_state: 'Halted', VBDs: ['OpaqueRef:vbd'] }) // VM.get_record
        .mockResolvedValueOnce({ currently_attached: true, host: 'OpaqueRef:host1' }) // PBD.get_record
        .mockResolvedValueOnce(['1', '3']) // VM.get_allowed_VBD_devices
        .mockResolvedValueOnce('OpaqueRef:new-vdi') // VDI.create
        .mockResolvedValueOnce('OpaqueRef:new-vbd') // VBD.create

      const { createVdiForVm } = await import('../../src/main/xapi/services/vdi.service')
      const result = await createVdiForVm('conn-123', {
        nameLabel: 'New Disk',
        nameDescription: 'Additional disk',
        srRef: 'OpaqueRef:sr1',
        size: 21474836480,
      }, 'OpaqueRef:vm1')

      expect(result.vdiRef).toBe('OpaqueRef:new-vdi')
      expect(result.vbdRef).toBe('OpaqueRef:new-vbd')
      expect(result.plugged).toBe(false)
      expect(mockCallWithSession).toHaveBeenCalledWith('VDI.create', [
        expect.objectContaining({
          name_label: 'New Disk',
          SR: 'OpaqueRef:sr1',
          virtual_size: '21474836480',
          type: 'user',
        }),
      ])
      expect(mockCallWithSession).toHaveBeenCalledWith('VBD.create', [
        expect.objectContaining({
          other_config: { owner: 'true' },
          userdevice: '1',
        }),
      ])
      expect(mockCallWithSession).not.toHaveBeenCalledWith('VBD.plug', expect.anything())
    })

    it('creates VDI and VBD for a running VM and tries to hot-plug', async () => {
      mockCallWithSession
        .mockResolvedValueOnce({ physical_size: 107374182400, physical_utilisation: 53687091200, PBDs: ['OpaqueRef:pbd1'] }) // SR.get_record
        .mockResolvedValueOnce({ power_state: 'Running', resident_on: 'OpaqueRef:host1', VBDs: [] }) // VM.get_record
        .mockResolvedValueOnce({ currently_attached: true, host: 'OpaqueRef:host1' }) // PBD.get_record
        .mockResolvedValueOnce(['0']) // VM.get_allowed_VBD_devices
        .mockResolvedValueOnce('OpaqueRef:new-vdi') // VDI.create
        .mockResolvedValueOnce('OpaqueRef:new-vbd') // VBD.create
        .mockResolvedValueOnce(null) // VBD.plug

      const { createVdiForVm } = await import('../../src/main/xapi/services/vdi.service')
      const result = await createVdiForVm('conn-123', {
        nameLabel: 'New Disk',
        nameDescription: '',
        srRef: 'OpaqueRef:sr1',
        size: 10737418240,
      }, 'OpaqueRef:vm1')

      expect(result.vdiRef).toBe('OpaqueRef:new-vdi')
      expect(result.vbdRef).toBe('OpaqueRef:new-vbd')
      expect(result.plugged).toBe(true)
      expect(mockCallWithSession).toHaveBeenCalledWith('VBD.create', [
        expect.objectContaining({
          other_config: { owner: 'true' },
        }),
      ])
      expect(mockCallWithSession).toHaveBeenCalledWith('VBD.plug', ['OpaqueRef:new-vbd'])
    })

    it('reports a created disk that could not be hot-plugged', async () => {
      mockCallWithSession
        .mockResolvedValueOnce({ physical_size: 1000, physical_utilisation: 0, PBDs: ['OpaqueRef:pbd1'] })
        .mockResolvedValueOnce({ power_state: 'Running', resident_on: 'OpaqueRef:host1', VBDs: [] })
        .mockResolvedValueOnce({ currently_attached: true, host: 'OpaqueRef:host1' }) // PBD.get_record
        .mockResolvedValueOnce(['0'])
        .mockResolvedValueOnce('OpaqueRef:new-vdi')
        .mockResolvedValueOnce('OpaqueRef:new-vbd')
        .mockRejectedValueOnce(new Error('DEVICE_NOT_DETACHABLE'))
        .mockResolvedValueOnce({ currently_attached: false })

      const { createVdiForVm } = await import('../../src/main/xapi/services/vdi.service')
      const result = await createVdiForVm('conn-123', {
        nameLabel: 'New Disk', nameDescription: '', srRef: 'OpaqueRef:sr1', size: 100,
      }, 'OpaqueRef:vm1')

      expect(result).toEqual({
        vdiRef: 'OpaqueRef:new-vdi', vbdRef: 'OpaqueRef:new-vbd',
        plugged: false, warning: '磁盘已创建但尚未激活：DEVICE_NOT_DETACHABLE',
      })
    })

    it('throws SR_SPACE_INSUFFICIENT when SR has not enough space', async () => {
      mockCallWithSession.mockResolvedValueOnce({ physical_size: 10737418240, physical_utilisation: 5368709120, PBDs: ['OpaqueRef:pbd1'] }) // SR.get_record

      const { createVdiForVm } = await import('../../src/main/xapi/services/vdi.service')
      await expect(createVdiForVm('conn-123', {
        nameLabel: 'Big Disk',
        nameDescription: '',
        srRef: 'OpaqueRef:sr1',
        size: 21474836480,
      }, 'OpaqueRef:vm1')).rejects.toMatchObject({ code: 'SR_SPACE_INSUFFICIENT' })
    })

    it('throws SR_NOT_AVAILABLE when SR has no PBDs', async () => {
      mockCallWithSession.mockResolvedValueOnce({ physical_size: 107374182400, physical_utilisation: 53687091200, PBDs: [], name_label: 'Disconnected SR' }) // SR.get_record

      const { createVdiForVm } = await import('../../src/main/xapi/services/vdi.service')
      await expect(createVdiForVm('conn-123', {
        nameLabel: 'New Disk',
        nameDescription: '',
        srRef: 'OpaqueRef:sr1',
        size: 10737418240,
      }, 'OpaqueRef:vm1')).rejects.toMatchObject({ code: 'SR_NOT_AVAILABLE' })
    })

    it('does not create a disk when XAPI has no free VBD device', async () => {
      mockCallWithSession
        .mockResolvedValueOnce({ physical_size: 1000, physical_utilisation: 0, PBDs: ['OpaqueRef:pbd1'] })
        .mockResolvedValueOnce({ power_state: 'Halted', VBDs: [] })
        .mockResolvedValueOnce({ currently_attached: true, host: 'OpaqueRef:host1' }) // PBD.get_record
        .mockResolvedValueOnce([])

      const { createVdiForVm } = await import('../../src/main/xapi/services/vdi.service')
      await expect(createVdiForVm('conn-123', {
        nameLabel: 'New Disk', nameDescription: '', srRef: 'OpaqueRef:sr1', size: 100,
      }, 'OpaqueRef:vm1')).rejects.toMatchObject({ code: 'VBD_NO_AVAILABLE_DEVICE' })
      expect(mockCallWithSession.mock.calls.map(([method]) => method)).not.toContain('VDI.create')
    })

    it('cleans up VDI if VBD creation fails', async () => {
      mockCallWithSession
        .mockResolvedValueOnce({ physical_size: 107374182400, physical_utilisation: 53687091200, PBDs: ['OpaqueRef:pbd1'] }) // SR.get_record
        .mockResolvedValueOnce({ power_state: 'Halted', VBDs: [] }) // VM.get_record
        .mockResolvedValueOnce({ currently_attached: true, host: 'OpaqueRef:host1' }) // PBD.get_record
        .mockResolvedValueOnce(['0']) // VM.get_allowed_VBD_devices
        .mockResolvedValueOnce('OpaqueRef:new-vdi') // VDI.create
        .mockRejectedValueOnce(new Error('VBD_CREATE_FAILED')) // VBD.create fails
        .mockResolvedValueOnce({ VBDs: [], current_operations: {} }) // confirm no attachment before cleanup
        .mockResolvedValueOnce(null) // VDI.destroy (cleanup)

      const { createVdiForVm } = await import('../../src/main/xapi/services/vdi.service')
      await expect(createVdiForVm('conn-123', {
        nameLabel: 'New Disk',
        nameDescription: '',
        srRef: 'OpaqueRef:sr1',
        size: 10737418240,
      }, 'OpaqueRef:vm1')).rejects.toThrow('VBD_CREATE_FAILED')

      // Verify cleanup: VDI.destroy should have been called
      expect(mockCallWithSession).toHaveBeenCalledWith('VDI.destroy', ['OpaqueRef:new-vdi'])
    })
  })

  // ============================================================================
  // attach existing VDI
  // ============================================================================

  describe('listAttachableVdis and attachExistingVdi', () => {
    it('filters attach candidates and forces read-only for safely reused non-sharable VDIs', async () => {
      mockCallWithSession
        .mockResolvedValueOnce({ VBDs: ['OpaqueRef:target-vbd'] }) // VM.get_record
        .mockResolvedValueOnce({
          'OpaqueRef:sr1': { name_label: 'Local SR', type: 'ext', PBDs: ['OpaqueRef:pbd1'] },
          'OpaqueRef:iso-sr': { name_label: 'ISO SR', type: 'iso', PBDs: ['OpaqueRef:pbd2'] },
        }) // SR.get_all_records
        .mockResolvedValueOnce({
          'OpaqueRef:ok': {
            uuid: 'ok',
            name_label: 'Attach me',
            virtual_size: 1024,
            physical_utilisation: 512,
            type: 'user',
            SR: 'OpaqueRef:sr1',
            read_only: false,
            VBDs: [],
          },
          'OpaqueRef:used': {
            uuid: 'used',
            name_label: 'Safe readonly',
            virtual_size: 2048,
            physical_utilisation: 1024,
            type: 'user',
            SR: 'OpaqueRef:sr1',
            read_only: false,
            sharable: false,
            VBDs: ['OpaqueRef:used-vbd'],
          },
          'OpaqueRef:active': {
            uuid: 'active',
            name_label: 'Active RW',
            virtual_size: 2048,
            physical_utilisation: 1024,
            type: 'user',
            SR: 'OpaqueRef:sr1',
            read_only: false,
            sharable: false,
            VBDs: ['OpaqueRef:active-vbd'],
          },
          'OpaqueRef:iso': {
            uuid: 'iso',
            name_label: 'ISO',
            type: 'user',
            SR: 'OpaqueRef:iso-sr',
            read_only: true,
            VBDs: [],
          },
          'OpaqueRef:snapshot': {
            uuid: 'snapshot',
            name_label: 'Snapshot',
            type: 'user',
            SR: 'OpaqueRef:sr1',
            is_a_snapshot: true,
            read_only: false,
            VBDs: [],
          },
        }) // VDI.get_all_records
        .mockResolvedValueOnce({ VDI: 'OpaqueRef:already-attached' }) // target VBD
        .mockResolvedValueOnce({ VM: 'OpaqueRef:vm2', currently_attached: false, mode: 'RW' }) // safe reused VBD
        .mockResolvedValueOnce({ VM: 'OpaqueRef:vm3', currently_attached: true, mode: 'RW' }) // active RW VBD

      const { listAttachableVdis } = await import('../../src/main/xapi/services/vdi.service')
      const records = await listAttachableVdis('conn-123', 'OpaqueRef:vm1')

      expect(records.map((record) => record.ref)).toEqual(['OpaqueRef:ok', 'OpaqueRef:used'])
      expect(records.find((record) => record.ref === 'OpaqueRef:used')?.forceReadOnly).toBe(true)
    })

    it('creates VBD and hot-plugs when attaching an existing VDI to a running VM', async () => {
      mockCallWithSession
        .mockResolvedValueOnce({ power_state: 'Running', VBDs: [] }) // VM.get_record inside listAttachableVdis
        .mockResolvedValueOnce({
          'OpaqueRef:sr1': { name_label: 'Local SR', type: 'ext', PBDs: ['OpaqueRef:pbd1'] },
        }) // SR.get_all_records
        .mockResolvedValueOnce({
          'OpaqueRef:vdi1': {
            uuid: 'vdi1',
            name_label: 'Existing Disk',
            virtual_size: 1024,
            physical_utilisation: 512,
            type: 'user',
            SR: 'OpaqueRef:sr1',
            read_only: false,
            VBDs: [],
          },
        }) // VDI.get_all_records
        .mockResolvedValueOnce({ power_state: 'Running', is_a_snapshot: false, VBDs: [] }) // VM.get_record
        .mockResolvedValueOnce(['1', '2']) // VM.get_allowed_VBD_devices
        .mockResolvedValueOnce('OpaqueRef:new-vbd') // VBD.create
        .mockResolvedValueOnce(null) // VBD.plug

      const { attachExistingVdi } = await import('../../src/main/xapi/services/vdi.service')
      const result = await attachExistingVdi('conn-123', {
        vmRef: 'OpaqueRef:vm1',
        vdiRef: 'OpaqueRef:vdi1',
      })

      expect(result).toEqual({ vbdRef: 'OpaqueRef:new-vbd', plugged: true })
      expect(mockCallWithSession).toHaveBeenCalledWith('VBD.create', [
        expect.objectContaining({
          VM: 'OpaqueRef:vm1',
          VDI: 'OpaqueRef:vdi1',
          userdevice: '1',
          mode: 'RW',
          other_config: { owner: 'true' },
        }),
      ])
      expect(mockCallWithSession).toHaveBeenCalledWith('VBD.plug', ['OpaqueRef:new-vbd'])
    })
  })

  // ============================================================================
  // move VDI
  // ============================================================================

  describe('moveVdi', () => {
    it('uses Async.VDI.pool_migrate for an attached VDI on a running VM', async () => {
      mockCallWithSession
        .mockResolvedValueOnce({
          SR: 'OpaqueRef:sr-old',
          VBDs: ['OpaqueRef:vbd1'],
          type: 'user',
          current_operations: {},
        }) // VDI.get_record
        .mockResolvedValueOnce({ name_label: 'Target SR', type: 'ext', PBDs: ['OpaqueRef:pbd1'] }) // SR.get_record
        .mockResolvedValueOnce('OpaqueRef:task') // Async.VDI.pool_migrate
        .mockResolvedValueOnce({ status: 'success', result: '<value><string>OpaqueRef:vdi-new</string></value>' }) // task.get_record
        .mockResolvedValueOnce({ SR: 'OpaqueRef:sr-new' }) // VDI.get_record
        .mockResolvedValueOnce({ VDI: 'OpaqueRef:vdi-new' }) // VBD.get_record

      const { moveVdi } = await import('../../src/main/xapi/services/vdi.service')
      const result = await moveVdi('conn-123', {
        vdiRef: 'OpaqueRef:vdi1',
        targetSrRef: 'OpaqueRef:sr-new',
      })

      expect(result.newVdiRef).toBe('OpaqueRef:vdi-new')
      expect(mockCallWithSession).toHaveBeenCalledWith('Async.VDI.pool_migrate', [
        'OpaqueRef:vdi1',
        'OpaqueRef:sr-new',
        {},
      ])
    })

    it('moves an offline VDI through XAPI without recreating VBDs', async () => {
      mockCallWithSession
        .mockResolvedValueOnce({
          SR: 'OpaqueRef:sr-old',
          VBDs: ['OpaqueRef:vbd1'],
          type: 'user',
          current_operations: {},
        }) // VDI.get_record
        .mockResolvedValueOnce({ name_label: 'Target SR', type: 'ext', PBDs: ['OpaqueRef:pbd1'] }) // SR.get_record
        .mockResolvedValueOnce('OpaqueRef:task') // Async.VDI.pool_migrate
        .mockResolvedValueOnce({ status: 'success', result: 'OpaqueRef:vdi-new' }) // task.get_record
        .mockResolvedValueOnce({ SR: 'OpaqueRef:sr-new' }) // VDI.get_record
        .mockResolvedValueOnce({ VDI: 'OpaqueRef:vdi-new' }) // VBD.get_record

      const { moveVdi } = await import('../../src/main/xapi/services/vdi.service')
      const result = await moveVdi('conn-123', {
        vdiRef: 'OpaqueRef:vdi1',
        targetSrRef: 'OpaqueRef:sr-new',
      })

      expect(result.newVdiRef).toBe('OpaqueRef:vdi-new')
      expect(mockCallWithSession).toHaveBeenCalledWith('Async.VDI.pool_migrate', [
        'OpaqueRef:vdi1',
        'OpaqueRef:sr-new',
        {},
      ])
      expect(mockCallWithSession.mock.calls.map((call) => call[0])).not.toContain('VBD.create')
      expect(mockCallWithSession.mock.calls.map((call) => call[0])).not.toContain('VDI.destroy')
    })

    it('does not report a successful move when the new VDI is not on the target SR', async () => {
      mockCallWithSession
        .mockResolvedValueOnce({ SR: 'OpaqueRef:sr-old', VBDs: [], type: 'user', current_operations: {} })
        .mockResolvedValueOnce({ type: 'ext', PBDs: ['OpaqueRef:pbd1'] })
        .mockResolvedValueOnce('OpaqueRef:task')
        .mockResolvedValueOnce({ status: 'success', result: '<value><string>OpaqueRef:vdi-new</string></value>' })
        .mockResolvedValueOnce({ SR: 'OpaqueRef:sr-old' })

      const { moveVdi } = await import('../../src/main/xapi/services/vdi.service')
      await expect(moveVdi('conn-123', {
        vdiRef: 'OpaqueRef:vdi1', targetSrRef: 'OpaqueRef:sr-new',
      })).rejects.toMatchObject({ code: 'TASK_OUTCOME_UNKNOWN', details: { taskRef: 'OpaqueRef:task' } })
    })
  })

  // ============================================================================
  // getAllowedVdiOperations
  // ============================================================================

  describe('getAllowedVdiOperations', () => {
    it('returns correct operations for halted VM', async () => {
      mockCallWithSession
        .mockResolvedValueOnce({ VBDs: [], allowed_operations: ['resize', 'destroy'] }) // VDI.get_record
        .mockResolvedValueOnce({ power_state: 'Halted' }) // VM.get_record

      const { getAllowedVdiOperations } = await import('../../src/main/xapi/services/vdi.service')
      const ops = await getAllowedVdiOperations('conn-123', 'OpaqueRef:vdi1', 'OpaqueRef:vm1')

      expect(ops.resize).toBe(true)
      expect(ops.onlineResize).toBe(false)
      expect(ops.destroy).toBe(true)
      expect(ops.create).toBe(true)
    })

    it('returns online resize for running VM', async () => {
      mockCallWithSession
        .mockResolvedValueOnce({ VBDs: [], allowed_operations: ['resize_online', 'destroy'] }) // VDI.get_record
        .mockResolvedValueOnce({ power_state: 'Running' }) // VM.get_record

      const { getAllowedVdiOperations } = await import('../../src/main/xapi/services/vdi.service')
      const ops = await getAllowedVdiOperations('conn-123', 'OpaqueRef:vdi1', 'OpaqueRef:vm1')

      expect(ops.onlineResize).toBe(true)
      expect(ops.resize).toBe(true)
      expect(ops.destroy).toBe(false) // Cannot destroy VDI while VM is running
    })

    it('handles VDI.get_record error gracefully', async () => {
      mockCallWithSession
        .mockRejectedValueOnce(new Error('VDI not found')) // VDI.get_record fails
        .mockResolvedValueOnce({ power_state: 'Halted' }) // VM.get_record

      const { getAllowedVdiOperations } = await import('../../src/main/xapi/services/vdi.service')
      const ops = await getAllowedVdiOperations('conn-123', 'OpaqueRef:vdi1', 'OpaqueRef:vm1')

      expect(ops.create).toBe(true)
      expect(ops.resize).toBe(false)
    })

    it('returns default operations when vmRef is NULL', async () => {
      mockCallWithSession.mockResolvedValueOnce({ VBDs: [], allowed_operations: ['resize', 'destroy'] }) // VDI.get_record

      const { getAllowedVdiOperations } = await import('../../src/main/xapi/services/vdi.service')
      const ops = await getAllowedVdiOperations('conn-123', 'OpaqueRef:vdi1', 'OpaqueRef:NULL')

      expect(ops.resize).toBe(true)
      expect(ops.destroy).toBe(true)
    })

    it('does not invent online resize support for a running VM', async () => {
      mockCallWithSession
        .mockResolvedValueOnce({ VBDs: ['OpaqueRef:vbd1'], allowed_operations: ['resize'] })
        .mockResolvedValueOnce({ power_state: 'Running' })

      const { getAllowedVdiOperations } = await import('../../src/main/xapi/services/vdi.service')
      const ops = await getAllowedVdiOperations('conn-123', 'OpaqueRef:vdi1', 'OpaqueRef:vm1')

      expect(ops.resize).toBe(false)
      expect(ops.onlineResize).toBe(false)
      expect(ops.destroy).toBe(false)
    })
  })
  it('recovers a lost VBD creation response after an empty first read without creating a second disk or attachment', async () => {
    mockCallWithSession.mockResolvedValueOnce({ physical_size: 1000, physical_utilisation: 0, PBDs: ['pbd'] })
      .mockResolvedValueOnce({ power_state: 'Halted' }).mockResolvedValueOnce({ currently_attached: true, host: 'host' })
      .mockResolvedValueOnce(['0']).mockResolvedValueOnce('OpaqueRef:new-vdi')
      .mockRejectedValueOnce(Object.assign(new Error('reply lost'), { code: 'ECONNRESET' }))
      .mockResolvedValueOnce({ VBDs: [] }).mockResolvedValueOnce({ VBDs: ['OpaqueRef:created-vbd'] })
      .mockResolvedValueOnce({ VM: 'vm', VDI: 'OpaqueRef:new-vdi', userdevice: '0' })
    const { createVdiForVm } = await import('../../src/main/xapi/services/vdi.service')
    await expect(createVdiForVm('conn-123', { nameLabel: 'Disk', nameDescription: '', srRef: 'sr', size: 100 }, 'vm'))
      .resolves.toEqual({ vdiRef: 'OpaqueRef:new-vdi', vbdRef: 'OpaqueRef:created-vbd', plugged: false })
    expect(mockCallWithSession.mock.calls.filter(([method]) => method === 'VDI.create')).toHaveLength(1)
    expect(mockCallWithSession.mock.calls.filter(([method]) => method === 'VBD.create')).toHaveLength(1)
    expect(mockCallWithSession).not.toHaveBeenCalledWith('VDI.destroy', expect.anything())
  })

  it('preserves a new disk if VBD creation loses its response even when an immediate read is empty', async () => {
    mockCallWithSession.mockResolvedValueOnce({ physical_size: 1000, physical_utilisation: 0, PBDs: ['pbd'] })
      .mockResolvedValueOnce({ power_state: 'Halted' }).mockResolvedValueOnce({ currently_attached: true, host: 'host' }).mockResolvedValueOnce(['0']).mockResolvedValueOnce('OpaqueRef:new-vdi')
      .mockRejectedValueOnce(Object.assign(new Error('reset'), { code: 'ECONNRESET' })).mockResolvedValueOnce({ VBDs: [] })
    const { createVdiForVm } = await import('../../src/main/xapi/services/vdi.service')
    await expect(createVdiForVm('conn-123', { nameLabel: 'Disk', nameDescription: '', srRef: 'sr', size: 100 }, 'vm'))
      .rejects.toMatchObject({ code: 'VDI_CREATED_ATTACH_INCOMPLETE', details: { vdiRef: 'OpaqueRef:new-vdi', outcome: 'unknown' } })
    expect(mockCallWithSession).not.toHaveBeenCalledWith('VDI.destroy', expect.anything())
  })

  it.each([
    { vm: { power_state: 'Halted' }, pbd: { currently_attached: false, host: 'host' } },
    { vm: { power_state: 'Running', resident_on: 'other-host' }, pbd: { currently_attached: true, host: 'host' } },
  ])('rejects creating a VDI without an applicable attached PBD (%j)', async ({ vm, pbd }) => {
    mockCallWithSession.mockResolvedValueOnce({ type: 'ext', physical_size: 1000, physical_utilisation: 0, PBDs: ['pbd'] }).mockResolvedValueOnce(vm).mockResolvedValueOnce(pbd)
    const { createVdiForVm } = await import('../../src/main/xapi/services/vdi.service')
    await expect(createVdiForVm('conn-123', { nameLabel: 'Disk', nameDescription: '', srRef: 'sr', size: 100 }, 'vm')).rejects.toMatchObject({ code: 'SR_NOT_AVAILABLE' })
    expect(mockCallWithSession).not.toHaveBeenCalledWith('VDI.create', expect.anything())
  })

  it('rejects ISO storage before creating a virtual disk', async () => {
    mockCallWithSession.mockResolvedValueOnce({ type: 'iso', physical_size: 1000, physical_utilisation: 0, PBDs: ['pbd'] })
    const { createVdiForVm } = await import('../../src/main/xapi/services/vdi.service')
    await expect(createVdiForVm('conn-123', { nameLabel: 'Disk', nameDescription: '', srRef: 'sr', size: 100 }, 'vm')).rejects.toMatchObject({ code: 'SR_NOT_AVAILABLE' })
    expect(mockCallWithSession).toHaveBeenCalledTimes(1)
  })

})
