/** Browser-only visual fixture. Uses the real App and routes, never an XAPI connection. */
import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from '../../src/renderer/src/App'
import { initializeTheme } from '../../src/renderer/src/store/theme.store'
import { useMetricsStore } from '../../src/renderer/src/store/metrics.store'
import { useExportPanelStore } from '../../src/renderer/src/store/exportPanel.store'
import '../../src/renderer/src/styles/globals.css'

const GIB = 1024 ** 3
const now = Date.now()
const disconnected = new URLSearchParams(location.search).has('disconnected')
const readError = new URLSearchParams(location.search).has('read-error')
const longNames = new URLSearchParams(location.search).has('long-names')
const emptyData = new URLSearchParams(location.search).has('empty')
const notifyError = new URLSearchParams(location.search).has('notify-error')
const basicManagement = new URLSearchParams(location.search).has('basic-management')
const connections = ['prod', 'lab'].map((id, index) => ({
  id, name: index ? '研发资源池' : '生产资源池', poolName: index ? '研发资源池' : '生产资源池',
  host: `192.0.2.${10 + index}`, poolRef: `pool-${id}`, poolUuid: `pool-uuid-${id}`,
  epoch: 1, state: 'connected' as const, errorMessage: null, connectedAt: now,
}))
const hosts = connections.flatMap((connection, poolIndex) => Array.from({ length: poolIndex ? 2 : 3 }, (_, index) => ({
  ref: `host-${connection.id}-${index}`, uuid: `host-uuid-${connection.id}-${index}`, name_label: `${connection.id}-xcp-${String(index + 1).padStart(2, '0')}`,
  name_description: '', connectionId: connection.id, poolName: connection.poolName, address: `192.0.2.${20 + poolIndex * 10 + index}`,
  enabled: true, memory_total: 128 * GIB, memory_free: (64 + index * 8) * GIB,
  cpu_info: { cpu_count: '32', modelname: 'AMD EPYC 7313', vendor: 'AuthenticAMD' },
  software_version: { product_version: '8.3', product_brand: 'XCP-ng', build_number: 'test' },
  resident_VMs: [], PIFs: [`pif-${connection.id}-${index}`], metrics: '', other_config: {},
})))
const names = ['ubuntu-web-01', 'ubuntu-web-02', 'postgres-primary', 'redis-cache', 'monitoring', 'windows-build', 'nginx-gateway', 'archive-worker', 'dev-api', 'test-runner', 'registry', 'sandbox']
const vms = names.map((name, index) => {
  const connection = connections[index < 8 ? 0 : 1]
  return {
    ref: `vm-${index}`, uuid: `vm-uuid-${index}`, name_label: name, name_description: index === 2 ? '主数据库' : '',
    connectionId: connection.id, poolName: connection.poolName, power_state: [5, 11].includes(index) ? 'Halted' : index === 7 ? 'Paused' : 'Running',
    is_a_template: false, is_a_snapshot: false, is_control_domain: false, VCPUs_max: index === 2 ? 8 : 4, VCPUs_at_startup: 4,
    memory_static_min: 1 * GIB, memory_static_max: 8 * GIB, memory_dynamic_min: 4 * GIB, memory_dynamic_max: 8 * GIB, memory_target: 8 * GIB,
    resident_on: hosts.find((host) => host.connectionId === connection.id)!.ref,
    networks: { '0/ip': `192.0.2.${100 + index}` }, guest_metrics: '', guest_metrics_record: { os_version: { name: 'Ubuntu 24.04 LTS' }, networks: { '0/ip': `192.0.2.${100 + index}` } },
    allowed_operations: ['start', 'clean_shutdown', 'hard_shutdown', 'clean_reboot', 'hard_reboot', 'pause', 'unpause', 'suspend', 'resume', 'snapshot', 'clone', 'copy', 'export', 'destroy', 'changing_VCPUs_live', 'changing_memory_live', 'changing_dynamic_range'],
    current_operations: {}, blocked_operations: {}, VBDs: [], VIFs: [], snapshots: [], other_config: {}, platform: {}, HVM_boot_policy: 'BIOS order', HVM_boot_params: { order: 'cdn' }, PV_bootloader: '', tags: [],
  }
})
const pools = connections.map((connection) => ({
  ref: connection.poolRef, uuid: connection.poolUuid, name_label: connection.poolName, name_description: '',
  connectionId: connection.id, poolName: connection.poolName, master: hosts.find((host) => host.connectionId === connection.id)!.ref,
  default_SR: `sr-${connection.id}`, other_config: {}, ha_enabled: false,
}))
const srs = connections.flatMap((connection) => [{
  ref: `sr-${connection.id}`, uuid: `sr-uuid-${connection.id}`, name_label: connection.id === 'prod' ? '共享存储 · NFS' : '本地存储', name_description: '',
  connectionId: connection.id, poolName: connection.poolName, type: connection.id === 'prod' ? 'nfs' : 'ext', content_type: 'user',
  shared: connection.id === 'prod', physical_size: 4 * 1024 * GIB, physical_utilisation: 1.6 * 1024 * GIB, virtual_allocation: 2.1 * 1024 * GIB,
  VDIs: [], PBDs: [], allowed_operations: ['scan', 'vdi_create'], other_config: {}, sm_config: {},
}])
const networks = connections.flatMap((connection) => ['管理网络', '业务网络', '内部网络'].map((name, index) => ({
  ref: `network-${connection.id}-${index}`, uuid: `network-uuid-${connection.id}-${index}`, name_label: name, name_description: '',
  connectionId: connection.id, poolName: connection.poolName, bridge: `xenbr${index}`, MTU: 1500, kind: index === 2 ? 'internal' : 'external', linkStatus: index === 2 ? 'none' : 'connected',
  PIFs: index === 2 ? [] : hosts.filter((host) => host.connectionId === connection.id).map((host) => `pif-${host.ref}-${index}`),
  VIFs: [], other_config: {}, managed: true,
})))
const pifs = hosts.flatMap((host) => [0, 1].map((index) => ({
  ref: `pif-${host.ref}-${index}`, uuid: `pif-uuid-${host.ref}-${index}`, host: host.ref, device: `eth${index}`, network: `network-${host.connectionId}-${index}`,
  MAC: `02:00:00:00:00:0${index}`, MTU: 1500, VLAN: -1, management: index === 0, currently_attached: true,
  IP: host.address, netmask: '255.255.255.0', gateway: '192.0.2.1', DNS: '192.0.2.1', ip_configuration_mode: 'Static',
  physical: true, bond_master_of: [], bond_slave_of: 'OpaqueRef:NULL', connectionId: host.connectionId, other_config: {},
})))
const tasks = [{ ref: 'task-1', uuid: 'task-uuid-1', name_label: '导出 windows-build', name_description: '', connectionId: 'prod', poolName: '生产资源池', status: 'pending', progress: 0.68, created: new Date(now - 300000).toISOString(), finished: '', allowed_operations: ['cancel'], error_info: [] },
  { ref: 'task-2', uuid: 'task-uuid-2', name_label: '创建快照 · postgres-primary', name_description: '', connectionId: 'prod', poolName: '生产资源池', status: 'success', progress: 1, created: new Date(now - 600000).toISOString(), finished: new Date(now - 500000).toISOString(), allowed_operations: [], error_info: [] }]
const samples = Array.from({ length: 60 }, (_, index) => ({ timestamp: now - (59 - index) * 60000, cpuPercent: 25 + Math.sin(index / 4) * 12 + index / 10, memoryPercent: 48 + Math.sin(index / 10) * 3, networkRxBytes: 7e6 + Math.sin(index / 5) * 2e6, networkTxBytes: 3e6, diskReadBytes: 1e7, diskWriteBytes: 4e6 }))
if (longNames) {
  for (const connection of connections) connection.name = connection.poolName = `资源池-${'long-name-'.repeat(16)}`
  for (const record of [...hosts, ...vms, ...pools, ...srs, ...networks, ...tasks]) {
    record.name_label += `-${'resource-name-'.repeat(16)}`
    record.poolName = connections.find((connection) => connection.id === record.connectionId)!.poolName
  }
}
const scoped = <T extends { connectionId: string }>(records: T[]) => async (id: string) => emptyData ? [] : records.filter((record) => record.connectionId === id)
const empty = async () => []
const noop = async () => undefined
const unsubscribe = () => () => {}
const templates = [{ ...vms[0], ref: 'template-ubuntu', uuid: 'template-uuid', name_label: 'Ubuntu 24.04 LTS', name_description: 'Ubuntu 24.04 · ISO 安装', power_state: 'Halted', is_a_template: true, is_default_template: true, other_config: { default_template: 'true', 'install-methods': 'cdrom' } }]
const userTemplates = [
  { ...templates[0], ref: 'template-ready', uuid: 'template-ready-uuid', name_label: 'Ubuntu 已安装模板', is_default_template: false, other_config: { instant: 'true' } },
  { ...templates[0], ref: 'template-unmarked', uuid: 'template-unmarked-uuid', name_label: '待启用快速创建模板', is_default_template: false, other_config: {} },
  { ...templates[0], ref: 'template-busy', uuid: 'template-busy-uuid', name_label: '正在复制的模板', is_default_template: false, other_config: { instant: 'true' }, current_operations: { 'visual-clone-task': 'clone' } },
]

// Only these explicit reads are supported. No network transport or IPC bridge is installed.
window.xapi = {
  connection: { list: async () => disconnected ? [] : connections },
  profiles: { list: async () => connections.map((connection) => ({ id: connection.id, host: connection.host, name: connection.poolName, port: 443, scheme: 'https:', username: 'root', lastConnected: now })), hasPassword: async () => false },
  vm: {
    list: readError ? async () => { throw new Error('测试：虚拟机清单读取失败') } : scoped(vms), templates: async () => ({ user: emptyData ? [] : userTemplates, system: emptyData ? [] : templates }), copyOperations: empty,
    getRecord: async (_id: string, ref: string) => vms.find((vm) => vm.ref === ref),
    getVIFs: basicManagement ? async (id: string, vmRef: string) => [{ ref: `vif-${vmRef}`, uuid: `vif-uuid-${vmRef}`, VM: vmRef, device: '0', MAC: '02:00:00:00:00:01', network: `network-${id}-0`, currently_attached: true, MTU: 1500 }] : empty,
    getVBDs: empty,
    getAllowedOperations: async () => vms[0].allowed_operations,
    creationResources: async (id: string) => ({ templateDisks: [{ templateVdiRef: '', srRef: `sr-${id}`, device: '0', sizeBytes: 20 * GIB, bootable: true }], templateCdCount: 1, hosts: hosts.filter((host) => host.connectionId === id).map((host) => ({ ref: host.ref, name: host.name_label, enabled: true, memoryFree: host.memory_free, cpuCount: 32 })), srs: srs.filter((sr) => sr.connectionId === id).map((sr) => ({ ref: sr.ref, name: sr.name_label, type: sr.type, uuid: sr.uuid, isDefault: true, freeBytes: 2 * 1024 * GIB, shared: sr.shared, hostRefs: hosts.filter((host) => host.connectionId === id).map((host) => host.ref) })), networks: networks.filter((network) => network.connectionId === id).map((network) => ({ ref: network.ref, name: network.name_label, autoPlug: true, hostRefs: hosts.filter((host) => host.connectionId === id).map((host) => host.ref) })), isos: [{ ref: 'visual-iso', name: 'ubuntu-24.04.iso', srRef: 'visual-iso-sr', hostRefs: hosts.filter((host) => host.connectionId === id).map((host) => host.ref) }] }),
    getSnapshots: empty, getCdDrive: async () => ({ vbdRef: 'cd-0', vdiRef: null, empty: true }),
    exportProgress: async () => ({ status: 'running', connectionId: 'prod', progress: 68, bytesTransferred: 6.8 * GIB, bytesTotal: 10 * GIB, message: '正在传输' }),
  },
  iso: { listAll: empty },
  console: { getUrl: async () => { throw new Error('离线界面检查未连接控制台') }, close: noop },
  ha: { getConfig: async (id: string) => ({ enabled: false, allowOvercommit: false, plannedRepeats: 0, heartbeatSRs: [], hosts: [], connectionId: id, poolName: connections.find((connection) => connection.id === id)?.poolName }), getVmConfigs: empty, computeTolerance: async () => ({ canHandleHostFailures: 0, vmsThatCouldBeRestarted: null, vmsThatWouldNotBeRestarted: null }), getFailoverPlan: async () => ({ vmsByPriority: [], canTolerateFailures: 0 }) },
  vmAdvanced: { getConfig: async (_id: string, vmRef: string) => ({ vmRef, vmName: 'ubuntu-web-01', affinity: null, antiAffinity: [], isProtected: false, vcpusHotplug: false, startDelay: 0, bootOrder: 'cdn', hvmBootParams: {}, otherConfig: {}, platform: {} }), getAffinity: async (_id: string, vmRef: string) => ({ vmRef, hostRef: null, antiAffinityRefs: [] }) },
  host: { list: scoped(hosts), getMaintenanceStatus: async () => ({ state: 'enabled', runningVms: [] }) },
  storage: { listSrs: scoped(srs), listVdis: empty, listAttachableVdis: empty, listPbds: empty, getSr: async (_id: string, ref: string) => srs.find((sr) => sr.ref === ref) },
  network: { list: scoped(networks), listPifs: scoped(pifs) },
  bond: { list: empty }, vlan: { list: empty }, tunnel: { list: empty }, pbd: { list: empty },
  sr: { getThinStats: async () => ({ physicalSize: 4 * 1024 * GIB, physicalUtilisation: 1.6 * 1024 * GIB, virtualAllocation: 2.1 * 1024 * GIB, overprovisionRatio: 0.525, freePhysical: 2.4 * 1024 * GIB }) },
  patch: { list: empty, getHostStatus: empty },
  pool: { get: async (id: string) => pools.find((pool) => pool.connectionId === id) },
  tasks: { list: scoped(tasks) },
  metrics: { getRange: async () => samples, getStats: async () => ({ current: 42, avg: 36, min: 20, max: 68, sampleCount: 60 }), getVmHistory: async () => samples, getHistory: async () => [], getCollectionError: async () => null, startCollection: noop },
  batch: { list: empty },
  rbac: { subjectWithRoles: empty, subjectList: empty, roleList: empty, extAuthConfig: async () => ({ configured: false, consistent: true, type: '', service_name: '', hosts: [] }) },
  alertNotify: { getConfig: async () => { if (notifyError) throw new Error('测试：通知配置读取失败'); return { enabled: true, email: { enabled: false, host: '', port: 587, secure: false, auth: { user: '', pass: '' }, from: '', to: '' }, webhook: { enabled: false, url: '', method: 'POST' }, filterSeverities: ['error', 'warning'] } } },
  alerts: { getAll: empty }, alertRules: { list: empty }, alertHistory: { list: empty },
  onVmChanged: unsubscribe, onAlertTriggered: unsubscribe, onBatchProgress: unsubscribe,
} as unknown as Window['xapi']

useMetricsStore.setState({ collecting: true, startCollection: () => {}, stopCollection: () => {}, history: new Map(hosts.map((host) => [`${host.connectionId}:${host.ref}`, samples])) })
useExportPanelStore.setState({ tasks: disconnected ? [] : [{ exportId: 'visual-export', vmName: 'windows-build', connectionId: 'prod', status: 'running', progress: 68, bytesTransferred: 6.8 * GIB, bytesTotal: 10 * GIB, message: '正在传输', filePath: '/tmp/windows-build.xva', startedAt: now - 300000 }], })
initializeTheme()
document.documentElement.classList.toggle('platform-macos', /Mac/i.test(navigator.platform))
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><App /></HashRouter></React.StrictMode>)
