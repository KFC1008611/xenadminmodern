import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DeleteVmDialog } from '../../src/renderer/src/components/vm/DeleteVmDialog'
import { useConnectionManagerStore } from '../../src/renderer/src/store/connectionManager.store'

vi.mock('../../src/renderer/src/components/toast/useToast', () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}))

const vm = {
  ref: 'OpaqueRef:vm1',
  name_label: 'Test VM',
  connectionId: 'conn-1',
  poolName: 'Pool',
}

describe('DeleteVmDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(window.xapi, {
      vm: {
        getVBDs: vi.fn().mockResolvedValue([
          {
            ref: 'OpaqueRef:vbd1',
            VDI: 'OpaqueRef:vdi1',
            userdevice: '0',
            type: 'Disk',
            owner: true,
            vdiName: 'Root disk',
            vdiSize: 20 * 1024 ** 3,
          },
          {
            ref: 'OpaqueRef:vbd2',
            VDI: 'OpaqueRef:vdi2',
            userdevice: '1',
            type: 'Disk',
            owner: true,
            vdiName: 'Data disk',
            vdiSize: 40 * 1024 ** 3,
          },
          {
            ref: 'OpaqueRef:vbd3',
            VDI: 'OpaqueRef:shared',
            userdevice: '2',
            type: 'Disk',
            owner: false,
            vdiName: 'Shared disk',
            vdiSize: 10 * 1024 ** 3,
          },
        ]),
        destroy: vi.fn().mockResolvedValue({ vmDeleted: true, failedVdiRefs: [] }),
      },
    })
  })

  it('selects owner disks for deletion by default', async () => {
    const onSuccess = vi.fn().mockResolvedValue(undefined)
    const onClose = vi.fn()

    render(
      <DeleteVmDialog
        open={true}
        onClose={onClose}
        vm={vm}
        onSuccess={onSuccess}
      />,
    )

    expect(await screen.findByRole('checkbox', { name: /Root disk/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /Data disk/ })).toBeChecked()
    expect(screen.queryByText('Shared disk')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '删除' }))

    await waitFor(() => {
      expect(window.xapi.vm.destroy).toHaveBeenCalledWith('conn-1', 'OpaqueRef:vm1', { vdiRefs: ['OpaqueRef:vdi1', 'OpaqueRef:vdi2'] })
    })
    expect(onSuccess).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('preserves disks explicitly unchecked by the user', async () => {
    render(
      <DeleteVmDialog
        open={true}
        onClose={vi.fn()}
        vm={vm}
        onSuccess={vi.fn()}
      />,
    )

    fireEvent.click(await screen.findByRole('checkbox', { name: /Data disk/ }))
    fireEvent.click(screen.getByRole('button', { name: '删除' }))

    await waitFor(() => {
      expect(window.xapi.vm.destroy).toHaveBeenCalledWith('conn-1', 'OpaqueRef:vm1', {
        vdiRefs: ['OpaqueRef:vdi1'],
      })
    })
  })

  it('reloads disks and restores default selection when reopened', async () => {
    const { rerender } = render(
      <DeleteVmDialog
        open={true}
        onClose={vi.fn()}
        vm={vm}
        onSuccess={vi.fn()}
      />,
    )

    fireEvent.click(await screen.findByRole('checkbox', { name: /Root disk/ }))
    expect(screen.getByRole('checkbox', { name: /Root disk/ })).not.toBeChecked()

    rerender(
      <DeleteVmDialog
        open={false}
        onClose={vi.fn()}
        vm={vm}
        onSuccess={vi.fn()}
      />,
    )
    rerender(
      <DeleteVmDialog
        open={true}
        onClose={vi.fn()}
        vm={vm}
        onSuccess={vi.fn()}
      />,
    )

    await waitFor(() => expect(window.xapi.vm.getVBDs).toHaveBeenCalledTimes(2))
    expect(await screen.findByRole('checkbox', { name: /Root disk/ })).toBeChecked()
  })

  it('blocks VM deletion when the disk list cannot be loaded', async () => {
    vi.mocked(window.xapi.vm.getVBDs).mockRejectedValueOnce(new Error('XAPI unavailable'))

    render(
      <DeleteVmDialog
        open={true}
        onClose={vi.fn()}
        vm={vm}
        onSuccess={vi.fn()}
      />,
    )

    expect(await screen.findByText(/加载磁盘失败/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '删除' })).toBeDisabled()
    expect(window.xapi.vm.destroy).not.toHaveBeenCalled()
  })

  it('leaves protected owner disks unchecked and explains why', async () => {
    vi.mocked(window.xapi.vm.getVBDs).mockResolvedValueOnce([{ VDI: 'OpaqueRef:protected', owner: true, vdiName: 'Shared owner disk', deleteReason: '共享磁盘，保留此磁盘' }] as any)
    render(<DeleteVmDialog open vm={vm} onClose={vi.fn()} onSuccess={vi.fn()} />)
    const checkbox = await screen.findByRole('checkbox', { name: /Shared owner disk/ })
    expect(checkbox).not.toBeChecked()
    expect(checkbox).toBeDisabled()
    expect(screen.getByText('共享磁盘，保留此磁盘')).toBeInTheDocument()
  })

  it('keeps a confirmed VM deletion visible when disk cleanup fails and prevents resubmission', async () => {
    vi.mocked(window.xapi.vm.destroy).mockResolvedValueOnce({ vmDeleted: true, failedVdiRefs: ['OpaqueRef:vdi1'] })
    const close = vi.fn()
    render(<DeleteVmDialog open vm={vm} onClose={close} onSuccess={vi.fn()} />)
    await screen.findByRole('checkbox', { name: /Root disk/ })
    fireEvent.click(screen.getByRole('button', { name: '删除', exact: true }))
    expect(await screen.findByText(/VM 已删除，但以下磁盘仍需清理/)).toHaveTextContent('OpaqueRef:vdi1')
    expect(screen.getByRole('button', { name: '删除', exact: true })).toBeDisabled()
    expect(close).not.toHaveBeenCalled()
  })

  it('separates refresh failure from confirmed deletion and prevents another delete', async () => {
    render(<DeleteVmDialog open vm={vm} onClose={vi.fn()} onSuccess={vi.fn().mockRejectedValue(new Error('refresh unavailable'))} />)
    await screen.findByRole('checkbox', { name: /Root disk/ })
    fireEvent.click(screen.getByRole('button', { name: '删除', exact: true }))
    expect(await screen.findByText(/VM 及所选磁盘已删除/)).toHaveTextContent('清单刷新失败：refresh unavailable')
    expect(screen.getByRole('button', { name: '删除', exact: true })).toBeDisabled()
    expect(window.xapi.vm.destroy).toHaveBeenCalledTimes(1)
  })

  it('freezes the pool identity when opened and blocks a replacement connection', async () => {
    useConnectionManagerStore.setState({ connections: [{ id: 'conn-1', state: 'connected', poolUuid: 'pool', epoch: 1 }] as any })
    render(<DeleteVmDialog open vm={{ ...vm, uuid: 'vm' }} onClose={vi.fn()} onSuccess={vi.fn()} />)
    await screen.findByRole('checkbox', { name: /Root disk/ })
    act(() => useConnectionManagerStore.setState({ connections: [{ id: 'conn-1', state: 'connected', poolUuid: 'pool', epoch: 2 }] as any }))
    expect(screen.getByRole('button', { name: '删除', exact: true })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('资源池连接已变化')
    expect(window.xapi.vm.destroy).not.toHaveBeenCalled()
  })
})
