export const CAPABILITY_STATUSES = ['implemented', 'guarded', 'experimental', 'verified'] as const

export type CapabilityStatus = (typeof CAPABILITY_STATUSES)[number]
export type EvidenceResult = 'passed' | 'failed' | 'missing'

export const CAPABILITY_STATUS_LABELS: Record<CapabilityStatus, string> = {
  implemented: '已实现',
  guarded: '受保护',
  experimental: '实验性',
  verified: '已验证',
}

export interface CapabilityClaim {
  id: string
  title: string
  declaredStatus: CapabilityStatus
  supportedScope: string
  batch: `B${number}`
  retainedGate: string | null
  sourceCommit: string
  artifactIdentity: string | null
  environmentFingerprint: string
  evidenceAt: string
  evidenceExpiresAt: string | null
  passedGates: string[]
  unverifiedBoundaries: string[]
  evidenceResult: EvidenceResult
  guardReason?: string
}

declare const __XENADMIN_SOURCE_COMMIT__: string | undefined

const INVESTIGATION_BASELINE = '74d04556e74afc61ce4c71f3a5cc530d5af377a6'
const EVIDENCE_SOURCE_COMMIT = typeof __XENADMIN_SOURCE_COMMIT__ === 'string'
  && /^[0-9a-f]{40}$/.test(__XENADMIN_SOURCE_COMMIT__)
  ? __XENADMIN_SOURCE_COMMIT__
  : INVESTIGATION_BASELINE
const EVIDENCE_AT = '2026-10-20T20:00:00+08:00'
const LOCAL_ENVIRONMENT = 'macOS arm64 local implementation; Node 24.22.0; npm 11.19.1; Electron 44.9.1; real hypervisor acceptance pending'

type ClaimInput = Omit<
  CapabilityClaim,
  | 'sourceCommit'
  | 'artifactIdentity'
  | 'environmentFingerprint'
  | 'evidenceAt'
  | 'evidenceExpiresAt'
>
  & { artifactIdentity?: string | null; evidenceAt?: string }

function claim<const T extends ClaimInput>(input: T): CapabilityClaim & T {
  return {
    sourceCommit: EVIDENCE_SOURCE_COMMIT,
    artifactIdentity: null,
    environmentFingerprint: LOCAL_ENVIRONMENT,
    evidenceAt: EVIDENCE_AT,
    evidenceExpiresAt: null,
    ...input,
  }
}

const CLAIMS = [
  claim({
    id: 'connection.manual-multi-pool',
    title: '手动建立管理连接',
    declaredStatus: 'implemented',
    supportedScope: '手动建立并同时保持多个管理连接；受控 loopback 覆盖 Published XML-RPC 会话与只读查询契约，两个现有真实资源池完成连接和只读核查',
    batch: 'B3',
    retainedGate: '真实资源池版本矩阵与断线后的写结果仍需实机核对',
    passedGates: ['G1', 'G2-published-xmlrpc-loopback'],
    unverifiedBoundaries: ['其他服务器版本、TLS/RBAC 矩阵及远端 mutation'],
    evidenceResult: 'passed',
  }),
  claim({
    id: 'connection.auto-restore',
    title: '已保存服务器自动恢复',
    declaredStatus: 'experimental',
    supportedScope: '启动按配置 ID 在主进程读取保存凭据并连接；失败可见；已连接配置不重复登录',
    batch: 'B3',
    retainedGate: '恢复失败必须可见且旧 generation 必须被拒绝',
    passedGates: ['G-local-profile-connection', 'G-local-connection-generations'],
    unverifiedBoundaries: ['真实服务器冷启动、主节点切换、证书策略与跨平台系统凭据存储未验收'],
    evidenceResult: 'passed',
  }),
  claim({
    id: 'connection.health',
    title: '管理连接健康状态',
    declaredStatus: 'experimental',
    supportedScope: '连接代次、失联状态、有限次数会话重建；写请求不自动重放',
    batch: 'B3',
    retainedGate: '真实网络故障与主节点变化仍需验收',
    passedGates: ['G-local-connection-generations'],
    unverifiedBoundaries: ['真实资源池网络故障、主节点变化和跨平台恢复未验收'],
    evidenceResult: 'passed',
  }),
  claim({
    id: 'inventory.unified-view',
    title: '统一资源视图',
    declaredStatus: 'implemented',
    supportedScope: '多池资源按域保留最近成功记录和错误；旧请求被拒绝；资源池 UUID 变化清除旧池数据',
    batch: 'B3',
    retainedGate: '真实服务器数据规模与权限矩阵待验收',
    passedGates: ['G1'],
    unverifiedBoundaries: ['真实服务器部分权限、网络波动与大量资源矩阵未验收'],
    evidenceResult: 'passed',
  }),
  claim({
    id: 'dashboard.overview',
    title: '仪表盘',
    declaredStatus: 'implemented',
    supportedScope: '当前资源池、主机、VM、存储、告警与指标摘要界面',
    batch: 'B8',
    retainedGate: '摘要不替代资源池作用域、陈旧和部分读取状态',
    passedGates: ['G1'],
    unverifiedBoundaries: ['packaged 状态矩阵与部分读取表达尚未验证'],
    evidenceResult: 'passed',
  }),
  claim({
    id: 'host.inventory',
    title: '主机清单与详情',
    declaredStatus: 'implemented',
    supportedScope: '主机只读清单、概览和当前状态展示',
    batch: 'B3',
    retainedGate: '治理 mutation 仍受 B7 证据边界约束',
    passedGates: ['G1'],
    unverifiedBoundaries: ['断线 generation、部分读取与参考服务器矩阵尚未闭环'],
    evidenceResult: 'passed',
  }),
  claim({
    id: 'vm.inventory',
    title: 'VM 与模板清单',
    declaredStatus: 'implemented',
    supportedScope: 'VM、用户模板和系统模板的清单、搜索与资源池筛选',
    batch: 'B3',
    retainedGate: '稳定身份和陈旧 generation 尚未闭环',
    passedGates: ['G1'],
    unverifiedBoundaries: ['跨资源池同名对象、部分读取和重连恢复尚未验证'],
    evidenceResult: 'passed',
  }),
  claim({
    id: 'vm.power',
    title: 'VM 电源操作',
    declaredStatus: 'experimental',
    supportedScope: '单项与批量电源操作共用新鲜能力检查、Async Task 和最终电源状态核对；不重放未知结果',
    batch: 'B4',
    evidenceAt: '2026-10-22T15:04:10+08:00',
    retainedGate: '真实资源池和跨重启恢复仍需验收',
    passedGates: ['G-local-power-preflight', 'G-local-task-postcondition', 'G-local-power-ui'],
    unverifiedBoundaries: ['真实资源池版本/RBAC 矩阵、单项跨重启账本及实机 mutation 尚未验收'],
    evidenceResult: 'passed',
  }),
  claim({
    id: 'vm.high-impact-power',
    title: '高影响 VM 电源操作',
    declaredStatus: 'experimental',
    supportedScope: '单项和批量正常重启、强制关机；确认影响后读取新鲜 VM 能力，观察 Async Task 并核对 VM UUID、连接代次及最终电源状态；未知结果不自动重放',
    batch: 'B4',
    evidenceAt: '2026-10-22T15:04:10+08:00',
    retainedGate: '真实资源池、RBAC、断线与跨重启恢复仍需验收',
    passedGates: ['G-local-power-preflight', 'G-local-task-postcondition', 'G-local-power-ui'],
    unverifiedBoundaries: ['真实 XCP-ng/XenServer mutation、跨重启的单项操作账本和专用 VM failure matrix 尚未验收'],
    evidenceResult: 'passed',
  }),
  claim({
    id: 'vm.configuration',
    title: 'VM 计算配置',
    declaredStatus: 'experimental',
    supportedScope: '独立编辑 VM 名称和简介、停机 vCPU 编辑；查看实际内存分配及静态/动态边界，按新鲜 XAPI 能力调整运行中动态范围或停机启动上限，保存后读回核对',
    batch: 'B4',
    retainedGate: '等待新鲜能力、Task 和 postcondition 复核',
    passedGates: ['G1'],
    unverifiedBoundaries: ['真实服务器在线 ballooning、RBAC、版本矩阵、vCPU 部分失败及跨重启/断线恢复未验证'],
    evidenceResult: 'failed',
  }),
  claim({
    id: 'vm.devices.storage',
    title: 'VM 虚拟磁盘与光驱',
    declaredStatus: 'experimental',
    supportedScope: 'ISO 与 VBD 多步骤失败后读取实际状态；磁盘创建失联时保留可能已连接的 VDI；部分读取不冒充完整列表',
    batch: 'B4',
    retainedGate: '真实后端与快照链仍需验收',
    passedGates: ['G1'],
    unverifiedBoundaries: ['非拥有磁盘、失败清理、Task 和实机 mutation 未验证'],
    evidenceResult: 'failed',
  }),
  claim({
    id: 'vm.devices.network',
    title: 'VM 虚拟网卡',
    declaredStatus: 'experimental',
    supportedScope: '虚拟网卡创建按持久请求身份核对原对象；连接、断开、删除响应丢失时读取实际状态；VIF.move 保留网卡身份换网',
    batch: 'B4',
    retainedGate: '等待资源池归属、逐步结果和网络拓扑保护',
    passedGates: ['G1'],
    unverifiedBoundaries: ['多步 partial/unknown、generation 和实机 mutation 未验证'],
    evidenceResult: 'failed',
  }),
  claim({
    id: 'vm.snapshots',
    title: 'VM 快照',
    declaredStatus: 'experimental',
    supportedScope: '创建、回滚、重命名和删除 VM 快照的实现路径',
    batch: 'B4',
    retainedGate: '等待统一删除、Task 与 postcondition 语义',
    passedGates: ['G1'],
    unverifiedBoundaries: ['数据清理、未知终态和实机 mutation 未验证'],
    evidenceResult: 'failed',
  }),
  claim({
    id: 'vm.template-snapshot-delete',
    title: 'VM 模板与快照删除',
    declaredStatus: 'experimental',
    supportedScope: '用户模板可删除且默认保留关联磁盘；快照按独占 RW 磁盘关系删除并报告残留',
    batch: 'B4',
    retainedGate: '无全局门禁；XAPI 对象能力未知或磁盘归属不明时按对象拒绝/保留',
    passedGates: ['G1-service-regression', 'G2-ipc-contract'],
    unverifiedBoundaries: ['共享/快照链关系、断线后的 partial/unknown 恢复和实机删除未验证'],
    evidenceResult: 'failed',
  }),
  claim({
    id: 'vm.advanced-settings',
    title: 'VM 高级设置',
    declaredStatus: 'experimental',
    supportedScope: '保护、亲和、启动、平台和标签设置的现有表面',
    batch: 'B4',
    retainedGate: '半成品或 unsupported mutation 不得视为可用',
    passedGates: ['G1'],
    unverifiedBoundaries: ['Anti-Affinity、运行态能力和参考服务器 mutation 未闭环'],
    evidenceResult: 'failed',
  }),
  claim({
    id: 'vm.cross-pool-mutations',
    title: '跨资源池 VM 操作',
    declaredStatus: 'guarded',
    supportedScope: '跨池复制见 vm.cross-pool-copy；跨池迁移的计划和映射可观察，迁移执行仍受保护',
    batch: 'B4',
    retainedGate: '等待稳定资源池身份、新鲜能力和主进程复核',
    passedGates: ['G1-renderer-guard', 'G2-ipc-guard'],
    unverifiedBoundaries: ['跨池作用域、部分失败、未知终态和实机 mutation 未验证'],
    evidenceResult: 'passed',
    guardReason: '跨资源池迁移暂不可用',
  }),
  claim({
    id: 'vm.creation',
    title: 'VM 创建',
    declaredStatus: 'experimental',
    supportedScope: '向导使用明确磁盘计划并核对最终设备，区分 HVM/PV 安装，继承网卡策略；创建完成与后续启动结果分开，未知结果保留对象',
    batch: 'B4',
    retainedGate: '真实模板与存储后端对象图验收待完成',
    passedGates: ['G1'],
    unverifiedBoundaries: ['真实系统/用户模板、存储后端及失败清理对象图未验收'],
    evidenceResult: 'failed',
  }),
  claim({
    id: 'vm.console',
    title: 'VM 控制台',
    declaredStatus: 'experimental',
    supportedScope: '本机回环代理、受控 loopback CONNECT/TLS 契约与 noVNC renderer 骨架',
    batch: 'B5',
    retainedGate: '等待打包 Electron、WebSocket 和真实 RFB 握手证据',
    passedGates: ['G1', 'G2-published-console-loopback'],
    unverifiedBoundaries: ['真实 XCP-ng/XenServer 证书、打包应用交互、窗口重建、取消和 RFB 会话未验证'],
    evidenceResult: 'failed',
  }),
  claim({
    id: 'template.management',
    title: 'VM 模板管理',
    declaredStatus: 'experimental',
    supportedScope: '模板复制、设置、删除与生成；instant 资格及启用、异步快速创建并启动、未确认结果持久核对',
    batch: 'B4',
    retainedGate: '等待统一模板删除与真实创建闭环',
    passedGates: ['G1'],
    unverifiedBoundaries: ['模板删除数据语义、跨存储复制和实机创建未验证'],
    evidenceResult: 'failed',
  }),
  claim({
    id: 'xva.transfer',
    title: 'XVA 导入与导出',
    declaredStatus: 'experimental',
    supportedScope: '未压缩内联校验 XVA 的 VM/模板导入导出；后台准备与历史、目标预检、防覆盖保存、归档与结果读回校验；按原池恢复，未知结果继续观察，不重放传输',
    batch: 'B5',
    retainedGate: '真实大文件、存储后端及跨池重定向仍需验收',
    passedGates: ['G1', 'G2-published-http-xva-loopback'],
    unverifiedBoundaries: ['同一 XVA 与 XenAdmin 的实机属性比对、真实 XCP-ng/XenServer TLS 与 pool-member redirect、Task/postcondition 恢复、大文件和实机终态'],
    evidenceResult: 'failed',
  }),
  claim({
    id: 'vm.relocation',
    title: 'VM 复制与重定位',
    declaredStatus: 'guarded',
    supportedScope: '单台 VM 同池主机迁移等待 Task 终态并核对驻留主机；VM 与模板复制使用持久异步任务；停机存储移动和跨池迁移执行仍受保护',
    batch: 'B6',
    retainedGate: '停机存储移动及跨池迁移等待完整映射、Task 终态和恢复验证',
    passedGates: ['G1-renderer-guard', 'G2-ipc-guard'],
    unverifiedBoundaries: ['完整映射、源保留、Task/postcondition、partial/unknown 和不可自动重放未验证'],
    evidenceResult: 'passed',
    guardReason: '停机存储移动及跨池迁移暂不可用',
  }),
  claim({
    id: 'vm.pool-migrate',
    title: '同池主机迁移',
    declaredStatus: 'guarded',
    supportedScope: '单台 VM 按 XAPI 允许操作迁移并核对 Task 终态及目标主机；批量迁移受保护',
    batch: 'B6',
    retainedGate: '批量迁移等待逐台目标主机能力、Task 终态和 postcondition',
    passedGates: ['G1-renderer-guard', 'G2-ipc-guard'],
    unverifiedBoundaries: ['真实资源池目标主机、断线后 Task 恢复与批量迁移未验证'],
    evidenceResult: 'passed',
    guardReason: '批量同池主机迁移暂不可用',
  }),
  claim({
    id: 'vm.copy',
    title: 'VM 复制',
    declaredStatus: 'implemented',
    supportedScope: '已停止的 VM 和模板支持同池快速克隆、完整复制；持久 Task 观察、源保留及副本映射回读',
    batch: 'B6',
    evidenceAt: '2026-10-23T14:00:00+08:00',
    retainedGate: '仅支持停机源对象；依赖 XAPI 当前能力及目标主机可达性预检',
    passedGates: ['G1-local-regression'],
    unverifiedBoundaries: ['真实 XCP-ng 复制、服务器取消清理和重启恢复仍需实机验收；在线复制未实现'],
    evidenceResult: 'passed',
  }),
  claim({
    id: 'vm.cross-pool-migrate',
    title: '跨池迁移',
    declaredStatus: 'guarded',
    supportedScope: '跨池迁移计划和映射可观察；执行受保护',
    batch: 'B6',
    retainedGate: '等待完整映射、源移除语义和 Task 终态',
    passedGates: ['G1-renderer-guard', 'G2-ipc-guard'],
    unverifiedBoundaries: ['完整映射、源移除、Task/postcondition、partial/unknown 和不可自动重放未验证'],
    evidenceResult: 'passed',
    guardReason: '跨池迁移暂不可用',
  }),
  claim({
    id: 'vm.cross-pool-copy',
    title: '跨池复制',
    declaredStatus: 'implemented',
    supportedScope: '已停止的 VM 和用户模板支持跨池完整复制，不保留快照历史；传输所需历史设备显式映射、源 Task 独立恢复和当前副本设备核对',
    batch: 'B6',
    evidenceAt: '2026-10-23T14:00:00+08:00',
    retainedGate: '仅支持停机源对象；依赖 XAPI 当前能力及目标主机可达性预检',
    passedGates: ['G1-local-regression'],
    unverifiedBoundaries: ['真实 XCP-ng 复制、服务器取消清理和重启恢复仍需实机验收；在线复制未实现'],
    evidenceResult: 'passed',
  }),
  claim({
    id: 'ui.dark-theme',
    title: '桌面深色主题',
    declaredStatus: 'implemented',
    supportedScope: '桌面三档尺寸、可滚动对话框、键盘焦点限制和固定操作列，已通过真实 React 浏览器回归',
    batch: 'B8',
    retainedGate: null,
    passedGates: ['G-local-desktop-1024-1280-1440'],
    unverifiedBoundaries: ['Windows/Linux 原生窗口及全功能打包交互未验收'],
    evidenceResult: 'passed',
  }),
  claim({
    id: 'storage.lifecycle',
    title: '存储仓库生命周期',
    declaredStatus: 'guarded',
    supportedScope: '清单、扫描、默认 SR、NFS/iSCSI/NFS ISO 创建及探测到原 UUID 的 iSCSI 保留数据接入；任意注册、分离、销毁受保护',
    batch: 'B6',
    retainedGate: '等待 backend 能力、持久阶段结果和恢复证据',
    passedGates: ['G1-renderer-guard', 'G2-ipc-guard'],
    unverifiedBoundaries: ['backend、PBD、VDI、Task、postcondition、partial cleanup 和恢复未验证'],
    evidenceResult: 'passed',
    guardReason: '存储仓库分离与销毁暂不可用',
  }),
  claim({
    id: 'storage.pbd-iso',
    title: '物理存储连接与 ISO 库',
    declaredStatus: 'guarded',
    supportedScope: '物理存储连接、ISO 和精简配置只读信息保持可用；接入中断和 ISO 删除受保护',
    batch: 'B6',
    retainedGate: '等待资源池归属、使用关系、阶段结果与数据保留语义',
    passedGates: ['G1-renderer-guard', 'G2-ipc-guard'],
    unverifiedBoundaries: ['资源池/SR 归属、使用关系、Task、postcondition、partial/unknown 和恢复未验证'],
    evidenceResult: 'passed',
    guardReason: '存储接入变更和 ISO 删除暂不可用',
  }),
  claim({
    id: 'storage.vdi',
    title: '虚拟磁盘管理',
    declaredStatus: 'experimental',
    supportedScope: '虚拟磁盘创建、查询、元数据、扩容、同池 SR 移动和独占停机磁盘删除已开放',
    batch: 'B6',
    retainedGate: '无全局门禁；共享、快照、归属不明或非停机磁盘按对象拒绝',
    passedGates: ['G1-service-regression', 'G2-ipc-contract'],
    unverifiedBoundaries: ['真实 backend、磁盘链关系、部分清理和实机 mutation 未验证'],
    evidenceResult: 'failed',
  }),
  claim({
    id: 'vdi.resize',
    title: '虚拟磁盘扩容',
    declaredStatus: 'experimental',
    supportedScope: '按 VDI.allowed_operations 选择离线或在线扩容，跟踪 Task 并核对最终容量',
    batch: 'B6',
    retainedGate: '无全局门禁；XAPI 不允许时按对象阻止',
    passedGates: ['G1-service-regression', 'G2-ipc-contract'],
    unverifiedBoundaries: ['真实 XCP-ng/XenServer 版本和存储 backend、断线后的 Task 恢复与实机扩容未验证'],
    evidenceResult: 'failed',
  }),
  claim({
    id: 'vdi.move',
    title: '虚拟磁盘移动',
    declaredStatus: 'experimental',
    supportedScope: '同池 SR 移动等待 Async.VDI.pool_migrate Task 终态并核对新 VDI 所在 SR，保留原有 VBD 关系',
    batch: 'B6',
    retainedGate: '无全局门禁；目标 SR 未连接或 VDI 忙碌时按对象拒绝',
    passedGates: ['G1-service-regression', 'G2-ipc-contract'],
    unverifiedBoundaries: ['目标 SR backend 兼容性、断线后 Task 恢复和实机迁移未验证'],
    evidenceResult: 'failed',
  }),
  claim({
    id: 'network.lifecycle',
    title: '网络生命周期',
    declaredStatus: 'guarded',
    supportedScope: 'Network 创建、重命名、无 PIF/VIF 网络删除及 VIF 创建、连接、断开、删除已开放；PIF、Tunnel 等高级拓扑 mutation 受保护',
    batch: 'B6',
    retainedGate: 'PIF、Tunnel 等高级拓扑变更等待资源池级拓扑、管理接口和多主机阶段结果',
    passedGates: ['G1-renderer-guard', 'G2-ipc-guard'],
    unverifiedBoundaries: ['池级拓扑、管理接口、逐主机结果、generation、partial/unknown 和恢复未验证'],
    evidenceResult: 'passed',
    guardReason: '高级网络拓扑变更暂不可用',
  }),
  claim({
    id: 'network.bond-vlan',
    title: '网卡绑定与 VLAN',
    declaredStatus: 'guarded',
    supportedScope: '只读拓扑保留；受保护底层新增全池 PIF 检查、管理/HA保护和部分结果保留',
    batch: 'B6',
    retainedGate: '等待池级拓扑和管理接口保护',
    passedGates: ['G1-renderer-guard', 'G2-ipc-guard'],
    unverifiedBoundaries: ['池级拓扑、管理接口、逐主机结果、generation、partial/unknown 和恢复未验证'],
    evidenceResult: 'passed',
    guardReason: '网卡绑定与 VLAN 变更暂不可用',
  }),
  claim({
    id: 'host.maintenance',
    title: '主机维护与疏散',
    declaredStatus: 'guarded',
    supportedScope: '主机状态、指标和维护状态读取保持可用；生命周期 mutation 受保护',
    batch: 'B7',
    retainedGate: '等待完整阶段机、维护窗口和带外恢复',
    passedGates: ['G1-renderer-guard', 'G2-ipc-guard'],
    unverifiedBoundaries: ['Task 终态、部分疏散、管理连通性和维护窗口实机验收未完成'],
    evidenceResult: 'passed',
    guardReason: '主机维护、疏散和电源操作暂不可用',
  }),
  claim({
    id: 'ha.governance',
    title: '高可用治理',
    declaredStatus: 'guarded',
    supportedScope: '按官方整数容错和字符串策略读取 HA，主机未知状态显式显示；mutation 保持受保护',
    batch: 'B7',
    retainedGate: '等待单一 Published API 代际和灾难恢复阶段机',
    passedGates: ['G1-renderer-guard', 'G2-ipc-guard'],
    unverifiedBoundaries: ['emergency/recovery、未知终态和维护窗口实机验收未完成'],
    evidenceResult: 'passed',
    guardReason: '高可用配置变更暂不可用',
  }),
  claim({
    id: 'pool.governance',
    title: '资源池治理',
    declaredStatus: 'guarded',
    supportedScope: '成员主机与当前主节点只读信息保持可用；协调 mutation 受保护',
    batch: 'B7',
    retainedGate: '加入、移出和主节点转移等待完整阶段机',
    passedGates: ['G1-renderer-guard', 'G2-ipc-guard'],
    unverifiedBoundaries: ['疏散、Task、管理连通性、恢复和维护窗口 mutation 未验证'],
    evidenceResult: 'passed',
    guardReason: '资源池主节点与协调配置变更暂不可用',
  }),
  claim({
    id: 'patch.management',
    title: '补丁观察与管理',
    declaredStatus: 'implemented',
    supportedScope: '按 host_patch.pool_patch 关联读取各主机已装补丁；不支持的更新写操作明确拒绝；mutation 保持受保护',
    batch: 'B7',
    retainedGate: 'patch.mutate 双层门禁保持生效',
    passedGates: ['G1'],
    unverifiedBoundaries: ['Published API 代际、上传、应用、Task 和维护窗口未验证'],
    evidenceResult: 'passed',
  }),
  claim({
    id: 'rbac.management',
    title: '权限与外部认证管理',
    declaredStatus: 'guarded',
    supportedScope: '按 host 外部认证字段和 session.rbac_permissions 读取；权限/部分配置错误可见；身份 mutation 保持受保护',
    batch: 'B7',
    retainedGate: 'Subject、角色差异和外部认证 mutation 等待完整阶段结果',
    passedGates: ['G1-renderer-guard', 'G2-ipc-guard'],
    unverifiedBoundaries: ['角色差异、Subject 删除、secret 边界和目录服务 mutation 未验证'],
    evidenceResult: 'passed',
    guardReason: '用户或用户组移除及角色变更暂不可用',
  }),
  claim({
    id: 'tasks.xapi',
    title: 'XAPI 任务',
    declaredStatus: 'experimental',
    supportedScope: '任务列表、取消入口和当前 Task service 路径',
    batch: 'B5',
    retainedGate: '取消仅是请求，必须等待权威终态和 postcondition',
    passedGates: ['G1'],
    unverifiedBoundaries: ['优先级、断线、取消终态、重启恢复和参考服务器 Task 未验证'],
    evidenceResult: 'failed',
  }),
  claim({
    id: 'batch.tasks',
    title: '批量任务',
    declaredStatus: 'experimental',
    supportedScope: '仅批量启动、正常关闭、正常重启、挂起和从挂起恢复；提交去重、全部活动任务、确认后重试明确失败项、持久增量日志与重启不重放',
    batch: 'B5',
    retainedGate: '真实资源池批量执行与崩溃时序待验收',
    passedGates: ['G-local-batch-lifecycle'],
    unverifiedBoundaries: ['真实资源池批量 mutation、断线和应用异常退出矩阵未验收'],
    evidenceResult: 'passed',
  }),
  claim({
    id: 'batch.vm-delete',
    title: '批量 VM 删除',
    declaredStatus: 'guarded',
    supportedScope: '已退出批量操作范围；仅保留旧任务记录，不允许新建或重试批量删除',
    batch: 'B4',
    retainedGate: '删除需要逐台核对磁盘，统一批量任务不执行删除',
    passedGates: ['G1-renderer-guard', 'G2-ipc-guard'],
    unverifiedBoundaries: ['逐盘默认不选、拥有磁盘、partial/unknown 与不可自动重放尚未完成'],
    evidenceResult: 'passed',
    guardReason: '批量删除虚拟机不受支持，请逐台核对后删除',
  }),
  claim({
    id: 'metrics.monitoring',
    title: '指标与监控',
    declaredStatus: 'experimental',
    supportedScope: '按资源池和主机 UUID 读取 RRD、解析官方 xport 增量、精确归属主机和 VM；本地保留有界指标历史，两个现有真实主机完成采样与大归档恢复核查',
    batch: 'B5',
    retainedGate: '真实资源池地址/TLS、指标缺口与版本矩阵待验收',
    passedGates: ['G1', 'G2-published-http-rrd-loopback'],
    unverifiedBoundaries: ['其他真实服务器地址与 TLS 拓扑、指标版本矩阵及大量资源性能尚未验收'],
    evidenceResult: 'failed',
  }),
  claim({
    id: 'alerts.center',
    title: '告警中心',
    declaredStatus: 'implemented',
    supportedScope: '消息、规则和历史；连续采样窗口、跨池事件去重、确认后不重复触发，采样缺失不判定恢复',
    batch: 'B5',
    retainedGate: '真实采集与通知通道待验收',
    passedGates: ['G1'],
    unverifiedBoundaries: ['真实资源池采样、外部邮件/webhook 接收及长期运行未验收'],
    evidenceResult: 'passed',
  }),
  claim({
    id: 'alerts.persistence',
    title: '告警持久性与通知送达',
    declaredStatus: 'experimental',
    supportedScope: '规则、历史和通知尝试持久保存；通知配置系统加密，失联或崩溃的通知不自动重发',
    batch: 'B5',
    retainedGate: '真实邮件/webhook与跨平台凭据存储待验收',
    passedGates: [],
    unverifiedBoundaries: ['真实 SMTP/webhook 送达、跨平台系统凭据存储与长期运行未验收'],
    evidenceResult: 'failed',
  }),
  claim({
    id: 'platform.cross-platform-runtime',
    title: '跨平台运行',
    declaredStatus: 'experimental',
    supportedScope: 'macOS arm64 本地观察包冷启动；Windows/Linux 仅交叉构建',
    batch: 'B8',
    retainedGate: '各平台需独立签名、安装、首启和实机验收',
    passedGates: ['G4-macos-cold-start'],
    unverifiedBoundaries: ['Windows/Linux 实机、三平台签名安装和桌面工作流未验证'],
    evidenceResult: 'failed',
    artifactIdentity: 'app.asar:sha256:49a17b157b0afa73a2317d985b80c8a47c61c72e590e1b5a768810cca39ab4a1',
  }),
  claim({
    id: 'desktop.window-lifecycle',
    title: '桌面窗口生命周期',
    declaredStatus: 'experimental',
    supportedScope: 'macOS 关闭窗口再创建后恢复主进程连接与 VM/告警/批量推送目标；真实 Electron 回环验证通过',
    batch: 'B8',
    retainedGate: 'Windows/Linux 原生窗口生命周期待验收',
    passedGates: ['G-local-electron-window-rebuild'],
    unverifiedBoundaries: ['Windows/Linux 实机、系统退出及真实长任务恢复矩阵未验收'],
    evidenceResult: 'passed',
    artifactIdentity: 'app.asar:sha256:49a17b157b0afa73a2317d985b80c8a47c61c72e590e1b5a768810cca39ab4a1',
  }),
  claim({
    id: 'feedback.operations',
    title: '错误与操作反馈',
    declaredStatus: 'experimental',
    supportedScope: '错误反馈、陈旧资源提示、部分成功和 unknown、导出面板重开与批量结果查看',
    batch: 'B8',
    retainedGate: '真实资源池多流程组合与跨平台交互待验收',
    passedGates: ['G1'],
    unverifiedBoundaries: ['跨窗口、应用重启、部分成功和结果未知的统一表达未验证'],
    evidenceResult: 'failed',
  }),
  claim({
    id: 'build.application-bundle',
    title: '应用 bundle 构建',
    declaredStatus: 'implemented',
    supportedScope: 'npm run build 生成 main、preload 和 renderer bundle',
    batch: 'B0',
    retainedGate: 'bundle 不是可分发安装包或正式发布物',
    passedGates: ['bundle-build'],
    unverifiedBoundaries: ['类型检查、package 内容、签名、公证、安装与运行验收不由该命令证明'],
    evidenceResult: 'passed',
  }),
  claim({
    id: 'release.formal-distribution',
    title: '正式分发',
    declaredStatus: 'guarded',
    supportedScope: '无正式分发物；本机 ad-hoc 签名包仅供内部观察',
    batch: 'B8',
    retainedGate: 'B0-B8、签名、公证、Gatekeeper、安装和声明对账全部完成前不得发布',
    passedGates: [],
    unverifiedBoundaries: ['Developer ID 签名、公证、Gatekeeper、安装、升级和 B1–B8 正式发布门槛均未完成'],
    evidenceResult: 'missing',
    guardReason: 'B0–B8 发布门槛尚未完成，当前产物不得作为正式发布物',
  }),
  ...([
    ['pool.join', '资源池加入', 'B7', '主机加入资源池暂不可用'],
    ['pool.eject', '主机移出资源池', 'B7', '主机移出资源池暂不可用'],
    ['patch.mutate', '补丁 mutation', 'B7', '补丁上传与应用暂不可用'],
    ['rbac.subject-create', 'Subject 创建', 'B7', '添加用户或用户组暂不可用'],
    ['rbac.external-auth', '外部认证 mutation', 'B7', '外部认证配置变更暂不可用'],
    ['sr.ext-create', 'EXT 存储仓库创建', 'B6', '创建本地 EXT 存储暂不可用'],
    ['sr.hba-create', 'HBA 存储仓库创建', 'B6', '创建 HBA 存储暂不可用'],
    ['vm.storage-move', '停机存储移动', 'B6', '停机存储移动暂不可用'],
  ] as const).map(([id, title, batch, guardReason]) => claim({
    id,
    title,
    declaredStatus: 'guarded',
    supportedScope: '只读信息保持可用；renderer 与 IPC mutation 均受保护',
    batch,
    retainedGate: guardReason,
    passedGates: ['G1-renderer-guard', 'G2-ipc-guard'],
    unverifiedBoundaries: ['对应批次的 Published contract、恢复语义和实机 mutation 尚未完成'],
    evidenceResult: 'passed',
    guardReason,
  })),
]

const CLAIMS_BY_ID: ReadonlyMap<string, CapabilityClaim> = new Map(
  CLAIMS.map((entry) => [entry.id, entry]),
)

export type CapabilityClaimId = (typeof CLAIMS)[number]['id']

function missingClaim(id: string): CapabilityClaim {
  return {
    id,
    title: '未知能力',
    declaredStatus: 'guarded',
    supportedScope: '无；能力证据缺失或无效',
    batch: 'B0',
    retainedGate: '证据恢复并完成安全复核前保持关闭',
    sourceCommit: INVESTIGATION_BASELINE,
    artifactIdentity: null,
    environmentFingerprint: LOCAL_ENVIRONMENT,
    evidenceAt: EVIDENCE_AT,
    evidenceExpiresAt: null,
    passedGates: [],
    unverifiedBoundaries: ['缺少可用的 capability evidence manifest 条目'],
    evidenceResult: 'missing',
    guardReason: '无法确认此操作的支持情况，暂不可用',
  }
}

export function getAllCapabilityClaims(): CapabilityClaim[] {
  return CLAIMS.map((entry) => ({ ...entry }))
}

export function getCapabilityClaim(id: CapabilityClaimId): CapabilityClaim {
  const entry = CLAIMS_BY_ID.get(id)
  if (!entry) throw new Error(`Unknown capability claim: ${id}`)
  return { ...entry }
}

export function getCapabilityClaimSafely(id: string): CapabilityClaim {
  try {
    const entry = CLAIMS_BY_ID.get(id)
    if (!entry || !Array.isArray(entry.unverifiedBoundaries)) return missingClaim(id)
    return { ...entry }
  } catch {
    return missingClaim(id)
  }
}

export function evaluateClaimStatus(
  claim: CapabilityClaim,
  now = new Date(),
): CapabilityStatus {
  try {
    if (!CAPABILITY_STATUSES.includes(claim.declaredStatus)) return 'guarded'
    if (claim.declaredStatus !== 'verified') return claim.declaredStatus

    const expiresAt = claim.evidenceExpiresAt
      ? new Date(claim.evidenceExpiresAt).getTime()
      : Number.NaN
    const evidenceIsCurrent = Number.isFinite(expiresAt) && expiresAt >= now.getTime()
    const evidenceCoversClaim = Array.isArray(claim.passedGates)
      && claim.passedGates.length > 0
      && Array.isArray(claim.unverifiedBoundaries)
      && claim.unverifiedBoundaries.length === 0

    return claim.evidenceResult === 'passed' && evidenceIsCurrent && evidenceCoversClaim
      ? 'verified'
      : 'experimental'
  } catch {
    return 'guarded'
  }
}
