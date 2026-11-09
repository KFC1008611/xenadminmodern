import { describe, expect, it } from 'vitest'
import * as Ch from '../../src/shared/channels'
import {
  rbacExtAuthConfigContract,
  rbacGovernanceContracts,
  rbacJoinDomainContract,
  rbacLeaveDomainContract,
  rbacRoleGetContract,
  rbacRoleListContract,
  rbacRolePermissionsContract,
  rbacSessionPermissionsContract,
  rbacSubjectAddContract,
  rbacSubjectAddRoleContract,
  rbacSubjectGetContract,
  rbacSubjectListContract,
  rbacSubjectRemoveContract,
  rbacSubjectRemoveRoleContract,
  rbacSubjectWithRolesContract,
  rbacUserGetContract,
  rbacUserListContract,
} from '../../src/shared/ipc-contracts/rbac-governance'

function expectRejected(schema: { parse(value: unknown): unknown }, values: readonly unknown[]): void {
  for (const value of values) expect(() => schema.parse(value)).toThrow()
}

const role = {
  ref: 'OpaqueRef:role',
  uuid: 'role-uuid',
  name_label: 'Pool Admin',
  name_description: 'Full pool administration',
  subroles: ['OpaqueRef:subrole'],
  policies: ['pool.change_wlb_url'],
  connectionId: 'pool-1',
  poolName: 'Lab Pool',
}

const subject = {
  ref: 'OpaqueRef:subject',
  uuid: 'subject-uuid',
  subject_identifier: 'user@example.test',
  other_config: { subject_name: 'Directory User' },
  roles: ['OpaqueRef:role'],
  authentication_policy: 'AD',
  connectionId: 'pool-1',
  poolName: 'Lab Pool',
}

const connectedUser = {
  ref: 'OpaqueRef:user',
  uuid: 'user-uuid',
  short_name: 'directory-user',
  fullname: 'Directory User',
  other_config: { domain: 'example.test' },
  connectionId: 'pool-1',
  poolName: 'Lab Pool',
}

describe('RBAC governance IPC contracts', () => {
  it('exports the exact sixteen invoke descriptors and boundary metadata', () => {
    const expected = [
      [rbacRoleListContract, Ch.RBAC_ROLE_LIST, ['none']],
      [rbacRoleGetContract, Ch.RBAC_ROLE_GET, ['none']],
      [rbacRolePermissionsContract, Ch.RBAC_ROLE_PERMISSIONS, ['none']],
      [rbacSubjectListContract, Ch.RBAC_SUBJECT_LIST, ['none']],
      [rbacSubjectGetContract, Ch.RBAC_SUBJECT_GET, ['none']],
      [rbacSubjectWithRolesContract, Ch.RBAC_SUBJECT_WITH_ROLES, ['none']],
      [rbacSubjectAddContract, Ch.RBAC_SUBJECT_ADD, ['none']],
      [rbacSubjectRemoveContract, Ch.RBAC_SUBJECT_REMOVE, ['none']],
      [rbacSubjectAddRoleContract, Ch.RBAC_SUBJECT_ADD_ROLE, ['none']],
      [rbacSubjectRemoveRoleContract, Ch.RBAC_SUBJECT_REMOVE_ROLE, ['none']],
      [rbacUserListContract, Ch.RBAC_USER_LIST, ['none']],
      [rbacUserGetContract, Ch.RBAC_USER_GET, ['none']],
      [rbacExtAuthConfigContract, Ch.RBAC_EXT_AUTH_CONFIG, ['none']],
      [rbacJoinDomainContract, Ch.RBAC_JOIN_DOMAIN, ['credentials']],
      [rbacLeaveDomainContract, Ch.RBAC_LEAVE_DOMAIN, ['none']],
      [rbacSessionPermissionsContract, Ch.RBAC_SESSION_PERMISSIONS, ['none']],
    ] as const

    expect(rbacGovernanceContracts).toEqual(expected.map(([contract]) => contract))
    expect(new Set(rbacGovernanceContracts.map(({ channel }) => channel))).toHaveLength(16)
    for (const [contract, channel, redaction] of expected) {
      expect(contract).toMatchObject({
        channel,
        direction: 'invoke',
        errorShape: 'ipc-error-response-v1',
        callerPolicy: 'app-window-main-frame',
        redaction,
      })
    }
  })

  it('accepts only the exact RBAC request tuples', () => {
    for (const contract of [
      rbacRoleListContract,
      rbacSubjectListContract,
      rbacSubjectWithRolesContract,
      rbacUserListContract,
      rbacExtAuthConfigContract,
      rbacLeaveDomainContract,
      rbacSessionPermissionsContract,
    ]) {
      expect(contract.argsSchema.parse(['pool-1'])).toEqual(['pool-1'])
      expectRejected(contract.argsSchema, [[], [''], ['pool-1', 'extra']])
    }

    for (const contract of [
      rbacRoleGetContract,
      rbacRolePermissionsContract,
      rbacSubjectGetContract,
      rbacSubjectRemoveContract,
    ]) {
      expect(contract.argsSchema.parse(['pool-1', 'OpaqueRef:item']))
        .toEqual(['pool-1', 'OpaqueRef:item'])
      expectRejected(contract.argsSchema, [
        ['pool-1'],
        ['pool-1', ''],
        ['pool-1', 'OpaqueRef:NULL'],
        ['pool-1', 'OpaqueRef:item', 'extra'],
      ])
    }

    expect(rbacUserGetContract.argsSchema.parse(['pool-1', 'user@example.test']))
      .toEqual(['pool-1', 'user@example.test'])
    expectRejected(rbacUserGetContract.argsSchema, [
      ['pool-1'],
      ['pool-1', '   '],
      ['pool-1', 7],
    ])

    for (const contract of [rbacSubjectAddRoleContract, rbacSubjectRemoveRoleContract]) {
      expect(contract.argsSchema.parse([
        'pool-1',
        'OpaqueRef:subject',
        'OpaqueRef:role',
      ])).toEqual(['pool-1', 'OpaqueRef:subject', 'OpaqueRef:role'])
      expectRejected(contract.argsSchema, [
        ['pool-1', 'OpaqueRef:subject'],
        ['pool-1', 'OpaqueRef:NULL', 'OpaqueRef:role'],
        ['pool-1', 'OpaqueRef:subject', ''],
        ['pool-1', 'OpaqueRef:subject', 'OpaqueRef:role', 'extra'],
      ])
    }

    const subject = {
      subjectIdentifier: 'user@example.test',
      roles: ['OpaqueRef:role'],
    }
    expect(rbacSubjectAddContract.argsSchema.parse(['pool-1', subject]))
      .toEqual(['pool-1', subject])
    expectRejected(rbacSubjectAddContract.argsSchema, [
      ['pool-1', { subjectIdentifier: subject.subjectIdentifier }],
      ['pool-1', { ...subject, subjectIdentifier: '   ' }],
      ['pool-1', { ...subject, roles: ['OpaqueRef:NULL'] }],
      ['pool-1', { ...subject, roles: 'OpaqueRef:role' }],
      ['pool-1', { ...subject, unexpected: true }],
    ])

    const domain = {
      domain: 'example.test',
      username: 'directory-admin',
      password: 'directory-password',
    }
    expect(rbacJoinDomainContract.argsSchema.parse(['pool-1', domain]))
      .toEqual(['pool-1', domain])
    expectRejected(rbacJoinDomainContract.argsSchema, [
      ['pool-1', { domain: domain.domain, username: domain.username }],
      ['pool-1', { ...domain, domain: '' }],
      ['pool-1', { ...domain, username: 7 }],
      ['pool-1', { ...domain, password: '   ' }],
      ['pool-1', { ...domain, session: 'never-accepted' }],
      ['pool-1', domain, 'extra'],
    ])
  })

  it('validates every RBAC success shape without accepting extra fields', () => {
    expect(rbacRoleListContract.resultSchema.parse([role])).toEqual([role])
    expect(rbacRoleGetContract.resultSchema.parse(role)).toEqual(role)
    expect(rbacRoleGetContract.resultSchema.parse(null)).toBeNull()
    expect(rbacRolePermissionsContract.resultSchema.parse(['pool.change_wlb_url']))
      .toEqual(['pool.change_wlb_url'])

    expect(rbacSubjectListContract.resultSchema.parse([subject])).toEqual([subject])
    expect(rbacSubjectGetContract.resultSchema.parse(subject)).toEqual(subject)
    expect(rbacSubjectGetContract.resultSchema.parse(null)).toBeNull()
    expect(rbacSubjectWithRolesContract.resultSchema.parse([{
      subject,
      roleNames: ['Pool Admin'],
      allPermissions: ['pool.change_wlb_url'],
    }])).toEqual([{
      subject,
      roleNames: ['Pool Admin'],
      allPermissions: ['pool.change_wlb_url'],
    }])

    expect(rbacSubjectAddContract.resultSchema.parse('OpaqueRef:created-subject'))
      .toBe('OpaqueRef:created-subject')
    for (const contract of [
      rbacSubjectRemoveContract,
      rbacSubjectAddRoleContract,
      rbacSubjectRemoveRoleContract,
      rbacJoinDomainContract,
      rbacLeaveDomainContract,
    ]) {
      expect(contract.resultSchema.parse(undefined)).toBeUndefined()
      expectRejected(contract.resultSchema, [null, false, {}])
    }

    const user = {
      ref: connectedUser.ref,
      uuid: connectedUser.uuid,
      short_name: connectedUser.short_name,
      fullname: connectedUser.fullname,
      other_config: connectedUser.other_config,
    }
    expect(rbacUserListContract.resultSchema.parse([connectedUser])).toEqual([connectedUser])
    expect(rbacUserGetContract.resultSchema.parse(user)).toEqual(user)
    expect(rbacUserGetContract.resultSchema.parse(null)).toBeNull()

    const externalAuth = {
      configured: true, consistent: true, hosts: [],
      type: 'AD',
      service_name: 'example.test',
      credential: 'directory-user',
      other_config: { domain: 'example.test' },
    }
    expect(rbacExtAuthConfigContract.resultSchema.parse(externalAuth)).toEqual(externalAuth)
    expect(rbacExtAuthConfigContract.resultSchema.parse(null)).toBeNull()
    expect(rbacSessionPermissionsContract.resultSchema.parse(['vm.start']))
      .toEqual(['vm.start'])

    expectRejected(rbacRoleListContract.resultSchema, [role, [{ ...role, extra: true }]])
    expectRejected(rbacRoleGetContract.resultSchema, [{ ...role, policies: [7] }])
    expectRejected(rbacSubjectListContract.resultSchema, [[{
      ...subject,
      other_config: { subject_name: 7 },
    }]])
    expectRejected(rbacSubjectWithRolesContract.resultSchema, [[{
      subject,
      roleNames: ['Pool Admin'],
      allPermissions: [],
      extra: true,
    }]])
    expectRejected(rbacSubjectAddContract.resultSchema, ['', 'OpaqueRef:NULL'])
    expectRejected(rbacUserListContract.resultSchema, [[{ ...connectedUser, connectionId: '' }]])
    expectRejected(rbacUserGetContract.resultSchema, [{ ...user, extra: true }])
    expectRejected(rbacExtAuthConfigContract.resultSchema, [
      { ...externalAuth, configured: 'yes' },
      { ...externalAuth, secret: 'unexpected' },
    ])
    expectRejected(rbacSessionPermissionsContract.resultSchema, [['vm.start', 7]])
  })
})
