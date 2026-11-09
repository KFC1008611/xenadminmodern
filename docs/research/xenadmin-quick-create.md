# XenAdmin 模板 Quick Create 核查（2026-10-23）

初次核查发现工作区已有“从用户模板跳过向导创建 VM”的入口和 `VM.clone → VM.provision` 调用链，缺少参考 XenAdmin 的资格标记与自动启动。随后已在同日完成对应优化：严格检查 `instant=true`，补充启用入口、转换时写入标记，采用异步 clone → provision → 命名 → start，并保留未确认结果。当前行为和限制见[模板快速创建](../vm-quick-create.md)。下文的原实现对照与 76 项测试结果保留为修改前证据；未更新已安装应用或操作真实资源池。

## 核查版本和资料

- 项目当前 HEAD：`7c3e7e67bb3fea8e59b2c4bc53d720392d1c982d`；实现判断包含当前未提交工作区。
- 本地 `refs/xenadmin`：远端 `https://github.com/xcp-ng/xenadmin.git`，HEAD `ba43130ffb30d05d1eb40187b8ef9f2de111468a`，提交时间 `2026-03-14 22:57:51 -0700`，核查时参考仓库无修改。这是本项目实际已有的参考副本，不将其称为远端最新版。
- XenCenter 当前官方帮助：[Express (unattended) VM Creation](https://docs.xenserver.com/us/en/xencenter/current-release/vms/vms-new-express.html) 和 [Creating New Templates](https://docs.xenserver.com/us/en/xencenter/current-release/vms/templates-new.html)，页面均标注 `Last published: Oct 01, 2026`。前者明确使用配置完整的 custom template，绕过 New VM 向导并沿用全部配置；后者说明通过复制、VM 转换、快照另存及 XVA 导入生成自定义模板。这些当前商业产品帮助页不等于本地开源参考副本的版本说明。
- [XenAdmin 菜单资格、执行和完成回调](https://github.com/xcp-ng/xenadmin/blob/ba43130ffb30d05d1eb40187b8ef9f2de111468a/XenAdmin/Commands/InstantVMFromTemplateCommand.cs#L62-L89)。
- [XenAdmin CreateVMFastAction](https://github.com/xcp-ng/xenadmin/blob/ba43130ffb30d05d1eb40187b8ef9f2de111468a/XenModel/Actions/VM/CreateVMFastAction.cs#L42-L94)。
- [InstantTemplate 定义](https://github.com/xcp-ng/xenadmin/blob/ba43130ffb30d05d1eb40187b8ef9f2de111468a/XenModel/XenAPI-Extensions/VM.cs#L1423-L1426)及 [BoolKey 的严格字符串比较](https://github.com/xcp-ng/xenadmin/blob/ba43130ffb30d05d1eb40187b8ef9f2de111468a/XenModel/XenAPI-Extensions/XenObject.cs#L269-L277)。
- [VM 转模板时写入 instant](https://github.com/xcp-ng/xenadmin/blob/ba43130ffb30d05d1eb40187b8ef9f2de111468a/XenAdmin/Commands/ConvertVMToTemplateCommand.cs#L64-L94)、[从快照生成模板后写入 instant](https://github.com/xcp-ng/xenadmin/blob/ba43130ffb30d05d1eb40187b8ef9f2de111468a/XenAdmin/Commands/NewTemplateFromSnapshotCommand.cs#L86-L102)。
- [XAPI VM.clone 官方定义](https://xapi-project.github.io/xen-api/classes/vm.html#clone)、[VM.provision 官方定义](https://xapi-project.github.io/xen-api/classes/vm.html#provision)、[VM.start 官方定义](https://xapi-project.github.io/xen-api/classes/vm.html#start)，本次实际读取了文档正文。
- XAPI 服务端固定提交 `e2d37d9c0949ebdab915c0f4061ac3b0e90341c9`（`2026-10-23T01:24:19Z`）：[provision 实现](https://github.com/xapi-project/xen-api/blob/e2d37d9c0949ebdab915c0f4061ac3b0e90341c9/ocaml/xapi/xapi_vm.ml#L832-L871)及[模板安装配置解析](https://github.com/xapi-project/xen-api/blob/e2d37d9c0949ebdab915c0f4061ac3b0e90341c9/ocaml/xapi/xapi_templates.ml#L133-L156)。这份较新的服务端源码用于解释语义，不表示现场服务器已经运行该版本。

帮助站已调整页面层级，上述地址从当前官方 VM 目录确认并实际读取正文。菜单的精确布尔条件和成功后启动行为以当前本地参考源码为依据；官方 Express 帮助页只描述跳过向导及创建/provision，没有单独说明启动步骤。

## XenAdmin 的模板条件

`InstantVMFromTemplateCommand.CanRun` 的实际条件为：

```csharp
vm != null && vm.is_a_template && !vm.Locked
    && !vm.is_a_snapshot && vm.InstantTemplate()
```

其中 `InstantTemplate()` 严格判断 `other_config["instant"] == "true"`。缺失键、`"false"` 和 `"True"` 均不满足。命令还要求只选中一个 VM 类型对象。`Locked` 是 XenAdmin 客户端的请求进行中状态，不应直接等同于 XAPI `current_operations`。

这个函数并没有用“用户模板分类”替代 `instant`，也没有单独根据 `is_default_template` 判定资格。VM 转模板流程先添加 `instant=true` 再转换；从快照生成的新模板也会添加该标记，但快照对象本身不能直接 Quick Create。

需要区分三层条件：

1. **入口资格**：上面的模板、非快照、未锁定和 `instant=true`。
2. **XAPI 创建条件**：源对象处于适合 clone 的状态（官方定义为 Halted），磁盘存储可用、容量及权限满足 clone/provision；有 `other_config.disks` 或 `postinstall` 时，相关配置必须能正确执行。clone/provision 的官方最低角色均为 `vm-admin`。
3. **启动条件**：有能够访问所需磁盘与网络、满足计算资源等约束的主机，且服务器允许启动。创建成功与启动成功是两个阶段。

`instant` 是客户端的资格标记，不能证明磁盘里已经有可启动操作系统。实际要一键得到可用 VM，模板需要预先准备好相应系统、启动配置和设备；Quick Create 本身没有 ISO、磁盘或网络选择页。源码的入口判断不要求 Guest Tools、cloud-init、指定磁盘数或共享 SR，也不验证这些能力。

## XenAdmin 的执行过程

1. 命令启动后台 `CreateVMFastAction`。
2. `VM.async_clone` 使用临时隐藏名称复制模板；观察服务器 Task，进度区间 0–80%。沿用模板计算和设备配置，不进入配置向导，不选择新目标 SR。
3. `VM.async_provision` 并观察 Task，进度区间 80–90%。服务端把副本的 `is_a_template` 设为 false；如果还有磁盘描述或安装后脚本，则继续处理。
4. 完成后计算唯一名称、`VM.set_name_label` 并显示对象。名称在克隆和 provision 之后计算，以减少连续创建时的重名。
5. 命令成功回调另行运行 `VMStartAction`，后者调用 `VM.async_start(false, false)`，包含已有的 HA 与启动诊断工作流。因此正常行为是创建后自动启动；启动可能另行失败。

`clone` 会利用底层 SR 的 CoW 等能力，不能据此保证所有存储后端都能瞬时完成，也不意味着“快速创建”只支持共享存储。XAPI 没有专门的 Quick Create RPC；它是客户端组合现有 API 的工作流。

## 修改前程序对照

| 检查项 | 当前实现 | 与参考程序的关系 |
| --- | --- | --- |
| 用户操作入口 | `VmsPage.tsx:848` 附近，用户模板菜单中的“快速创建 VM” | 已有可用入口，不经过创建向导 |
| IPC 和 preload | `vm:quick-create-from-template` → `quickCreateFromTemplate` | 已接通，不是占位按钮 |
| 模板资格 | 服务端要求用户模板、非快照、`current_operations` 为空 | 不检查 `instant`，与 XenAdmin 不同 |
| 核心创建 | `vm-creation.service.ts:477` 起执行 `VM.clone → VM.provision`，读回确认副本不是模板/快照 | 核心 API 顺序一致 |
| 资源配置 | 沿用模板，不重新写 CPU/内存，不替换磁盘/VIF，不选择目标 SR | 与跳过向导的目的相符 |
| 命名 | clone 前查 VM 名称，使用 `模板名 (n)` | 已考虑已有重名，但不是 XenAdmin 的创建完成后命名顺序 |
| 创建后启动 | 无 `VM.start`；单元测试明确断言不调用 | 缺少参考程序的自动启动阶段 |
| 进度和任务 | 同步 RPC，行内显示“处理中”；调用 Promise 等待结果 | 没有接入 XenAdmin 式的服务器异步 Task 进度；本项目复制任务系统不等于快速创建任务系统 |
| VM 转模板 | `convertVmToTemplate` 只转换并读回，不写 `instant` | 与 XenAdmin 不同；由本程序转换的无标记模板不能因此自动获得 XenAdmin Quick Create 入口 |
| 手动启用标记能力 | `enableTemplateInstantCreate → ensureInstantTemplateMetadata` 及 IPC/preload 已存在 | renderer 中未发现调用入口，日常转换流程也没有调用它 |
| 失败处理 | 已获得副本引用时，provision 后结果无法确认会保留对象；确定仍是模板时尝试清理 | 存在保护，但不能把它概括为完整持久恢复，尤其是 clone 响应丢失且没有副本引用的情况 |

本地行为依据：

- `src/renderer/src/pages/VmsPage.tsx:268`、`:848`：入口、重复点击保护及刷新反馈。
- `src/main/ipc/handlers/vm.ts:135`、`src/preload/vm-api.ts:97`：端到端调用链。
- `src/main/xapi/services/vm-creation.service.ts:477`：资格判断、创建及错误处理。
- `src/main/xapi/services/template-metadata.service.ts:11`、`:37`、`:61`：标记帮助函数、日常转换及启用服务。
- `tests/unit/vm-creation-service.test.ts:127`：无 instant 的模板可以成功创建，且不调用 VM.start。
- `tests/components/ScopedConnectionPages.test.tsx:453` 起：入口、防重复提交、系统模板隐藏及错误后刷新。
- `docs/desktop-workflows.md:54`：现有文档明确沿用配置、不添加 instant，当前产品与其自身该项说明一致；不能据此宣称完全复现 XenAdmin。

## 修改前验证和后续判断

使用项目规定的 Node `24.22.0`、npm `11.19.1`，实际执行：

```sh
npm test -- \
  tests/unit/vm-creation-service.test.ts \
  tests/unit/template-metadata-service.test.ts \
  tests/components/ScopedConnectionPages.test.tsx \
  tests/unit/ipc-vm-preload.test.ts \
  tests/unit/ipc-vm-contract.test.ts
```

结果：5 个文件、76 项通过，0 失败、0 skipped/todo、0 warning、stderr 0 字节。这里的测试包括整个相关测试文件，不能把 76 项都称为 Quick Create 专项，也不代表真实服务器验收。

上述差异已按后续用户要求实现，相关服务位于 `src/main/xapi/services/vm-quick-create.service.ts`，共用资格位于 `src/shared/template-quick-create.ts`，专项测试位于 `tests/unit/vm-quick-create-service.test.ts`。实际资源池仍需验证模板启动、磁盘/网卡继承、不同 SR 后端、RBAC 和失败恢复。
