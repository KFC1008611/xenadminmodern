import * as Ch from '../channels'
import {
  defineInvokeContract,
  type IpcRuntimeSchema,
} from '../ipc-contract'
import {
  requireArray,
  requireBoolean,
  requireExactKeys,
  requireNonBlankString,
  requireOpenStringRecord,
  requirePlainObject,
  requireRef,
  requireString,
  requireStringArray,
  requireTuple,
  voidResultSchema,
} from './runtime-schema'

export interface RbacSubjectAddParams {
  subjectIdentifier: string
  roles: string[]
}

export interface RbacJoinDomainParams {
  domain: string
  username: string
  password: string
}

export interface RbacRoleRecord {
  ref: string
  uuid: string
  name_label: string
  name_description: string
  subroles: string[]
  policies: string[]
  connectionId: string
  poolName: string
}

export interface RbacSubjectRecord {
  ref: string
  uuid: string
  subject_identifier: string
  other_config: Record<string, string>
  roles: string[]
  authentication_policy: string
  connectionId: string
  poolName: string
}

export interface RbacSubjectWithRoles {
  subject: RbacSubjectRecord
  roleNames: string[]
  allPermissions: string[]
}

export interface RbacUserRecord {
  ref: string
  uuid: string
  short_name: string
  fullname: string
  other_config: Record<string, string>
}

export interface ConnectedRbacUserRecord extends RbacUserRecord {
  connectionId: string
  poolName: string
}

export interface RbacExternalAuthConfig {
  consistent: boolean
  hosts: Array<{ hostRef: string; hostName: string; configured: boolean; type: string; service_name: string }>
  configured: boolean
  type: string
  service_name: string
  credential: string
  other_config: Record<string, string>
}

const invokeBoundary = {
  errorShape: 'ipc-error-response-v1' as const,
  callerPolicy: 'app-window-main-frame' as const,
}

function defineRbacContract<TArgs extends readonly unknown[], TResult>(
  channel: string,
  argsSchema: IpcRuntimeSchema<TArgs>,
  resultSchema: IpcRuntimeSchema<TResult>,
  redaction: readonly ['none'] | readonly ['credentials'] = ['none'],
) {
  return defineInvokeContract({
    channel,
    argsSchema,
    resultSchema,
    ...invokeBoundary,
    redaction,
  })
}

function connectionId(value: unknown): string {
  return requireNonBlankString(value, 'connection identity')
}

const connectionArgsSchema: IpcRuntimeSchema<[string]> = {
  parse(value: unknown): [string] {
    const [rawConnectionId] = requireTuple(value, 1, 'RBAC connection arguments')
    return [connectionId(rawConnectionId)]
  },
}

const connectionAndRefArgsSchema: IpcRuntimeSchema<[string, string]> = {
  parse(value: unknown): [string, string] {
    const [rawConnectionId, ref] = requireTuple(value, 2, 'RBAC reference arguments')
    return [connectionId(rawConnectionId), requireRef(ref, 'RBAC XAPI reference')]
  },
}

const connectionAndIdentifierArgsSchema: IpcRuntimeSchema<[string, string]> = {
  parse(value: unknown): [string, string] {
    const [rawConnectionId, identifier] = requireTuple(value, 2, 'RBAC identifier arguments')
    return [
      connectionId(rawConnectionId),
      requireNonBlankString(identifier, 'RBAC identifier'),
    ]
  },
}

const subjectRoleArgsSchema: IpcRuntimeSchema<[string, string, string]> = {
  parse(value: unknown): [string, string, string] {
    const [rawConnectionId, subjectRef, roleRef] = requireTuple(
      value,
      3,
      'RBAC subject role arguments',
    )
    return [
      connectionId(rawConnectionId),
      requireRef(subjectRef, 'RBAC subject reference'),
      requireRef(roleRef, 'RBAC role reference'),
    ]
  },
}

function parseSubjectAddParams(value: unknown): RbacSubjectAddParams {
  const params = requirePlainObject(value, 'RBAC subject parameters')
  requireExactKeys(
    params,
    ['subjectIdentifier', 'roles'],
    [],
    'RBAC subject parameters',
  )
  const roles = requireArray(params.roles, 'RBAC subject roles')
    .map((roleRef) => requireRef(roleRef, 'RBAC role reference'))
  return {
    subjectIdentifier: requireNonBlankString(
      params.subjectIdentifier,
      'RBAC subject identifier',
    ),
    roles,
  }
}

const subjectAddArgsSchema: IpcRuntimeSchema<[string, RbacSubjectAddParams]> = {
  parse(value: unknown): [string, RbacSubjectAddParams] {
    const [rawConnectionId, params] = requireTuple(value, 2, 'RBAC subject-add arguments')
    return [connectionId(rawConnectionId), parseSubjectAddParams(params)]
  },
}

function parseJoinDomainParams(value: unknown): RbacJoinDomainParams {
  const params = requirePlainObject(value, 'external-auth parameters')
  requireExactKeys(
    params,
    ['domain', 'username', 'password'],
    [],
    'external-auth parameters',
  )
  return {
    domain: requireNonBlankString(params.domain, 'external-auth domain'),
    username: requireNonBlankString(params.username, 'external-auth username'),
    password: requireNonBlankString(params.password, 'external-auth password'),
  }
}

const joinDomainArgsSchema: IpcRuntimeSchema<[string, RbacJoinDomainParams]> = {
  parse(value: unknown): [string, RbacJoinDomainParams] {
    const [rawConnectionId, params] = requireTuple(value, 2, 'external-auth arguments')
    return [connectionId(rawConnectionId), parseJoinDomainParams(params)]
  },
}

function parseRoleRecord(value: unknown): RbacRoleRecord {
  const record = requirePlainObject(value, 'RBAC role result')
  requireExactKeys(
    record,
    [
      'ref',
      'uuid',
      'name_label',
      'name_description',
      'subroles',
      'policies',
      'connectionId',
      'poolName',
    ],
    [],
    'RBAC role result',
  )
  return {
    ref: requireRef(record.ref, 'RBAC role result reference'),
    uuid: requireString(record.uuid, 'RBAC role result UUID'),
    name_label: requireString(record.name_label, 'RBAC role result name'),
    name_description: requireString(
      record.name_description,
      'RBAC role result description',
    ),
    subroles: requireStringArray(record.subroles, 'RBAC role result subroles'),
    policies: requireStringArray(record.policies, 'RBAC role result permissions'),
    connectionId: connectionId(record.connectionId),
    poolName: requireNonBlankString(record.poolName, 'RBAC role result resource pool name'),
  }
}

const roleListResultSchema: IpcRuntimeSchema<RbacRoleRecord[]> = {
  parse(value: unknown): RbacRoleRecord[] {
    return requireArray(value, 'RBAC role list result').map(parseRoleRecord)
  },
}

const nullableRoleResultSchema: IpcRuntimeSchema<RbacRoleRecord | null> = {
  parse(value: unknown): RbacRoleRecord | null {
    return value === null ? null : parseRoleRecord(value)
  },
}

const permissionListResultSchema: IpcRuntimeSchema<string[]> = {
  parse(value: unknown): string[] {
    return requireStringArray(value, 'RBAC permission list result')
  },
}

function parseSubjectRecord(value: unknown): RbacSubjectRecord {
  const record = requirePlainObject(value, 'RBAC subject result')
  requireExactKeys(
    record,
    [
      'ref',
      'uuid',
      'subject_identifier',
      'other_config',
      'roles',
      'authentication_policy',
      'connectionId',
      'poolName',
    ],
    [],
    'RBAC subject result',
  )
  return {
    ref: requireRef(record.ref, 'RBAC subject result reference'),
    uuid: requireString(record.uuid, 'RBAC subject result UUID'),
    subject_identifier: requireString(
      record.subject_identifier,
      'RBAC subject result identifier',
    ),
    other_config: requireOpenStringRecord(
      record.other_config,
      'RBAC subject result other configuration',
    ),
    roles: requireStringArray(record.roles, 'RBAC subject result roles'),
    authentication_policy: requireString(
      record.authentication_policy,
      'RBAC subject result authentication policy',
    ),
    connectionId: connectionId(record.connectionId),
    poolName: requireNonBlankString(
      record.poolName,
      'RBAC subject result resource pool name',
    ),
  }
}

const subjectListResultSchema: IpcRuntimeSchema<RbacSubjectRecord[]> = {
  parse(value: unknown): RbacSubjectRecord[] {
    return requireArray(value, 'RBAC subject list result').map(parseSubjectRecord)
  },
}

const nullableSubjectResultSchema: IpcRuntimeSchema<RbacSubjectRecord | null> = {
  parse(value: unknown): RbacSubjectRecord | null {
    return value === null ? null : parseSubjectRecord(value)
  },
}

function parseSubjectWithRoles(value: unknown): RbacSubjectWithRoles {
  const result = requirePlainObject(value, 'RBAC subject-with-roles result')
  requireExactKeys(
    result,
    ['subject', 'roleNames', 'allPermissions'],
    [],
    'RBAC subject-with-roles result',
  )
  return {
    subject: parseSubjectRecord(result.subject),
    roleNames: requireStringArray(result.roleNames, 'RBAC subject role names'),
    allPermissions: requireStringArray(
      result.allPermissions,
      'RBAC subject permissions',
    ),
  }
}

const subjectWithRolesResultSchema: IpcRuntimeSchema<RbacSubjectWithRoles[]> = {
  parse(value: unknown): RbacSubjectWithRoles[] {
    return requireArray(value, 'RBAC subject-with-roles list').map(parseSubjectWithRoles)
  },
}

const subjectRefResultSchema: IpcRuntimeSchema<string> = {
  parse(value: unknown): string {
    return requireRef(value, 'RBAC created subject reference')
  },
}

function parseUserRecord(value: unknown): RbacUserRecord {
  const record = requirePlainObject(value, 'RBAC user result')
  requireExactKeys(
    record,
    ['ref', 'uuid', 'short_name', 'fullname', 'other_config'],
    [],
    'RBAC user result',
  )
  return {
    ref: requireString(record.ref, 'RBAC user result reference'),
    uuid: requireString(record.uuid, 'RBAC user result UUID'),
    short_name: requireString(record.short_name, 'RBAC user result short name'),
    fullname: requireString(record.fullname, 'RBAC user result full name'),
    other_config: requireOpenStringRecord(
      record.other_config,
      'RBAC user result other configuration',
    ),
  }
}

function parseConnectedUserRecord(value: unknown): ConnectedRbacUserRecord {
  const record = requirePlainObject(value, 'connected RBAC user result')
  requireExactKeys(
    record,
    [
      'ref',
      'uuid',
      'short_name',
      'fullname',
      'other_config',
      'connectionId',
      'poolName',
    ],
    [],
    'connected RBAC user result',
  )
  return {
    ref: requireString(record.ref, 'connected RBAC user result reference'),
    uuid: requireString(record.uuid, 'connected RBAC user result UUID'),
    short_name: requireString(record.short_name, 'connected RBAC user result short name'),
    fullname: requireString(record.fullname, 'connected RBAC user result full name'),
    other_config: requireOpenStringRecord(
      record.other_config,
      'connected RBAC user result other configuration',
    ),
    connectionId: connectionId(record.connectionId),
    poolName: requireNonBlankString(
      record.poolName,
      'connected RBAC user result resource pool name',
    ),
  }
}

const userListResultSchema: IpcRuntimeSchema<ConnectedRbacUserRecord[]> = {
  parse(value: unknown): ConnectedRbacUserRecord[] {
    return requireArray(value, 'connected RBAC user list').map(parseConnectedUserRecord)
  },
}

const nullableUserResultSchema: IpcRuntimeSchema<RbacUserRecord | null> = {
  parse(value: unknown): RbacUserRecord | null {
    return value === null ? null : parseUserRecord(value)
  },
}

function parseExternalAuthConfig(value: unknown): RbacExternalAuthConfig {
  const config = requirePlainObject(value, 'external-auth result')
  requireExactKeys(
    config,
    ['configured', 'type', 'service_name', 'credential', 'other_config', 'consistent', 'hosts'],
    [],
    'external-auth result',
  )
  return {
    configured: requireBoolean(config.configured, 'external-auth configured state'),
    consistent: requireBoolean(config.consistent, 'external-auth consistency'),
    hosts: requireArray(config.hosts, 'external-auth hosts').map((value) => {
      const host = requirePlainObject(value, 'external-auth host')
      requireExactKeys(host, ['hostRef', 'hostName', 'configured', 'type', 'service_name'], [], 'external-auth host')
      return { hostRef: requireRef(host.hostRef, 'external-auth host reference'), hostName: requireString(host.hostName, 'external-auth host name'),
        configured: requireBoolean(host.configured, 'external-auth host configured'), type: requireString(host.type, 'external-auth type'),
        service_name: requireString(host.service_name, 'external-auth service') }
    }),
    type: requireString(config.type, 'external-auth type'),
    service_name: requireString(config.service_name, 'external-auth service name'),
    credential: requireString(config.credential, 'external-auth credential'),
    other_config: requireOpenStringRecord(
      config.other_config,
      'external-auth other configuration',
    ),
  }
}

const nullableExternalAuthResultSchema: IpcRuntimeSchema<RbacExternalAuthConfig | null> = {
  parse(value: unknown): RbacExternalAuthConfig | null {
    return value === null ? null : parseExternalAuthConfig(value)
  },
}

export const rbacRoleListContract = defineRbacContract(
  Ch.RBAC_ROLE_LIST,
  connectionArgsSchema,
  roleListResultSchema,
)
export const rbacRoleGetContract = defineRbacContract(
  Ch.RBAC_ROLE_GET,
  connectionAndRefArgsSchema,
  nullableRoleResultSchema,
)
export const rbacRolePermissionsContract = defineRbacContract(
  Ch.RBAC_ROLE_PERMISSIONS,
  connectionAndRefArgsSchema,
  permissionListResultSchema,
)
export const rbacSubjectListContract = defineRbacContract(
  Ch.RBAC_SUBJECT_LIST,
  connectionArgsSchema,
  subjectListResultSchema,
)
export const rbacSubjectGetContract = defineRbacContract(
  Ch.RBAC_SUBJECT_GET,
  connectionAndRefArgsSchema,
  nullableSubjectResultSchema,
)
export const rbacSubjectWithRolesContract = defineRbacContract(
  Ch.RBAC_SUBJECT_WITH_ROLES,
  connectionArgsSchema,
  subjectWithRolesResultSchema,
)
export const rbacSubjectAddContract = defineRbacContract(
  Ch.RBAC_SUBJECT_ADD,
  subjectAddArgsSchema,
  subjectRefResultSchema,
)
export const rbacSubjectRemoveContract = defineRbacContract(
  Ch.RBAC_SUBJECT_REMOVE,
  connectionAndRefArgsSchema,
  voidResultSchema,
)
export const rbacSubjectAddRoleContract = defineRbacContract(
  Ch.RBAC_SUBJECT_ADD_ROLE,
  subjectRoleArgsSchema,
  voidResultSchema,
)
export const rbacSubjectRemoveRoleContract = defineRbacContract(
  Ch.RBAC_SUBJECT_REMOVE_ROLE,
  subjectRoleArgsSchema,
  voidResultSchema,
)
export const rbacUserListContract = defineRbacContract(
  Ch.RBAC_USER_LIST,
  connectionArgsSchema,
  userListResultSchema,
)
export const rbacUserGetContract = defineRbacContract(
  Ch.RBAC_USER_GET,
  connectionAndIdentifierArgsSchema,
  nullableUserResultSchema,
)
export const rbacExtAuthConfigContract = defineRbacContract(
  Ch.RBAC_EXT_AUTH_CONFIG,
  connectionArgsSchema,
  nullableExternalAuthResultSchema,
)
export const rbacJoinDomainContract = defineRbacContract(
  Ch.RBAC_JOIN_DOMAIN,
  joinDomainArgsSchema,
  voidResultSchema,
  ['credentials'],
)
export const rbacLeaveDomainContract = defineRbacContract(
  Ch.RBAC_LEAVE_DOMAIN,
  connectionArgsSchema,
  voidResultSchema,
)
export const rbacSessionPermissionsContract = defineRbacContract(
  Ch.RBAC_SESSION_PERMISSIONS,
  connectionArgsSchema,
  permissionListResultSchema,
)

export const rbacGovernanceContracts = Object.freeze([
  rbacRoleListContract,
  rbacRoleGetContract,
  rbacRolePermissionsContract,
  rbacSubjectListContract,
  rbacSubjectGetContract,
  rbacSubjectWithRolesContract,
  rbacSubjectAddContract,
  rbacSubjectRemoveContract,
  rbacSubjectAddRoleContract,
  rbacSubjectRemoveRoleContract,
  rbacUserListContract,
  rbacUserGetContract,
  rbacExtAuthConfigContract,
  rbacJoinDomainContract,
  rbacLeaveDomainContract,
  rbacSessionPermissionsContract,
] as const)
