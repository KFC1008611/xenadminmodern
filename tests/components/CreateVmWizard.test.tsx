import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CreateVmWizard } from '../../src/renderer/src/components/wizard/CreateVmWizard'
import type { VmRecord } from '../../src/renderer/src/types/xapi'

const GIB = 1073741824

vi.mock('../../src/renderer/src/components/toast/useToast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}))

function template(kind: 'system' | 'custom'): VmRecord {
  return {
    ref: `OpaqueRef:${kind}`,
    uuid: kind,
    name_label: kind === 'system' ? 'Linux Template' : 'Golden VM',
    name_description: '', power_state: 'Halted', resident_on: 'OpaqueRef:NULL',
    VCPUs_max: 2, VCPUs_at_startup: 2, memory_static_min: GIB,
    memory_static_max: 2 * GIB, memory_dynamic_min: GIB, memory_dynamic_max: 2 * GIB,
    HVM_boot_policy: 'BIOS order',
    is_a_template: true, is_default_template: kind === 'system', is_control_domain: false,
    VBDs: ['OpaqueRef:vbd'], VIFs: [], metrics: 'OpaqueRef:NULL', guest_metrics: 'OpaqueRef:NULL', consoles: [],
    other_config: kind === 'system'
      ? { default_template: 'true', 'install-methods': 'cdrom,nfs', disks: `<provision><disk device="0" size="${10 * GIB}" /></provision>` }
      : {},
  }
}

vi.mock('../../src/renderer/src/components/wizard/steps/Step1Template', () => ({
  default: ({ onSelect }: { onSelect: (value: VmRecord) => void }) => (
    <div>
      <button onClick={() => onSelect(template('system'))}>选择系统模板</button>
      <button onClick={() => onSelect(template('custom'))}>选择自定义模板</button>
    </div>
  ),
}))

vi.mock('../../src/renderer/src/components/wizard/steps/Step2Name', () => ({
  default: ({ onChange, defaultName }: any) => <div><span>{defaultName}</span><button onClick={() => onChange('vmName', 'Edited VM')}>编辑名称</button></div>,
}))
vi.mock('../../src/renderer/src/components/wizard/steps/StepInstallMedia', () => ({
  default: ({ onChange }: any) => <button onClick={() => onChange('iso', 'OpaqueRef:iso')}>选择 ISO</button>,
}))
vi.mock('../../src/renderer/src/components/wizard/steps/StepPlacement', () => ({
  default: ({ onChange }: any) => <button onClick={() => onChange('OpaqueRef:host')}>选择主机</button>,
}))
vi.mock('../../src/renderer/src/components/wizard/steps/Step3Cpu', () => ({
  default: ({ onChangeVcpus, onChangeMemoryGib }: any) => (
    <button onClick={() => { onChangeVcpus(4); onChangeMemoryGib(4) }}>设置计算资源</button>
  ),
}))
vi.mock('../../src/renderer/src/components/wizard/steps/Step4Disk', () => ({
  default: ({ onChangeDisks, onChangeTargetSrRef }: any) => (
    <button onClick={() => {
      onChangeDisks([{ templateVdiRef: '', srRef: 'OpaqueRef:sr', sizeBytes: 20 * GIB, device: '0' }])
      onChangeTargetSrRef('OpaqueRef:sr')
    }}>设置存储</button>
  ),
}))
vi.mock('../../src/renderer/src/components/wizard/steps/Step5Network', () => ({
  default: ({ onChangeVifs }: any) => (
    <button onClick={() => onChangeVifs([{ device: '0', networkRef: 'OpaqueRef:network', networkName: 'Guest' }])}>设置网络</button>
  ),
}))
vi.mock('../../src/renderer/src/components/wizard/steps/Step6Review', () => ({
  default: ({ onConfirm, showSubmit = true }: any) => showSubmit ? <button onClick={onConfirm}>创建虚拟机</button> : null,
}))

const resources = {
  templateDisks: [{ templateVdiRef: '', device: '0', srRef: 'OpaqueRef:sr', sizeBytes: 10 * GIB, bootable: true }],
  templateCdCount: 0,
  hosts: [{ ref: 'OpaqueRef:host', name: 'Host', enabled: true, memoryFree: 8 * GIB, cpuCount: 8 }],
  srs: [{ ref: 'OpaqueRef:sr', name: 'Shared SR', freeBytes: 100 * GIB, shared: true, hostRefs: ['OpaqueRef:host'] }],
  networks: [{ ref: 'OpaqueRef:network', name: 'Guest', hostRefs: ['OpaqueRef:host'], autoPlug: true }],
  isos: [{ ref: 'OpaqueRef:iso', name: 'linux.iso', srRef: 'OpaqueRef:iso-sr', hostRefs: ['OpaqueRef:host'] }],
}

describe('CreateVmWizard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.xapi = {
      vm: {
        creationResources: vi.fn().mockResolvedValue(resources),
        createFromTemplate: vi.fn().mockResolvedValue('OpaqueRef:new-vm'),
        list: vi.fn().mockResolvedValue([]),
      },
    } as any
  })

  it('derives exact system and custom step labels from the template kind', async () => {
    const { rerender } = render(<CreateVmWizard open onClose={vi.fn()} onCreated={vi.fn()} connectionId="conn" initialTemplate={template('system')} />)
    await waitFor(() => expect(screen.getByRole('button', { name: '下一步' })).toBeEnabled())
    expect(screen.getByText('安装方式')).toBeInTheDocument()
    expect(screen.getByText('目标主机')).toBeInTheDocument()

    rerender(<CreateVmWizard open onClose={vi.fn()} onCreated={vi.fn()} connectionId="conn" initialTemplate={template('custom')} />)
    await waitFor(() => expect(screen.getByText('Golden VM')).toBeInTheDocument())
    expect(screen.queryByText('安装方式')).not.toBeInTheDocument()
  })

  it('blocks navigation while creation resources are loading', () => {
    vi.mocked(window.xapi.vm.creationResources).mockReturnValue(new Promise(() => {}))
    render(<CreateVmWizard open onClose={vi.fn()} onCreated={vi.fn()} connectionId="conn" initialTemplate={template('system')} />)
    expect(screen.getByRole('button', { name: '下一步' })).toBeDisabled()
    expect(screen.getByText('正在加载可用主机、存储、网络和 ISO...')).toBeInTheDocument()
  })

  it('submits a fully validated system-template payload', async () => {
    const onCreated = vi.fn()
    render(<CreateVmWizard open onClose={vi.fn()} onCreated={onCreated} connectionId="conn" initialTemplate={template('system')} />)
    await waitFor(() => expect(screen.getByRole('button', { name: '下一步' })).toBeEnabled())

    fireEvent.click(screen.getByText('编辑名称'))
    fireEvent.click(screen.getByText('下一步'))
    fireEvent.click(screen.getByText('选择 ISO'))
    fireEvent.click(screen.getByText('下一步'))
    fireEvent.click(screen.getByText('选择主机'))
    fireEvent.click(screen.getByText('下一步'))
    fireEvent.click(screen.getByText('设置计算资源'))
    fireEvent.click(screen.getByText('下一步'))
    fireEvent.click(screen.getByText('设置存储'))
    fireEvent.click(screen.getByText('下一步'))
    fireEvent.click(screen.getByText('设置网络'))
    fireEvent.click(screen.getByText('下一步'))
    fireEvent.click(screen.getByText('创建虚拟机'))

    await waitFor(() => expect(window.xapi.vm.createFromTemplate).toHaveBeenCalledWith('conn', {
      templateRef: 'OpaqueRef:system', vmName: 'Edited VM', vmDescription: '', vcpus: 4,
      memoryBytes: 4 * GIB, installMode: 'iso', isoRef: 'OpaqueRef:iso',
      targetHostRef: 'OpaqueRef:host', targetSrRef: 'OpaqueRef:sr',
      disks: [{ templateVdiRef: '', srRef: 'OpaqueRef:sr', sizeBytes: 20 * GIB, device: '0' }],
      vifs: [{ device: '0', networkRef: 'OpaqueRef:network', networkName: 'Guest' }],
      startAfter: false,
    }))
    expect(onCreated).toHaveBeenCalledWith('OpaqueRef:new-vm')
  })

  it('normalizes XAPI numeric strings before submitting template defaults', async () => {
    const xapiTemplate = {
      ...template('custom'),
      VCPUs_at_startup: '2' as any,
      memory_dynamic_max: String(2 * GIB) as any,
    }
    render(<CreateVmWizard open onClose={vi.fn()} onCreated={vi.fn()} connectionId="conn" initialTemplate={xapiTemplate} />)
    await waitFor(() => expect(screen.getByRole('button', { name: '下一步' })).toBeEnabled())

    fireEvent.click(screen.getByText('下一步'))
    fireEvent.click(screen.getByText('选择主机'))
    fireEvent.click(screen.getByText('下一步'))
    fireEvent.click(screen.getByText('下一步'))
    fireEvent.click(screen.getByText('设置存储'))
    fireEvent.click(screen.getByText('下一步'))
    fireEvent.click(screen.getByText('下一步'))
    fireEvent.click(screen.getByText('创建虚拟机'))

    await waitFor(() => expect(window.xapi.vm.createFromTemplate).toHaveBeenCalledWith(
      'conn',
      expect.objectContaining({ vcpus: 2, memoryBytes: 2 * GIB }),
    ))
  })
})
