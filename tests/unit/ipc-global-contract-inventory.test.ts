import { describe, expect, it, vi } from 'vitest'
import { createIpcContractHandler } from '../../src/main/ipc/ipc-contract-handler'
import * as Ch from '../../src/shared/channels'
import type {
  IpcInvokeContract,
  IpcRedactionCategory,
} from '../../src/shared/ipc-contract'
import { ipcContractInventory } from '../../src/shared/ipc-contracts/inventory'

type SensitiveContractCase = {
  channel: string
  category: Exclude<IpcRedactionCategory, 'none'>
  args: readonly unknown[]
  secret: string
}

const connectionOptions = (password: string) => ({
  host: '192.0.2.10',
  port: 443,
  scheme: 'https:',
  username: 'root',
  password,
  allowSelfSigned: true,
})

const savedProfile = {
  id: 'profile-1',
  name: 'Lab',
  host: '192.0.2.10',
  port: 443,
  scheme: 'https:',
  username: 'root',
  lastConnected: null,
  allowSelfSigned: true,
}

const notificationConfig = (secret: string) => ({
  enabled: true,
  email: {
    enabled: true,
    host: 'smtp.example.test',
    port: 587,
    secure: false,
    auth: { user: 'alerts', pass: secret },
    from: 'alerts@example.test',
    to: 'ops@example.test',
  },
  webhook: { enabled: false, url: '' },
  filterSeverities: ['warning'],
})

const sensitiveContractCases: readonly SensitiveContractCase[] = [
  {
    channel: 'connection:reconnect', category: 'credentials', secret: 'reconnect-password-secret',
    args: ['pool-1', 'reconnect-password-secret'],
  },
  {
    channel: 'profile:connect', category: 'credentials', secret: 'saved-connection-secret',
    args: ['profile-1', 'saved-connection-secret'],
  },
  {
    channel: 'sr:probeIscsi', category: 'storage-secret', secret: 'iscsi-probe-secret',
    args: ['pool-1', '192.0.2.5', 'OpaqueRef:host', { chapUser: 'operator', chapPassword: 'iscsi-probe-secret' }],
  },
  {
    channel: 'connection:connect',
    category: 'credentials',
    secret: 'connection-password-secret',
    args: [connectionOptions('connection-password-secret')],
  },
  {
    channel: 'session:connect',
    category: 'credentials',
    secret: 'session-connect-password-secret',
    args: [connectionOptions('session-connect-password-secret')],
  },
  {
    channel: 'pool:addHost',
    category: 'credentials',
    secret: 'pool-join-password-secret',
    args: ['pool-1', {
      targetHost: '192.0.2.20',
      username: 'root',
      password: 'pool-join-password-secret',
      masterAddress: '192.0.2.10',
    }],
  },
  {
    channel: 'profile:save',
    category: 'credentials',
    secret: 'profile-password-secret',
    args: [savedProfile, 'profile-password-secret'],
  },
  {
    channel: 'console:close',
    category: 'session',
    secret: 'console-session-secret',
    args: ['console-session-secret'],
  },
  {
    channel: 'network:updateOtherConfig',
    category: 'credentials',
    secret: 'network-config-secret',
    args: ['pool-1', 'OpaqueRef:network', 'password', 'network-config-secret'],
  },
  {
    channel: 'alertNotify:saveConfig',
    category: 'notification-secret',
    secret: 'notification-save-secret',
    args: [notificationConfig('notification-save-secret')],
  },
  {
    channel: 'alertNotify:test',
    category: 'notification-secret',
    secret: 'notification-test-secret',
    args: ['webhook', {
      enabled: true,
      url: 'https://hooks.example.test/alerts',
      secret: 'notification-test-secret',
    }],
  },
  {
    channel: 'patch:upload',
    category: 'storage-secret',
    secret: '/private/update-source/patch-secret.xsupdate',
    args: ['pool-1', '/private/update-source/patch-secret.xsupdate'],
  },
  {
    channel: 'rbac:joinDomain',
    category: 'credentials',
    secret: 'directory-password-secret',
    args: ['pool-1', {
      domain: 'example.test',
      username: 'directory-admin',
      password: 'directory-password-secret',
    }],
  },
  {
    channel: 'sr:create',
    category: 'storage-secret',
    secret: 'iscsi-chap-secret',
    args: ['pool-1', 'OpaqueRef:host', {
      type: 'iscsi',
      nameLabel: 'Shared storage',
      nameDescription: '',
      iscsiTarget: '192.0.2.30',
      chapUser: 'storage-user',
      chapPassword: 'iscsi-chap-secret',
    }],
  },
  {
    channel: 'pbd:create',
    category: 'storage-secret',
    secret: 'pbd-device-secret',
    args: [
      'pool-1',
      'OpaqueRef:host',
      'OpaqueRef:sr',
      { target: '192.0.2.30', password: 'pbd-device-secret' },
    ],
  },
  {
    channel: 'vm:advSetPlatformParam',
    category: 'credentials',
    secret: 'platform-config-secret',
    args: ['pool-1', 'OpaqueRef:vm', 'password', 'platform-config-secret'],
  },
  {
    channel: 'vm:advSetOtherConfig',
    category: 'credentials',
    secret: 'vm-other-config-secret',
    args: ['pool-1', 'OpaqueRef:vm', 'secret', 'vm-other-config-secret'],
  },
]

describe('global IPC contract inventory', () => {
  it('gives every public channel exactly one descriptor identity and direction', () => {
    const contracts = ipcContractInventory.contracts
    const invokes = contracts.filter(({ direction }) => direction === 'invoke')
    const pushes = contracts.filter(({ direction }) => direction === 'push')
    const publicChannels = Object.values(Ch)

    expect(contracts).toHaveLength(245)
    expect(new Set(contracts.map(({ channel }) => channel))).toHaveLength(245)
    expect(invokes).toHaveLength(242)
    expect(pushes.map(({ channel }) => channel).sort()).toEqual([
      'alert:triggered',
      'batch:progress',
      'vm:changed',
    ])
    expect(invokes.every(({ callerPolicy }) => callerPolicy === 'app-window-main-frame'))
      .toBe(true)
    expect(pushes.every(({ callerPolicy }) => callerPolicy === 'main-process')).toBe(true)
    expect(new Set(contracts.map(({ channel }) => channel))).toEqual(new Set(publicChannels))
  })

  it('redacts every sensitive invoke descriptor through the shared main wrapper', async () => {
    const invokes = ipcContractInventory.contracts.filter(
      (contract): contract is IpcInvokeContract<readonly unknown[], unknown> => (
        contract.direction === 'invoke'
      ),
    )
    const sensitiveInvokes = invokes.filter(({ redaction }) => !redaction.includes('none'))
    const expectedIdentities = sensitiveContractCases
      .map(({ channel, category }) => `${channel}:${category}`)
      .sort()

    expect(sensitiveInvokes
      .map(({ channel, redaction }) => `${channel}:${redaction.join(',')}`)
      .sort()).toEqual(expectedIdentities)

    const byChannel = new Map(sensitiveInvokes.map((contract) => [contract.channel, contract]))
    for (const testCase of sensitiveContractCases) {
      const contract = byChannel.get(testCase.channel)
      expect(contract).toBeDefined()
      expect(() => contract?.argsSchema.parse(testCase.args)).not.toThrow()

      const logger = { debug: vi.fn(), error: vi.fn() }
      const service = vi.fn(() => {
        throw Object.assign(new Error(`Rejected ${testCase.secret}`), {
          code: 'SENSITIVE_INPUT_REJECTED',
          details: { rejected: testCase.secret },
        })
      })
      const handler = createIpcContractHandler(
        contract as IpcInvokeContract<readonly unknown[], unknown>,
        service,
        { owner: { assertCurrent: vi.fn() }, logger },
      )

      const result = await handler({} as never, ...testCase.args)
      expect(service).toHaveBeenCalledOnce()
      expect(result).toMatchObject({ error: true, code: 'SENSITIVE_INPUT_REJECTED' })
      const diagnostics = JSON.stringify({
        result,
        debug: logger.debug.mock.calls,
        error: logger.error.mock.calls,
      })
      expect(diagnostics).toContain('[REDACTED]')
      expect(diagnostics).not.toContain(testCase.secret)
    }
  })
})
