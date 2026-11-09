import { copyOperation } from '../helpers/vm-copy-fixtures'
/**
 * Unit tests for template management functions in vm.service — verifies
 * cloneTemplate, deleteTemplate, and updateTemplateSettings behavior.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCallWithSession = vi.fn()
const mockClient = { callWithSession: mockCallWithSession }
const mockGetClient = vi.fn(() => mockClient)

const mockStartCopy = vi.fn()
vi.mock('../../src/main/xapi/services/vm-copy.service', () => ({ startVmCopy: mockStartCopy }))

vi.mock('../../src/main/xapi/connection-manager', () => ({
  connectionManager: {
    getClient: mockGetClient,
    getConnectionInfo: vi.fn(() => ({ poolName: 'Test Pool' })),
  },
}))

describe('template-service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCallWithSession.mockReset()
  })

  // ============================================
  // cloneTemplate tests
  // ============================================
  describe('cloneTemplate', () => {
    it('validates the template and delegates quick clone to the durable service', async () => {
      mockCallWithSession.mockResolvedValueOnce({ is_a_template: true })
      mockStartCopy.mockResolvedValueOnce({ ...copyOperation, isTemplate: true })
      const { cloneTemplate } = await import('../../src/main/xapi/services/vm.service')
      expect(await cloneTemplate('conn-123', { templateRef: 'OpaqueRef:tpl1', newName: 'Copy' })).toMatchObject({ id: copyOperation.id, isTemplate: true })
      expect(mockStartCopy).toHaveBeenCalledWith('conn-123', { vmRef: 'OpaqueRef:tpl1', newName: 'Copy', mode: 'clone' })
    })
    it('delegates cross-SR copies without adding instant-create metadata', async () => {
      mockCallWithSession.mockResolvedValueOnce({ is_a_template: true })
      mockStartCopy.mockResolvedValueOnce(copyOperation)
      const { cloneTemplate } = await import('../../src/main/xapi/services/vm.service')
      await cloneTemplate('conn-123', { templateRef: 'OpaqueRef:tpl1', newName: 'Copy', targetSrRef: 'OpaqueRef:sr2' })
      expect(mockStartCopy).toHaveBeenCalledWith('conn-123', { vmRef: 'OpaqueRef:tpl1', newName: 'Copy', targetSrRef: 'OpaqueRef:sr2', mode: 'copy' })
      expect(mockCallWithSession).toHaveBeenCalledOnce()
    })
    it('rejects ordinary VMs from the template compatibility endpoint', async () => {
      mockCallWithSession.mockResolvedValueOnce({ is_a_template: false })
      const { cloneTemplate } = await import('../../src/main/xapi/services/vm.service')
      await expect(cloneTemplate('conn-123', { templateRef: 'OpaqueRef:vm', newName: 'Copy' })).rejects.toThrow('不是 VM 模板')
      expect(mockStartCopy).not.toHaveBeenCalled()
    })

    it('propagates errors from XAPI', async () => {
      mockCallWithSession.mockRejectedValueOnce(new Error('VM_NOT_FOUND'))

      const { cloneTemplate } = await import('../../src/main/xapi/services/vm.service')
      await expect(cloneTemplate('conn-123', {
        templateRef: 'OpaqueRef:invalid',
        newName: 'test',
      })).rejects.toThrow('VM_NOT_FOUND')
    })
  })

  // ============================================
  // deleteTemplate tests
  // ============================================
  describe('deleteTemplate', () => {
    it('throws error for system template (is_default_template=true)', async () => {
      mockCallWithSession.mockResolvedValueOnce({
        is_a_template: true,
        is_default_template: true,
        other_config: {},
        VBDs: [],
      })

      const { deleteTemplate } = await import('../../src/main/xapi/services/vm.service')
      await expect(deleteTemplate('conn-123', {
        templateRef: 'OpaqueRef:sys-tpl',
        deleteDisks: false,
      })).rejects.toThrow('无法删除系统模板')
    })

    it('throws error for system template (other_config default_template=true)', async () => {
      mockCallWithSession.mockResolvedValueOnce({
        is_a_template: true,
        is_default_template: false,
        other_config: { default_template: 'true' },
        VBDs: [],
      })

      const { deleteTemplate } = await import('../../src/main/xapi/services/vm.service')
      await expect(deleteTemplate('conn-123', {
        templateRef: 'OpaqueRef:sys-tpl',
        deleteDisks: false,
      })).rejects.toThrow('无法删除系统模板')
    })

    it('deletes template and associated VDIs when deleteDisks=true', async () => {
      mockCallWithSession
        .mockResolvedValueOnce({ // VM.get_record
          is_a_template: true,
          is_default_template: false,
          allowed_operations: ['destroy'],
          other_config: {},
          VBDs: ['OpaqueRef:vbd1', 'OpaqueRef:vbd2'],
        })
        .mockResolvedValueOnce({ VDI: 'OpaqueRef:vdi1', type: 'Disk', mode: 'RW', other_config: { owner: 'true' } })
        .mockResolvedValueOnce({ VBDs: ['OpaqueRef:vbd1'], sharable: false })
        .mockResolvedValueOnce({ VDI: 'OpaqueRef:vdi2', type: 'Disk', mode: 'RW', other_config: { owner: 'true' } })
        .mockResolvedValueOnce({ VBDs: ['OpaqueRef:vbd2'], sharable: false })
        .mockResolvedValueOnce(null) // VM.destroy
        .mockResolvedValueOnce(null) // VDI.destroy vdi1
        .mockResolvedValueOnce(null) // VDI.destroy vdi2

      const { deleteTemplate } = await import('../../src/main/xapi/services/vm.service')
      await deleteTemplate('conn-123', {
        templateRef: 'OpaqueRef:user-tpl',
        deleteDisks: true,
      })

      expect(mockCallWithSession).toHaveBeenCalledWith('VDI.destroy', ['OpaqueRef:vdi1'])
      expect(mockCallWithSession).toHaveBeenCalledWith('VDI.destroy', ['OpaqueRef:vdi2'])
      expect(mockCallWithSession).toHaveBeenCalledWith('VM.destroy', ['OpaqueRef:user-tpl'])
      const methods = mockCallWithSession.mock.calls.map((call) => call[0])
      expect(methods.indexOf('VM.destroy')).toBeLessThan(methods.indexOf('VDI.destroy'))
    })

    it('only destroys template when deleteDisks=false', async () => {
      mockCallWithSession
        .mockResolvedValueOnce({ // VM.get_record
          is_a_template: true,
          is_default_template: false,
          allowed_operations: ['destroy'],
          other_config: {},
          VBDs: ['OpaqueRef:vbd1'],
        })
        .mockResolvedValueOnce(null) // VM.destroy

      const { deleteTemplate } = await import('../../src/main/xapi/services/vm.service')
      await deleteTemplate('conn-123', {
        templateRef: 'OpaqueRef:user-tpl',
        deleteDisks: false,
      })

      // Should NOT call VBD.get_record or VDI.destroy
      const calls = mockCallWithSession.mock.calls.map((c) => c[0])
      expect(calls).not.toContain('VBD.get_record')
      expect(calls).not.toContain('VDI.destroy')
      expect(calls).toContain('VM.destroy')
    })

    it('skips VDI.destroy for NULL VDI references', async () => {
      mockCallWithSession
        .mockResolvedValueOnce({ // VM.get_record
          is_a_template: true,
          is_default_template: false,
          allowed_operations: ['destroy'],
          other_config: {},
          VBDs: ['OpaqueRef:vbd1', 'OpaqueRef:vbd2'],
        })
        .mockResolvedValueOnce({ VDI: 'OpaqueRef:NULL' }) // VBD.get_record vbd1 - NULL VDI
        .mockResolvedValueOnce({ VDI: 'OpaqueRef:vdi2', type: 'Disk', mode: 'RW', other_config: { owner: 'true' } }) // VBD.get_record vbd2
        .mockResolvedValueOnce({ VBDs: ['OpaqueRef:vbd2'], sharable: false })
        .mockResolvedValueOnce(null) // VM.destroy
        .mockResolvedValueOnce(null) // VDI.destroy vdi2

      const { deleteTemplate } = await import('../../src/main/xapi/services/vm.service')
      await deleteTemplate('conn-123', {
        templateRef: 'OpaqueRef:user-tpl',
        deleteDisks: true,
      })

      // VDI.destroy should be called only once (for vdi2, not for NULL)
      const vdiDestroyCalls = mockCallWithSession.mock.calls.filter((c) => c[0] === 'VDI.destroy')
      expect(vdiDestroyCalls).toHaveLength(1)
      expect(vdiDestroyCalls[0][1]).toEqual(['OpaqueRef:vdi2'])
      expect(mockCallWithSession).toHaveBeenCalledWith('VM.destroy', ['OpaqueRef:user-tpl'])
    })

    it('recognizes the empty owner marker produced by the XAPI provisioner', async () => {
      mockCallWithSession
        .mockResolvedValueOnce({ is_a_template: true, allowed_operations: ['destroy'], VBDs: ['OpaqueRef:vbd'] })
        .mockResolvedValueOnce({ type: 'Disk', mode: 'RW', VDI: 'OpaqueRef:vdi', other_config: { owner: '' } })
        .mockResolvedValueOnce({ VBDs: ['OpaqueRef:vbd'], sharable: false })
        .mockResolvedValueOnce(null).mockResolvedValueOnce(null)
      const { deleteTemplate } = await import('../../src/main/xapi/services/vm.service')
      await expect(deleteTemplate('conn-123', { templateRef: 'OpaqueRef:tpl', deleteDisks: true }))
        .resolves.toEqual({ vmDeleted: true, failedVdiRefs: [] })
      expect(mockCallWithSession).toHaveBeenCalledWith('VDI.destroy', ['OpaqueRef:vdi'])
    })

    it.each([
      { name: 'missing owner', vbd: { other_config: {} } },
      { name: 'owner=false', vbd: { other_config: { owner: 'false' } } },
      { name: 'read-only attachment', vbd: { mode: 'RO' } },
      { name: 'shared VDI', vdi: { sharable: true } },
      { name: 'another attachment', vdi: { VBDs: ['OpaqueRef:vbd', 'OpaqueRef:other-vbd'] } },
      { name: 'unknown attachments', vdi: { VBDs: undefined } },
      { name: 'read-only VDI', vdi: { read_only: true } },
      { name: 'snapshot VDI', vdi: { is_a_snapshot: true } },
      { name: 'busy VDI', vdi: { current_operations: { task: 'copy' } } },
    ])('retains and reports a $name instead of deleting it', async ({ vbd, vdi }) => {
      mockCallWithSession
        .mockResolvedValueOnce({ is_a_template: true, allowed_operations: ['destroy'], VBDs: ['OpaqueRef:vbd'] })
        .mockResolvedValueOnce({ type: 'Disk', mode: 'RW', VDI: 'OpaqueRef:vdi', other_config: { owner: 'true' }, ...vbd })
        .mockResolvedValueOnce({ VBDs: ['OpaqueRef:vbd'], sharable: false, ...vdi })
        .mockResolvedValueOnce(null)
      const { deleteTemplate } = await import('../../src/main/xapi/services/vm.service')
      await expect(deleteTemplate('conn-123', { templateRef: 'OpaqueRef:tpl', deleteDisks: true }))
        .resolves.toEqual({ vmDeleted: true, failedVdiRefs: ['OpaqueRef:vdi'] })
      expect(mockCallWithSession).not.toHaveBeenCalledWith('VDI.destroy', expect.anything())
    })

    it('preserves mounted ISO media', async () => {
      mockCallWithSession
        .mockResolvedValueOnce({ is_a_template: true, allowed_operations: ['destroy'], VBDs: ['OpaqueRef:cd'] })
        .mockResolvedValueOnce({ type: 'CD', VDI: 'OpaqueRef:iso', other_config: { owner: 'true' } })
        .mockResolvedValueOnce(null)
      const { deleteTemplate } = await import('../../src/main/xapi/services/vm.service')
      await expect(deleteTemplate('conn-123', { templateRef: 'OpaqueRef:tpl', deleteDisks: true }))
        .resolves.toEqual({ vmDeleted: true, failedVdiRefs: [] })
      expect(mockCallWithSession).not.toHaveBeenCalledWith('VDI.destroy', expect.anything())
    })

    it('reports disk cleanup failure after confirmed template deletion', async () => {
      mockCallWithSession
        .mockResolvedValueOnce({ is_a_template: true, allowed_operations: ['destroy'], VBDs: ['OpaqueRef:vbd'] })
        .mockResolvedValueOnce({ type: 'Disk', mode: 'RW', VDI: 'OpaqueRef:vdi', other_config: { owner: 'true' } })
        .mockResolvedValueOnce({ VBDs: ['OpaqueRef:vbd'], sharable: false })
        .mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('SR unavailable'))
      const { deleteTemplate } = await import('../../src/main/xapi/services/vm.service')
      await expect(deleteTemplate('conn-123', { templateRef: 'OpaqueRef:tpl', deleteDisks: true }))
        .resolves.toEqual({ vmDeleted: true, failedVdiRefs: ['OpaqueRef:vdi'] })
    })

    it('does not delete the template if reading disk ownership fails', async () => {
      mockCallWithSession
        .mockResolvedValueOnce({ is_a_template: true, allowed_operations: ['destroy'], VBDs: ['OpaqueRef:vbd'] })
        .mockRejectedValueOnce(new Error('read denied'))
      const { deleteTemplate } = await import('../../src/main/xapi/services/vm.service')
      await expect(deleteTemplate('conn-123', { templateRef: 'OpaqueRef:tpl', deleteDisks: true })).rejects.toThrow('read denied')
      expect(mockCallWithSession).not.toHaveBeenCalledWith('VM.destroy', expect.anything())
      expect(mockCallWithSession).not.toHaveBeenCalledWith('VDI.destroy', expect.anything())
    })

    it('does not delete disks if deleting the template fails', async () => {
      mockCallWithSession
        .mockResolvedValueOnce({ is_a_template: true, allowed_operations: ['destroy'], VBDs: ['OpaqueRef:vbd'] })
        .mockResolvedValueOnce({ type: 'Disk', mode: 'RW', VDI: 'OpaqueRef:vdi', other_config: { owner: 'true' } })
        .mockResolvedValueOnce({ VBDs: ['OpaqueRef:vbd'], sharable: false })
        .mockRejectedValueOnce(new Error('destroy denied'))
      const { deleteTemplate } = await import('../../src/main/xapi/services/vm.service')
      await expect(deleteTemplate('conn-123', { templateRef: 'OpaqueRef:tpl', deleteDisks: true })).rejects.toThrow('destroy denied')
      expect(mockCallWithSession).not.toHaveBeenCalledWith('VDI.destroy', expect.anything())
    })
  })

  // ============================================
  // updateTemplateSettings tests
  // ============================================
  describe('updateTemplateSettings', () => {
    let record: Record<string, any>
    beforeEach(() => {
      record = { uuid: 'template-uuid', is_a_template: true, power_state: 'Halted',
        name_label: 'Original', name_description: '', VCPUs_max: '2', VCPUs_at_startup: '2',
        memory_static_min: '536870912', memory_dynamic_min: '536870912',
        memory_dynamic_max: '2147483648', memory_static_max: '4294967296' }
      mockCallWithSession.mockImplementation(async (method: string, args: any[]) => {
        if (method === 'VM.get_record') return { ...record }
        const fields: Record<string, string> = { 'VM.set_name_label': 'name_label', 'VM.set_name_description': 'name_description',
          'VM.set_VCPUs_max': 'VCPUs_max', 'VM.set_VCPUs_at_startup': 'VCPUs_at_startup' }
        if (fields[method]) record[fields[method]] = args[1]
        else if (method === 'VM.set_memory_limits') {
          ;[record.memory_static_min, record.memory_static_max, record.memory_dynamic_min, record.memory_dynamic_max] = args.slice(1).map(Number)
        } else throw new Error(`Unexpected method ${method}`)
        return null
      })
    })

    it('updates name label when nameLabel is provided', async () => {
      const { updateTemplateSettings } = await import('../../src/main/xapi/services/vm.service')
      await updateTemplateSettings('conn-123', {
        templateRef: 'OpaqueRef:tpl1',
        nameLabel: 'new-name',
      })

      expect(mockCallWithSession).toHaveBeenCalledWith('VM.set_name_label', ['OpaqueRef:tpl1', 'new-name'])
    })

    it('updates description when nameDescription is provided', async () => {
      const { updateTemplateSettings } = await import('../../src/main/xapi/services/vm.service')
      await updateTemplateSettings('conn-123', {
        templateRef: 'OpaqueRef:tpl1',
        nameDescription: 'new description',
      })

      expect(mockCallWithSession).toHaveBeenCalledWith('VM.set_name_description', ['OpaqueRef:tpl1', 'new description'])
    })

    it('updates VCPUs when vcpusMax and vcpusAtStartup are provided', async () => {
      const { updateTemplateSettings } = await import('../../src/main/xapi/services/vm.service')
      await updateTemplateSettings('conn-123', {
        templateRef: 'OpaqueRef:tpl1',
        vcpusMax: 4,
        vcpusAtStartup: 4,
      })

      expect(mockCallWithSession).toHaveBeenCalledWith('VM.set_VCPUs_max', ['OpaqueRef:tpl1', 4])
      expect(mockCallWithSession).toHaveBeenCalledWith('VM.set_VCPUs_at_startup', ['OpaqueRef:tpl1', 4])
    })

    it('updates memory limits and uses current values for unspecified fields', async () => {
      const { updateTemplateSettings } = await import('../../src/main/xapi/services/vm.service')
      await updateTemplateSettings('conn-123', {
        templateRef: 'OpaqueRef:tpl1',
        memoryDynamicMax: 4294967296, // Only update dynamic_max
      })

      expect(mockCallWithSession).toHaveBeenCalledWith('VM.set_memory_limits', [
        'OpaqueRef:tpl1',
        '536870912',      // current static_min
        '4294967296',     // current static_max
        '536870912',      // current dynamic_min
        '4294967296',     // new dynamic_max
      ])
    })

    it('uses provided memory values when all are specified', async () => {
      const { updateTemplateSettings } = await import('../../src/main/xapi/services/vm.service')
      await updateTemplateSettings('conn-123', {
        templateRef: 'OpaqueRef:tpl1',
        memoryStaticMin: 268435456,
        memoryDynamicMin: 268435456,
        memoryDynamicMax: 4294967296,
        memoryStaticMax: 4294967296,
      })

      expect(mockCallWithSession).toHaveBeenCalledWith('VM.set_memory_limits', [
        'OpaqueRef:tpl1',
        '268435456',
        '4294967296',
        '268435456',
        '4294967296',
      ])
    })

    it('does not call any set method for empty payload (only templateRef)', async () => {
      const { updateTemplateSettings } = await import('../../src/main/xapi/services/vm.service')
      await updateTemplateSettings('conn-123', {
        templateRef: 'OpaqueRef:tpl1',
      })

      // No XAPI calls should be made
      expect(mockCallWithSession).not.toHaveBeenCalled()
    })

    it('partial update: only calls set methods for provided fields', async () => {
      const { updateTemplateSettings } = await import('../../src/main/xapi/services/vm.service')
      await updateTemplateSettings('conn-123', {
        templateRef: 'OpaqueRef:tpl1',
        nameLabel: 'partial-update',
        vcpusMax: 8,
      })

      const calls = mockCallWithSession.mock.calls.map((c) => c[0])
      expect(calls).toContain('VM.set_name_label')
      expect(calls).toContain('VM.set_VCPUs_max')
      expect(calls).not.toContain('VM.set_name_description')
      expect(calls).not.toContain('VM.set_VCPUs_at_startup')
      expect(calls).not.toContain('VM.set_memory_limits')
    })

    it('propagates errors from XAPI', async () => {
      mockCallWithSession.mockRejectedValue(new Error('VM_NOT_FOUND'))

      const { updateTemplateSettings } = await import('../../src/main/xapi/services/vm.service')
      await expect(updateTemplateSettings('conn-123', {
        templateRef: 'OpaqueRef:invalid',
        nameLabel: 'test',
      })).rejects.toThrow('VM_NOT_FOUND')
    })
  })
})
