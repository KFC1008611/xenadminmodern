import { MemoryRouter } from 'react-router-dom'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import AppShell from '../../src/renderer/src/components/layout/AppShell'

vi.mock('../../src/renderer/src/components/layout/Sidebar', () => ({ default: () => null }))
vi.mock('../../src/renderer/src/components/layout/TopBar', () => ({ default: () => null }))
vi.mock('../../src/renderer/src/components/layout/Breadcrumb', () => ({ default: () => null }))
vi.mock('../../src/renderer/src/components/feedback/FeedbackOverlay', () => ({ FeedbackOverlay: () => null }))

describe('AppShell', () => {
  it('does not expose internal capability evidence in the normal workspace', () => {
    render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><AppShell><div>工作区内容</div></AppShell></MemoryRouter>)

    expect(screen.getByText('工作区内容')).toBeInTheDocument()
    expect(screen.queryByText('内部实施阶段')).not.toBeInTheDocument()
  })
})
