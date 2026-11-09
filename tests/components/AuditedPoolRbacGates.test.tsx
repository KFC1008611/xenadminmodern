import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PoolManagerPage from '../../src/renderer/src/pages/PoolManagerPage'
import { RbacUserManager } from '../../src/renderer/src/components/rbac/RbacUserManager'
import { useConnectionManagerStore } from '../../src/renderer/src/store/connectionManager.store'
import { useMultiDataStore } from '../../src/renderer/src/store/multiData.store'
import { usePoolManagerStore } from '../../src/renderer/src/store/poolManager.store'
import { useRbacStore } from '../../src/renderer/src/store/rbac.store'

describe('audited pool and RBAC safety gates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useConnectionManagerStore.setState({
      connections: [
        {
          id: 'conn-1',
          name: 'Pool 1',
          host: 'pool.example',
          port: 443,
          username: 'root',
          state: 'connected',
          poolName: 'Pool 1',
        },
      ] as any,
      activeConnectionId: 'conn-1',
    })
    useMultiDataStore.setState({
      hosts: [
        { ref: 'OpaqueRef:host-1', name_label: 'host-1', enabled: true, address: '10.0.0.1', connectionId: 'conn-1', poolName: 'Pool 1' },
        { ref: 'OpaqueRef:host-2', name_label: 'host-2', enabled: true, address: '10.0.0.2', connectionId: 'conn-1', poolName: 'Pool 1' },
      ] as any,
      pools: [
        { ref: 'OpaqueRef:pool', uuid: 'pool-uuid', name_label: 'Pool 1', connectionId: 'conn-1' },
      ] as any,
      refreshHosts: vi.fn(),
    })
    usePoolManagerStore.setState({
      joinDialogOpen: false,
      ejectDialogOpen: false,
      transferDialogOpen: false,
    })
    useRbacStore.setState({
      subjectsWithRolesLoading: false, subjectsWithRolesError: null,
      getExtAuthConfig: vi.fn().mockResolvedValue({ configured: false, consistent: true, type: '', service_name: '', credential: '', other_config: {}, hosts: [] }),
      loadSubjectsWithRoles: vi.fn(),
      subjectsWithRoles: [
        {
          subject: {
            ref: 'OpaqueRef:subject',
            uuid: 'subject-uuid',
            subject_identifier: 'user@example.com',
            other_config: {},
            roles: ['OpaqueRef:role'],
            authentication_policy: 'AD',
            connectionId: 'conn-1',
            poolName: 'Pool 1',
          },
          roleNames: ['Pool Admin'],
          allPermissions: ['vm.start'],
        },
      ],
    })
  })

  it('disables pool join and eject with audit reasons', () => {
    render(<PoolManagerPage />)

    expect(screen.getByRole('button', { name: '添加主机' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '添加主机' })).toHaveAttribute(
      'title',
      expect.stringContaining('暂不可用'),
    )
    for (const button of screen.getAllByRole('button', { name: '移出' })) {
      expect(button).toBeDisabled()
      expect(button).toHaveAttribute('title', expect.stringContaining('暂不可用'))
    }
    expect(screen.getByRole('button', { name: '转移主节点' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '转移主节点' })).toHaveAttribute(
      'title',
      expect.stringContaining('暂不可用'),
    )
  })

  it('disables Subject creation, deletion, and role changes with explicit reasons', async () => {
    const onAddUser = vi.fn()
    const onEditRoles = vi.fn()

    render(
      <RbacUserManager
        connectionId="conn-1"
        onAddUser={onAddUser}
        onEditRoles={onEditRoles}
      />,
    )

    await waitFor(() => expect(screen.getByText('外部认证：未配置')).toBeInTheDocument())
    const addButton = screen.getByRole('button', { name: '添加用户/组' })
    expect(addButton).toBeDisabled()
    expect(addButton).toHaveAttribute('title', expect.stringContaining('暂不可用'))
    fireEvent.click(addButton)
    expect(onAddUser).not.toHaveBeenCalled()
    const editButton = screen.getByRole('button', {
      name: '编辑 user@example.com 的角色',
    })
    expect(editButton).toBeDisabled()
    expect(editButton).toHaveAttribute('title', expect.stringContaining('暂不可用'))
    expect(screen.getByRole('button', { name: '移除 user@example.com' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '移除 user@example.com' })).toHaveAttribute(
      'title',
      expect.stringContaining('暂不可用'),
    )
  })
})
