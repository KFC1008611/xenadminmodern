import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useConnectionManagerStore } from '../../src/renderer/src/store/connectionManager.store'
import { useVmAdvancedStore, vmAdvancedKey } from '../../src/renderer/src/store/vm-advanced.store'

const mockXapi = {
  vmAdvanced: {
    getConfig: vi.fn(),
    getAllConfigs: vi.fn(),
    getAffinity: vi.fn(),
    setAffinity: vi.fn(),
    setAntiAffinity: vi.fn(),
    addAntiAffinity: vi.fn(),
    removeAntiAffinity: vi.fn(),
    enableProtection: vi.fn(),
    disableProtection: vi.fn(),
    setVcpuHotplug: vi.fn(),
    setVcpusNumber: vi.fn(),
    setStartDelay: vi.fn(),
    setBootOrder: vi.fn(),
    setHvmBootParams: vi.fn(),
    setPlatformParam: vi.fn(),
    setViridian: vi.fn(),
    setOtherConfig: vi.fn(),
    addTag: vi.fn(),
    removeTag: vi.fn(),
    setStartOrder: vi.fn(),
  },
}

const vmConfig = {
  vmRef: 'OpaqueRef:vm',
  nameLabel: 'VM B',
  isProtected: false,
  affinity: null,
  antiAffinity: [],
  vcpusMax: 2,
  vcpusAtStartup: 2,
  vcpusHotplug: false,
  memoryStaticMax: 0,
  memoryDynamicMax: 0,
  bootOrder: 'cdn',
  startDelay: 0,
  platform: {},
  otherConfig: {},
  tags: [],
}

describe('VM advanced store connection scoping', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(globalThis as any).window = { xapi: mockXapi }
    useConnectionManagerStore.setState({
      connections: [],
      activeConnectionId: 'conn-a',
    })
    useVmAdvancedStore.setState({
      vmConfigs: {},
      vmConfigReads: {},
      vmConfigsLoading: false,
      vmConfigsError: null,
      affinityConfig: null,
      affinityConfigLoading: false,
      affinityConfigError: null,
      allVmConfigs: [],
      allVmConfigsLoading: false,
      allVmConfigsError: null,
    })
    mockXapi.vmAdvanced.getConfig.mockResolvedValue(vmConfig)
    mockXapi.vmAdvanced.getAffinity.mockResolvedValue({
      vmRef: 'OpaqueRef:vm',
      hostRef: null,
      hostName: null,
      antiAffinityRefs: [],
      antiAffinityNames: [],
    })
  })

  it('loads VM config with the explicit connection and caches it by connection/ref', async () => {
    await useVmAdvancedStore.getState().loadVmConfig('conn-b', 'OpaqueRef:vm')

    expect(mockXapi.vmAdvanced.getConfig).toHaveBeenCalledWith('conn-b', 'OpaqueRef:vm')
    expect(useVmAdvancedStore.getState().vmConfigs[vmAdvancedKey('conn-b', 'OpaqueRef:vm')]).toEqual(vmConfig)
  })

  it('sets boot order and refreshes with the same explicit connection', async () => {
    await useVmAdvancedStore.getState().setVmBootOrder('conn-b', 'OpaqueRef:vm', 'dc')

    expect(mockXapi.vmAdvanced.setBootOrder).toHaveBeenCalledWith('conn-b', 'OpaqueRef:vm', 'dc')
    expect(mockXapi.vmAdvanced.getConfig).toHaveBeenCalledWith('conn-b', 'OpaqueRef:vm')
  })

  it('sets affinity and refreshes affinity/config with the same explicit connection', async () => {
    await useVmAdvancedStore.getState().setVmAffinity('conn-b', 'OpaqueRef:vm', 'OpaqueRef:host-b')

    expect(mockXapi.vmAdvanced.setAffinity).toHaveBeenCalledWith('conn-b', 'OpaqueRef:vm', 'OpaqueRef:host-b')
    expect(mockXapi.vmAdvanced.getConfig).toHaveBeenCalledWith('conn-b', 'OpaqueRef:vm')
    expect(mockXapi.vmAdvanced.getAffinity).toHaveBeenCalledWith('conn-b', 'OpaqueRef:vm')
  })
  it('ignores an older read of the same VM after a newer config has arrived', async () => {
    let finish!: (value: any) => void
    mockXapi.vmAdvanced.getConfig.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve })).mockResolvedValueOnce({ ...vmConfig, isProtected: true })
    const oldRead = useVmAdvancedStore.getState().loadVmConfig('conn-b', 'OpaqueRef:vm')
    await useVmAdvancedStore.getState().loadVmConfig('conn-b', 'OpaqueRef:vm')
    finish(vmConfig)
    await oldRead
    expect(useVmAdvancedStore.getState().vmConfigs['conn-b:OpaqueRef:vm'].isProtected).toBe(true)
  })

  it('keeps a pool-specific read error when another pool read succeeds', async () => {
    mockXapi.vmAdvanced.getConfig.mockRejectedValueOnce(new Error('pool A denied')).mockResolvedValueOnce(vmConfig)
    await useVmAdvancedStore.getState().loadVmConfig('conn-a', 'OpaqueRef:vm')
    await useVmAdvancedStore.getState().loadVmConfig('conn-b', 'OpaqueRef:vm')
    expect(useVmAdvancedStore.getState().vmConfigReads['conn-a:OpaqueRef:vm'].error).toBe('pool A denied')
    expect(useVmAdvancedStore.getState().vmConfigReads['conn-b:OpaqueRef:vm'].error).toBeNull()
  })

})

describe('affinity read ownership', () => {
  it('clears another VM configuration when the new VM cannot be read', async () => {
    ;(globalThis as any).window = { xapi: mockXapi }
    useVmAdvancedStore.setState({ affinityConfig: { vmRef: 'OpaqueRef:a', hostRef: 'OpaqueRef:host-a', antiAffinityRefs: [] }, affinityConfigKey: 'pool-a:OpaqueRef:a' })
    mockXapi.vmAdvanced.getAffinity.mockRejectedValueOnce(new Error('permission denied'))
    await useVmAdvancedStore.getState().loadAffinityConfig('pool-b', 'OpaqueRef:b')
    expect(useVmAdvancedStore.getState()).toMatchObject({ affinityConfig: null, affinityConfigKey: 'pool-b:OpaqueRef:b', affinityConfigError: 'permission denied' })
  })

  it('discards a late affinity result after a different VM was requested', async () => {
    ;(globalThis as any).window = { xapi: mockXapi }
    let finish!: (value: any) => void
    mockXapi.vmAdvanced.getAffinity.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
      .mockResolvedValueOnce({ vmRef: 'OpaqueRef:b', hostRef: 'OpaqueRef:host-b', antiAffinityRefs: [] })
    const old = useVmAdvancedStore.getState().loadAffinityConfig('pool-a', 'OpaqueRef:a')
    await useVmAdvancedStore.getState().loadAffinityConfig('pool-b', 'OpaqueRef:b')
    finish({ vmRef: 'OpaqueRef:a', hostRef: 'OpaqueRef:host-a', antiAffinityRefs: [] })
    await old
    expect(useVmAdvancedStore.getState().affinityConfig?.vmRef).toBe('OpaqueRef:b')
  })
})
