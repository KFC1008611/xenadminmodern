# 虚拟机批量管理机制检查

此文保留优化前的检查结论和复现；后续实现、范围取舍及最新验证见 [优化记录](implementation.md)。`repro/` 验证的是优化前缺陷，不属于当前正式回归。

检查日期：2026-10-24。检查对象为当前工作区，HEAD 为 `c5bcf2d90941a739c7609f00921a0d08d81a1707`，包含检查开始时已有的未提交改动。本轮只新增此目录的审查记录和隔离复现，不修改业务实现、既有测试或规范。

## 结论

统一批量任务队列、逐项结果、持久化恢复、保守取消和仅重试明确失败项的总体方向合理。但提交防重、快照身份检查、多任务展示、危险操作重试确认以及大批量性能存在缺口，当前不能认定功能完整可靠。

共发现 7 项需修复的问题，另记录 1 项任务页操作可达性问题。以下均区分源码证据、隔离复现与真实环境验证；没有连接真实资源池或执行 VM 写操作。

## 当前机制及合理部分

1. 列表以连接 ID 和 VM 引用组成选择键，跨页保留选择；表头全选覆盖完整筛选结果，只选 VM，不选模板。筛选外的目标有计数和确认清单。
2. 主进程对单次任务内的重复目标进行拒绝；执行队列默认最多 5 项并发。各项目再次读取状态和能力，电源操作另有共享互斥和 UUID、资源池 UUID、连接代次检查。
3. 已满足目标电源状态的项目可以跳过；正常关闭不自动升级为强制关闭。批量删除和迁移仍受既有功能开关保护，属于当前能力限制，不是本轮确认的回归。
4. 取消停止后续派发，等待已开始的项目返回，并保留真实结果；响应不明使用 unknown，不进入明确失败重试。应用重启不重放遗留请求。
5. 历史记录保存目标、选项、逐项结果和重试次数；批量删除复用默认保留数据磁盘的单 VM 服务。

这些机制与 XO 的多选批量操作模型、XenAdmin 的逐 VM 能力判断，以及 XAPI 对异步任务与取消的定义相符。XAPI 明确说明取消请求不保证取消成功，也不保证立即结束，因此应保留现有在途结果处理。

## 发现

### F1 · P1：提交期间没有防重入，同一批目标可以重复建任务

位置：[batch.store.ts:124](../../../src/renderer/src/store/batch.store.ts#L124)、[BatchToolbar.tsx:164](../../../src/renderer/src/components/batch/BatchToolbar.tsx#L164)、[batch-task.manager.ts:60](../../../src/main/batch/batch-task.manager.ts#L60)。

触发：第一次提交尚未返回，或已受理但前端尚未取得 activeTask 时，再次点击启动、恢复，或再次提交同一快照操作。工具栏仅根据 activeTask 禁用按钮，不使用 isLoading；store 虽设置 isLoading，却不检查已有提交；主进程的目标去重只覆盖同一任务。

证据：隔离 store 复现连续两次提交相同选择，产生两次完全相同的 `batch.submit` 请求；组件在 isLoading=true 时启动按钮仍可点击。管理器复现对同一 VM 创建两个不同快照任务并各执行一次。电源服务的互斥不能代替提交去重：同一任务集可能在稍后再次进入队列，快照服务也没有该互斥。

影响：可能重复创建快照；重复电源任务如果错开执行，也可能造成重复服务中断。

建议：前端提交开始即同步锁定，store 拒绝同次提交重入；主进程增加提交请求身份，确保同一次用户提交只受理一次，同时允许用户在明确完成后主动再次执行同类操作。

### F2 · P2：批量快照没有核对已确认的 VM 和连接身份

位置：[batch-command.service.ts:184](../../../src/main/batch/batch-command.service.ts#L184)、[vm.service.ts:274](../../../src/main/xapi/services/vm.service.ts#L274)。

选择记录携带 intent，但快照分支只传 connectionId、vmRef 和名称。其预检查只读取电源状态与允许操作，不比较 intent；snapshotVm 也没有 UUID、poolUuid、epoch 或客户端连续性检查。电源分支已有这些保护，快照分支没有复用。

证据：给目标传入 vmUuid=`confirmed-vm`，让当前 VM.get_record 返回 uuid=`different-vm`，批量快照仍派发并返回 success=true。

影响：如果待执行或历史重试目标所在连接已变化，且同一引用在当前连接解析到不同 VM，系统不会拒绝错误目标。这是条件性身份校验缺口；本轮没有证明真实 XCP-ng 会复用某个具体引用。

建议：在真正派发快照前校验确认时的完整身份，并在异步读取跨越连接变化时拒绝继续。身份变化应要求重新读取与确认。

### F3 · P2：后端允许多个任务，前端只保留一个运行中任务

位置：[batch.store.ts:193](../../../src/renderer/src/store/batch.store.ts#L193)、[BatchHistoryPage.tsx:24](../../../src/renderer/src/pages/BatchHistoryPage.tsx#L24)。

主进程允许不同任务同时运行；历史页也允许在另一个任务运行时重试已结束任务。但 refreshTasks 只用 find 取一个活动任务，其余任务只有达到终态后才会进入 taskHistory。

证据：list 返回两个 running 任务时，store 只保存第一个，历史为空。组件复现另一个任务运行时，历史重试按钮仍可点击。无需 F1 的重复点击，通过正常历史重试即可进入此状态。

影响：另一个实际执行中的任务从任务页消失，无法查看其进度和目标，也无法从当前活动进度面板取消它。它达到终态后会重新进入历史，不是持久记录丢失。

建议：既然后端已支持多任务，前端保存并展示全部非终态任务，按任务 ID 更新和取消；不要依靠单一 activeTask 表达整个任务队列。

### F4 · P2：历史重试直接重放强制停止等选项，没有再次确认

位置：[BatchHistoryPage.tsx:20](../../../src/renderer/src/pages/BatchHistoryPage.tsx#L20)、[batch-task.manager.ts:88](../../../src/main/batch/batch-task.manager.ts#L88)。

历史重试按钮直接调用 retryTask，管理器沿用原 task.options。对于 stop + force=true，列表类型只显示“停止”，按钮只显示“重试明确失败项”，没有展示强制断电属性、此次失败目标或风险确认。原工具栏的停止、重启、挂起均有确认流程。

证据：构造一个明确失败的 force=true 停止任务，点击历史重试，立即调用 retryTask，没有对话框，页面也没有“强制”文字。

影响：用户无法在重试前核对即将再次强制断电的具体 VM。连接和 VM 身份保护不会检查客户机业务是否已恢复运行。

建议：危险操作重试复用首次提交的确认流程，清单只列明确失败项；明确显示正常/强制停止、目标资源池和 VM、服务影响，保持 unknown 与 cancelled 不被自动重放。

### F5 · P2：预检查不受并发限制，并形成跨目标等待屏障

位置：[batch-command.service.ts:107](../../../src/main/batch/batch-command.service.ts#L107)、[batch-task.manager.ts:123](../../../src/main/batch/batch-task.manager.ts#L123)。

全部目标先通过 Promise.all 并发读取 VM.get_record，等待全部预检查结束后才进入最多 5 项并发的执行队列。执行时还会再次读取状态；电源服务另有一次最终读取。

证据：120 个目标在任何读取返回前，已经产生 120 个同时在途的 VM.get_record 请求。

影响：全选大量 VM 会瞬间放大 XAPI 请求；跨池批量中，一个池的慢读会阻塞其他池已经检查通过的目标。取消不能撤回已经发出的整批读取。

建议：对预检查也设定并发上限，逐项检查通过后进入执行队列，并保留真正写入前的必要状态与身份复核。可按池分配读取额度，避免单个慢池阻塞全部工作。

### F6 · P2：每次状态和进度更新都同步重写全部历史，清理没有接入

位置：[batch-task.repository.ts:118](../../../src/main/batch/batch-task.repository.ts#L118)、[batch-task.manager.ts:134](../../../src/main/batch/batch-task.manager.ts#L134)、[json-store.ts:96](../../../src/main/persistence/json-store.ts#L96)。

每项开始、结束以及对应 publish 都会调用 persist，序列化全部任务和全部项目，writeFileSync + renameSync 后再 structuredClone。cleanupTasks 默认保留 50 项，但当前生产代码没有调用入口。

证据：无历史、100 个立即成功的项目产生 407 次保存，累计序列化 11,303,181 字节。此计数使用真实管理器和仓库、mock 文件 IO；生产对应路径是同步文件写入。连续完成 51 个单项任务后，51 条历史全部保留。

影响：单批目标数增长时，完整扫描、克隆与序列化工作接近平方增长；长期历史还会放大每次保存成本，存在主进程响应延迟风险。本轮没有测量真实磁盘耗时，也没有据此宣称已观察到界面卡死。

建议：减少只更新派生进度造成的重复保存，使用串行持久化或增量日志，并接入明确的历史保留策略。必须保留“派发前已记录”及“失败不重放”的安全边界，不能简单延迟所有写入。

### F7 · P2：快照返回无效引用仍会计为成功

位置：[batch-command.service.ts:184](../../../src/main/batch/batch-command.service.ts#L184)、[vm.service.ts:274](../../../src/main/xapi/services/vm.service.ts#L274)、[errors.ts:52](../../../src/main/xapi/errors.ts#L52)。

VM.snapshot 的返回值应是新快照引用；当前服务直接返回 Value，批量执行忽略该返回值。通用 XAPI 成功封装检查只要求存在 Value 字段，不能验证方法具体结果。

证据：让 snapshotVm 返回空字符串，批量结果仍为 success=true。真实通用响应解析同样接受 Status=Success 且 Value='' 的封装，因此不是仅由 TypeScript mock 绕过了已有方法结果校验。

影响：在异常或格式不兼容响应下，界面可能显示快照成功，却没有有效快照标识供用户核对。这与工作流中“响应格式无法确认应记录为未确认”的约定不一致。

建议：校验快照引用，保存结果引用并读回核对 snapshot_of；读取异常或结果格式无效时保留 unknown，不能自动重放创建请求。

## 另记：任务页没有停止后续操作入口

BatchHistoryPage 不渲染取消按钮或 BatchProgressDialog。当前进度面板只挂在 VmsPage，因此用户查看任务历史时无法直接停止正在执行任务的后续项目，必须返回 VM 列表。建议在任务页为每个活动任务提供停止后续操作；这也应与 F3 一并处理。

## 验证与复现

工具链：Node 24.22.0、npm 11.19.1。仓库自带相关回归通过 **9 个文件、92 项测试**：

```sh
npm test -- tests/unit/batch-task-lifecycle.test.ts tests/unit/batch-command-outcomes.test.ts tests/unit/batch-command-relocation-gate.test.ts tests/unit/batch-store.test.ts tests/components/BatchHistory.test.tsx tests/components/BatchVmDeleteGate.test.tsx tests/components/DesktopUsability.test.tsx tests/unit/vm-power-service.test.ts tests/unit/vmActionGuard.test.ts
```

隔离复现通过 **4 个文件、12 项断言**，结果见 [repro-results.json](repro-results.json)。这些断言刻意验证当前缺陷存在，**通过不代表问题修好**，也未加入正式回归清单：

```sh
node node_modules/vitest/vitest.mjs run --config docs/reviews/2026-10-24-batch-management/repro/vitest.config.mts --reporter=default --reporter=json --outputFile.json=docs/reviews/2026-10-24-batch-management/repro-results.json
```

本次实际执行使用 `/private/tmp/xenadmin-toolchain-24.22.0/node-v24.22.0-darwin-arm64/bin/node` 和同目录下载的 npm 11.19.1。未运行全量测试、真实池验收、安装包验证或完整界面尺寸与主题验收。没有业务实现变更，因此没有修改现有规范来描述尚未实施的修复。

建议修复顺序：F1 防重提交 → F2 身份校验与 F4 危险重试确认 → F3 多任务展示和取消 → F5/F6 性能 → F7 快照结果核对。随后将对应复现改成验证正确行为的正式回归，并同步工作流与界面规范。

## 参考依据

- [XAPI VM](https://xapi-project.github.io/xen-api/classes/vm.html)：allowed_operations 只是当前能力提示，不能替代提交时检查；snapshot 返回新 VM 引用。
- [XAPI task](https://xapi-project.github.io/xen-api/classes/task.html)：完成应以 status 判断；取消不保证成功，也不保证立即完成。
- [XO 5 批量操作](https://docs.xen-orchestra.com/manage-your-infrastructure/manage_infrastructure#bulk-actions)：多选、全选、批量动作覆盖已选对象。
- [XenCenter 关闭 VM](https://docs.xenserver.com/us/en/xencenter/current-release/vms-manage/vms-power-off.html)：正常关闭与强制关闭具有不同后果，强制关闭有数据丢失风险。
- 仓库参考：[VMLifeCycleCommand.cs](../../../refs/xenadmin/XenAdmin/Commands/VMLifeCycleCommand.cs)、[ShutDownVMCommand.cs](../../../refs/xenadmin/XenAdmin/Commands/ShutDownVMCommand.cs)、[VMSnapshotCreateAction.cs](../../../refs/xenadmin/XenModel/Actions/VM/VMSnapshotCreateAction.cs)：逐 VM 能力过滤、关机确认及异步快照结果等待。
- [现有快照签名研究](../../research/xapi-vm-snapshot-signature.md)：本轮没有把不传 ignore_vdis 误判为参数缺失问题。
