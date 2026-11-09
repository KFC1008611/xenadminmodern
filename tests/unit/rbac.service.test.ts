/**
 * Unit tests for RBAC service.
 * Tests the RBAC service functions that interact with XAPI.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock the connection manager
vi.mock('../../src/main/xapi/connection-manager', () => ({
  connectionManager: {
    getClient: vi.fn(),
    getConnectionInfo: vi.fn(),
  },
}))

import { connectionManager } from '../../src/main/xapi/connection-manager'
import * as rbacService from '../../src/main/xapi/services/rbac.service'

const mockClient = {
  callWithSession: vi.fn(),
  getSessionRef: vi.fn(() => 'test-session-id'),
}

const mockConnectionId = 'test-conn-1'
const mockPoolName = 'Test Pool'

beforeEach(() => {
  vi.resetAllMocks()
  mockClient.getSessionRef.mockReturnValue('OpaqueRef:session')
  vi.mocked(connectionManager.getClient).mockReturnValue(mockClient)
  vi.mocked(connectionManager.getConnectionInfo).mockReturnValue({
    id: mockConnectionId,
    name: 'Test Connection',
    host: 'test.example.com',
    poolName: mockPoolName,
    poolRef: 'OpaqueRef:pool-1',
    state: 'connected',
    errorMessage: null,
    connectedAt: Date.now(),
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('rbac.service', () => {
  describe('getAllRoles', () => {
    it('should return all roles with connection metadata', async () => {
      const mockRoles = {
        'OpaqueRef:role-1': {
          uuid: 'uuid-1',
          name_label: 'Pool Admin',
          name_description: 'Pool administrator',
          subroles: [],
          policies: ['pool_admin'],
        },
      }

      mockClient.callWithSession.mockResolvedValueOnce(mockRoles)
        .mockResolvedValueOnce(['pool_admin'])

      const result = await rbacService.getAllRoles(mockConnectionId)

      expect(connectionManager.getClient).toHaveBeenCalledWith(mockConnectionId)
      expect(mockClient.callWithSession).toHaveBeenCalledWith('role.get_all_records', [])
      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        ref: 'OpaqueRef:role-1',
        uuid: 'uuid-1',
        name_label: 'Pool Admin',
        connectionId: mockConnectionId,
        poolName: mockPoolName,
      })
      expect(result[0].policies).toEqual(['pool_admin'])
    })

    it('should return empty array when no roles exist', async () => {
      mockClient.callWithSession.mockResolvedValueOnce({})

      const result = await rbacService.getAllRoles(mockConnectionId)

      expect(result).toEqual([])
    })
  })

  describe('getRoleRecord', () => {
    it('should return a specific role record', async () => {
      const mockRecord = {
        uuid: 'uuid-1',
        name_label: 'Pool Admin',
        name_description: 'Administrator',
        subroles: [],
        policies: ['pool_admin'],
      }

      mockClient.callWithSession
        .mockResolvedValueOnce(mockRecord)
        .mockResolvedValueOnce(['pool_admin'])

      const result = await rbacService.getRoleRecord(mockConnectionId, 'OpaqueRef:role-1')

      expect(result).not.toBeNull()
      expect(result?.ref).toBe('OpaqueRef:role-1')
      expect(result?.name_label).toBe('Pool Admin')
      expect(result?.policies).toEqual(['pool_admin'])
    })

    it('should return null for invalid role reference', async () => {
      mockClient.callWithSession.mockRejectedValueOnce(
        new Error('UUID_INVALID: role reference invalid')
      )

      const result = await rbacService.getRoleRecord(mockConnectionId, 'invalid-ref')

      expect(result).toBeNull()
    })
  })

  describe('getRolePermissions', () => {
    it('should collect permissions from role and subroles', async () => {
      mockClient.callWithSession
        .mockResolvedValueOnce(['vm.manage', 'vm.view'])

      const result = await rbacService.getRolePermissions(mockConnectionId, 'OpaqueRef:role-1')

      expect(result).toContain('vm.manage')
      expect(result).toContain('vm.view')
      expect(result).toHaveLength(2)
      expect(mockClient.callWithSession).toHaveBeenCalledWith(
        'role.get_permissions_name_label',
        ['OpaqueRef:role-1']
      )
    })
  })

  describe('getAllSubjects', () => {
    it('should return all subjects with connection metadata', async () => {
      const mockSubjects = {
        'OpaqueRef:subject-1': {
          uuid: 'uuid-1',
          subject_identifier: 'DOMAIN\\user1',
          other_config: {},
          roles: ['OpaqueRef:role-1'],
          authentication_policy: 'AD',
        },
      }

      mockClient.callWithSession.mockResolvedValueOnce(mockSubjects)

      const result = await rbacService.getAllSubjects(mockConnectionId)

      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        ref: 'OpaqueRef:subject-1',
        subject_identifier: 'DOMAIN\\user1',
        roles: ['OpaqueRef:role-1'],
        connectionId: mockConnectionId,
        poolName: mockPoolName,
      })
    })
  })

  describe('getSubjectsWithRoles', () => {
    it('should return subjects with role details', async () => {
      mockClient.callWithSession
        .mockResolvedValueOnce({ // subject.get_all_records
          'OpaqueRef:subject-1': {
            uuid: 'uuid-1',
            subject_identifier: 'user1',
            other_config: {},
            roles: ['OpaqueRef:role-1'],
            authentication_policy: 'AD',
          },
        })
        .mockResolvedValueOnce({ // role.get_all_records
          'OpaqueRef:role-1': {
            uuid: 'uuid-1',
            name_label: 'Pool Admin',
            name_description: 'Admin',
            subroles: [],
          },
        })
        .mockResolvedValueOnce(['pool_admin'])

      const result = await rbacService.getSubjectsWithRoles(mockConnectionId)

      expect(result).toHaveLength(1)
      expect(result[0].roleNames).toContain('Pool Admin')
      expect(result[0].allPermissions).toContain('pool_admin')
    })
  })

  describe('addSubject', () => {
    it('should add subject and assign roles', async () => {
      mockClient.callWithSession
        .mockResolvedValueOnce('OpaqueRef:subject-new') // subject.create
        .mockResolvedValueOnce(undefined) // subject.add_to_roles

      const result = await rbacService.addSubject(mockConnectionId, {
        subjectIdentifier: 'DOMAIN\\user1',
        roles: ['OpaqueRef:role-1'],
      })

      expect(result).toBe('OpaqueRef:subject-new')
      expect(mockClient.callWithSession).toHaveBeenCalledWith(
        'subject.create',
        [{ subject_identifier: 'DOMAIN\\user1', other_config: {} }]
      )
      expect(mockClient.callWithSession).toHaveBeenCalledWith(
        'subject.add_to_roles',
        ['OpaqueRef:subject-new', 'OpaqueRef:role-1']
      )
    })
  })

  describe('removeSubject', () => {
    it('should remove subject from pool', async () => {
      mockClient.callWithSession.mockResolvedValueOnce(undefined)

      await rbacService.removeSubject(mockConnectionId, 'OpaqueRef:subject-1')

      expect(mockClient.callWithSession).toHaveBeenCalledWith(
        'subject.destroy',
        ['OpaqueRef:subject-1']
      )
    })
  })

  describe('addSubjectRole', () => {
    it('should add role to subject', async () => {
      mockClient.callWithSession.mockResolvedValueOnce(undefined)

      await rbacService.addSubjectRole(
        mockConnectionId,
        'OpaqueRef:subject-1',
        'OpaqueRef:role-1'
      )

      expect(mockClient.callWithSession).toHaveBeenCalledWith(
        'subject.add_to_roles',
        ['OpaqueRef:subject-1', 'OpaqueRef:role-1']
      )
    })
  })

  describe('removeSubjectRole', () => {
    it('should remove role from subject', async () => {
      mockClient.callWithSession.mockResolvedValueOnce(undefined)

      await rbacService.removeSubjectRole(
        mockConnectionId,
        'OpaqueRef:subject-1',
        'OpaqueRef:role-1'
      )

      expect(mockClient.callWithSession).toHaveBeenCalledWith(
        'subject.remove_from_roles',
        ['OpaqueRef:subject-1', 'OpaqueRef:role-1']
      )
    })
  })

  describe('getAllUsers', () => {
    it('should return all users from external auth', async () => {
      const mockUsers = {
        'OpaqueRef:user-1': {
          uuid: 'uuid-1',
          short_name: 'user1',
          fullname: 'User One',
          other_config: {},
        },
      }

      mockClient.callWithSession.mockResolvedValueOnce(mockUsers)

      const result = await rbacService.getAllUsers(mockConnectionId)

      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        short_name: 'user1',
        fullname: 'User One',
      })
    })

    it('should return empty array when external auth not configured', async () => {
      mockClient.callWithSession.mockRejectedValueOnce(
        new Error('EXTERNAL_AUTH_ERROR')
      )

      await expect(rbacService.getAllUsers(mockConnectionId)).rejects.toThrow('EXTERNAL_AUTH_ERROR')
    })
  })

  describe('getExternalAuthConfig', () => {
    it('reads directory state from hosts and redacts server configuration', async () => {
      mockClient.callWithSession.mockResolvedValueOnce({ 'OpaqueRef:h': { name_label: 'Host', external_auth_type: 'AD', external_auth_service_name: 'corp.example.com', external_auth_configuration: { credential: 'must-not-leak' } } })
      const config = await rbacService.getExternalAuthConfig('c')
      expect(config).toMatchObject({ configured: true, consistent: true, type: 'AD', service_name: 'corp.example.com', credential: '', other_config: {} })
      expect(JSON.stringify(config)).not.toContain('must-not-leak')
      expect(mockClient.callWithSession).toHaveBeenCalledWith('host.get_all_records', [])
    })
    it('does not infer configured auth from missing fields', async () => {
      mockClient.callWithSession.mockResolvedValueOnce({ 'OpaqueRef:h': { name_label: 'Host' } })
      expect(await rbacService.getExternalAuthConfig('c')).toMatchObject({ configured: false, type: '' })
    })
    it('reports inconsistent host configurations without taking the first as pool truth', async () => {
      mockClient.callWithSession.mockResolvedValueOnce({ 'OpaqueRef:a': { external_auth_type: 'AD', external_auth_service_name: 'a' }, 'OpaqueRef:b': { external_auth_type: '' } })
      expect(await rbacService.getExternalAuthConfig('c')).toMatchObject({ configured: false, consistent: false, type: '', service_name: '' })
    })
    it('distinguishes empty inventory from a read failure', async () => {
      mockClient.callWithSession.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('SESSION_INVALID'))
      expect(await rbacService.getExternalAuthConfig('c')).toBeNull()
      await expect(rbacService.getExternalAuthConfig('c')).rejects.toThrow('SESSION_INVALID')
    })
  })

  describe('joinDomain', () => {
    it('should join AD domain', async () => {
      mockClient.callWithSession
        .mockResolvedValueOnce(['OpaqueRef:pool-1'])
        .mockResolvedValueOnce(undefined)

      await rbacService.joinDomain(mockConnectionId, {
        domain: 'example.com',
        username: 'admin',
        password: 'secret',
      })

      expect(mockClient.callWithSession).toHaveBeenCalledWith(
        'pool.enable_external_auth',
        ['OpaqueRef:pool-1', { user: 'admin', pass: 'secret' }, 'example.com', 'AD']
      )
    })
  })

  describe('leaveDomain', () => {
    it('should leave AD domain', async () => {
      mockClient.callWithSession
        .mockResolvedValueOnce(['OpaqueRef:pool-1'])
        .mockResolvedValueOnce(undefined)

      await rbacService.leaveDomain(mockConnectionId)

      expect(mockClient.callWithSession).toHaveBeenCalledWith(
        'pool.disable_external_auth',
        ['OpaqueRef:pool-1', {}]
      )
    })
  })

  describe('getCurrentSessionPermissions', () => {
    it('uses the current session permission set even for a local superuser with no subject', async () => {
      mockClient.callWithSession.mockResolvedValueOnce({ subject: 'OpaqueRef:NULL', is_local_superuser: true, rbac_permissions: ['VM.start', 'VM.start', 'host.enable'] })
      expect(await rbacService.getCurrentSessionPermissions('c')).toEqual(['VM.start', 'host.enable'])
      expect(mockClient.callWithSession).toHaveBeenCalledWith('session.get_record', [expect.any(String)])
      expect(mockClient.callWithSession).toHaveBeenCalledTimes(1)
    })
    it('returns empty permissions only when the session explicitly reports an empty set', async () => {
      mockClient.callWithSession.mockResolvedValueOnce({ rbac_permissions: [] })
      expect(await rbacService.getCurrentSessionPermissions('c')).toEqual([])
    })
    it('does not hide a session failure or missing permissions', async () => {
      mockClient.callWithSession.mockRejectedValueOnce(new Error('SESSION_INVALID')).mockResolvedValueOnce({ subject: 'OpaqueRef:NULL' })
      await expect(rbacService.getCurrentSessionPermissions('c')).rejects.toThrow('SESSION_INVALID')
      await expect(rbacService.getCurrentSessionPermissions('c')).rejects.toThrow('RBAC_CONTRACT_MISMATCH')
    })
  })

})
