import { beforeEach, describe, expect, it, vi } from 'vitest'

const registeredHandlers = new Map<string, (...args: unknown[]) => unknown>()
const mockIpcMainHandle = vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
  registeredHandlers.set(channel, handler)
})

vi.mock('electron', () => ({
  ipcMain: { handle: mockIpcMainHandle },
}))

const mockGetAllPatches = vi.fn()
const mockUploadPatch = vi.fn()

vi.mock('../../src/main/xapi/services/patch.service', () => ({
  getAllPatches: mockGetAllPatches,
  getPatchRecord: vi.fn(),
  getHostPatchStatus: vi.fn(),
  getMissingPatchesForHost: vi.fn(),
  uploadPatch: mockUploadPatch,
  precheckPatch: vi.fn(),
  applyPatch: vi.fn(),
  applyPatchToHost: vi.fn(),
  cleanPatch: vi.fn(),
  destroyPatch: vi.fn(),
  destroyPatchFromHost: vi.fn(),
  applyPatchesBatch: vi.fn(),
}))

const mockAssertAuditedFeatureAvailable = vi.fn()

vi.mock('../../src/shared/audited-features', () => ({
  assertAuditedFeatureAvailable: mockAssertAuditedFeatureAvailable,
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

async function setup() {
  const owner = createOwner()
  const utils = await import('../../src/main/ipc/handlers/utils')
  const { registerPatchHandlers } = await import('../../src/main/ipc/handlers/patch')
  utils.rebindIpcOwner(owner.owner as never, trustedUrl)
  registerPatchHandlers()
  return { owner, utils }
}

describe('patch governance IPC contract tracer', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    registeredHandlers.clear()
    mockAssertAuditedFeatureAvailable.mockImplementation(() => {
      throw new Error('B7: patch mutation unavailable')
    })
  })

  it('registers all twelve patch descriptors as migrated invoke channels', async () => {
    const { utils } = await setup()

    expect(utils.getIpcRegistrationInventory().contracts.map(({ channel }) => channel)).toEqual([
      'patch:list',
      'patch:getRecord',
      'patch:hostStatus',
      'patch:getMissing',
      'patch:upload',
      'patch:precheck',
      'patch:apply',
      'patch:applyToHost',
      'patch:clean',
      'patch:destroy',
      'patch:destroyFromHost',
      'patch:applyBatch',
    ])
  })

  it('allows only the current owner main frame to reach a read and a gated mutation', async () => {
    mockGetAllPatches.mockResolvedValue([])
    const { owner: original, utils } = await setup()
    const read = registeredHandlers.get('patch:list')
    const mutation = registeredHandlers.get('patch:upload')

    await expect(read?.(original.event, 'pool-1')).resolves.toEqual([])
    await expect(mutation?.(
      original.event,
      'pool-1',
      '/tmp/update.xsupdate',
    )).resolves.toMatchObject({ error: true, message: expect.stringContaining('B7') })
    expect(mockAssertAuditedFeatureAvailable).toHaveBeenCalledWith('patch.mutate')

    const assertUntrusted = async (event: object) => {
      await expect(read?.(event, 'pool-1'))
        .resolves.toMatchObject({ error: true, code: 'IPC_UNTRUSTED_SENDER' })
      await expect(mutation?.(event, 'pool-1', '/tmp/update.xsupdate'))
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
    await expect(read?.(replacement.event, 'pool-1')).resolves.toEqual([])

    expect(mockGetAllPatches).toHaveBeenCalledTimes(2)
    expect(mockUploadPatch).not.toHaveBeenCalled()
    expect(mockAssertAuditedFeatureAvailable).toHaveBeenCalledTimes(1)
  })

  it('rejects malformed payloads before patch services or audit gates', async () => {
    const { owner } = await setup()

    await expect(registeredHandlers.get('patch:upload')?.(
      owner.event,
      'pool-1',
      '',
    )).resolves.toMatchObject({ error: true, code: 'IPC_SCHEMA_INVALID' })
    await expect(registeredHandlers.get('patch:applyToHost')?.(
      owner.event,
      'pool-1',
      'OpaqueRef:NULL',
      'OpaqueRef:patch',
    )).resolves.toMatchObject({ error: true, code: 'IPC_SCHEMA_INVALID' })

    expect(mockAssertAuditedFeatureAvailable).not.toHaveBeenCalled()
    expect(mockUploadPatch).not.toHaveBeenCalled()
  })

  it('redacts a patch source from payload, error details, and structured logs', async () => {
    const filePath = '/private/update-source/never-log-this.xsupdate'
    mockAssertAuditedFeatureAvailable.mockImplementation(() => undefined)
    mockUploadPatch.mockImplementation(async () => {
      throw Object.assign(new Error(`Upload failed for ${filePath}`), {
        code: 'PATCH_UPLOAD_FAILED',
        details: { source: filePath },
      })
    })
    const { owner } = await setup()

    const result = await registeredHandlers.get('patch:upload')?.(
      owner.event,
      'pool-1',
      filePath,
    )

    expect(result).toMatchObject({ error: true, code: 'PATCH_UPLOAD_FAILED' })
    const diagnostics = JSON.stringify({
      result,
      debug: mockDebug.mock.calls,
      error: mockError.mock.calls,
    })
    expect(diagnostics).not.toContain(filePath)
    expect(mockUploadPatch).toHaveBeenCalledWith('pool-1', filePath)
  })
})
