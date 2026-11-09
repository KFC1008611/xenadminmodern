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
const mockGetConnectionInfo = vi.fn(() => ({ poolName: 'Lab Pool' }))

vi.mock('../../src/main/xapi/connection-manager', () => ({
  connectionManager: {
    getClient: mockGetClient,
    getConnectionInfo: mockGetConnectionInfo,
  },
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
  uuid: '11111111-2222-3333-4444-555555555555',
  name_label: 'Workload VM',
  name_description: 'Primary workload',
  power_state: 'Running',
  resident_on: 'OpaqueRef:host',
  VCPUs_max: 4,
  VCPUs_at_startup: 2,
  memory_static_max: 8_589_934_592,
  memory_dynamic_max: 4_294_967_296,
  is_a_template: false,
  is_a_snapshot: false,
  is_control_domain: false,
  VBDs: ['OpaqueRef:vbd'],
  VIFs: ['OpaqueRef:vif'],
  metrics: 'OpaqueRef:vm-metrics',
  guest_metrics: 'OpaqueRef:guest-metrics',
  consoles: ['OpaqueRef:console'],
  xapi_extension: { generation: 7 },
}

describe('VM IPC contract tracer', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    registeredHandlers.clear()
  })

  it('registers read and basic mutation contracts and enforces owner before the audit gate', async () => {
    mockCallWithSession.mockResolvedValueOnce({ 'OpaqueRef:vm': rawVmRecord })
      .mockResolvedValueOnce({ 'OpaqueRef:guest-metrics': { networks: { '0/ip': '192.0.2.10' } } })
    const owner = createOwner()
    const utils = await import('../../src/main/ipc/handlers/utils')
    const { registerVmHandlers } = await import('../../src/main/ipc/handlers/vm')
    utils.rebindIpcOwner(owner.owner as never, trustedUrl)
    registerVmHandlers()

    expect(utils.getIpcRegistrationInventory().contracts.map(({ channel }) => channel)).toEqual([
      'vm:list',
      'vm:start',
      'vm:shutdown',
      'vm:force-shutdown',
      'vm:reboot',
      'vm:pause',
      'vm:unpause',
      'vm:suspend',
      'vm:resume',
      'vm:destroy',
      'vm:snapshot',
      'vm:migrate',
      'vm:getRelocationPlan',
      'vm:relocate',
      'vm:copy',
      'vm:copyPlan',
      'vm:copyOperations',
      'vm:cancelCopy',
      'vm:console',
      'vm:templates',
      'vm:create-from-template',
      'vm:quick-create-from-template',
      'vm:creationResources',
      'vm:getRecord',
      'vm:setNameLabel',
      'vm:setNameDescription',
      'vm:setVcpus',
      'vm:setMemoryLimits',
      'vm:getVBDs',
      'vm:plugVbd',
      'vm:unplugVbd',
      'vm:detachVbd',
      'iso:listAll',
      'vm:getCdDrive',
      'vm:mountIso',
      'vm:ejectIso',
      'vm:getVIFs',
      'vm:getSnapshots',
      'vm:revertSnapshot',
      'vm:deleteSnapshot',
      'vm:renameSnapshot',
      'vm:export',
      'vm:import',
      'vm:importGetPreview',
      'vm:importProgress',
      'vm:cancelImport',
      'vm:cancelExport',
      'vm:exportProgress',
      'vm:markAsTemplate',
      'template:clone',
      'template:delete',
      'template:updateSettings',
      'template:enableInstantCreate',
    ])
    await expect(registeredHandlers.get('vm:list')?.(owner.event, 'pool-1')).resolves.toEqual([{
      ref: 'OpaqueRef:vm',
      ...rawVmRecord,
      connectionId: 'pool-1',
      poolName: 'Lab Pool',
      networks: { '0/ip': '192.0.2.10' },
    }])
    expect(mockGetClient).toHaveBeenCalledWith('pool-1')
    expect(mockCallWithSession).toHaveBeenCalledWith('VM.get_all_records', [])

    mockCallWithSession.mockResolvedValueOnce({
      'OpaqueRef:vm': { ...rawVmRecord, VCPUs_max: 'invalid' },
    })
    await expect(registeredHandlers.get('vm:list')?.(owner.event, 'pool-1'))
      .resolves.toMatchObject({ error: true, code: 'IPC_RESULT_INVALID' })

    mockCallWithSession.mockResolvedValueOnce({ ...rawVmRecord, allowed_operations: ['hard_shutdown'] })
      .mockResolvedValueOnce('OpaqueRef:task').mockResolvedValueOnce({ status: 'success' })
      .mockResolvedValueOnce({ ...rawVmRecord, power_state: 'Halted' })
    await expect(registeredHandlers.get('vm:force-shutdown')?.(owner.event, 'pool-1', 'OpaqueRef:vm')).resolves.toBeUndefined()
    expect(mockCallWithSession).toHaveBeenCalledWith('Async.VM.hard_shutdown', ['OpaqueRef:vm'])


    const assertUntrusted = async (event: object) => {
      await expect(registeredHandlers.get('vm:list')?.(event, 'pool-1'))
        .resolves.toMatchObject({ error: true, code: 'IPC_UNTRUSTED_SENDER' })
      await expect(registeredHandlers.get('vm:force-shutdown')?.(
        event,
        'pool-1',
        'OpaqueRef:vm',
      )).resolves.toMatchObject({ error: true, code: 'IPC_UNTRUSTED_SENDER' })
    }
    await assertUntrusted({
      sender: owner.event.sender,
      senderFrame: { url: trustedUrl },
    })
    await assertUntrusted({})

    owner.navigate('https://external.example.test/')
    await assertUntrusted(owner.event)

    const current = createOwner()
    utils.rebindIpcOwner(current.owner as never, trustedUrl)
    await assertUntrusted(owner.event)

    const malformedExport = {
      vmRef: 'OpaqueRef:vm',
      filePath: '/backups/vm.xva',
      powerState: 'Running',
      exportMode: 'snapshot',
      password: 'never-log-me',
    }
    const exportResult = await registeredHandlers.get('vm:export')?.(
      current.event,
      'pool-1',
      malformedExport,
    )
    expect(exportResult).toMatchObject({ error: true, code: 'IPC_SCHEMA_INVALID' })
    expect(JSON.stringify(exportResult)).not.toContain('never-log-me')
    expect(JSON.stringify(mockDebug.mock.calls)).not.toContain('never-log-me')
    expect(JSON.stringify(mockError.mock.calls)).not.toContain('never-log-me')
    expect(mockCallWithSession).toHaveBeenCalledTimes(8)
  })
})
