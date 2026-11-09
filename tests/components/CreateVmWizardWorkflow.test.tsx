import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CreateVmWizard } from '../../src/renderer/src/components/wizard/CreateVmWizard'
import { ToastProvider } from '../../src/renderer/src/components/toast/ToastProvider'
import { useConnectionManagerStore } from '../../src/renderer/src/store/connectionManager.store'
import type { VmRecord } from '../../src/renderer/src/types/xapi'

const GIB = 1073741824
const template = {
  ref: 'template', uuid: 'template', name_label: 'Linux installer', name_description: '',
  power_state: 'Halted', resident_on: 'OpaqueRef:NULL', VCPUs_max: 2, VCPUs_at_startup: 2,
  memory_static_min: GIB, memory_static_max: 2 * GIB, memory_dynamic_min: GIB, memory_dynamic_max: 2 * GIB,
  HVM_boot_policy: 'BIOS order',
  is_a_template: true, is_default_template: true, is_control_domain: false, VBDs: [], VIFs: [],
  metrics: 'OpaqueRef:NULL', guest_metrics: 'OpaqueRef:NULL', consoles: [],
  other_config: { default_template: 'true', 'install-methods': 'cdrom,nfs', disks: `<provision><disk device="0" size="${10 * GIB}" /></provision>` },
} satisfies VmRecord
const resources = {
  templateDisks: [{ templateVdiRef: '', device: '0', srRef: 'sr-a', sizeBytes: 10 * GIB, bootable: true }],
  templateCdCount: 0,
  hosts: [
    { ref: 'host-a', name: 'Host A', enabled: true, memoryFree: 8 * GIB, cpuCount: 8 },
    { ref: 'host-b', name: 'Host B', enabled: true, memoryFree: 4 * GIB, cpuCount: 4 },
  ],
  srs: [
    { ref: 'sr-a', name: 'Local A', isDefault: true, freeBytes: 100 * GIB, shared: false, hostRefs: ['host-a'] },
    { ref: 'sr-b', name: 'Local B', freeBytes: 100 * GIB, shared: false, hostRefs: ['host-b'] },
  ],
  networks: [
    { ref: 'net-a', name: 'Guest A', hostRefs: ['host-a'], autoPlug: true },
    { ref: 'net-b', name: 'Guest B', hostRefs: ['host-b'], autoPlug: true },
  ],
  isos: [
    { ref: 'iso-a', name: 'A.iso', srRef: 'iso-sr-a', hostRefs: ['host-a'] },
    { ref: 'iso-b', name: 'B.iso', srRef: 'iso-sr-b', hostRefs: ['host-b'] },
  ],
}
const next = () => fireEvent.click(screen.getByRole('button', { name: '下一步' }))
const edit = (name: string) => fireEvent.click(screen.getByRole('button', { name: `编辑${name}`, exact: true }))
const change = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
async function openWizard(onCreated = vi.fn()) {
  render(<ToastProvider><CreateVmWizard open onClose={vi.fn()} onCreated={onCreated} connectionId="pool-b" initialTemplate={template} /></ToastProvider>)
  await waitFor(() => expect(screen.getByRole('button', { name: '下一步' })).toBeEnabled())
}
async function reachReview() {
  await openWizard()
  change(/虚拟机名称/, 'App VM')
  next()
  change('ISO 镜像', 'iso-a')
  next()
  change('目标主机', 'host-a')
  next()
  next()
  await waitFor(() => expect(screen.getByLabelText('磁盘 1 大小')).toHaveValue(10))
  next()
  next()
  expect(screen.getByRole('button', { name: '创建虚拟机', exact: true })).toBeEnabled()
}

beforeEach(() => {
  vi.clearAllMocks()
  useConnectionManagerStore.setState({ connections: [{ id: 'pool-b', name: 'connection', poolName: 'Production Pool', state: 'connected' }] as any })
  window.xapi = { vm: {
    creationResources: vi.fn().mockResolvedValue(resources), list: vi.fn().mockResolvedValue([]),
    templates: vi.fn().mockResolvedValue({ system: [template], user: [] }),
    createFromTemplate: vi.fn().mockResolvedValue('new-vm'),
  } } as any
})

describe('VM creation through actual wizard steps', () => {
  it('returns from review to edit the name, preserves devices, and submits to the displayed pool', async () => {
    await reachReview()
    expect(screen.getByText('Production Pool')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '上一步' })).toBeEnabled()
    edit('名称')
    change(/虚拟机名称/, 'Renamed before creation')
    edit('确认')
    expect(screen.getByText('Renamed before creation')).toBeInTheDocument()
    expect(screen.getByText(/磁盘 1 \(设备 0\): 10 GiB · Local A/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '创建虚拟机', exact: true }))
    await waitFor(() => expect(window.xapi.vm.createFromTemplate).toHaveBeenCalledWith('pool-b', expect.objectContaining({
      vmName: 'Renamed before creation', targetHostRef: 'host-a', isoRef: 'iso-a',
      disks: [expect.objectContaining({ srRef: 'sr-a', sizeBytes: 10 * GIB })],
    })))
  })

  it('repairs incompatible resources after changing the target host without discarding devices', async () => {
    await reachReview()
    edit('存储')
    change('磁盘 1 大小', '20.5')
    edit('目标主机')
    change('目标主机', 'host-b')
    expect(screen.getByRole('status')).toHaveTextContent('磁盘大小和网卡设备保留')
    edit('确认')
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('请选择 ISO 镜像')
    expect(screen.getByRole('button', { name: '请先补充上述配置' })).toBeDisabled()
    expect(window.xapi.vm.createFromTemplate).not.toHaveBeenCalled()
    fireEvent.click(within(alert).getByRole('button', { name: '请选择 ISO 镜像' }))
    change('ISO 镜像', 'iso-b')
    edit('存储')
    expect(screen.getByLabelText('磁盘 1 大小')).toHaveValue(20.5)
    expect(screen.getByLabelText('磁盘 1 存储')).toHaveValue('')
    change('磁盘 1 存储', 'sr-b')
    edit('网络')
    change('Virtual Interface 0 网络', 'net-b')
    edit('确认')
    fireEvent.click(screen.getByRole('button', { name: '创建虚拟机', exact: true }))
    await waitFor(() => expect(window.xapi.vm.createFromTemplate).toHaveBeenCalledWith('pool-b', expect.objectContaining({
      targetHostRef: 'host-b', isoRef: 'iso-b', disks: [expect.objectContaining({ srRef: 'sr-b', sizeBytes: 20.5 * GIB })],
      vifs: [expect.objectContaining({ device: '0', networkRef: 'net-b' })],
    })))
  })

  it('blocks invalid compute values and lets users correct them in the same step', async () => {
    await openWizard()
    next(); change('ISO 镜像', 'iso-b'); next(); change('目标主机', 'host-b'); next()
    change('vCPUs', '1.5')
    expect(screen.getByRole('button', { name: '下一步' })).toBeDisabled()
    expect(screen.getByText('vCPU 数量必须是大于零的整数')).toBeInTheDocument()
    change('vCPUs', '8')
    expect(screen.getByRole('button', { name: '下一步' })).toBeDisabled()
    change('vCPUs', '4')
    change('Memory (GiB)', '0.5')
    expect(screen.getByRole('button', { name: '下一步' })).toBeDisabled()
    change('Memory (GiB)', '2')
    expect(screen.getByRole('button', { name: '下一步' })).toBeEnabled()
  })

  it('keeps disk device numbers unique when removing a middle disk and adding another', async () => {
    await reachReview()
    edit('存储')
    fireEvent.click(screen.getByRole('button', { name: '新增磁盘' }))
    fireEvent.click(screen.getByRole('button', { name: '新增磁盘' }))
    fireEvent.click(screen.getAllByRole('button', { name: '删除', exact: true })[1])
    fireEvent.click(screen.getByRole('button', { name: '新增磁盘' }))
    for (const select of screen.getAllByRole('combobox', { name: /磁盘 .* 存储/ })) fireEvent.change(select, { target: { value: 'sr-a' } })
    edit('确认')
    fireEvent.click(screen.getByRole('button', { name: '创建虚拟机', exact: true }))
    await waitFor(() => expect(window.xapi.vm.createFromTemplate).toHaveBeenCalled())
    const payload = vi.mocked(window.xapi.vm.createFromTemplate).mock.calls[0][1]
    expect(payload.disks.map((disk) => disk.device)).toEqual(['0', '2', '1'])
  })

  it('keeps review locked after an unknown creation outcome and does not resubmit', async () => {
    vi.mocked(window.xapi.vm.createFromTemplate).mockRejectedValue(Object.assign(new Error('创建结果未确认'), { code: 'VM_CREATE_OUTCOME_UNKNOWN' }))
    await reachReview()
    fireEvent.click(screen.getByRole('button', { name: '创建虚拟机', exact: true }))
    expect(await screen.findByText('创建结果未确认')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '无法获取创建结果' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '上一步' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '编辑名称', exact: true })).toBeDisabled()
    expect(window.xapi.vm.createFromTemplate).toHaveBeenCalledTimes(1)
  })

  it('waits for inherited template networking before allowing review and retries a failed mapping read', async () => {
    let resolveMapping!: (value: any) => void
    window.xapi.vm.getVIFs = vi.fn().mockReturnValueOnce(new Promise((resolve) => { resolveMapping = resolve }))
      .mockRejectedValueOnce(new Error('mapping unavailable')).mockResolvedValue([{ device: '4', network: 'net-b' }])
    const inherited = { ...template, is_default_template: false, other_config: {}, VIFs: ['template-vif'] }
    const view = render(<ToastProvider><CreateVmWizard open onClose={vi.fn()} onCreated={vi.fn()} connectionId="pool-b" initialTemplate={inherited} /></ToastProvider>)
    await waitFor(() => expect(window.xapi.vm.getVIFs).toHaveBeenCalledOnce())
    next(); next(); next()
    change('目标存储', 'sr-b'); next()
    expect(screen.getByText('正在读取模板网卡配置，请稍候')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '下一步' })).toBeDisabled()
    expect(screen.queryByLabelText('Virtual Interface 0 网络')).not.toBeInTheDocument()
    await act(async () => resolveMapping([{ device: '4', network: 'net-b' }]))
    expect(screen.getByLabelText('Virtual Interface 4 网络')).toHaveValue('net-b')
    next()
    expect(screen.getByText('Virtual Interface 4 · Guest B')).toBeInTheDocument()
    expect(screen.queryByText('Virtual Interface 0 · Guest A')).not.toBeInTheDocument()

    view.rerender(<ToastProvider><CreateVmWizard open onClose={vi.fn()} onCreated={vi.fn()} connectionId="pool-c" initialTemplate={inherited} /></ToastProvider>)
    expect(await screen.findByRole('alert')).toHaveTextContent('mapping unavailable')
    fireEvent.click(screen.getByRole('button', { name: '重新读取模板网卡' }))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    next(); next(); next(); change('目标存储', 'sr-b'); next(); next()
    fireEvent.click(screen.getByRole('button', { name: '创建虚拟机', exact: true }))
    await waitFor(() => expect(window.xapi.vm.createFromTemplate).toHaveBeenCalledWith('pool-c', expect.objectContaining({ vifs: [{ device: '4', networkRef: 'net-b', networkName: 'Guest B' }] })))
  })
  it('submits a PV URL repository and rounds decimal GiB inputs to integer bytes', async () => {
    const pv = { ...template, HVM_boot_policy: '', PV_bootloader: 'eliloader', other_config: { default_template: 'true', 'install-methods': 'http,nfs' } }
    render(<ToastProvider><CreateVmWizard open onClose={vi.fn()} onCreated={vi.fn()} connectionId="pool-b" initialTemplate={pv} /></ToastProvider>)
    await waitFor(() => expect(screen.getByRole('button', { name: '下一步' })).toBeEnabled())
    next()
    expect(screen.queryByText('PXE 网络启动')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '下一步' })).toBeDisabled()
    change('安装源 URL', 'http://server/install')
    next(); change('目标主机', 'host-a'); next()
    change('Memory (GiB)', '2.1'); next()
    change('磁盘 1 大小', '10.1'); next(); next()
    expect(screen.getByText('安装源 · http://server/install')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '创建虚拟机', exact: true }))
    await waitFor(() => expect(window.xapi.vm.createFromTemplate).toHaveBeenCalledWith('pool-b', expect.objectContaining({
      installMode: 'url', installUrl: 'http://server/install', memoryBytes: 2254857830,
      disks: [expect.objectContaining({ sizeBytes: 10844792422 })],
    })))
  })

  it('shows and retains inherited restrictions when deleting and readding the same VIF device', async () => {
    const policy = { MTU: 9000, qos_algorithm_type: 'ratelimit', qos_algorithm_params: { kbps: '1024' }, locking_mode: 'locked' as const, ipv4_allowed: ['192.0.2.1'], ipv6_allowed: [] }
    window.xapi.vm.getVIFs = vi.fn().mockResolvedValue([{ device: '0', network: 'net-a', policy }])
    const inherited = { ...template, is_default_template: false, other_config: {}, VIFs: ['template-vif'] }
    render(<ToastProvider><CreateVmWizard open onClose={vi.fn()} onCreated={vi.fn()} connectionId="pool-b" initialTemplate={inherited} /></ToastProvider>)
    await waitFor(() => expect(window.xapi.vm.getVIFs).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByRole('button', { name: '下一步' })).toBeEnabled())
    next(); next(); next(); change('目标存储', 'sr-a'); next()
    expect(screen.getByText(/保留模板策略：MTU 9000/)).toHaveTextContent('192.0.2.1')
    fireEvent.click(screen.getByRole('button', { name: '删除', exact: true }))
    fireEvent.click(screen.getByRole('button', { name: '新增虚拟网卡' }))
    change('Virtual Interface 0 网络', 'net-a'); next()
    expect(screen.getByText(/Virtual Interface 0 · Guest A/)).toHaveTextContent('QoS ratelimit kbps=1024')
    fireEvent.click(screen.getByRole('button', { name: '创建虚拟机', exact: true }))
    await waitFor(() => expect(window.xapi.vm.createFromTemplate).toHaveBeenCalledWith('pool-b', expect.objectContaining({ vifs: [expect.objectContaining({ policy })] })))
  })

  it('rejects stale template disk responses and retries a failed canonical plan read', async () => {
    let finishOld!: (value: any) => void
    const other = { ...template, ref: 'other-template', name_label: 'Other installer' }
    window.xapi.vm.creationResources = vi.fn().mockImplementation((_connectionId, ref) => ref === template.ref
      ? new Promise((resolve) => { finishOld = resolve }) : Promise.reject(new Error('plan unavailable')))
    const view = render(<ToastProvider><CreateVmWizard open onClose={vi.fn()} onCreated={vi.fn()} connectionId="pool-b" initialTemplate={template} /></ToastProvider>)
    await waitFor(() => expect(window.xapi.vm.creationResources).toHaveBeenCalledWith('pool-b', template.ref))
    view.rerender(<ToastProvider><CreateVmWizard open onClose={vi.fn()} onCreated={vi.fn()} connectionId="pool-b" initialTemplate={other} /></ToastProvider>)
    expect(await screen.findByRole('alert')).toHaveTextContent('plan unavailable')
    await act(async () => finishOld(resources))
    expect(screen.getByRole('button', { name: '下一步' })).toBeDisabled()
    vi.mocked(window.xapi.vm.creationResources).mockResolvedValue({ ...resources, templateDisks: [{ ...resources.templateDisks[0], sizeBytes: 6 * GIB }] })
    fireEvent.click(screen.getByRole('button', { name: '重新读取创建资源' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '下一步' })).toBeEnabled())
    next(); change('ISO 镜像', 'iso-a'); next(); next(); next()
    expect(screen.getByLabelText('磁盘 1 大小')).toHaveValue(6)
  })

})
