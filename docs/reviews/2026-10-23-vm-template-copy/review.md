**虚拟机、模板同池与跨池复制审查（2026-10-23）**

本页保留优化前的审查基线；当前修复状态、验证结果和剩余范围见 [实施记录](implementation.md)。

当前复制能力尚不完整；已经开放的模板同池复制存在结果丢失后重复创建、目标存储列表串池和长任务难以管理等问题。普通 VM 同池复制与跨池复制目前都有前后端保护，不能把预留实现当作已交付功能。

本次检查基于当前未提交工作区，HEAD 为 `7c3e7e6`。未更改应用实现，未操作真实资源池，也未核对已安装应用是否对应本次工作区。报告中的“已复现”指受控组件/服务复现，真实服务器上的发生概率和吞吐量没有实测。原有未提交修改保留。

**实际可用范围**

| 对象/范围 | 当前行为 | 依据 |
| --- | --- | --- |
| 普通 VM 同池快速克隆/完整复制 | 表单可查看，当前无条件禁用；IPC 同样拒绝 | `CopyVmDialog.tsx:234`；`handlers/vm.ts:123` |
| 普通 VM 跨池复制 | 在“迁移/移动 VM”中展示；模式与提交受保护 | `VmRelocateDialog.tsx:14`；`handlers/vm.ts:114` |
| 模板同池复制/跨 SR 复制 | 可提交；不选 SR 调用 VM.clone，选 SR 调用 VM.copy | `CloneTemplateDialog.tsx:95`；`vm.service.ts:925` |
| 用户模板跨池复制 | 未提供目标池选项；重定位服务直接拒绝模板 | `CloneTemplateDialog.tsx:60`；`vm-relocation.service.ts:187` |

前两项是明确的功能缺口，禁用本身是现有产品策略。模板跨池缺失也是功能范围不足。修复时应完成真实操作闭环再开放，单独删除禁用属性不能完成交付。

**对照资料得到的基线**

XenCenter 当前公开文档把 VM 和模板复制放在统一流程中，区分完整复制与快速克隆；完整复制可选择同池或其他池，并在向导中选择目标存储/主机、网络与传输网络。快速克隆依赖存储能力，通常在原 SR 上形成写时复制关系。用户模板和预置系统模板的跨池能力需要分开判断。参考资料 S1、S2。

XO 的同池完整复制最终使用 Async VM.copy；对运行中的 VM，完整复制路径先创建临时快照，再复制并清理快照。跨池复制走流式导出/导入，调用返回新对象身份；模板也进入这一套 copy API。其复制弹窗把完整复制、快速克隆、压缩及批量命名明确列出。这里的产品入口还受 XOA 版本/订阅等条件约束，不能把源码能力等同于每个发行版本都开放。参考 S3、S4、S5。

XenAdmin 官方开源实现使用异步克隆/复制任务并跟踪进度；跨池复制使用 host.migrate_receive + VM.migrate_send(copy=true)。因此，本项目选用主机直传并非协议方向错误。XO 的服务端中转更依赖 XO 节点的带宽，主机直传更依赖源/目标主机之间的连通性；没有实测依据判定哪条路径总是更快。参考 S3、S6、S7。

XenAdmin 开源对照固定于 2023 年的公开提交，不能声称这是 2026 年商业 XenCenter 的完整实现。XO 与 XAPI 源码分别固定于 2026-10-22 和 2026-10-23 的公开提交；具体提交、文件和摘要见 external-sources.json。

**当前可触发的问题**

1. **[P1] 模板复制响应丢失后，界面允许再次创建，可能生成多份副本。**

   [服务](</Volumes/zt/dev/xenadminmodern/src/main/xapi/services/vm.service.ts:925>)只等待同步 VM.clone/VM.copy 返回引用；没有把副本创建记录、任务身份和未确认结果交给界面。[组件](</Volumes/zt/dev/xenadminmodern/src/renderer/src/components/template/CloneTemplateDialog.tsx:95>)将所有异常显示为“复制模板失败”，随后恢复提交。若服务端已经创建但响应中断，用户按提示重试会再创建一份。R01 用“已创建后抛出 ECONNRESET”的受控服务证明两次提交产生两次创建。

   建议通过 Async Task 建立可恢复的创建记录，保留任务/结果引用；区分明确拒绝与结果未确认。无法确认的创建不直接重新提交，也不按名称认领副本，XAPI 允许同名对象。

2. **[P2] 切换模板或资源池后，旧 SR 响应会覆盖当前列表；新池读取失败还会保留旧池 SR。**

   [列表读取](</Volumes/zt/dev/xenadminmodern/src/renderer/src/components/template/CloneTemplateDialog.tsx:46>)没有请求代次或连接身份检查，打开时未清空旧列表，失败时也未失效旧选项。正常操作路径是先在池 A 打开复制弹窗、关闭，再在池 B 打开。R03 复现 B 的正确列表被晚到的 A 响应替换；R04 复现 B 读取失败后仍能选中 A 的 SR，并向 B 提交该引用。

   此处已证明错误展示和错误参数提交，没有证明真实 XAPI 会跨池写入错误仓库。建议以连接代次和模板身份约束读取，切换时清除无效选择，失败提供原地重读。

3. **[P2] 目标 SR 没有按复制能力、连接状态和容量筛选。**

   [下拉框](</Volumes/zt/dev/xenadminmodern/src/renderer/src/components/template/CloneTemplateDialog.tsx:175>)直接列出 storage.listSrs 的结果；[底层读取](</Volumes/zt/dev/xenadminmodern/src/main/xapi/services/storage.service.ts:55>)只排除 type=iso/udev。模板复制服务不查询目标能力。没有 PBD 的仓库、PBD 已断开的仓库、无法创建 VDI 的后端以及空间不足的仓库都可能被列为正常目标。R02 证明无 PBD 且可用空间为 0 的 SR 可以直接提交。

   建议按 SR/SM 的实际能力、接通状态和可读容量显示可用性及具体原因，并在提交前读取新鲜状态。容量估计要区分精简配置、写时复制和完整复制，不能简单把所有后端都按虚拟容量总和硬拦截；最终仍以 XAPI 检查为准。

4. **[P2] 长时间模板复制锁住模态弹窗，缺少可用的进度、后台执行与取消流程。**

   [同步服务调用](</Volumes/zt/dev/xenadminmodern/src/main/xapi/services/vm.service.ts:932>)可能持续很久；[组件](</Volumes/zt/dev/xenadminmodern/src/renderer/src/components/template/CloneTemplateDialog.tsx:108>)在等待期间禁用关闭和取消，只显示“复制中”。[当前 RPC 策略](</Volumes/zt/dev/xenadminmodern/src/main/xapi/client.ts:41>)对同步复制不设无数据截止时间，避免了旧的短超时误报，但也意味着弹窗可能长期等待。R05 复现所有按钮都被禁用。

   这里没有证据证明 Electron 主线程被 CPU 阻塞；问题是模态工作流被锁住且缺少可恢复任务管理。XAPI 支持任务进度和取消能力，应允许用户回到资源页继续工作，并保留任务观察。取消请求也不能立即等同于服务端已经取消。参考 S6、S8。

5. **[P2] VM 复制弹窗的长禁用说明挤压按钮，导致“取消”“复制”竖向换行。**

   [底部布局](</Volumes/zt/dev/xenadminmodern/src/renderer/src/components/vm/CopyVmDialog.tsx:221>)把长说明和操作按钮放在同一条可收缩 flex 行。真实 Chrome 渲染中，按钮高度变为 56px，两个汉字分两行；footer-wrap.json 记录了每个文字的两行坐标。1024、1280、1440 三档都受相同 max-w-md 约束，因此加宽主窗口无法解决。

   建议将可用性原因移到独立说明区域，操作栏按钮禁止收缩和换行。复现截图：

   ![复制按钮被长说明挤压](</Volumes/zt/dev/xenadminmodern/docs/reviews/2026-10-23-vm-template-copy/copy-1024.png>)

6. **[P2] 模板复制把“复制方式”和“复制位置”混在一个下拉框，且缺少源池身份。**

   [当前文字](</Volumes/zt/dev/xenadminmodern/src/renderer/src/components/template/CloneTemplateDialog.tsx:174>)写“同池复制（默认）”，实际表示 VM.clone；选择任意 SR，包括原 SR，则变为 VM.copy。两者都属于同池操作，却可能在耗时、空间占用与快照链上差异很大。用户无法从文字判断正在选择快速克隆还是完整复制。弹窗只显示模板名，统一多池列表中的同名模板也难以确认来源。

   建议像 VM 复制和成熟工具一样明确选择快速克隆/完整复制，位置单独选择；展示源资源池、目标资源池和 SR。复制完成后用已返回的新引用提供查看副本入口，而不是只通知源模板复制成功。

7. **[P2，性能] 复制相关清单读取存在可消除的 N+1 和重复全量请求。**

   [SR 读取](</Volumes/zt/dev/xenadminmodern/src/main/xapi/services/storage.service.ts:58>)先 SR.get_all 再为每个 SR 发 SR.get_record，100 个 SR 就是 101 个 RPC，且 Promise.all 一次性并发。模板快速克隆未选择 SR 也会读取整份列表。复制完成后的 onSuccess=loadTemplates 默认读取所有已连接池的 VM.get_all_records，而非仅源池。

   [重定位计划](</Volumes/zt/dev/xenadminmodern/src/main/xapi/services/vm-relocation.service.ts:241>)在同池时对同一客户端分别读取 source/target 的主机、SR、网络清单，主机指标也重复读取；R09 证明三类 get_all_records 各执行两次。磁盘和网卡记录还按设备串行读取，增加远程往返等待。

   建议使用批量记录、复用同一次计划里的同池清单、按实际需要加载 SR，并只失效相关池。以上是请求数量与调度缺陷；没有真实磁盘传输吞吐量测试，不能据此宣称数据复制速度下降了某个百分比。

8. **[P3] 复制表单的键盘与辅助功能尚不完整。**

   两个复制弹窗的 label 未用 htmlFor/id 关联输入，关闭图标按钮没有可访问名称，表单也没有 form/onSubmit，Enter 无法自然提交。对应源码见 [模板表单](</Volumes/zt/dev/xenadminmodern/src/renderer/src/components/template/CloneTemplateDialog.tsx:144>)和 [VM 表单](</Volumes/zt/dev/xenadminmodern/src/renderer/src/components/vm/CopyVmDialog.tsx:129>)。三档桌面普通内容的边界和滚动正常；未发现需要移动端适配才能解决的问题。

**解除 VM/跨池保护前需要解决的问题**

以下问题位于目前不可提交的 VM/跨池路径中，属于预留实现缺陷；没有在真实资源池执行这些写操作。

9. **[P1] 跨池复制没有覆盖快照历史中的设备和实际传输范围。**

   [预检](</Volumes/zt/dev/xenadminmodern/src/main/xapi/services/vm-relocation.service.ts:138>)只枚举当前 VM 的 Disk VBD 与 VIF；磁盘大小/网络映射界面也只反映当前对象。XAPI migrate_send 会同时处理相关快照及挂起镜像：未显式映射的快照磁盘可能按 snapshot_of 推导，无法推导时落入目标默认 SR；目标没有合适默认 SR 时可能失败。快照中独有、MAC 又无法从当前 VIF 推导的历史网卡会产生 VIF_NOT_IN_MAP。参考 S7、S9。

   具体触发例：VM 曾有两张网卡，创建快照后删除其中一张；当前界面只映射剩余网卡，遗漏快照独有网卡。用户选定一个专用目标 SR，也不能从现有复核区知道哪些历史磁盘将落到默认 SR。

   XenAdmin 开源向导明确追加快照存储映射，并处理快照独有 VIF。应明确复制历史的产品范围，再补全预检、传输映射、容量提示和结果核对；不能简单把当前 VM 的磁盘数当作实际全部范围。

10. **[P2] 跨池预检把运行中的 VM 列为可复制，实际选用的 XAPI 路径要求停机。**

   [getAllowedModes](</Volumes/zt/dev/xenadminmodern/src/main/xapi/services/vm-relocation.service.ts:220>)在跨连接时无条件加入 cross-pool-copy；[提交](</Volumes/zt/dev/xenadminmodern/src/main/xapi/services/vm-relocation.service.ts:428>)直接传 copy=true 并调用 assert_can_migrate。当前 XAPI 源码在没有 force 选项时会拒绝非 Halted 的跨池复制；这里没有实现先快照再复制的准备流程。R06 证明 Running VM 的计划仍允许复制，现有跨池复制单测也以 Running 夹具假定成功，未模拟真实协议限制。

   应对当前直传流程明确要求停机，或者实现独立且清晰的在线复制准备流程。XO 对运行中 VM 的同池完整复制通过临时快照实现，不能把它等同于直接对 Running VM 调用 migrate_send(copy=true)。参考 S1、S3、S9。

11. **[P2] 跨池计划存在晚到响应竞态，并默认把资源映射到目标列表第一项。**

   [计划加载](</Volumes/zt/dev/xenadminmodern/src/renderer/src/components/vm/VmRelocateDialog.tsx:87>)没有失效旧请求。R10 复现目标下拉框仍为 B 池，但晚到的 A 池计划把主机选项换回 A。当前保护阻止跨池写入；解除保护后该状态会提交不一致的目标参数。

   [默认映射](</Volumes/zt/dev/xenadminmodern/src/renderer/src/components/vm/VmRelocateDialog.tsx:46>)把所有磁盘映射到第一项 SR、网卡映射到第一张网络，传输网络和主机也默认第一项。列表未按目标主机验证 PBD/PIF 接入，普通网络与可用于传输的网络共用同一列表。XAPI 可拦截部分不可达配置，但无法判断第一张网络是否符合用户的业务用途。

   应为每次目标/连接代次绑定计划；无法可靠匹配的网络要求主动选择，按主机接入和能力展示目标原因。复核区应列出源/目标池、主机及最终映射，而不是仅显示设备数量。

12. **[P2] 大型跨池复制的任务期限、恢复和结果身份尚不足。**

   [通用任务等待](</Volumes/zt/dev/xenadminmodern/src/main/xapi/services/xapi-task.ts:16>)默认总期限 10 分钟，跨池复制直接复用它。仍在正常传输的大 VM 会被提前报告结果未知。作为规模说明，1 TiB 在理想 1 Gbit/s 链路上传完约需 2.44 小时，这只是理论下限，不是本次带宽测量。

   [结果](</Volumes/zt/dev/xenadminmodern/src/main/xapi/services/vm-relocation.service.ts:439>)虽从 Task 取得目标引用并做部分读回，但最后只返回 taskRef；[IPC 结果契约](</Volumes/zt/dev/xenadminmodern/src/shared/ipc-contracts/vm.ts:640>)也不承载目标 VM 引用/UUID。没有该流程的持久任务恢复记录，无法可靠实现后台跟踪、重启后继续观察、定位副本和已知部分结果展示。复制后源对象的核对仅验证引用仍可读取，没有核对原 UUID 与磁盘关系。

   同池 VM 预留服务还存在另一种部分成功：[copyVm](</Volumes/zt/dev/xenadminmodern/src/main/xapi/services/vm.service.ts:299>)先创建副本，再设置描述；后一步失败会丢失已创建引用并整体报错。此问题目前被 VM 复制保护挡住。

   应为大数据传输设独立任务策略，持续显示真实进度，持久保留源/目标对象和 Task 身份；结果未知时恢复观察，避免重复创建；把“副本已创建，描述未更新”等部分结果明确返回。

**未计入确定缺陷的边界**

R08 证明重定位函数仅用 connectionId 相等判断同池，没有使用 poolUuid。不过连接管理层会按有效主机身份去重，也会处理主节点重定向。本次未证明普通连接流程能够同时建立“同一个池的两个有效连接”，因此这项只列为函数级稳健性边界，不计为已证实的用户缺陷。

VM.clone/VM.copy 保留模板属性属于 XAPI 正常语义；本项目复制模板时没有强行转成普通 VM，这点正确。XAPI 自身会清除系统预置模板标记，因此本次没有把“复制系统模板后仍永远是系统模板”列为问题。参考 S10。

也未将“必须自动修改客户机 hostname/IP/应用身份”列为复制缺陷；这类客户机定制需要明确产品需求，不能仅因成熟管理器提供克隆就推定它们自动完成应用层去重。

**验证与建议顺序**

- 当前相关测试 8 个文件、127 项全部通过。它们证明既有断言仍成立，并不能反证本报告的缺陷。
- 另有 10 项定向受控复现全部通过；“通过”表示问题或能力边界成功重现。R01–R05 为模板当前行为，R06–R07 为预检/模板跨池范围，R08 为未计入确定缺陷的函数边界，R09 为重复读取，R10 为计划竞态。
- UI 使用当前源码原组件、原 Tailwind 配置和模拟 IPC，在独立临时 Chrome 中渲染 1024×720、1280×800、1440×900，另查看 1024×720 跨池完整映射界面。截图不代表真实资源池验收或已安装 Electron 应用行为。
- 测试通过直接 Vitest 在随应用提供的 Node 24.22.1 运行；项目固定版本为 24.22.0，因此本次结果不能称为固定工具链的 npm test 正式门禁。没有执行完整测试集、lint、类型检查、打包或真实资源池 mutation。

建议先修模板复制的任务/结果确认、SR 列表身份和目标能力，再把 VM 与模板接入同一套复制工作流；随后补齐跨池快照范围、停机/在线准备策略、映射与任务恢复，再验证并开放功能。最后处理批量复制、命名规则和完成后定位等效率改进。跨池传输采用直传还是提供中转备选，需要根据目标网络条件和实测吞吐量决定。

**资料索引**

S1 — XenCenter 当前公开文档，Copy VMs and templates：`https://docs.xenserver.com/en-us/xencenter/current-release/vms-copy?lang-switch=true`。本次网页读取器取得了该页正文；本地 HTTP 直访被站点重定向到首页，链接可达性受当前站点路由影响。文档描述产品能力，具体协议结论另与固定源码交叉核对，不能替代现场版本/后端验证。

S2 — XCP-ng 官方 VM 生命周期说明：`https://docs.xcp-ng.org/vms/vm-lifecycle/`，用于核对模板、复制/克隆和运行状态语义。

S3 — XO 源码 `packages/xo-server/src/xapi/index.mjs`，固定提交 `3923756ff5d56871c963616d67fe71b737e498b7`（2026-10-22），重点 `_cloneVm`、`_copyVm`、`remoteCopyVm`：`https://github.com/vatesfr/xen-orchestra/blob/3923756ff5d56871c963616d67fe71b737e498b7/packages/xo-server/src/xapi/index.mjs`。

S4 — 同一 XO 提交的 VM API，clone/copy 支持 VM-template，按池选择本地或远端复制：`https://github.com/vatesfr/xen-orchestra/blob/3923756ff5d56871c963616d67fe71b737e498b7/packages/xo-server/src/api/vm.mjs`。

S5 — 同一 XO 提交的复制弹窗，明确区分复制方式、压缩和命名：`https://github.com/vatesfr/xen-orchestra/blob/3923756ff5d56871c963616d67fe71b737e498b7/packages/xo-web/src/common/xo/copy-vms-modal/index.js`。

S6 — XenAdmin 官方开源提交 `b210cd2c2d8547f5bb48b49d71f17429c7d65e44`（2023-12-13）的 VMCloneAction/VMCopyAction：`https://github.com/xenserver/xenadmin/tree/b210cd2c2d8547f5bb48b49d71f17429c7d65e44/XenModel/Actions/VM`。

S7 — 同一 XenAdmin 提交的跨池动作与向导：`https://github.com/xenserver/xenadmin/blob/b210cd2c2d8547f5bb48b49d71f17429c7d65e44/XenModel/Actions/VM/VMCrossPoolMigrateAction.cs`；`https://github.com/xenserver/xenadmin/tree/b210cd2c2d8547f5bb48b49d71f17429c7d65e44/XenAdmin/Wizards/CrossPoolMigrateWizard`。

S8 — XAPI Task 发布接口，progress、allowed_operations、cancel、status、result：`https://xapi-project.github.io/xen-api/classes/task.html`。

S9 — XAPI 实现，固定提交 `e2d37d9c0949ebdab915c0f4061ac3b0e90341c9`（2026-10-23）的 migrate_send、assert_can_migrate、infer_vif_map、额外 VDI 默认映射：`https://github.com/xapi-project/xen-api/blob/e2d37d9c0949ebdab915c0f4061ac3b0e90341c9/ocaml/xapi/xapi_vm_migrate.ml`。

S10 — 同一 XAPI 提交的克隆与状态实现：`https://github.com/xapi-project/xen-api/blob/e2d37d9c0949ebdab915c0f4061ac3b0e90341c9/ocaml/xapi/xapi_vm_clone.ml`；`https://github.com/xapi-project/xen-api/blob/e2d37d9c0949ebdab915c0f4061ac3b0e90341c9/ocaml/xapi/xapi_vm_lifecycle.ml`。

本次资料访问日为 2026-10-23。可执行复现原稿、测试摘要、源码 SHA-256 和桌面测量数据随本报告保存在同目录。复现原稿保存为 .txt，避免被正常测试收集器误纳入；它们的原始临时路径见配置稿，不属于生产实现。
