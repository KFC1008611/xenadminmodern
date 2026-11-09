import { beforeEach, describe, expect, it, vi } from 'vitest'

const registeredHandlers = new Map<string, (...args: unknown[]) => unknown>()
const mockIpcMainHandle = vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
  registeredHandlers.set(channel, handler)
})

vi.mock('electron', () => ({
  ipcMain: { handle: mockIpcMainHandle },
}))

const mockCallWithSession = vi.fn()
const mockClient = { callWithSession: mockCallWithSession }
const mockGetClient = vi.fn(() => mockClient)

vi.mock('../../src/main/xapi/connection-manager', () => ({
  connectionManager: { getClient: mockGetClient },
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

const rawVmRecord = {
  uuid: 'vm-uuid',
  name_label: 'Workload VM',
  affinity: 'OpaqueRef:NULL',
  ha_always_run: false,
  VCPUs_at_startup: 2,
  VCPUs_max: 4,
  start_delay: '5',
  HVM_boot_params: { order: 'cdn' },
  other_config: { owner: 'platform-team' },
  platform: { viridian: 'true' },
}

async function setup() {
  const owner = createOwner()
  const utils = await import('../../src/main/ipc/handlers/utils')
  const { registerVmAdvancedHandlers } = await import('../../src/main/ipc/handlers/vm-advanced')
  utils.rebindIpcOwner(owner.owner as never, trustedUrl)
  registerVmAdvancedHandlers()
  return { owner, utils }
}

describe('VM Advanced IPC contract tracer', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    registeredHandlers.clear()
  })

  it('registers the three reads as migrated invokes and serves the current main frame', async () => {
    mockCallWithSession.mockResolvedValueOnce(rawVmRecord)
    const { owner, utils } = await setup()

    expect(utils.getIpcRegistrationInventory().contracts.slice(0, 3).map(({ channel, direction }) => ({
      channel,
      direction,
    }))).toEqual([
      { channel: 'vm:advGetConfig', direction: 'invoke' },
      { channel: 'vm:advGetAllConfigs', direction: 'invoke' },
      { channel: 'vm:advGetAffinity', direction: 'invoke' },
    ])
    await expect(registeredHandlers.get('vm:advGetConfig')?.(
      owner.event,
      'pool-1',
      'OpaqueRef:vm',
    )).resolves.toEqual({
      vmRef: 'OpaqueRef:vm',
      vmName: 'Workload VM',
      affinity: null,
      antiAffinity: [],
      antiAffinitySupported: false,
      isProtected: false,
      vcpusHotplug: true,
      startDelay: 5,
      bootOrder: 'cdn',
      hvmBootParams: { order: 'cdn' },
      otherConfig: { owner: 'platform-team' },
      platform: { viridian: 'true' },
    })
    expect(mockGetClient).toHaveBeenCalledWith('pool-1')
    expect(mockCallWithSession).toHaveBeenCalledWith('VM.get_record', ['OpaqueRef:vm'])
  })

  it('rejects malformed reads before XAPI and malformed service results before return', async () => {
    const { owner } = await setup()
    const handler = registeredHandlers.get('vm:advGetConfig')

    await expect(handler?.(owner.event, 'pool-1', 'OpaqueRef:NULL'))
      .resolves.toMatchObject({ error: true, code: 'IPC_SCHEMA_INVALID' })
    expect(mockCallWithSession).not.toHaveBeenCalled()

    mockCallWithSession.mockResolvedValueOnce({ ...rawVmRecord, name_label: 7 })
    await expect(handler?.(owner.event, 'pool-1', 'OpaqueRef:vm'))
      .resolves.toMatchObject({ error: true, code: 'IPC_RESULT_INVALID' })
  })

  it('rejects child frames, external documents, forged events, and an old owner', async () => {
    const { owner: previous, utils } = await setup()
    const handler = registeredHandlers.get('vm:advGetAffinity')

    const childFrame = await handler?.({
      sender: previous.owner.webContents,
      senderFrame: { url: trustedUrl },
    }, 'pool-1', 'OpaqueRef:vm')
    const forged = await handler?.({}, 'pool-1', 'OpaqueRef:vm')
    previous.navigate('https://external.example.test/')
    const external = await handler?.(previous.event, 'pool-1', 'OpaqueRef:vm')
    const current = createOwner()
    utils.rebindIpcOwner(current.owner as never, trustedUrl)
    const oldOwner = await handler?.(previous.event, 'pool-1', 'OpaqueRef:vm')

    for (const result of [childFrame, forged, external, oldOwner]) {
      expect(result).toMatchObject({ error: true, code: 'IPC_UNTRUSTED_SENDER' })
    }
    expect(mockCallWithSession).not.toHaveBeenCalled()
  })

  it('registers affinity and protection mutations as contracts and reaches XAPI for supported work', async () => {
    const blocked: Record<string, string> = {}
    let affinity = 'OpaqueRef:NULL'
    mockCallWithSession.mockImplementation(async (method: string, args: any[]) => {
      if (method === 'VM.get_record') return { ...rawVmRecord, affinity, blocked_operations: { ...blocked } }
      if (method === 'VM.set_affinity') affinity = args[1]
      if (method === 'host.get_record') return { uuid: 'host-uuid' }
      if (method === 'VM.add_to_blocked_operations') blocked[args[1]] = args[2]
      return undefined
    })
    const { owner, utils } = await setup()

    expect(utils.getIpcRegistrationInventory().contracts.slice(3, 9).map(({ channel }) => channel))
      .toEqual([
        'vm:advSetAffinity',
        'vm:advSetAntiAffinity',
        'vm:advAddAntiAffinity',
        'vm:advRemoveAntiAffinity',
        'vm:advEnableProtection',
        'vm:advDisableProtection',
      ])

    await expect(registeredHandlers.get('vm:advSetAffinity')?.(
      owner.event,
      'pool-1',
      'OpaqueRef:vm',
      'OpaqueRef:host',
    )).resolves.toBeUndefined()
    await expect(registeredHandlers.get('vm:advEnableProtection')?.(
      owner.event,
      'pool-1',
      'OpaqueRef:vm',
    )).resolves.toBeUndefined()
    expect(mockCallWithSession.mock.calls).toEqual([
      ['VM.get_record', ['OpaqueRef:vm']],
      ['host.get_record', ['OpaqueRef:host']],
      ['VM.set_affinity', ['OpaqueRef:vm', 'OpaqueRef:host']],
      ['VM.get_record', ['OpaqueRef:vm']],
      ['VM.get_record', ['OpaqueRef:vm']],
      ['VM.add_to_blocked_operations', ['OpaqueRef:vm', 'destroy', 'XenAdmin Modern: VM deletion protection']],
      ['VM.get_record', ['OpaqueRef:vm']],
    ])
  })

  it('preserves unsupported anti-affinity as a business error without any XAPI call', async () => {
    const { owner } = await setup()

    await expect(registeredHandlers.get('vm:advSetAntiAffinity')?.(
      owner.event,
      'pool-1',
      'OpaqueRef:vm',
      ['OpaqueRef:peer'],
    )).resolves.toMatchObject({
      error: true,
      code: 'UNKNOWN_ERROR',
      message: 'VM anti-affinity is not supported by this XenAPI VM interface；请通过支持 VM Group 的管理工具配置放置组',
      details: {
        kind: 'client',
        originalMessage: 'VM anti-affinity is not supported by this XenAPI VM interface；请通过支持 VM Group 的管理工具配置放置组',
      },
    })
    expect(mockGetClient).not.toHaveBeenCalled()
    expect(mockCallWithSession).not.toHaveBeenCalled()
  })

  it('rejects malformed affinity before XAPI and preserves XAPI error metadata', async () => {
    const { owner } = await setup()

    await expect(registeredHandlers.get('vm:advSetAffinity')?.(
      owner.event,
      'pool-1',
      'OpaqueRef:vm',
      'OpaqueRef:NULL',
    )).resolves.toMatchObject({ error: true, code: 'IPC_SCHEMA_INVALID' })
    expect(mockCallWithSession).not.toHaveBeenCalled()

    mockCallWithSession.mockRejectedValueOnce(Object.assign(
      new Error('VM is in the wrong power state'),
      { code: 'VM_BAD_POWER_STATE', params: ['OpaqueRef:vm', 'Halted', 'Running'] },
    ))
    await expect(registeredHandlers.get('vm:advEnableProtection')?.(
      owner.event,
      'pool-1',
      'OpaqueRef:vm',
    )).resolves.toMatchObject({
      error: true,
      message: 'VM is in the wrong power state',
      code: 'VM_BAD_POWER_STATE',
      details: {
        code: 'VM_BAD_POWER_STATE',
        params: ['OpaqueRef:vm', 'Halted', 'Running'],
        kind: 'xapi',
      },
    })
  })

  it('registers VCPU, delay, and boot mutations and passes validated values to XAPI', async () => {
    let maximum = rawVmRecord.VCPUs_max
    mockCallWithSession.mockImplementation(async (method: string, args: any[]) => {
      if (method === 'VM.get_record') return { ...rawVmRecord, power_state: 'Halted', VCPUs_max: maximum }
      if (method === 'VM.set_VCPUs_max') maximum = args[1]
      return undefined
    })
    const { owner, utils } = await setup()

    expect(utils.getIpcRegistrationInventory().contracts.slice(9, 14).map(({ channel }) => channel))
      .toEqual([
        'vm:advSetVcpuHotplug',
        'vm:advSetVcpusNumber',
        'vm:advSetStartDelay',
        'vm:advSetBootOrder',
        'vm:advSetHvmBootParams',
      ])

    await expect(registeredHandlers.get('vm:advSetVcpuHotplug')?.(
      owner.event, 'pool-1', 'OpaqueRef:vm', 8,
    )).resolves.toBeUndefined()
    await expect(registeredHandlers.get('vm:advSetStartDelay')?.(
      owner.event, 'pool-1', 'OpaqueRef:vm', 10,
    )).resolves.toBeUndefined()
    await expect(registeredHandlers.get('vm:advSetBootOrder')?.(
      owner.event, 'pool-1', 'OpaqueRef:vm', 'dnc',
    )).resolves.toBeUndefined()
    await expect(registeredHandlers.get('vm:advSetHvmBootParams')?.(
      owner.event, 'pool-1', 'OpaqueRef:vm', { order: 'cdn' },
    )).resolves.toBeUndefined()

    expect(mockCallWithSession.mock.calls).toEqual([
      ['VM.get_record', ['OpaqueRef:vm']],
      ['VM.set_VCPUs_max', ['OpaqueRef:vm', 8]],
      ['VM.get_record', ['OpaqueRef:vm']],
      ['VM.set_start_delay', ['OpaqueRef:vm', 10]],
      ['VM.get_record', ['OpaqueRef:vm']],
      ['VM.set_HVM_boot_params', ['OpaqueRef:vm', { order: 'dnc' }]],
      ['VM.get_record', ['OpaqueRef:vm']],
      ['VM.set_HVM_boot_params', ['OpaqueRef:vm', { order: 'cdn' }]],
    ])
  })

  it('rejects invalid VCPU, delay, and boot values before any XAPI call', async () => {
    const { owner } = await setup()

    const cases: Array<[string, unknown[]]> = [
      ['vm:advSetVcpuHotplug', ['pool-1', 'OpaqueRef:vm', 0]],
      ['vm:advSetVcpusNumber', ['pool-1', 'OpaqueRef:vm', 1.5]],
      ['vm:advSetStartDelay', ['pool-1', 'OpaqueRef:vm', -1]],
      ['vm:advSetBootOrder', ['pool-1', 'OpaqueRef:vm', 'cc']],
      ['vm:advSetHvmBootParams', ['pool-1', 'OpaqueRef:vm', { order: 'x' }]],
    ]
    for (const [channel, args] of cases) {
      await expect(registeredHandlers.get(channel)?.(owner.event, ...args))
        .resolves.toMatchObject({ error: true, code: 'IPC_SCHEMA_INVALID' })
    }
    expect(mockCallWithSession).not.toHaveBeenCalled()
  })

  it('registers the exact twenty shared contract channels', async () => {
    const { utils } = await setup()
    const expectedChannels = [
      'vm:advGetConfig', 'vm:advGetAllConfigs', 'vm:advGetAffinity',
      'vm:advSetAffinity', 'vm:advSetAntiAffinity', 'vm:advAddAntiAffinity',
      'vm:advRemoveAntiAffinity', 'vm:advEnableProtection', 'vm:advDisableProtection',
      'vm:advSetVcpuHotplug', 'vm:advSetVcpusNumber', 'vm:advSetStartDelay',
      'vm:advSetBootOrder', 'vm:advSetHvmBootParams', 'vm:advSetPlatformParam',
      'vm:advSetViridian', 'vm:advSetOtherConfig', 'vm:advAddTag',
      'vm:advRemoveTag', 'vm:advSetStartOrder',
    ]

    expect(utils.getIpcRegistrationInventory().contracts.map(({ channel }) => channel))
      .toEqual(expectedChannels)
  })

  it('passes maps, tags, and start-order entries through the validated main boundary', async () => {
    mockCallWithSession.mockImplementation(async (method: string) =>
      method === 'VM.get_record' ? { ...rawVmRecord, tags: [] } : undefined,
    )
    const { owner } = await setup()

    await expect(registeredHandlers.get('vm:advSetPlatformParam')?.(
      owner.event, 'pool-1', 'OpaqueRef:vm', 'custom', '',
    )).resolves.toBeUndefined()
    await expect(registeredHandlers.get('vm:advAddTag')?.(
      owner.event, 'pool-1', 'OpaqueRef:vm', 'production',
    )).resolves.toBeUndefined()
    await expect(registeredHandlers.get('vm:advSetStartOrder')?.(
      owner.event,
      'pool-1',
      [{ vmRef: 'OpaqueRef:vm', startDelay: 10, order: 7 }],
    )).resolves.toBeUndefined()

    expect(mockCallWithSession.mock.calls).toEqual([
      ['VM.get_record', ['OpaqueRef:vm']],
      ['VM.set_platform', ['OpaqueRef:vm', { viridian: 'true', custom: '' }]],
      ['VM.get_record', ['OpaqueRef:vm']],
      ['VM.set_tags', ['OpaqueRef:vm', ['production']]],
      ['VM.set_start_delay', ['OpaqueRef:vm', 10]],
    ])
  })

  it('rejects malformed maps, tags, and start-order entries before XAPI', async () => {
    const { owner } = await setup()
    const cases: Array<[string, unknown[]]> = [
      ['vm:advSetPlatformParam', ['pool-1', 'OpaqueRef:vm', '', 'value']],
      ['vm:advSetViridian', ['pool-1', 'OpaqueRef:vm', 'true']],
      ['vm:advSetOtherConfig', ['pool-1', 'OpaqueRef:vm', 'key', 1]],
      ['vm:advAddTag', ['pool-1', 'OpaqueRef:vm', '   ']],
      ['vm:advRemoveTag', ['pool-1', 'OpaqueRef:vm', '']],
      ['vm:advSetStartOrder', ['pool-1', [{ vmRef: 'OpaqueRef:vm', startDelay: 0, order: -1 }]]],
    ]
    for (const [channel, args] of cases) {
      await expect(registeredHandlers.get(channel)?.(owner.event, ...args))
        .resolves.toMatchObject({ error: true, code: 'IPC_SCHEMA_INVALID' })
    }
    expect(mockCallWithSession).not.toHaveBeenCalled()
  })

  it('redacts positional configuration secrets from responses and debug/error logs', async () => {
    const secret = 'positional-super-secret'
    mockCallWithSession.mockResolvedValueOnce(rawVmRecord).mockRejectedValueOnce(Object.assign(
      new Error(`server rejected ${secret}`),
      { code: 'CONFIG_REJECTED', params: [secret] },
    ))
    const { owner } = await setup()

    const response = await registeredHandlers.get('vm:advSetPlatformParam')?.(
      owner.event, 'pool-1', 'OpaqueRef:vm', 'password', secret,
    )
    expect(response).toMatchObject({ error: true, code: 'CONFIG_REJECTED' })
    expect(JSON.stringify(response)).not.toContain(secret)
    expect(JSON.stringify(mockDebug.mock.calls)).not.toContain(secret)
    expect(JSON.stringify(mockError.mock.calls)).not.toContain(secret)
  })

  it('redacts secret-shaped HVM map values even with the none category', async () => {
    const secret = 'map-super-secret'
    mockCallWithSession.mockRejectedValueOnce(new Error(`server rejected ${secret}`))
    const { owner } = await setup()

    const response = await registeredHandlers.get('vm:advSetHvmBootParams')?.(
      owner.event, 'pool-1', 'OpaqueRef:vm', { apiToken: secret },
    )
    expect(response).toMatchObject({ error: true })
    expect(JSON.stringify(response)).not.toContain(secret)
    expect(JSON.stringify(mockDebug.mock.calls)).not.toContain(secret)
    expect(JSON.stringify(mockError.mock.calls)).not.toContain(secret)
  })
})
