import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RbacPage from '../../src/renderer/src/pages/RbacPage'
import { useConnectionManagerStore } from '../../src/renderer/src/store/connectionManager.store'

const routerFuture = {
  v7_startTransition: true,
  v7_relativeSplatPath: true,
} as const

vi.mock('../../src/renderer/src/components/rbac/RbacUserManager', () => ({
  RbacUserManager: ({ connectionId }: { connectionId: string }) => (
    <div data-testid="rbac-user-manager-connection">{connectionId}</div>
  ),
}))

vi.mock('../../src/renderer/src/components/rbac/AddSubjectDialog', () => ({
  AddSubjectDialog: ({ connectionId }: { connectionId: string }) => (
    <div data-testid="rbac-add-dialog-connection">{connectionId}</div>
  ),
}))

vi.mock('../../src/renderer/src/components/rbac/EditSubjectRolesDialog', () => ({
  EditSubjectRolesDialog: ({ connectionId }: { connectionId: string }) => (
    <div data-testid="rbac-edit-dialog-connection">{connectionId}</div>
  ),
}))

describe('RbacPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useConnectionManagerStore.setState({
      connections: [
        { id: 'conn-a', name: 'Pool A', host: 'a.example', port: 443, username: 'root', state: 'connected', poolName: 'Pool A' },
        { id: 'conn-b', name: 'Pool B', host: 'b.example', port: 443, username: 'root', state: 'connected', poolName: 'Pool B' },
      ] as any,
      activeConnectionId: 'conn-a',
      isLoading: false,
      error: null,
    })
  })

  it('passes the selected pool connection to RBAC child workflows', () => {
    render(
      <MemoryRouter future={routerFuture} initialEntries={['/rbac']}>
        <Routes>
          <Route path="/rbac" element={<RbacPage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByTestId('rbac-user-manager-connection')).toHaveTextContent('conn-a')
    expect(screen.getByTestId('rbac-add-dialog-connection')).toHaveTextContent('conn-a')
    expect(screen.getByTestId('rbac-edit-dialog-connection')).toHaveTextContent('conn-a')

    fireEvent.change(screen.getByLabelText('RBAC 资源池'), { target: { value: 'conn-b' } })

    expect(screen.getByTestId('rbac-user-manager-connection')).toHaveTextContent('conn-b')
    expect(screen.getByTestId('rbac-add-dialog-connection')).toHaveTextContent('conn-b')
    expect(screen.getByTestId('rbac-edit-dialog-connection')).toHaveTextContent('conn-b')
  })
})
