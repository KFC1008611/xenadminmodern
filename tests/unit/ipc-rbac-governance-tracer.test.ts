import { beforeEach, describe, expect, it, vi } from 'vitest'

const registeredHandlers = new Map<string, (...args: unknown[]) => unknown>()
const mockIpcMainHandle = vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
  registeredHandlers.set(channel, handler)
})

vi.mock('electron', () => ({
  ipcMain: { handle: mockIpcMainHandle },
}))

const mockGetAllRoles = vi.fn()
const mockGetRoleRecord = vi.fn()
const mockGetRolePermissions = vi.fn()
const mockGetAllSubjects = vi.fn()
const mockGetSubjectRecord = vi.fn()
const mockGetSubjectsWithRoles = vi.fn()
const mockAddSubject = vi.fn()
const mockRemoveSubject = vi.fn()
const mockAddSubjectRole = vi.fn()
const mockRemoveSubjectRole = vi.fn()
const mockGetAllUsers = vi.fn()
const mockGetUserInfo = vi.fn()
const mockGetExternalAuthConfig = vi.fn()
const mockJoinDomain = vi.fn()
const mockLeaveDomain = vi.fn()
const mockGetCurrentSessionPermissions = vi.fn()

vi.mock('../../src/main/xapi/services/rbac.service', () => ({
  getAllRoles: mockGetAllRoles,
  getRoleRecord: mockGetRoleRecord,
  getRolePermissions: mockGetRolePermissions,
  getAllSubjects: mockGetAllSubjects,
  getSubjectRecord: mockGetSubjectRecord,
  getSubjectsWithRoles: mockGetSubjectsWithRoles,
  addSubject: mockAddSubject,
  removeSubject: mockRemoveSubject,
  addSubjectRole: mockAddSubjectRole,
  removeSubjectRole: mockRemoveSubjectRole,
  getAllUsers: mockGetAllUsers,
  getUserInfo: mockGetUserInfo,
  getExternalAuthConfig: mockGetExternalAuthConfig,
  joinDomain: mockJoinDomain,
  leaveDomain: mockLeaveDomain,
  getCurrentSessionPermissions: mockGetCurrentSessionPermissions,
}))

const mockDebug = vi.fn()
const mockError = vi.fn()

vi.mock('../../src/main/logger', () => ({
  createLogger: () => ({
    debug: mockDebug,
    error: mockError,
    info: vi.fn(),
    warn: vi.fn(),
  }),
}))

const trustedUrl = 'file:///Applications/XenAdmin/index.html'
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
const joinParams = {
  domain: 'example.test',
  username: 'directory-admin',
  password: 'directory-password',
}

function createOwner(url = trustedUrl) {
  let currentUrl = url
  const mainFrame = { url }
  const webContents = {
    mainFrame,
    getURL: () => currentUrl,
    isDestroyed: () => false,
  }
  return {
    owner: { webContents, isDestroyed: () => false },
    event: { sender: webContents, senderFrame: mainFrame },
    navigate(nextUrl: string) {
      currentUrl = nextUrl
      mainFrame.url = nextUrl
    },
  }
}

async function setup() {
  const current = createOwner()
  const utils = await import('../../src/main/ipc/handlers/utils')
  const { registerRbacHandlers } = await import('../../src/main/ipc/handlers/rbac')
  utils.rebindIpcOwner(current.owner as never, trustedUrl)
  registerRbacHandlers()
  return { current, utils }
}

describe('RBAC governance IPC contract tracer', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    registeredHandlers.clear()
  })

  it('registers the exact sixteen migrated invoke descriptors without legacy overlap', async () => {
    const { utils } = await setup()
    const expectedChannels = [
      'rbac:roleList',
      'rbac:roleGet',
      'rbac:rolePermissions',
      'rbac:subjectList',
      'rbac:subjectGet',
      'rbac:subjectWithRoles',
      'rbac:subjectAdd',
      'rbac:subjectRemove',
      'rbac:subjectAddRole',
      'rbac:subjectRemoveRole',
      'rbac:userList',
      'rbac:userGet',
      'rbac:extAuthConfig',
      'rbac:joinDomain',
      'rbac:leaveDomain',
      'rbac:sessionPermissions',
    ]

    expect(utils.getIpcRegistrationInventory().contracts.map(({ channel, direction }) => ({
      channel,
      direction,
    }))).toEqual(expectedChannels.map((channel) => ({ channel, direction: 'invoke' })))
  })

  it('allows the current owner read tracer and reaches the mutation gate only for it', async () => {
    mockGetAllRoles.mockResolvedValue([role])
    const { current, utils } = await setup()

    await expect(registeredHandlers.get('rbac:roleList')?.(current.event, 'pool-1'))
      .resolves.toEqual([role])
    await expect(registeredHandlers.get('rbac:joinDomain')?.(
      current.event,
      'pool-1',
      joinParams,
    )).resolves.toMatchObject({ error: true, message: expect.stringContaining('暂不可用') })

    const assertRejected = async (event: object) => {
      await expect(registeredHandlers.get('rbac:roleList')?.(event, 'pool-1'))
        .resolves.toMatchObject({ error: true, code: 'IPC_UNTRUSTED_SENDER' })
      await expect(registeredHandlers.get('rbac:joinDomain')?.(
        event,
        'pool-1',
        joinParams,
      )).resolves.toMatchObject({ error: true, code: 'IPC_UNTRUSTED_SENDER' })
    }

    await assertRejected({
      sender: current.event.sender,
      senderFrame: { url: trustedUrl },
    })
    await assertRejected({})

    current.navigate('https://external.example.test/')
    await assertRejected(current.event)

    current.navigate(trustedUrl)
    const replacement = createOwner()
    utils.rebindIpcOwner(replacement.owner as never, trustedUrl)
    await assertRejected(current.event)
    await expect(registeredHandlers.get('rbac:roleList')?.(replacement.event, 'pool-1'))
      .resolves.toEqual([role])

    expect(mockGetAllRoles).toHaveBeenCalledTimes(2)
    expect(mockJoinDomain).not.toHaveBeenCalled()
  })

  it('keeps every audited RBAC mutation gate ahead of its service', async () => {
    const { current } = await setup()
    const cases: Array<[string, unknown[], string]> = [
      [
        'rbac:subjectAdd',
        ['pool-1', { subjectIdentifier: 'user@example.test', roles: [] }],
        '暂不可用',
      ],
      ['rbac:subjectRemove', ['pool-1', 'OpaqueRef:subject'], '暂不可用'],
      [
        'rbac:subjectAddRole',
        ['pool-1', 'OpaqueRef:subject', 'OpaqueRef:role'],
        '暂不可用',
      ],
      [
        'rbac:subjectRemoveRole',
        ['pool-1', 'OpaqueRef:subject', 'OpaqueRef:role'],
        '暂不可用',
      ],
      ['rbac:joinDomain', ['pool-1', joinParams], '暂不可用'],
      ['rbac:leaveDomain', ['pool-1'], '暂不可用'],
    ]

    for (const [channel, args, marker] of cases) {
      await expect(registeredHandlers.get(channel)?.(current.event, ...args))
        .resolves.toMatchObject({ error: true, message: expect.stringContaining(marker) })
    }
    for (const service of [
      mockAddSubject,
      mockRemoveSubject,
      mockAddSubjectRole,
      mockRemoveSubjectRole,
      mockJoinDomain,
      mockLeaveDomain,
    ]) {
      expect(service).not.toHaveBeenCalled()
    }
  })

  it('rejects malformed subject and external-auth payloads before gates or services', async () => {
    const secret = 'never-copy-directory-secret'
    const session = 'OpaqueRef:never-copy-session'
    const { current } = await setup()

    const subjectResult = await registeredHandlers.get('rbac:subjectAdd')?.(
      current.event,
      'pool-1',
      { subjectIdentifier: 'user@example.test' },
    )
    const domainResult = await registeredHandlers.get('rbac:joinDomain')?.(
      current.event,
      'pool-1',
      {
        domain: 'example.test',
        username: 'directory-admin',
        password: secret,
        session,
      },
    )

    expect(subjectResult).toMatchObject({ error: true, code: 'IPC_SCHEMA_INVALID' })
    expect(domainResult).toMatchObject({ error: true, code: 'IPC_SCHEMA_INVALID' })
    const diagnostics = JSON.stringify({
      subjectResult,
      domainResult,
      debug: mockDebug.mock.calls,
      error: mockError.mock.calls,
    })
    expect(diagnostics).not.toContain(secret)
    expect(diagnostics).not.toContain(session)
    expect(mockAddSubject).not.toHaveBeenCalled()
    expect(mockJoinDomain).not.toHaveBeenCalled()
  })

  it('redacts external-auth credentials from wrapper errors and diagnostics', async () => {
    const secret = 'never-copy-wrapper-secret'
    const { createIpcContractHandler } = await import(
      '../../src/main/ipc/ipc-contract-handler'
    )
    const { rbacJoinDomainContract } = await import(
      '../../src/shared/ipc-contracts/rbac-governance'
    )
    const handler = createIpcContractHandler(
      rbacJoinDomainContract,
      (_connectionId, params) => {
        throw Object.assign(new Error(`Directory rejected ${params.password}`), {
          code: 'DIRECTORY_REJECTED',
          params: [params.password],
        })
      },
      {
        owner: { assertCurrent: vi.fn() },
        logger: { debug: mockDebug, error: mockError },
      },
    )

    const result = await handler({} as never, 'pool-1', {
      domain: 'example.test',
      username: 'directory-admin',
      password: secret,
    })
    expect(result).toMatchObject({ error: true, code: 'DIRECTORY_REJECTED' })
    const diagnostics = JSON.stringify({ result, debug: mockDebug.mock.calls, error: mockError.mock.calls })
    expect(diagnostics).not.toContain(secret)
  })

  it('rejects malformed read results instead of exposing partial governance state', async () => {
    mockGetAllRoles.mockResolvedValueOnce([{ ref: 'OpaqueRef:role' }])
    const { current } = await setup()

    await expect(registeredHandlers.get('rbac:roleList')?.(current.event, 'pool-1'))
      .resolves.toMatchObject({ error: true, code: 'IPC_RESULT_INVALID' })
  })
})
