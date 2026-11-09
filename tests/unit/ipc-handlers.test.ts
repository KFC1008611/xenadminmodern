import { copyOperation } from '../helpers/vm-copy-fixtures'
/**
 * Unit tests for IPC handler registry — verifies all channels are registered
 * and handlers delegate to the correct service functions.
 * v4: Updated to use connectionManager mock and connectionId parameter.
 * v5: Extended with SR management, network operations, host maintenance, and alerts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ipcContractInventory } from '../../src/shared/ipc-contracts/inventory'

// Mock electron ipcMain
const registeredHandlers: Record<string, (...args: any[]) => any> = {}
const mockIpcMainHandle = vi.fn((channel: string, fn: (...args: any[]) => any) => {
  registeredHandlers[channel] = fn
})

vi.mock('electron', () => ({
  ipcMain: {
    handle: mockIpcMainHandle,
  },
}))

// Mock connectionManager
const mockConnectionManagerConnect = vi.fn()
const mockConnectionManagerDisconnect = vi.fn()
const mockConnectionManagerList = vi.fn()
const mockConnectionManagerReconnect = vi.fn()
const mockConnectionManagerGetInfo = vi.fn()
const mockConnectionManagerGetClient = vi.fn()

vi.mock('../../src/main/xapi/connection-manager', () => ({
  connectionManager: {
    connect: mockConnectionManagerConnect,
    disconnect: mockConnectionManagerDisconnect,
    listConnections: mockConnectionManagerList,
    reconnect: mockConnectionManagerReconnect,
    getConnectionInfo: mockConnectionManagerGetInfo,
    getClient: mockConnectionManagerGetClient,
  },
}))

// Mock all services
const mockGetAllHosts = vi.fn()
const mockGetHostMetrics = vi.fn()
const mockEnableHost = vi.fn()
const mockDisableHost = vi.fn()
const mockRebootHost = vi.fn()
const mockShutdownHost = vi.fn()
// v5: Maintenance mode
const mockGetMaintenanceStatus = vi.fn()
const mockEnterMaintenanceMode = vi.fn()
const mockExitMaintenanceMode = vi.fn()
const mockEvacuateHost = vi.fn()

vi.mock('../../src/main/xapi/services/host.service', () => ({
  getAllHosts: mockGetAllHosts,
  getHostMetrics: mockGetHostMetrics,
  enableHost: mockEnableHost,
  disableHost: mockDisableHost,
  rebootHost: mockRebootHost,
  shutdownHost: mockShutdownHost,
  // v5
  getMaintenanceStatus: mockGetMaintenanceStatus,
  enterMaintenanceMode: mockEnterMaintenanceMode,
  exitMaintenanceMode: mockExitMaintenanceMode,
  evacuateHost: mockEvacuateHost,
}))

const mockGetAllVms = vi.fn()
const mockStartVm = vi.fn()
const mockShutdownVm = vi.fn()
const mockForceShutdownVm = vi.fn()
const mockRebootVm = vi.fn()
const mockPauseVm = vi.fn()
const mockUnpauseVm = vi.fn()
const mockSuspendVm = vi.fn()
const mockResumeVm = vi.fn()
const mockDestroyVm = vi.fn()
const mockSnapshotVm = vi.fn()
const mockMigrateVm = vi.fn()
const mockCopyVm = vi.fn()
const mockGetVmConsole = vi.fn()
const mockGetVmRecord = vi.fn()
const mockSetVmNameLabel = vi.fn()
const mockSetVmNameDescription = vi.fn()
const mockSetVmVcpus = vi.fn()
const mockSetVmMemoryLimits = vi.fn()
const mockGetVmVBDs = vi.fn()
const mockPlugVbd = vi.fn()
const mockUnplugVbd = vi.fn()
const mockDetachVbd = vi.fn()
const mockListIsoImages = vi.fn()
const mockGetVmCdDrive = vi.fn()
const mockMountVmIso = vi.fn()
const mockEjectVmIso = vi.fn()
const mockGetVmVIFs = vi.fn()
const mockGetVmSnapshots = vi.fn()
const mockRevertVmSnapshot = vi.fn()
const mockDeleteVmSnapshot = vi.fn()
const mockDeleteTemplate = vi.fn()
const mockRenameVmSnapshot = vi.fn()
const mockGetTemplates = vi.fn()
const mockCloneTemplate = vi.fn()
const mockUpdateTemplateSettings = vi.fn()
const mockCreateFromWizard = vi.fn()
const mockGetVmCreationResources = vi.fn()
const mockExportVm = vi.fn()
const mockImportVm = vi.fn()
const mockGetImportPreview = vi.fn()
const mockCancelExport = vi.fn()
const mockGetExportProgress = vi.fn()
const mockMarkAsTemplate = vi.fn()
const mockGetImportProgress = vi.fn()
const mockCancelImport = vi.fn()
const mockEnableTemplateInstantCreate = vi.fn()

vi.mock('../../src/main/xapi/services/template-metadata.service', () => ({
  enableTemplateInstantCreate: mockEnableTemplateInstantCreate,
}))

vi.mock('../../src/main/xapi/services/vm-import.service', () => ({
  exportVm: mockExportVm,
  importVm: mockImportVm,
  getImportPreview: mockGetImportPreview,
  cancelExport: mockCancelExport,
  getExportProgress: mockGetExportProgress,
  markAsTemplate: mockMarkAsTemplate,
  getImportProgress: mockGetImportProgress,
  cancelImport: mockCancelImport,
}))

vi.mock('../../src/main/xapi/services/vm-creation.service', () => ({
  getVmCreationResources: mockGetVmCreationResources,
  createFromWizard: mockCreateFromWizard,
  quickCreateFromTemplate: vi.fn(),
}))

vi.mock('../../src/main/xapi/services/vm.service', () => ({
  getAllVms: mockGetAllVms,
  startVm: mockStartVm,
  shutdownVm: mockShutdownVm,
  forceShutdownVm: mockForceShutdownVm,
  rebootVm: mockRebootVm,
  pauseVm: mockPauseVm,
  unpauseVm: mockUnpauseVm,
  suspendVm: mockSuspendVm,
  resumeVm: mockResumeVm,
  destroyVm: mockDestroyVm,
  snapshotVm: mockSnapshotVm,
  migrateVm: mockMigrateVm,
  copyVm: mockCopyVm,
  getVmConsole: mockGetVmConsole,
  getVmRecord: mockGetVmRecord,
  setVmNameLabel: mockSetVmNameLabel,
  setVmNameDescription: mockSetVmNameDescription,
  setVmVcpus: mockSetVmVcpus,
  setVmMemoryLimits: mockSetVmMemoryLimits,
  getVmVBDs: mockGetVmVBDs,
  plugVbd: mockPlugVbd,
  unplugVbd: mockUnplugVbd,
  detachVbd: mockDetachVbd,
  listIsoImages: mockListIsoImages,
  getVmCdDrive: mockGetVmCdDrive,
  mountVmIso: mockMountVmIso,
  ejectVmIso: mockEjectVmIso,
  getVmVIFs: mockGetVmVIFs,
  getVmSnapshots: mockGetVmSnapshots,
  revertVmSnapshot: mockRevertVmSnapshot,
  deleteVmSnapshot: mockDeleteVmSnapshot,
  deleteTemplate: mockDeleteTemplate,
  renameVmSnapshot: mockRenameVmSnapshot,
  getTemplates: mockGetTemplates,
  cloneTemplate: mockCloneTemplate,
  updateTemplateSettings: mockUpdateTemplateSettings,
}))

const mockGetVmRelocationPlan = vi.fn()
const mockRelocateVm = vi.fn()

vi.mock('../../src/main/xapi/services/vm-relocation.service', () => ({
  getVmRelocationPlan: mockGetVmRelocationPlan,
  relocateVm: mockRelocateVm,
}))

const mockGetAllSrs = vi.fn()
const mockGetAllVdis = vi.fn()
const mockCreateVdi = vi.fn()
const mockDestroyVdi = vi.fn()
// v5: SR management
const mockCreateSr = vi.fn()
const mockDestroySr = vi.fn()
const mockScanSr = vi.fn()
const mockDetachSr = vi.fn()
const mockSetDefaultSr = vi.fn()
const mockProbeNfs = vi.fn()
const mockProbeIscsi = vi.fn()

vi.mock('../../src/main/xapi/services/sr.service', () => ({
  updateSrIdentity: vi.fn(),
  getAllSrs: mockGetAllSrs,
  getAllVdis: mockGetAllVdis,
  createVdi: mockCreateVdi,
  destroyVdi: mockDestroyVdi,
  // v5
  createSr: mockCreateSr,
  destroySr: mockDestroySr,
  scanSr: mockScanSr,
  detachSr: mockDetachSr,
  setDefaultSr: mockSetDefaultSr,
  probeNfs: mockProbeNfs,
  probeIscsi: mockProbeIscsi,
}))

const mockGetAllNetworks = vi.fn()
const mockGetAllPifs = vi.fn()
const mockCreateNetwork = vi.fn()
// v5: Network management
const mockDestroyNetwork = vi.fn()
const mockRenameNetwork = vi.fn()
// v5: VIF management
const mockCreateVif = vi.fn()
const mockDestroyVif = vi.fn()
const mockPlugVif = vi.fn()
const mockUnplugVif = vi.fn()

vi.mock('../../src/main/xapi/services/network.service', () => ({
  getAllNetworks: mockGetAllNetworks,
  getAllPifs: mockGetAllPifs,
  createNetwork: mockCreateNetwork,
  // v5
  destroyNetwork: mockDestroyNetwork,
  renameNetwork: mockRenameNetwork,
  createVif: mockCreateVif,
  destroyVif: mockDestroyVif,
  plugVif: mockPlugVif,
  unplugVif: mockUnplugVif,
  moveVif: vi.fn(),
  getAllBonds: vi.fn(),
  createBond: vi.fn(),
  destroyBond: vi.fn(),
  destroyBondGroup: vi.fn(),
  getBondRecord: vi.fn(),
  getAllVlans: vi.fn(),
  createVlan: vi.fn(),
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

const mockGetAllTasks = vi.fn()
const mockCancelTask = vi.fn()
vi.mock('../../src/main/xapi/services/task.service', () => ({
  getAllTasks: mockGetAllTasks,
  cancelTask: mockCancelTask,
}))

// v5: Alert service
const mockGetAllAlerts = vi.fn()
const mockDismissAlert = vi.fn()
const mockDismissAllAlerts = vi.fn()
// v7: Alert history and emitter
const mockGetAlertHistory = vi.fn()
const mockAcknowledgeAlert = vi.fn()
const mockGetAlertCountByStatus = vi.fn()
const mockAlertEmitter = { on: vi.fn(), emit: vi.fn(), removeListener: vi.fn() }

vi.mock('../../src/main/xapi/services/alert.service', () => ({
  getAllAlerts: mockGetAllAlerts,
  dismissAlert: mockDismissAlert,
  dismissAllAlerts: mockDismissAllAlerts,
  // v7
  getAlertHistory: mockGetAlertHistory,
  acknowledgeAlert: mockAcknowledgeAlert,
  getAlertCountByStatus: mockGetAlertCountByStatus,
  alertEmitter: mockAlertEmitter,
}))

// v7: Alert rule service
const mockGetAlertRules = vi.fn()
const mockCreateAlertRule = vi.fn()
const mockUpdateAlertRule = vi.fn()
const mockDeleteAlertRule = vi.fn()

vi.mock('../../src/main/xapi/services/alert-rule.service', () => ({
  getAlertRules: mockGetAlertRules,
  createAlertRule: mockCreateAlertRule,
  updateAlertRule: mockUpdateAlertRule,
  deleteAlertRule: mockDeleteAlertRule,
}))

// v7: Alert engine
const mockEvaluateOnce = vi.fn()
const mockGetEngineStatus = vi.fn()

vi.mock('../../src/main/xapi/services/alert-engine.service', () => ({
  evaluateOnce: mockEvaluateOnce,
  getEngineStatus: mockGetEngineStatus,
}))

// v7: Metrics service (extended)
const mockGetMetricsRange = vi.fn()
const mockGetMetricsStats = vi.fn()
const mockGetVmMetricsRange = vi.fn()
const mockCollectVmMetrics = vi.fn()
const mockStartMetricsCollection = vi.fn()
const mockStopMetricsCollection = vi.fn()
const mockGetMetricsHistory = vi.fn()
const mockGetCollectionError = vi.fn()

vi.mock('../../src/main/xapi/services/metrics.service', () => ({
  startMetricsCollection: mockStartMetricsCollection,
  stopMetricsCollection: mockStopMetricsCollection,
  getMetricsHistory: mockGetMetricsHistory,
  getMetricsRange: mockGetMetricsRange,
  getMetricsStats: mockGetMetricsStats,
  getVmMetricsRange: mockGetVmMetricsRange,
  collectVmMetrics: mockCollectVmMetrics,
  getCollectionError: mockGetCollectionError,
}))

vi.mock('../../src/main/xapi/services/alert-notification.service', () => ({
  getNotificationConfig: vi.fn(() => ({
    enabled: false,
    email: {
      enabled: false,
      host: '',
      port: 587,
      secure: false,
      auth: { user: '', pass: '' },
      from: '',
      to: '',
    },
    webhook: { enabled: false, url: '' },
    filterSeverities: ['error', 'warning'],
  })),
  saveNotificationConfig: vi.fn(),
  initDefaultConfig: vi.fn(),
  getNotificationHistory: vi.fn(() => []),
  sendAlertNotification: vi.fn(() => ({ email: false, webhook: false })),
  testNotification: vi.fn(() => true),
}))

vi.mock('../../src/main/profiles/profile.service', () => ({
  listProfiles: vi.fn(),
  saveProfile: vi.fn(),
  deleteProfile: vi.fn(),
  getPassword: vi.fn(),
  hasPassword: vi.fn(),
}))

vi.mock('../../src/main/console/console.service', () => ({
  openConsoleSession: vi.fn(),
  closeConsoleSession: vi.fn(),
}))

const CONN_ID = 'test-conn-id'
const TRUSTED_IPC_URL = 'file:///Applications/XenAdmin/index.html'
const completeAlertRule = {
  id: 'r1',
  name: 'CPU Alert',
  metricType: 'cpu',
  operator: '>',
  threshold: 90,
  duration: 5,
  severity: 'warning',
  enabled: true,
  createdAt: 100,
  updatedAt: 100,
}
const completeAlertHistoryRecord = {
  id: 'a1',
  ruleId: 'r1',
  ruleName: 'CPU Alert',
  connectionId: CONN_ID,
  entityRef: 'OpaqueRef:host',
  entityName: 'host-1',
  metricType: 'cpu',
  metricValue: 95,
  threshold: 90,
  severity: 'warning',
  triggeredAt: 100,
  status: 'active',
}

function createTrustedIpcOwner() {
  const mainFrame = { url: TRUSTED_IPC_URL }
  const webContents = {
    mainFrame,
    getURL: () => TRUSTED_IPC_URL,
    isDestroyed: () => false,
  }
  return {
    owner: { webContents, isDestroyed: () => false },
    event: { sender: webContents, senderFrame: mainFrame },
  }
}

async function registerHandlersWithTrustedIpcOwner() {
  const current = createTrustedIpcOwner()
  const { bindIpcOwner, registerIpcHandlers } = await import('../../src/main/ipc/handlers')
  bindIpcOwner(current.owner as never, TRUSTED_IPC_URL)
  registerIpcHandlers()
  return current.event
}

describe('ipc-handlers', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    Object.keys(registeredHandlers).forEach((k) => delete registeredHandlers[k])
    vi.resetModules()
  })

  it('vm:creationResources validates connectionId and delegates once', async () => {
    const resources = { hosts: [], srs: [], networks: [], isos: [] }
    mockGetVmCreationResources.mockResolvedValueOnce(resources)
    const event = await registerHandlersWithTrustedIpcOwner()

    await expect(registeredHandlers['vm:creationResources'](event, CONN_ID)).resolves.toEqual(resources)
    expect(mockGetVmCreationResources).toHaveBeenCalledOnce()
    expect(mockGetVmCreationResources).toHaveBeenCalledWith(CONN_ID)
  })

  it('template:enableInstantCreate validates and delegates the template ref', async () => {
    const event = await registerHandlersWithTrustedIpcOwner()

    await registeredHandlers['template:enableInstantCreate'](event, CONN_ID, 'OpaqueRef:template')

    expect(mockEnableTemplateInstantCreate).toHaveBeenCalledWith(CONN_ID, 'OpaqueRef:template')
    await expect(registeredHandlers['template:enableInstantCreate'](event, CONN_ID, '   ')).resolves.toMatchObject({
      error: true,
      code: 'IPC_SCHEMA_INVALID',
      message: 'IPC payload does not match the channel contract',
    })
    expect(mockEnableTemplateInstantCreate).toHaveBeenCalledOnce()
  })

  it('vm:markAsTemplate validates and delegates the VM ref through its contract', async () => {
    const event = await registerHandlersWithTrustedIpcOwner()

    await registeredHandlers['vm:markAsTemplate'](event, CONN_ID, 'OpaqueRef:vm')

    expect(mockMarkAsTemplate).toHaveBeenCalledWith(CONN_ID, 'OpaqueRef:vm')
    await expect(registeredHandlers['vm:markAsTemplate'](event, CONN_ID, '   ')).resolves.toMatchObject({
      error: true,
      code: 'IPC_SCHEMA_INVALID',
      message: 'IPC payload does not match the channel contract',
    })
    expect(mockMarkAsTemplate).toHaveBeenCalledOnce()
  })

  it('registers import operation progress and cancellation handlers', async () => {
    const progress = {
      operationId: 'operation-1', taskRef: null, status: 'uploading', progress: 12,
      message: 'uploading', lastUpdatedAt: 1,
    }
    mockGetImportProgress.mockReturnValueOnce(progress)
    const event = await registerHandlersWithTrustedIpcOwner()

    await expect(registeredHandlers['vm:importProgress'](event, 'operation-1')).resolves.toEqual(progress)
    await registeredHandlers['vm:cancelImport'](event, CONN_ID, 'operation-1')
    expect(mockGetImportProgress).toHaveBeenCalledWith('operation-1')
    expect(mockCancelImport).toHaveBeenCalledWith(CONN_ID, 'operation-1')
  })

  it('registerIpcHandlers registers the session:connect channel', async () => {
    const { registerIpcHandlers } = await import('../../src/main/ipc/handlers')
    registerIpcHandlers()
    expect(registeredHandlers['session:connect']).toBeDefined()
  })

  it('rejects batch deletion without identity and prevents direct deletion retries', async () => {
    const { createBatchTask } = await import('../../src/main/batch')
    const event = await registerHandlersWithTrustedIpcOwner()

    await expect(registeredHandlers['batch:submit'](event, {
      requestId: 'removed-delete',
      type: 'delete',
      targets: [{ connectionId: CONN_ID, vmRef: 'OpaqueRef:vm', vmName: 'vm' }],
    })).resolves.toMatchObject({
      error: true,
      code: 'IPC_SCHEMA_INVALID',
    })

    const task = createBatchTask('delete', [
      { connectionId: CONN_ID, vmRef: 'OpaqueRef:vm', vmName: 'vm' },
    ])
    await expect(registeredHandlers['batch:retry'](event, task.id, { requestId: 'retry-removed', items: [{ id: 'legacy-item', retryCount: 0 }] })).resolves.toMatchObject({
      error: true,
      message: expect.stringContaining('删除任务不能直接重试'),
    })
    expect(mockDestroyVm).not.toHaveBeenCalled()
  })

  it('returns template and snapshot deletion outcomes through IPC', async () => {
    mockDeleteTemplate.mockResolvedValueOnce({ vmDeleted: true, failedVdiRefs: [] })
    mockDeleteVmSnapshot.mockResolvedValueOnce({ vmDeleted: true, failedVdiRefs: ['OpaqueRef:vdi'] })
    const event = await registerHandlersWithTrustedIpcOwner()

    await expect(registeredHandlers['template:delete'](event, CONN_ID, {
      templateRef: 'OpaqueRef:template',
      deleteDisks: false,
    })).resolves.toEqual({ vmDeleted: true, failedVdiRefs: [] })
    await expect(
      registeredHandlers['vm:deleteSnapshot'](event, CONN_ID, 'OpaqueRef:snapshot'),
    ).resolves.toEqual({ vmDeleted: true, failedVdiRefs: ['OpaqueRef:vdi'] })
    expect(mockDeleteTemplate).toHaveBeenCalledWith(CONN_ID, {
      templateRef: 'OpaqueRef:template', deleteDisks: false,
    })
    expect(mockDeleteVmSnapshot).toHaveBeenCalledWith(CONN_ID, 'OpaqueRef:snapshot')
  })

  it('routes high-impact power through the common service and batch manager', async () => {
    const event = await registerHandlersWithTrustedIpcOwner()
    mockForceShutdownVm.mockResolvedValueOnce(undefined)
    mockRebootVm.mockResolvedValueOnce(undefined)
    await expect(registeredHandlers['vm:force-shutdown'](event, CONN_ID, 'OpaqueRef:vm')).resolves.toBeUndefined()
    await expect(registeredHandlers['vm:reboot'](event, CONN_ID, 'OpaqueRef:vm')).resolves.toBeUndefined()
    expect(mockForceShutdownVm).toHaveBeenCalledWith(CONN_ID, 'OpaqueRef:vm')
    expect(mockRebootVm).toHaveBeenCalledWith(CONN_ID, 'OpaqueRef:vm')
    const { getBatchTaskManager } = await import('../../src/main/batch')
    const manager = getBatchTaskManager()
    const submit = vi.spyOn(manager, 'submitTask').mockResolvedValue('power-task')
    for (const type of ['stop', 'reboot'] as const) {
      const target = { connectionId: CONN_ID, vmRef: 'OpaqueRef:vm', vmName: 'vm', intent: { vmUuid: 'vm', poolUuid: 'pool', epoch: 1 } }
      await expect(registeredHandlers['batch:submit'](event, { requestId: 'power-' + type, type, targets: [target] })).resolves.toEqual({ taskId: 'power-task' })
      expect(submit).toHaveBeenCalledWith(type, [target], undefined, 'power-' + type)
    }
    expect(submit).toHaveBeenCalledTimes(2)
    submit.mockRestore()
  })

  it('rejects every host lifecycle mutation while keeping host reads registered', async () => {
    const event = await registerHandlersWithTrustedIpcOwner()

    const channels = [
      'host:enable',
      'host:disable',
      'host:reboot',
      'host:shutdown',
      'host:enterMaintenance',
      'host:exitMaintenance',
      'host:evacuate',
    ]
    for (const channel of channels) {
      await expect(registeredHandlers[channel](event, CONN_ID, 'OpaqueRef:host')).resolves.toMatchObject({
        error: true,
        message: expect.stringContaining('暂不可用'),
      })
    }
    expect(registeredHandlers['host:list']).toBeDefined()
    expect(registeredHandlers['host:getMaintenanceStatus']).toBeDefined()
    expect(mockEnableHost).not.toHaveBeenCalled()
    expect(mockDisableHost).not.toHaveBeenCalled()
    expect(mockRebootHost).not.toHaveBeenCalled()
    expect(mockShutdownHost).not.toHaveBeenCalled()
    expect(mockEnterMaintenanceMode).not.toHaveBeenCalled()
    expect(mockExitMaintenanceMode).not.toHaveBeenCalled()
    expect(mockEvacuateHost).not.toHaveBeenCalled()
  })

  it('rejects pool master transfer while keeping pool reads registered', async () => {
    const event = await registerHandlersWithTrustedIpcOwner()

    await expect(
      registeredHandlers['pool:transferMaster'](event, CONN_ID, 'OpaqueRef:host'),
    ).resolves.toMatchObject({ error: true, message: expect.stringContaining('暂不可用') })
    expect(registeredHandlers['pool:get']).toBeDefined()
  })

  it('rejects every HA mutation while keeping HA reads registered', async () => {
    const event = await registerHandlersWithTrustedIpcOwner()

    const calls: Array<[string, unknown[]]> = [
      ['ha:enable', [CONN_ID, { heartbeatSRs: ['OpaqueRef:sr'] }]],
      ['ha:disable', [CONN_ID]],
      ['ha:preventRestarts', [CONN_ID, 60]],
      ['ha:setVmPriority', [CONN_ID, 'OpaqueRef:vm', 'restart']],
      ['ha:setVmAlwaysRun', [CONN_ID, 'OpaqueRef:vm', true]],
      ['ha:emergencyMaster', [CONN_ID]],
      ['ha:recoverSlaves', [CONN_ID]],
    ]
    for (const [channel, args] of calls) {
      await expect(registeredHandlers[channel](event, ...args)).resolves.toMatchObject({
        error: true,
        message: expect.stringContaining('暂不可用'),
      })
    }
    expect(registeredHandlers['ha:getConfig']).toBeDefined()
    expect(registeredHandlers['ha:getFailoverPlan']).toBeDefined()
  })

  it('rejects Subject deletion and role changes at the IPC boundary', async () => {
    const event = await registerHandlersWithTrustedIpcOwner()

    const calls: Array<[string, unknown[]]> = [
      ['rbac:subjectRemove', [CONN_ID, 'OpaqueRef:subject']],
      ['rbac:subjectAddRole', [CONN_ID, 'OpaqueRef:subject', 'OpaqueRef:role']],
      ['rbac:subjectRemoveRole', [CONN_ID, 'OpaqueRef:subject', 'OpaqueRef:role']],
    ]
    for (const [channel, args] of calls) {
      await expect(registeredHandlers[channel](event, ...args)).resolves.toMatchObject({
        error: true,
        message: expect.stringContaining('暂不可用'),
      })
    }
    expect(registeredHandlers['rbac:subjectList']).toBeDefined()
  })

  it('registerIpcHandlers registers the session:disconnect channel', async () => {
    const { registerIpcHandlers } = await import('../../src/main/ipc/handlers')
    registerIpcHandlers()
    expect(registeredHandlers['session:disconnect']).toBeDefined()
  })

  it('registerIpcHandlers registers new connection management channels (v4)', async () => {
    const { registerIpcHandlers } = await import('../../src/main/ipc/handlers')
    registerIpcHandlers()
    const expectedChannels = [
      'connection:connect',
      'connection:disconnect',
      'connection:list',
      'connection:reconnect',
      'connection:getInfo',
    ]
    for (const ch of expectedChannels) {
      expect(registeredHandlers[ch], `channel ${ch} should be registered`).toBeDefined()
    }
  })

  it('pairs every shared contract with the main registration direction', async () => {
    const { registerIpcHandlers } = await import('../../src/main/ipc/handlers')
    const { getIpcRegistrationInventory } = await import('../../src/main/ipc/handlers/utils')
    registerIpcHandlers()

    const inventory = getIpcRegistrationInventory()
    expect(inventory.contracts.map(({ channel }) => channel)).toEqual([
      'connection:connect',
      'connection:disconnect',
      'connection:list',
      'connection:reconnect',
      'connection:getInfo',
      'session:connect',
      'session:disconnect',
      'session:status',
      'host:list',
      'host:metrics',
      'host:enable',
      'host:disable',
      'host:reboot',
      'host:shutdown',
      'host:getMaintenanceStatus',
      'host:enterMaintenance',
      'host:exitMaintenance',
      'host:evacuate',
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
      'sr:list',
      'vdi:list',
      'vdi:create',
      'vdi:destroy',
      'sr:create',
      'sr:destroy',
      'sr:scan',
      'sr:updateIdentity',
      'sr:detach',
      'sr:setDefault',
      'sr:probeNfs',
      'sr:probeIscsi',
      'vdi:resize',
      'vdi:createForVm',
      'vdi:getAllowedOperations',
      'vdi:listAttachable',
      'vdi:attachExisting',
      'vdi:move',
      'network:list',
      'pif:list',
      'network:create',
      'network:destroy',
      'network:rename',
      'vif:create',
      'vif:destroy',
      'vif:plug',
      'vif:unplug',
      'vif:move',
      'vif:setQos',
      'vif:clearQos',
      'bond:list',
      'bond:create',
      'bond:destroy',
      'bond:destroyGroup',
      'bond:getRecord',
      'vlan:list',
      'vlan:create',
      'vlan:destroy',
      'vlan:destroyNetwork',
      'vlan:getRecord',
      'tunnel:list',
      'tunnel:create',
      'tunnel:destroy',
      'pif:reconfigureIp',
      'pif:scan',
      'pif:getForHost',
      'network:getAllowedOps',
      'network:addTag',
      'network:removeTag',
      'network:updateOtherConfig',
      'pbd:list',
      'pbd:create',
      'pbd:plug',
      'pbd:unplug',
      'pbd:destroy',
      'vdi:clone',
      'vdi:snapshot',
      'vdi:copy',
      'vdi:setNameLabel',
      'vdi:setNameDescription',
      'vdi:addTag',
      'vdi:removeTag',
      'sr:introduce',
      'sr:forget',
      'sr:setShared',
      'sr:getThinStats',
      'iso:list',
      'iso:delete',
      'pool:get',
      'pool:addHost',
      'pool:removeHost',
      'pool:transferMaster',
      'task:list',
      'task:cancel',
      'alerts:getAll',
      'alerts:dismiss',
      'alerts:dismissAll',
      'profile:list',
      'profile:save',
      'profile:delete',
      'profile:hasPassword',
      'profile:connect',
      'dialog:showOpenDialog',
      'dialog:showSaveDialog',
      'console:getUrl',
      'console:close',
      'metrics:startCollection',
      'metrics:stopCollection',
      'metrics:getHistory',
      'metrics:getRange',
      'metrics:getStats',
      'metrics:getVmHistory',
      'metrics:getCollectionError',
      'alertRules:list',
      'alertRules:create',
      'alertRules:update',
      'alertRules:delete',
      'alertRules:evaluate',
      'alertHistory:list',
      'alertHistory:acknowledge',
      'alertHistory:getCount',
      'alert:triggered',
      'batch:progress',
      'batch:submit',
      'batch:cancel',
      'batch:getStatus',
      'batch:list',
      'batch:retry',
      'alertNotify:getConfig',
      'alertNotify:saveConfig',
      'alertNotify:test',
      'alertNotify:history',
      'alertNotify:send',
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
      'vm:advGetConfig',
      'vm:advGetAllConfigs',
      'vm:advGetAffinity',
      'vm:advSetAffinity',
      'vm:advSetAntiAffinity',
      'vm:advAddAntiAffinity',
      'vm:advRemoveAntiAffinity',
      'vm:advEnableProtection',
      'vm:advDisableProtection',
      'vm:advSetVcpuHotplug',
      'vm:advSetVcpusNumber',
      'vm:advSetStartDelay',
      'vm:advSetBootOrder',
      'vm:advSetHvmBootParams',
      'vm:advSetPlatformParam',
      'vm:advSetViridian',
      'vm:advSetOtherConfig',
      'vm:advAddTag',
      'vm:advRemoveTag',
      'vm:advSetStartOrder',
      'vm:changed',
    ])
    expect(inventory.contracts).toHaveLength(245)
    expect(inventory.contracts.filter(({ direction }) => direction === 'invoke')).toHaveLength(242)
    expect(inventory.contracts.filter(({ direction }) => direction === 'push').map(({ channel }) => channel))
      .toEqual(['alert:triggered', 'batch:progress', 'vm:changed'])

    const expectedInvokes = ipcContractInventory.contracts
      .filter(({ direction }) => direction === 'invoke')
      .map(({ channel }) => channel)
    const expectedIdentities = ipcContractInventory.contracts
      .map(({ channel, direction }) => `${direction}:${channel}`)

    expect(new Set(inventory.contracts.map(({ channel, direction }) => `${direction}:${channel}`)))
      .toEqual(new Set(expectedIdentities))
    expect(Object.keys(registeredHandlers).sort()).toEqual([...expectedInvokes].sort())
    for (const contract of ipcContractInventory.contracts) {
      if (contract.direction === 'push') expect(registeredHandlers[contract.channel]).toBeUndefined()
    }
  })

  it('registerIpcHandlers registers all VM channels', async () => {
    const { registerIpcHandlers } = await import('../../src/main/ipc/handlers')
    registerIpcHandlers()
    const expectedChannels = [
      'vm:list', 'vm:start', 'vm:shutdown', 'vm:force-shutdown',
      'vm:reboot', 'vm:suspend', 'vm:resume', 'vm:destroy', 'vm:snapshot',
      'vm:migrate', 'vm:console', 'vm:getCdDrive', 'vm:mountIso',
      'vm:ejectIso', 'iso:listAll',
    ]
    for (const ch of expectedChannels) {
      expect(registeredHandlers[ch], `channel ${ch} should be registered`).toBeDefined()
    }
  })

  it('registerIpcHandlers registers all host channels (v4)', async () => {
    const { registerIpcHandlers } = await import('../../src/main/ipc/handlers')
    registerIpcHandlers()
    const expectedChannels = ['host:list', 'host:metrics', 'host:enable', 'host:disable', 'host:reboot', 'host:shutdown']
    for (const ch of expectedChannels) {
      expect(registeredHandlers[ch], `channel ${ch} should be registered`).toBeDefined()
    }
  })

  it('registerIpcHandlers registers all host maintenance channels (v5)', async () => {
    const { registerIpcHandlers } = await import('../../src/main/ipc/handlers')
    registerIpcHandlers()
    const expectedChannels = [
      'host:getMaintenanceStatus',
      'host:enterMaintenance',
      'host:exitMaintenance',
      'host:evacuate',
    ]
    for (const ch of expectedChannels) {
      expect(registeredHandlers[ch], `channel ${ch} should be registered`).toBeDefined()
    }
  })

  it('registerIpcHandlers registers all storage/SR channels (v4 + v5)', async () => {
    const { registerIpcHandlers } = await import('../../src/main/ipc/handlers')
    registerIpcHandlers()
    const expectedChannels = [
      // v4
      'sr:list', 'vdi:list', 'vdi:create', 'vdi:destroy',
      // v5
      'sr:create', 'sr:destroy', 'sr:scan', 'sr:detach',
      'sr:setDefault', 'sr:probeNfs', 'sr:probeIscsi',
    ]
    for (const ch of expectedChannels) {
      expect(registeredHandlers[ch], `channel ${ch} should be registered`).toBeDefined()
    }
  })

  it('registerIpcHandlers registers all network channels (v4 + v5)', async () => {
    const { registerIpcHandlers } = await import('../../src/main/ipc/handlers')
    registerIpcHandlers()
    const expectedChannels = [
      // v4
      'network:list', 'pif:list', 'network:create',
      // v5
      'network:destroy', 'network:rename',
    ]
    for (const ch of expectedChannels) {
      expect(registeredHandlers[ch], `channel ${ch} should be registered`).toBeDefined()
    }
  })

  it('registerIpcHandlers registers all VIF channels (v5)', async () => {
    const { registerIpcHandlers } = await import('../../src/main/ipc/handlers')
    registerIpcHandlers()
    const expectedChannels = ['vif:create', 'vif:destroy', 'vif:plug', 'vif:unplug']
    for (const ch of expectedChannels) {
      expect(registeredHandlers[ch], `channel ${ch} should be registered`).toBeDefined()
    }
  })

  it('registerIpcHandlers registers all alert channels (v5)', async () => {
    const { registerIpcHandlers } = await import('../../src/main/ipc/handlers')
    registerIpcHandlers()
    const expectedChannels = ['alerts:getAll', 'alerts:dismiss', 'alerts:dismissAll']
    for (const ch of expectedChannels) {
      expect(registeredHandlers[ch], `channel ${ch} should be registered`).toBeDefined()
    }
  })

  it('registerIpcHandlers registers pool and task channels', async () => {
    const { registerIpcHandlers } = await import('../../src/main/ipc/handlers')
    registerIpcHandlers()
    expect(registeredHandlers['pool:get']).toBeDefined()
    expect(registeredHandlers['task:list']).toBeDefined()
    expect(registeredHandlers['task:cancel']).toBeDefined()
  })

  it('vm:list handler calls getAllVms with connectionId and returns result', async () => {
    mockGetAllVms.mockResolvedValueOnce([])
    const current = createTrustedIpcOwner()
    const { bindIpcOwner, registerIpcHandlers } = await import('../../src/main/ipc/handlers')
    bindIpcOwner(current.owner as never, TRUSTED_IPC_URL)
    registerIpcHandlers()

    const result = await registeredHandlers['vm:list'](current.event, CONN_ID)
    expect(mockGetAllVms).toHaveBeenCalledWith(CONN_ID)
    expect(result).toEqual([])
  })

  it('vm:list handler returns structured error when connectionId is missing', async () => {
    const current = createTrustedIpcOwner()
    const { bindIpcOwner, registerIpcHandlers } = await import('../../src/main/ipc/handlers')
    bindIpcOwner(current.owner as never, TRUSTED_IPC_URL)
    registerIpcHandlers()

    const result = await registeredHandlers['vm:list'](current.event, '')
    expect(result).toMatchObject({
      error: true,
      message: 'IPC payload does not match the channel contract',
      code: 'IPC_SCHEMA_INVALID',
    })
  })

  it('vm:start handler calls startVm with connectionId and vm ref', async () => {
    mockStartVm.mockResolvedValueOnce(undefined)
    const event = await registerHandlersWithTrustedIpcOwner()

    await registeredHandlers['vm:start'](event, CONN_ID, 'OpaqueRef:vm1')
    expect(mockStartVm).toHaveBeenCalledWith(CONN_ID, 'OpaqueRef:vm1')
  })

  it('vm:destroy handler calls destroyVm with connectionId and vm ref', async () => {
    mockDestroyVm.mockResolvedValueOnce(undefined)
    const event = await registerHandlersWithTrustedIpcOwner()

    await registeredHandlers['vm:destroy'](event, CONN_ID, 'OpaqueRef:vm1')
    expect(mockDestroyVm).toHaveBeenCalledWith(CONN_ID, 'OpaqueRef:vm1')
  })

  it('vm:destroy handler forwards selected VDI refs', async () => {
    mockDestroyVm.mockResolvedValueOnce(undefined)
    const event = await registerHandlersWithTrustedIpcOwner()

    await registeredHandlers['vm:destroy'](event, CONN_ID, 'OpaqueRef:vm1', {
      vdiRefs: ['OpaqueRef:vdi1'],
    })
    expect(mockDestroyVm).toHaveBeenCalledWith(CONN_ID, 'OpaqueRef:vm1', {
      vdiRefs: ['OpaqueRef:vdi1'],
    })
  })

  it('iso:listAll handler calls listIsoImages with connectionId', async () => {
    const iso = {
      ref: 'OpaqueRef:iso1',
      uuid: 'iso-uuid',
      name_label: 'ubuntu.iso',
      name_description: '',
      virtual_size: 1024,
      physical_utilisation: 1024,
      type: 'iso',
      SR: 'OpaqueRef:sr',
      srName: 'ISO library',
      read_only: true,
      connectionId: CONN_ID,
      poolName: 'Pool A',
    }
    mockListIsoImages.mockResolvedValueOnce([iso])
    const event = await registerHandlersWithTrustedIpcOwner()

    const result = await registeredHandlers['iso:listAll'](event, CONN_ID)
    expect(mockListIsoImages).toHaveBeenCalledWith(CONN_ID)
    expect(result).toHaveLength(1)
  })

  it('vm:getCdDrive handler calls getVmCdDrive with connectionId and vm ref', async () => {
    mockGetVmCdDrive.mockResolvedValueOnce({
      vbdRef: 'OpaqueRef:cd1',
      vdiRef: null,
      userdevice: '3',
      empty: true,
      isoName: null,
      isoSize: null,
      srRef: null,
      srName: null,
    })
    const event = await registerHandlersWithTrustedIpcOwner()

    const result = await registeredHandlers['vm:getCdDrive'](event, CONN_ID, 'OpaqueRef:vm1')
    expect(mockGetVmCdDrive).toHaveBeenCalledWith(CONN_ID, 'OpaqueRef:vm1')
    expect(result.empty).toBe(true)
  })

  it('vm:mountIso handler calls mountVmIso with connectionId, vm ref, and ISO VDI ref', async () => {
    mockMountVmIso.mockResolvedValueOnce(undefined)
    const event = await registerHandlersWithTrustedIpcOwner()

    await registeredHandlers['vm:mountIso'](event, CONN_ID, 'OpaqueRef:vm1', 'OpaqueRef:iso1')
    expect(mockMountVmIso).toHaveBeenCalledWith(CONN_ID, 'OpaqueRef:vm1', 'OpaqueRef:iso1')
  })

  it('vm:ejectIso handler calls ejectVmIso with connectionId and vm ref', async () => {
    mockEjectVmIso.mockResolvedValueOnce(undefined)
    const event = await registerHandlersWithTrustedIpcOwner()

    await registeredHandlers['vm:ejectIso'](event, CONN_ID, 'OpaqueRef:vm1')
    expect(mockEjectVmIso).toHaveBeenCalledWith(CONN_ID, 'OpaqueRef:vm1')
  })

  it('vm:snapshot handler calls snapshotVm with connectionId, ref, and name', async () => {
    mockSnapshotVm.mockResolvedValueOnce('OpaqueRef:snap1')
    const event = await registerHandlersWithTrustedIpcOwner()

    const ref = await registeredHandlers['vm:snapshot'](event, CONN_ID, 'OpaqueRef:vm1', 'my-snap')
    expect(mockSnapshotVm).toHaveBeenCalledWith(CONN_ID, 'OpaqueRef:vm1', 'my-snap')
    expect(ref).toBe('OpaqueRef:snap1')
  })

  it('host:list handler calls getAllHosts with connectionId and returns result', async () => {
    mockGetAllHosts.mockResolvedValueOnce([{
      ref: 'OpaqueRef:host1',
      uuid: 'host-uuid-1',
      name_label: 'xcp01',
      hostname: 'xcp01',
      address: '192.0.2.10',
      enabled: true,
      resident_VMs: [],
      memory_total: 1024,
      memory_free: 512,
      cpu_info: {},
      software_version: {},
      metrics: 'OpaqueRef:host-metrics1',
      suspend_image_sr: 'OpaqueRef:NULL',
      connectionId: CONN_ID,
      poolName: 'Lab Pool',
    }])
    const event = await registerHandlersWithTrustedIpcOwner()

    const result = await registeredHandlers['host:list'](event, CONN_ID)
    expect(mockGetAllHosts).toHaveBeenCalledWith(CONN_ID)
    expect(result[0].name_label).toBe('xcp01')
  })

  // v5: SR management tests
  it('sr:create handler calls createSr with connectionId, hostRef, and params', async () => {
    mockCreateSr.mockResolvedValueOnce('OpaqueRef:new-sr')
    const event = await registerHandlersWithTrustedIpcOwner()

    const params = { type: 'nfs', nameLabel: 'Test SR', nameDescription: '', nfsServer: '192.168.1.100', nfsPath: '/export' }
    const ref = await registeredHandlers['sr:create'](event, CONN_ID, 'OpaqueRef:host1', params)
    expect(mockCreateSr).toHaveBeenCalledWith(CONN_ID, 'OpaqueRef:host1', params)
    expect(ref).toBe('OpaqueRef:new-sr')
  })

  it('sr:probeNfs handler calls probeNfs with connectionId, hostRef, and server', async () => {
    mockProbeNfs.mockResolvedValueOnce([{ server: '192.168.1.100', path: '/export' }])
    const event = await registerHandlersWithTrustedIpcOwner()

    const result = await registeredHandlers['sr:probeNfs'](event, CONN_ID, 'OpaqueRef:host1', '192.168.1.100')
    expect(mockProbeNfs).toHaveBeenCalledWith(CONN_ID, 'OpaqueRef:host1', '192.168.1.100')
    expect(result).toHaveLength(1)
  })

  // v5: Network management tests
  it('network:destroy handler delegates to the network service', async () => {
    const event = await registerHandlersWithTrustedIpcOwner()

    const result = await registeredHandlers['network:destroy'](event, CONN_ID, 'OpaqueRef:net1')
    expect(result).toBeUndefined()
    expect(mockDestroyNetwork).toHaveBeenCalledWith(CONN_ID, 'OpaqueRef:net1')
  })

  it('network:rename handler calls renameNetwork with connectionId, networkRef, and newName', async () => {
    mockRenameNetwork.mockResolvedValueOnce(undefined)
    const event = await registerHandlersWithTrustedIpcOwner()

    await registeredHandlers['network:rename'](event, CONN_ID, 'OpaqueRef:net1', 'New Name')
    expect(mockRenameNetwork).toHaveBeenCalledWith(CONN_ID, 'OpaqueRef:net1', 'New Name')
  })

  // v5: VIF management tests
  it('vif:create handler returns the attachment outcome', async () => {
    mockCreateVif.mockResolvedValueOnce({ vifRef: 'OpaqueRef:vif1', plugged: false })
    const event = await registerHandlersWithTrustedIpcOwner()

    const params = { vmRef: 'OpaqueRef:vm1', networkRef: 'OpaqueRef:net1' }
    const result = await registeredHandlers['vif:create'](event, CONN_ID, params)
    expect(result).toEqual({ vifRef: 'OpaqueRef:vif1', plugged: false })
    expect(mockCreateVif).toHaveBeenCalledWith(CONN_ID, params)
  })

  it('vif:plug handler delegates to the VIF service', async () => {
    const event = await registerHandlersWithTrustedIpcOwner()

    const result = await registeredHandlers['vif:plug'](event, CONN_ID, 'OpaqueRef:vif1')
    expect(result).toBeUndefined()
    expect(mockPlugVif).toHaveBeenCalledWith(CONN_ID, 'OpaqueRef:vif1')
  })

  // v5: Alert tests
  it('alerts:getAll handler calls getAllAlerts with connectionId and filters', async () => {
    const alert = {
      ref: 'OpaqueRef:msg1',
      uuid: 'message-uuid',
      name: 'HOST_OFFLINE',
      priority: 1,
      severity: 'error',
      body: 'Host is offline',
      timestamp: 100,
      cls: 'Host',
      objUuid: 'host-uuid',
      connectionId: CONN_ID,
      poolName: 'Lab Pool',
    }
    mockGetAllAlerts.mockResolvedValueOnce([alert])
    const event = await registerHandlersWithTrustedIpcOwner()

    const filters = { severity: ['error'] }
    const result = await registeredHandlers['alerts:getAll'](event, CONN_ID, filters)
    expect(mockGetAllAlerts).toHaveBeenCalledWith(CONN_ID, filters)
    expect(result).toHaveLength(1)
  })

  it('alerts:dismiss handler calls dismissAlert with connectionId and alertRef', async () => {
    mockDismissAlert.mockResolvedValueOnce(undefined)
    const event = await registerHandlersWithTrustedIpcOwner()

    await registeredHandlers['alerts:dismiss'](event, CONN_ID, 'OpaqueRef:msg1')
    expect(mockDismissAlert).toHaveBeenCalledWith(CONN_ID, 'OpaqueRef:msg1')
  })

  it('task:cancel handler returns structured error when service throws', async () => {
    mockCancelTask.mockRejectedValueOnce({ faultString: 'TASK_ALREADY_DONE', message: 'done' })
    const event = await registerHandlersWithTrustedIpcOwner()

    const result = await registeredHandlers['task:cancel'](event, CONN_ID, 'OpaqueRef:task1')
    expect(result).toMatchObject({
      error: true,
      message: 'TASK_ALREADY_DONE',
    })
  })

  it('network:create handler delegates to the network service', async () => {
    mockCreateNetwork.mockResolvedValueOnce('OpaqueRef:network')
    const event = await registerHandlersWithTrustedIpcOwner()

    const result = await registeredHandlers['network:create'](event, CONN_ID, 'Test Network', 'desc')
    expect(result).toBe('OpaqueRef:network')
    expect(mockCreateNetwork).toHaveBeenCalledWith(CONN_ID, 'Test Network', 'desc')
  })

  it('connection:list handler returns list of connections', async () => {
    mockConnectionManagerList.mockReturnValueOnce([
      {
        id: CONN_ID,
        name: 'Pool A',
        state: 'connected',
        poolName: 'Pool A',
        poolRef: 'OpaqueRef:pool',
        host: '192.168.1.1',
        errorMessage: null,
        connectedAt: 1,
      }
    ])
    const current = createTrustedIpcOwner()
    const { bindIpcOwner, registerIpcHandlers } = await import('../../src/main/ipc/handlers')
    bindIpcOwner(current.owner as never, TRUSTED_IPC_URL)
    registerIpcHandlers()

    const result = await registeredHandlers['connection:list'](current.event)
    expect(mockConnectionManagerList).toHaveBeenCalledTimes(1)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe(CONN_ID)
  })

  it('connection:disconnect handler calls connectionManager.disconnect', async () => {
    const current = createTrustedIpcOwner()
    const { bindIpcOwner, registerIpcHandlers } = await import('../../src/main/ipc/handlers')
    bindIpcOwner(current.owner as never, TRUSTED_IPC_URL)
    registerIpcHandlers()

    await registeredHandlers['connection:disconnect'](current.event, CONN_ID)
    expect(mockConnectionManagerDisconnect).toHaveBeenCalledWith(CONN_ID)
  })

  // =========================================================================
  // v7: Metrics extended query channels
  // =========================================================================

  it('registerIpcHandlers registers all v7 metrics channels', async () => {
    const { registerIpcHandlers } = await import('../../src/main/ipc/handlers')
    registerIpcHandlers()
    const expectedChannels = [
      'metrics:getRange',
      'metrics:getStats',
      'metrics:getVmHistory',
    ]
    for (const ch of expectedChannels) {
      expect(registeredHandlers[ch], `channel ${ch} should be registered`).toBeDefined()
    }
  })

  it('metrics:getRange handler delegates to getMetricsRange with connectionId, hostRef, and params', async () => {
    const mockResult = [{ timestamp: Date.now(), cpuPercent: 50, memoryPercent: 60 }]
    mockGetMetricsRange.mockReturnValueOnce(mockResult)
    const event = await registerHandlersWithTrustedIpcOwner()

    const params = { startTime: Date.now() - 3600000, endTime: Date.now() }
    const result = await registeredHandlers['metrics:getRange'](event, CONN_ID, 'OpaqueRef:host1', params)
    expect(mockGetMetricsRange).toHaveBeenCalledWith(CONN_ID, 'OpaqueRef:host1', params)
    expect(result).toEqual(mockResult)
  })

  it('metrics:getStats handler delegates to getMetricsStats', async () => {
    const mockStats = { current: 60, min: 10, max: 90, avg: 50 }
    mockGetMetricsStats.mockReturnValueOnce(mockStats)
    const event = await registerHandlersWithTrustedIpcOwner()

    const params = { startTime: Date.now() - 3600000, endTime: Date.now() }
    const result = await registeredHandlers['metrics:getStats'](event, CONN_ID, 'OpaqueRef:host1', 'cpu', params)
    expect(mockGetMetricsStats).toHaveBeenCalledWith(CONN_ID, 'OpaqueRef:host1', 'cpu', params)
    expect(result).toEqual(mockStats)
  })

  it('metrics:getVmHistory handler delegates to getVmMetricsRange', async () => {
    const mockResult = [{ timestamp: Date.now(), cpuPercent: 30, memoryPercent: 40 }]
    mockCollectVmMetrics.mockResolvedValueOnce(undefined)
    mockGetVmMetricsRange.mockReturnValueOnce(mockResult)
    const event = await registerHandlersWithTrustedIpcOwner()

    const params = { startTime: Date.now() - 3600000, endTime: Date.now() }
    const result = await registeredHandlers['metrics:getVmHistory'](event, CONN_ID, 'OpaqueRef:vm1', params)
    expect(mockCollectVmMetrics).toHaveBeenCalledWith(CONN_ID, 'OpaqueRef:vm1')
    expect(mockGetVmMetricsRange).toHaveBeenCalledWith(CONN_ID, 'OpaqueRef:vm1', params)
    expect(result).toEqual(mockResult)
  })

  it('metrics:getVmHistory still returns range data when sampling fails', async () => {
    const mockResult = [{ timestamp: Date.now(), cpuPercent: 20, memoryPercent: 35 }]
    mockCollectVmMetrics.mockRejectedValueOnce(new Error('VM not found'))
    mockGetVmMetricsRange.mockReturnValueOnce(mockResult)
    const event = await registerHandlersWithTrustedIpcOwner()

    const params = { startTime: Date.now() - 3600000, endTime: Date.now() }
    const result = await registeredHandlers['metrics:getVmHistory'](event, CONN_ID, 'OpaqueRef:vm1', params)
    expect(mockCollectVmMetrics).toHaveBeenCalledWith(CONN_ID, 'OpaqueRef:vm1')
    expect(mockGetVmMetricsRange).toHaveBeenCalledWith(CONN_ID, 'OpaqueRef:vm1', params)
    expect(result).toEqual(mockResult)
  })

  // =========================================================================
  // v7: Alert rule management channels
  // =========================================================================

  it('registerIpcHandlers registers all v7 alert rule channels', async () => {
    const { registerIpcHandlers } = await import('../../src/main/ipc/handlers')
    registerIpcHandlers()
    const expectedChannels = [
      'alertRules:list',
      'alertRules:create',
      'alertRules:update',
      'alertRules:delete',
      'alertRules:evaluate',
    ]
    for (const ch of expectedChannels) {
      expect(registeredHandlers[ch], `channel ${ch} should be registered`).toBeDefined()
    }
  })

  it('alertRules:list handler delegates to getAlertRules', async () => {
    const mockRules = [completeAlertRule]
    mockGetAlertRules.mockReturnValueOnce(mockRules)
    const event = await registerHandlersWithTrustedIpcOwner()

    const result = await registeredHandlers['alertRules:list'](event)
    expect(mockGetAlertRules).toHaveBeenCalledTimes(1)
    expect(result).toEqual(mockRules)
  })

  it('alertRules:create handler delegates to createAlertRule with rule object', async () => {
    const inputRule = { name: 'Mem Alert', metricType: 'memory', operator: '>', threshold: 85, duration: 5, severity: 'warning' }
    const createdRule = {
      ...inputRule,
      id: 'r2',
      enabled: true,
      createdAt: 100,
      updatedAt: 100,
    }
    mockCreateAlertRule.mockReturnValueOnce(createdRule)
    const event = await registerHandlersWithTrustedIpcOwner()

    const result = await registeredHandlers['alertRules:create'](event, inputRule)
    expect(mockCreateAlertRule).toHaveBeenCalledWith(inputRule)
    expect(result).toEqual(createdRule)
  })

  it('alertRules:update handler delegates to updateAlertRule with id and updates', async () => {
    const updatedRule = { ...completeAlertRule, name: 'Updated', threshold: 95, updatedAt: 200 }
    mockUpdateAlertRule.mockReturnValueOnce(updatedRule)
    const event = await registerHandlersWithTrustedIpcOwner()

    const updates = { name: 'Updated', threshold: 95 }
    const result = await registeredHandlers['alertRules:update'](event, 'r1', updates)
    expect(mockUpdateAlertRule).toHaveBeenCalledWith('r1', updates)
    expect(result).toEqual(updatedRule)
  })

  it('alertRules:delete handler delegates to deleteAlertRule with id', async () => {
    mockDeleteAlertRule.mockReturnValueOnce(undefined)
    const event = await registerHandlersWithTrustedIpcOwner()

    await registeredHandlers['alertRules:delete'](event, 'r1')
    expect(mockDeleteAlertRule).toHaveBeenCalledWith('r1')
  })

  it('alertRules:evaluate handler delegates to evaluateOnce', async () => {
    const triggeredAlerts = [completeAlertHistoryRecord]
    mockEvaluateOnce.mockResolvedValueOnce(triggeredAlerts)
    const event = await registerHandlersWithTrustedIpcOwner()

    const result = await registeredHandlers['alertRules:evaluate'](event)
    expect(mockEvaluateOnce).toHaveBeenCalledTimes(1)
    expect(result).toEqual(triggeredAlerts)
  })

  // =========================================================================
  // v7: Alert history channels
  // =========================================================================

  it('registerIpcHandlers registers all v7 alert history channels', async () => {
    const { registerIpcHandlers } = await import('../../src/main/ipc/handlers')
    registerIpcHandlers()
    const expectedChannels = [
      'alertHistory:list',
      'alertHistory:acknowledge',
      'alertHistory:getCount',
    ]
    for (const ch of expectedChannels) {
      expect(registeredHandlers[ch], `channel ${ch} should be registered`).toBeDefined()
    }
  })

  it('alertHistory:list handler delegates to getAlertHistory with filters', async () => {
    const mockRecords = [completeAlertHistoryRecord]
    mockGetAlertHistory.mockReturnValueOnce(mockRecords)
    const event = await registerHandlersWithTrustedIpcOwner()

    const filters = { status: ['active'] }
    const result = await registeredHandlers['alertHistory:list'](event, filters)
    expect(mockGetAlertHistory).toHaveBeenCalledWith(filters)
    expect(result).toEqual(mockRecords)
  })

  it('alertHistory:list handler works without filters', async () => {
    mockGetAlertHistory.mockReturnValueOnce([])
    const event = await registerHandlersWithTrustedIpcOwner()

    const result = await registeredHandlers['alertHistory:list'](event)
    expect(mockGetAlertHistory).toHaveBeenCalledWith()
    expect(result).toEqual([])
  })

  it('alertHistory:acknowledge handler delegates to acknowledgeAlert', async () => {
    const event = await registerHandlersWithTrustedIpcOwner()

    await registeredHandlers['alertHistory:acknowledge'](event, 'alert-1')
    expect(mockAcknowledgeAlert).toHaveBeenCalledWith('alert-1')
  })

  it('alertHistory:getCount handler delegates to getAlertCountByStatus', async () => {
    const mockCounts = { active: 3, acknowledged: 1, resolved: 10 }
    mockGetAlertCountByStatus.mockReturnValueOnce(mockCounts)
    const event = await registerHandlersWithTrustedIpcOwner()

    const result = await registeredHandlers['alertHistory:getCount'](event)
    expect(mockGetAlertCountByStatus).toHaveBeenCalledTimes(1)
    expect(result).toEqual(mockCounts)
  })

  // =========================================================================
  // v7: Alert event forwarding
  // =========================================================================

  it('registers alertEmitter listener when mainWindow is provided', async () => {
    const mockMainWindow = {
      webContents: { send: vi.fn() },
      isDestroyed: vi.fn(() => false),
    }
    const { registerIpcHandlers } = await import('../../src/main/ipc/handlers')
    registerIpcHandlers(mockMainWindow as any)

    expect(mockAlertEmitter.on).toHaveBeenCalledWith('alertTriggered', expect.any(Function))
  })

  it('alertEmitter callback forwards event to mainWindow.webContents.send', async () => {
    let capturedCallback: Function | undefined
    mockAlertEmitter.on.mockImplementationOnce((event: string, cb: Function) => {
      capturedCallback = cb
    })

    const mockSend = vi.fn()
    const mockMainWindow = {
      webContents: { send: mockSend },
      isDestroyed: vi.fn(() => false),
    }
    const { registerIpcHandlers } = await import('../../src/main/ipc/handlers')
    registerIpcHandlers(mockMainWindow as any)

    const record = completeAlertHistoryRecord
    capturedCallback!(record)

    expect(mockSend).toHaveBeenCalledWith('alert:triggered', record)
  })

  it('does not forward event when mainWindow is destroyed', async () => {
    let capturedCallback: Function | undefined
    mockAlertEmitter.on.mockImplementationOnce((event: string, cb: Function) => {
      capturedCallback = cb
    })

    const mockSend = vi.fn()
    const mockMainWindow = {
      webContents: { send: mockSend },
      isDestroyed: vi.fn(() => true),
    }
    const { registerIpcHandlers } = await import('../../src/main/ipc/handlers')
    registerIpcHandlers(mockMainWindow as any)

    capturedCallback!({ id: 'a1' })
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('does not register alertEmitter listener when mainWindow is undefined', async () => {
    const { registerIpcHandlers } = await import('../../src/main/ipc/handlers')
    registerIpcHandlers()

    // alertEmitter.on should NOT have been called in this invocation
    // (the mock was cleared in beforeEach)
    expect(mockAlertEmitter.on).not.toHaveBeenCalled()
  })

  it.each<[string, any[], string]>([
    ['pool:addHost', [CONN_ID, {
      targetHost: '192.0.2.20',
      username: 'root',
      password: 'pool-password',
      masterAddress: '192.0.2.10',
    }], '暂不可用'],
    ['pool:removeHost', [CONN_ID, 'OpaqueRef:host'], '暂不可用'],
    ['patch:upload', [CONN_ID, '/tmp/update.xsupdate'], '暂不可用'],
    ['patch:apply', [CONN_ID, 'OpaqueRef:patch'], '暂不可用'],
    ['rbac:subjectAdd', [CONN_ID, {
      subjectIdentifier: 'user@example.com',
      roles: ['OpaqueRef:role'],
    }], '暂不可用'],
    ['rbac:joinDomain', [CONN_ID, {
      domain: 'example.com',
      username: 'administrator',
      password: 'directory-password',
    }], '暂不可用'],
  ])('blocks audited IPC mutation %s', async (channel, args, defectId) => {
    const event = await registerHandlersWithTrustedIpcOwner()

    const result = await registeredHandlers[channel](event, ...args)

    expect(result).toMatchObject({
      error: true,
      message: expect.stringContaining(defectId),
    })
  })

  it('blocks only EXT and HBA SR creation', async () => {
    const event = await registerHandlersWithTrustedIpcOwner()

    const extResult = await registeredHandlers['sr:create'](
      event,
      CONN_ID,
      'OpaqueRef:host',
      { type: 'ext', nameLabel: 'Local EXT', nameDescription: '' },
    )
    const hbaResult = await registeredHandlers['sr:create'](
      event,
      CONN_ID,
      'OpaqueRef:host',
      { type: 'hba', nameLabel: 'Local HBA', nameDescription: '' },
    )

    expect(extResult).toMatchObject({ error: true, message: expect.stringContaining('暂不可用') })
    expect(hbaResult).toMatchObject({ error: true, message: expect.stringContaining('暂不可用') })
  })

  it('rejects storage repository lifecycle mutations before SR side effects', async () => {
    const event = await registerHandlersWithTrustedIpcOwner()

    const calls: Array<[string, unknown[]]> = [
      ['sr:destroy', [CONN_ID, 'OpaqueRef:sr']],
      ['sr:detach', [CONN_ID, 'OpaqueRef:sr']],
      ['sr:introduce', [CONN_ID, {
        uuid: 'sr-uuid', nameLabel: 'Imported SR', nameDescription: '', type: 'nfs',
      }]],
      ['sr:forget', [CONN_ID, 'OpaqueRef:sr']],
      ['sr:setShared', [CONN_ID, 'OpaqueRef:sr', true]],
    ]

    for (const [channel, args] of calls) {
      await expect(registeredHandlers[channel](event, ...args)).resolves.toMatchObject({
        error: true,
        message: expect.stringContaining('暂不可用'),
      })
    }
    expect(mockDestroySr).not.toHaveBeenCalled()
    expect(mockDetachSr).not.toHaveBeenCalled()
    expect(registeredHandlers['sr:list']).toBeDefined()
    expect(registeredHandlers['sr:scan']).toBeDefined()
    expect(registeredHandlers['sr:probeNfs']).toBeDefined()
    expect(registeredHandlers['sr:probeIscsi']).toBeDefined()
  })

  it('rejects storage device data mutations before destructive side effects', async () => {
    const event = await registerHandlersWithTrustedIpcOwner()

    const calls: Array<[string, unknown[]]> = [
      ['pbd:unplug', [CONN_ID, 'OpaqueRef:pbd']],
      ['pbd:destroy', [CONN_ID, 'OpaqueRef:pbd']],
      ['iso:delete', [CONN_ID, 'OpaqueRef:iso']],
    ]

    for (const [channel, args] of calls) {
      await expect(registeredHandlers[channel](event, ...args)).resolves.toMatchObject({
        error: true,
        message: expect.stringContaining('暂不可用'),
      })
    }
    mockDestroyVdi.mockResolvedValueOnce({ vdiDeleted: true })
    await expect(registeredHandlers['vdi:destroy'](event, CONN_ID, 'OpaqueRef:vdi'))
      .resolves.toEqual({ vdiDeleted: true })
    expect(mockDestroyVdi).toHaveBeenCalledWith(CONN_ID, 'OpaqueRef:vdi')
    expect(registeredHandlers['vdi:list']).toBeDefined()
    expect(registeredHandlers['pbd:list']).toBeDefined()
    expect(registeredHandlers['iso:list']).toBeDefined()
  })

  it('rejects advanced topology mutations before PIF, Bond, VLAN, or Tunnel side effects', async () => {
    const event = await registerHandlersWithTrustedIpcOwner()

    const calls: Array<[string, unknown[]]> = [
      ['pif:reconfigureIp', [CONN_ID, 'OpaqueRef:pif', { mode: 'DHCP' }]],
      ['bond:create', [CONN_ID, { pifRefs: ['OpaqueRef:pif-1', 'OpaqueRef:pif-2'] }]],
      ['bond:destroy', [CONN_ID, 'OpaqueRef:bond']],
      ['bond:destroyGroup', [CONN_ID, 'OpaqueRef:bond', { confirmManagementDisruption: true }]],
      ['vlan:create', [CONN_ID, { taggedPifRef: 'OpaqueRef:pif', vlanTag: 100 }]],
      ['vlan:destroy', [CONN_ID, 'OpaqueRef:vlan']],
      ['vlan:destroyNetwork', [CONN_ID, 'OpaqueRef:network', { confirmManagementDisruption: true }]],
      ['tunnel:create', [CONN_ID, 'OpaqueRef:pif', 'OpaqueRef:network']],
      ['tunnel:destroy', [CONN_ID, 'OpaqueRef:tunnel']],
    ]

    for (const [channel, args] of calls) {
      await expect(registeredHandlers[channel](event, ...args)).resolves.toMatchObject({
        error: true,
        message: expect.stringContaining('暂不可用'),
      })
    }
    expect(registeredHandlers['network:list']).toBeDefined()
    expect(registeredHandlers['pif:list']).toBeDefined()
    expect(registeredHandlers['bond:list']).toBeDefined()
    expect(registeredHandlers['vlan:list']).toBeDefined()
    expect(registeredHandlers['tunnel:list']).toBeDefined()
  })

  it('blocks storage-move at the IPC boundary', async () => {
    const event = await registerHandlersWithTrustedIpcOwner()

    const result = await registeredHandlers['vm:relocate'](event, {
      mode: 'storage-move',
      sourceConnectionId: CONN_ID,
      vmRef: 'OpaqueRef:vm',
      storageMap: { 'OpaqueRef:vdi': 'OpaqueRef:sr' },
    })

    expect(result).toMatchObject({ error: true, message: expect.stringContaining('暂不可用') })
  })

  it('allows same-pool migration and rejects unready relocation modes', async () => {
    const event = await registerHandlersWithTrustedIpcOwner()
    mockRelocateVm.mockResolvedValue({ taskRef: 'OpaqueRef:task' })

    await expect(registeredHandlers['vm:migrate'](event, CONN_ID, 'OpaqueRef:vm', 'OpaqueRef:host'))
      .resolves.toEqual({ taskRef: 'OpaqueRef:task' })
    await expect(registeredHandlers['vm:relocate'](event, {
      mode: 'pool-migrate', sourceConnectionId: CONN_ID,
      vmRef: 'OpaqueRef:vm', targetHostRef: 'OpaqueRef:host',
    })).resolves.toEqual({ taskRef: 'OpaqueRef:task' })

    mockRelocateVm.mockResolvedValueOnce({ copyOperation })
    await expect(registeredHandlers['vm:relocate'](event, {
      mode: 'cross-pool-copy', sourceConnectionId: CONN_ID, targetConnectionId: 'target', vmRef: 'OpaqueRef:vm',
      targetHostRef: 'OpaqueRef:host', transferNetworkRef: 'OpaqueRef:network', storageMap: {}, networkMap: {},
    })).resolves.toEqual({ copyOperation })

    const calls: Array<[string, unknown[]]> = [
      ['vm:relocate', [{ mode: 'storage-move', sourceConnectionId: CONN_ID, vmRef: 'OpaqueRef:vm', storageMap: { 'OpaqueRef:vdi': 'OpaqueRef:sr' } }]],
      ['vm:relocate', [{ mode: 'cross-pool-migrate', sourceConnectionId: CONN_ID, targetConnectionId: 'target', vmRef: 'OpaqueRef:vm', targetHostRef: 'OpaqueRef:host', transferNetworkRef: 'OpaqueRef:network', storageMap: { 'OpaqueRef:vdi': 'OpaqueRef:sr' }, networkMap: { 'OpaqueRef:vif': 'OpaqueRef:network' } }]],
    ]
    for (const [channel, args] of calls) {
      await expect(registeredHandlers[channel](event, ...args)).resolves.toMatchObject({
        error: true,
        message: expect.stringMatching(/暂不可用/),
      })
    }

    await expect(registeredHandlers['vm:relocate'](event, {
      mode: 'forged-mode',
      sourceConnectionId: CONN_ID,
      vmRef: 'OpaqueRef:vm',
    })).resolves.toMatchObject({
      error: true,
      code: 'IPC_SCHEMA_INVALID',
      message: 'IPC payload does not match the channel contract',
    })
    expect(registeredHandlers['vm:getRelocationPlan']).toBeDefined()
  })
})
