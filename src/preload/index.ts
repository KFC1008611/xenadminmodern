/**
 * Preload script — exposes a typed XAPI surface to the renderer via contextBridge.
 * Only whitelisted channels are accessible; no raw ipcRenderer or Node.js APIs are exposed.
 *
 * v4: All resource APIs now require connectionId as the first parameter.
 * New connection management APIs added: connection.connect, connection.disconnect, etc.
 */
import { contextBridge, ipcRenderer } from 'electron'
import { createIpcBridgeApi } from './ipc-bridge'
import { createUpdateApi } from './update-api'
import { createConnectionSessionApi } from './connection-api'
import { createVmApi } from './vm-api'
import { createVmAdvancedApi } from './vm-advanced-api'
import { createNetworkApi } from './network-api'
import { createStorageApi } from './storage-api'
import { createInfrastructureApi } from './infrastructure-api'
import { createObservabilityApi } from './observability-api'
import { createHostApi } from './host-api'
import { createHaApi } from './ha-api'
import { createPatchApi } from './patch-api'
import { createRbacApi } from './rbac-api'

const connectionSessionApi = createConnectionSessionApi(ipcRenderer)
const vmApi = createVmApi(ipcRenderer)
const vmAdvancedApi = createVmAdvancedApi(ipcRenderer)
const networkApi = createNetworkApi(ipcRenderer)
const storageApi = createStorageApi(ipcRenderer)
const infrastructureApi = createInfrastructureApi(ipcRenderer)
const observabilityApi = createObservabilityApi(ipcRenderer)
const hostApi = createHostApi(ipcRenderer)
const haApi = createHaApi(ipcRenderer)
const patchApi = createPatchApi(ipcRenderer)
const rbacApi = createRbacApi(ipcRenderer)

const api = {
  updates: createUpdateApi(ipcRenderer),
  // v4: Connection management (NEW)
  connection: connectionSessionApi.connection,

  // Legacy session API — kept for backwards compatibility during migration.
  // New code should use connection.connect() instead.
  session: connectionSessionApi.session,

  // v4: All pool APIs now require connectionId
  pool: infrastructureApi.pool,

  // v4: All host APIs now require connectionId as first parameter
  host: hostApi.host,

  // v4: All VM APIs now require connectionId as first parameter
  vm: {
    list: vmApi.list,
    start: vmApi.start,
    shutdown: vmApi.shutdown,
    forceShutdown: vmApi.forceShutdown,
    reboot: vmApi.reboot,
    pause: vmApi.pause,
    unpause: vmApi.unpause,
    suspend: vmApi.suspend,
    resume: vmApi.resume,
    destroy: vmApi.destroy,
    snapshot: vmApi.snapshot,
    migrate: vmApi.migrate,
    getRelocationPlan: vmApi.getRelocationPlan,
    relocate: vmApi.relocate,
    copy: vmApi.copy,
    copyPlan: vmApi.copyPlan,
    copyOperations: vmApi.copyOperations,
    cancelCopy: vmApi.cancelCopy,
    console: infrastructureApi.vm.console,
    templates: vmApi.templates,
    creationResources: vmApi.creationResources,
    createFromTemplate: vmApi.createFromTemplate,
    quickCreateFromTemplate: vmApi.quickCreateFromTemplate,
    // v3: VM detail & editing
    getRecord: vmApi.getRecord,
    setNameLabel: vmApi.setNameLabel,
    setNameDescription: vmApi.setNameDescription,
    setVcpus: vmApi.setVcpus,
    setMemoryLimits: vmApi.setMemoryLimits,
    getVBDs: vmApi.getVBDs,
    plugVbd: vmApi.plugVbd,
    unplugVbd: vmApi.unplugVbd,
    detachVbd: vmApi.detachVbd,
    getCdDrive: vmApi.getCdDrive,
    mountIso: vmApi.mountIso,
    ejectIso: vmApi.ejectIso,
    getVIFs: vmApi.getVIFs,
    // v3: snapshots
    getSnapshots: vmApi.getSnapshots,
    revertSnapshot: vmApi.revertSnapshot,
    deleteSnapshot: vmApi.deleteSnapshot,
    renameSnapshot: vmApi.renameSnapshot,
    // v6: VM import/export
    export: vmApi.export,
    import: vmApi.import,
    importGetPreview: vmApi.importGetPreview,
    importProgress: vmApi.importProgress,
    cancelImport: vmApi.cancelImport,
    cancelExport: vmApi.cancelExport,
    exportProgress: vmApi.exportProgress,
    markAsTemplate: vmApi.markAsTemplate,
  },

  // v4: All storage APIs now require connectionId as first parameter
  storage: storageApi.storage,

  // v5: SR lifecycle
  sr: storageApi.sr,

  // v9: PBD management
  pbd: storageApi.pbd,

  // v9: ISO management
  iso: storageApi.iso,

  // v5: VIF management
  vif: networkApi.vif,

  // v9: Bond management
  bond: networkApi.bond,

  // v9: VLAN management
  vlan: networkApi.vlan,

  // v9: Tunnel management
  tunnel: networkApi.tunnel,

  // v9: PIF advanced
  pif: networkApi.pif,

  // v9: Network advanced
  network: networkApi.network,

  // v4: All task APIs now require connectionId as first parameter
  tasks: infrastructureApi.tasks,

  // v5: Alert APIs
  alerts: observabilityApi.alerts,

  // Profiles — no connectionId needed (local storage, not per-connection)
  profiles: infrastructureApi.profiles,

  // v4: Console now requires connectionId
  console: infrastructureApi.console,

  // v6+v7: Metrics collection and persistence
  metrics: observabilityApi.metrics,

  // v7: Alert rule management
  alertRules: observabilityApi.alertRules,

  // v7: Alert history
  alertHistory: observabilityApi.alertHistory,

  // v9: Alert notifications
  alertNotify: observabilityApi.alertNotify,

  // v8: Batch VM operations
  batch: infrastructureApi.batch,

  // v9: Template management
  template: {
    clone: vmApi.templateClone,
    delete: vmApi.templateDelete,
    updateSettings: vmApi.templateUpdateSettings,
    enableInstantCreate: vmApi.templateEnableInstantCreate,
  },

  // v9: HA (High Availability)
  ha: haApi.ha,

  // v9: Patch Management
  patch: patchApi.patch,

  // v9: VM Advanced Features
  vmAdvanced: vmAdvancedApi,

  // v9: RBAC User Permissions
  rbac: rbacApi.rbac,

  // v7: Alert event listener — returns unsubscribe function
  onAlertTriggered: observabilityApi.onAlertTriggered,

  // v8: Batch progress event listener — returns unsubscribe function
  onBatchProgress: infrastructureApi.onBatchProgress,

  // VM change listener — XAPI event.from driven updates from main process
  onVmChanged: vmApi.onVmChanged,

  // v6: Dialog API for file operations
  dialog: infrastructureApi.dialog,
}

contextBridge.exposeInMainWorld('xapiBridge', createIpcBridgeApi(api))
