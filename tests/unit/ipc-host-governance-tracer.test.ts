import { beforeEach, describe, expect, it, vi } from 'vitest'

const registeredHandlers = new Map<string, (...args: unknown[]) => unknown>()
const mockIpcMainHandle = vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
  registeredHandlers.set(channel, handler)
})

vi.mock('electron', () => ({
  ipcMain: { handle: mockIpcMainHandle },
}))

const hostRecord = {
  ref: 'OpaqueRef:host',
  uuid: 'host-uuid',
  name_label: 'xcp-1',
  hostname: 'xcp-1.example.test',
  address: '192.0.2.10',
  enabled: true,
  resident_VMs: [],
  memory_total: 64,
  memory_free: 32,
  cpu_info: {},
  software_version: {},
  metrics: 'OpaqueRef:host-metrics',
  suspend_image_sr: 'OpaqueRef:NULL',
  connectionId: 'pool-1',
  poolName: 'Lab Pool',
}

const mockGetAllHosts = vi.fn(() => [hostRecord])
const mockDisableHost = vi.fn()

vi.mock('../../src/main/xapi/services/host.service', () => ({
  getAllHosts: mockGetAllHosts,
  getHostMetrics: vi.fn(() => ({
    ref: 'OpaqueRef:host-metrics',
    memory_total: 64,
    memory_free: 32,
    live: true,
  })),
  enableHost: vi.fn(),
  disableHost: mockDisableHost,
  rebootHost: vi.fn(),
  shutdownHost: vi.fn(),
  getMaintenanceStatus: vi.fn(() => ({
    hostRef: 'OpaqueRef:host',
    state: 'enabled',
    runningVms: 0,
    residentVms: [],
  })),
  enterMaintenanceMode: vi.fn(() => ({
    success: true,
    migratedVms: [],
    failedVms: [],
  })),
  exitMaintenanceMode: vi.fn(),
  evacuateHost: vi.fn(() => ({
    success: true,
    migratedVms: [],
    failedVms: [],
  })),
}))

const mockAssertAuditedFeatureAvailable = vi.fn()

vi.mock('../../src/shared/audited-features', () => ({
  assertAuditedFeatureAvailable: mockAssertAuditedFeatureAvailable,
}))

vi.mock('../../src/main/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
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

async function setup() {
  const current = createOwner()
  const utils = await import('../../src/main/ipc/handlers/utils')
  const { registerHostHandlers } = await import('../../src/main/ipc/handlers/host')
  utils.rebindIpcOwner(current.owner as never, trustedUrl)
  registerHostHandlers()
  return { current, utils }
}

describe('host governance IPC contract tracer', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    registeredHandlers.clear()
    mockGetAllHosts.mockReturnValue([hostRecord])
  })

  it('allows only the current owner main frame across a read and gated mutation', async () => {
    const { current, utils } = await setup()

    await expect(registeredHandlers.get('host:list')?.(current.event, 'pool-1'))
      .resolves.toEqual([hostRecord])
    await expect(registeredHandlers.get('host:disable')?.(
      current.event,
      'pool-1',
      'OpaqueRef:host',
    )).resolves.toBeUndefined()
    expect(mockGetAllHosts).toHaveBeenCalledWith('pool-1')
    expect(mockAssertAuditedFeatureAvailable).toHaveBeenCalledWith('host.maintenance')
    expect(mockDisableHost).toHaveBeenCalledWith('pool-1', 'OpaqueRef:host')

    const assertRejected = async (event: object) => {
      await expect(registeredHandlers.get('host:list')?.(event, 'pool-1'))
        .resolves.toMatchObject({ error: true, code: 'IPC_UNTRUSTED_SENDER' })
      await expect(registeredHandlers.get('host:disable')?.(
        event,
        'pool-1',
        'OpaqueRef:host',
      )).resolves.toMatchObject({ error: true, code: 'IPC_UNTRUSTED_SENDER' })
    }

    await assertRejected({
      sender: current.event.sender,
      senderFrame: { url: trustedUrl },
    })
    await assertRejected({})

    current.navigate('https://external.example.test/')
    await assertRejected(current.event)

    const replacement = createOwner()
    utils.rebindIpcOwner(replacement.owner as never, trustedUrl)
    await assertRejected(current.event)
    await expect(registeredHandlers.get('host:list')?.(replacement.event, 'pool-1'))
      .resolves.toEqual([hostRecord])

    expect(mockGetAllHosts).toHaveBeenCalledTimes(2)
    expect(mockAssertAuditedFeatureAvailable).toHaveBeenCalledOnce()
    expect(mockDisableHost).toHaveBeenCalledOnce()
  })

  it('rejects malformed host references before the audited gate or service', async () => {
    const { current } = await setup()

    await expect(registeredHandlers.get('host:disable')?.(
      current.event,
      'pool-1',
      'OpaqueRef:NULL',
    )).resolves.toMatchObject({ error: true, code: 'IPC_SCHEMA_INVALID' })
    expect(mockAssertAuditedFeatureAvailable).not.toHaveBeenCalled()
    expect(mockDisableHost).not.toHaveBeenCalled()
  })
})
