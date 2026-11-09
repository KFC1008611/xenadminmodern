import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import Step1Template from '../../src/renderer/src/components/wizard/steps/Step1Template'
import Step3Cpu from '../../src/renderer/src/components/wizard/steps/Step3Cpu'
import Step4Disk from '../../src/renderer/src/components/wizard/steps/Step4Disk'
import Step5Network from '../../src/renderer/src/components/wizard/steps/Step5Network'
import Step6Review from '../../src/renderer/src/components/wizard/steps/Step6Review'
import StepInstallMedia from '../../src/renderer/src/components/wizard/steps/StepInstallMedia'
import StepPlacement from '../../src/renderer/src/components/wizard/steps/StepPlacement'
import type { VmRecord } from '../../src/renderer/src/types/xapi'

const GIB = 1073741824

function template(overrides: Partial<VmRecord> = {}): VmRecord {
  return {
    ref: 'OpaqueRef:template',
    uuid: 'template',
    name_label: 'Template',
    name_description: '',
    power_state: 'Halted',
    resident_on: 'OpaqueRef:NULL',
    VCPUs_max: 8,
    VCPUs_at_startup: 2,
    memory_static_min: GIB,
    memory_static_max: 4 * GIB,
    memory_dynamic_min: GIB,
    memory_dynamic_max: 2 * GIB,
    is_a_template: true,
    is_control_domain: false,
    VBDs: [],
    VIFs: [],
    metrics: 'OpaqueRef:NULL',
    guest_metrics: 'OpaqueRef:NULL',
    consoles: [],
    ...overrides,
  }
}

describe('Create VM wizard steps', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(window.xapi, {
      pool: {
        get: vi.fn().mockResolvedValue({ default_SR: 'OpaqueRef:default-sr' }),
      },
      storage: {
        listSrs: vi.fn().mockResolvedValue([
          {
            ref: 'OpaqueRef:default-sr',
            uuid: 'default-sr',
            name_label: 'Default SR',
            type: 'lvm',
            physical_size: 100 * GIB,
            physical_utilisation: 10 * GIB,
            virtual_allocation: 10 * GIB,
            VDIs: [],
            shared: true,
          },
        ]),
        listVdis: vi.fn().mockResolvedValue([]),
      },
      network: {
        list: vi.fn().mockResolvedValue([
          {
            ref: 'OpaqueRef:net',
            uuid: 'net',
            name_label: 'Pool network',
            name_description: '',
            bridge: 'xenbr0',
            PIFs: [],
            VIFs: [],
            MTU: 1500,
            other_config: {},
            connectionId: 'conn-1',
            poolName: 'Pool',
          },
        ]),
      },
    })
  })

  it('allows memory changes within template min and max instead of locking to current value', () => {
    const onChangeMemoryGib = vi.fn()

    render(
      <Step3Cpu
        template={template()}
        vcpus={2}
        memoryGib={2}
        maxVcpus={16}
        minMemoryGib={1}
        maxMemoryGib={8}
        onChangeVcpus={vi.fn()}
        onChangeMemoryGib={onChangeMemoryGib}
      />,
    )

    fireEvent.change(screen.getByLabelText('Memory (GiB)'), { target: { value: '3.5' } })

    expect(onChangeMemoryGib).toHaveBeenCalledWith(3.5)
    expect(screen.getByText('范围: 1.00 – 8.00 GiB')).toBeInTheDocument()
  })

  it('reports an out-of-range compute value without silently clamping it', () => {
    const onChangeVcpus = vi.fn()
    render(<Step3Cpu
      template={template()}
      vcpus={2}
      memoryGib={2}
      maxVcpus={8}
      minMemoryGib={1}
      maxMemoryGib={4}
      onChangeVcpus={onChangeVcpus}
      onChangeMemoryGib={vi.fn()}
    />)

    fireEvent.change(screen.getByLabelText('vCPUs'), { target: { value: '12' } })
    expect(onChangeVcpus).toHaveBeenCalledWith(12)
    expect(screen.getByText('vCPU 不能超过 8')).toBeInTheDocument()
  })

  it('uses the supplied canonical plan without reparsing XML or guessing storage', () => {
    const onChangeDisks = vi.fn()
    render(<Step4Disk templateKind="system" installMode="iso" template={template({ other_config: { disks: '<provision><disk device="0" size="1"/></provision>' } })}
      options={[]} targetHostRef="" disks={[{ templateVdiRef: '', srRef: '', sizeBytes: 10 * GIB, device: '0' }]} targetSrRef=""
      onChangeDisks={onChangeDisks} onChangeTargetSrRef={vi.fn()} />)
    expect(screen.getByLabelText('磁盘 1 存储')).toHaveValue('')
    expect(onChangeDisks).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('磁盘 1 大小'), { target: { value: '10.1' } })
    expect(onChangeDisks.mock.calls[0][0][0].sizeBytes).toBe(10844792422)
  })

  it('uses one target SR for a custom-template full copy', () => {
    const onChangeTargetSrRef = vi.fn()
    render(<Step4Disk
      templateKind="custom"
      installMode="none"
      template={template({ VBDs: ['OpaqueRef:vbd-a', 'OpaqueRef:vbd-b'] })}
      options={[{ ref: 'OpaqueRef:copy-sr', name: 'Copy SR', freeBytes: 90 * GIB, shared: true, hostRefs: ['OpaqueRef:host'] }]}
      targetHostRef=""
      disks={[{ templateVdiRef: 'OpaqueRef:disk', srRef: 'OpaqueRef:source', device: '0', sizeBytes: 10 * GIB }]}
      targetSrRef=""
      onChangeDisks={vi.fn()}
      onChangeTargetSrRef={onChangeTargetSrRef}
    />)

    expect(screen.getByText('完整复制模板的 1 块磁盘')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('目标存储'), { target: { value: 'OpaqueRef:copy-sr' } })
    expect(onChangeTargetSrRef).toHaveBeenCalledWith('OpaqueRef:copy-sr')
  })

  it('adds one default VIF when the template has no VIFs', async () => {
    const onChangeVifs = vi.fn()

    render(
      <Step5Network
        options={[{ ref: 'OpaqueRef:net', name: 'Pool network', hostRefs: ['OpaqueRef:host'], autoPlug: true }]}
        targetHostRef=""
        template={template({ VIFs: [], is_default_template: true })}
        vifs={[]}
        onChangeVifs={onChangeVifs}
      />,
    )

    await waitFor(() => {
      expect(onChangeVifs).toHaveBeenCalledWith([
        { device: '0', networkRef: 'OpaqueRef:net', networkName: 'Pool network' },
      ])
    })
  })

  it('keeps a user template without VIFs disconnected by default', () => {
    const onChangeVifs = vi.fn()
    render(<Step5Network
      options={[{ ref: 'OpaqueRef:net', name: 'Pool network', hostRefs: ['OpaqueRef:host'], autoPlug: true }]}
      targetHostRef=""
      template={template({ VIFs: [], is_default_template: false })}
      vifs={[]}
      onChangeVifs={onChangeVifs}
    />)
    expect(onChangeVifs).not.toHaveBeenCalled()
  })

  it('allows continuing without a virtual NIC when no networks are available', async () => {
    render(
      <Step5Network
        options={[]}
        targetHostRef=""
        template={template()}
        vifs={[]}
        onChangeVifs={vi.fn()}
      />,
    )

    expect(await screen.findByText('没有可用网络。您可以不配置虚拟网卡并继续下一步。')).toBeInTheDocument()
  })

  it('labels configured VM network devices as virtual NICs', async () => {
    render(
      <Step5Network
        options={[{ ref: 'OpaqueRef:net', name: 'Pool network', hostRefs: ['OpaqueRef:host'], autoPlug: true }]}
        targetHostRef=""
        template={template()}
        vifs={[{ device: '2', networkRef: 'OpaqueRef:net' }]}
        onChangeVifs={vi.fn()}
      />,
    )

    expect(await screen.findByText('Virtual Interface 2')).toBeInTheDocument()
  })

  it('labels empty VM networking as no virtual NICs in review', () => {
    render(<Step6Review
      wizardData={{
        templateRef: 'OpaqueRef:template',
        templateName: 'Template',
        vmName: 'VM',
        vmDescription: '',
        vcpus: 2,
        memoryGib: 2,
        templateKind: 'system',
        installMode: 'pxe',
        isoRef: '',
        targetHostRef: '',
        targetSrRef: '',
        startAfter: false,
        disks: [],
        vifs: [],
        resources: { hosts: [], srs: [], networks: [], isos: [] },
      }}
      isSubmitting={false}
      submitError={null}
      onChangeStartAfter={vi.fn()}
      onConfirm={vi.fn()}
    />)

    expect(screen.getByText('无虚拟网卡')).toBeInTheDocument()
  })

  it('reviews resolved installation, placement, storage, and network labels', () => {
    render(<Step6Review
      wizardData={{
        templateRef: 'OpaqueRef:template', templateName: 'Template', templateKind: 'system',
        vmName: 'VM', vmDescription: '', vcpus: 2, memoryGib: 2,
        installMode: 'iso', isoRef: 'OpaqueRef:iso', targetHostRef: 'OpaqueRef:host',
        targetSrRef: '', startAfter: false,
        disks: [{ templateVdiRef: '', srRef: 'OpaqueRef:sr', sizeBytes: GIB }],
        vifs: [{ device: '0', networkRef: 'OpaqueRef:network', networkName: 'Guest' }],
        resources: {
          hosts: [{ ref: 'OpaqueRef:host', name: 'Host A', enabled: true, memoryFree: 4 * GIB, cpuCount: 4 }],
          srs: [{ ref: 'OpaqueRef:sr', name: 'Shared SR', freeBytes: 10 * GIB, shared: true, hostRefs: ['OpaqueRef:host'] }],
          networks: [{ ref: 'OpaqueRef:network', name: 'Guest', hostRefs: ['OpaqueRef:host'], autoPlug: true }],
          isos: [{ ref: 'OpaqueRef:iso', name: 'linux.iso', srRef: 'OpaqueRef:iso-sr', hostRefs: ['OpaqueRef:host'] }],
        },
      }}
      isSubmitting={false}
      submitError={null}
      onChangeStartAfter={vi.fn()}
      onConfirm={vi.fn()}
    />)

    expect(screen.getByText('ISO · linux.iso')).toBeInTheDocument()
    expect(screen.getByText('Host A')).toBeInTheDocument()
    expect(screen.getByText(/Shared SR/)).toBeInTheDocument()
    expect(screen.getByText('Virtual Interface 0 · Guest')).toBeInTheDocument()
  })

  it('requires an ISO selection and filters images by the selected host', () => {
    const onChange = vi.fn()
    render(<StepInstallMedia
      mode="iso"
      isoRef=""
      supportedModes={['iso', 'pxe']}
      options={[
        { ref: 'OpaqueRef:iso-a', name: 'a.iso', srRef: 'OpaqueRef:iso-sr', hostRefs: ['OpaqueRef:host-a'] },
        { ref: 'OpaqueRef:iso-b', name: 'b.iso', srRef: 'OpaqueRef:iso-sr', hostRefs: ['OpaqueRef:host-b'] },
      ]}
      targetHostRef="OpaqueRef:host-a"
      onChange={onChange}
    />)

    expect(screen.getByText('a.iso')).toBeInTheDocument()
    expect(screen.queryByText('b.iso')).not.toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('PXE 网络启动'))
    expect(onChange).toHaveBeenCalledWith('pxe', '')
  })

  it('offers automatic placement and only enabled hosts', () => {
    const onChange = vi.fn()
    render(<StepPlacement
      targetHostRef=""
      hosts={[
        { ref: 'OpaqueRef:host-a', name: 'Host A', enabled: true, memoryFree: 10, cpuCount: 2 },
        { ref: 'OpaqueRef:host-b', name: 'Host B', enabled: false, memoryFree: 10, cpuCount: 2 },
      ]}
      onChange={onChange}
    />)

    expect(screen.getByRole('option', { name: '自动选择' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Host A/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Host B/ })).not.toBeInTheDocument()
  })

  it('autoplugs only compatible AutoPlug networks and supports add/remove', async () => {
    const onChangeVifs = vi.fn()
    render(<Step5Network
      options={[
        { ref: 'OpaqueRef:first', name: 'Manual', hostRefs: ['OpaqueRef:host-a'], autoPlug: false },
        { ref: 'OpaqueRef:auto', name: 'Guest', hostRefs: ['OpaqueRef:host-a'], autoPlug: true },
      ]}
      targetHostRef="OpaqueRef:host-a"
      template={template({ VIFs: [], is_default_template: true })}
      vifs={[]}
      onChangeVifs={onChangeVifs}
    />)

    await waitFor(() => expect(onChangeVifs).toHaveBeenCalledWith([
      { device: '0', networkRef: 'OpaqueRef:auto', networkName: 'Guest' },
    ]))
    expect(onChangeVifs).not.toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ networkRef: 'OpaqueRef:first' }),
    ]))
  })
  it('discards template responses from the previous pool and selects only the current template', async () => {
    let finish!: (value: any) => void
    window.xapi.vm = { ...window.xapi.vm, templates: vi.fn().mockImplementationOnce(() => new Promise((resolve) => { finish = resolve })).mockResolvedValueOnce({ user: [template({ name_label: 'Current pool template' })], system: [] }) }
    const onSelect = vi.fn()
    const view = render(<Step1Template connectionId="conn-a" selectedTemplateRef="" onSelect={onSelect} />)
    view.rerender(<Step1Template connectionId="conn-b" selectedTemplateRef="" onSelect={onSelect} />)
    expect(await screen.findByText('Current pool template')).toBeInTheDocument()
    await act(async () => finish({ user: [template({ name_label: 'Old pool template' })], system: [] }))
    expect(screen.queryByText('Old pool template')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Current pool template' }))
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ name_label: 'Current pool template' }))
  })

  it('clears a template read failure after retry without reopening the wizard', async () => {
    window.xapi.vm = { ...window.xapi.vm, templates: vi.fn().mockRejectedValueOnce(new Error('denied')).mockResolvedValueOnce({ user: [template()], system: [] }) }
    render(<Step1Template connectionId="conn-a" selectedTemplateRef="" onSelect={vi.fn()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('denied')
    fireEvent.click(screen.getByRole('button', { name: '重新读取模板' }))
    expect(await screen.findByText('Template')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

})
