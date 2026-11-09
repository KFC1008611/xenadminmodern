import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { VdiListItem } from '../../src/renderer/src/components/vdi/VdiListItem'

const baseVdi = {
  ref: 'OpaqueRef:vdi',
  uuid: 'vdi-uuid',
  name_label: 'Root disk',
  virtual_size: 10737418240,
  physical_utilisation: 1073741824,
  type: 'user',
  SR: 'OpaqueRef:sr',
  read_only: false,
  vbdRef: 'OpaqueRef:vbd',
  userdevice: '0',
  bootable: true,
  mode: 'RW',
  currently_attached: true,
  unpluggable: true,
  allowed_operations: ['unplug'],
}

describe('VdiListItem', () => {
  it('enables VBD unplug for an attached disk on a running VM', () => {
    const onToggleAttached = vi.fn()

    render(
      <VdiListItem
        vdi={baseVdi}
        powerState="Running"
        onResize={vi.fn()}
        onMove={vi.fn()}
        onToggleAttached={onToggleAttached}
        onDetach={vi.fn()}
        onRemove={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByTitle('停用磁盘'))
    expect(onToggleAttached).toHaveBeenCalledTimes(1)
    expect(screen.getByTitle('请先停用磁盘后再分离')).toBeDisabled()
  })

  it('enables VBD plug for an inactive disk even when it is not unpluggable', () => {
    const onToggleAttached = vi.fn()

    render(
      <VdiListItem
        vdi={{
          ...baseVdi,
          currently_attached: false,
          unpluggable: false,
          allowed_operations: ['plug'],
        }}
        powerState="Running"
        onResize={vi.fn()}
        onMove={vi.fn()}
        onToggleAttached={onToggleAttached}
        onDetach={vi.fn()}
        onRemove={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByTitle('激活磁盘'))
    expect(onToggleAttached).toHaveBeenCalledTimes(1)
  })

  it('enables detach and deletion for an inactive disk on a halted VM', () => {
    const onDetach = vi.fn()
    const onRemove = vi.fn()

    render(
      <VdiListItem
        vdi={{ ...baseVdi, currently_attached: false, allowed_operations: [] }}
        powerState="Halted"
        onResize={vi.fn()}
        onMove={vi.fn()}
        onToggleAttached={vi.fn()}
        onDetach={onDetach}
        onRemove={onRemove}
      />,
    )

    fireEvent.click(screen.getByTitle('分离磁盘连接'))
    fireEvent.click(screen.getByRole('button', { name: '删除磁盘' }))

    expect(onDetach).toHaveBeenCalledTimes(1)
    expect(onRemove).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: '删除磁盘' })).toBeEnabled()
    expect(screen.getByTitle('只有运行中的 VM 支持磁盘激活/停用')).toBeDisabled()
  })
})
