import type { VmCopyOperation, VmCopyPlan } from '../../../shared/types/xapi'
/**
 * Renderer-side type augmentations for XAPI records and the window.xapi bridge surface.
 *
 * All shared record types are re-exported from @/shared/types.
 * This file only contains the Window.xapi type declaration which is renderer-specific.
 *
 * v4: Added ConnectionInfo and ConnectedRecord types for multi-connection support.
 * v5: Added Alert, Maintenance, SR probe, VIF creation types and extended Window.xapi.
 */
import type {
  // Re-export all shared types for backward compatibility
  XapiConnectionOptions,
  XapiTransportScheme,
  ConnectionInfo,
  PoolRecord,
  ConnectedPoolRecord,
  PoolJoinParams,
  PoolTaskRef,
  ConnectedHaConfiguration,
  HaComputeResult,
  HaRestartPriority,
  HaFailoverPlan,
  HaHostStatus,
  HaConfiguration,
  HaVmConfig,
  HostRecord,
  HostMetrics,
  ConnectedHostRecord,
  VmRecord,
  VmPowerIntent,
  VmDetailRecord,
  ConnectedVmRecord,
  VmAdvancedConfig,
  VmAffinityConfig,
  VmChangeEvent,
  VmConsoleRecord,
  ConsoleProxySession,
  VBDRecord,
  IsoImageRecord,
  VmCdDriveRecord,
  VIFRecord,
  SnapshotRecord,
  WizardDisk,
  WizardVif,
  VmWizardPayload,
  VmCreationResourceOptions,
  VmTemplateKind,
  VmInstallMode,
  VmWizardStepId,
  WizardResourceStatus,
  VmCreationHostOption,
  VmCreationSrOption,
  VmCreationNetworkOption,
  VmCreationIsoOption,
  VmImportParams,
  VmExportParams,
  VmTransferProgress,
  VmImportPreview,
  VmImportPreviewVif,
  VmImportOperationStatus,
  VmImportOperation,
  VmCopyPayload,
  VmDestroyOptions,
  VmDestroyResult,
  VmRelocationMode,
  VmRelocationPayload,
  VmRelocationPlan,
  VmRelocationResult,
  SrRecord,
  ConnectedSrRecord,
  VdiRecord,
  ConnectedVdiRecord,
  VdiAllowedOperations,
  AttachableVdiRecord,
  VdiAttachPayload,
  VdiAttachResult,
  VdiMovePayload,
  VdiMoveResult,
  VdiResizeParams,
  VdiCreateParams,
  VdiCreateForVmResult,
  VdiDeleteResult,
  VdiCloneParams,
  VdiCopyParams,
  ConnectedPbdRecord,
  SrIntroduceParams,
  ThinProvisioningStats,
  NetworkRecord,
  ConnectedNetworkRecord,
  PifRecord,
  ConnectedPifRecord,
  ConnectedTunnelRecord,
  PifIpConfig,
  VifQosParams,
  BondRecord,
  VlanRecord,
  BondCreateParams,
  VlanCreateParams,
  TaskRecord,
  TaskCancellationResult,
  ConnectedTaskRecord,
  ConnectionProfile,
  AlertRecord,
  ConnectedAlertRecord,
  AlertFilters,
  MaintenanceStatus,
  EvacuateResult,
  NfsTarget,
  IscsiTarget,
  IscsiLun,
  IscsiProbeOptions,
  SrCreateParams,
  VifCreateParams,
  VifCreateResult,
  MetricDataPoint,
  VmMetricDataPoint,
  MetricStats,
  MetricsRangeParams,
  MetricsCollectionOptions,
  HostMetricsHistory,
  MetricType,
  AlertOperator,
  AlertSeverity,
  AlertRule,
  AlertRuleInput,
  AlertRuleUpdate,
  AlertHistoryRecord,
  AlertHistoryFilters,
  AlertHistoryCount,
  DefaultNotificationConfig,
  EmailConfig,
  WebhookConfig,
  NotificationRecord,
  NotificationHistoryFilters,
  AlertNotificationPayload,
  AlertNotificationSendResult,
  NotificationConfigSaveResult,
  BatchOperationInput,
  BatchRetryConfirmation,
  BatchTask,
  BatchTaskWithItems,
  BatchProgressEvent,
  BatchSubmitResult,
  OpenDialogOptions,
  OpenDialogResult,
  SaveDialogOptions,
  SaveDialogResult,
  IpcErrorResponse,
  TemplateClonePayload,
  TemplateDeletePayload,
  TemplateSettingsPayload,
} from '../../../shared/types/xapi'

// Re-export all shared types for backward compatibility with existing imports
export type {
  XapiConnectionOptions,
  XapiTransportScheme,
  ConnectionInfo,
  PoolRecord,
  ConnectedPoolRecord,
  ConnectedHaConfiguration,
  HaComputeResult,
  HaRestartPriority,
  HaFailoverPlan,
  HaHostStatus,
  HaConfiguration,
  HaVmConfig,
  HostRecord,
  HostMetrics,
  ConnectedHostRecord,
  VmRecord,
  VmDetailRecord,
  ConnectedVmRecord,
  VmAdvancedConfig,
  VmAffinityConfig,
  VmChangeEvent,
  VBDRecord,
  IsoImageRecord,
  VmCdDriveRecord,
  VIFRecord,
  SnapshotRecord,
  WizardDisk,
  WizardVif,
  VmWizardPayload,
  VmCreationResourceOptions,
  VmTemplateKind,
  VmInstallMode,
  VmWizardStepId,
  WizardResourceStatus,
  VmCreationHostOption,
  VmCreationSrOption,
  VmCreationNetworkOption,
  VmCreationIsoOption,
  VmImportParams,
  VmExportParams,
  VmTransferProgress,
  VmImportPreview,
  VmImportPreviewVif,
  VmImportOperationStatus,
  VmImportOperation,
  VmCopyPayload,
  VmDestroyOptions,
  VmDestroyResult,
  VmRelocationMode,
  VmRelocationPayload,
  VmRelocationPlan,
  VmRelocationResult,
  SrRecord,
  ConnectedSrRecord,
  VdiRecord,
  ConnectedVdiRecord,
  VdiAllowedOperations,
  AttachableVdiRecord,
  VdiAttachPayload,
  VdiAttachResult,
  VdiMovePayload,
  VdiMoveResult,
  VdiResizeParams,
  VdiCreateParams,
  VdiCloneParams,
  VdiCopyParams,
  ConnectedPbdRecord,
  SrIntroduceParams,
  ThinProvisioningStats,
  NetworkRecord,
  ConnectedNetworkRecord,
  PifRecord,
  ConnectedPifRecord,
  ConnectedTunnelRecord,
  PifIpConfig,
  VifQosParams,
  BondRecord,
  VlanRecord,
  BondCreateParams,
  VlanCreateParams,
  TaskRecord,
  ConnectedTaskRecord,
  ConnectionProfile,
  AlertRecord,
  ConnectedAlertRecord,
  AlertFilters,
  MaintenanceStatus,
  EvacuateResult,
  NfsTarget,
  IscsiTarget,
  IscsiLun,
  IscsiProbeOptions,
  SrCreateParams,
  VifCreateParams,
  VifCreateResult,
  MetricDataPoint,
  VmMetricDataPoint,
  MetricStats,
  MetricsRangeParams,
  MetricType,
  AlertOperator,
  AlertSeverity,
  AlertRule,
  AlertRuleInput,
  AlertHistoryRecord,
  AlertHistoryFilters,
  IpcErrorResponse,
  TemplateClonePayload,
  TemplateDeletePayload,
  TemplateSettingsPayload,
}

// Augment the global Window interface so the preload-exposed API is typed.
declare global {
  interface Window {
    xapi: {
      connection: {
        connect: (opts: XapiConnectionOptions) => Promise<{ id: string }>
        disconnect: (id: string) => Promise<void>
        list: () => Promise<ConnectionInfo[]>
        reconnect: (id: string, password?: string) => Promise<void>
        getInfo: (id: string) => Promise<ConnectionInfo>
      }
      session: {
        connect: (opts: XapiConnectionOptions) => Promise<{ id: string; connected: boolean }>
        disconnect: () => Promise<void>
        status: () => Promise<{ connected: boolean }>
      }
      pool: {
        get: (connectionId: string) => Promise<ConnectedPoolRecord | null>
        addHost: (connectionId: string, params: PoolJoinParams) => Promise<PoolTaskRef>
        removeHost: (connectionId: string, hostRef: string) => Promise<PoolTaskRef>
        transferMaster: (connectionId: string, newMasterRef: string) => Promise<PoolTaskRef>
      }
      host: {
        list: (connectionId: string) => Promise<ConnectedHostRecord[]>
        metrics: (connectionId: string, ref: string) => Promise<Record<string, unknown>>
        enable: (connectionId: string, ref: string) => Promise<void>
        disable: (connectionId: string, ref: string) => Promise<void>
        reboot: (connectionId: string, ref: string) => Promise<void>
        shutdown: (connectionId: string, ref: string) => Promise<void>
        getMaintenanceStatus: (connectionId: string, hostRef: string) => Promise<MaintenanceStatus>
        enterMaintenance: (connectionId: string, hostRef: string) => Promise<EvacuateResult>
        exitMaintenance: (connectionId: string, hostRef: string) => Promise<void>
        evacuate: (connectionId: string, hostRef: string) => Promise<EvacuateResult>
      }
      vm: {
        list: (connectionId: string) => Promise<ConnectedVmRecord[]>
        start: (connectionId: string, ref: string, intent?: VmPowerIntent) => Promise<void>
        shutdown: (connectionId: string, ref: string, intent?: VmPowerIntent) => Promise<void>
        forceShutdown: (connectionId: string, ref: string, intent?: VmPowerIntent) => Promise<void>
        reboot: (connectionId: string, ref: string, intent?: VmPowerIntent) => Promise<void>
        pause: (connectionId: string, ref: string, intent?: VmPowerIntent) => Promise<void>
        unpause: (connectionId: string, ref: string, intent?: VmPowerIntent) => Promise<void>
        suspend: (connectionId: string, ref: string, intent?: VmPowerIntent) => Promise<void>
        resume: (connectionId: string, ref: string, intent?: VmPowerIntent) => Promise<void>
        destroy: (connectionId: string, ref: string, options?: VmDestroyOptions) => Promise<VmDestroyResult>
        snapshot: (connectionId: string, ref: string, name: string) => Promise<string>
        migrate: (connectionId: string, ref: string, targetHostRef: string) => Promise<VmRelocationResult>
        getRelocationPlan: (
          sourceConnectionId: string,
          vmRef: string,
          targetConnectionId?: string
        ) => Promise<VmRelocationPlan>
        relocate: (payload: VmRelocationPayload) => Promise<VmRelocationResult>
        copy: (connectionId: string, payload: VmCopyPayload) => Promise<VmCopyOperation>
        copyPlan: (sourceConnectionId: string, vmRef: string, targetConnectionId: string) => Promise<VmCopyPlan>
        copyOperations: () => Promise<VmCopyOperation[]>
        cancelCopy: (id: string) => Promise<VmCopyOperation>
        console: (connectionId: string, ref: string) => Promise<VmConsoleRecord[]>
        templates: (connectionId: string) => Promise<{ user: VmRecord[]; system: VmRecord[] }>
        createFromTemplate: (connectionId: string, payload: VmWizardPayload) => Promise<string>
        creationResources: (connectionId: string, templateRef?: string) => Promise<VmCreationResourceOptions>
        getRecord: (connectionId: string, ref: string) => Promise<VmDetailRecord>
        setNameLabel: (connectionId: string, ref: string, label: string) => Promise<void>
        setNameDescription: (connectionId: string, ref: string, desc: string) => Promise<void>
        setVcpus: (connectionId: string, ref: string, count: number) => Promise<void>
        setMemoryLimits: (
          connectionId: string,
          ref: string,
          sMin: number,
          dMin: number,
          dMax: number,
          sMax: number
        ) => Promise<void>
        getVBDs: (connectionId: string, ref: string) => Promise<VBDRecord[]>
        plugVbd: (connectionId: string, vbdRef: string) => Promise<void>
        unplugVbd: (connectionId: string, vbdRef: string) => Promise<void>
        detachVbd: (connectionId: string, vbdRef: string) => Promise<void>
        getCdDrive: (connectionId: string, ref: string) => Promise<VmCdDriveRecord>
        mountIso: (connectionId: string, ref: string, isoVdiRef: string) => Promise<void>
        ejectIso: (connectionId: string, ref: string) => Promise<void>
        getVIFs: (connectionId: string, ref: string) => Promise<VIFRecord[]>
        getSnapshots: (connectionId: string, ref: string) => Promise<SnapshotRecord[]>
        revertSnapshot: (connectionId: string, snapshotRef: string) => Promise<void>
        deleteSnapshot: (connectionId: string, snapshotRef: string) => Promise<VmDestroyResult>
        renameSnapshot: (connectionId: string, snapshotRef: string, newName: string) => Promise<void>
        export: (connectionId: string, params: VmExportParams) => Promise<{ exportId: string; estimatedBytes: number }>
        exportProgress: (exportId: string) => Promise<VmTransferProgress | null>
        import: (connectionId: string, params: VmImportParams) => Promise<string>
        importGetPreview: (filePath: string) => Promise<VmImportPreview>
        importProgress: (operationId: string) => Promise<VmImportOperation | null>
        cancelImport: (connectionId: string, operationId: string) => Promise<void>
        cancelExport: (connectionId: string, exportId: string) => Promise<void>
        markAsTemplate: (connectionId: string, vmRef: string) => Promise<void>
        quickCreateFromTemplate: (connectionId: string, templateRef: string) => Promise<string>
      }
      storage: {
        listSrs: (connectionId: string) => Promise<ConnectedSrRecord[]>
        listVdis: (connectionId: string, srRef: string) => Promise<VdiRecord[]>
        createVdi: (connectionId: string, srRef: string, name: string, size: number) => Promise<string>
        destroyVdi: (connectionId: string, ref: string) => Promise<VdiDeleteResult>
        createForVm: (
          connectionId: string,
          params: VdiCreateParams,
          vmRef: string
        ) => Promise<VdiCreateForVmResult>
        resizeVdi: (connectionId: string, params: VdiResizeParams) => Promise<string>
        getAllowedOperations: (
          connectionId: string,
          vdiRef: string,
          vmRef: string
        ) => Promise<VdiAllowedOperations>
        listAttachableVdis: (connectionId: string, vmRef: string) => Promise<AttachableVdiRecord[]>
        attachExistingVdi: (connectionId: string, payload: VdiAttachPayload) => Promise<VdiAttachResult>
        moveVdi: (connectionId: string, payload: VdiMovePayload) => Promise<VdiMoveResult>
        cloneVdi: (connectionId: string, params: VdiCloneParams) => Promise<string>
        snapshotVdi: (connectionId: string, vdiRef: string, nameLabel?: string) => Promise<string>
        copyVdi: (connectionId: string, params: VdiCopyParams) => Promise<string>
        setVdiNameLabel: (connectionId: string, vdiRef: string, name: string) => Promise<void>
        setVdiNameDescription: (connectionId: string, vdiRef: string, description: string) => Promise<void>
        addVdiTag: (connectionId: string, vdiRef: string, tag: string) => Promise<void>
        removeVdiTag: (connectionId: string, vdiRef: string, tag: string) => Promise<void>
      }
      pbd: {
        list: (connectionId: string) => Promise<ConnectedPbdRecord[]>
        create: (
          connectionId: string,
          hostRef: string,
          srRef: string,
          deviceConfig?: Record<string, string>
        ) => Promise<string>
        plug: (connectionId: string, pbdRef: string) => Promise<void>
        unplug: (connectionId: string, pbdRef: string) => Promise<void>
        destroy: (connectionId: string, pbdRef: string) => Promise<void>
      }
      iso: {
        list: (connectionId: string, srRef: string) => Promise<ConnectedVdiRecord[]>
        listAll: (connectionId: string) => Promise<IsoImageRecord[]>
        delete: (connectionId: string, vdiRef: string) => Promise<void>
      }
      sr: {
        create: (connectionId: string, hostRef: string, params: SrCreateParams) => Promise<string>
        destroy: (connectionId: string, srRef: string) => Promise<void>
        scan: (connectionId: string, srRef: string) => Promise<void>
        detach: (connectionId: string, srRef: string) => Promise<void>
        setDefault: (connectionId: string, poolRef: string, srRef: string) => Promise<void>
        probeNfs: (connectionId: string, hostRef: string, server: string) => Promise<NfsTarget[]>
        probeIscsi: (connectionId: string, hostRef: string, target: string, options?: IscsiProbeOptions) => Promise<IscsiTarget[]>
        introduce: (connectionId: string, params: SrIntroduceParams) => Promise<string>
        forget: (connectionId: string, srRef: string) => Promise<void>
        setShared: (connectionId: string, srRef: string, shared: boolean) => Promise<void>
        getThinStats: (connectionId: string, srRef: string) => Promise<ThinProvisioningStats>
        updateIdentity: (connectionId: string, srRef: string, update: import('../../../shared/types/xapi').SrIdentityUpdate) => Promise<import('../../../shared/types/xapi').SrIdentity>
      }
      network: {
        list: (connectionId: string) => Promise<ConnectedNetworkRecord[]>
        listPifs: (connectionId: string) => Promise<ConnectedPifRecord[]>
        create: (connectionId: string, name: string, description: string) => Promise<string>
        destroy: (connectionId: string, networkRef: string) => Promise<void>
        rename: (connectionId: string, networkRef: string, newName: string) => Promise<void>
        getAllowedOps: (connectionId: string, networkRef: string) => Promise<string[]>
        addTag: (connectionId: string, networkRef: string, tag: string) => Promise<void>
        removeTag: (connectionId: string, networkRef: string, tag: string) => Promise<void>
        updateOtherConfig: (connectionId: string, networkRef: string, key: string, value: string) => Promise<void>
      }
      vif: {
        move: (connectionId: string, vifRef: string, networkRef: string) => Promise<void>
        create: (connectionId: string, params: VifCreateParams) => Promise<VifCreateResult>
        destroy: (connectionId: string, vifRef: string) => Promise<void>
        plug: (connectionId: string, vifRef: string) => Promise<void>
        unplug: (connectionId: string, vifRef: string) => Promise<void>
        setQos: (
          connectionId: string,
          vifRef: string,
          params: VifQosParams
        ) => Promise<void>
        clearQos: (connectionId: string, vifRef: string) => Promise<void>
      }
      bond: {
        list: (connectionId: string) => Promise<BondRecord[]>
        create: (connectionId: string, params: BondCreateParams) => Promise<string[]>
        destroy: (connectionId: string, bondRef: string) => Promise<void>
        destroyGroup: (connectionId: string, bondRef: string, options?: { confirmManagementDisruption?: boolean }) => Promise<string[]>
        getRecord: (connectionId: string, bondRef: string) => Promise<BondRecord>
      }
      vlan: {
        list: (connectionId: string) => Promise<VlanRecord[]>
        create: (connectionId: string, params: VlanCreateParams) => Promise<string[]>
        destroy: (connectionId: string, vlanRef: string) => Promise<void>
        destroyNetwork: (connectionId: string, networkRef: string, options?: { confirmManagementDisruption?: boolean }) => Promise<string[]>
        getRecord: (connectionId: string, vlanRef: string) => Promise<VlanRecord>
      }
      tunnel: {
        list: (connectionId: string) => Promise<ConnectedTunnelRecord[]>
        create: (connectionId: string, accessPifRef: string, networkRef: string) => Promise<string>
        destroy: (connectionId: string, tunnelRef: string) => Promise<void>
      }
      pif: {
        reconfigureIp: (connectionId: string, pifRef: string, config: PifIpConfig) => Promise<void>
        scan: (connectionId: string, hostRef: string) => Promise<void>
        getForHost: (connectionId: string, hostRef: string) => Promise<ConnectedPifRecord[]>
      }
      tasks: {
        list: (connectionId: string) => Promise<ConnectedTaskRecord[]>
        cancel: (connectionId: string, ref: string) => Promise<TaskCancellationResult>
      }
      alerts: {
        getAll: (connectionId: string, filters?: AlertFilters) => Promise<ConnectedAlertRecord[]>
        dismiss: (connectionId: string, alertRef: string) => Promise<void>
        dismissAll: (connectionId: string, filters?: AlertFilters) => Promise<number>
      }
      profiles: {
        list: () => Promise<ConnectionProfile[]>
        save: (profile: ConnectionProfile, password: string | null) => Promise<void>
        delete: (id: string) => Promise<void>
        hasPassword: (id: string) => Promise<boolean>
        connect: (id: string, password?: string) => Promise<{ id: string }>
      }
      console: {
        getUrl: (connectionId: string, vmRef: string) => Promise<ConsoleProxySession>
        close: (sessionId: string) => Promise<void>
      }
      metrics: {
        startCollection: (
          connectionId: string,
          config?: MetricsCollectionOptions,
        ) => Promise<void>
        stopCollection: (connectionId: string) => Promise<void>
        getHistory: (connectionId: string) => Promise<HostMetricsHistory[]>
        getRange: (
          connectionId: string,
          hostRef: string,
          params: MetricsRangeParams
        ) => Promise<MetricDataPoint[]>
        getStats: (
          connectionId: string,
          hostRef: string,
          metricType: MetricType,
          params: MetricsRangeParams
        ) => Promise<MetricStats>
        getVmHistory: (
          connectionId: string,
          vmRef: string,
          params: MetricsRangeParams
        ) => Promise<VmMetricDataPoint[]>
        getCollectionError: (connectionId: string) => Promise<string | null>
      }
      alertRules: {
        list: () => Promise<AlertRule[]>
        create: (rule: AlertRuleInput) => Promise<AlertRule>
        update: (id: string, updates: AlertRuleUpdate) => Promise<AlertRule>
        delete: (id: string) => Promise<void>
        evaluate: () => Promise<AlertHistoryRecord[]>
      }
      alertHistory: {
        list: (filters?: AlertHistoryFilters) => Promise<AlertHistoryRecord[]>
        acknowledge: (alertId: string) => Promise<void>
        getCount: () => Promise<AlertHistoryCount>
      }
      alertNotify: {
        getConfig: () => Promise<DefaultNotificationConfig>
        saveConfig: (config: DefaultNotificationConfig) => Promise<NotificationConfigSaveResult>
        test: (
          channel: 'email' | 'webhook',
          config: Partial<EmailConfig> | Partial<WebhookConfig>,
        ) => Promise<boolean>
        getHistory: (filters?: NotificationHistoryFilters) => Promise<NotificationRecord[]>
        send: (payload: AlertNotificationPayload) => Promise<AlertNotificationSendResult>
      }
      batch: {
        submit: (task: BatchOperationInput) => Promise<BatchSubmitResult>
        cancel: (taskId: string) => Promise<void>
        getStatus: (taskId: string) => Promise<BatchTaskWithItems>
        list: () => Promise<BatchTask[]>
        retry: (taskId: string, confirmation: BatchRetryConfirmation) => Promise<void>
      }
      template: {
        clone: (connectionId: string, payload: TemplateClonePayload) => Promise<VmCopyOperation>
        delete: (connectionId: string, payload: TemplateDeletePayload) => Promise<VmDestroyResult>
        updateSettings: (connectionId: string, payload: TemplateSettingsPayload) => Promise<void>
        enableInstantCreate: (connectionId: string, templateRef: string) => Promise<void>
      }
      onAlertTriggered: (callback: (data: AlertHistoryRecord) => void) => () => void
      onBatchProgress: (callback: (data: BatchProgressEvent) => void) => () => void
      onVmChanged: (callback: (data: VmChangeEvent) => void) => () => void
      dialog: {
        showOpenDialog: (options?: OpenDialogOptions) => Promise<OpenDialogResult>
        showSaveDialog: (options?: SaveDialogOptions) => Promise<SaveDialogResult>
      }
      ha: {
        getConfig: (connectionId: string) => Promise<ConnectedHaConfiguration | null>
        enable: (connectionId: string, params: { heartbeatSRs: string[]; allowOvercommit?: boolean }) => Promise<void>
        disable: (connectionId: string) => Promise<void>
        computeTolerance: (connectionId: string) => Promise<HaComputeResult>
        preventRestarts: (connectionId: string, seconds: number) => Promise<void>
        getVmConfigs: (connectionId: string) => Promise<HaVmConfig[]>
        setVmPriority: (connectionId: string, vmRef: string, priority: HaRestartPriority) => Promise<void>
        setVmAlwaysRun: (connectionId: string, vmRef: string, alwaysRun: boolean) => Promise<void>
        getVmAlwaysRun: (connectionId: string, vmRef: string) => Promise<boolean>
        emergencyMaster: (connectionId: string) => Promise<void>
        recoverSlaves: (connectionId: string) => Promise<void>
        getFailoverPlan: (connectionId: string) => Promise<HaFailoverPlan>
      }
      patch: {
        list: (connectionId: string) => Promise<any[]>
        getRecord: (connectionId: string, patchRef: string) => Promise<any>
        upload: (connectionId: string, filePath: string) => Promise<any>
        precheck: (connectionId: string, patchRef: string) => Promise<any>
        apply: (connectionId: string, patchRef: string) => Promise<any>
        applyToHost: (connectionId: string, hostRef: string, patchRef: string) => Promise<void>
        clean: (connectionId: string, patchRef: string) => Promise<void>
        destroy: (connectionId: string, patchRef: string) => Promise<void>
        destroyFromHost: (connectionId: string, hostRef: string, patchRef: string) => Promise<void>
        getHostStatus: (connectionId: string) => Promise<any[]>
        getMissing: (connectionId: string, hostRef: string) => Promise<any[]>
        applyBatch: (connectionId: string, patchRefs: string[]) => Promise<any[]>
      }
      rbac: {
        roleList: (connectionId: string) => Promise<any[]>
        roleGet: (connectionId: string, roleRef: string) => Promise<any>
        rolePermissions: (connectionId: string, roleRef: string) => Promise<string[]>
        subjectList: (connectionId: string) => Promise<any[]>
        subjectGet: (connectionId: string, subjectRef: string) => Promise<any>
        subjectWithRoles: (connectionId: string) => Promise<any[]>
        subjectAdd: (connectionId: string, params: any) => Promise<string>
        subjectRemove: (connectionId: string, subjectRef: string) => Promise<void>
        subjectAddRole: (connectionId: string, subjectRef: string, roleRef: string) => Promise<void>
        subjectRemoveRole: (connectionId: string, subjectRef: string, roleRef: string) => Promise<void>
        userList: (connectionId: string) => Promise<any[]>
        userGet: (connectionId: string, username: string) => Promise<any>
        extAuthConfig: (connectionId: string) => Promise<any>
        joinDomain: (connectionId: string, params: any) => Promise<void>
        leaveDomain: (connectionId: string) => Promise<void>
        sessionPermissions: (connectionId: string) => Promise<string[]>
      }
      vmAdvanced: {
        getConfig: (connectionId: string, vmRef: string) => Promise<VmAdvancedConfig>
        getAllConfigs: (connectionId: string) => Promise<VmAdvancedConfig[]>
        setAffinity: (connectionId: string, vmRef: string, hostRef: string | null) => Promise<void>
        getAffinity: (connectionId: string, vmRef: string) => Promise<VmAffinityConfig>
        setAntiAffinity: (connectionId: string, vmRef: string, vmRefs: string[]) => Promise<void>
        addAntiAffinity: (connectionId: string, vmRef: string, antiAffinityVmRef: string) => Promise<void>
        removeAntiAffinity: (connectionId: string, vmRef: string, antiAffinityVmRef: string) => Promise<void>
        enableProtection: (connectionId: string, vmRef: string) => Promise<void>
        disableProtection: (connectionId: string, vmRef: string) => Promise<void>
        setVcpuHotplug: (connectionId: string, vmRef: string, maxVcpus: number) => Promise<void>
        setVcpusNumber: (connectionId: string, vmRef: string, vcpus: number) => Promise<void>
        setStartDelay: (connectionId: string, vmRef: string, delaySeconds: number) => Promise<void>
        setBootOrder: (connectionId: string, vmRef: string, order: string) => Promise<void>
        setHvmBootParams: (connectionId: string, vmRef: string, params: Record<string, string>) => Promise<void>
        setPlatformParam: (connectionId: string, vmRef: string, key: string, value: string) => Promise<void>
        setViridian: (connectionId: string, vmRef: string, enabled: boolean) => Promise<void>
        setOtherConfig: (connectionId: string, vmRef: string, key: string, value: string) => Promise<void>
        addTag: (connectionId: string, vmRef: string, tag: string) => Promise<void>
        removeTag: (connectionId: string, vmRef: string, tag: string) => Promise<void>
        setStartOrder: (connectionId: string, vmStartConfigs: Array<{ vmRef: string; startDelay: number; order: number }>) => Promise<void>
      }
    }
  }
}
