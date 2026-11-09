import { describe, expect, it, vi } from 'vitest'
import { createVmAdvancedApi } from '../../src/preload/vm-advanced-api'

const advancedConfig = {
  vmRef: 'OpaqueRef:vm',
  vmName: 'Workload VM',
  affinity: null,
  antiAffinity: [],
  isProtected: false,
  vcpusHotplug: true,
  startDelay: 0,
  bootOrder: 'cdn',
  hvmBootParams: { order: 'cdn' },
  otherConfig: {},
  platform: { viridian: 'true' },
}

describe('VM Advanced preload IPC contracts', () => {
  it('exposes the independent literal inventory of all twenty API keys', () => {
    expect(Object.keys(createVmAdvancedApi({ invoke: vi.fn() }))).toEqual([
      'getConfig',
      'getAllConfigs',
      'setAffinity',
      'getAffinity',
      'setAntiAffinity',
      'addAntiAffinity',
      'removeAntiAffinity',
      'enableProtection',
      'disableProtection',
      'setVcpuHotplug',
      'setVcpusNumber',
      'setStartDelay',
      'setBootOrder',
      'setHvmBootParams',
      'setPlatformParam',
      'setViridian',
      'setOtherConfig',
      'addTag',
      'removeTag',
      'setStartOrder',
    ])
  })

  it('routes the three reads and validates payloads and results before exposing them', async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce(advancedConfig)
      .mockResolvedValueOnce([advancedConfig])
      .mockResolvedValueOnce({ vmRef: 'OpaqueRef:vm', hostRef: null, antiAffinityRefs: [] })
    const api = createVmAdvancedApi({ invoke })

    await expect(api.getConfig('pool-1', 'OpaqueRef:vm')).resolves.toEqual(advancedConfig)
    await expect(api.getAllConfigs('pool-1')).resolves.toEqual([advancedConfig])
    await expect(api.getAffinity('pool-1', 'OpaqueRef:vm')).resolves.toEqual({
      vmRef: 'OpaqueRef:vm', hostRef: null, antiAffinityRefs: [],
    })
    expect(invoke.mock.calls).toEqual([
      ['vm:advGetConfig', 'pool-1', 'OpaqueRef:vm'],
      ['vm:advGetAllConfigs', 'pool-1'],
      ['vm:advGetAffinity', 'pool-1', 'OpaqueRef:vm'],
    ])

    await expect(api.getConfig('pool-1', 'OpaqueRef:NULL')).rejects.toMatchObject({
      code: 'IPC_SCHEMA_INVALID',
    })
    expect(invoke).toHaveBeenCalledTimes(3)

    invoke.mockResolvedValueOnce({ vmRef: 'incomplete' })
    await expect(api.getConfig('pool-1', 'OpaqueRef:vm')).rejects.toMatchObject({
      code: 'IPC_RESULT_INVALID',
    })

    invoke.mockResolvedValueOnce({
      error: true,
      message: 'VM configuration unavailable',
      code: 'VM_CONFIG_UNAVAILABLE',
      details: { retryable: true },
    })
    await expect(api.getConfig('pool-1', 'OpaqueRef:vm')).rejects.toMatchObject({
      message: 'VM configuration unavailable',
      code: 'VM_CONFIG_UNAVAILABLE',
      details: { retryable: true },
    })
  })

  it('routes affinity and protection mutations and rejects malformed values before transport', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined)
    const api = createVmAdvancedApi({ invoke })

    await expect(api.setAffinity('pool-1', 'OpaqueRef:vm', null)).resolves.toBeUndefined()
    await expect(api.setAntiAffinity(
      'pool-1',
      'OpaqueRef:vm',
      ['OpaqueRef:peer'],
    )).resolves.toBeUndefined()
    await expect(api.addAntiAffinity(
      'pool-1',
      'OpaqueRef:vm',
      'OpaqueRef:peer',
    )).resolves.toBeUndefined()
    await expect(api.removeAntiAffinity(
      'pool-1',
      'OpaqueRef:vm',
      'OpaqueRef:peer',
    )).resolves.toBeUndefined()
    await expect(api.enableProtection('pool-1', 'OpaqueRef:vm')).resolves.toBeUndefined()
    await expect(api.disableProtection('pool-1', 'OpaqueRef:vm')).resolves.toBeUndefined()

    expect(invoke.mock.calls).toEqual([
      ['vm:advSetAffinity', 'pool-1', 'OpaqueRef:vm', null],
      ['vm:advSetAntiAffinity', 'pool-1', 'OpaqueRef:vm', ['OpaqueRef:peer']],
      ['vm:advAddAntiAffinity', 'pool-1', 'OpaqueRef:vm', 'OpaqueRef:peer'],
      ['vm:advRemoveAntiAffinity', 'pool-1', 'OpaqueRef:vm', 'OpaqueRef:peer'],
      ['vm:advEnableProtection', 'pool-1', 'OpaqueRef:vm'],
      ['vm:advDisableProtection', 'pool-1', 'OpaqueRef:vm'],
    ])

    await expect(api.setAffinity('pool-1', 'OpaqueRef:vm', 'OpaqueRef:NULL'))
      .rejects.toMatchObject({ code: 'IPC_SCHEMA_INVALID' })
    await expect(api.setAntiAffinity('pool-1', 'OpaqueRef:vm', ['']))
      .rejects.toMatchObject({ code: 'IPC_SCHEMA_INVALID' })
    expect(invoke).toHaveBeenCalledTimes(6)

    invoke.mockResolvedValueOnce(false)
    await expect(api.enableProtection('pool-1', 'OpaqueRef:vm'))
      .rejects.toMatchObject({ code: 'IPC_RESULT_INVALID' })
  })

  it('routes VCPU, delay, and boot mutations with preload-side validation', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined)
    const api = createVmAdvancedApi({ invoke })

    await expect(api.setVcpuHotplug('pool-1', 'OpaqueRef:vm', 8)).resolves.toBeUndefined()
    await expect(api.setVcpusNumber('pool-1', 'OpaqueRef:vm', 4)).resolves.toBeUndefined()
    await expect(api.setStartDelay('pool-1', 'OpaqueRef:vm', 0)).resolves.toBeUndefined()
    await expect(api.setBootOrder('pool-1', 'OpaqueRef:vm', 'dnc')).resolves.toBeUndefined()
    await expect(api.setHvmBootParams(
      'pool-1',
      'OpaqueRef:vm',
      { order: 'cdn', custom: '' },
    )).resolves.toBeUndefined()
    expect(invoke.mock.calls).toEqual([
      ['vm:advSetVcpuHotplug', 'pool-1', 'OpaqueRef:vm', 8],
      ['vm:advSetVcpusNumber', 'pool-1', 'OpaqueRef:vm', 4],
      ['vm:advSetStartDelay', 'pool-1', 'OpaqueRef:vm', 0],
      ['vm:advSetBootOrder', 'pool-1', 'OpaqueRef:vm', 'dnc'],
      ['vm:advSetHvmBootParams', 'pool-1', 'OpaqueRef:vm', { order: 'cdn', custom: '' }],
    ])

    await expect(api.setVcpuHotplug('pool-1', 'OpaqueRef:vm', 0))
      .rejects.toMatchObject({ code: 'IPC_SCHEMA_INVALID' })
    await expect(api.setStartDelay('pool-1', 'OpaqueRef:vm', 1.5))
      .rejects.toMatchObject({ code: 'IPC_SCHEMA_INVALID' })
    await expect(api.setBootOrder('pool-1', 'OpaqueRef:vm', 'cc'))
      .rejects.toMatchObject({ code: 'IPC_SCHEMA_INVALID' })
    await expect(api.setHvmBootParams('pool-1', 'OpaqueRef:vm', { order: 'x' }))
      .rejects.toMatchObject({ code: 'IPC_SCHEMA_INVALID' })
    expect(invoke).toHaveBeenCalledTimes(5)
  })

  it('routes maps, Viridian, tags, and exact start-order entries', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined)
    const api = createVmAdvancedApi({ invoke })
    const configs = [{ vmRef: 'OpaqueRef:vm', startDelay: 5, order: 3 }]

    await expect(api.setPlatformParam(
      'pool-1', 'OpaqueRef:vm', 'viridian', '',
    )).resolves.toBeUndefined()
    await expect(api.setViridian('pool-1', 'OpaqueRef:vm', true)).resolves.toBeUndefined()
    await expect(api.setOtherConfig(
      'pool-1', 'OpaqueRef:vm', 'owner', 'platform-team',
    )).resolves.toBeUndefined()
    await expect(api.addTag('pool-1', 'OpaqueRef:vm', 'production')).resolves.toBeUndefined()
    await expect(api.removeTag('pool-1', 'OpaqueRef:vm', 'legacy')).resolves.toBeUndefined()
    await expect(api.setStartOrder('pool-1', configs)).resolves.toBeUndefined()
    expect(invoke.mock.calls).toEqual([
      ['vm:advSetPlatformParam', 'pool-1', 'OpaqueRef:vm', 'viridian', ''],
      ['vm:advSetViridian', 'pool-1', 'OpaqueRef:vm', true],
      ['vm:advSetOtherConfig', 'pool-1', 'OpaqueRef:vm', 'owner', 'platform-team'],
      ['vm:advAddTag', 'pool-1', 'OpaqueRef:vm', 'production'],
      ['vm:advRemoveTag', 'pool-1', 'OpaqueRef:vm', 'legacy'],
      ['vm:advSetStartOrder', 'pool-1', configs],
    ])

    await expect(api.setPlatformParam('pool-1', 'OpaqueRef:vm', '', 'secret'))
      .rejects.toMatchObject({ code: 'IPC_SCHEMA_INVALID' })
    await expect(api.addTag('pool-1', 'OpaqueRef:vm', '   '))
      .rejects.toMatchObject({ code: 'IPC_SCHEMA_INVALID' })
    await expect(api.setStartOrder('pool-1', [
      { vmRef: 'OpaqueRef:vm', startDelay: 0, order: -1 },
    ])).rejects.toMatchObject({ code: 'IPC_SCHEMA_INVALID' })
    expect(invoke).toHaveBeenCalledTimes(6)
  })
})
