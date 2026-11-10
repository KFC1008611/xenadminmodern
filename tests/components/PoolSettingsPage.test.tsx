import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import PoolSettingsPage from '../../src/renderer/src/pages/PoolSettingsPage'
import { useConnectionManagerStore } from '../../src/renderer/src/store/connectionManager.store'

vi.mock('../../src/renderer/src/pages/PoolManagerPage', () => ({ default: ({ connectionId }: { connectionId: string }) => <div>常规 {connectionId}<input aria-label="草稿" /></div> }))
vi.mock('../../src/renderer/src/pages/RbacPage', () => ({ default: ({ connectionId }: { connectionId: string }) => <div>权限 {connectionId}</div> }))
vi.mock('../../src/renderer/src/components/ha/HaSettingsTab', () => ({ HaSettingsTab: ({ connectionId }: { connectionId: string }) => <div>高可用 {connectionId}</div> }))
const future = { v7_startTransition: true, v7_relativeSplatPath: true } as const
function Location() {
  const location = useLocation()
  return <output>{location.pathname + location.search}</output>
}
function show(query = '') {
  return render(<MemoryRouter future={future} initialEntries={['/pool/B/settings' + query]}><Location /><Routes><Route path="/pool/:connectionId/settings" element={<PoolSettingsPage />} /></Routes></MemoryRouter>)
}
beforeEach(() => {
  useConnectionManagerStore.setState({ activeConnectionId: 'A', connections: ['A', 'B'].map(id => ({ id, host: `${id}.invalid`, state: 'connected', epoch: 1, connectedAt: 1, poolUuid: id })) as any })
})
it('binds every settings tab to the explicit pool and stores the selected tab in the URL', () => {
  show()
  expect(screen.getByText('常规 B')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '用户与权限' }))
  expect(screen.getByText('权限 B')).toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('/pool/B/settings?tab=access')
  fireEvent.click(screen.getByRole('button', { name: '高可用' }))
  expect(screen.getByText('高可用 B')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '高可用' })).toHaveAttribute('aria-pressed', 'true')
})
it('uses general settings for an unknown tab', () => {
  show('?tab=missing')
  expect(screen.getByText('常规 B')).toBeInTheDocument()
})
it('blocks a disconnected scope instead of switching to another connected pool', () => {
  show('?tab=access')
  act(() => useConnectionManagerStore.setState(state => ({ connections: state.connections.map(item => item.id === 'B' ? { ...item, state: 'error' } : item) })))
  expect(screen.getByRole('alert')).toHaveTextContent('资源池未连接')
  expect(screen.queryByText('权限 A')).not.toBeInTheDocument()
  expect(screen.queryByText('权限 B')).not.toBeInTheDocument()
})
it('releases drafts when the connection generation changes', () => {
  show()
  fireEvent.change(screen.getByRole('textbox', { name: '草稿' }), { target: { value: '旧选择' } })
  act(() => useConnectionManagerStore.setState(state => ({ connections: state.connections.map(item => ({ ...item, epoch: 2 })) })))
  expect(screen.getByRole('textbox', { name: '草稿' })).toHaveValue('')
})
