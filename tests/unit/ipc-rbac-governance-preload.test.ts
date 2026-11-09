import { describe, expect, it, vi } from 'vitest'
import { createRbacApi } from '../../src/preload/rbac-api'

const role = {
  ref: 'OpaqueRef:role',
  uuid: 'role-uuid',
  name_label: 'Pool Admin',
  name_description: 'Full pool administration',
  subroles: [],
  policies: ['vm.start'],
  connectionId: 'pool-1',
  poolName: 'Lab Pool',
}

const subject = {
  ref: 'OpaqueRef:subject',
  uuid: 'subject-uuid',
  subject_identifier: 'user@example.test',
  other_config: {},
  roles: ['OpaqueRef:role'],
  authentication_policy: 'AD',
  connectionId: 'pool-1',
  poolName: 'Lab Pool',
}

describe('RBAC governance preload IPC contracts', () => {
  it('exposes the exact legacy-compatible RBAC API keys', () => {
    const api = createRbacApi({ invoke: vi.fn() })

    expect(Object.keys(api)).toEqual(['rbac'])
    expect(Object.keys(api.rbac)).toEqual([
      'roleList',
      'roleGet',
      'rolePermissions',
      'subjectList',
      'subjectGet',
      'subjectWithRoles',
      'subjectAdd',
      'subjectRemove',
      'subjectAddRole',
      'subjectRemoveRole',
      'userList',
      'userGet',
      'extAuthConfig',
      'joinDomain',
      'leaveDomain',
      'sessionPermissions',
    ])
  })

  it('pairs all sixteen methods with their literal channels and success shapes', async () => {
    const invoke = vi.fn()
    const api = createRbacApi({ invoke: invoke as never }).rbac
    const subjectWithRoles = {
      subject,
      roleNames: ['Pool Admin'],
      allPermissions: ['vm.start'],
    }
    const connectedUser = {
      ref: 'OpaqueRef:user',
      uuid: 'user-uuid',
      short_name: 'directory-user',
      fullname: 'Directory User',
      other_config: {},
      connectionId: 'pool-1',
      poolName: 'Lab Pool',
    }
    const user = {
      ref: connectedUser.ref,
      uuid: connectedUser.uuid,
      short_name: connectedUser.short_name,
      fullname: connectedUser.fullname,
      other_config: connectedUser.other_config,
    }
    const externalAuth = {
      configured: true, consistent: true, hosts: [],
      type: 'AD',
      service_name: 'example.test',
      credential: 'directory-user',
      other_config: {},
    }
    const addParams = {
      subjectIdentifier: 'user@example.test',
      roles: ['OpaqueRef:role'],
    }
    const joinParams = {
      domain: 'example.test',
      username: 'directory-admin',
      password: 'directory-password',
    }
    const cases: Array<{
      method: (...args: never[]) => Promise<unknown>
      channel: string
      args: unknown[]
      result: unknown
    }> = [
      { method: api.roleList, channel: 'rbac:roleList', args: ['pool-1'], result: [role] },
      { method: api.roleGet, channel: 'rbac:roleGet', args: ['pool-1', 'OpaqueRef:role'], result: role },
      { method: api.rolePermissions, channel: 'rbac:rolePermissions', args: ['pool-1', 'OpaqueRef:role'], result: ['vm.start'] },
      { method: api.subjectList, channel: 'rbac:subjectList', args: ['pool-1'], result: [subject] },
      { method: api.subjectGet, channel: 'rbac:subjectGet', args: ['pool-1', 'OpaqueRef:subject'], result: subject },
      { method: api.subjectWithRoles, channel: 'rbac:subjectWithRoles', args: ['pool-1'], result: [subjectWithRoles] },
      { method: api.subjectAdd, channel: 'rbac:subjectAdd', args: ['pool-1', addParams], result: 'OpaqueRef:created-subject' },
      { method: api.subjectRemove, channel: 'rbac:subjectRemove', args: ['pool-1', 'OpaqueRef:subject'], result: undefined },
      { method: api.subjectAddRole, channel: 'rbac:subjectAddRole', args: ['pool-1', 'OpaqueRef:subject', 'OpaqueRef:role'], result: undefined },
      { method: api.subjectRemoveRole, channel: 'rbac:subjectRemoveRole', args: ['pool-1', 'OpaqueRef:subject', 'OpaqueRef:role'], result: undefined },
      { method: api.userList, channel: 'rbac:userList', args: ['pool-1'], result: [connectedUser] },
      { method: api.userGet, channel: 'rbac:userGet', args: ['pool-1', 'directory-user'], result: user },
      { method: api.extAuthConfig, channel: 'rbac:extAuthConfig', args: ['pool-1'], result: externalAuth },
      { method: api.joinDomain, channel: 'rbac:joinDomain', args: ['pool-1', joinParams], result: undefined },
      { method: api.leaveDomain, channel: 'rbac:leaveDomain', args: ['pool-1'], result: undefined },
      { method: api.sessionPermissions, channel: 'rbac:sessionPermissions', args: ['pool-1'], result: ['vm.start'] },
    ]

    for (const testCase of cases) {
      invoke.mockResolvedValueOnce(testCase.result)
      await expect(testCase.method(...testCase.args as never[])).resolves.toEqual(testCase.result)
    }
    expect(invoke.mock.calls).toEqual(cases.map(({ channel, args }) => [channel, ...args]))
  })

  it('fails closed before transport and rejects malformed main-process results', async () => {
    const secret = 'never-copy-directory-password'
    const invoke = vi.fn().mockResolvedValueOnce([{ ...role, unexpected: true }])
    const api = createRbacApi({ invoke }).rbac

    const subjectError = await api.subjectAdd('pool-1', {
      subjectIdentifier: 'user@example.test',
    } as never).catch((error: unknown) => error)
    const domainError = await api.joinDomain('pool-1', {
      domain: 'example.test',
      username: 'directory-admin',
      password: secret,
      unexpected: true,
    } as never).catch((error: unknown) => error)

    expect(subjectError).toMatchObject({ code: 'IPC_SCHEMA_INVALID' })
    expect(domainError).toMatchObject({ code: 'IPC_SCHEMA_INVALID' })
    expect(JSON.stringify([subjectError, domainError])).not.toContain(secret)
    expect(invoke).not.toHaveBeenCalled()

    await expect(api.roleList('pool-1')).rejects.toMatchObject({
      code: 'IPC_RESULT_INVALID',
    })
    expect(invoke).toHaveBeenCalledOnce()
  })
})
