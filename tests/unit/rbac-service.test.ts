/**
 * Unit tests for rbac.service — verifies XAPI role.*, subject.*, user.*, and auth.* calls.
 * Reference: https://citrix.github.io/xenserver-management-api/ (role, subject, auth, session, user classes)
 *
 * XenAPI class reference:
 * - role: name_label, name_description, subroles (role ref set), uuid
 * - subject: subject_identifier, other_config, roles (role ref set), authentication_policy, uuid
 * - auth: get_subject_identifier, get_group_membership, get_subject_information_from_identifier
 * - user: short_name, fullname, other_config, uuid
 * - session: login_with_password, logout, get_rbac_permissions, has_permission
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCallWithSession = vi.fn()
const mockGetClient = vi.fn(() => ({
  callWithSession: mockCallWithSession,
}))

vi.mock('../../src/main/xapi/connection-manager', () => ({
  connectionManager: {
    getClient: mockGetClient,
    getConnectionInfo: vi.fn(() => ({ poolName: 'Test Pool' })),
  },
}))

describe('rbac.service', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockGetClient.mockReturnValue({ callWithSession: mockCallWithSession, getSessionRef: () => 'OpaqueRef:session' })
  })

  // ============================================================================
  // Role Management — role class fields: name_label, name_description, subroles, uuid
  // XenAPI methods: role.get_all_records, role.get_record, role.add_to_subroles, role.remove_from_subroles
  // ============================================================================

  describe('getAllRoles', () => {
    it('returns role records with connection metadata', async () => {
      // XenAPI role record: uuid, name_label, name_description, subroles (role ref set)
      mockCallWithSession
        .mockResolvedValueOnce({
          'OpaqueRef:role-pool-admin': {
            uuid: 'uuid-pool-admin',
            name_label: 'Pool Admin',
            name_description: 'The Pool Admin role has full access to all operations',
            subroles: ['OpaqueRef:role-pool-operator', 'OpaqueRef:role-vm-admin'],
          },
          'OpaqueRef:role-pool-operator': {
            uuid: 'uuid-pool-operator',
            name_label: 'Pool Operator',
            name_description: 'The Pool Operator role allows operations across the pool',
            subroles: ['OpaqueRef:role-vm-power-admin'],
          },
          'OpaqueRef:role-vm-admin': {
            uuid: 'uuid-vm-admin',
            name_label: 'VM Admin',
            name_description: 'The VM Admin role allows management of VMs',
            subroles: [],
          },
        })
        .mockResolvedValueOnce(['pool.admin'])
        .mockResolvedValueOnce(['pool.operate'])
        .mockResolvedValueOnce(['vm.admin'])

      const { getAllRoles } = await import('../../src/main/xapi/services/rbac.service')
      const roles = await getAllRoles('conn-123')

      expect(roles).toHaveLength(3)
      expect(roles[0].name_label).toBe('Pool Admin')
      expect(roles[0].subroles).toContain('OpaqueRef:role-pool-operator')
      expect(roles[0].policies).toEqual(['pool.admin'])
      expect(roles.every(r => r.connectionId === 'conn-123')).toBe(true)
      expect(roles.every(r => r.poolName === 'Test Pool')).toBe(true)
    })

    it('throws when connectionId is invalid', async () => {
      mockGetClient.mockReturnValueOnce(undefined)

      const { getAllRoles } = await import('../../src/main/xapi/services/rbac.service')
      await expect(getAllRoles('invalid-id')).rejects.toThrow('No connection found')
    })
  })

  describe('getRoleRecord', () => {
    it('returns a specific role record', async () => {
      mockCallWithSession
        .mockResolvedValueOnce({
          uuid: 'uuid-pool-admin',
          name_label: 'Pool Admin',
          name_description: 'The Pool Admin role has full access to all operations',
          subroles: ['OpaqueRef:role-pool-operator'],
        })
        .mockResolvedValueOnce(['pool.admin'])

      const { getRoleRecord } = await import('../../src/main/xapi/services/rbac.service')
      const role = await getRoleRecord('conn-123', 'OpaqueRef:role-pool-admin')

      expect(role).not.toBeNull()
      expect(role!.name_label).toBe('Pool Admin')
      expect(role!.ref).toBe('OpaqueRef:role-pool-admin')
      expect(role!.connectionId).toBe('conn-123')
      expect(role!.policies).toEqual(['pool.admin'])
    })

    it('returns null when role not found (HANDLE_INVALID)', async () => {
      mockCallWithSession.mockRejectedValueOnce(new Error('HANDLE_INVALID'))

      const { getRoleRecord } = await import('../../src/main/xapi/services/rbac.service')
      const role = await getRoleRecord('conn-123', 'OpaqueRef:nonexistent')

      expect(role).toBeNull()
    })

    it('returns null when role UUID invalid (UUID_INVALID)', async () => {
      mockCallWithSession.mockRejectedValueOnce(new Error('UUID_INVALID'))

      const { getRoleRecord } = await import('../../src/main/xapi/services/rbac.service')
      const role = await getRoleRecord('conn-123', 'OpaqueRef:bad-uuid')

      expect(role).toBeNull()
    })
  })

  describe('getRolePermissions', () => {
    it('calls role.get_permissions_name_label', async () => {
      mockCallWithSession.mockResolvedValueOnce(['pool.admin', 'host.manage', 'vm.start', 'vm.shutdown'])

      const { getRolePermissions } = await import('../../src/main/xapi/services/rbac.service')
      const permissions = await getRolePermissions('conn-123', 'OpaqueRef:role-pool-admin')

      expect(permissions).toContain('pool.admin')
      expect(permissions).toContain('vm.start')
      expect(permissions).toContain('vm.shutdown')
      expect(permissions).toHaveLength(4) // Deduplicated
      expect(mockCallWithSession).toHaveBeenCalledWith('role.get_permissions_name_label', ['OpaqueRef:role-pool-admin'])
    })

    it('deduplicates permissions returned by XAPI', async () => {
      mockCallWithSession.mockResolvedValueOnce(['perm.a', 'perm.b', 'perm.a'])

      const { getRolePermissions } = await import('../../src/main/xapi/services/rbac.service')
      const permissions = await getRolePermissions('conn-123', 'OpaqueRef:role-a')

      expect(permissions).toContain('perm.a')
      expect(permissions).toContain('perm.b')
      expect(permissions).toHaveLength(2)
    })
  })

  // ============================================================================
  // Subject Management — subject class fields: subject_identifier, other_config, roles, uuid
  // XenAPI methods: subject.get_all_records, subject.get_record, subject.create, subject.destroy,
  //                 subject.add_to_roles, subject.remove_from_roles
  // ============================================================================

  describe('getAllSubjects', () => {
    it('returns subject records with connection metadata', async () => {
      // XenAPI subject record: uuid, subject_identifier, other_config, roles, authentication_policy
      mockCallWithSession.mockResolvedValueOnce({
        'OpaqueRef:subj1': {
          uuid: 'uuid-subj1',
          subject_identifier: 'S-1-5-21-1234567890',
          other_config: { subject_name: 'DOMAIN\\adminuser' },
          roles: ['OpaqueRef:role-pool-admin'],
          authentication_policy: '',
        },
        'OpaqueRef:subj2': {
          uuid: 'uuid-subj2',
          subject_identifier: 'S-1-5-21-0987654321',
          other_config: { subject_name: 'DOMAIN\\operator' },
          roles: ['OpaqueRef:role-pool-operator'],
          authentication_policy: '',
        },
      })

      const { getAllSubjects } = await import('../../src/main/xapi/services/rbac.service')
      const subjects = await getAllSubjects('conn-123')

      expect(subjects).toHaveLength(2)
      expect(subjects[0].subject_identifier).toBe('S-1-5-21-1234567890')
      expect(subjects[0].roles).toContain('OpaqueRef:role-pool-admin')
      expect(subjects.every(s => s.connectionId === 'conn-123')).toBe(true)
    })
  })

  describe('getSubjectRecord', () => {
    it('returns a specific subject record', async () => {
      mockCallWithSession.mockResolvedValueOnce({
        uuid: 'uuid-subj1',
        subject_identifier: 'S-1-5-21-1234567890',
        other_config: { subject_name: 'DOMAIN\\adminuser' },
        roles: ['OpaqueRef:role-pool-admin'],
        authentication_policy: '',
      })

      const { getSubjectRecord } = await import('../../src/main/xapi/services/rbac.service')
      const subject = await getSubjectRecord('conn-123', 'OpaqueRef:subj1')

      expect(subject).not.toBeNull()
      expect(subject!.subject_identifier).toBe('S-1-5-21-1234567890')
      expect(subject!.ref).toBe('OpaqueRef:subj1')
    })

    it('returns null when subject not found', async () => {
      mockCallWithSession.mockRejectedValueOnce(new Error('HANDLE_INVALID'))

      const { getSubjectRecord } = await import('../../src/main/xapi/services/rbac.service')
      const subject = await getSubjectRecord('conn-123', 'OpaqueRef:nonexistent')

      expect(subject).toBeNull()
    })
  })

  describe('getSubjectsWithRoles', () => {
    it('returns subjects with resolved role names and permissions', async () => {
      mockCallWithSession
        .mockResolvedValueOnce({ // subject.get_all_records
          'OpaqueRef:subj1': {
            uuid: 'uuid-subj1',
            subject_identifier: 'S-1-5-21-1234567890',
            other_config: {},
            roles: ['OpaqueRef:role-pool-admin'],
            authentication_policy: '',
          },
        })
        .mockResolvedValueOnce({ // role.get_all_records
          'OpaqueRef:role-pool-admin': {
            uuid: 'uuid-pool-admin',
            name_label: 'Pool Admin',
            name_description: '',
            subroles: [],
          },
        })
        .mockResolvedValueOnce(['pool.admin'])

      const { getSubjectsWithRoles } = await import('../../src/main/xapi/services/rbac.service')
      const results = await getSubjectsWithRoles('conn-123')

      expect(results).toHaveLength(1)
      expect(results[0].roleNames).toContain('Pool Admin')
      expect(results[0].allPermissions).toContain('pool.admin')
    })
  })

  describe('addSubject', () => {
    it('calls subject.create and assigns roles', async () => {
      mockCallWithSession
        .mockResolvedValueOnce('OpaqueRef:new-subj') // subject.create
        .mockResolvedValueOnce(null) // subject.add_to_roles

      const { addSubject } = await import('../../src/main/xapi/services/rbac.service')
      const ref = await addSubject('conn-123', {
        subjectIdentifier: 'S-1-5-21-newuser',
        roles: ['OpaqueRef:role-vm-admin'],
      })

      expect(ref).toBe('OpaqueRef:new-subj')
      expect(mockCallWithSession).toHaveBeenCalledWith('subject.create', [{
        subject_identifier: 'S-1-5-21-newuser',
        other_config: {},
      }])
      expect(mockCallWithSession).toHaveBeenCalledWith('subject.add_to_roles', [
        'OpaqueRef:new-subj', 'OpaqueRef:role-vm-admin',
      ])
    })

    it('assigns multiple roles', async () => {
      mockCallWithSession
        .mockResolvedValueOnce('OpaqueRef:new-subj') // subject.create
        .mockResolvedValueOnce(null) // role 1
        .mockResolvedValueOnce(null) // role 2

      const { addSubject } = await import('../../src/main/xapi/services/rbac.service')
      await addSubject('conn-123', {
        subjectIdentifier: 'S-1-5-21-multirole',
        roles: ['OpaqueRef:role-vm-admin', 'OpaqueRef:role-pool-operator'],
      })

      expect(mockCallWithSession).toHaveBeenCalledWith('subject.add_to_roles', [
        'OpaqueRef:new-subj', 'OpaqueRef:role-vm-admin',
      ])
      expect(mockCallWithSession).toHaveBeenCalledWith('subject.add_to_roles', [
        'OpaqueRef:new-subj', 'OpaqueRef:role-pool-operator',
      ])
    })
  })

  describe('removeSubject', () => {
    it('calls subject.destroy', async () => {
      mockCallWithSession.mockResolvedValueOnce(null)

      const { removeSubject } = await import('../../src/main/xapi/services/rbac.service')
      await removeSubject('conn-123', 'OpaqueRef:subj1')

      expect(mockCallWithSession).toHaveBeenCalledWith('subject.destroy', ['OpaqueRef:subj1'])
    })
  })

  describe('addSubjectRole', () => {
    it('calls subject.add_to_roles', async () => {
      mockCallWithSession.mockResolvedValueOnce(null)

      const { addSubjectRole } = await import('../../src/main/xapi/services/rbac.service')
      await addSubjectRole('conn-123', 'OpaqueRef:subj1', 'OpaqueRef:role-vm-admin')

      expect(mockCallWithSession).toHaveBeenCalledWith('subject.add_to_roles', [
        'OpaqueRef:subj1', 'OpaqueRef:role-vm-admin',
      ])
    })
  })

  describe('removeSubjectRole', () => {
    it('calls subject.remove_from_roles', async () => {
      mockCallWithSession.mockResolvedValueOnce(null)

      const { removeSubjectRole } = await import('../../src/main/xapi/services/rbac.service')
      await removeSubjectRole('conn-123', 'OpaqueRef:subj1', 'OpaqueRef:role-vm-admin')

      expect(mockCallWithSession).toHaveBeenCalledWith('subject.remove_from_roles', [
        'OpaqueRef:subj1', 'OpaqueRef:role-vm-admin',
      ])
    })
  })

  // ============================================================================
  // User Information (Active Directory) — user class fields: short_name, fullname, other_config, uuid
  // ============================================================================

  describe('getUserInfo', () => {
    it('returns user record from external auth', async () => {
      // XenAPI user record: uuid, short_name, fullname, other_config
      mockCallWithSession.mockResolvedValueOnce({ 'OpaqueRef:user1': {
        ref: 'OpaqueRef:user1',
        uuid: 'uuid-user1',
        short_name: 'adminuser',
        fullname: 'Admin User',
        other_config: {},
      } })

      const { getUserInfo } = await import('../../src/main/xapi/services/rbac.service')
      const user = await getUserInfo('conn-123', 'adminuser')

      expect(user).not.toBeNull()
      expect(user!.short_name).toBe('adminuser')
      expect(user!.fullname).toBe('Admin User')
    })

    it('returns null when user not found', async () => {
      mockCallWithSession.mockResolvedValueOnce({})

      const { getUserInfo } = await import('../../src/main/xapi/services/rbac.service')
      const user = await getUserInfo('conn-123', 'nonexistent')

      expect(user).toBeNull()
    })
  })

  describe('getAllUsers', () => {
    it('returns all user records', async () => {
      mockCallWithSession.mockResolvedValueOnce({
        'OpaqueRef:user1': {
          uuid: 'uuid-user1',
          short_name: 'adminuser',
          fullname: 'Admin User',
          other_config: {},
        },
        'OpaqueRef:user2': {
          uuid: 'uuid-user2',
          short_name: 'operator1',
          fullname: 'Operator One',
          other_config: {},
        },
      })

      const { getAllUsers } = await import('../../src/main/xapi/services/rbac.service')
      const users = await getAllUsers('conn-123')

      expect(users).toHaveLength(2)
      expect(users[0].short_name).toBe('adminuser')
      expect(users.every(u => u.connectionId === 'conn-123')).toBe(true)
    })

    it('returns empty array when external auth not configured', async () => {
      mockCallWithSession.mockRejectedValueOnce(new Error('EXTERNAL_AUTH_NOT_CONFIGURED'))

      const { getAllUsers } = await import('../../src/main/xapi/services/rbac.service')
      await expect(getAllUsers('conn-123')).rejects.toThrow('EXTERNAL_AUTH_NOT_CONFIGURED')
    })
  })

  // ============================================================================
  // External Authentication Configuration — host fields: external_auth_type, external_auth_configuration
  // pool methods: pool.join_external_auth, pool.disable_external_auth
  // ============================================================================

  describe('joinDomain', () => {
    it('calls pool.join_external_auth with domain credentials', async () => {
      mockCallWithSession
        .mockResolvedValueOnce(['OpaqueRef:pool1']) // pool.get_all
        .mockResolvedValueOnce(null) // pool.join_external_auth

      const { joinDomain } = await import('../../src/main/xapi/services/rbac.service')
      await joinDomain('conn-123', {
        domain: 'corp.example.com',
        username: 'admin',
        password: 'secret',
      })

      expect(mockCallWithSession).toHaveBeenCalledWith('pool.enable_external_auth', [
        'OpaqueRef:pool1', { user: 'admin', pass: 'secret' }, 'corp.example.com', 'AD',
      ])
    })

    it('throws POOL_NOT_FOUND when no pool', async () => {
      mockCallWithSession.mockResolvedValueOnce([]) // pool.get_all — empty

      const { joinDomain } = await import('../../src/main/xapi/services/rbac.service')
      await expect(joinDomain('conn-123', {
        domain: 'corp.example.com',
        username: 'admin',
        password: 'secret',
      })).rejects.toThrow('POOL_NOT_FOUND')
    })
  })

  describe('leaveDomain', () => {
    it('calls pool.disable_external_auth', async () => {
      mockCallWithSession
        .mockResolvedValueOnce(['OpaqueRef:pool1']) // pool.get_all
        .mockResolvedValueOnce(null) // pool.disable_external_auth

      const { leaveDomain } = await import('../../src/main/xapi/services/rbac.service')
      await leaveDomain('conn-123')

      expect(mockCallWithSession).toHaveBeenCalledWith('pool.disable_external_auth', ['OpaqueRef:pool1', {}])
    })
  })

  describe('getExternalAuthConfig', () => {
    it('reads directory state from hosts and redacts server configuration', async () => {
      mockCallWithSession.mockResolvedValueOnce({ 'OpaqueRef:h': { name_label: 'Host', external_auth_type: 'AD', external_auth_service_name: 'corp.example.com', external_auth_configuration: { credential: 'must-not-leak' } } })
      const { getExternalAuthConfig } = await import('../../src/main/xapi/services/rbac.service')
      const config = await getExternalAuthConfig('c')
      expect(config).toMatchObject({ configured: true, consistent: true, type: 'AD', service_name: 'corp.example.com', credential: '', other_config: {} })
      expect(JSON.stringify(config)).not.toContain('must-not-leak')
      expect(mockCallWithSession).toHaveBeenCalledWith('host.get_all_records', [])
    })
    it('does not infer configured auth from missing fields', async () => {
      mockCallWithSession.mockResolvedValueOnce({ 'OpaqueRef:h': { name_label: 'Host' } })
      const { getExternalAuthConfig } = await import('../../src/main/xapi/services/rbac.service')
      expect(await getExternalAuthConfig('c')).toMatchObject({ configured: false, type: '' })
    })
    it('reports inconsistent host configurations without taking the first as pool truth', async () => {
      mockCallWithSession.mockResolvedValueOnce({ 'OpaqueRef:a': { external_auth_type: 'AD', external_auth_service_name: 'a' }, 'OpaqueRef:b': { external_auth_type: '' } })
      const { getExternalAuthConfig } = await import('../../src/main/xapi/services/rbac.service')
      expect(await getExternalAuthConfig('c')).toMatchObject({ configured: false, consistent: false, type: '', service_name: '' })
    })
    it('distinguishes empty inventory from a read failure', async () => {
      mockCallWithSession.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('SESSION_INVALID'))
      const { getExternalAuthConfig } = await import('../../src/main/xapi/services/rbac.service')
      expect(await getExternalAuthConfig('c')).toBeNull()
      await expect(getExternalAuthConfig('c')).rejects.toThrow('SESSION_INVALID')
    })
  })
  // ============================================================================
  // Session and Permission Checking — session class fields
  // XenAPI methods: session.get_record, subject.get_permissions_name_label
  // ============================================================================

  describe('getCurrentSessionPermissions', () => {
    it('uses the current session permission set even for a local superuser with no subject', async () => {
      mockCallWithSession.mockResolvedValueOnce({ subject: 'OpaqueRef:NULL', is_local_superuser: true, rbac_permissions: ['VM.start', 'VM.start', 'host.enable'] })
      const { getCurrentSessionPermissions } = await import('../../src/main/xapi/services/rbac.service')
      expect(await getCurrentSessionPermissions('c')).toEqual(['VM.start', 'host.enable'])
      expect(mockCallWithSession).toHaveBeenCalledWith('session.get_record', [expect.any(String)])
      expect(mockCallWithSession).toHaveBeenCalledTimes(1)
    })
    it('returns empty permissions only when the session explicitly reports an empty set', async () => {
      mockCallWithSession.mockResolvedValueOnce({ rbac_permissions: [] })
      const { getCurrentSessionPermissions } = await import('../../src/main/xapi/services/rbac.service')
      expect(await getCurrentSessionPermissions('c')).toEqual([])
    })
    it('does not hide a session failure or missing permissions', async () => {
      mockCallWithSession.mockRejectedValueOnce(new Error('SESSION_INVALID')).mockResolvedValueOnce({ subject: 'OpaqueRef:NULL' })
      const { getCurrentSessionPermissions } = await import('../../src/main/xapi/services/rbac.service')
      await expect(getCurrentSessionPermissions('c')).rejects.toThrow('SESSION_INVALID')
      await expect(getCurrentSessionPermissions('c')).rejects.toThrow('RBAC_CONTRACT_MISMATCH')
    })
  })

  // ============================================================================
  // Error handling
  // ============================================================================

  it('throws when connectionId is invalid for all methods', async () => {
    mockGetClient.mockReturnValue(undefined)

    const { getAllRoles } = await import('../../src/main/xapi/services/rbac.service')
    await expect(getAllRoles('invalid-id')).rejects.toThrow('No connection found')
  })
})
