/**
 * Shared XAPI record types — single source of truth for both main and renderer.
 *
 * Previously these types were duplicated across:
 *   - src/renderer/src/types/xapi.ts
 *   - src/main/xapi/services/vm.service.ts
 *   - src/main/xapi/services/host.service.ts
 *   - src/main/xapi/services/metrics-db.service.ts
 *
 * Now all code imports from this shared module.
 */

// ── Connection types ──────────────────────────────────────────────────────────

export type XapiTransportScheme = 'http:' | 'https:'

export interface XapiConnectionOptions {
  host: string
  port: number
  scheme: XapiTransportScheme
  username: string
  password: string
  allowSelfSigned: boolean
  name?: string
}

export interface ConnectionInfo {
  id: string
  name: string
  host: string
  poolName: string | null
  poolRef: string | null
  state: 'connecting' | 'connected' | 'disconnected' | 'error'
  errorMessage: string | null
  connectedAt: number | null
  epoch?: number
  poolUuid?: string
  lastRequestFailure?: {
    method: string
    code: string
    durationMs: number
    occurredAt: number
    sessionAvailable: boolean | null
  }
}

// ── Pool ──────────────────────────────────────────────────────────────────────

export interface PoolRecord {
  ref: string
  uuid: string
  name_label: string
  name_description: string
  master: string
  default_SR: string
  ha_enabled: boolean
}

export interface ConnectedPoolRecord extends PoolRecord {
  connectionId: string
}

export interface PoolJoinParams {
  targetHost: string
  username: string
  password: string
  masterAddress: string
  forceJoin?: boolean
}

export type PoolTaskRef = string

// ── High Availability ────────────────────────────────────────────────────

export interface HaHostStatus {
  hostRef: string
  hostName: string
  live: boolean | null
  failed: boolean | null
  failureMode: 'unknown'
}

export interface HaConfiguration {
  enabled: boolean
  allowOvercommit: boolean
  plannedRepeats: number
  heartbeatSRs: string[]
  hosts: HaHostStatus[]
}

export interface ConnectedHaConfiguration extends HaConfiguration {
  connectionId: string
  poolName: string
}

export type HaRestartPriority = '' | 'best-effort' | 'restart'

export interface HaVmConfig {
  vmRef: string
  vmName: string
  /** Published XAPI restart policy; this is not a numeric boot order. */
  restartPriority: HaRestartPriority
  alwaysRun: boolean
}

export interface HaComputeResult {
  canHandleHostFailures: number
  /** The tolerance API does not return per-VM placement predictions. */
  vmsThatCouldBeRestarted: null
  vmsThatWouldNotBeRestarted: null
}

export interface HaFailoverPlan {
  /** Policy summary, not a prediction of destination hosts. */
  vmsByPriority: Array<{ priority: Exclude<HaRestartPriority, ''>; vms: HaVmConfig[] }>
  canTolerateFailures: number
}

// ── Host ──────────────────────────────────────────────────────────────────────

export interface HostRecord {
  ref: string
  uuid: string
  name_label: string
  hostname: string
  address: string
  enabled: boolean
  resident_VMs: string[]
  memory_total?: number
  memory_free?: number
  memoryReadError?: string
  cpu_info: Record<string, string>
  software_version: Record<string, string>
  metrics: string
  /** Present in XAPI host_record but was previously omitted from renderer type */
  suspend_image_sr: string
}

export interface HostMetrics {
  ref: string
  memory_total: number
  memory_free: number
  live: boolean
}

export interface ConnectedHostRecord extends HostRecord {
  connectionId: string
  poolName: string
}

// ── VM ────────────────────────────────────────────────────────────────────────

export interface VmRecord {
  ref: string
  uuid: string
  name_label: string
  name_description: string
  power_state: 'Running' | 'Halted' | 'Suspended' | 'Paused'
  resident_on: string
  VCPUs_max: number
  VCPUs_at_startup: number
  memory_static_min?: number
  memory_static_max: number
  memory_dynamic_min?: number
  memory_dynamic_max: number
  is_a_template: boolean
  /** Present in XAPI vm_record — true when this VM record is a snapshot */
  is_a_snapshot?: boolean
  is_control_domain: boolean
  VBDs: string[]
  VIFs: string[]
  /** Present in XAPI vm_record — included here for consistency with main process */
  metrics: string
  /** Present in XAPI vm_record — included here for consistency with main process */
  guest_metrics: string
  /** Present in XAPI vm_record — included here for consistency with main process */
  consoles: string[]
  /** Present in XAPI vm_record — used for template classification */
  other_config?: Record<string, string>
  HVM_boot_policy?: string
  HVM_boot_params?: Record<string, string>
  PV_bootloader?: string
  PV_args?: string
  platform?: Record<string, string>
  affinity?: string
  /** Indicates if this is a default system template */
  is_default_template?: boolean
  /** XAPI vm_operations currently permitted for this VM */
  allowed_operations?: string[]
  /** XAPI tasks currently acting on this VM, keyed by task ref */
  current_operations?: Record<string, string>
  /** Optional operation block reasons returned by some XenServer variants */
  blocked_operations?: Record<string, string>
  /** Compatibility fields used by older XenAdmin-style helpers */
  locked?: boolean
  Locked?: boolean
}

export interface VmDetailRecord extends VmRecord {
  memory_static_min: number
  memory_dynamic_min: number
  /** VM_metrics.memory_actual: allocated physical memory, not guest OS usage. */
  memory_actual?: number
  os_version: Record<string, string>
  networks: Record<string, string>
}

export interface ConnectedVmRecord extends VmRecord {
  connectionId: string
  poolName: string
  /** Guest Tools networks, enriched in one pool-scoped bulk read. */
  networks?: Record<string, string>
  guestMetricsError?: string
}

export interface VmAdvancedConfig {
  vmRef: string
  vmName: string
  /** Host ref. */
  affinity: string | null
  /** VM refs. */
  antiAffinity: string[]
  antiAffinitySupported?: boolean
  isProtected: boolean
  vcpusHotplug: boolean
  /** Delay in seconds. */
  startDelay: number
  /** HVM boot order, for example `cdn`. */
  bootOrder: string
  hvmBootParams: Record<string, string>
  otherConfig: Record<string, string>
  platform: Record<string, string>
}

export interface VmAffinityConfig {
  vmRef: string
  hostRef: string | null
  antiAffinityRefs: string[]
}

export type VmEventOperation = 'add' | 'mod' | 'del'

export interface VmChangeEvent {
  connectionId: string
  operation: VmEventOperation
  ref: string
  snapshot?: Partial<VmRecord>
  receivedAt: number
}

export interface VmConsoleRecord {
  ref: string
  location: string
  protocol: string
  [key: string]: unknown
}

export interface ConsoleProxySession {
  wsUrl: string
  sessionId: string
}

// ── VBD ───────────────────────────────────────────────────────────────────────

export interface VBDRecord {
  ref: string
  VDI: string
  userdevice: string
  mode: string
  type: string
  bootable: boolean
  currently_attached: boolean
  unpluggable: boolean
  allowed_operations?: string[]
  owner: boolean
  deleteReason?: string
  vdiName: string
  vdiSize: number
  srRef: string
}

export interface IsoImageRecord {
  ref: string
  uuid: string
  name_label: string
  name_description: string
  virtual_size: number
  physical_utilisation: number
  type: string
  SR: string
  srName: string
  read_only: boolean
  connectionId: string
  poolName: string
}

export interface VmCdDriveRecord {
  vbdRef: string | null
  vdiRef: string | null
  userdevice: string | null
  empty: boolean
  isoName: string | null
  isoSize: number | null
  srRef: string | null
  srName: string | null
}

// ── VIF ───────────────────────────────────────────────────────────────────────

export interface VIFRecord {
  ref: string
  device: string
  MAC: string
  network: string
  networkName: string
  MTU: number
  currently_attached?: boolean
  policy?: VmVifPolicy
}

export interface VmVifPolicy {
  MTU: number
  qos_algorithm_type: string
  qos_algorithm_params: Record<string, string>
  locking_mode: 'network_default' | 'locked' | 'unlocked' | 'disabled'
  ipv4_allowed: string[]
  ipv6_allowed: string[]
}

// ── Snapshot ──────────────────────────────────────────────────────────────────

export interface SnapshotRecord {
  ref: string
  uuid: string
  name_label: string
  name_description: string
  snapshot_time: string
  size: number
}

// ── VM Wizard ─────────────────────────────────────────────────────────────────

export type VmTemplateKind = 'system' | 'custom'
export type VmInstallMode = 'iso' | 'pxe' | 'url' | 'none'
export type VmWizardStepId =
  | 'template'
  | 'name'
  | 'install'
  | 'placement'
  | 'compute'
  | 'storage'
  | 'network'
  | 'review'
export type WizardResourceStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface VmCreationHostOption {
  ref: string
  name: string
  enabled: boolean
  memoryFree: number
  cpuCount: number
}

export interface VmCreationSrOption {
  ref: string
  uuid?: string
  isDefault?: boolean
  name: string
  freeBytes: number
  shared: boolean
  hostRefs: string[]
}

export interface VmCreationNetworkOption {
  ref: string
  name: string
  hostRefs: string[]
  autoPlug: boolean
}

export interface VmCreationIsoOption {
  ref: string
  name: string
  srRef: string
  hostRefs: string[]
}

export interface VmCreationResourceOptions {
  hosts: VmCreationHostOption[]
  srs: VmCreationSrOption[]
  networks: VmCreationNetworkOption[]
  isos: VmCreationIsoOption[]
  templateDisks?: WizardDisk[]
  templateCdCount?: number
}

export interface WizardDisk {
  templateVdiRef: string
  srRef: string
  sizeBytes: number
  device?: string
  bootable?: boolean
  type?: string
  mode?: 'RW' | 'RO'
}

export interface WizardVif {
  device?: string
  networkRef: string
  networkName?: string
  policy?: VmVifPolicy
}

export interface VmWizardPayload {
  templateRef: string
  vmName: string
  vmDescription: string
  vcpus: number
  memoryBytes: number
  installMode: VmInstallMode
  installUrl?: string
  isoRef?: string
  targetHostRef?: string
  targetSrRef?: string
  disks: WizardDisk[]
  vifs: WizardVif[]
  startAfter: boolean
}

// ── VM Import ────────────────────────────────────────────────────────────────

export interface VmExportParams {
  vmRef: string
  filePath: string
  powerState: VmRecord['power_state']
  exportMode: 'shutdown' | 'snapshot' | 'force'
  useCompression?: boolean
}

export interface VmTransferMetrics {
  bytesTransferred: number
  /** Zero when the server has not supplied the real transfer length. */
  bytesTotal: number
  elapsedMs: number
}

export interface VmTransferProgress {
  connectionId?: string
  poolUuid?: string
  cleanupPending?: boolean
  warnings?: string[]
  taskId: string
  progress: number
  status: 'pending' | 'running' | 'cancelling' | 'completed' | 'failed' | 'cancelled' | 'unknown'
  message: string
  bytesTransferred?: number
  bytesTotal?: number
  phase?: 'preparing' | 'transferring' | 'validating' | 'waiting_for_task' | 'cleanup'
  transfer?: VmTransferMetrics
  validation?: VmImportOperation['validation']
  lastUpdatedAt: number
}

export interface VmImportPreviewVif {
  device: string
  sourceNetworkName: string
}

export interface VmImportParams {
  originPoolUuid?: string
  originEpoch?: number
  filePath: string
  srRef: string
  vifMappings: Record<string, string>
  /** Omit to keep the imported placement; null selects the pool without a home server. */
  homeServerRef?: string | null
  /** Optional post-import overrides; normal XVA import preserves archive metadata. */
  nameLabel?: string
  nameDescription?: string
}

export interface VmImportPreview {
  /** XAPI imports a preserved checkpoint as Suspended, with its suspend VDI. */
  powerState?: 'Halted' | 'Suspended'
  suspendDiskSize?: number
  vmName: string
  originalSize: number
  diskCount: number
  exportTime: string
  vifs: VmImportPreviewVif[]
  isTemplate: boolean
  vcpus: number
  memory: number
  isHvm: boolean
  description: string
}

export type VmImportOperationStatus =
  | 'pending'
  | 'validating'
  | 'uploading'
  | 'waiting_for_task'
  | 'unknown'
  | 'cancelling'
  | 'configuring'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface VmImportOperation {
  connectionId?: string
  poolUuid?: string
  operationId: string
  taskRef: string | null
  status: VmImportOperationStatus
  progress: number
  /** Local archive scan, separate from upload/server progress. Bytes use the actual XVA file size. */
  validation?: { bytesChecked: number; bytesTotal: number; elapsedMs: number }
  transfer?: VmTransferMetrics
  message: string
  vmRef?: string
  errorCode?: string
  warnings?: string[]
  lastUpdatedAt: number
}

export interface VmCopyPayload {
  vmRef: string
  newName: string
  nameDescription?: string
  mode?: 'clone' | 'copy' | 'cross-pool-copy'
  targetSrRef?: string
  targetConnectionId?: string
  targetHostRef?: string
  transferNetworkRef?: string
  storageMap?: Record<string, string>
  networkMap?: Record<string, string>
}

export interface VmCopyDisk {
  vdiRef: string
  vbdRef: string
  vmRef: string
  vmName: string
  history: boolean
  suspend: boolean
  device: string
  name: string
  size: number
  srRef: string
}

export interface VmCopyVif {
  vifRef: string
  vmRef: string
  vmName: string
  history: boolean
  device: string
  networkRef: string
  networkName: string
}

export interface VmCopyPlan {
  sourceConnectionId: string
  targetConnectionId: string
  vmRef: string
  sourceUuid: string
  isTemplate: boolean
  powerState: string
  allowedModes: Array<'clone' | 'copy' | 'cross-pool-copy'>
  blockers: string[]
  warnings: string[]
  disks: VmCopyDisk[]
  vifs: VmCopyVif[]
  hosts: Array<{ ref: string; name: string }>
  srs: Array<{ ref: string; name: string; freeBytes: number | null; hostRefs: string[] }>
  networks: Array<{ ref: string; name: string; hostRefs: string[]; transferHostRefs: string[] }>
}

export interface VmCopyOperation {
  id: string
  sourceConnectionId: string
  targetConnectionId: string
  sourcePoolUuid: string
  targetPoolUuid: string
  sourcePoolName: string
  targetPoolName: string
  sourceVmRef: string
  name: string
  isTemplate: boolean
  mode: 'clone' | 'copy' | 'cross-pool-copy'
  status: 'preparing' | 'pending' | 'cancelling' | 'unknown' | 'completed' | 'failed' | 'cancelled'
  progress: number
  message: string
  taskRef?: string
  vmRef?: string
  vmUuid?: string
  warnings: string[]
  cancellable: boolean
  createdAt: number
}

export interface VmDestroyOptions {
  vdiRefs?: string[]
  deleteDisks?: boolean
  intent?: VmPowerIntent
}

export type VmRelocationMode =
  | 'pool-migrate'
  | 'storage-move'
  | 'cross-pool-migrate'
  | 'cross-pool-copy'

export interface VmRelocationBlocker {
  code: string
  message: string
}

export interface VmRelocationDisk {
  vdiRef: string
  vbdRef: string
  nameLabel: string
  size: number
  sourceSrRef: string
  userdevice: string
  bootable: boolean
  mode: string
  type: string
  owner: boolean
}

export interface VmRelocationVif {
  vifRef: string
  device: string
  networkRef: string
  networkName: string
}

export interface VmRelocationPlan {
  sourceConnectionId: string
  targetConnectionId: string
  vmRef: string
  vmName: string
  powerState: VmRecord['power_state']
  allowedModes: VmRelocationMode[]
  blockers: VmRelocationBlocker[]
  warnings: VmRelocationBlocker[]
  disks: VmRelocationDisk[]
  vifs: VmRelocationVif[]
  sourceHosts: ConnectedHostRecord[]
  targetHosts: ConnectedHostRecord[]
  sourceSrs: ConnectedSrRecord[]
  targetSrs: ConnectedSrRecord[]
  sourceNetworks: ConnectedNetworkRecord[]
  targetNetworks: ConnectedNetworkRecord[]
}

export interface VmRelocationPayload {
  mode: VmRelocationMode
  sourceConnectionId: string
  targetConnectionId?: string
  vmRef: string
  targetHostRef?: string
  transferNetworkRef?: string
  storageMap?: Record<string, string>
  networkMap?: Record<string, string>
}

export interface VmRelocationResult {
  copyOperation?: VmCopyOperation
  taskRef?: string
  movedVdis?: string[]
}

// ── Template ──────────────────────────────────────────────────────────────────

export interface TemplateClonePayload {
  templateRef: string
  newName: string
  targetSrRef?: string  // 跨SR复制时使用VM.copy，不提供则使用VM.clone同池复制
}

export interface TemplateDeletePayload {
  templateRef: string
  deleteDisks: boolean  // 是否同时删除关联VDI
}

export interface TemplateSettingsPayload {
  templateRef: string
  nameLabel?: string
  nameDescription?: string
  vcpusMax?: number
  vcpusAtStartup?: number
  memoryStaticMax?: number
  memoryDynamicMax?: number
  memoryDynamicMin?: number
  memoryStaticMin?: number
}

// ── Storage / SR ──────────────────────────────────────────────────────────────

export interface SrRecord {
  ref: string
  uuid: string
  name_label: string
  name_description?: string
  type: string
  content_type?: string
  /** XAPI -1 means capacity has not been measured; it is not zero bytes. */
  physical_size: number
  physical_utilisation: number
  virtual_allocation: number
  VDIs: string[]
  shared: boolean
}

export interface SrIdentity {
  nameLabel: string
  nameDescription: string
}

export interface SrIdentityUpdate extends SrIdentity {
  expectedNameLabel: string
  expectedNameDescription: string
}

export interface ConnectedSrRecord extends SrRecord {
  connectionId: string
  poolName: string
}

export interface VdiRecord {
  ref: string
  uuid: string
  name_label: string
  virtual_size: number
  physical_utilisation: number
  type: string
  SR: string
  read_only: boolean
  /** VBD references associated with this VDI */
  VBDs?: string[]
}

export interface ConnectedVdiRecord extends VdiRecord {
  connectionId: string
  poolName: string
}

export interface VdiAllowedOperations {
  resize: boolean
  create: boolean
  destroy: boolean
  onlineResize: boolean
}

export interface VdiCreateForVmResult {
  vdiRef: string
  vbdRef: string
  plugged: boolean
  warning?: string
}

export interface VdiDeleteResult {
  vdiDeleted: boolean
  detachedVbdRef?: string
  warning?: string
}

export interface VmDestroyResult {
  vmDeleted: true
  failedVdiRefs: string[]
}

export interface VifCreateResult {
  vifRef: string
  plugged: boolean
  warning?: string
}

export interface AttachableVdiRecord extends ConnectedVdiRecord {
  srName: string
  forceReadOnly: boolean
  attachedVmRefs: string[]
}

export interface VdiAttachPayload {
  vmRef: string
  vdiRef: string
  readOnly?: boolean
  userdevice?: string
}

export interface VdiAttachResult {
  vbdRef: string
  plugged: boolean
  warning?: string
}

export interface VdiMovePayload {
  vdiRef: string
  targetSrRef: string
  preferLive?: boolean
}

export interface VdiMoveResult {
  newVdiRef: string
}

export interface VdiResizeParams {
  vdiRef: string
  newSize: number
}

export interface VdiCreateParams {
  nameLabel: string
  nameDescription: string
  srRef: string
  size: number
  type?: 'system' | 'user' | 'iso'
  sharable?: boolean
  readOnly?: boolean
}

export interface VdiCloneParams {
  vdiRef: string
  targetSrRef?: string
  nameLabel?: string
}

export interface VdiCopyParams {
  vdiRef: string
  targetSrRef: string
  nameLabel?: string
}

export interface PbdRecord {
  ref: string
  uuid: string
  host: string
  SR: string
  device_config: Record<string, string>
  currently_attached: boolean
}

export interface ConnectedPbdRecord extends PbdRecord {
  connectionId: string
  poolName: string
}

export interface SrIntroduceParams {
  uuid: string
  nameLabel: string
  nameDescription: string
  type: string
  contentType?: string
  shared?: boolean
}

export interface ThinProvisioningStats {
  physicalSize: number
  physicalUtilisation: number
  virtualAllocation: number
  overprovisionRatio: number
}

// ── Network ───────────────────────────────────────────────────────────────────

export interface NetworkRecord {
  ref: string
  uuid: string
  name_label: string
  name_description: string
  bridge: string
  VIFs: string[]
  PIFs: string[]
  MTU: number
  other_config?: Record<string, string>
  tags?: string[]
  managed?: boolean
  kind?: 'internal' | 'external' | 'bond' | 'vlan' | 'tunnel' | 'sriov'
  linkState?: 'connected' | 'disconnected' | 'unknown'
  linkStatus?: 'connected' | 'disconnected' | 'partial' | 'unknown' | 'none'
  vlan?: number | null
  device?: string | null
  pifRefs?: string[]
  isHidden?: boolean
  isGuestInstallerNetwork?: boolean
  isBond?: boolean
  isBondMember?: boolean
  isVlan?: boolean
  isSriov?: boolean
  isTunnel?: boolean
  canUseJumboFrames?: boolean
  visible?: boolean
  allowedActions?: {
    rename: boolean
    destroy: boolean
  }
}

export interface ConnectedNetworkRecord extends NetworkRecord {
  connectionId: string
  poolName: string
}

export interface PifRecord {
  ref: string
  uuid: string
  device: string
  host: string
  network: string
  IP: string
  MAC: string
  MTU: number
  speed: number
  duplex?: boolean | null
  vlan: number
  physical: boolean
  managed?: boolean
  management?: boolean
  currently_attached?: boolean
  ip_configuration_mode?: string
  netmask?: string
  gateway?: string
  DNS?: string
  metrics?: string
  bond_master_of?: string[]
  bond_slave_of?: string
  VLAN_master_of?: string
  tunnel_access_PIF_of?: string[]
  tunnel_transport_PIF_of?: string[]
  other_config?: Record<string, string>
  disallow_unplug?: boolean
  carrier?: boolean | null
  linkState?: 'connected' | 'disconnected' | 'unknown'
  isPhysicalNic?: boolean
  isBondMaster?: boolean
  isBondMember?: boolean
  isVlan?: boolean
  isPrimaryManagement?: boolean
  isSecondaryManagement?: boolean
  isManagementInterface?: boolean
  isHidden?: boolean
  isTunnelAccess?: boolean
  isTunnelTransport?: boolean
  isSriovLogical?: boolean
  isSriovPhysical?: boolean
  isClusterPif?: boolean
  isBondCandidate?: boolean
  isVlanCandidate?: boolean
}

export interface ConnectedPifRecord extends PifRecord {
  connectionId: string
  poolName: string
}

export interface PifIpConfig {
  mode: 'Static' | 'DHCP' | 'None'
  ip?: string
  netmask?: string
  gateway?: string
  dns?: string
}

export interface VifQosParams {
  algorithmType: string
  algorithmParams: Record<string, string>
}

export interface TunnelRecord {
  ref: string
  uuid: string
  access_PIF: string
  transport_PIF: string
}

export interface ConnectedTunnelRecord extends TunnelRecord {
  connectionId: string
  poolName: string
}

export interface BondRecord {
  ref: string
  uuid: string
  master: string
  slaves: string[]
  mode: string
  properties: Record<string, string>
  other_config?: Record<string, string>
  links_up: number
  network?: string
  devices?: string[]
  masterDevice?: string | null
  hasManagement?: boolean
  hasPrimaryManagement?: boolean
  hasSecondaryManagement?: boolean
  hasClusterPif?: boolean
  connectionId?: string
  poolName?: string
}

export interface VlanRecord {
  ref: string
  uuid: string
  tag: number
  tagged_PIF: string
  untagged_PIF: string
  network: string
  taggedDevice?: string | null
  host?: string | null
  connectionId?: string
  poolName?: string
}

export interface BondCreateParams {
  pifRefs: string[]
  mode?: 'balance-slb' | 'active-backup' | 'lacp'
  networkRef?: string
  nameLabel?: string
  nameDescription?: string
  mtu?: number
  confirmManagementDisruption?: boolean
}

export interface VlanCreateParams {
  taggedPifRef: string
  vlanTag: number
  networkRef?: string
  nameLabel?: string
  nameDescription?: string
  confirmManagementDisruption?: boolean
}

// ── Task ──────────────────────────────────────────────────────────────────────

export interface TaskCancellationResult {
  status: 'success' | 'failure' | 'cancelled'
  message: string
}

export interface TaskRecord {
  ref: string
  uuid: string
  name_label: string
  name_description: string
  status: 'pending' | 'success' | 'failure' | 'cancelling' | 'cancelled'
  progress: number
  created: string
  finished: string
  error_info: string[]
}

export interface ConnectedTaskRecord extends TaskRecord {
  connectionId: string
  poolName: string
}

// ── Batch tasks ─────────────────────────────────────────────────────────────

export type BatchOperationType =
  | 'start'
  | 'stop'
  | 'reboot'
  | 'migrate'
  | 'delete'
  | 'suspend'
  | 'resume'
  | 'snapshot'
  | 'pause'
  | 'unpause'

export type BatchTaskStatus = 'pending' | 'running' | 'cancel-requested' | 'completed' | 'cancelled' | 'unknown'
export type BatchItemStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'cancelled' | 'unknown'

export interface VmPowerIntent {
  vmUuid: string
  poolUuid?: string
  epoch?: number
}

export interface BatchTaskTarget {
  intent?: VmPowerIntent
  connectionId: string
  vmRef: string
  vmName: string
}

export interface BatchTaskOptions {
  force?: boolean
  deleteDisks?: boolean
  targetHostRef?: string
  snapshotName?: string
}

export interface BatchOperationInput {
  requestId: string
  type: BatchOperationType
  targets: BatchTaskTarget[]
  options?: BatchTaskOptions
}

export interface BatchTaskProgress {
  total: number
  completed: number
  failed: number
  unknown?: number
  cancelled?: number
  currentItem?: string
}

export interface BatchTaskItem {
  intent?: VmPowerIntent
  id: string
  taskId: string
  connectionId: string
  vmRef: string
  vmName: string
  status: BatchItemStatus
  error?: string
  startedAt?: number
  completedAt?: number
  retryCount: number
}

export interface BatchTask {
  requestId?: string
  retryRequestIds?: string[]
  id: string
  type: BatchOperationType
  targets: BatchTaskTarget[]
  options?: BatchTaskOptions
  status: BatchTaskStatus
  progress: BatchTaskProgress
  createdAt: number
  startedAt?: number
  completedAt?: number
}

export interface BatchTaskWithItems extends BatchTask {
  items: BatchTaskItem[]
}

export interface BatchOperationResult {
  connectionId?: string
  status?: BatchItemStatus
  vmRef: string
  vmName: string
  success: boolean
  error?: string
}

export interface BatchProgressEvent {
  taskId: string
  status: Exclude<BatchTaskStatus, 'pending'>
  progress: BatchTaskProgress
  currentResult?: BatchOperationResult
}

export interface BatchSubmitResult {
  taskId: string
}

export interface BatchRetryConfirmation {
  requestId: string
  items: Array<{ id: string; retryCount: number }>
}

// ── Profile ───────────────────────────────────────────────────────────────────

export interface ConnectionProfile {
  id: string
  name: string
  host: string
  port: number
  scheme: XapiTransportScheme
  username: string
  lastConnected: string | null
  autoConnect?: boolean
  allowSelfSigned?: boolean
}

// ── Desktop file dialogs ──────────────────────────────────────────────────

export interface FileDialogFilter {
  name: string
  extensions: string[]
}

export type OpenDialogProperty =
  | 'openFile'
  | 'openDirectory'
  | 'multiSelections'
  | 'showHiddenFiles'
  | 'createDirectory'
  | 'promptToCreate'
  | 'noResolveAliases'
  | 'treatPackageAsDirectory'
  | 'dontAddToRecent'

export interface OpenDialogOptions {
  title?: string
  defaultPath?: string
  properties?: OpenDialogProperty[]
  filters?: FileDialogFilter[]
}

export interface OpenDialogResult {
  canceled: boolean
  filePaths: string[]
  bookmarks?: string[]
}

export interface SaveDialogOptions {
  title?: string
  defaultPath?: string
  filters?: FileDialogFilter[]
}

export interface SaveDialogResult {
  canceled: boolean
  filePath: string
  bookmark?: string
}

// ── Alert (XAPI) ──────────────────────────────────────────────────────────────

export interface AlertRecord {
  ref: string
  uuid: string
  name: string
  priority: number
  severity: 'error' | 'warning' | 'info'
  body: string
  timestamp: number
  cls: string
  objUuid: string
}

export interface ConnectedAlertRecord extends AlertRecord {
  connectionId: string
  poolName: string
}

export interface AlertFilters {
  severity?: ('error' | 'warning' | 'info')[]
  since?: number
  until?: number
  objUuid?: string
}

// ── Maintenance ───────────────────────────────────────────────────────────────

export interface MaintenanceStatus {
  hostRef: string
  state: 'enabled' | 'disabled' | 'maintenance'
  runningVms: number
  residentVms: string[]
}

export interface EvacuateResult {
  success: boolean
  migratedVms: string[]
  failedVms: Array<{ vmRef: string; error: string }>
}

// ── SR Probe ──────────────────────────────────────────────────────────────────

export interface NfsTarget {
  server: string
  path: string
}

export interface IscsiTarget {
  iqn: string
  address: string
  port: number
  luns?: IscsiLun[]
}

export interface IscsiLun {
  id: string // SCSIid, not the numeric LUN number
  lunId: string
  size: number
  vendor: string
}

export interface IscsiProbeOptions {
  port?: number
  iqn?: string
  chapUser?: string
  chapPassword?: string
}

export interface SrCreateParams {
  type: 'ext' | 'nfs' | 'iscsi' | 'hba' | 'iso'
  existingSrUuid?: string
  nameLabel: string
  nameDescription: string
  nfsServer?: string
  nfsPath?: string
  iscsiTarget?: string
  iscsiPort?: number
  iscsiIqn?: string
  iscsiLun?: string
  chapUser?: string
  chapPassword?: string
}

export interface VifCreateParams {
  vmRef: string
  networkRef: string
  mac?: string
  mtu?: number
  requestId?: string
}

// ── Metrics ───────────────────────────────────────────────────────────────────

export interface MetricDataPoint {
  /** Missing keys are unavailable observations, not measured zeroes. */
  availableMetrics?: string[]
  timestamp: number
  cpuPercent: number
  memoryPercent: number
  networkRxBytes?: number
  networkTxBytes?: number
  diskReadBytes?: number
  diskWriteBytes?: number
}

export interface VmMetricDataPoint {
  availableMetrics?: string[]
  timestamp: number
  cpuPercent: number
  memoryPercent: number
  memoryUsed?: number
  memoryTotal?: number
  networkRxBytes?: number
  networkTxBytes?: number
  diskReadBytes?: number
  diskWriteBytes?: number
}

export interface MetricStats {
  sampleCount?: number
  current: number
  max: number
  avg: number
  min: number
}

export interface HostMetricsHistory {
  hostRef: string
  hostName: string
  dataPoints: MetricDataPoint[]
}

export interface MetricsCollectionConfig {
  interval: number
  maxDataPoints: number
}

export interface MetricsCollectionOptions {
  interval?: number
  maxDataPoints?: number
}

export interface MetricsRangeParams {
  startTime: number
  endTime: number
  downsample?: 'none' | '1m' | '5m' | '1h'
}

// ── Alert Rules ───────────────────────────────────────────────────────────────

export type MetricType = 'cpu' | 'memory' | 'networkRx' | 'networkTx' | 'diskRead' | 'diskWrite'
export type AlertOperator = '>' | '<' | '>=' | '<='
export type AlertSeverity = 'warning' | 'error'
export type AlertRuleTargetType = 'host' | 'vm'

export interface AlertRule {
  id: string
  name: string
  metricType: MetricType
  operator: AlertOperator
  threshold: number
  duration: number
  severity: AlertSeverity
  enabled: boolean
  connectionId?: string
  targetRef?: string
  targetType?: AlertRuleTargetType
  createdAt: number
  updatedAt: number
}

export interface AlertRuleInput {
  name: string
  metricType: MetricType
  operator: AlertOperator
  threshold: number
  duration: number
  severity: AlertSeverity
  enabled?: boolean
  connectionId?: string
  targetRef?: string
  targetType?: AlertRuleTargetType
}

export type AlertRuleUpdate = Partial<AlertRuleInput>

// ── Alert History ─────────────────────────────────────────────────────────────

export type AlertHistoryStatus = 'active' | 'acknowledged' | 'resolved'

export interface AlertHistoryRecord {
  poolUuid?: string
  id: string
  ruleId: string
  ruleName: string
  connectionId: string
  entityRef: string
  entityName: string
  metricType: MetricType
  metricValue: number
  threshold: number
  severity: AlertSeverity
  triggeredAt: number
  acknowledgedAt?: number
  resolvedAt?: number
  status: AlertHistoryStatus
}

export interface AlertHistoryFilters {
  status?: AlertHistoryStatus[]
  severity?: AlertSeverity[]
  since?: number
  until?: number
  connectionId?: string
}

export interface AlertHistoryCount {
  active: number
  acknowledged: number
  resolved: number
}

// ── Alert notifications ───────────────────────────────────────────────────

export type NotificationChannel = 'email' | 'webhook'
export type NotificationSeverity = 'error' | 'warning' | 'info'

export interface EmailConfig {
  enabled: boolean
  host: string
  port: number
  secure: boolean
  auth: {
    user: string
    pass: string
  }
  from: string
  to: string
  subjectPrefix?: string
}

export interface WebhookConfig {
  enabled: boolean
  url: string
  method?: 'POST' | 'PUT'
  headers?: Record<string, string>
  secret?: string
}

export interface NotificationConfig {
  email: EmailConfig
  webhook: WebhookConfig
  filterSeverities: NotificationSeverity[]
}

export interface DefaultNotificationConfig extends NotificationConfig {
  enabled: boolean
}

export interface NotificationRecord {
  id: string
  ruleName: string
  connectionId: string
  entityRef: string
  entityName: string
  severity: NotificationSeverity
  message: string
  timestamp: number
  channels: NotificationChannel[]
  status: 'sent' | 'failed' | 'unconfirmed'
  error?: string
}

export interface NotificationHistoryFilters {
  since?: number
  until?: number
  severity?: NotificationSeverity
  limit?: number
}

export interface AlertNotificationPayload {
  eventId?: string
  transition?: 'triggered' | 'resolved'
  poolUuid?: string
  ruleName: string
  connectionId: string
  poolName: string
  entityRef: string
  entityName: string
  severity: NotificationSeverity
  message: string
  metricType?: string
  metricValue?: number
  threshold?: number
  timestamp: number
}

export interface AlertNotificationSendResult {
  email: boolean
  webhook: boolean
}

export interface NotificationConfigSaveResult {
  success: true
}

export type NotificationTestArgs =
  | [channel: 'email', config: Partial<EmailConfig>]
  | [channel: 'webhook', config: Partial<WebhookConfig>]

// ── IPC Error ─────────────────────────────────────────────────────────────────

export interface IpcErrorResponse {
  error: true
  message: string
  code?: string
  details?: unknown
}
