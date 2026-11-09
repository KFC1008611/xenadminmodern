# VM 与模板复制规范（2026-10-23）

本文描述当前源码。它不代表已安装应用已更新，也不代表真实 XCP-ng/XenServer 的版本、存储和 RBAC 矩阵已经验收。

## 支持范围

VM 列表和用户模板菜单使用同一个复制窗口。源池与对象名称始终可见；目标池可选择当前已连接的资源池。

| 方式 | 条件与结果 |
| --- | --- |
| 同池快速克隆 | 源对象停机，XAPI 允许 `clone`；调用 `Async.VM.clone`，新磁盘仍在原 SR，利用后端 CoW 能力。保留源对象，不复制快照历史。 |
| 同池完整复制 | 源对象停机，XAPI 允许 `copy`；明确选择目标 SR，调用 `Async.VM.copy`。新磁盘写入所选 SR，不复制快照历史。 |
| 跨池完整复制 | 源 VM 或用户模板停机，XAPI 允许 `migrate_send`；明确选择目标主机、传输网络，以及当前和历史设备的 SR/业务网络映射。主机直接传输，源对象及其快照保留，目标副本不保留 VM 快照历史。 |

运行、暂停、挂起的源 VM 在当前流程中提示先正常关闭。在线快照复制、在线跨池准备、vGPU 映射、压缩和跨池磁盘格式转换尚未实现。XAPI 系统模板不允许 `migrate_send` 时，跨池执行被新鲜能力预检拒绝。同池模板副本保持模板属性，不添加快速创建标记。

跨池复制要求源对象当前光驱没有挂载 ISO。XAPI 的 `migrate_send(copy=true)` 仍可能弹出源介质，客户端因此在预检中指出光驱设备并拒绝提交；用户手动弹出后重新读取预检。后台提交前再次读取光驱状态，避免预检后插入介质被无提示弹出。空光驱可正常跨池复制，同池快速克隆与完整复制不受此条件限制。历史快照的光驱不按当前光驱拦截，但仍核对源端保留关系。

跨池迁移和停机整机存储移动保留原有执行保护；批量迁移不在支持范围。跨池复制使用独立的持久复制流程。

## 预检与映射

窗口每次打开、切换源对象、切换目标池、源池或目标池的连接身份变化、显式重读时都会清空旧目标与映射。无关资源池重连不清空当前映射，也不重新读取预检。旧请求完成后不再更新新窗口；当前预检读取失败时不能使用旧清单提交。复制方式和目标存储分开选择，Enter 提交表单，所有字段关联可访问标签。

预检没有允许的复制方式时，显示具体阻止原因、保留重读入口并禁用开始按钮，不显示其他复制分支的方式与存储控件。

目标资源通过批量 `get_all_records` 读取；每类清单一次请求。主机需要 enabled 且 live。SR 必须允许创建 VDI、有连接到可用主机的 PBD，且已知可用空间不为零。快速克隆也检查原 SR 可写。容量为 -1 时显示未知；不会把虚拟磁盘容量之和当作 thin/CoW 的实际空间需求硬性拒绝，最终由 XAPI/存储后端判断。

跨池 SR 选项按目标主机已连接的 PBD 筛选。业务网络按目标主机已连接的 PIF 筛选；无 PIF 的内部网络可用于来宾，但不能用于主机传输。传输网络必须在目标主机连接且有 IP 配置。目标主机改变后清空原映射；不自动选择第一项业务网络。

跨池计划枚举 VM 及其所有快照的磁盘、网卡，以及快照的挂起镜像。共享的 VDI 引用只有一个目标 SR 映射；历史独有设备仍必须明确映射。提交时主进程重新读取能力、主机连接和设备关系，拒绝缺项、多余旧引用及不可达目标，然后执行 `VM.assert_can_migrate`。

历史设备映射用于 XAPI 的传输处理，不代表副本拥有可恢复的 VM 快照历史。`copy=true` 的元数据导入设置 `send_snapshots=false`；底层仍处理历史 VDI 和挂起镜像、解析历史 VIF 映射。当前客户端不按名称搜索、认领或清理这些可能由后端产生的存储对象。

## 任务与结果

`vm:copy` 返回已受理的本地操作对象，不再返回“复制已完成”的 VM 引用。兼容的 `template:clone` 也返回该操作对象。`vm:copyPlan`、`vm:copyOperations`、`vm:cancelCopy` 提供预检、只读观察及原任务取消。严格 IPC 契约、preload 和 renderer 声明保持一致。

复制提交前，在应用数据目录的 `vm-copies.json` 保存操作 ID、原池 UUID、源对象 UUID、源设备关系、计划及映射。目标接收令牌不落盘。任务响应取得后立即保存 Task 引用。相同源池和源 UUID 存在未确认操作时不会再提交第二次复制。

Async 请求发出前先持久保存 `issued=true`。重启时，`issued=false` 且没有 Task 或副本身份的非终态记录确认成“复制尚未提交”，持久记为失败并允许用户重新发起，不自动提交。已经越过提交边界或含有服务器身份的记录继续核对；即使旧记录的 `issued` 标记与服务器身份不一致，也不会按未提交处理。

当前窗口仍对应提交时的源目标身份时，任务受理后关闭窗口；右上角“任务通知”中的复制任务持续提供进度、源目标池、Task 引用和结果定位。提交期间源池或目标池重连会使原表单结果过期，但请求结束后仍解除提交状态，允许关闭和重新预检。关闭、切换源对象或重新打开窗口会解除旧请求对当前表单的控制；旧请求受理的任务仍进入后台面板，不关闭新窗口、不显示旧表单错误，也不解除新请求的等待状态。

关闭或隐藏面板不终止任务。观察以服务器 Task 为准；正常 pending 不受通用十分钟等待上限影响。短暂读取失败显示具体状态读取故障并继续观察，不重发复制请求。重启后只观察原 Task；连接 ID 改变时仅根据相同池 UUID 重新绑定。原池身份不匹配时不使用旧引用。已完成记录的“查看副本”和完成后的列表刷新同样校验目标池 UUID；原连接 ID 被其他池复用时禁用定位，原池以新连接重新接入后可继续定位。

源 Task 的进度、取消与失败/取消后的 Task 清理只依赖原源池连接。目标管理连接断开不阻止这些操作。源 Task 成功后先持久保存副本引用，再等待原目标池恢复进行结果核对；目标离线期间显示具体目标池读取故障，不清理成功 Task、不重发复制。读 Task 后、请求取消前和结果核对时均校验相应池 UUID 与 client 身份。

服务器报告成功后，读回副本引用与 UUID、类型、电源状态，核对副本的当前磁盘容量、设备及 SR/网络映射，并检查源 UUID 和源设备关系仍保留；跨池还核对源快照及历史设备关系仍在。目标副本不要求保留快照历史，也不以快照数量相同作为成功条件。同池副本不能继续引用原 VDI 对象。副本创建后名称/描述设置失败保留副本与成功结果，单独记录警告，不把副本丢失成可盲目重试的失败。

源设备关系包含当前及历史光驱的 VBD、设备号、介质 VDI 与 empty 状态；复制期间插入、弹出或改变光驱时，保留目标引用并显示具体源设备关系核对失败原因。没有光驱的旧记录仍可按原指纹恢复；有光驱但未记录其基线的旧未确认记录不会补造基线或直接报告源保留关系通过。客户端不自动弹出、插回源介质或重发复制。

取消按钮仅在服务器允许取消时显示。“请求取消”仅提交一次，持续观察原任务；只有 Task `cancelled` 才显示已取消，正常成功仍显示完成。失败与取消均提示检查目标残留，不自动删除可能包含用户数据的副本。结果确认后清理本操作的服务器 Task，清理失败单独警告并在连接可用时重试，不改变已确认结果。本地保留最近 50 条终态记录，未确认记录不自动淘汰。任务通知默认收起，受理和结束不自动弹出；已结束记录可删除，删除标记在轮询和重启后保留，仅影响展示，不删除副本或恢复日志。

如果 Async 提交响应中断且没有取得 Task 引用，客户端无法可靠推断服务器是否已受理；保留未知记录、防止重复提交，提示核对源目标池。不会通过名称相同推断复制成功。Task 已成功但副本映射或源保留关系不一致时，保留已知目标引用和具体原因，继续只读核对。

## 与官方实现的对照

研究固定源码和官方文档，避免把不同产品的传输架构或旧公开源码误认为当前商业版本：

- [XAPI VM API](https://xapi-project.github.io/xen-api/classes/vm.html)：clone 使用存储后端能力，copy 创建完整磁盘；文档规定停机状态。`migrate_send` 的泛化描述偏向迁移，复制停机条件以服务实现为补充依据。
- [XAPI Task API](https://xapi-project.github.io/xen-api/classes/task.html)：Task 提供进度、允许操作、结果与终态；取消可能失败，也可能在取消请求后正常完成。
- [React 异步响应清理](https://react.dev/learn/synchronizing-with-effects#fetching-data)：过期响应不能更新当前视图。复制窗口用独立请求标识隔离每次提交，并与预检的数据身份分开判断；连接变化不会阻止当前请求释放等待状态，重新打开后的表单也不会受旧响应影响。
- [XAPI migrate 实现](https://github.com/xapi-project/xen-api/blob/e2d37d9c0949ebdab915c0f4061ac3b0e90341c9/ocaml/xapi/xapi_vm_migrate.ml#L717-L724)：`copy=true` 设置 `send_snapshots=false`，副本不保留 VM 快照历史；历史 VDI 默认落点与历史 VIF 推导仍参与传输，客户端保留完整映射。源数据保留属于复制路径的后置核对。具体源码行范围与复核结论见 [修复记录](reviews/2026-10-23-vm-template-copy/review-fixes.md)。
- [XAPI 光驱处理](https://github.com/xapi-project/xen-api/blob/e2d37d9c0949ebdab915c0f4061ac3b0e90341c9/ocaml/xapi/xapi_vm_migrate.ml#L846-L891)、[调用位置](https://github.com/xapi-project/xen-api/blob/e2d37d9c0949ebdab915c0f4061ac3b0e90341c9/ocaml/xapi/xapi_vm_migrate.ml#L1533-L1534)：当前非挂起 VM 的已挂载光盘在未映射到原 SR 时会被弹出，此分支没有 `not copy` 保护。不能仅检查源 VM 与数据盘仍在就声称源设备未变。
- [XAPI VM 定义](https://github.com/xapi-project/xen-api/blob/e2d37d9c0949ebdab915c0f4061ac3b0e90341c9/ocaml/idl/datamodel_vm.ml)：`migrate_send` 的 vGPU 映射和新版 `vdi_format_map` 都有空映射默认值。当前调用提供 vGPU 空映射，保留新版磁盘格式参数默认值以兼容旧版本，不重放 mutation 做参数试探。
- [XO 复制实现](https://github.com/vatesfr/xen-orchestra/blob/3923756ff5d56871c963616d67fe71b737e498b7/packages/xo-server/src/xapi/index.mjs)：快速克隆和完整复制使用异步调用；运行 VM 的完整复制先准备快照再复制、最后清理。本轮实现停机流程，在线准备仍是明确差距。
- [XO 复制窗口](https://github.com/vatesfr/xen-orchestra/blob/3923756ff5d56871c963616d67fe71b737e498b7/packages/xo-web/src/common/xo/copy-vms-modal/index.js)：区分快速/完整复制、目标和命名；采用这些明确的交互语义。XO 跨池可经流式导出/导入，不能无实测宣称其一定比主机直传更快。
- [XenAdmin VMCopyAction](https://github.com/xenserver/xenadmin/blob/b210cd2c2d8547f5bb48b49d71f17429c7d65e44/XenModel/Actions/VM/VMCopyAction.cs)、[跨池复制 action](https://github.com/xenserver/xenadmin/blob/b210cd2c2d8547f5bb48b49d71f17429c7d65e44/XenModel/Actions/VM/VMCrossPoolMigrateAction.cs)、[存储映射页](https://github.com/xenserver/xenadmin/blob/b210cd2c2d8547f5bb48b49d71f17429c7d65e44/XenAdmin/Wizards/CrossPoolMigrateWizard/CrossPoolMigrateStoragePage.cs)：后台异步任务、取消及包含历史磁盘/网卡的映射是本轮采用的交互和正确性基线。该公开提交是 2023-12-13 的开源版本，不是 2026 商业 XenCenter 源码。
- [XenAdmin CD 保留映射](https://github.com/xenserver/xenadmin/blob/b210cd2c2d8547f5bb48b49d71f17429c7d65e44/XenAdmin/Wizards/CrossPoolMigrateWizard/CrossPoolMigrateStoragePage.cs#L143-L161)：仅同池迁移将非 Tools ISO 映射回原 SR。该方式不能照搬到跨池复制；本工具在跨池预检中要求用户先手动弹出当前 ISO。

本轮验证结果见 [实施记录](reviews/2026-10-23-vm-template-copy/implementation.md)。原始审查与固定源码摘要保留在同目录，供复核前后差异。
