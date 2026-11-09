import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MaintenanceDialog } from '../../src/renderer/src/components/host/MaintenanceDialog'

vi.mock('../../src/renderer/src/components/toast/useToast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}))

describe('host lifecycle safety gate', () => {
  it('shows the operation restriction and cannot enter maintenance mode', () => {
    const enterMaintenance = vi.fn()
    window.xapi = {
      ...window.xapi,
      host: { enterMaintenance },
    } as any

    render(
      <MaintenanceDialog
        open
        onClose={vi.fn()}
        connectionId="conn-1"
        hostRef="OpaqueRef:host"
        vmNames={['workload']}
        onComplete={vi.fn()}
      />,
    )

    expect(screen.getByText(/暂不可用/)).toBeInTheDocument()
    const button = screen.getByRole('button', { name: '确认进入维护模式' })
    expect(button).toBeDisabled()
    fireEvent.click(button)
    expect(enterMaintenance).not.toHaveBeenCalled()
  })
})
