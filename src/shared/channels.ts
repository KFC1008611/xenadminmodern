/**
 * IPC Channel Constants — single source of truth for all Electron IPC channel names.
 * Both main process (handlers) and preload (bridge) must reference these constants
 * to prevent typos and enable compile-time refactoring safety.
 *
 * Naming convention: `<domain>:<action>` (kebab-case)
 */

// ============================================================================
// Connection management
// ============================================================================
export const CONNECTION_CONNECT = 'connection:connect'
export const CONNECTION_DISCONNECT = 'connection:disconnect'
export const CONNECTION_LIST = 'connection:list'
export const CONNECTION_RECONNECT = 'connection:reconnect'
export const CONNECTION_GET_INFO = 'connection:getInfo'

// ============================================================================
// Legacy session (backwards compatibility)
// ============================================================================
export const SESSION_CONNECT = 'session:connect'
export const SESSION_DISCONNECT = 'session:disconnect'
export const SESSION_STATUS = 'session:status'

// ============================================================================
// Pool
// ============================================================================
export const POOL_GET = 'pool:get'
export const POOL_ADD_HOST = 'pool:addHost'
export const POOL_REMOVE_HOST = 'pool:removeHost'
export const POOL_TRANSFER_MASTER = 'pool:transferMaster'

// ============================================================================
// Host
// ============================================================================
export const HOST_LIST = 'host:list'
export const HOST_METRICS = 'host:metrics'
export const HOST_ENABLE = 'host:enable'
export const HOST_DISABLE = 'host:disable'
export const HOST_REBOOT = 'host:reboot'
export const HOST_SHUTDOWN = 'host:shutdown'
export const HOST_GET_MAINTENANCE_STATUS = 'host:getMaintenanceStatus'
export const HOST_ENTER_MAINTENANCE = 'host:enterMaintenance'
export const HOST_EXIT_MAINTENANCE = 'host:exitMaintenance'
export const HOST_EVACUATE = 'host:evacuate'

// ============================================================================
// VM — list & lifecycle
// ============================================================================
export const VM_LIST = 'vm:list'
export const VM_START = 'vm:start'
export const VM_SHUTDOWN = 'vm:shutdown'
export const VM_FORCE_SHUTDOWN = 'vm:force-shutdown'
export const VM_REBOOT = 'vm:reboot'
export const VM_PAUSE = 'vm:pause'
export const VM_UNPAUSE = 'vm:unpause'
export const VM_SUSPEND = 'vm:suspend'
export const VM_RESUME = 'vm:resume'
export const VM_DESTROY = 'vm:destroy'
export const VM_SNAPSHOT = 'vm:snapshot'
export const VM_MIGRATE = 'vm:migrate'
export const VM_GET_RELOCATION_PLAN = 'vm:getRelocationPlan'
export const VM_RELOCATE = 'vm:relocate'
export const VM_COPY = 'vm:copy'
export const VM_COPY_PLAN = 'vm:copyPlan'
export const VM_COPY_OPERATIONS = 'vm:copyOperations'
export const VM_CANCEL_COPY = 'vm:cancelCopy'
export const VM_CONSOLE = 'vm:console'
export const VM_TEMPLATES = 'vm:templates'
export const VM_CREATE_FROM_TEMPLATE = 'vm:create-from-template'
export const VM_QUICK_CREATE_FROM_TEMPLATE = 'vm:quick-create-from-template'
export const VM_CREATION_RESOURCES = 'vm:creationResources'

// ============================================================================
// Template
// ============================================================================
export const TEMPLATE_CLONE = 'template:clone'
export const TEMPLATE_DELETE = 'template:delete'
export const TEMPLATE_UPDATE_SETTINGS = 'template:updateSettings'
export const TEMPLATE_ENABLE_INSTANT_CREATE = 'template:enableInstantCreate'

// ============================================================================
// VM — detail & editing
// ============================================================================
export const VM_GET_RECORD = 'vm:getRecord'
export const VM_SET_NAME_LABEL = 'vm:setNameLabel'
export const VM_SET_NAME_DESCRIPTION = 'vm:setNameDescription'
export const VM_SET_VCPUS = 'vm:setVcpus'
export const VM_SET_MEMORY_LIMITS = 'vm:setMemoryLimits'
export const VM_GET_VBDS = 'vm:getVBDs'
export const VM_PLUG_VBD = 'vm:plugVbd'
export const VM_UNPLUG_VBD = 'vm:unplugVbd'
export const VM_DETACH_VBD = 'vm:detachVbd'
export const VM_GET_VIFS = 'vm:getVIFs'
export const VM_GET_CD_DRIVE = 'vm:getCdDrive'
export const VM_MOUNT_ISO = 'vm:mountIso'
export const VM_EJECT_ISO = 'vm:ejectIso'

// ============================================================================
// VM — snapshots
// ============================================================================
export const VM_GET_SNAPSHOTS = 'vm:getSnapshots'
export const VM_REVERT_SNAPSHOT = 'vm:revertSnapshot'
export const VM_DELETE_SNAPSHOT = 'vm:deleteSnapshot'
export const VM_RENAME_SNAPSHOT = 'vm:renameSnapshot'

// ============================================================================
// VM — import/export
// ============================================================================
export const VM_EXPORT = 'vm:export'
export const VM_IMPORT = 'vm:import'
export const VM_IMPORT_GET_PREVIEW = 'vm:importGetPreview'
export const VM_IMPORT_PROGRESS = 'vm:importProgress'
export const VM_IMPORT_CANCEL = 'vm:cancelImport'
export const VM_CANCEL_EXPORT = 'vm:cancelExport'
export const VM_EXPORT_PROGRESS = 'vm:exportProgress'
export const VM_MARK_AS_TEMPLATE = 'vm:markAsTemplate'

// ============================================================================
// Storage / SR
// ============================================================================
export const SR_LIST = 'sr:list'
export const SR_CREATE = 'sr:create'
export const SR_DESTROY = 'sr:destroy'
export const SR_SCAN = 'sr:scan'
export const SR_DETACH = 'sr:detach'
export const SR_SET_DEFAULT = 'sr:setDefault'
export const SR_UPDATE_IDENTITY = 'sr:updateIdentity'
export const SR_PROBE_NFS = 'sr:probeNfs'
export const SR_PROBE_ISCSI = 'sr:probeIscsi'

// ============================================================================
// VDI
// ============================================================================
export const VDI_LIST = 'vdi:list'
export const VDI_CREATE = 'vdi:create'
export const VDI_DESTROY = 'vdi:destroy'
export const VDI_RESIZE = 'vdi:resize'
export const VDI_CREATE_FOR_VM = 'vdi:createForVm'
export const VDI_GET_ALLOWED_OPERATIONS = 'vdi:getAllowedOperations'
export const VDI_LIST_ATTACHABLE = 'vdi:listAttachable'
export const VDI_ATTACH_EXISTING = 'vdi:attachExisting'
export const VDI_MOVE = 'vdi:move'

// ============================================================================
// Network
// ============================================================================
export const NETWORK_LIST = 'network:list'
export const NETWORK_CREATE = 'network:create'
export const NETWORK_DESTROY = 'network:destroy'
export const NETWORK_RENAME = 'network:rename'

// ============================================================================
// PIF
// ============================================================================
export const PIF_LIST = 'pif:list'

// ============================================================================
// VIF
// ============================================================================
export const VIF_CREATE = 'vif:create'
export const VIF_DESTROY = 'vif:destroy'
export const VIF_PLUG = 'vif:plug'
export const VIF_UNPLUG = 'vif:unplug'
export const VIF_MOVE = 'vif:move'
export const VIF_SET_QOS = 'vif:setQos'
export const VIF_CLEAR_QOS = 'vif:clearQos'

// ============================================================================
// Bond
// ============================================================================
export const BOND_LIST = 'bond:list'
export const BOND_CREATE = 'bond:create'
export const BOND_DESTROY = 'bond:destroy'
export const BOND_DESTROY_GROUP = 'bond:destroyGroup'
export const BOND_GET_RECORD = 'bond:getRecord'

// ============================================================================
// VLAN
// ============================================================================
export const VLAN_LIST = 'vlan:list'
export const VLAN_CREATE = 'vlan:create'
export const VLAN_DESTROY = 'vlan:destroy'
export const VLAN_DESTROY_NETWORK = 'vlan:destroyNetwork'
export const VLAN_GET_RECORD = 'vlan:getRecord'

// ============================================================================
// Tunnel
// ============================================================================
export const TUNNEL_LIST = 'tunnel:list'
export const TUNNEL_CREATE = 'tunnel:create'
export const TUNNEL_DESTROY = 'tunnel:destroy'

// ============================================================================
// PIF Advanced
// ============================================================================
export const PIF_RECONFIGURE_IP = 'pif:reconfigureIp'
export const PIF_SCAN = 'pif:scan'
export const PIF_GET_FOR_HOST = 'pif:getForHost'

// ============================================================================
// Network Advanced
// ============================================================================
export const NETWORK_GET_ALLOWED_OPS = 'network:getAllowedOps'
export const NETWORK_ADD_TAG = 'network:addTag'
export const NETWORK_REMOVE_TAG = 'network:removeTag'
export const NETWORK_UPDATE_OTHER_CONFIG = 'network:updateOtherConfig'

// ============================================================================
// Task
// ============================================================================
export const TASK_LIST = 'task:list'
export const TASK_CANCEL = 'task:cancel'

// ============================================================================
// Alerts (XAPI)
// ============================================================================
export const ALERTS_GET_ALL = 'alerts:getAll'
export const ALERTS_DISMISS = 'alerts:dismiss'
export const ALERTS_DISMISS_ALL = 'alerts:dismissAll'

// ============================================================================
// Profiles (local storage)
// ============================================================================
export const PROFILE_LIST = 'profile:list'
export const PROFILE_SAVE = 'profile:save'
export const PROFILE_DELETE = 'profile:delete'
export const PROFILE_HAS_PASSWORD = 'profile:hasPassword'
export const PROFILE_CONNECT = 'profile:connect'

// ============================================================================
// Dialog
// ============================================================================
export const DIALOG_SHOW_OPEN = 'dialog:showOpenDialog'
export const DIALOG_SHOW_SAVE = 'dialog:showSaveDialog'

// ============================================================================
// Console
// ============================================================================
export const CONSOLE_GET_URL = 'console:getUrl'
export const CONSOLE_CLOSE = 'console:close'

// ============================================================================
// Metrics
// ============================================================================
export const METRICS_START_COLLECTION = 'metrics:startCollection'
export const METRICS_STOP_COLLECTION = 'metrics:stopCollection'
export const METRICS_GET_HISTORY = 'metrics:getHistory'
export const METRICS_GET_RANGE = 'metrics:getRange'
export const METRICS_GET_STATS = 'metrics:getStats'
export const METRICS_GET_VM_HISTORY = 'metrics:getVmHistory'
export const METRICS_GET_COLLECTION_ERROR = 'metrics:getCollectionError'

// ============================================================================
// Alert Rules (local operations)
// ============================================================================
export const ALERT_RULES_LIST = 'alertRules:list'
export const ALERT_RULES_CREATE = 'alertRules:create'
export const ALERT_RULES_UPDATE = 'alertRules:update'
export const ALERT_RULES_DELETE = 'alertRules:delete'
export const ALERT_RULES_EVALUATE = 'alertRules:evaluate'

// ============================================================================
// Alert History (local operations)
// ============================================================================
export const ALERT_HISTORY_LIST = 'alertHistory:list'
export const ALERT_HISTORY_ACKNOWLEDGE = 'alertHistory:acknowledge'
export const ALERT_HISTORY_GET_COUNT = 'alertHistory:getCount'

// ============================================================================
// Batch operations
// ============================================================================
export const BATCH_SUBMIT = 'batch:submit'
export const BATCH_CANCEL = 'batch:cancel'
export const BATCH_GET_STATUS = 'batch:getStatus'
export const BATCH_LIST = 'batch:list'
export const BATCH_RETRY = 'batch:retry'

// ============================================================================
// Push events (main → renderer)
// ============================================================================
export const EVENT_ALERT_TRIGGERED = 'alert:triggered'
export const EVENT_BATCH_PROGRESS = 'batch:progress'
export const EVENT_VM_CHANGED = 'vm:changed'

// ============================================================================
// Storage Advanced (v9)
// ============================================================================
export const PBD_LIST = 'pbd:list'
export const PBD_CREATE = 'pbd:create'
export const PBD_PLUG = 'pbd:plug'
export const PBD_UNPLUG = 'pbd:unplug'
export const PBD_DESTROY = 'pbd:destroy'

export const VDI_CLONE = 'vdi:clone'
export const VDI_SNAPSHOT_ADVANCED = 'vdi:snapshot'
export const VDI_COPY = 'vdi:copy'
export const VDI_SET_NAME_LABEL = 'vdi:setNameLabel'
export const VDI_SET_NAME_DESCRIPTION = 'vdi:setNameDescription'
export const VDI_ADD_TAG = 'vdi:addTag'
export const VDI_REMOVE_TAG = 'vdi:removeTag'

export const SR_INTRODUCE = 'sr:introduce'
export const SR_FORGET = 'sr:forget'
export const SR_SET_SHARED = 'sr:setShared'
export const SR_GET_THIN_STATS = 'sr:getThinStats'

export const ISO_LIST = 'iso:list'
export const ISO_LIST_ALL = 'iso:listAll'
export const ISO_DELETE = 'iso:delete'

// ============================================================================
// Alert Notifications (v9)
// ============================================================================
export const ALERT_NOTIFY_CONFIG_GET = 'alertNotify:getConfig'
export const ALERT_NOTIFY_CONFIG_SAVE = 'alertNotify:saveConfig'
export const ALERT_NOTIFY_TEST = 'alertNotify:test'
export const ALERT_NOTIFY_HISTORY = 'alertNotify:history'
export const ALERT_NOTIFY_SEND = 'alertNotify:send'

// ============================================================================
// HA (High Availability) (v9)
// ============================================================================
export const HA_GET_CONFIG = 'ha:getConfig'
export const HA_ENABLE = 'ha:enable'
export const HA_DISABLE = 'ha:disable'
export const HA_COMPUTE_TOLERANCE = 'ha:computeTolerance'
export const HA_PREVENT_RESTARTS = 'ha:preventRestarts'
export const HA_GET_VM_CONFIGS = 'ha:getVmConfigs'
export const HA_SET_VM_PRIORITY = 'ha:setVmPriority'
export const HA_SET_VM_ALWAYS_RUN = 'ha:setVmAlwaysRun'
export const HA_GET_VM_ALWAYS_RUN = 'ha:getVmAlwaysRun'
export const HA_EMERGENCY_MASTER = 'ha:emergencyMaster'
export const HA_RECOVER_SLAVES = 'ha:recoverSlaves'
export const HA_GET_FAILOVER_PLAN = 'ha:getFailoverPlan'

// ============================================================================
// Patch Management (v9)
// ============================================================================
export const PATCH_LIST = 'patch:list'
export const PATCH_GET_RECORD = 'patch:getRecord'
export const PATCH_UPLOAD = 'patch:upload'
export const PATCH_PRECHECK = 'patch:precheck'
export const PATCH_APPLY = 'patch:apply'
export const PATCH_APPLY_TO_HOST = 'patch:applyToHost'
export const PATCH_CLEAN = 'patch:clean'
export const PATCH_DESTROY = 'patch:destroy'
export const PATCH_DESTROY_FROM_HOST = 'patch:destroyFromHost'
export const PATCH_GET_HOST_STATUS = 'patch:hostStatus'
export const PATCH_GET_MISSING = 'patch:getMissing'
export const PATCH_APPLY_BATCH = 'patch:applyBatch'

// ============================================================================
// RBAC User Permissions (v9)
// ============================================================================
export const RBAC_ROLE_LIST = 'rbac:roleList'
export const RBAC_ROLE_GET = 'rbac:roleGet'
export const RBAC_ROLE_PERMISSIONS = 'rbac:rolePermissions'
export const RBAC_SUBJECT_LIST = 'rbac:subjectList'
export const RBAC_SUBJECT_GET = 'rbac:subjectGet'
export const RBAC_SUBJECT_WITH_ROLES = 'rbac:subjectWithRoles'
export const RBAC_SUBJECT_ADD = 'rbac:subjectAdd'
export const RBAC_SUBJECT_REMOVE = 'rbac:subjectRemove'
export const RBAC_SUBJECT_ADD_ROLE = 'rbac:subjectAddRole'
export const RBAC_SUBJECT_REMOVE_ROLE = 'rbac:subjectRemoveRole'
export const RBAC_USER_LIST = 'rbac:userList'
export const RBAC_USER_GET = 'rbac:userGet'
export const RBAC_EXT_AUTH_CONFIG = 'rbac:extAuthConfig'
export const RBAC_JOIN_DOMAIN = 'rbac:joinDomain'
export const RBAC_LEAVE_DOMAIN = 'rbac:leaveDomain'
export const RBAC_SESSION_PERMISSIONS = 'rbac:sessionPermissions'

// ============================================================================
// VM Advanced Features (v9)
// ============================================================================
export const VM_ADV_GET_CONFIG = 'vm:advGetConfig'
export const VM_ADV_GET_ALL_CONFIGS = 'vm:advGetAllConfigs'
export const VM_ADV_SET_AFFINITY = 'vm:advSetAffinity'
export const VM_ADV_GET_AFFINITY = 'vm:advGetAffinity'
export const VM_ADV_SET_ANTI_AFFINITY = 'vm:advSetAntiAffinity'
export const VM_ADV_ADD_ANTI_AFFINITY = 'vm:advAddAntiAffinity'
export const VM_ADV_REMOVE_ANTI_AFFINITY = 'vm:advRemoveAntiAffinity'
export const VM_ADV_ENABLE_PROTECTION = 'vm:advEnableProtection'
export const VM_ADV_DISABLE_PROTECTION = 'vm:advDisableProtection'
export const VM_ADV_SET_VCPU_HOTPLUG = 'vm:advSetVcpuHotplug'
export const VM_ADV_SET_VCPUS_NUMBER = 'vm:advSetVcpusNumber'
export const VM_ADV_SET_START_DELAY = 'vm:advSetStartDelay'
export const VM_ADV_SET_BOOT_ORDER = 'vm:advSetBootOrder'
export const VM_ADV_SET_HVM_BOOT_PARAMS = 'vm:advSetHvmBootParams'
export const VM_ADV_SET_PLATFORM_PARAM = 'vm:advSetPlatformParam'
export const VM_ADV_SET_VIRIDIAN = 'vm:advSetViridian'
export const VM_ADV_SET_OTHER_CONFIG = 'vm:advSetOtherConfig'
export const VM_ADV_ADD_TAG = 'vm:advAddTag'
export const VM_ADV_REMOVE_TAG = 'vm:advRemoveTag'
export const VM_ADV_SET_START_ORDER = 'vm:advSetStartOrder'
