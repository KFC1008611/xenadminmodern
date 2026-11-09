import { beforeEach, describe, expect, it, vi } from 'vitest'

const registeredHandlers = new Map<string, (...args: unknown[]) => unknown>()
const mockIpcMainHandle = vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
  registeredHandlers.set(channel, handler)
})

vi.mock('electron', () => ({
  ipcMain: { handle: mockIpcMainHandle },
}))

const mockGetAllSrs = vi.fn()
const mockCreateVdi = vi.fn()
const mockDestroyVdi = vi.fn()
const mockCreateSr = vi.fn()
const mockDestroySr = vi.fn()
const mockMoveVdi = vi.fn()

vi.mock('../../src/main/xapi/services/sr.service', () => ({
  getAllSrs: mockGetAllSrs,
  getAllVdis: vi.fn(),
  createVdi: mockCreateVdi,
  destroyVdi: mockDestroyVdi,
  createSr: mockCreateSr,
  destroySr: mockDestroySr,
  scanSr: vi.fn(),
  detachSr: vi.fn(),
  setDefaultSr: vi.fn(),
  probeNfs: vi.fn(),
  updateSrIdentity: vi.fn(),
  probeIscsi: vi.fn(),
}))

vi.mock('../../src/main/xapi/services/vdi.service', () => ({
  resizeVdi: vi.fn(),
  createVdiForVm: vi.fn(),
  getAllowedVdiOperations: vi.fn(),
  listAttachableVdis: vi.fn(),
  attachExistingVdi: vi.fn(),
  moveVdi: mockMoveVdi,
}))

const mockGetAllNetworks = vi.fn()
const mockCreateNetwork = vi.fn()
const mockCreateVlan = vi.fn()

vi.mock('../../src/main/xapi/services/network.service', () => ({
  getAllNetworks: mockGetAllNetworks,
  getAllPifs: vi.fn(),
  createNetwork: mockCreateNetwork,
  destroyNetwork: vi.fn(),
  renameNetwork: vi.fn(),
  createVif: vi.fn(),
  destroyVif: vi.fn(),
  plugVif: vi.fn(),
  unplugVif: vi.fn(),
  moveVif: vi.fn(),
  getAllBonds: vi.fn(),
  createBond: vi.fn(),
  destroyBond: vi.fn(),
  destroyBondGroup: vi.fn(),
  getBondRecord: vi.fn(),
  getAllVlans: vi.fn(),
  createVlan: mockCreateVlan,
  destroyVlan: vi.fn(),
  destroyVlanNetwork: vi.fn(),
  getVlanRecord: vi.fn(),
  getAllTunnels: vi.fn(),
  createTunnel: vi.fn(),
  destroyTunnel: vi.fn(),
  reconfigurePifIp: vi.fn(),
  scanPifs: vi.fn(),
  getPifsForHost: vi.fn(),
  setVifQos: vi.fn(),
  clearVifQos: vi.fn(),
  getNetworkAllowedOperations: vi.fn(),
  addNetworkTag: vi.fn(),
  removeNetworkTag: vi.fn(),
  updateNetworkOtherConfig: vi.fn(),
}))

vi.mock('../../src/main/xapi/services/storage-advanced.service', () => ({
  getAllPbds: vi.fn(),
  createPbd: vi.fn(),
  plugPbd: vi.fn(),
  unplugPbd: vi.fn(),
  destroyPbd: vi.fn(),
  cloneVdi: vi.fn(),
  snapshotVdi: vi.fn(),
  copyVdi: vi.fn(),
  introduceSr: vi.fn(),
  forgetSr: vi.fn(),
  setSrShared: vi.fn(),
  setVdiNameLabel: vi.fn(),
  setVdiNameDescription: vi.fn(),
  addVdiTag: vi.fn(),
  removeVdiTag: vi.fn(),
  getIsos: vi.fn(),
  deleteIso: vi.fn(),
  getSrThinProvisioningStats: vi.fn(),
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

describe('storage and network IPC contract tracers', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    registeredHandlers.clear()
  })

  it('rejects malformed storage payloads and redacts secrets before services or audit gates', async () => {
    mockGetAllSrs.mockResolvedValueOnce([])
    const current = createOwner()
    const utils = await import('../../src/main/ipc/handlers/utils')
    const { registerStorageHandlers } = await import('../../src/main/ipc/handlers/storage')
    utils.rebindIpcOwner(current.owner as never, trustedUrl)
    registerStorageHandlers()

    const inventory = utils.getIpcRegistrationInventory()
    expect(inventory.contracts.some(({ channel }) => channel === 'sr:list')).toBe(true)
    await expect(registeredHandlers.get('sr:list')?.(current.event, 'pool-1'))
      .resolves.toEqual([])

    await expect(registeredHandlers.get('vdi:create')?.(
      current.event,
      'pool-1',
      'OpaqueRef:sr',
      'Disk',
      0,
    )).resolves.toMatchObject({ error: true, code: 'IPC_SCHEMA_INVALID' })
    expect(mockCreateVdi).not.toHaveBeenCalled()

    const secret = 'never-log-storage-secret'
    const malformed = {
      type: 'iscsi',
      nameLabel: 'Shared storage',
      nameDescription: '',
      iscsiTarget: '192.0.2.20',
      chapUser: 'storage-user',
      chapPassword: secret,
      unexpected: true,
    }
    const result = await registeredHandlers.get('sr:create')?.(
      current.event,
      'pool-1',
      'OpaqueRef:host',
      malformed,
    )
    expect(result).toMatchObject({ error: true, code: 'IPC_SCHEMA_INVALID' })
    expect(JSON.stringify(result)).not.toContain(secret)
    expect(JSON.stringify(mockDebug.mock.calls)).not.toContain(secret)
    expect(JSON.stringify(mockError.mock.calls)).not.toContain(secret)
    expect(mockCreateSr).not.toHaveBeenCalled()

    await expect(registeredHandlers.get('sr:destroy')?.(
      current.event,
      'pool-1',
      'OpaqueRef:sr',
    )).resolves.toMatchObject({ error: true, message: expect.stringContaining('暂不可用') })
    expect(mockDestroySr).not.toHaveBeenCalled()
  })

  it('accepts only the current owner main frame before network reads and gated mutations', async () => {
    mockGetAllNetworks.mockResolvedValueOnce([])
    mockCreateNetwork.mockResolvedValueOnce('OpaqueRef:network')
    const original = createOwner()
    const utils = await import('../../src/main/ipc/handlers/utils')
    const { registerStorageHandlers } = await import('../../src/main/ipc/handlers/storage')
    utils.rebindIpcOwner(original.owner as never, trustedUrl)
    registerStorageHandlers()

    await expect(registeredHandlers.get('network:list')?.(original.event, 'pool-1'))
      .resolves.toEqual([])
    expect(mockGetAllNetworks).toHaveBeenCalledOnce()

    await expect(registeredHandlers.get('network:create')?.(
      original.event,
      'pool-1',
      'Guest network',
      '',
    )).resolves.toEqual('OpaqueRef:network')
    expect(mockCreateNetwork).toHaveBeenCalledWith('pool-1', 'Guest network', '')

    const assertUntrusted = async (event: object) => {
      await expect(registeredHandlers.get('network:list')?.(event, 'pool-1'))
        .resolves.toMatchObject({ error: true, code: 'IPC_UNTRUSTED_SENDER' })
      await expect(registeredHandlers.get('vlan:create')?.(
        event,
        'pool-1',
        { taggedPifRef: 'OpaqueRef:pif', vlanTag: 100 },
      )).resolves.toMatchObject({ error: true, code: 'IPC_UNTRUSTED_SENDER' })
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
    expect(mockGetAllNetworks).toHaveBeenCalledOnce()
    expect(mockCreateVlan).not.toHaveBeenCalled()
  })

  it('returns the migrated VDI reference without altering the VBD relationship locally', async () => {
    mockMoveVdi.mockResolvedValueOnce({ newVdiRef: 'OpaqueRef:moved-vdi' })
    const current = createOwner()
    const utils = await import('../../src/main/ipc/handlers/utils')
    const { registerStorageHandlers } = await import('../../src/main/ipc/handlers/storage')
    utils.rebindIpcOwner(current.owner as never, trustedUrl)
    registerStorageHandlers()

    const payload = { vdiRef: 'OpaqueRef:vdi', targetSrRef: 'OpaqueRef:sr' }
    await expect(registeredHandlers.get('vdi:move')?.(current.event, 'pool-1', payload))
      .resolves.toEqual({ newVdiRef: 'OpaqueRef:moved-vdi' })
    expect(mockMoveVdi).toHaveBeenCalledWith('pool-1', payload)
  })
})
