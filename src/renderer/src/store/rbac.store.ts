/**
 * RBAC (Role-Based Access Control) store — manages roles, subjects, and permissions.
 * v9: New store for RBAC user permission management.
 */
import type { RbacExternalAuthConfig } from '../../../shared/ipc-contracts/rbac-governance'
import { create } from 'zustand'
import { useConnectionManagerStore } from './connectionManager.store'

// ============================================================================
// Types
// ============================================================================

export interface RoleRecord {
  ref: string
  uuid: string
  name_label: string
  name_description: string
  subroles: string[]
  policies: string[]
  connectionId: string
  poolName: string
}

export interface SubjectRecord {
  ref: string
  uuid: string
  subject_identifier: string
  other_config: Record<string, string>
  roles: string[]
  authentication_policy: string
  connectionId: string
  poolName: string
}

export interface SubjectWithRoles {
  subject: SubjectRecord
  roleNames: string[]
  allPermissions: string[]
}

// ============================================================================
// Store
// ============================================================================

interface RbacState {
  // Roles
  roles: RoleRecord[]
  rolesLoading: boolean
  rolesError: string | null

  // Subjects
  subjects: SubjectRecord[]
  subjectsLoading: boolean
  subjectsError: string | null

  // Subjects with role details
  subjectsWithRoles: SubjectWithRoles[]
  subjectsWithRolesLoading: boolean
  subjectsWithRolesError: string | null

  // Actions - Roles
  loadRoles: (connectionId?: string) => Promise<void>
  getRolePermissions: (roleRef: string, connectionId?: string) => Promise<string[]>

  // Actions - Subjects
  loadSubjects: (connectionId?: string) => Promise<void>
  loadSubjectsWithRoles: (connectionId?: string) => Promise<void>
  addSubject: (params: { subjectIdentifier: string; roles: string[] }, connectionId?: string) => Promise<string>
  removeSubject: (subjectRef: string, connectionId?: string) => Promise<void>
  addSubjectRole: (subjectRef: string, roleRef: string, connectionId?: string) => Promise<void>
  removeSubjectRole: (subjectRef: string, roleRef: string, connectionId?: string) => Promise<void>

  // Actions - External Auth
  getExtAuthConfig: (connectionId?: string) => Promise<RbacExternalAuthConfig | null>
  joinDomain: (params: { domain: string; username: string; password: string }, connectionId?: string) => Promise<void>
  leaveDomain: (connectionId?: string) => Promise<void>

  // Actions - Session
  getSessionPermissions: (connectionId?: string) => Promise<string[]>
}

function resolveConnectionId(connectionId?: string): string {
  return connectionId || useConnectionManagerStore.getState().activeConnectionId || ''
}

const requestVersions: Record<string, number> = {}

export const useRbacStore = create<RbacState>((set, get) => ({
  // Initial state
  roles: [],
  rolesLoading: false,
  rolesError: null,
  subjects: [],
  subjectsLoading: false,
  subjectsError: null,
  subjectsWithRoles: [],
  subjectsWithRolesLoading: false,
  subjectsWithRolesError: null,

  // Role actions
  loadRoles: async (connectionIdArg) => {
    const connectionId = resolveConnectionId(connectionIdArg)
    const version = requestVersions.loadRoles = (requestVersions.loadRoles || 0) + 1
    if (!connectionId) return

    set({ roles: [], rolesLoading: true, rolesError: null })
    try {
      const roles = await window.xapi.rbac.roleList(connectionId)
      if (version !== requestVersions.loadRoles) return
      set({ roles, rolesLoading: false })
    } catch (err: any) {
      if (version !== requestVersions.loadRoles) return
      set({ rolesError: err.message, rolesLoading: false })
    }
  },

  getRolePermissions: async (roleRef: string, connectionIdArg) => {
    const connectionId = resolveConnectionId(connectionIdArg)
    if (!connectionId) throw new Error('No active connection')

    return await window.xapi.rbac.rolePermissions(connectionId, roleRef)
  },

  // Subject actions
  loadSubjects: async (connectionIdArg) => {
    const connectionId = resolveConnectionId(connectionIdArg)
    const version = requestVersions.loadSubjects = (requestVersions.loadSubjects || 0) + 1
    if (!connectionId) return

    set({ subjects: [], subjectsLoading: true, subjectsError: null })
    try {
      const subjects = await window.xapi.rbac.subjectList(connectionId)
      if (version !== requestVersions.loadSubjects) return
      set({ subjects, subjectsLoading: false })
    } catch (err: any) {
      if (version !== requestVersions.loadSubjects) return
      set({ subjectsError: err.message, subjectsLoading: false })
    }
  },

  loadSubjectsWithRoles: async (connectionIdArg) => {
    const connectionId = resolveConnectionId(connectionIdArg)
    const version = requestVersions.loadSubjectsWithRoles = (requestVersions.loadSubjectsWithRoles || 0) + 1
    if (!connectionId) return

    set({ subjectsWithRoles: [], subjectsWithRolesLoading: true, subjectsWithRolesError: null })
    try {
      const subjectsWithRoles = await window.xapi.rbac.subjectWithRoles(connectionId)
      if (version !== requestVersions.loadSubjectsWithRoles) return
      set({ subjectsWithRoles, subjectsWithRolesLoading: false })
    } catch (err: any) {
      if (version !== requestVersions.loadSubjectsWithRoles) return
      set({ subjectsWithRolesLoading: false, subjectsWithRolesError: err.message })
    }
  },

  addSubject: async (params, connectionIdArg) => {
    const connectionId = resolveConnectionId(connectionIdArg)
    if (!connectionId) throw new Error('No active connection')

    const subjectRef = await window.xapi.rbac.subjectAdd(connectionId, params)
    await get().loadSubjects(connectionId)
    await get().loadSubjectsWithRoles(connectionId)
    return subjectRef
  },

  removeSubject: async (subjectRef: string, connectionIdArg) => {
    const connectionId = resolveConnectionId(connectionIdArg)
    if (!connectionId) throw new Error('No active connection')

    await window.xapi.rbac.subjectRemove(connectionId, subjectRef)
    await get().loadSubjects(connectionId)
    await get().loadSubjectsWithRoles(connectionId)
  },

  addSubjectRole: async (subjectRef: string, roleRef: string, connectionIdArg) => {
    const connectionId = resolveConnectionId(connectionIdArg)
    if (!connectionId) throw new Error('No active connection')

    await window.xapi.rbac.subjectAddRole(connectionId, subjectRef, roleRef)
    await get().loadSubjects(connectionId)
    await get().loadSubjectsWithRoles(connectionId)
  },

  removeSubjectRole: async (subjectRef: string, roleRef: string, connectionIdArg) => {
    const connectionId = resolveConnectionId(connectionIdArg)
    if (!connectionId) throw new Error('No active connection')

    await window.xapi.rbac.subjectRemoveRole(connectionId, subjectRef, roleRef)
    await get().loadSubjects(connectionId)
    await get().loadSubjectsWithRoles(connectionId)
  },

  // External auth actions
  getExtAuthConfig: async (connectionIdArg) => {
    const connectionId = resolveConnectionId(connectionIdArg)
    if (!connectionId) throw new Error('No active connection')

    return await window.xapi.rbac.extAuthConfig(connectionId)
  },

  joinDomain: async (params, connectionIdArg) => {
    const connectionId = resolveConnectionId(connectionIdArg)
    if (!connectionId) throw new Error('No active connection')

    await window.xapi.rbac.joinDomain(connectionId, params)
  },

  leaveDomain: async (connectionIdArg) => {
    const connectionId = resolveConnectionId(connectionIdArg)
    if (!connectionId) throw new Error('No active connection')

    await window.xapi.rbac.leaveDomain(connectionId)
  },

  // Session permissions
  getSessionPermissions: async (connectionIdArg) => {
    const connectionId = resolveConnectionId(connectionIdArg)
    if (!connectionId) throw new Error('No active connection')

    return await window.xapi.rbac.sessionPermissions(connectionId)
  },
}))
