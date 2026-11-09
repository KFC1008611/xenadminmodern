import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import SrActions from '../../src/renderer/src/components/sr/SrActions'

describe('storage repository lifecycle safety gate', () => {
  it('keeps observation actions available and explains why detach and destroy are blocked', () => {
    render(
      <SrActions
        sr={{ ref: 'OpaqueRef:sr' } as any}
        connectionId="conn-1"
        poolRef="OpaqueRef:pool"
        onActionComplete={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: '扫描' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '设为默认' })).toBeEnabled()

    const detach = screen.getByRole('button', { name: '分离' })
    expect(detach).toBeDisabled()
    expect(detach).toHaveAttribute('title', expect.stringContaining('暂不可用'))

    const destroy = screen.getByRole('button', { name: '销毁' })
    expect(destroy).toBeDisabled()
    expect(destroy).toHaveAttribute('title', expect.stringContaining('暂不可用'))
  })
})
