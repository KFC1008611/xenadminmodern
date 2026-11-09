import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { VmAffinityDialog } from '../../src/renderer/src/components/vm/VmAffinityDialog'
import { VmAdvancedSettingsTab } from '../../src/renderer/src/components/vm/VmAdvancedSettingsTab'
import { useVmAdvancedStore } from '../../src/renderer/src/store/vm-advanced.store'
import { useConnectionManagerStore } from '../../src/renderer/src/store/connectionManager.store'

vi.mock('../../src/renderer/src/components/toast/useToast', () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}))

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
  platform: { viridian: 'false' },
  otherConfig: {},
  tags: [],
}

describe('VmAdvancedSettingsTab connection scoping', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(window.xapi, {
      vmAdvanced: {
        getConfig: vi.fn().mockResolvedValue(vmConfig),
        getAffinity: vi.fn().mockResolvedValue({
          vmRef: 'OpaqueRef:vm',
          hostRef: null,
          hostName: null,
          antiAffinityRefs: [],
          antiAffinityNames: [],
        }),
        enableProtection: vi.fn().mockResolvedValue(undefined),
        disableProtection: vi.fn().mockResolvedValue(undefined),
        setViridian: vi.fn().mockResolvedValue(undefined),
        setBootOrder: vi.fn().mockResolvedValue(undefined),
      },
      host: {
        list: vi.fn().mockResolvedValue([]),
      },
      vm: {
        list: vi.fn().mockResolvedValue([]),
      },
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
  })

  it('loads and toggles advanced VM settings with the route connection', async () => {
    render(<VmAdvancedSettingsTab connectionId="conn-b" vmRef="OpaqueRef:vm" powerState="Halted" />)

    expect(await screen.findByText('VM保护')).toBeInTheDocument()
    expect(window.xapi.vmAdvanced.getConfig).toHaveBeenCalledWith('conn-b', 'OpaqueRef:vm')

    fireEvent.click(screen.getAllByRole('button', { name: '已禁用' })[0])
    await waitFor(() => {
      expect(window.xapi.vmAdvanced.enableProtection).toHaveBeenCalledWith('conn-b', 'OpaqueRef:vm')
    })

    fireEvent.click(screen.getAllByRole('button', { name: '已禁用' })[1])
    await waitFor(() => {
      expect(window.xapi.vmAdvanced.setViridian).toHaveBeenCalledWith('conn-b', 'OpaqueRef:vm', true)
    })
  })

  it('saves boot order with the route connection', async () => {
    render(<VmAdvancedSettingsTab connectionId="conn-b" vmRef="OpaqueRef:vm" powerState="Halted" />)

    expect(await screen.findByText('启动顺序')).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: '配置' })[1])
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => {
      expect(window.xapi.vmAdvanced.setBootOrder).toHaveBeenCalledWith('conn-b', 'OpaqueRef:vm', 'cdn')
    })
  })
  it('shows a read error and permits an explicit retry instead of loading forever', async () => {
    vi.mocked(window.xapi.vmAdvanced.getConfig).mockRejectedValueOnce(new Error('permission denied')).mockResolvedValueOnce(vmConfig as any)
    render(<VmAdvancedSettingsTab connectionId="conn-b" vmRef="OpaqueRef:vm" powerState="Halted" />)
    expect(await screen.findByRole('alert')).toHaveTextContent('permission denied')
    expect(screen.queryByText('加载高级配置...')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重新读取' }))
    expect(await screen.findByText('VM保护')).toBeInTheDocument()
  })

  it('retains the last configuration with a warning and disables writes after a failed refresh', async () => {
    useVmAdvancedStore.setState({ vmConfigs: { 'conn-b:OpaqueRef:vm': vmConfig as any } })
    vi.mocked(window.xapi.vmAdvanced.getConfig).mockRejectedValueOnce(new Error('disconnected'))
    render(<VmAdvancedSettingsTab connectionId="conn-b" vmRef="OpaqueRef:vm" powerState="Halted" />)
    expect(await screen.findByRole('alert')).toHaveTextContent('最近一次成功读取')
    expect(screen.getAllByRole('button', { name: '已禁用' }).every((button) => (button as HTMLButtonElement).disabled)).toBe(true)
  })

})

describe('affinity form read failures', () => {
  it('blocks saving after a failed read and shows an explicit retry', async () => {
    useConnectionManagerStore.setState({ connections: [{ id: 'new-pool', state: 'connected' } as any] })
    Object.assign(window.xapi, { host: { list: vi.fn().mockResolvedValue([]) }, vmAdvanced: {
      getAffinity: vi.fn().mockRejectedValue(new Error('permission denied')), setAffinity: vi.fn(),
    } })
    useVmAdvancedStore.setState({ affinityConfig: { vmRef: 'OpaqueRef:old', hostRef: 'OpaqueRef:old-host', antiAffinityRefs: [] }, affinityConfigKey: 'old-pool:OpaqueRef:old' })
    render(<VmAffinityDialog open onOpenChange={vi.fn()} connectionId="new-pool" vmRef="OpaqueRef:new" />)
    expect(await screen.findByRole('alert')).toHaveTextContent('permission denied')
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '重新读取' })).toBeEnabled()
    expect(screen.getByRole('combobox')).toBeDisabled()
    expect(window.xapi.vmAdvanced.setAffinity).not.toHaveBeenCalled()
  })
})
