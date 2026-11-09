# 虚拟机批量管理优化

实施日期：2026-10-24。基于[前次检查](review.md)，按当前客户端的工作流能力收缩批量范围，同时修复受理、执行、展示、重试和持久化问题。检查开始前已有的页面与性能改动继续保留。

## 资料与范围选择

| 操作 | 本次选择 | 依据与约束 |
| --- | --- | --- |
| 启动、正常关闭、正常重启 | 保留批量 | 每台 VM 可使用相同电源意图，逐台检查 XAPI 能力并确认结果；关闭与重启需核对服务影响 |
| 挂起、从挂起恢复 | 保留批量 | XenAdmin 已按逐 VM 能力模型支持这些操作；确认说明存储/内存消耗，最终资源可用性由 XAPI 判定 |
| 强制关闭 | 移出批量 | 强制断电可能丢失数据，需要逐台核对故障与业务状态；正常关闭失败不升级为强制关闭 |
| 删除 | 移出批量 | 需要逐台确认对象归属、磁盘保留和删除后果，不沿用通用队列的一组选项 |
| 迁移 | 移出批量 | 需要目标主机及存储、网络、兼容性计划；现有单 VM 的能力保护继续生效 |
| 快照 | 移出批量 | 需要逐台核对快照目的、类型和存储；通用逐项队列不能承诺一组应用的一致性快照 |

这是本客户端的产品范围选择。XO 的多选模型可作为操作组织参考，开放范围还需与客户端的具体确认和恢复流程相符。[XO 批量操作说明](https://docs.xen-orchestra.com/manage-your-infrastructure/manage_infrastructure#bulk-actions)。

XAPI 的 allowed_operations 只是读取时的能力提示，VM 状态可以变化，因此保留写入前重新检查；电源请求继续等待 Async Task 终态和资源状态读回。[XAPI VM 参考](https://xapi-project.github.io/xen-api/classes/vm.html)。取消仅停止本地后续派发，已开始操作保留其实际结果；服务器取消请求也不保证立即成功。[XAPI task 参考](https://xapi-project.github.io/xen-api/classes/task.html)。

强制关闭的断电后果见 [XenCenter 关闭说明](https://docs.xenserver.com/us/en/xencenter/current-release/vms-manage/vms-power-off.html)。挂起保存运行状态到存储、恢复重新分配运行资源，见 [XenCenter 挂起/恢复](https://docs.xenserver.com/en-us/xencenter/current-release/vms-suspend)。快照的磁盘和内存选项见 [XenCenter 创建快照](https://docs.xenserver.com/en-us/xencenter/current-release/vms-snapshots-take.html)。从 VM.snapshot 的单 VM 接口推断，简单循环创建不会提供组内事务或应用依赖编排；本次不将其包装成批量一致性保证。

同时阅读了仓库参考副本中的 [VMLifeCycleCommand](../../../refs/xenadmin/XenAdmin/Commands/VMLifeCycleCommand.cs)、[ShutDownVMCommand](../../../refs/xenadmin/XenAdmin/Commands/ShutDownVMCommand.cs)、[RebootVMCommand](../../../refs/xenadmin/XenAdmin/Commands/RebootVMCommand.cs)、[SuspendVMCommand](../../../refs/xenadmin/XenAdmin/Commands/SuspendVMCommand.cs)、[ResumeVMCommand](../../../refs/xenadmin/XenAdmin/Commands/ResumeVMCommand.cs) 和 [VMSnapshotCreateAction](../../../refs/xenadmin/XenModel/Actions/VM/VMSnapshotCreateAction.cs)：采用逐 VM 能力检查、服务影响确认和任务结果等待；保持普通快照调用的版本兼容性，不追加未经确认的签名探测或写请求重试。

## 实现

- [共享操作策略](../../../src/shared/batch-policy.ts)集中定义五项电源操作、中文名称、操作后果和禁用原因。IPC 允许读取全部旧类型，但新提交及管理器、命令服务、历史重试都拒绝移除的操作；批量删除的证据条目同步为退出支持范围，未开放其他受限功能。
- [受理与队列](../../../src/main/batch/batch-task.manager.ts)保存请求 ID，同一请求在记录保留期间只受理一次；相同 ID 携带不同内容被拒绝。同一 VM 从排队到终态期间保留批量目标互斥，同池不同管理连接也不能重复排队。不同目标的任务共享最多 5 个执行槽。
- [命令服务](../../../src/main/batch/batch-command.service.ts)在执行槽内逐项预检查，核对 UUID、资源池 UUID、连接代次和客户端连续性，再进入单 VM 电源服务。无整批 Promise.all 预检查屏障。显式预览辅助函数也最多 5 项读取。已满足目标状态仍先检查身份。
- [前端 store](../../../src/renderer/src/store/batch.store.ts)保留全部活动任务；推送按任务 ID 更新，详情读取按任务身份防止旧响应覆盖。提交立即锁定，响应未确认后再次提交同一选择沿用请求 ID；受理成功只移除本次选择，进度读取失败仍保留可见任务及任务 ID。
- 工具栏改为五个带文字的电源按钮。首次执行和失败重试共用[确认窗口](../../../src/renderer/src/components/batch/BatchConfirmationDialog.tsx)，冻结 VM/资源池清单，显示实际后果。重试重新读取明确失败项，提交项目 ID 和重试次数；服务端比较确认集合，拒绝过期确认。unknown、cancelled 和成功项目不重放。
- [批量任务页](../../../src/renderer/src/pages/BatchHistoryPage.tsx)展示全部活动任务和历史，显示实际 VM 名称与数量，每个活动任务可独立停止后续操作。旧强制关闭、快照、删除、迁移记录只读，不显示重试。表格允许局部横向滚动、固定操作列；状态、时间和计数不按单个汉字断行。进度浮层可跳转完整任务页。

## 持久化和恢复

[仓库](../../../src/main/batch/batch-task.repository.ts)改用检查点和[增量日志](../../../src/main/batch/batch-task.journal.ts)。受理、项目开始和结果先追加小记录并 flush；只有写入成功才更新内存及继续派发。进度计数随项目状态变化维护，进度推送不再次写盘，也不反复扫描/克隆整份历史。Node 的 flush 行为见 [Node 24 文件 API](https://nodejs.org/docs/latest-v24.x/api/fs.html#fsappendfilesyncpath-data-options)。

首次读取兼容旧数组历史。检查点带日志序号，检查点落盘与日志清理之间退出可跳过旧日志；未完成的最后一条追加不会触发重放，完整损坏记录保留并阻止继续受理。遗留 running 项恢复为 unknown，pending 项恢复为 cancelled。目标及项目身份不一致时保留文件并报错。

没有失败的普通终态历史保留最近 50 条；活动、明确失败和 unknown 继续保留。日志达到 1024 条或清理历史后，在没有活动任务时合并检查点。取消及关闭应用时，未开始项目合并为一次日志更新。

100 项即时成功回归验证为 **203 条增量记录、日志小于 180 KB**，包含完整 VM/资源池身份；进度没有额外全历史保存。优化前的隔离计数为 407 次整份历史保存、累计序列化约 11.3 MB。两者测试输入与 IO 模拟不同，这些数字用于说明写入形式与规模变化，不作为真实磁盘延迟或客户端响应时间的性能比较。

## 原发现的处理

| 原问题 | 处理 |
| --- | --- |
| F1 重复提交 | 前端即时锁定、持久请求去重、目标互斥、响应未确认时复用 ID |
| F2 快照未核对身份 | 移除批量快照；保留的电源操作在跳过或写入前均核对完整身份 |
| F3 活动任务消失 | 保存全部活动任务，分别显示详情和停止入口 |
| F4 危险历史重试 | 旧强制关闭等移除操作不可重试；支持的操作重新核对失败集合和后果 |
| F5 预检查并发无界 | 执行槽包含预检查，最多 5 项，无整批预检查等待屏障 |
| F6 全历史同步重写 | 增量日志、派生计数、合并未开始项目更新、接入历史清理 |
| F7 无效快照引用记成功 | 批量路径不再调用快照服务；旧快照任务不能从历史重试 |
| 任务页无法停止 | 每个活动任务均提供停止后续操作；浮动进度链接到完整任务页 |

## 验证与边界

正式回归新增或更新了提交去重、跨连接互斥、确认集合过期、读回竞态、移除操作防绕过、队列限流、日志断尾、检查点中断、损坏记录保留、旧历史兼容和历史清理测试，并同步严格测试清单。最终工具链、全量门禁和构建结果见 [verification.json](verification.json)。

真实 React App 配合受控双池 window.xapi，屏蔽非本机网络，验证 1024×768、1280×800、1440×900、1920×1080 的深浅两种主题共 8 组：筛选外目标核对、确认窗口边界、全部活动任务、按 ID 停止、失败重试确认，以及任务浮层展开时实际切换外观。结果见 [browser-checks.json](evidence/browser-checks.json)，可用 [browser-check.cjs](browser-check.cjs) 重跑；截图位于 evidence/。

早期完整回归在沙箱内因不允许监听 127.0.0.1 / ::1 的模拟服务失败；最终在允许本机模拟服务的环境中运行。未连接真实 XCP-ng，未执行真实 VM 电源、快照、删除或迁移操作；未打包、安装、提交或发布。真实池的高可用、Guest Tools、资源不足、断线与长时间多任务运行仍需验收。批量仅用于互相独立的 VM 运维，不保证应用依赖顺序。
