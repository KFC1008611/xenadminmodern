import { beforeEach, describe, expect, it, vi } from 'vitest'

const registeredHandlers = new Map<string, (...args: unknown[]) => unknown>()
const mockIpcMainHandle = vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
  registeredHandlers.set(channel, handler)
})

vi.mock('electron', () => ({
  ipcMain: { handle: mockIpcMainHandle },
  BrowserWindow: { getFocusedWindow: vi.fn(() => null) },
  dialog: {
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn(),
  },
}))

const mockGetPool = vi.fn()
const mockAddHostToPool = vi.fn()
const mockRemoveHostFromPool = vi.fn()
const mockTransferPoolMaster = vi.fn()

vi.mock('../../src/main/xapi/services/pool.service', () => ({
  getPool: mockGetPool,
  addHostToPool: mockAddHostToPool,
  removeHostFromPool: mockRemoveHostFromPool,
  transferPoolMaster: mockTransferPoolMaster,
}))

vi.mock('../../src/main/xapi/services/task.service', () => ({
  getAllTasks: vi.fn(() => []),
  cancelTask: vi.fn(),
}))

const mockListProfiles = vi.fn(() => [])
const mockSaveProfile = vi.fn()

vi.mock('../../src/main/profiles/profile.service', () => ({
  listProfiles: mockListProfiles,
  saveProfile: mockSaveProfile,
  deleteProfile: vi.fn(),
  getPassword: vi.fn(() => null),
  hasPassword: vi.fn(() => false),
}))

const mockCloseConsoleSession = vi.fn()

vi.mock('../../src/main/console/console.service', () => ({
  openConsoleSession: vi.fn(),
  closeConsoleSession: mockCloseConsoleSession,
}))

vi.mock('../../src/main/xapi/services/alert.service', () => ({
  getAllAlerts: vi.fn(() => []),
  dismissAlert: vi.fn(),
  dismissAllAlerts: vi.fn(() => 0),
  getAlertHistory: vi.fn(() => []),
  acknowledgeAlert: vi.fn(),
  getAlertCountByStatus: vi.fn(() => ({ active: 0, acknowledged: 0, resolved: 0 })),
  alertEmitter: { on: vi.fn(), removeListener: vi.fn() },
}))

vi.mock('../../src/main/xapi/services/metrics.service', () => ({
  startMetricsCollection: vi.fn(),
  stopMetricsCollection: vi.fn(),
  getMetricsHistory: vi.fn(() => []),
  getMetricsRange: vi.fn(() => []),
  getMetricsStats: vi.fn(() => ({ current: 0, min: 0, max: 0, avg: 0 })),
  getVmMetricsRange: vi.fn(() => []),
  collectVmMetrics: vi.fn(),
  getCollectionError: vi.fn(() => null),
}))

vi.mock('../../src/main/xapi/services/alert-rule.service', () => ({
  getAlertRules: vi.fn(() => []),
  createAlertRule: vi.fn(),
  updateAlertRule: vi.fn(),
  deleteAlertRule: vi.fn(),
}))

vi.mock('../../src/main/xapi/services/alert-engine.service', () => ({
  evaluateOnce: vi.fn(() => []),
}))

const mockSaveNotificationConfig = vi.fn()

vi.mock('../../src/main/xapi/services/alert-notification.service', () => ({
  getNotificationConfig: vi.fn(),
  saveNotificationConfig: mockSaveNotificationConfig,
  initDefaultConfig: vi.fn(),
  getNotificationHistory: vi.fn(() => []),
  sendAlertNotification: vi.fn(() => ({ email: false, webhook: false })),
  testNotification: vi.fn(() => true),
}))

vi.mock('../../src/main/batch', () => ({
  initBatchTaskManager: vi.fn(() => ({
    submitTask: vi.fn(),
    cancelTask: vi.fn(),
    getTaskStatus: vi.fn(),
    getAllTasks: vi.fn(() => []),
    retryFailedItems: vi.fn(),
  })),
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
const profile = {
  id: 'profile-1',
  name: 'Lab Pool',
  host: 'xcp.example.test',
  port: 443,
  scheme: 'https:' as const,
  username: 'root',
  lastConnected: null,
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
  const { registerInfrastructureHandlers } = await import(
    '../../src/main/ipc/handlers/infrastructure'
  )
  utils.rebindIpcOwner(current.owner as never, trustedUrl)
  registerInfrastructureHandlers()
  return { current, utils }
}

describe('infrastructure and observability IPC contract tracers', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    registeredHandlers.clear()
    mockListProfiles.mockReturnValue([])
  })

  it('allows only the current owner main frame across a read and local mutation', async () => {
    const { current, utils } = await setup()

    await expect(registeredHandlers.get('profile:list')?.(current.event)).resolves.toEqual([])
    await expect(registeredHandlers.get('profile:save')?.(
      current.event,
      profile,
      'pool-password',
    )).resolves.toBeUndefined()
    expect(mockListProfiles).toHaveBeenCalledOnce()
    expect(mockSaveProfile).toHaveBeenCalledWith(profile, 'pool-password')

    const assertRejected = async (event: object) => {
      await expect(registeredHandlers.get('profile:list')?.(event))
        .resolves.toMatchObject({ error: true, code: 'IPC_UNTRUSTED_SENDER' })
      await expect(registeredHandlers.get('profile:save')?.(event, profile, 'pool-password'))
        .resolves.toMatchObject({ error: true, code: 'IPC_UNTRUSTED_SENDER' })
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
    await expect(registeredHandlers.get('profile:list')?.(replacement.event)).resolves.toEqual([])

    expect(mockListProfiles).toHaveBeenCalledTimes(2)
    expect(mockSaveProfile).toHaveBeenCalledOnce()
  })

  it('redacts saved-server, console-session, and notification secrets from diagnostics', async () => {
    const { current } = await setup()
    const profileSecret = 'never-log-profile-password'
    const sessionSecret = 'OpaqueRef:never-log-session'
    const notificationSecret = 'never-log-notification-secret'

    mockSaveProfile.mockImplementationOnce(() => {
      throw new Error(`Profile rejected ${profileSecret}`)
    })
    mockCloseConsoleSession.mockImplementationOnce(() => {
      throw new Error(`Console expired ${sessionSecret}`)
    })
    mockSaveNotificationConfig.mockImplementationOnce(() => {
      throw new Error(`Notification rejected ${notificationSecret}`)
    })

    const profileResult = await registeredHandlers.get('profile:save')?.(
      current.event,
      profile,
      profileSecret,
    )
    const sessionResult = await registeredHandlers.get('console:close')?.(
      current.event,
      sessionSecret,
    )
    const notificationResult = await registeredHandlers.get('alertNotify:saveConfig')?.(
      current.event,
      {
        enabled: true,
        email: {
          enabled: true,
          host: 'smtp.example.test',
          port: 587,
          secure: false,
          auth: { user: 'alerts', pass: notificationSecret },
          from: 'alerts@example.test',
          to: 'ops@example.test',
        },
        webhook: { enabled: false, url: '' },
        filterSeverities: ['warning'],
      },
    )

    const diagnostics = JSON.stringify({
      profileResult,
      sessionResult,
      notificationResult,
      debug: mockDebug.mock.calls,
      error: mockError.mock.calls,
    })
    for (const secret of [profileSecret, sessionSecret, notificationSecret]) {
      expect(diagnostics).not.toContain(secret)
    }
  })
})
