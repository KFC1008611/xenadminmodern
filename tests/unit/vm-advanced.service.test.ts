/**
 * Unit tests for vm-advanced.service — verifies VM advanced feature methods
 * including affinity, protection, VCPU hotplug, boot order, and platform settings.
 * v9: New tests for VM advanced features.
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

describe('vm-advanced.service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCallWithSession.mockReset()
  })

  describe('getVmAdvancedConfig', () => {
    it('returns complete VM advanced configuration', async () => {
      mockCallWithSession.mockResolvedValueOnce({
        name_label: 'test-vm',
        affinity: 'OpaqueRef:host1',
        ha_always_run: true,
        blocked_operations: { destroy: 'external deletion protection' },
        VCPUs_at_startup: 2,
        VCPUs_max: 4,
        start_delay: '30',
        HVM_boot_params: { order: 'cdn' },
        other_config: { key1: 'value1' },
        platform: { viridian: 'true' },
      })

      const { getVmAdvancedConfig } = await import('../../src/main/xapi/services/vm-advanced.service')
      const config = await getVmAdvancedConfig('conn-123', 'OpaqueRef:vm')

      expect(config.vmRef).toBe('OpaqueRef:vm')
      expect(config.vmName).toBe('test-vm')
      expect(config.affinity).toBe('OpaqueRef:host1')
      expect(config.antiAffinity).toEqual([])
      expect(config.isProtected).toBe(true)
      expect(config.vcpusHotplug).toBe(true)
      expect(config.startDelay).toBe(30)
      expect(config.bootOrder).toBe('cdn')
      expect(config.hvmBootParams).toEqual({ order: 'cdn' })
      expect(config.otherConfig).toEqual({ key1: 'value1' })
      expect(config.platform).toEqual({ viridian: 'true' })
    })

    it('handles null affinity and empty arrays', async () => {
      mockCallWithSession.mockResolvedValueOnce({
        name_label: 'test-vm',
        affinity: null,
        ha_always_run: false,
        VCPUs_at_startup: 2,
        VCPUs_max: 2,
        start_delay: '0',
        HVM_boot_params: {},
        other_config: {},
        platform: {},
      })

      const { getVmAdvancedConfig } = await import('../../src/main/xapi/services/vm-advanced.service')
      const config = await getVmAdvancedConfig('conn-123', 'OpaqueRef:vm')

      expect(config.affinity).toBeNull()
      expect(config.antiAffinity).toEqual([])
      expect(config.isProtected).toBe(false)
      expect(config.vcpusHotplug).toBe(false)
      expect(config.startDelay).toBe(0)
      expect(config.bootOrder).toBe('')
    })
  })

  describe('setVmAffinity', () => {
    it('sets VM affinity to a specific host', async () => {
      mockCallWithSession.mockResolvedValueOnce({ uuid: 'vm-uuid' }).mockResolvedValueOnce({ uuid: 'host-uuid' }).mockResolvedValueOnce(undefined).mockResolvedValueOnce({ uuid: 'vm-uuid', affinity: 'OpaqueRef:host1' })

      const { setVmAffinity } = await import('../../src/main/xapi/services/vm-advanced.service')
      await setVmAffinity('conn-123', 'OpaqueRef:vm', 'OpaqueRef:host1')

      expect(mockCallWithSession).toHaveBeenCalledWith('VM.set_affinity', [
        'OpaqueRef:vm',
        'OpaqueRef:host1',
      ])
    })

    it('clears VM affinity when hostRef is null', async () => {
      mockCallWithSession.mockResolvedValueOnce({ uuid: 'vm-uuid' }).mockResolvedValueOnce(undefined).mockResolvedValueOnce({ uuid: 'vm-uuid', affinity: 'OpaqueRef:NULL' })

      const { setVmAffinity } = await import('../../src/main/xapi/services/vm-advanced.service')
      await setVmAffinity('conn-123', 'OpaqueRef:vm', null)

      expect(mockCallWithSession).toHaveBeenCalledWith('VM.set_affinity', [
        'OpaqueRef:vm',
        'OpaqueRef:NULL',
      ])
    })
  })

  describe('getVmAffinity', () => {
    it('returns VM affinity configuration', async () => {
      mockCallWithSession.mockResolvedValueOnce({
        affinity: 'OpaqueRef:host1',
      })

      const { getVmAffinity } = await import('../../src/main/xapi/services/vm-advanced.service')
      const config = await getVmAffinity('conn-123', 'OpaqueRef:vm')

      expect(config.vmRef).toBe('OpaqueRef:vm')
      expect(config.hostRef).toBe('OpaqueRef:host1')
      expect(config.antiAffinityRefs).toEqual([])
    })
  })

  describe('setVmAntiAffinity', () => {
    it('throws unsupported error instead of calling a non-XenAPI method', async () => {
      const { setVmAntiAffinity } = await import('../../src/main/xapi/services/vm-advanced.service')
      await expect(setVmAntiAffinity('conn-123', 'OpaqueRef:vm', ['OpaqueRef:vm1', 'OpaqueRef:vm2']))
        .rejects.toThrow('VM anti-affinity is not supported')
      expect(mockCallWithSession).not.toHaveBeenCalled()
    })
  })

  describe('addVmAntiAffinity', () => {
    it('throws unsupported error instead of calling a non-XenAPI method', async () => {
      const { addVmAntiAffinity } = await import('../../src/main/xapi/services/vm-advanced.service')
      await expect(addVmAntiAffinity('conn-123', 'OpaqueRef:vm', 'OpaqueRef:vm2'))
        .rejects.toThrow('VM anti-affinity is not supported')
      expect(mockCallWithSession).not.toHaveBeenCalled()
    })
  })

  describe('removeVmAntiAffinity', () => {
    it('throws unsupported error instead of calling a non-XenAPI method', async () => {
      const { removeVmAntiAffinity } = await import('../../src/main/xapi/services/vm-advanced.service')
      await expect(removeVmAntiAffinity('conn-123', 'OpaqueRef:vm', 'OpaqueRef:vm1'))
        .rejects.toThrow('VM anti-affinity is not supported')
      expect(mockCallWithSession).not.toHaveBeenCalled()
    })
  })

  describe('VM deletion protection', () => {
    const reason = 'XenAdmin Modern: VM deletion protection'
    it('adds only the deletion restriction and verifies it without touching HA', async () => {
      mockCallWithSession.mockResolvedValueOnce({ ha_always_run: false, blocked_operations: { clean_shutdown: 'external' } })
        .mockResolvedValueOnce(undefined).mockResolvedValueOnce({ blocked_operations: { clean_shutdown: 'external', destroy: reason } })
      const { enableVmProtection } = await import('../../src/main/xapi/services/vm-advanced.service')
      await enableVmProtection('conn-123', 'OpaqueRef:vm')
      expect(mockCallWithSession.mock.calls).toEqual([
        ['VM.get_record', ['OpaqueRef:vm']],
        ['VM.add_to_blocked_operations', ['OpaqueRef:vm', 'destroy', reason]],
        ['VM.get_record', ['OpaqueRef:vm']],
      ])
    })
    it('removes only its own deletion restriction', async () => {
      mockCallWithSession.mockResolvedValueOnce({ blocked_operations: { destroy: reason, start: 'external' } })
        .mockResolvedValueOnce(undefined).mockResolvedValueOnce({ blocked_operations: { start: 'external' } })
      const { disableVmProtection } = await import('../../src/main/xapi/services/vm-advanced.service')
      await disableVmProtection('conn-123', 'OpaqueRef:vm')
      expect(mockCallWithSession.mock.calls).toEqual([
        ['VM.get_record', ['OpaqueRef:vm']],
        ['VM.remove_from_blocked_operations', ['OpaqueRef:vm', 'destroy']],
        ['VM.get_record', ['OpaqueRef:vm']],
      ])
    })
    it('preserves existing external deletion protection and refuses to clear it', async () => {
      mockCallWithSession.mockResolvedValue({ blocked_operations: { destroy: 'external' } })
      const { enableVmProtection, disableVmProtection } = await import('../../src/main/xapi/services/vm-advanced.service')
      await enableVmProtection('conn-123', 'OpaqueRef:vm')
      await expect(disableVmProtection('conn-123', 'OpaqueRef:vm')).rejects.toThrow('其他工具或管理员')
      expect(mockCallWithSession.mock.calls.every(([method]) => method === 'VM.get_record')).toBe(true)
    })
    it('does not interpret HA always-run as deletion protection', async () => {
      mockCallWithSession.mockResolvedValue({ ha_always_run: true, blocked_operations: {} })
      const { getVmAdvancedConfig } = await import('../../src/main/xapi/services/vm-advanced.service')
      expect((await getVmAdvancedConfig('conn-123', 'OpaqueRef:vm')).isProtected).toBe(false)
    })
    it('reports a non-applied protection update without retrying', async () => {
      mockCallWithSession.mockResolvedValueOnce({ blocked_operations: {} }).mockResolvedValueOnce(undefined).mockResolvedValue({ blocked_operations: {} })
      const { enableVmProtection } = await import('../../src/main/xapi/services/vm-advanced.service')
      await expect(enableVmProtection('conn-123', 'OpaqueRef:vm')).rejects.toThrow('服务器尚未启用删除保护')
      expect(mockCallWithSession).toHaveBeenCalledTimes(5)
    })
    it('does not replay a lost protection response', async () => {
      mockCallWithSession.mockResolvedValueOnce({ blocked_operations: {} }).mockRejectedValueOnce(new Error('timeout'))
      const { enableVmProtection } = await import('../../src/main/xapi/services/vm-advanced.service')
      await expect(enableVmProtection('conn-123', 'OpaqueRef:vm')).rejects.toThrow('timeout')
      expect(mockCallWithSession).toHaveBeenCalledTimes(2)
    })
  })

  describe('setVmVcpuHotplug', () => {
    it.each(['protect', 'unprotect', 'max', 'startup', 'live'])('resolves a lost %s acknowledgement from the applied VM state', async (operation) => {
      const reason = 'XenAdmin Modern: VM deletion protection'
      const initial = { uuid: 'vm-uuid', power_state: operation === 'live' ? 'Running' : 'Halted', VCPUs_max: 4, VCPUs_at_startup: 1,
        blocked_operations: operation === 'unprotect' ? { destroy: reason } : {} }
      const updated = { ...initial, blocked_operations: operation === 'protect' ? { destroy: reason } : {},
        VCPUs_max: operation === 'max' ? 8 : 4, VCPUs_at_startup: 2, metrics: 'metrics' }
      mockCallWithSession.mockResolvedValueOnce(initial)
        .mockRejectedValueOnce(Object.assign(new Error('reply lost'), { details: { kind: 'transport' } }))
        .mockResolvedValueOnce(updated).mockResolvedValueOnce({ VCPUs_number: 2 })
      const service = await import('../../src/main/xapi/services/vm-advanced.service')
      if (operation === 'protect') await service.enableVmProtection('conn-123', 'vm')
      if (operation === 'unprotect') await service.disableVmProtection('conn-123', 'vm')
      if (operation === 'max') await service.setVmVcpuHotplug('conn-123', 'vm', 8)
      if (operation === 'startup' || operation === 'live') await service.setVmVcpusNumber('conn-123', 'vm', 2)
      expect(mockCallWithSession.mock.calls.filter(([method]) => method !== 'VM.get_record' && method !== 'VM_metrics.get_record')).toHaveLength(1)
    })

    it('sets maximum VCPUs when VM is halted', async () => {
      mockCallWithSession
        .mockResolvedValueOnce({
          power_state: 'Halted', VCPUs_at_startup: 2,
        })
        .mockResolvedValueOnce(undefined).mockResolvedValueOnce({ VCPUs_max: 8 })

      const { setVmVcpuHotplug } = await import('../../src/main/xapi/services/vm-advanced.service')
      await setVmVcpuHotplug('conn-123', 'OpaqueRef:vm', 8)

      expect(mockCallWithSession).toHaveBeenNthCalledWith(2, 'VM.set_VCPUs_max', [
        'OpaqueRef:vm',
        8,
      ])
    })

    it('throws error when VM is not halted', async () => {
      mockCallWithSession.mockResolvedValueOnce({
        power_state: 'Running',
      })

      const { setVmVcpuHotplug } = await import('../../src/main/xapi/services/vm-advanced.service')
      await expect(setVmVcpuHotplug('conn-123', 'OpaqueRef:vm', 8)).rejects.toThrow(
        'VM必须处于关闭状态才能更改最大VCPU数'
      )
    })
  })

  describe('setVmVcpusNumber', () => {
    it('sets VCPUs at startup', async () => {
      mockCallWithSession
        .mockResolvedValueOnce({
          power_state: 'Halted', VCPUs_max: 8,
        })
        .mockResolvedValueOnce(undefined).mockResolvedValueOnce({ VCPUs_at_startup: 4 })

      const { setVmVcpusNumber } = await import('../../src/main/xapi/services/vm-advanced.service')
      await setVmVcpusNumber('conn-123', 'OpaqueRef:vm', 4)

      expect(mockCallWithSession).toHaveBeenCalledWith('VM.set_VCPUs_at_startup', [
        'OpaqueRef:vm',
        4,
      ])
    })

    it('attempts live VCPU change when VM is running', async () => {
      mockCallWithSession
        .mockResolvedValueOnce({
          power_state: 'Running', VCPUs_max: 8,
        })
        .mockResolvedValueOnce(undefined).mockResolvedValueOnce({ metrics: 'OpaqueRef:metrics' }).mockResolvedValueOnce({ VCPUs_number: 4 })

      const { setVmVcpusNumber } = await import('../../src/main/xapi/services/vm-advanced.service')
      await setVmVcpusNumber('conn-123', 'OpaqueRef:vm', 4)

      expect(mockCallWithSession).toHaveBeenCalledWith('VM.set_VCPUs_number_live', [
        'OpaqueRef:vm',
        4,
      ])
      expect(mockCallWithSession).not.toHaveBeenCalledWith('VM.set_VCPUs_at_startup', expect.anything())
    })
  })

  describe('setVmStartDelay', () => {
    it('sets VM start delay', async () => {
      mockCallWithSession.mockResolvedValueOnce(undefined)

      const { setVmStartDelay } = await import('../../src/main/xapi/services/vm-advanced.service')
      await setVmStartDelay('conn-123', 'OpaqueRef:vm', 60)

      expect(mockCallWithSession).toHaveBeenCalledWith('VM.set_start_delay', [
        'OpaqueRef:vm',
        60,
      ])
    })
  })

  describe('setVmBootOrder', () => {
    it('sets VM boot order when halted', async () => {
      mockCallWithSession
        .mockResolvedValueOnce({
          power_state: 'Halted',
          HVM_boot_params: { firmware: 'uefi', order: 'dc' },
        })
        .mockResolvedValueOnce(undefined)

      const { setVmBootOrder } = await import('../../src/main/xapi/services/vm-advanced.service')
      await setVmBootOrder('conn-123', 'OpaqueRef:vm', 'cdn')

      expect(mockCallWithSession).toHaveBeenNthCalledWith(2, 'VM.set_HVM_boot_params', [
        'OpaqueRef:vm',
        { firmware: 'uefi', order: 'cdn' },
      ])
    })

    it('throws error when VM is not halted', async () => {
      mockCallWithSession.mockResolvedValueOnce({
        power_state: 'Running',
      })

      const { setVmBootOrder } = await import('../../src/main/xapi/services/vm-advanced.service')
      await expect(setVmBootOrder('conn-123', 'OpaqueRef:vm', 'cdn')).rejects.toThrow(
        'VM必须处于关闭状态才能更改启动顺序'
      )
    })
  })

  describe('setVmHvmBootParams', () => {
    it('sets HVM boot parameters', async () => {
      mockCallWithSession.mockResolvedValueOnce({ HVM_boot_params: { secureboot: 'true' } })

      const { setVmHvmBootParams } = await import('../../src/main/xapi/services/vm-advanced.service')
      await setVmHvmBootParams('conn-123', 'OpaqueRef:vm', { order: 'dc', firmware: 'uefi' })

      expect(mockCallWithSession).toHaveBeenCalledWith('VM.set_HVM_boot_params', [
        'OpaqueRef:vm',
        { secureboot: 'true', order: 'dc', firmware: 'uefi' },
      ])
    })
  })

  describe('setVmPlatformParam', () => {
    it('sets platform parameter', async () => {
      mockCallWithSession.mockResolvedValueOnce({ platform: { device_model: 'qemu-upstream' } })

      const { setVmPlatformParam } = await import('../../src/main/xapi/services/vm-advanced.service')
      await setVmPlatformParam('conn-123', 'OpaqueRef:vm', 'viridian', 'true')

      expect(mockCallWithSession).toHaveBeenCalledWith('VM.set_platform', [
        'OpaqueRef:vm',
        { device_model: 'qemu-upstream', viridian: 'true' },
      ])
    })
  })

  describe('setVmViridian', () => {
    it('enables Viridian', async () => {
      mockCallWithSession.mockResolvedValueOnce({ platform: { firmware: 'uefi' } })

      const { setVmViridian } = await import('../../src/main/xapi/services/vm-advanced.service')
      await setVmViridian('conn-123', 'OpaqueRef:vm', true)

      expect(mockCallWithSession).toHaveBeenCalledWith('VM.set_platform', [
        'OpaqueRef:vm',
        { firmware: 'uefi', viridian: 'true' },
      ])
    })

    it('disables Viridian', async () => {
      mockCallWithSession.mockResolvedValueOnce({ platform: { firmware: 'uefi' } })

      const { setVmViridian } = await import('../../src/main/xapi/services/vm-advanced.service')
      await setVmViridian('conn-123', 'OpaqueRef:vm', false)

      expect(mockCallWithSession).toHaveBeenCalledWith('VM.set_platform', [
        'OpaqueRef:vm',
        { firmware: 'uefi', viridian: 'false' },
      ])
    })
  })

  describe('setVmOtherConfig', () => {
    it('sets other config parameter', async () => {
      mockCallWithSession
        .mockResolvedValueOnce({
          other_config: { existing: 'value' },
        })
        .mockResolvedValueOnce(undefined)

      const { setVmOtherConfig } = await import('../../src/main/xapi/services/vm-advanced.service')
      await setVmOtherConfig('conn-123', 'OpaqueRef:vm', 'newKey', 'newValue')

      expect(mockCallWithSession).toHaveBeenNthCalledWith(2, 'VM.set_other_config', [
        'OpaqueRef:vm',
        { existing: 'value', newKey: 'newValue' },
      ])
    })
  })

  describe('addVmTag', () => {
    it('adds tag to VM', async () => {
      mockCallWithSession
        .mockResolvedValueOnce({
          tags: ['tag1'],
        })
        .mockResolvedValueOnce(undefined)

      const { addVmTag } = await import('../../src/main/xapi/services/vm-advanced.service')
      await addVmTag('conn-123', 'OpaqueRef:vm', 'tag2')

      expect(mockCallWithSession).toHaveBeenNthCalledWith(2, 'VM.set_tags', [
        'OpaqueRef:vm',
        ['tag1', 'tag2'],
      ])
    })

    it('does not add duplicate tag', async () => {
      mockCallWithSession.mockResolvedValueOnce({
        tags: ['tag1', 'tag2'],
      })

      const { addVmTag } = await import('../../src/main/xapi/services/vm-advanced.service')
      await addVmTag('conn-123', 'OpaqueRef:vm', 'tag1')

      expect(mockCallWithSession).toHaveBeenCalledTimes(1)
    })
  })

  describe('removeVmTag', () => {
    it('removes tag from VM', async () => {
      mockCallWithSession
        .mockResolvedValueOnce({
          tags: ['tag1', 'tag2'],
        })
        .mockResolvedValueOnce(undefined)

      const { removeVmTag } = await import('../../src/main/xapi/services/vm-advanced.service')
      await removeVmTag('conn-123', 'OpaqueRef:vm', 'tag1')

      expect(mockCallWithSession).toHaveBeenNthCalledWith(2, 'VM.set_tags', [
        'OpaqueRef:vm',
        ['tag2'],
      ])
    })
  })

  describe('getAllVmAdvancedConfigs', () => {
    it('returns advanced configs for all VMs', async () => {
      mockCallWithSession
        .mockResolvedValueOnce(['OpaqueRef:vm1', 'OpaqueRef:vm2'])
        .mockResolvedValueOnce({
          name_label: 'vm1',
          affinity: null,
          antiaffinity: [],
          ha_always_run: false,
          VCPUs_at_startup: 1,
          VCPUs_max: 1,
          start_delay: '0',
          HVM_boot_params: {},
          other_config: {},
          platform: {},
        })
        .mockResolvedValueOnce({
          name_label: 'vm2',
          affinity: 'OpaqueRef:host1',
          antiaffinity: ['OpaqueRef:vm1'],
          ha_always_run: true,
        blocked_operations: { destroy: 'external deletion protection' },
          VCPUs_at_startup: 2,
          VCPUs_max: 4,
          start_delay: '30',
          HVM_boot_params: { order: 'cdn' },
          other_config: {},
          platform: { viridian: 'true' },
        })

      const { getAllVmAdvancedConfigs } = await import('../../src/main/xapi/services/vm-advanced.service')
      const configs = await getAllVmAdvancedConfigs('conn-123')

      expect(configs).toHaveLength(2)
      expect(configs[0].vmName).toBe('vm1')
      expect(configs[1].vmName).toBe('vm2')
      expect(configs[1].affinity).toBe('OpaqueRef:host1')
      expect(configs[1].isProtected).toBe(true)
    })
  })

  describe('setPoolVmStartOrder', () => {
    it('sets start delay for multiple VMs', async () => {
      mockCallWithSession.mockResolvedValue(undefined)

      const { setPoolVmStartOrder } = await import('../../src/main/xapi/services/vm-advanced.service')
      await setPoolVmStartOrder('conn-123', [
        { vmRef: 'OpaqueRef:vm1', startDelay: 30, order: 1 },
        { vmRef: 'OpaqueRef:vm2', startDelay: 60, order: 2 },
      ])

      expect(mockCallWithSession).toHaveBeenCalledWith('VM.set_start_delay', [
        'OpaqueRef:vm1',
        30,
      ])
      expect(mockCallWithSession).toHaveBeenCalledWith('VM.set_start_delay', [
        'OpaqueRef:vm2',
        60,
      ])
    })
  })

  describe('error handling', () => {
    it('throws error when connectionId is invalid', async () => {
      mockGetClient.mockReturnValueOnce(undefined)

      const { getVmAdvancedConfig } = await import('../../src/main/xapi/services/vm-advanced.service')
      await expect(getVmAdvancedConfig('invalid-id', 'OpaqueRef:vm')).rejects.toThrow(
        'No connection found for connectionId: invalid-id'
      )
    })

    it('handles XAPI call failures', async () => {
      mockCallWithSession.mockRejectedValueOnce(new Error('XAPI_ERROR'))

      const { getVmAdvancedConfig } = await import('../../src/main/xapi/services/vm-advanced.service')
      await expect(getVmAdvancedConfig('conn-123', 'OpaqueRef:vm')).rejects.toThrow('XAPI_ERROR')
    })
  })
})

describe('native VM Group observations', () => {
  it('reads anti-affinity members from server VM groups', async () => {
    mockCallWithSession.mockReset()
    mockGetClient.mockReturnValue(mockClient)
    mockCallWithSession.mockResolvedValueOnce({ name_label: 'VM', groups: ['OpaqueRef:group'] })
      .mockResolvedValueOnce({ placement: 'anti_affinity', VMs: ['OpaqueRef:vm', 'OpaqueRef:peer'] })
    const { getVmAdvancedConfig } = await import('../../src/main/xapi/services/vm-advanced.service')
    await expect(getVmAdvancedConfig('pool', 'OpaqueRef:vm')).resolves.toMatchObject({ antiAffinity: ['OpaqueRef:peer'], antiAffinitySupported: true })
  })
})
