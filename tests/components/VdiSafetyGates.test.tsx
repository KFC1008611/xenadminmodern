import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { VdiListItem } from '../../src/renderer/src/components/vdi/VdiListItem'
import { VdiMoveDialog } from '../../src/renderer/src/components/vdi/VdiMoveDialog'
import { VdiResizeDialog } from '../../src/renderer/src/components/vdi/VdiResizeDialog'
import { useConnectionManagerStore } from '../../src/renderer/src/store/connectionManager.store'

vi.mock('../../src/renderer/src/components/toast/useToast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}))

const vdi = {
  ref: 'OpaqueRef:vdi',
  uuid: 'vdi-uuid',
  name_label: 'Root disk',
  virtual_size: 10 * 1024 ** 3,
  physical_utilisation: 1024 ** 3,
  type: 'user',
  SR: 'OpaqueRef:sr-source',
  read_only: false,
  vbdRef: 'OpaqueRef:vbd',
  userdevice: '0',
  bootable: true,
  mode: 'RW',
  currently_attached: false,
  unpluggable: true,
  allowed_operations: ['resize', 'resize_online'],
}

describe('VDI safety gates', () => {
  beforeEach(() => {
    useConnectionManagerStore.setState({ connections: [{ id: 'conn-1', host: '127.0.0.1', state: 'connected', epoch: 1 }] as any })
    Object.assign(window.xapi, {
      storage: {
        listSrs: vi.fn().mockResolvedValue([
          {
            ref: 'OpaqueRef:sr-source',
            name_label: 'Source SR',
            physical_size: 100 * 1024 ** 3,
            physical_utilisation: 20 * 1024 ** 3,
          },
          {
            ref: 'OpaqueRef:sr-target',
            name_label: 'Target SR',
            physical_size: 100 * 1024 ** 3,
            physical_utilisation: 20 * 1024 ** 3,
          },
        ]),
        resizeVdi: vi.fn(),
        moveVdi: vi.fn(),
        getAllowedOperations: vi.fn().mockResolvedValue({ resize: true, onlineResize: true, create: true, destroy: true }),
      },
      tasks: { list: vi.fn().mockResolvedValue([]) },
    })
  })

  it('offers disk resize, move, and deletion for a stopped VM disk', () => {
    const onResize = vi.fn()
    const onMove = vi.fn()

    render(
      <VdiListItem
        vdi={vdi}
        powerState="Halted"
        onResize={onResize}
        onMove={onMove}
        onToggleAttached={vi.fn()}
        onDetach={vi.fn()}
        onRemove={vi.fn()}
      />,
    )

    const resizeButton = screen.getByTitle('扩容磁盘')
    const moveButton = screen.getByTitle('移动到 SR')
    const deleteButton = screen.getByRole('button', { name: '删除磁盘' })
    expect(resizeButton).toBeEnabled()
    expect(moveButton).toBeEnabled()
    expect(deleteButton).toBeEnabled()
    fireEvent.click(resizeButton)
    fireEvent.click(moveButton)
    expect(onResize).toHaveBeenCalledOnce()
    expect(onMove).toHaveBeenCalledOnce()
  })

  it('moves a disk to the selected target SR', async () => {
    const onMoved = vi.fn()
    vi.mocked(window.xapi.storage.moveVdi).mockResolvedValue({ newVdiRef: 'OpaqueRef:moved-vdi' })
    render(
      <VdiMoveDialog
        open
        connectionId="conn-1"
        vdi={vdi}
        onClose={vi.fn()}
        onMoved={onMoved}
      />,
    )

    await waitFor(() => expect(screen.getByRole('button', { name: '移动' })).toBeEnabled())
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription(/移动磁盘/)
    fireEvent.click(screen.getByRole('button', { name: '移动' }))
    await waitFor(() => expect(window.xapi.storage.moveVdi).toHaveBeenCalledWith('conn-1', {
      vdiRef: vdi.ref,
      targetSrRef: 'OpaqueRef:sr-target',
    }))
    await waitFor(() => expect(onMoved).toHaveBeenCalledOnce())
  })

  it('enables allowed resize and shows a percentage only after the server reports progress', async () => {
    let accept!: (ref: string) => void
    vi.mocked(window.xapi.storage.resizeVdi).mockReturnValueOnce(new Promise((resolve) => { accept = resolve }))
    vi.mocked(window.xapi.tasks.list).mockResolvedValueOnce([{ ref: 'OpaqueRef:resize-task', status: 'pending', progress: 0.37 }] as any)
    render(
      <VdiResizeDialog
        open
        connectionId="conn-1"
        vmRef="OpaqueRef:vm"
        vdi={vdi}
        powerState="Halted"
        onClose={vi.fn()}
        onResized={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByLabelText('New size value'), { target: { value: '20' } })
    await waitFor(() => expect(window.xapi.storage.getAllowedOperations).toHaveBeenCalledWith('conn-1', vdi.ref, 'OpaqueRef:vm'))
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription(/提交扩容操作/)
    const submitButton = screen.getByRole('button', { name: '确认扩容' })
    await waitFor(() => expect(submitButton).toBeEnabled())
    fireEvent.click(submitButton)
    expect(screen.getByRole('progressbar', { name: '磁盘扩容进度' })).not.toHaveAttribute('aria-valuenow')
    expect(screen.queryByText('0%')).not.toBeInTheDocument()
    await act(async () => { accept('OpaqueRef:resize-task') })
    await waitFor(() => expect(screen.getByRole('progressbar', { name: '磁盘扩容进度' })).toHaveAttribute('aria-valuenow', '37'))
  })
})
