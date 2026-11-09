import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VmIdentityDialog } from '../../src/renderer/src/components/vm/VmIdentityDialog'
import { VmMemoryDialog } from '../../src/renderer/src/components/vm/VmMemoryDialog'
import { MemoryTab } from '../../src/renderer/src/pages/vm-detail/MemoryTab'
import { OverviewTab } from '../../src/renderer/src/pages/vm-detail/OverviewTab'
import type { VmDetailRecord } from '../../src/shared/types/xapi'
import { GIB } from '../../src/shared/vm-memory'

vi.mock('../../src/renderer/src/store/feedback.store', () => ({ feedback: { success: vi.fn(), error: vi.fn() } }))
const vm: VmDetailRecord = {
  ref: 'OpaqueRef:vm', uuid: 'uuid', name_label: 'web-server', name_description: '生产 Web 服务',
  power_state: 'Running', resident_on: 'OpaqueRef:host', VCPUs_max: 2, VCPUs_at_startup: 2,
  memory_static_min: GIB / 4, memory_dynamic_min: GIB, memory_dynamic_max: 2 * GIB,
  memory_static_max: 4 * GIB, memory_actual: 1.5 * GIB,
  is_a_template: false, is_control_domain: false, is_a_snapshot: false, VBDs: [], VIFs: [],
  metrics: 'OpaqueRef:metrics', guest_metrics: 'OpaqueRef:NULL', consoles: [], os_version: {}, networks: {},
  allowed_operations: ['changing_dynamic_range', 'changing_memory_limits'], current_operations: {},
}
let current: VmDetailRecord
const onClose = vi.fn()
const onUpdated = vi.fn()
const api = {
  getRecord: vi.fn(), setNameLabel: vi.fn(), setNameDescription: vi.fn(), setMemoryLimits: vi.fn(), setVcpus: vi.fn(),
  getVBDs: vi.fn().mockResolvedValue([]), getVIFs: vi.fn().mockResolvedValue([]),
}
const props = () => ({ vm: current, connectionId: 'pool-a', onClose, onUpdated })
const change = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
const save = () => fireEvent.click(screen.getByRole('button', { name: '保存更改' }))
beforeEach(() => {
  vi.clearAllMocks()
  current = { ...vm }
  api.getRecord.mockReset().mockImplementation(async () => ({ ...current }))
  api.setNameLabel.mockReset().mockImplementation(async (_pool, _ref, name) => { current = { ...current, name_label: name } })
  api.setNameDescription.mockReset().mockImplementation(async (_pool, _ref, description) => { current = { ...current, name_description: description } })
  api.setMemoryLimits.mockReset().mockImplementation(async (_pool, _ref, sMin, dMin, dMax, sMax) => {
    current = { ...current, memory_static_min: sMin, memory_dynamic_min: dMin, memory_dynamic_max: dMax, memory_static_max: sMax }
  })
  Object.assign(window.xapi, { vm: api })
})
afterEach(cleanup)

describe('VM identity editing', () => {
  it('renames a running VM and submits only the changed field', async () => {
    render(<VmIdentityDialog {...props()} />)
    change('虚拟机名称', '  api-server  ')
    save()
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    expect(api.setNameLabel).toHaveBeenCalledWith('pool-a', vm.ref, 'api-server')
    expect(api.setNameDescription).not.toHaveBeenCalled()
    expect(api.setVcpus).not.toHaveBeenCalled()
    expect(api.setMemoryLimits).not.toHaveBeenCalled()
    expect(onUpdated).toHaveBeenCalledWith(expect.objectContaining({ name_label: 'api-server' }))
  })
  it('disables unchanged and whitespace-only names', () => {
    render(<VmIdentityDialog {...props()} />)
    expect(screen.getByRole('button', { name: '保存更改' })).toBeDisabled()
    change('虚拟机名称', '   ')
    expect(screen.getByRole('button', { name: '保存更改' })).toBeDisabled()
    expect(api.setNameLabel).not.toHaveBeenCalled()
  })
  it('allows clearing the description without renaming', async () => {
    render(<VmIdentityDialog {...props()} />)
    change('简介 （可选）', '')
    save()
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    expect(api.setNameDescription).toHaveBeenCalledWith('pool-a', vm.ref, '')
    expect(api.setNameLabel).not.toHaveBeenCalled()
  })
  it('preserves the draft when a VM event refreshes unrelated fields', () => {
    const view = render(<VmIdentityDialog {...props()} />)
    change('虚拟机名称', 'draft-name')
    view.rerender(<VmIdentityDialog {...props()} vm={{ ...current, memory_actual: 2 * GIB }} />)
    expect(screen.getByLabelText('虚拟机名称')).toHaveValue('draft-name')
  })
  it('reports partial save and retries only the outstanding description', async () => {
    api.setNameDescription.mockRejectedValueOnce(new Error('权限不足'))
    render(<VmIdentityDialog {...props()} />)
    change('虚拟机名称', 'api-server')
    change('简介 （可选）', '新简介')
    save()
    expect(await screen.findByRole('alert')).toHaveTextContent('名称已生效')
    expect(onClose).not.toHaveBeenCalled()
    save()
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    expect(api.setNameLabel).toHaveBeenCalledTimes(1)
    expect(api.setNameDescription).toHaveBeenCalledTimes(2)
  })
  it('does not overwrite a concurrent rename', async () => {
    render(<VmIdentityDialog {...props()} />)
    change('虚拟机名称', 'my-name')
    current = { ...current, name_label: 'other-name' }
    save()
    expect(await screen.findByRole('alert')).toHaveTextContent('其他操作修改')
    expect(api.setNameLabel).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '保存更改' })).toBeDisabled()
  })
  it('prevents duplicate submission and closing while saving', async () => {
    let finish!: () => void
    api.setNameLabel.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = () => { current = { ...current, name_label: 'new-name' }; resolve() } }))
    render(<VmIdentityDialog {...props()} />)
    change('虚拟机名称', 'new-name')
    save()
    await waitFor(() => expect(api.setNameLabel).toHaveBeenCalledOnce())
    expect(screen.getByRole('button', { name: '保存中…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '取消' })).toBeDisabled()
    await act(async () => finish())
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  })
  it('does not claim success or allow retry when the save result cannot be read', async () => {
    render(<VmIdentityDialog {...props()} />)
    change('虚拟机名称', 'new-name')
    api.getRecord.mockResolvedValueOnce({ ...current }).mockRejectedValue(new Error('连接断开'))
    save()
    expect(await screen.findByRole('alert', {}, { timeout: 3500 })).toHaveTextContent('无法获取保存结果')
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '保存更改' })).toBeDisabled()
  })
  it('reports a confirmed applied field accurately after a transient readback failure', async () => {
    render(<VmIdentityDialog {...props()} />)
    change('虚拟机名称', 'new-name')
    api.getRecord.mockResolvedValueOnce({ ...current }).mockRejectedValueOnce(new Error('暂时断开'))
    save()
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce(), { timeout: 2000 })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(api.setNameLabel).toHaveBeenCalledOnce()
  })
})

describe('VM memory editing', () => {
  it('edits fractional fixed memory without rounding or changing the static minimum', async () => {
    current = { ...vm, power_state: 'Halted', memory_dynamic_min: GIB / 2, memory_dynamic_max: GIB / 2, memory_static_max: GIB / 2 }
    render(<VmMemoryDialog {...props()} />)
    expect(screen.getByLabelText('分配内存')).toHaveValue(0.5)
    change('分配内存', '0.75')
    save()
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    expect(api.setMemoryLimits).toHaveBeenCalledWith('pool-a', vm.ref, GIB / 4, 0.75 * GIB, 0.75 * GIB, 0.75 * GIB)
  })
  it('allows live dynamic edits within the unchanged startup limits', async () => {
    render(<VmMemoryDialog {...props()} />)
    expect(screen.queryByLabelText('启动内存上限')).not.toBeInTheDocument()
    change('动态上限', '3')
    save()
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    expect(api.setMemoryLimits).toHaveBeenCalledWith('pool-a', vm.ref, GIB / 4, GIB, 3 * GIB, 4 * GIB)
  })
  it('edits a stopped VM dynamic range and startup maximum independently', async () => {
    current = { ...current, power_state: 'Halted' }
    render(<VmMemoryDialog {...props()} />)
    change('动态下限', '0.5')
    change('动态上限', '3')
    change('启动内存上限', '6')
    save()
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    expect(api.setMemoryLimits).toHaveBeenCalledWith('pool-a', vm.ref, GIB / 4, GIB / 2, 3 * GIB, 6 * GIB)
  })
  it.each(['0', '', '5'])('rejects an invalid or out-of-order dynamic minimum (%s)', (value) => {
    render(<VmMemoryDialog {...props()} />)
    change('动态下限', value)
    expect(screen.getByRole('button', { name: '保存更改' })).toBeDisabled()
    expect(api.setMemoryLimits).not.toHaveBeenCalled()
  })
  it('prevents a live change outside the startup limit', () => {
    render(<VmMemoryDialog {...props()} />)
    change('动态上限', '6')
    expect(screen.getByRole('button', { name: '保存更改' })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('启动上限')
  })
  it('keeps an unchanged memory configuration disabled', () => {
    render(<VmMemoryDialog {...props()} />)
    expect(screen.getByRole('button', { name: '保存更改' })).toBeDisabled()
  })
  it('preserves a fixed VM startup headroom when no field has changed', () => {
    current = { ...vm, power_state: 'Halted', memory_dynamic_min: GIB, memory_dynamic_max: GIB, memory_static_max: 4 * GIB }
    render(<VmMemoryDialog {...props()} />)
    expect(screen.getByLabelText('分配内存')).toHaveValue(1)
    expect(screen.getByRole('button', { name: '保存更改' })).toBeDisabled()
    expect(api.setMemoryLimits).not.toHaveBeenCalled()
  })
  it('rechecks a changed power state before submission', async () => {
    current = { ...current, power_state: 'Halted' }
    render(<VmMemoryDialog {...props()} />)
    change('启动内存上限', '6')
    current = { ...current, power_state: 'Running' }
    save()
    expect(await screen.findByRole('alert')).toHaveTextContent('关闭虚拟机')
    expect(api.setMemoryLimits).not.toHaveBeenCalled()
  })
  it('keeps an unsuccessful readback open and prevents blind retry', async () => {
    api.setMemoryLimits.mockResolvedValueOnce(undefined) // Simulate acknowledged call with no applied change.
    render(<VmMemoryDialog {...props()} />)
    change('动态上限', '3')
    save()
    expect(await screen.findByRole('alert')).toHaveTextContent('读回')
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '保存更改' })).toBeDisabled()
  })
  it('finishes automatically when a lost memory response is followed by the requested configuration', async () => {
    api.setMemoryLimits.mockImplementationOnce(async (_pool, _ref, sMin, dMin, dMax, sMax) => {
      current = { ...current, memory_static_min: sMin, memory_dynamic_min: dMin, memory_dynamic_max: dMax, memory_static_max: sMax }
      throw new Error('response lost')
    })
    render(<VmMemoryDialog {...props()} />)
    change('动态上限', '3')
    save()
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    expect(api.setMemoryLimits).toHaveBeenCalledOnce()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
  it('preserves drafts across allocation updates', () => {
    const view = render(<VmMemoryDialog {...props()} />)
    change('动态上限', '3')
    view.rerender(<VmMemoryDialog {...props()} vm={{ ...current, memory_actual: 2 * GIB }} />)
    expect(screen.getByLabelText('动态上限')).toHaveValue(3)
  })
  it('does not submit over a concurrently changed memory configuration', async () => {
    render(<VmMemoryDialog {...props()} />)
    change('动态上限', '3')
    current = { ...current, memory_dynamic_max: 2.5 * GIB }
    save()
    expect(await screen.findByRole('alert')).toHaveTextContent('其他操作修改')
    expect(api.setMemoryLimits).not.toHaveBeenCalled()
  })
})

describe('VM configuration display', () => {
  it('shows actual allocation separately from configured limits', () => {
    render(<MemoryTab vm={vm} connectionId="pool-a" onUpdated={onUpdated} />)
    expect(screen.getByText('1.5 GiB')).toBeInTheDocument()
    expect(screen.getByText('当前分配')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '调整内存' })).toBeEnabled()
  })
  it('shows missing metrics and suspended edit restrictions explicitly', () => {
    render(<MemoryTab vm={{ ...vm, power_state: 'Suspended', memory_actual: undefined }} connectionId="pool-a" onUpdated={onUpdated} />)
    expect(screen.getByText('暂不可用')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '调整内存' })).toBeDisabled()
  })
  it('distinguishes a reported zero allocation from unavailable metrics', () => {
    render(<MemoryTab vm={{ ...vm, memory_actual: 0 }} connectionId="pool-a" onUpdated={onUpdated} />)
    expect(screen.getByText('0 B')).toBeInTheDocument()
    expect(screen.queryByText('暂不可用')).not.toBeInTheDocument()
  })
  it('allows halted static changes when only changing_memory_limits is available', () => {
    render(<MemoryTab vm={{ ...vm, power_state: 'Halted', allowed_operations: ['changing_memory_limits'] }} connectionId="pool-a" onUpdated={onUpdated} />)
    expect(screen.getByRole('button', { name: '调整内存' })).toBeEnabled()
  })
  it('shows full metadata and dynamic allocation in the overview of a running VM', async () => {
    render(<OverviewTab vm={vm} connectionId="pool-a" networks={[]} onUpdated={onUpdated} onEditIdentity={onClose} onViewMemory={onClose} />)
    expect(screen.getByText(vm.name_description)).toBeInTheDocument()
    expect(screen.getByText('1 GiB – 2 GiB')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '编辑名称和简介' }))
    expect(onClose).toHaveBeenCalledOnce()
    await waitFor(() => expect(api.getVBDs).toHaveBeenCalled())
  })
  it('distinguishes failed device reads from an empty VM', async () => {
    api.getVBDs.mockRejectedValueOnce(new Error('disk read denied'))
    api.getVIFs.mockRejectedValueOnce(new Error('network read denied'))
    render(<OverviewTab vm={vm} connectionId="pool-a" networks={[]} onUpdated={onUpdated} />)
    await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(2))
    expect(screen.queryByText('无存储设备')).not.toBeInTheDocument()
    expect(screen.queryByText('无虚拟网卡')).not.toBeInTheDocument()
  })

  it('can raise startup VCPUs to the existing maximum and states both values', async () => {
    render(<OverviewTab vm={{ ...vm, power_state: 'Halted', VCPUs_at_startup: 2, VCPUs_max: 8 }} connectionId="pool-a" networks={[]} onUpdated={onUpdated} />)
    expect(screen.getByText('启动 2 / 最大 8')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '编辑 vCPU' }))
    expect(screen.getByRole('button', { name: '保存' })).toBeEnabled()
    expect(screen.getByText(/同时修改启动数量和最大数量/)).toBeInTheDocument()
    await waitFor(() => expect(api.getVBDs).toHaveBeenCalled())
  })

})
