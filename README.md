# XenAdmin Modern — XCP-ng 桌面管理客户端

基于 Electron + React 的 XCP-ng/XenServer 桌面管理客户端。能力状态表示已有实现与证据范围，不等同于正式发布或通用兼容认证。

当前源码包版本为 1.2.1。macOS arm64 本地构建使用 ad-hoc 本机签名，未进行 Developer ID 签名或公证，正式发布门禁状态不变。

桌面交互见 [工作流说明](docs/desktop-workflows.md)。2026-10-22 已更新本机应用，并完成两个现有资源池的连接、存储清单、页面稳定性和主机 RRD 采集只读验收，结果与边界见 [验证记录](docs/validation.md)。其他实机验收另行安排，高级操作保留现有保护开关。

基础 VM、虚拟磁盘、网络、快照和模板的当前操作范围见 [基础资源操作](docs/desktop-workflows.md#基础资源操作)，剩余验收见 [验证记录](docs/validation.md)。

---

## 能力与证据状态

状态词汇固定为：`已实现`表示代码路径存在，`受保护`表示 mutation 被门禁阻止，`实验性`表示实现或证据尚未闭环，`已验证`仅用于证据仍有效且声明范围全部通过门槛的能力。完整字段与当前受保护能力见 [`src/shared/evidence-manifest.ts`](src/shared/evidence-manifest.ts)。

| Manifest ID | 能力 | 状态 | 当前范围与边界 |
| --- | --- | --- | --- |
| `connection.manual-multi-pool` | 手动建立管理连接 | 已实现 | 手动建立并同时保持多个管理连接；受控 loopback 覆盖 Published XML-RPC 会话与只读查询契约，两个现有真实资源池完成连接和只读核查；未验证：其他服务器版本、TLS/RBAC 矩阵及远端 mutation |
| `inventory.unified-view` | 统一资源视图 | 已实现 | 多池资源按域保留最近成功记录和错误；旧请求被拒绝；资源池 UUID 变化清除旧池数据；未验证：真实服务器部分权限、网络波动与大量资源矩阵未验收 |
| `connection.health` | 管理连接健康状态 | 实验性 | 连接代次、失联状态、有限次数会话重建；写请求不自动重放；未验证：真实资源池网络故障、主节点变化和跨平台恢复未验收 |
| `connection.auto-restore` | 已保存服务器自动恢复 | 实验性 | 启动按配置 ID 在主进程读取保存凭据并连接；失败可见；已连接配置不重复登录；未验证：真实服务器冷启动、主节点切换、证书策略与跨平台系统凭据存储未验收 |
| `vm.cross-pool-mutations` | 跨资源池 VM 操作 | 受保护 | 跨池复制见 vm.cross-pool-copy；跨池迁移的计划和映射可观察，迁移执行仍受保护；未验证：跨池作用域、部分失败、未知终态和实机 mutation 未验证 |
| `vm.copy` | VM 复制 | 已实现 | 已停止的 VM 和模板支持同池快速克隆、完整复制；持久 Task 观察、源保留及副本映射回读；未验证：真实 XCP-ng 复制、服务器取消清理和重启恢复仍需实机验收；在线复制未实现 |
| `vm.cross-pool-copy` | 跨池复制 | 已实现 | 已停止的 VM 和用户模板支持跨池完整复制，不保留快照历史；传输所需历史设备显式映射、源 Task 独立恢复和当前副本设备核对；未验证：真实 XCP-ng 复制、服务器取消清理和重启恢复仍需实机验收；在线复制未实现 |
| `vm.creation` | VM 创建 | 实验性 | 向导使用明确磁盘计划并核对最终设备，区分 HVM/PV 安装，继承网卡策略；创建完成与后续启动结果分开，未知结果保留对象；未验证：真实系统/用户模板、存储后端及失败清理对象图未验收 |
| `vm.console` | VM 控制台 | 实验性 | 本机回环代理、受控 loopback CONNECT/TLS 契约与 noVNC renderer 骨架；未验证：真实 XCP-ng/XenServer 证书、打包应用交互、窗口重建、取消和 RFB 会话未验证 |
| `xva.transfer` | XVA 导入与导出 | 实验性 | 未压缩内联校验 XVA 的 VM/模板导入导出；后台准备与历史、目标预检、防覆盖保存、归档与结果读回校验；按原池恢复，未知结果继续观察，不重放传输；未验证：同一 XVA 与 XenAdmin 的实机属性比对、真实 XCP-ng/XenServer TLS 与 pool-member redirect、Task/postcondition 恢复、大文件和实机终态 |
| `metrics.monitoring` | 指标与监控 | 实验性 | 按资源池和主机 UUID 读取 RRD、解析官方 xport 增量、精确归属主机和 VM；本地保留有界指标历史，两个现有真实主机完成采样与大归档恢复核查；未验证：其他真实服务器地址与 TLS 拓扑、指标版本矩阵及大量资源性能尚未验收 |
| `patch.mutate` | 补丁 mutation | 受保护 | 只读信息保持可用；renderer 与 IPC mutation 均受保护；未验证：对应批次的 Published contract、恢复语义和实机 mutation 尚未完成 |
| `storage.lifecycle` | 存储仓库生命周期 | 受保护 | 清单、扫描、默认 SR、NFS/iSCSI/NFS ISO 创建及探测到原 UUID 的 iSCSI 保留数据接入；任意注册、分离、销毁受保护；未验证：backend、PBD、VDI、Task、postcondition、partial cleanup 和恢复未验证 |
| `network.lifecycle` | 网络生命周期 | 受保护 | Network 创建、重命名、无 PIF/VIF 网络删除及 VIF 创建、连接、断开、删除已开放；PIF、Tunnel 等高级拓扑 mutation 受保护；未验证：池级拓扑、管理接口、逐主机结果、generation、partial/unknown 和恢复未验证 |
| `host.maintenance` | 主机维护与疏散 | 受保护 | 主机状态、指标和维护状态读取保持可用；生命周期 mutation 受保护；未验证：Task 终态、部分疏散、管理连通性和维护窗口实机验收未完成 |
| `ha.governance` | 高可用治理 | 受保护 | 按官方整数容错和字符串策略读取 HA，主机未知状态显式显示；mutation 保持受保护；未验证：emergency/recovery、未知终态和维护窗口实机验收未完成 |
| `alerts.center` | 告警中心 | 已实现 | 消息、规则和历史；连续采样窗口、跨池事件去重、确认后不重复触发，采样缺失不判定恢复；未验证：真实资源池采样、外部邮件/webhook 接收及长期运行未验收 |
| `platform.cross-platform-runtime` | 跨平台运行 | 实验性 | macOS arm64 本地观察包冷启动；Windows/Linux 仅交叉构建；未验证：Windows/Linux 实机、三平台签名安装和桌面工作流未验证 |
| `release.formal-distribution` | 正式分发 | 受保护 | 无正式分发物；本机 ad-hoc 签名包仅供内部观察；未验证：Developer ID 签名、公证、Gatekeeper、安装、升级和 B1–B8 正式发布门槛均未完成 |

启动与虚拟机页面本轮源码修复见 [工作流说明](docs/desktop-workflows.md#启动与虚拟机页面补充2026-10-22)：启动等待凭据时保持页面可用，采集错误按流程独立恢复，VM 指标归档改为批量保存；VM 列表增加 IP 与搜索，详情操作按常用栏和分组菜单组织。本轮尚未更新已安装 APP，系统钥匙串与现场界面核查边界见 [验证记录](docs/validation.md)。

2026-10-23 本地修复了 XML-RPC 复用连接继承短空闲超时，以及写操作后刷新误用旧清单的问题：活动请求按调用类型设置超时，同步复制、创建和扫描等待服务器结果，写后刷新按资源池和资源类型使旧读取失效并串行补读。行为见 [工作流说明](docs/desktop-workflows.md#真实连接与后台刷新补充2026-10-22)，验证范围见 [验证记录](docs/validation.md)；本次未更新已安装 APP，未执行真实资源池操作。

VM 详情的“网络”页按虚拟网卡设备号显示 Guest Tools 上报的 IPv4 和 IPv6 地址，支持一块网卡上的多个地址并去除重复项。没有上报地址时显示“未上报”；进入该页或点击“刷新”会重新读取地址和虚拟网卡。此展示尚未经过不同 Guest Tools 与真实服务器的实机验证。

VM 详情顶部及概览可独立编辑名称和简介，运行中也可修改；简介支持多行或清空。新增“内存”页查看当前分配、固定容量/动态范围及启动上限，并使用小数 GiB 调整配置。运行中只调整原静态边界内的动态范围，修改启动上限需先关机；入口按 XAPI 当前能力启用。保存只提交变化字段并读回核对；部分保存或未知结果会保留具体提示。当前分配是主机分配容量，不是来宾已用内存；指标不可用时保留配置查看。vCPU 在概览独立编辑。详细行为见 [名称简介与内存](docs/desktop-workflows.md#名称简介与内存)，真实服务器的在线内存调整与 RBAC 仍待实测。

网络对象在主机、VM、网络清单及相关向导中使用统一标识：XAPI 默认网络名按 XenAdmin 方式显示为“Network 0”，自定义网络名保持原样，网络类型和所连主机接口分别标注。物理接口显示为“NIC 0 (eth0)”，VM 接口显示为“Virtual Interface 0”；VLAN 和 Bond 展示实际承载/成员及关联网络。仅名称像 VLAN 的网络会提示“名称像 VLAN，未配置 VLAN 接口”，不计入 VLAN 数量。友好名称保留原始 XAPI 名称供悬停核对；这一展示未经过真实资源池拓扑和桌面窗口的实机验收。

---

## 快速开始

### 系统要求

- Node.js 24.22.0
- npm 11.19.1
- macOS（当前本地观察环境）；Windows / Linux 仅有交叉构建记录，尚无实机运行声明

### 安装步骤

```bash
# 克隆项目
git clone https://github.com/KFC1008611/xenadminmodern.git
cd xenadminmodern

# 校验精确工具链并按 lockfile 安装
npm run verify:toolchain
npm ci
```

项目通过 packageManager、engines 与 .nvmrc 共同固定 Node 24.22.0 / npm 11.19.1。安装、Node/Web typecheck、测试、coverage、lint、bundle 和 B0 观察包都会先执行同一校验；版本不符时输出机器可查的期望/实际指纹并 fail closed。该固定工具链只建立 B1 可复现输入，不提升服务器兼容或正式发布声明。

---

## 环境变量

应用从启动进程读取以下调试变量；`.env.example` 是变量说明，应用不会自动加载 `.env` 文件。

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `LOG_LEVEL` | 主进程日志级别：debug、info、warn、error、silent | 开发模式 debug，其余 info |
| `ELECTRON_ENABLE_LOGGING` | Electron 原生调试日志；开发排查时设为 1 | 不启用 |

XAPI 连接的地址、端口、账号和证书策略通过服务器配置管理。控制台代理仅监听本机回环地址并自动分配端口。服务器密码使用 Electron safeStorage 加密保存，主进程按配置 ID 建立连接；界面不能读取已保存密码。TLS 校验由每个连接的证书选项控制。

---

## 运行方法

### 开发模式

```bash
npm run dev
```

### 构建应用 bundle

```bash
npm run build
```

该命令只生成 main、preload 和 renderer bundle，不执行 package、签名、公证、安装或运行验收，因此不生成正式发布物。

### 检查 Node TypeScript project

```bash
npm run typecheck:node
```

该门禁覆盖 main、preload、shared 与 Electron 构建配置，并在固定工具链不匹配或出现 TypeScript 错误时失败。

### 检查 Web TypeScript project

```bash
npm run typecheck:web
```

该门禁覆盖 renderer 与 shared code，并在固定工具链不匹配、跨进程类型边界失配或出现 TypeScript 错误时失败。

### 运行测试

```bash
npm test
```

默认测试门禁按 `tests/test-collection.json` 对账完整测试文件与用例集合，拒绝 `only`、`skip`、`todo`、未处理 warning/stderr 和收集漂移；最后一行输出包含固定工具链指纹与门禁结果的机器可查 JSON。传入测试文件做聚焦验证时仍执行 only/skip/todo 与 warning/stderr 门禁，但不要求等于全量清单。

Published XML-RPC 契约可通过受控 loopback 协议测试聚焦验证：

```bash
npm test -- tests/unit/published-xmlrpc-contracts.test.ts tests/unit/xapi-xmlrpc-contract.test.ts
```

该证据观察真实 XML-RPC wire request、session 参数顺序、登录窄回退、master redirect 和 envelope；它不代表应用重启、断线重连、真实 XCP-ng/XenServer 版本矩阵、TLS、RBAC、mutation Task/postcondition/未知终态、打包 Electron 应用或未登记 mutation 已验证。

Published HTTP 数据面契约可通过受控 loopback 测试聚焦验证：

```bash
npm test -- \
  tests/unit/published-http-data-plane-contracts.test.ts \
  tests/unit/xapi-http-request.test.ts \
  tests/unit/xapi-http-tls.test.ts \
  tests/unit/rrd-client.service.test.ts \
  tests/unit/xva-http-data-plane.test.ts \
  tests/unit/console-http-contract.test.ts
```

该证据观察真实 HTTP/TLS wire request、redirect、stream 重开、共享执行器 hard deadline、取消意图、RRD、XVA 和 CONNECT 契约；XVA 使用 10 分钟连接/传输空闲期限，正常有活动的传输没有短总时长限制；本地回环覆盖失速与持续活动两种情况。它不代表真实 XCP-ng/XenServer HTTP/TLS 版本矩阵、pool-member 证书、RRD 资源归属、XVA 大文件与可恢复 Task/postcondition、打包 Electron/noVNC/RFB 或任何补丁 mutation 已验证。

XVA 流程和研究依据见 [导入导出规范](docs/xva-transfers.md)。当前支持未压缩内联校验 XVA；压缩、OVA/OVF 和旧式末尾校验表兼容不在本轮范围。

### 运行 coverage

```bash
npm run coverage
```

该门禁统计全部受管 `src/**/*.{ts,tsx}` 产品源码，排除声明和纯类型模块，并按 Safety、Protocol、Renderer UI、Other 分层检查 lines、functions、branches、statements。HTML 与 json-summary 报告写入本地 `coverage/`；该目录被 Git 忽略，并由 electron-builder allowlist 与 package audit 排除。机器结果记录各层阈值、实际值和未验证边界；覆盖率不替代 Published 协议、真实 Electron/打包应用或实机 mutation 证据。

### 运行 lint

```bash
npm run lint
```

该命令显式覆盖受管源码、测试、运行脚本和构建配置，保持零 warning；临时调查文件不属于检查范围。

### 生成本地观察包

```bash
npm run build:win    # Windows
npm run build:mac    # macOS
npm run build:linux  # Linux
```

这些命令的成功只表示 electron-builder 生成了对应产物；未经内容 allowlist、签名、安装和实机门槛的产物只能用于内部观察。

### 生成 B0 macOS 内部观察候选

在要观察的变更已经提交后运行：

```bash
npm run build:b0-observation
```

该命令始终从当前 `HEAD` 的 `git archive` 创建干净源码树，以已跟踪的 `package-lock.json` 执行 `npm ci`，逐项运行 B0 renderer/IPC 门禁回归，生成 allowlisted macOS arm64 包并扫描 ASAR、unpacked、禁止内容和 secret，最后以全新 profile 冷启动真实 renderer 并通过调试协议请求完整退出。成功候选写入 `dist/b0-observation-<commit>/`，其中 `manifest.json` 记录 commit、lockfile、工具链、OS/arch、时间、格式、hash、完整 app 清单、门禁、运行和发布信任结果。

该流程刻意禁用签名自动发现。候选没有 Developer ID 签名、没有 notarization ticket、不通过 Gatekeeper、未安装，也没有 Windows/Linux 实机结果；它只能称为 B0 内部观察包。只读门禁观察页不证明服务器连接、协议兼容或 mutation，B0 完成也不构成 B0–B8 首个正式发布。

---

## 项目结构

```
xenadmin-modern/
├── assets/
│   └── icons/          ← 应用图标源文件与平台导出图标
├── src/
│   ├── main/           ← Electron 主进程（XAPI 连接、IPC 处理）
│   │   ├── xapi/       ← XCP-ng API 客户端与服务层
│   │   │   ├── connection-manager.ts   ← 多连接管理器
│   │   │   ├── client.ts               ← XAPI 客户端
│   │   │   └── services/               ← VM、主机、存储等服务
│   │   ├── ipc/        ← IPC 处理器
│   │   └── profiles/   ← 连接配置持久化
│   ├── renderer/       ← React 前端渲染进程
│   │   └── src/
│   │       ├── components/   ← UI 组件
│   │       │   └── connection/  ← 连接管理 UI
│   │       ├── pages/        ← 页面组件
│   │       ├── store/        ← 状态管理（Zustand）
│   │       └── types/        ← TypeScript 类型定义
│   └── preload/        ← Electron 预加载脚本
├── tests/              ← 单元测试与组件测试套件
├── docs/               ← 桌面行为、验证记录、后续工作与协议参考
└── .env.example        ← 环境变量示例
```

---

## 连接 XCP-ng 服务器

1. 启动应用后，点击左侧边栏资源池区域的 **+ 添加连接**。如果左侧边栏已收起，可直接点击窄栏中的 **+**，或先点击展开按钮恢复完整列表。
2. 明确选择 HTTPS 或 HTTP，并填写 XCP-ng/XenServer 主机的 IP 地址、端口（HTTPS 默认 443）、用户名和密码；协议不再根据端口推断
3. 使用 HTTPS 且服务器采用自签名证书时，开启“信任自签名证书”开关
4. 点击**连接**即可

可重复上述步骤添加多个服务器，所有已连接资源池的资源会聚合显示在各功能页面。

---

## 开发文档

- [桌面交互与批量任务行为](docs/desktop-workflows.md)
- [验证记录与实机验收范围](docs/validation.md)
- [后续工作](docs/roadmap.md)
- [XAPI 快照签名与版本边界](docs/research/xapi-vm-snapshot-signature.md)

---

## 许可证

本项目采用 [MIT License](LICENSE)。第三方依赖遵循各自的许可证。


API实现参考：https://xapi-project.github.io/xen-api/
参考项目：https://github.com/xcp-ng/xenadmin

2026-10-23 的复制优化已进入当前源码：VM 与模板统一复制窗口、明确快速克隆/完整复制和目标池、按主机可达性筛选目标、持久异步任务、未知结果防重复提交和结果定位。支持停机源对象；详细边界、XO/XenAdmin 对照和官方依据见 [复制规范](docs/vm-copy.md)。尚未更新已安装应用或执行真实池复制。

同日合并的模板创建修复统一了磁盘计划、光驱复用、安装方式、容量、CPU 拓扑和网卡策略，见[实现记录](docs/reviews/2026-10-23-vm-template-creation/implementation.md)。[快速创建](docs/vm-quick-create.md)要求 `instant=true`，提供标记启用入口，依次异步 clone、provision 和启动；结果未确认时持久核对已有任务，启动失败保留 VM。实机验收仍待完成。
