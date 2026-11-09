import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { VmExportDialog } from '../../src/renderer/src/components/vm/VmExportDialog'
import { useExportPanelStore } from '../../src/renderer/src/store/exportPanel.store'

vi.mock('../../src/renderer/src/components/toast/useToast', () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}))

describe('VmExportDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useExportPanelStore.setState({
      tasks: [],
    })
    Object.assign(window.xapi, {
      dialog: {
        showSaveDialog: vi.fn().mockResolvedValue({
          canceled: false,
          filePath: '/tmp/export.xva',
        }),
      },
      vm: {
        export: vi.fn().mockResolvedValue({
          exportId: 'export-1',
          estimatedBytes: 1024,
        }),
      },
    })
  })

  it('shows snapshot export mode for running VMs', () => {
    render(
      <VmExportDialog
        open={true}
        onClose={vi.fn()}
        vmRef="OpaqueRef:vm"
        vmName="Running VM"
        powerState="Running"
        connectionId="conn-1"
      />,
    )

    expect(screen.getByText('导出快照')).toBeTruthy()
  })

  it('does not show snapshot export mode for halted VMs and submits force mode', async () => {
    render(
      <VmExportDialog
        open={true}
        onClose={vi.fn()}
        vmRef="OpaqueRef:vm"
        vmName="Halted VM"
        powerState="Halted"
        connectionId="conn-1"
      />,
    )

    expect(screen.queryByText('导出快照')).toBeNull()

    fireEvent.click(screen.getByText('浏览'))
    await waitFor(() => {
      expect(screen.getByText('/tmp/export.xva')).toBeTruthy()
    })
    fireEvent.click(screen.getByText('开始导出'))

    await waitFor(() => {
      expect(window.xapi.vm.export).toHaveBeenCalledWith('conn-1', expect.objectContaining({
        exportMode: 'force',
      }))
    })
  })

  it('does not show VM export mode choices for templates', () => {
    render(
      <VmExportDialog
        open={true}
        onClose={vi.fn()}
        vmRef="OpaqueRef:template"
        vmName="Template"
        connectionId="conn-1"
        isTemplate={true}
      />,
    )

    expect(screen.queryByText('关机后导出')).toBeNull()
    expect(screen.queryByText('导出快照')).toBeNull()
    expect(screen.queryByText('强制导出')).toBeNull()
  })
  it('keeps an accepted export submission busy when its VM powers off and blocks Escape', async () => {
    let finish!: (value: any) => void
    vi.mocked(window.xapi.vm.export).mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    const props = { open: true, onClose: vi.fn(), vmRef: 'OpaqueRef:vm', vmName: 'VM', connectionId: 'conn-1' }
    const view = render(<VmExportDialog {...props} powerState="Running" />)
    fireEvent.click(screen.getByRole('button', { name: '浏览' }))
    await screen.findByText('/tmp/export.xva')
    fireEvent.click(screen.getByRole('button', { name: '开始导出' }))
    view.rerender(<VmExportDialog {...props} powerState="Halted" />)
    expect(screen.getByRole('button', { name: '启动中...' })).toBeDisabled()
    expect(screen.getByText('/tmp/export.xva')).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(props.onClose).not.toHaveBeenCalled()
    expect(window.xapi.vm.export).toHaveBeenCalledOnce()
    await act(async () => finish({ exportId: 'export-1', estimatedBytes: 1024 }))
    expect(props.onClose).toHaveBeenCalledOnce()
  })

  it.each([
    { mode: 'snapshot', alternative: 'shutdown', remainingOperation: 'clean_shutdown', blockedOperation: 'checkpoint' },
    { mode: 'shutdown', alternative: 'snapshot', remainingOperation: 'checkpoint', blockedOperation: 'clean_shutdown' },
  ])('preserves $mode export when capabilities change until the user chooses another mode', async ({ mode, alternative, remainingOperation, blockedOperation }) => {
    const running = { power_state: 'Running', is_a_template: false, is_control_domain: false,
      allowed_operations: ['clean_shutdown', 'checkpoint'], current_operations: {} }
    const props = { open: true, onClose: vi.fn(), vmRef: 'OpaqueRef:vm', vmName: 'Live VM',
      powerState: 'Running' as const, connectionId: 'conn-1' }
    const view = render(<VmExportDialog {...props} vmRecord={running} />)
    fireEvent.click(screen.getByDisplayValue(mode))
    fireEvent.click(screen.getByRole('button', { name: '浏览' }))
    await screen.findByText('/tmp/export.xva')

    const unavailable = { ...running, allowed_operations: [remainingOperation],
      blocked_operations: { [blockedOperation]: '所选模式暂不可用' } }
    view.rerender(<VmExportDialog {...props} vmRecord={unavailable} />)
    expect(screen.getByDisplayValue(mode)).toBeChecked()
    expect(screen.getByDisplayValue(mode)).toBeDisabled()
    expect(screen.getByDisplayValue(alternative)).not.toBeChecked()
    expect(screen.getByRole('status')).toHaveTextContent('所选模式暂不可用')
    expect(screen.getByRole('button', { name: '开始导出' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '开始导出' }))
    expect(window.xapi.vm.export).not.toHaveBeenCalled()
    expect(screen.getByText('/tmp/export.xva')).toBeInTheDocument()

    view.rerender(<VmExportDialog {...props} vmRecord={running} />)
    expect(screen.getByDisplayValue(mode)).toBeChecked()
    expect(screen.getByRole('button', { name: '开始导出' })).toBeEnabled()
    expect(screen.queryByRole('status')).toBeNull()

    view.rerender(<VmExportDialog {...props} vmRecord={unavailable} />)
    fireEvent.click(screen.getByDisplayValue(alternative))
    fireEvent.click(screen.getByRole('button', { name: '开始导出' }))
    await waitFor(() => expect(window.xapi.vm.export).toHaveBeenCalledWith('conn-1', {
      vmRef: 'OpaqueRef:vm', filePath: '/tmp/export.xva', powerState: 'Running', exportMode: alternative,
    }))
    expect(window.xapi.vm.export).toHaveBeenCalledOnce()
  })

  it('chooses a new available default only when reopening or switching targets', async () => {
    const running = { power_state: 'Running', allowed_operations: ['checkpoint'] }
    const props = { open: true, onClose: vi.fn(), vmRef: 'OpaqueRef:vm', vmName: 'Live VM',
      powerState: 'Running' as const, connectionId: 'conn-1' }
    const view = render(<VmExportDialog {...props} vmRecord={running} />)
    expect(screen.getByDisplayValue('snapshot')).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: '浏览' }))
    await screen.findByText('/tmp/export.xva')
    const shutdownOnly = { ...running, allowed_operations: ['clean_shutdown'] }
    view.rerender(<VmExportDialog {...props} open={false} vmRecord={shutdownOnly} />)
    view.rerender(<VmExportDialog {...props} vmRecord={shutdownOnly} />)
    expect(screen.getByDisplayValue('shutdown')).toBeChecked()
    expect(screen.queryByText('/tmp/export.xva')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '浏览' }))
    await screen.findByText('/tmp/export.xva')
    view.rerender(<VmExportDialog {...props} connectionId="conn-2" vmRef="OpaqueRef:other" vmRecord={running} />)
    expect(screen.getByDisplayValue('snapshot')).toBeChecked()
    expect(screen.queryByText('/tmp/export.xva')).toBeNull()
  })

  it('requires an explicit mode choice after a power state change and retains snapshot intent on recovery', async () => {
    const props = { open: true, onClose: vi.fn(), vmRef: 'OpaqueRef:vm', vmName: 'Live VM', connectionId: 'conn-1' }
    const view = render(<VmExportDialog {...props} powerState="Running" />)
    fireEvent.click(screen.getByDisplayValue('snapshot'))
    fireEvent.click(screen.getByRole('button', { name: '浏览' }))
    await screen.findByText('/tmp/export.xva')
    view.rerender(<VmExportDialog {...props} powerState="Halted" />)
    expect(screen.getByDisplayValue('force')).not.toBeChecked()
    expect(screen.getByRole('button', { name: '开始导出' })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('电源状态已变化')
    view.rerender(<VmExportDialog {...props} powerState="Running" />)
    expect(screen.getByDisplayValue('snapshot')).toBeChecked()
    expect(screen.getByDisplayValue('shutdown')).not.toBeChecked()
    expect(screen.getByRole('button', { name: '开始导出' })).toBeEnabled()
    expect(window.xapi.vm.export).not.toHaveBeenCalled()

    view.rerender(<VmExportDialog {...props} powerState="Halted" />)
    fireEvent.click(screen.getByDisplayValue('force'))
    fireEvent.click(screen.getByRole('button', { name: '开始导出' }))
    await waitFor(() => expect(window.xapi.vm.export).toHaveBeenCalledWith('conn-1', expect.objectContaining({ exportMode: 'force' })))
  })

  it('does not switch to a newly available mode during an open dialog', () => {
    const props = { open: true, onClose: vi.fn(), vmRef: 'OpaqueRef:vm', vmName: 'Live VM',
      powerState: 'Running' as const, connectionId: 'conn-1' }
    const view = render(<VmExportDialog {...props} vmRecord={{ power_state: 'Running', allowed_operations: [] }} />)
    expect(screen.getByDisplayValue('shutdown')).toBeChecked()
    view.rerender(<VmExportDialog {...props} vmRecord={{ power_state: 'Running', allowed_operations: ['checkpoint'] }} />)
    expect(screen.getByDisplayValue('shutdown')).toBeChecked()
    expect(screen.getByDisplayValue('snapshot')).not.toBeChecked()
    fireEvent.click(screen.getByDisplayValue('snapshot'))
    expect(screen.getByDisplayValue('snapshot')).toBeChecked()
  })

})

describe('export preparation capabilities', () => {
  it('selects checkpoint export when normal shutdown is unavailable', async () => {
    render(<VmExportDialog open onClose={vi.fn()} vmRef="OpaqueRef:vm" vmName="Live VM" powerState="Running" connectionId="conn-1"
      vmRecord={{ power_state: 'Running', is_a_template: false, is_control_domain: false, allowed_operations: ['checkpoint'] }} />)
    const radios = screen.getAllByRole('radio')
    expect(radios[0]).toBeDisabled()
    await waitFor(() => expect(radios[1]).toBeChecked())
    expect(screen.getByText(/请检查 Guest Tools/)).toBeInTheDocument()
  })
})
