import { beforeEach, describe, expect, it, vi } from 'vitest'

const registeredHandlers = new Map<string, (...args: unknown[]) => unknown>()
const mockIpcMainHandle = vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
  registeredHandlers.set(channel, handler)
})

vi.mock('electron', () => ({
  ipcMain: { handle: mockIpcMainHandle },
}))

const mockGetHaConfiguration = vi.fn()
const mockEnableHa = vi.fn()

vi.mock('../../src/main/xapi/services/ha.service', () => ({
  getHaConfiguration: mockGetHaConfiguration,
  enableHa: mockEnableHa,
  disableHa: vi.fn(),
  computeHaTolerance: vi.fn(),
  preventHaRestarts: vi.fn(),
  getHaVmConfigs: vi.fn(),
  setHaVmRestartPriority: vi.fn(),
  setHaVmAlwaysRun: vi.fn(),
  getHaVmAlwaysRun: vi.fn(),
  emergencyTransitionToMaster: vi.fn(),
  recoverHaSlaves: vi.fn(),
  getHaFailoverPlan: vi.fn(),
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
const config = {
  enabled: false,
  allowOvercommit: false,
  plannedRepeats: 0,
  heartbeatSRs: [],
  hosts: [],
  connectionId: 'pool-1',
  poolName: 'Lab Pool',
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
  const owner = createOwner()
  const utils = await import('../../src/main/ipc/handlers/utils')
  const { registerHaHandlers } = await import('../../src/main/ipc/handlers/ha')
  utils.rebindIpcOwner(owner.owner as never, trustedUrl)
  registerHaHandlers()
  return { owner, utils }
}

describe('HA governance IPC contract tracer', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    registeredHandlers.clear()
  })

  it('registers all twelve HA descriptors as migrated invoke channels', async () => {
    const { utils } = await setup()

    expect(utils.getIpcRegistrationInventory().contracts.map(({ channel }) => channel)).toEqual([
      'ha:getConfig',
      'ha:enable',
      'ha:disable',
      'ha:computeTolerance',
      'ha:preventRestarts',
      'ha:getVmConfigs',
      'ha:setVmPriority',
      'ha:setVmAlwaysRun',
      'ha:getVmAlwaysRun',
      'ha:emergencyMaster',
      'ha:recoverSlaves',
      'ha:getFailoverPlan',
    ])
  })

  it('allows only the current owner main frame to reach a read and a gated mutation', async () => {
    mockGetHaConfiguration.mockResolvedValue(config)
    const { owner: original, utils } = await setup()
    const read = registeredHandlers.get('ha:getConfig')
    const mutation = registeredHandlers.get('ha:enable')

    await expect(read?.(original.event, 'pool-1')).resolves.toEqual(config)
    await expect(mutation?.(
      original.event,
      'pool-1',
      { heartbeatSRs: ['OpaqueRef:sr'] },
    )).resolves.toMatchObject({ error: true, message: expect.stringContaining('暂不可用') })

    const assertUntrusted = async (event: object) => {
      await expect(read?.(event, 'pool-1'))
        .resolves.toMatchObject({ error: true, code: 'IPC_UNTRUSTED_SENDER' })
      await expect(mutation?.(event, 'pool-1', { heartbeatSRs: ['OpaqueRef:sr'] }))
        .resolves.toMatchObject({ error: true, code: 'IPC_UNTRUSTED_SENDER' })
    }

    await assertUntrusted({
      sender: original.event.sender,
      senderFrame: { url: trustedUrl },
    })
    await assertUntrusted({})

    original.navigate('https://external.example.test/')
    await assertUntrusted(original.event)

    const replacement = createOwner()
    utils.rebindIpcOwner(replacement.owner as never, trustedUrl)
    await assertUntrusted(original.event)
    await expect(read?.(replacement.event, 'pool-1')).resolves.toEqual(config)

    expect(mockGetHaConfiguration).toHaveBeenCalledTimes(2)
    expect(mockEnableHa).not.toHaveBeenCalled()
  })

  it('rejects malformed HA payloads before services or audit gates', async () => {
    const { owner } = await setup()

    await expect(registeredHandlers.get('ha:enable')?.(
      owner.event,
      'pool-1',
      { heartbeatSRs: ['OpaqueRef:sr'], unknown: true },
    )).resolves.toMatchObject({ error: true, code: 'IPC_SCHEMA_INVALID' })
    await expect(registeredHandlers.get('ha:setVmPriority')?.(
      owner.event,
      'pool-1',
      'OpaqueRef:vm',
      4,
    )).resolves.toMatchObject({ error: true, code: 'IPC_SCHEMA_INVALID' })

    expect(mockEnableHa).not.toHaveBeenCalled()
  })
})
