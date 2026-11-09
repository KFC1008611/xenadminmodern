import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DeleteTemplateDialog } from '../../src/renderer/src/components/template/DeleteTemplateDialog'
import { SnapshotsTab } from '../../src/renderer/src/pages/vm-detail/SnapshotsTab'

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('../../src/renderer/src/components/toast/useToast', () => ({ useToast: () => toast }))

const template = { ref: 'OpaqueRef:template', name_label: 'template', connectionId: 'conn-1' }

describe('template and snapshot deletion safety gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.xapi = {
      ...window.xapi,
      vm: {
        ...window.xapi?.vm,
        getSnapshots: vi.fn(),
        deleteSnapshot: vi.fn().mockResolvedValue({ vmDeleted: true, failedVdiRefs: [] }),
      },
    } as any
  })

  it('allows deleting a user template while retaining associated disks', async () => {
    const onSuccess = vi.fn()
    window.xapi.template = { ...window.xapi.template, delete: vi.fn().mockResolvedValue({ vmDeleted: true, failedVdiRefs: [] }) } as any
    render(
      <DeleteTemplateDialog
        open
        onClose={vi.fn()}
        onSuccess={onSuccess}
        template={{
          ref: 'OpaqueRef:template',
          name_label: 'template',
          connectionId: 'conn-1',
        }}
      />,
    )

    expect(screen.getByRole('checkbox', { name: '同时删除所属硬盘' })).not.toBeChecked()
    expect(screen.getByText(/关联硬盘会保留/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    await waitFor(() => expect(window.xapi.template.delete).toHaveBeenCalledWith('conn-1', {
      templateRef: 'OpaqueRef:template', deleteDisks: false,
    }))
    expect(onSuccess).toHaveBeenCalledOnce()
  })

  it('deletes owned disks only after opting in and prevents duplicate submission or closing while busy', async () => {
    let finish!: (result: any) => void
    window.xapi.template = { ...window.xapi.template, delete: vi.fn(() => new Promise((resolve) => { finish = resolve })) } as any
    const onClose = vi.fn()
    render(<DeleteTemplateDialog open onClose={onClose} onSuccess={vi.fn()} template={template} />)
    fireEvent.click(screen.getByRole('checkbox', { name: '同时删除所属硬盘' }))
    expect(screen.getByText(/无法恢复/)).toHaveTextContent('共享、只读或归属不明的硬盘会保留')
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    fireEvent.click(screen.getByRole('button', { name: '删除中...' }))
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('checkbox')).toBeDisabled()
    expect(window.xapi.template.delete).toHaveBeenCalledOnce()
    expect(window.xapi.template.delete).toHaveBeenCalledWith('conn-1', { templateRef: template.ref, deleteDisks: true })
    await act(async () => finish({ vmDeleted: true, failedVdiRefs: [] }))
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('所属硬盘已清理'))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('keeps partial cleanup visible and prevents deleting an already deleted template again', async () => {
    window.xapi.template = { ...window.xapi.template, delete: vi.fn().mockResolvedValue({ vmDeleted: true, failedVdiRefs: ['OpaqueRef:retained'] }) } as any
    const onClose = vi.fn()
    const onSuccess = vi.fn()
    render(<DeleteTemplateDialog open onClose={onClose} onSuccess={onSuccess} template={template} />)
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('模板已删除')
    expect(screen.getByRole('alert')).toHaveTextContent('OpaqueRef:retained')
    expect(screen.getByRole('button', { name: '已删除' })).toBeDisabled()
    expect(toast.success).not.toHaveBeenCalled()
    expect(onSuccess).toHaveBeenCalledOnce()
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getAllByRole('button', { name: '关闭', exact: true })[1])
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('reports refresh failures separately from the confirmed template deletion', async () => {
    window.xapi.template = { ...window.xapi.template, delete: vi.fn().mockResolvedValue({ vmDeleted: true, failedVdiRefs: [] }) } as any
    render(<DeleteTemplateDialog open onClose={vi.fn()} onSuccess={vi.fn().mockRejectedValue(new Error('list denied'))} template={template} />)
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('模板已删除，硬盘保留。清单刷新失败：list denied')
    expect(screen.getByRole('button', { name: '已删除' })).toBeDisabled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('contains request errors and requires a fresh dialog before another submission', async () => {
    window.xapi.template = { ...window.xapi.template, delete: vi.fn().mockRejectedValue(new Error('connection lost')) } as any
    render(<DeleteTemplateDialog open onClose={vi.fn()} onSuccess={vi.fn()} template={template} />)
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('connection lost')
    expect(screen.getByRole('button', { name: '删除' })).toBeDisabled()
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('resets disk deletion consent when reopening or switching templates', () => {
    const view = render(<DeleteTemplateDialog open onClose={vi.fn()} onSuccess={vi.fn()} template={template} />)
    fireEvent.click(screen.getByRole('checkbox'))
    view.rerender(<DeleteTemplateDialog open={false} onClose={vi.fn()} onSuccess={vi.fn()} template={template} />)
    view.rerender(<DeleteTemplateDialog open onClose={vi.fn()} onSuccess={vi.fn()} template={template} />)
    expect(screen.getByRole('checkbox')).not.toBeChecked()
    fireEvent.click(screen.getByRole('checkbox'))
    view.rerender(<DeleteTemplateDialog open onClose={vi.fn()} onSuccess={vi.fn()} template={{ ...template, ref: 'OpaqueRef:other' }} />)
    expect(screen.getByRole('checkbox')).not.toBeChecked()
  })

  it.each([{ is_default_template: true }, { other_config: { default_template: 'true' } }])('protects system templates with metadata %j', (metadata) => {
    render(<DeleteTemplateDialog open onClose={vi.fn()} onSuccess={vi.fn()} template={{ ...template, ...metadata }} />)
    expect(screen.getByRole('button', { name: '删除' })).toBeDisabled()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.getByText('系统模板无法删除')).toBeInTheDocument()
  })

  it('shows snapshots and allows deletion with confirmation', async () => {
    vi.mocked(window.xapi.vm.getSnapshots).mockResolvedValue([
      {
        ref: 'OpaqueRef:snapshot',
        uuid: 'snapshot-uuid',
        name_label: 'snapshot',
        name_description: '',
        snapshot_time: '2026-07-27T00:00:00Z',
        snapshot_of: 'OpaqueRef:vm',
        power_state: 'Halted',
        size: 0,
      },
    ])

    render(<SnapshotsTab vmRef="OpaqueRef:vm" connectionId="conn-1" powerState="Halted" />)
    await waitFor(() => expect(screen.getByText('snapshot')).toBeInTheDocument())

    const deleteButton = screen.getByRole('button', { name: '删除' })
    expect(deleteButton).toBeEnabled()
    fireEvent.click(deleteButton)
    fireEvent.click(await screen.findByRole('button', { name: '删除' }))
    await waitFor(() => expect(window.xapi.vm.deleteSnapshot).toHaveBeenCalledWith('conn-1', 'OpaqueRef:snapshot'))
  })
  it('reloads snapshots when only the pool changes and discards an older response', async () => {
    let finish!: (value: any) => void
    vi.mocked(window.xapi.vm.getSnapshots).mockImplementation((connectionId) => connectionId === 'conn-a' ? new Promise((resolve) => { finish = resolve }) : Promise.resolve([{ ref: 'OpaqueRef:snap-b', name_label: 'Pool B snapshot', snapshot_time: '', size: 0 }] as any))
    const view = render(<SnapshotsTab vmRef="OpaqueRef:vm" connectionId="conn-a" powerState="Halted" />)
    view.rerender(<SnapshotsTab vmRef="OpaqueRef:vm" connectionId="conn-b" powerState="Halted" />)
    expect(await screen.findByText('Pool B snapshot')).toBeInTheDocument()
    await act(async () => finish([{ ref: 'OpaqueRef:snap-a', name_label: 'Pool A snapshot', snapshot_time: '', size: 0 }]))
    expect(screen.queryByText('Pool A snapshot')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '删除' }))
    await waitFor(() => expect(window.xapi.vm.deleteSnapshot).toHaveBeenCalledWith('conn-b', 'OpaqueRef:snap-b'))
  })

  it('does not report an empty snapshot list when reading fails', async () => {
    vi.mocked(window.xapi.vm.getSnapshots).mockRejectedValue(new Error('read denied'))
    render(<SnapshotsTab vmRef="OpaqueRef:vm" connectionId="conn-1" powerState="Halted" />)
    expect(await screen.findByRole('alert')).toHaveTextContent('read denied')
    expect(screen.queryByText('此 VM 暂无快照')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '拍摄快照' })).toBeDisabled()
  })

  it('contains revert errors in the confirmation and prevents immediate duplicate submission', async () => {
    vi.mocked(window.xapi.vm.getSnapshots).mockResolvedValue([{ ref: 'OpaqueRef:snap', name_label: 'snapshot', snapshot_time: '', size: 0 }] as any)
    window.xapi.vm.revertSnapshot = vi.fn().mockRejectedValue(new Error('response lost'))
    render(<SnapshotsTab vmRef="OpaqueRef:vm" connectionId="conn-1" powerState="Halted" />)
    fireEvent.click(await screen.findByRole('button', { name: '恢复' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '恢复' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('response lost')
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: '恢复' })).toBeDisabled()
    expect(window.xapi.vm.revertSnapshot).toHaveBeenCalledOnce()
  })

})
