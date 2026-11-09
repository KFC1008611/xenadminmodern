import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SettingsPage from '../../src/renderer/src/pages/SettingsPage'
import { SettingsLink } from '../../src/renderer/src/components/layout/SettingsLink'
import type { UpdateState } from '../../src/shared/ipc-contracts/updates'

vi.mock('../../src/renderer/src/components/layout/TaskCenter', () => ({ TaskCenter: () => null }))
vi.mock('../../src/renderer/src/components/feedback/FeedbackOverlay', () => ({ FeedbackOverlay: () => null }))
const future = { v7_startTransition: true, v7_relativeSplatPath: true }
const initial: UpdateState = { currentVersion: '1.2.1', enabled: true, supported: true, status: 'available', version: '1.2.2', progress: 0, checkedAt: 1000, message: '发现新版本 1.2.2' }

beforeEach(() => {
  window.xapi = { ...window.xapi, updates: { getState: vi.fn().mockResolvedValue(initial), setEnabled: vi.fn(), check: vi.fn(), download: vi.fn(), install: vi.fn() } }
})

describe('application settings', () => {
  it('navigates to the settings page and displays the update section without a dialog', async () => {
    render(<MemoryRouter future={future}>
      <SettingsLink />
      <Routes><Route path="/" element={null} /><Route path="/settings" element={<SettingsPage />} /></Routes>
    </MemoryRouter>)
    fireEvent.click(screen.getByRole('link', { name: '设置' }))
    expect(await screen.findByRole('heading', { name: '设置' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '软件更新' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('checkbox', { name: '自动检查更新' })).toBeChecked())
  })
  it('keeps the update reminder on the settings navigation entry', async () => {
    render(<MemoryRouter future={future}><SettingsLink /></MemoryRouter>)
    const link = await screen.findByRole('link', { name: '设置，有可用更新' })
    expect(link).toHaveAttribute('href', '/settings')
    expect(link).toHaveTextContent('有更新')
  })
  it('offers a return to the connection page before a server is connected', async () => {
    render(<MemoryRouter future={future} initialEntries={['/settings']}>
      <Routes>
        <Route path="/settings" element={<SettingsPage standalone />} />
        <Route path="/connect" element={<h1>连接服务器</h1>} />
      </Routes>
    </MemoryRouter>)
    expect(await screen.findByRole('heading', { name: '软件更新' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('link', { name: '返回连接' }))
    expect(screen.getByRole('heading', { name: '连接服务器' })).toBeInTheDocument()
  })
  it('shows a state read failure and allows retrying in the settings page', async () => {
    vi.mocked(window.xapi.updates.getState).mockRejectedValueOnce(new Error('无法读取更新状态'))
    render(<MemoryRouter future={future}><SettingsPage /></MemoryRouter>)
    expect(await screen.findByRole('alert')).toHaveTextContent('无法读取更新状态')
    fireEvent.click(screen.getByRole('button', { name: '重新读取' }))
    expect(await screen.findByRole('checkbox')).toBeChecked()
  })
})
