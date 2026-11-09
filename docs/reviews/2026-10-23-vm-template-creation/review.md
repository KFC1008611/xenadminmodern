# 从模板创建虚拟机：问题审查

日期：2026-10-23。初次审查工作区的实现，基础提交为 `7c3e7e6`。工作区已有大量未提交修改，本文记录修改前读到的内容；文件指纹见 `implementation-sources.json`。初次审查只新增材料；后续已按用户要求完成修复并与 Quick Create 优化合并，见[实现和验证记录](implementation.md)。未操作真实资源池。

发现 **12 项可定位、可在本地针对性复现的问题，另有 1 项需要明确约定的网卡继承风险**。最直接的结论是：确有产生额外磁盘的代码路径，也有单纯把光驱计入硬盘数量的显示错误。不能据此断言所有系统模板都会多建盘，也不能在缺少现场 VM/VBD/VDI 记录时认定用户现场只由其中一条路径造成。

## 对照依据与正常流程

取证包含 XAPI 服务端、XenAdmin 创建向导与快速创建动作、XO 创建前后端。`external-sources.json` 固定了所读版本、来源、哈希和 Git blob 校验结果；`upstream-excerpts.txt` 保存关键代码片段。

| 来源 | 固定版本 | 核对内容 |
| --- | --- | --- |
| XAPI | `e2d37d9c0949ebdab915c0f4061ac3b0e90341c9` | `xapi_templates.ml`、`xapi_vm.ml`、`xapi_vm_clone.ml` |
| XenAdmin | `b210cd2c2d8547f5bb48b49d71f17429c7d65e44` | `CreateVMAction.cs`、`CreateVMFastAction.cs`、`Page_Storage.cs`、`Page_InstallationMedia.cs` |
| Xen Orchestra | `a508ca7897cc869026c54f2b693d67abefb71a21` | `xo-server/src/xapi/mixins/vm.mjs`、`xo-web/src/xo-app/new-vm/index.js` |

关键语义：

1. `VM.clone` / `VM.copy` 会带来已有 VBD，并为非光驱磁盘克隆/复制 VDI。光驱关系也被复制，ISO 本身不复制。
2. `VM.provision` 把模板对象变成 VM；若仍有 `other_config.disks`，还会根据 XML 创建磁盘。它不会把 XML 自动解释成“更新已有盘”。
3. XenAdmin 完整创建向导先清掉 XML 磁盘配置，再按设备号寻找已有 VBD，决定复用、移动或新建；光驱也是先找已有设备。XO 同样在 provision 前清掉 XML，并按 `userdevice` 区分已有磁盘和新磁盘。
4. XenAdmin 的快速创建直接 clone → provision 是有效的另一种流程。因此不能把“调用了 provision”本身判为错误，也不能把完整向导的手动建盘策略机械套给快速创建。

原始资料：

- [XAPI VM.provision 服务端实现](https://github.com/xapi-project/xen-api/blob/e2d37d9c0949ebdab915c0f4061ac3b0e90341c9/ocaml/xapi/xapi_vm.ml#L832)
- [XAPI provision XML 解析及创建磁盘](https://github.com/xapi-project/xen-api/blob/e2d37d9c0949ebdab915c0f4061ac3b0e90341c9/ocaml/xapi/xapi_templates.ml)
- [XAPI 克隆 VDI 与 VBD](https://github.com/xapi-project/xen-api/blob/e2d37d9c0949ebdab915c0f4061ac3b0e90341c9/ocaml/xapi/xapi_vm_clone.ml#L178)
- [XenAdmin CreateVMAction](https://github.com/xenserver/xenadmin/blob/b210cd2c2d8547f5bb48b49d71f17429c7d65e44/XenModel/Actions/VM/CreateVMAction.cs)
- [XenAdmin 存储页](https://github.com/xenserver/xenadmin/blob/b210cd2c2d8547f5bb48b49d71f17429c7d65e44/XenAdmin/Wizards/NewVMWizard/Page_Storage.cs)
- [XenAdmin 安装介质页](https://github.com/xenserver/xenadmin/blob/b210cd2c2d8547f5bb48b49d71f17429c7d65e44/XenAdmin/Wizards/NewVMWizard/Page_InstallationMedia.cs)
- [XenAdmin 快速创建](https://github.com/xenserver/xenadmin/blob/b210cd2c2d8547f5bb48b49d71f17429c7d65e44/XenModel/Actions/VM/CreateVMFastAction.cs)
- [XO createVm 与 CPU 配置](https://github.com/vatesfr/xen-orchestra/blob/a508ca7897cc869026c54f2b693d67abefb71a21/packages/xo-server/src/xapi/mixins/vm.mjs)
- [XO 新建虚拟机界面](https://github.com/vatesfr/xen-orchestra/blob/a508ca7897cc869026c54f2b693d67abefb71a21/packages/xo-web/src/xo-app/new-vm/index.js)
- [XAPI VDI 字段类型](https://xapi-project.github.io/xen-api/classes/vdi.html)：`virtual_size` 为 `int`。

另外读取了 XCP-ng 仓库的 `CreateVMAction.cs` 和 `xapi_templates.ml`，下载内容与上述对应文件一致；未取得独立提交身份，因此不将它们列作额外版本验收。

## 问题明细

### R01 / P2：系统模板已有硬盘时，向导继续追加新盘

位置：`src/main/xapi/services/vm-creation.service.ts:365-394`、`:317-320`；`src/renderer/src/components/wizard/steps/Step4Disk.tsx:25-43`。

触发条件是被识别为系统模板的对象实际已有 `type=Disk` 的 VBD，例如带系统模板标记的导入对象。界面只从 provision XML 初始化磁盘表，后端 clone 后没有核对已有硬盘，仍为表内每一项调用 `VDI.create`。原设备号已占用时 `chooseDevice()` 自动换一个空设备号，结果表现为成功创建了额外硬盘。

本地复现：模板已有设备 0 的一块盘，向导提交设备 0 的一块盘，结果保留原盘并新增设备 1，总数变成两块。普通、不带实际 VBD 的系统模板不触发；C01 对照用例证明这一点。

修复方向：同时读取真实 VBD/VDI 与 XML 磁盘建议，形成明确的最终磁盘计划；克隆后按设备号核对已有盘，不能以换设备号掩盖冲突。参考 XenAdmin `AddDisks/GetDiskVBD` 和 XO 的磁盘分组处理。

### R02 / P2：自定义模板的 provision XML 未清理，可能额外建盘或写入另一 SR

位置：`src/main/xapi/services/vm-creation.service.ts:245-261`、`:365-378`。

`other_config.disks` 只在系统分支被删除；自定义模板先完整复制真实磁盘，再直接 provision。若导入模板、未完成安装的模板或带残留 XML 的模板同时存在真实盘与 XML 磁盘描述，provision 仍会按 XML 创建磁盘。非冲突设备号会增加盘；冲突设备号可能导致创建失败。XML 的 SR UUID 也不会随向导选择的 `targetSrRef` 重写，因此额外磁盘可能落到 XML 指定 SR。

容量预检只统计真实 VBD 对应 VDI，完全漏掉这些 XML 请求。R02 复现一块真实盘加一块 XML 盘，界面走完整复制而结果有两块盘。

修复方向：先确定这些 XML 项在最终计划中的含义，再在完整创建向导中统一去掉自动 provision 磁盘请求，所有实际创建和容量统计从同一计划执行。不要直接删除仍有业务含义的模板磁盘建议而不转入计划。XenAdmin 和 XO 的完整创建路径均会清除 XML 请求。

### R03 / P2：ISO 分支不复用已有光驱，始终再建一个

位置：`src/main/xapi/services/vm-creation.service.ts:395-403`。

clone 已经继承光驱，但 ISO 安装分支无条件调用 `VBD.create(type=CD)`；设备 3 被占用时改选另一个设备。R03 复现原光驱加新光驱共两个。没有检查后备设备是否满足光驱位置限制，较多硬盘时还可能选中不适合光驱的位置。

修复方向：先查找可用 CD VBD，按需弹出并插入 ISO；确实没有光驱时才创建。XenAdmin `AddCdDrive` 就采用此流程，XO 使用 `_insertCdIntoVm`。

### R04 / P2：ISO 启动配置没有按所选介质调整

位置：`src/main/xapi/services/vm-creation.service.ts:319-320`、`:395-408`。

ISO 分支插入 ISO 后不调整 `HVM_boot_params.order`；`cdn` 会原样保留，仍先尝试硬盘。另一方面，磁盘的 `bootable` 标记取自 XML/首盘，CD 又无条件设为 bootable，可能同时存在两个 bootable 设备。HVM 主要看启动顺序，不能用 VBD 标志代替；PV 的安装盘标志也需要单独处理。

R04 复现 HVM 顺序仍为 `cdn` 且两个设备都被标为 bootable。没有声称空硬盘一定阻止固件回退到 ISO。XO 明确对 HVM ISO 安装把 `d` 排到前面，并使 CD 与首个新盘的 bootable 标志互斥；XenAdmin 新盘的标志也取决于是否 CD 安装。

### R05 / P2：把 PV 安装源错误地当成 PXE

位置：`src/renderer/src/components/wizard/vmWizardModel.ts:61-73`；`src/main/xapi/services/vm-creation.service.ts:264-273`、`:404-408`。

`http/ftp/nfs` 被直接映射为 PXE，没有区分 HVM 与 `PV_bootloader=eliloader`。PV 选择后既没有安装源 URL 字段，也不设置 `other_config.install-repository`；后端仅修改 HVM 启动顺序，对该 PV 安装流程没有作用。PV 的 ISO 路径也没有设置 `install-repository=cdrom`。

R05 以 HTTP eliloader 模板复现。XenAdmin 和 XO 都区分 HVM 网络启动与 PV 安装源，分别设置 HVM 顺序、安装源 URL 或 `cdrom`。

### R06 / P2：HVM 模板的 PXE 能力也被错误地限制在安装源字段上

位置：`src/renderer/src/components/wizard/vmWizardModel.ts:61-73`；`src/main/xapi/services/vm-creation.service.ts:264-273`。

HVM 模板若仅声明 `install-methods=cdrom`，当前界面就不提供 PXE，主进程也会拒绝；但这些 URL 安装源并不是 HVM 是否可网络启动的判据。若未声明该字段，当前系统模板分支甚至没有可提交的安装方式。

R06 复现两种错误分类。XenAdmin 在有安装方法的系统 HVM 模板上通过 `hvm || eli && installUrl` 区分 HVM 网络启动与 PV URL 安装；无安装方法时则允许跳过安装介质步骤，当前系统分支无法表达这种情况。

### R07 / P2：允许提交完全没有网卡的无盘 PXE 虚拟机

位置：`src/renderer/src/components/wizard/vmWizardModel.ts:142-152`；`src/main/xapi/services/vm-creation.service.ts:239-243`、`:291-297`、`:412-415`。

网络校验只遍历已有项，空数组直接通过。用户删除所有网卡后，即使同时无盘、选择 PXE 和创建后启动，也可以执行到底。R07 复现后端调用了 `VM.start`，从未创建 VIF。

修复方向：PXE 分支至少要求一张与目标主机兼容的网卡，前后端采用相同的分支校验；保留其他确实允许无网卡的用法。

### R08 / P2：GiB 小数转换为小数字节，通过校验后发给 XAPI

位置：`src/renderer/src/components/wizard/steps/Step4Disk.tsx:115-119`；`src/renderer/src/components/wizard/vmWizardModel.ts:145`；`src/shared/ipc-contracts/vm.ts:848-853`；`src/main/xapi/services/vm-creation.service.ts:311-314`。

`step=0.25` 不是提交前的强校验。手工输入 `10.1` GiB，当前转换得到 `10844792422.4` 字节；前端与 IPC 都只要求有限正数，后端把这个小数原样转成 `virtual_size` 字符串。XAPI 该字段是整数，实际调用会面临反序列化/参数错误，此时克隆和 provision 已经执行。

R08 贯穿实际输入组件、前端校验、IPC schema 和服务方法，检查到了发出的字符串。没有依赖真实服务器错误文本。修复时应统一整数化/明确允许的精度，并在 IPC 与主进程验证正的安全整数；内存换算也需检查同类边界。

### R09 / P3：VBD 数量被当成硬盘数量，空光驱也算一块

位置：`src/renderer/src/components/wizard/steps/Step4Disk.tsx:69`。

自定义模板文案直接使用 `template.VBDs.length`。一块硬盘加一个空光驱会显示“完整复制模板的 2 块磁盘”。这是确定的显示错误，不能据此认定服务器真的多创建了 VDI。R09 使用实际组件复现；XO 初始化现有磁盘时明确跳过 CD。

修复方向：取得 VBD 记录后只统计非空 `type=Disk` 的连接，硬盘、光驱和总容量分开计算。

### R10 / P2：provision XML 的 SR UUID 匹配失败后，静默选第一项

位置：`src/renderer/src/components/wizard/steps/Step4Disk.tsx:33-34`；`src/main/xapi/services/vm-creation.service.ts:111-117`；`src/shared/types/xapi.ts:351-357`。

XAPI XML 使用 SR UUID；创建资源 DTO 丢掉了 SR 的 UUID，界面却仅拿 XML 值与 `option.ref` 或名称比较。正常 UUID 无法匹配，最终自动落到 `options[0]`。空 `sr` 也直接选第一项，没有读取池默认 SR。

R10 在目标 SR 排第二时，明确复现选中第一项。XenAdmin 用 `Find_By_Uuid<SR>` 解析 XML；XAPI 当前上游对空 SR 解析为池默认 SR。空 SR 的服务器兼容行为可能因版本而异，但当前界面的 UUID 匹配错误不依赖该新行为。

修复方向：资源模型保留 UUID 和池默认 SR 信息；指定 SR 无法解析或不兼容时要求重选，不能悄悄替代。

### R11 / P2：后续失败时，已复制的只读硬盘泄漏且未报告

位置：`src/main/xapi/services/vm-creation.service.ts:204-210`、`:442-458`。

`collectExclusiveOwnedDisks()` 只接纳 VBD 模式为 RW 的盘；XAPI clone/copy 对非 CD 磁盘并不按 RW/RO 区分是否复制。模板有只读数据盘时，新 VM 拥有新复制的 VDI，后续配置失败却不会被收集清理。删除 VM 不等于删除 VDI，结果留下孤立磁盘，且没有出现在残留提示里。

R11 复现：复制 RO 数据盘 → 明确的 VIF 创建失败 → VM 被删除 → 新复制的 VDI 仍存在，未调用 `VDI.destroy`。源盘未被删除。

修复方向：以创建前快照、克隆结果、独占关联和实际所有权判定新资源；不要将只读模式当作“不是本次创建”的判据。无法安全确认归属时保留并报告。

### R13 / P2：修改 CPU 数量后未修正模板的 CPU 拓扑

位置：`src/main/xapi/services/vm-creation.service.ts:175-183`、`:384`。

只调整 `VCPUs_max` 和 `VCPUs_at_startup`，没有校验继承的 `platform['cores-per-socket']`。模板每插槽 4 核，向导选 3 vCPU 时，当前会把相互不匹配的配置提交并继续启动。真实平台可能拒绝启动；本地用例验证的是发出的配置和缺失的协调操作，不伪称已观察到实机报错。

R13 复现该调用序列。XO 在改变 CPU 静态上限时会检查是否整除既有拓扑，否则改成每插槽 1 核；XenAdmin 创建流程显式设置所选拓扑。

修复方向：创建前从模板读出拓扑并验证所选 CPU 数是否兼容；保持合法拓扑，必要时调整并在确认页反映最终配置。

## R12：需要明确约定的网卡继承风险

位置：`src/renderer/src/components/wizard/CreateVmWizard.tsx:185-189`；`src/shared/types/xapi.ts:389-393`；`src/main/xapi/services/vm-creation.service.ts:332-339`。

界面只继承设备号和网络，主进程删除克隆网卡后重新创建，固定 MTU 为 1500，并清空 QoS、IP 允许列表和锁定模式，改成 `network_default`。R12 验证删除和重新创建的参数。

这会丢失模板自定义 QoS；对依赖模板网卡限制的用户，也可能使新 VM 的实际限制与预期不同。XenAdmin 创建流程保留 QoS 参数；XO 的新网卡也由传入配置决定，不能笼统声称 XO 会自动保留模板的全部限制。新的 VM 是否应该继承原 IP 允许列表本身需要产品约定，直接复制旧地址也可能不合适。

因此此项列作**继承策略风险**，不混入 12 项确定问题。建议明确哪些字段继承、哪些必须重配，并让确认页说明实际网络策略；不要仅以“继承了网络映射”代表所有网卡配置都已继承。

## 本地验证与证据边界

- 固定 Node **24.22.0** / npm **11.19.1**。
- 现有聚焦测试：6 个文件、61 项通过，零失败、零跳过、零 warning/stderr，见 `verification.json`。
- 新增独立诊断：13 项问题/风险路径，加 2 项正常对照，共 **15 项通过**，结果见 `repro-results.json` 与 `repro.log`。
- 诊断用例运行实际组件、校验器和创建服务；XAPI 为依据服务端源码构造的有状态替身。不是实机 E2E，也没有验证固件启动、真实 SR 容量耗尽或具体服务器版本的错误文字。
- 诊断断言用于证明当前不正确/有风险的行为，因此“通过”代表复现成功，不代表缺陷修好。源码及配置以 `.txt` 留存，不加入正式测试集合。
- C01：没有真实磁盘的普通系统模板仅创建用户要求的一块盘；C02：没有 provision XML 的普通自定义模板仅保留其复制盘。这两条反例排除了“所有 clone + provision 都会双倍建盘”的错误结论。

复跑：在项目目录，将 `repro.test.tsx.txt` 与 `repro.config.mts.txt` 复制到 `/private/tmp/xenadmin-template-audit-20261023/` 并去掉 `.txt` 后，执行：

```sh
PATH=/private/tmp/xenadmin-toolchain-24.22.0/bin:$PATH node node_modules/vitest/vitest.mjs run --config /private/tmp/xenadmin-template-audit-20261023/repro.config.mts
```

现有测试的主要缺口：系统分支用例默认克隆后没有实际 VBD；自定义分支假定没有 XML 请求；没有校验最终磁盘/光驱清单与确认页一致。仅检查 `VM.copy`、`VM.provision` 或 `VDI.create` 是否被调用，不能覆盖服务器在 provision 内部创建的磁盘。

## 建议修复顺序

1. 统一真实 VBD/VDI 与 XML 建盘计划，修复 R01/R02/R03/R09/R10，并在创建结束后读回数量、设备号、容量与 SR。
2. 按 HVM/PV 和安装方式处理启动参数，修复 R04/R05/R06/R07。
3. 修正容量整数边界、RO 盘清理和 CPU 拓扑，修复 R08/R11/R13。
4. 明确 R12 的网卡继承约定；涉及用户行为变更时同步工作流、前端规范、实现和配置。最后再对实际 XCP-ng 的系统模板、已安装用户模板、带光驱模板、多盘模板和失败回滚进行验收。
