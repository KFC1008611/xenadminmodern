# 基础管理检查与修复（2026-10-25）

本次检查覆盖 VM 设备、主机亲和、虚拟网卡以及 SR 创建/接入。修复了写请求丢失响应后误报结果、重复创建网卡、亲和配置串 VM 的问题，补齐 VIF 换网、NFS ISO 库和已有 iSCSI SR 接入。下列实现与验证均来自当前工作区源码；真实资源池及已安装应用不在本轮验证范围。

## 资料依据与实现决策

| 官方资料 | 本次采用的行为 |
| --- | --- |
| [XAPI VIF](https://xapi-project.github.io/xen-api/classes/vif.html) | 使用 `VIF.move` 更换网络，保留同一 VIF 的 UUID、MAC 和 VM 归属；创建恢复利用 `other_config` 请求标识与对象关系查询原网卡。 |
| [XAPI SR](https://xapi-project.github.io/xen-api/classes/sr.html)、[PBD](https://xapi-project.github.io/xen-api/classes/pbd.html) | 区分 `SR.create` 与 `SR.introduce`。已有 iSCSI LUN 重新探测并匹配 UUID 后介绍原 SR、建立/连接 PBD；不调用格式化创建。 |
| [XenServer：NFS ISO 库](https://docs.xenserver.com/us/en/xenserver/8/storage/create/iso-nfs.html)、[XCP-ng 存储](https://docs.xcp-ng.org/storage/) | 共享 NFS ISO 使用 `type=iso`、`content_type=iso`、`device_config.type=nfs_iso`、`location=server:/path`。不混用本地 ISO 的 `legacy_mode`。 |
| [XAPI VM group](https://xapi-project.github.io/xen-api/classes/vm_group.html)、[VM](https://xapi-project.github.io/xen-api/classes/vm.html)、[XenCenter 放置策略](https://docs.xenserver.com/en-us/xencenter/current-release/vms-placement.html) | 根据运行时实际提供的 VM groups 读取原生反亲和成员；缺少字段时显示读取能力状态。没有把所有 VM 的固定空数组作为反亲和配置，也没有把放置偏好表述成严格隔离保证。 |
| [Xen Orchestra 管理工作流](https://docs.xen-orchestra.com/manage-your-infrastructure/management) | 对照 VM、网络、存储基本操作入口；每个开放入口都具备对应 IPC、服务与状态反馈，不用按钮外观代替能力实现。 |

## 完成的修改

| 领域 | 修改与确认条件 |
| --- | --- |
| VDI 删除 | 只有 `VDI.get_record` 明确返回对象不存在时，才把丢失删除响应的操作判为已删除。读取失败不会被包装为“磁盘已保留”；VBD 删除同样回读。 |
| VIF 创建 | 写入持久请求记录后提交创建，按资源池/VM UUID 和请求 ID 恢复。创建响应丢失时，仅查询带原请求标记、原 VM/网络/设备号的唯一 VIF；重新读取不重发创建。 |
| VIF 连接与删除 | 热插响应丢失时读取实际 `currently_attached`，避免把已连接网卡报告成未连接。删除响应丢失时验证对象消失。 |
| VIF 换网 | 新增服务、IPC、preload 和确认弹窗；检查普通 VM、运行中操作和宿主机网络可达性，并回读 UUID、MAC、VM 及新网络。 |
| ISO 弹出 | 响应丢失时读取原 VBD；仅在空光驱/无介质时完成，不重发弹出。 |
| 主机亲和 | 读取配置按连接/VM 键及请求代次隔离，清除上一 VM 配置，丢弃晚到结果；配置或主机读取失败时禁用保存。断连、资源池身份或连接代次变化时重新读取。提交前后核对 VM 身份和亲和主机。 |
| 反亲和展示 | 读取服务器原生 VM Group 的实际成员。未提供字段时明确显示能力状态，保持原生策略编辑只读。 |
| NFS ISO | 类型、参数、确认页和后台驱动参数接通，复用现有 NFS 路径。 |
| 已有 iSCSI SR | 用户明确选择探测到的原 UUID，后台再次探测该 UUID 与所选 LUN 的对应关系；验证原 SR 类型、PBD 主机/SR/SCSIid，回读已连接状态后完成。更换目标或凭据会清除旧选择。 |
| 文案及能力声明 | 同步 README、能力清单、桌面工作流和前端规范；公共反馈表述具体的状态读取故障，不把读取故障当作操作已失败或已完成。 |

主要代码：[network.service.ts](../../../src/main/xapi/services/network.service.ts)、[sr.service.ts](../../../src/main/xapi/services/sr.service.ts)、[mutation-result.ts](../../../src/main/xapi/services/mutation-result.ts)、[vif-creation-journal.ts](../../../src/main/xapi/services/vif-creation-journal.ts)、[VmAffinityDialog.tsx](../../../src/renderer/src/components/vm/VmAffinityDialog.tsx)。

## 保留保护的未完成能力

| 能力 | 本轮边界 |
| --- | --- |
| Bond、VLAN、Tunnel、PIF IP 变更 | 原有高级拓扑写入保护保留；未宣称已补齐。 |
| SR/PBD 破坏性生命周期 | 任意 SR 介绍、分离/销毁及相关 PBD 写入仍受保护；只开放已探测 UUID 的 iSCSI 原 SR 接入。 |
| Local EXT、HBA 创建 | 创建按钮仍不可用；没有仅去掉禁用状态。 |
| VM 存储迁移、跨池迁移、在线复制 | 保留现有工作流保护，不扩大已验证的复制/迁移范围。 |
| 原生反亲和策略编辑 | 本轮补齐实际数据读取，未开放 VM Group 写入。 |

上述能力仍需各自完整的预检、提交、对象/Task 恢复和实机验收，不能由本次设备级改动推导为可用。

## 验证与证据

固定工具链：Node 24.22.0、npm 11.19.1。完整门禁结果记录在 [verification.json](verification.json)，覆盖严格测试收集清单、全部本地测试、类型检查、lint、生产构建和差异格式检查。

新增回归覆盖：VDI 删除应答丢失与回读失败、VIF 创建/热插应答丢失及原请求恢复、VIF 换网保持身份、ISO 弹出回读、VM Group 原生数据、亲和读取失败/乱序、ISO 驱动参数、已有 iSCSI UUID 接入及目标变化清除选择。IPC 清单与前后端契约同时校验。

首次全量门禁遇到沙箱不允许 loopback 监听（`EPERM`）；在允许本机模拟服务的环境重跑。中间一轮暴露 8 处测试夹具、能力声明及按钮文案断言不一致，修正并完成定向回归后再次执行最终门禁。中间失败不计作通过证据。

浏览器使用真实 App/路由与固定隔离数据，视口为 1280×720：浅色/深色网卡换网窗口可操作，原网络不可重复确认；ISO 类型选择和参数能沿向导保留到确认页。截图不代表真实 XAPI 写入证据：

- [网卡换网：浅色](vif-move-light.png)
- [网卡换网：深色](vif-move-dark.png)
- [NFS ISO 类型](iso-type-light.png)
- [NFS ISO 确认页](iso-review-light.png)

没有执行真实资源池操作、制作安装包、更新已安装应用或发布。真实服务器版本兼容、存储数据保留、网卡热插/换网后的 guest 连通性和重启持久性仍需专用环境验收。
