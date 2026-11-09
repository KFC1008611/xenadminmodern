import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { VdiCreateDialog } from '../../src/renderer/src/components/vdi/VdiCreateDialog'
import { AddVifDialog } from '../../src/renderer/src/components/vm/AddVifDialog'
import { useConnectionManagerStore } from '../../src/renderer/src/store/connectionManager.store'

vi.mock('../../src/renderer/src/components/toast/useToast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }) }))

const GIB = 1073741824
const sr = (ref: string, type = 'ext') => ({ ref, uuid: ref, name_label: ref, type, physical_size: 100 * GIB, physical_utilisation: 0, virtual_allocation: 0, VDIs: [], shared: true, connectionId: 'pool-a', poolName: 'Pool' })
const network = { ref: 'OpaqueRef:network', uuid: 'network', name_label: 'Network', name_description: '', bridge: 'xenbr0', PIFs: [], VIFs: [], MTU: 1500, connectionId: 'pool-a', poolName: 'Pool' }

beforeEach(() => {
  vi.clearAllMocks()
  useConnectionManagerStore.setState({ connections: ['pool-a', 'pool-b'].map((id) => ({ id, host: '127.0.0.1', state: 'connected', epoch: 1 })) as any })
  window.xapi = {
    ...window.xapi,
    storage: { listSrs: vi.fn(), createForVm: vi.fn().mockResolvedValue({ vdiRef: 'OpaqueRef:vdi', vbdRef: 'OpaqueRef:vbd', plugged: false }) },
    vif: { create: vi.fn().mockResolvedValue({ vifRef: 'OpaqueRef:vif', plugged: false }) },
  } as any
})

describe('VM device dialogs', () => {
  it('excludes ISO/device repositories and selects a disk repository before creating', async () => {
    vi.mocked(window.xapi.storage.listSrs).mockResolvedValue([sr('ISO', 'iso'), sr('CD', 'udev'), sr('Disk')])
    render(<VdiCreateDialog open connectionId="pool-a" vmRef="OpaqueRef:vm" onClose={vi.fn()} onCreated={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText('磁盘名称'), { target: { value: 'New disk' } })
    await waitFor(() => expect(screen.getByLabelText('目标 SR')).toHaveValue('Disk'))
    expect(screen.queryByRole('option', { name: /ISO|CD/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '创建' }))
    await waitFor(() => expect(window.xapi.storage.createForVm).toHaveBeenCalledWith('pool-a', expect.objectContaining({ srRef: 'Disk' }), 'OpaqueRef:vm'))
  })

  it('shows SR failure and restores the selection after explicit retry', async () => {
    vi.mocked(window.xapi.storage.listSrs).mockRejectedValueOnce(new Error('read denied')).mockResolvedValueOnce([sr('Disk')])
    render(<VdiCreateDialog open connectionId="pool-a" vmRef="OpaqueRef:vm" onClose={vi.fn()} onCreated={vi.fn()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('read denied')
    expect(screen.getByRole('button', { name: '创建' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '重新读取存储仓库' }))
    await waitFor(() => expect(screen.getByLabelText('目标 SR')).toHaveValue('Disk'))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('does not reuse an older SR response after changing the VM pool', async () => {
    let finish!: (value: any) => void
    vi.mocked(window.xapi.storage.listSrs).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve })).mockResolvedValueOnce([sr('Current SR')])
    const props = { open: true, vmRef: 'OpaqueRef:vm', onClose: vi.fn(), onCreated: vi.fn() }
    const view = render(<VdiCreateDialog {...props} connectionId="pool-a" />)
    view.rerender(<VdiCreateDialog {...props} connectionId="pool-b" />)
    await waitFor(() => expect(screen.getByLabelText('目标 SR')).toHaveValue('Current SR'))
    await act(async () => finish([sr('Old SR')]))
    expect(screen.queryByRole('option', { name: /Old SR/ })).not.toBeInTheDocument()
  })

  it('rejects malformed MACs and a removed selected network before VIF creation', async () => {
    const props = { open: true, connectionId: 'pool-a', vmRef: 'OpaqueRef:vm', onClose: vi.fn(), onCreated: vi.fn() }
    const view = render(<AddVifDialog {...props} networks={[network]} />)
    fireEvent.change(screen.getByLabelText('网络'), { target: { value: network.ref } })
    fireEvent.change(screen.getByLabelText('MAC 地址'), { target: { value: 'invalid' } })
    expect(screen.getByRole('button', { name: '创建' })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('六组十六进制')
    fireEvent.change(screen.getByLabelText('MAC 地址'), { target: { value: '' } })
    expect(screen.getByRole('button', { name: '创建' })).toBeEnabled()
    view.rerender(<AddVifDialog {...props} networks={[]} />)
    expect(screen.getByRole('button', { name: '创建' })).toBeDisabled()
    expect(window.xapi.vif.create).not.toHaveBeenCalled()
  })

  it('uses a new request ID only after the original VIF has been confirmed deleted', async () => {
    vi.mocked(window.xapi.vif.create)
      .mockRejectedValueOnce(Object.assign(new Error('read temporarily failed'), { code: 'RESOURCE_RESULT_READ_FAILED' }))
      .mockRejectedValueOnce(Object.assign(new Error('original VIF deleted'), { code: 'VIF_CREATION_REMOVED' }))
      .mockResolvedValueOnce({ vifRef: 'OpaqueRef:new', plugged: false })
    render(<AddVifDialog open connectionId="pool-a" vmRef="OpaqueRef:vm" networks={[network]} onClose={vi.fn()} onCreated={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('网络'), { target: { value: network.ref } })
    fireEvent.click(screen.getByRole('button', { name: '创建' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '重新读取创建结果' })).toBeEnabled())
    expect(screen.getByLabelText('网络')).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '重新读取创建结果' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '创建' })).toBeEnabled())
    expect(screen.getByLabelText('网络')).toBeEnabled()
    const prior = vi.mocked(window.xapi.vif.create).mock.calls.map(([, params]) => params.requestId)
    expect(prior[0]).toBe(prior[1])
    fireEvent.click(screen.getByRole('button', { name: '创建' }))
    await waitFor(() => expect(window.xapi.vif.create).toHaveBeenCalledTimes(3))
    expect(vi.mocked(window.xapi.vif.create).mock.calls[2][1].requestId).not.toBe(prior[0])
  })
})
