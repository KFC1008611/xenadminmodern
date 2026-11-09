/**
 * RBAC (Role-Based Access Control) service — wraps XAPI role.*, subject.*, and user.* methods.
 * All functions accept connectionId as the first parameter for multi-connection support.
 * v9: New service for RBAC user permission management.
 */
import { connectionManager } from '../connection-manager'
import type { RbacExternalAuthConfig } from '../../../shared/ipc-contracts/rbac-governance'


function getClient(connectionId: string) {
  const client = connectionManager.getClient(connectionId)
  if (!client) {
    throw new Error(`No connection found for connectionId: ${connectionId}`)
  }
  return client
}

function getPoolName(connectionId: string): string {
  return connectionManager.getConnectionInfo(connectionId)?.poolName ?? connectionId
}

async function getRolePermissionNames(
  client: ReturnType<typeof getClient>,
  roleRef: string
): Promise<string[]> {
  const permissions = await client.callWithSession('role.get_permissions_name_label', [roleRef])
  if (!Array.isArray(permissions) || permissions.some((permission) => typeof permission !== 'string')) throw new Error('RBAC_CONTRACT_MISMATCH: Invalid permission list')
  return [...new Set(permissions)]
}

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
}

export interface ConnectedRoleRecord extends RoleRecord {
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
}

export interface ConnectedSubjectRecord extends SubjectRecord {
  connectionId: string
  poolName: string
}

export interface UserRecord {
  ref: string
  uuid: string
  short_name: string
  fullname: string
  other_config: Record<string, string>
}

export interface ConnectedUserRecord extends UserRecord {
  connectionId: string
  poolName: string
}

export interface SubjectWithRoles {
  subject: ConnectedSubjectRecord
  roleNames: string[]
  allPermissions: string[]
}

// ============================================================================
// Role Management
// ============================================================================

/**
 * Get all roles in the pool.
 */
export async function getAllRoles(
  connectionId: string
): Promise<ConnectedRoleRecord[]> {
  const client = getClient(connectionId)
  const poolName = getPoolName(connectionId)

  const allRecords: Record<string, any> = await client.callWithSession(
    'role.get_all_records',
    []
  )

  return Promise.all(Object.entries(allRecords).map(async ([ref, record]: [string, any]) => ({
    ref,
    uuid: record.uuid || '',
    name_label: record.name_label || '',
    name_description: record.name_description || '',
    subroles: record.subroles || [],
    policies: await getRolePermissionNames(client, ref),
    connectionId,
    poolName,
  })))
}

/**
 * Get a specific role record.
 */
export async function getRoleRecord(
  connectionId: string,
  roleRef: string
): Promise<ConnectedRoleRecord | null> {
  const client = getClient(connectionId)
  const poolName = getPoolName(connectionId)

  try {
    const record = await client.callWithSession('role.get_record', [roleRef])
    return {
      ref: roleRef,
      uuid: record.uuid || '',
      name_label: record.name_label || '',
      name_description: record.name_description || '',
      subroles: record.subroles || [],
      policies: await getRolePermissionNames(client, roleRef),
      connectionId,
      poolName,
    }
  } catch (err: any) {
    if (err?.message?.includes('UUID_INVALID') || err?.message?.includes('HANDLE_INVALID')) {
      return null
    }
    throw err
  }
}

/**
 * Get all permissions for a role (including inherited from subroles).
 */
export async function getRolePermissions(
  connectionId: string,
  roleRef: string
): Promise<string[]> {
  const client = getClient(connectionId)
  return getRolePermissionNames(client, roleRef)
}

// ============================================================================
// Subject Management
// ============================================================================

/**
 * Get all subjects (users/groups) in the pool.
 */
export async function getAllSubjects(
  connectionId: string
): Promise<ConnectedSubjectRecord[]> {
  const client = getClient(connectionId)
  const poolName = getPoolName(connectionId)

  const allRecords: Record<string, any> = await client.callWithSession(
    'subject.get_all_records',
    []
  )

  return Object.entries(allRecords).map(([ref, record]: [string, any]) => ({
    ref,
    uuid: record.uuid || '',
    subject_identifier: record.subject_identifier || '',
    other_config: record.other_config || {},
    roles: record.roles || [],
    authentication_policy: record.authentication_policy || '',
    connectionId,
    poolName,
  }))
}

/**
 * Get a specific subject record.
 */
export async function getSubjectRecord(
  connectionId: string,
  subjectRef: string
): Promise<ConnectedSubjectRecord | null> {
  const client = getClient(connectionId)
  const poolName = getPoolName(connectionId)

  try {
    const record = await client.callWithSession('subject.get_record', [subjectRef])
    return {
      ref: subjectRef,
      uuid: record.uuid || '',
      subject_identifier: record.subject_identifier || '',
      other_config: record.other_config || {},
      roles: record.roles || [],
      authentication_policy: record.authentication_policy || '',
      connectionId,
      poolName,
    }
  } catch (err: any) {
    if (err?.message?.includes('UUID_INVALID') || err?.message?.includes('HANDLE_INVALID')) {
      return null
    }
    throw err
  }
}

/**
 * Get subjects with their role details.
 */
export async function getSubjectsWithRoles(
  connectionId: string
): Promise<SubjectWithRoles[]> {
  const subjects = await getAllSubjects(connectionId)
  const roles = await getAllRoles(connectionId)
  const roleMap = new Map(roles.map((r) => [r.ref, r]))

  const results: SubjectWithRoles[] = []

  for (const subject of subjects) {
    const roleNames: string[] = []
    const allPermissions: string[] = []

    for (const roleRef of subject.roles) {
      const role = roleMap.get(roleRef)
      if (!role) throw new Error(`RBAC_INVENTORY_INCOMPLETE: Missing role ${roleRef}`)
      if (role) {
        roleNames.push(role.name_label)
        allPermissions.push(...role.policies)
      }
    }

    results.push({
      subject,
      roleNames,
      allPermissions: [...new Set(allPermissions)],
    })
  }

  return results
}

/**
 * Add a subject (user/group) to the pool.
 */
export async function addSubject(
  connectionId: string,
  params: {
    subjectIdentifier: string // AD SID or UPN
    roles: string[] // Role refs
  }
): Promise<string> {
  const client = getClient(connectionId)

  const subjectRef = await client.callWithSession('subject.create', [{
    subject_identifier: params.subjectIdentifier,
    other_config: {},
  }])

  // Assign roles
  for (const roleRef of params.roles) {
    await client.callWithSession(
      'subject.add_to_roles',
      [subjectRef, roleRef]
    )
  }

  return subjectRef
}

/**
 * Remove a subject from the pool.
 */
export async function removeSubject(
  connectionId: string,
  subjectRef: string
): Promise<void> {
  const client = getClient(connectionId)
  await client.callWithSession('subject.destroy', [subjectRef])
}

/**
 * Add a role to a subject.
 */
export async function addSubjectRole(
  connectionId: string,
  subjectRef: string,
  roleRef: string
): Promise<void> {
  const client = getClient(connectionId)
  await client.callWithSession('subject.add_to_roles', [subjectRef, roleRef])
}

/**
 * Remove a role from a subject.
 */
export async function removeSubjectRole(
  connectionId: string,
  subjectRef: string,
  roleRef: string
): Promise<void> {
  const client = getClient(connectionId)
  await client.callWithSession('subject.remove_from_roles', [subjectRef, roleRef])
}

// ============================================================================
// User Information (Active Directory)
// ============================================================================

/**
 * Find a legacy local user by its short name.
 */
export async function getUserInfo(
  connectionId: string,
  username: string
): Promise<UserRecord | null> {
  const users = await getAllUsers(connectionId)
  const record = users.find((user) => user.short_name === username)
  if (!record) return null
  return { ref: record.ref, uuid: record.uuid, short_name: record.short_name, fullname: record.fullname, other_config: record.other_config }

}

/**
 * Get legacy local user records. External directory identities are subject records.
 */
export async function getAllUsers(
  connectionId: string
): Promise<ConnectedUserRecord[]> {
  const client = getClient(connectionId)
  const poolName = getPoolName(connectionId)

  const allRecords: Record<string, any> = await client.callWithSession(
      'user.get_all_records',
      []
    )

    return Object.entries(allRecords).map(([ref, record]: [string, any]) => ({
      ref,
      uuid: record.uuid || '',
      short_name: record.short_name || '',
      fullname: record.fullname || '',
      other_config: record.other_config || {},
      connectionId,
      poolName,
    }))

}

// ============================================================================
// External Authentication Configuration
// ============================================================================

/**
 * Join an Active Directory domain.
 */
export async function joinDomain(
  connectionId: string,
  params: {
    domain: string
    username: string
    password: string
  }
): Promise<void> {
  const client = getClient(connectionId)

  const poolRefs: string[] = await client.callWithSession('pool.get_all', [])
  if (poolRefs.length === 0) {
    throw new Error('POOL_NOT_FOUND: Not connected to a pool')
  }

  await client.callWithSession(
    'pool.enable_external_auth',
    [poolRefs[0], { user: params.username, pass: params.password }, params.domain, 'AD']
  )
}

/**
 * Leave the Active Directory domain.
 */
export async function leaveDomain(
  connectionId: string
): Promise<void> {
  const client = getClient(connectionId)

  const poolRefs: string[] = await client.callWithSession('pool.get_all', [])
  if (poolRefs.length === 0) {
    throw new Error('POOL_NOT_FOUND: Not connected to a pool')
  }

  await client.callWithSession('pool.disable_external_auth', [poolRefs[0], {}])
}

/**
 * Get external authentication configuration.
 */
export async function getExternalAuthConfig(
  connectionId: string
): Promise<RbacExternalAuthConfig | null> {
  const records = await getClient(connectionId).callWithSession('host.get_all_records', [])
  const hosts = Object.entries(records).map(([hostRef, raw]) => {
    const host = raw as Record<string, any>
    // Missing fields are unknown capability, not a configured directory.
    return { hostRef, hostName: host.name_label || hostRef,
      configured: typeof host.external_auth_type === 'string' && host.external_auth_type !== '',
      type: host.external_auth_type || '', service_name: host.external_auth_service_name || '' }
  })
  if (!hosts.length) return null
  const consistent = hosts.every((host) => host.type === hosts[0].type && host.service_name === hosts[0].service_name)
  return {
    configured: hosts.every((host) => host.configured), consistent, hosts,
    type: consistent ? hosts[0].type : '', service_name: consistent ? hosts[0].service_name : '',
    // Never publish directory credentials or arbitrary configuration to renderer.
    credential: '', other_config: {},
  }
}

// ============================================================================
// Session and Permission Checking
// ============================================================================

/**
 * Get the current session's permissions.
 */
export async function getCurrentSessionPermissions(
  connectionId: string
): Promise<string[]> {
  const client = getClient(connectionId)

  const sessionId = client.getSessionRef()
  if (!sessionId) throw new Error('SESSION_INVALID: No current session')
  const session = await client.callWithSession('session.get_record', [sessionId])
  const permissions = session.rbac_permissions
  if (!Array.isArray(permissions) || permissions.some((permission) => typeof permission !== 'string')) {
    throw new Error('RBAC_CONTRACT_MISMATCH: Session permission list is unavailable')
  }
  return [...new Set<string>(permissions)]
}
