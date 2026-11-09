# 复制服务后续审查修复（2026-10-23）

本次处理已复现的三个问题：跨池成功后错误等待目标快照历史、预检期间退出导致永久阻止新复制、源 Task 观察和取消依赖目标管理连接。修改限于复制服务、说明和回归测试，未执行真实池写操作或更新已安装应用。

## 官方资料复核

沿用 [固定资料清单](implementation-sources.json) 的提交。此次重新获取 XAPI migrate 源码和 Task 文档，两者 SHA-256 分别为 `77f41a8a75828ff726bdd4ce492a07f126d71d9a65d1c820f3ac9ac1b156d5a9`、`8e35206cd6864467d394936ce08869ead2d1ba9e378f87524c421402608a6dcc`，与清单一致。

| 资料 | 依据及采用的行为 |
| --- | --- |
| [XAPI migrate 元数据](https://github.com/xapi-project/xen-api/blob/e2d37d9c0949ebdab915c0f4061ac3b0e90341c9/ocaml/xapi/xapi_vm_migrate.ml#L717-L724) | `send_snapshots=not copy`，`restore=not copy`。跨池复制创建新对象，不导入 VM 快照历史。 |
| [XCP-ng migrate 分支](https://github.com/xcp-ng/xen-api/blob/dd71d314ecd72f5212a351d98e6439be131c65cf/ocaml/xapi/xapi_vm_migrate.ml#L717-L724) | 此次获取的同名文件与上游文件 SHA-256 一致，快照元数据及历史设备处理相同。固定源码对照不代表所有已发行服务器版本均已验收。 |
| [XAPI 历史设备处理](https://github.com/xapi-project/xen-api/blob/e2d37d9c0949ebdab915c0f4061ac3b0e90341c9/ocaml/xapi/xapi_vm_migrate.ml#L1333-L1382)、[额外 VDI 落点](https://github.com/xapi-project/xen-api/blob/e2d37d9c0949ebdab915c0f4061ac3b0e90341c9/ocaml/xapi/xapi_vm_migrate.ml#L1398-L1502) | 仍枚举快照 VDI、挂起镜像和历史 VIF；未显式映射时可能按父 VDI、目标默认 SR 或 MAC 推导。因此保留完整映射预检，避免设备落入用户未选择的位置。 |
| [XAPI 保留源对象](https://github.com/xapi-project/xen-api/blob/e2d37d9c0949ebdab915c0f4061ac3b0e90341c9/ocaml/xapi/xapi_vm_migrate.ml#L1816-L1868) | 源 VBD、VM 及快照删除分支受 `not copy` 限制。客户端仍核对源 UUID 和完整设备/快照关系。 |
| [XAPI Task](https://xapi-project.github.io/xen-api/classes/task.html#cancel) | `progress` 不能判断完成，`status` 才能；`allowed_operations` 是建议值，取消可能正常成功、失败或持续任意时间。源 Async 调用返回的 Task 在源会话观察和取消；目标连接用于成功后的对象核对。 |
| [XenAdmin 跨池 Action](https://github.com/xenserver/xenadmin/blob/b210cd2c2d8547f5bb48b49d71f17429c7d65e44/XenModel/Actions/VM/VMCrossPoolMigrateAction.cs#L94-L111)、[历史 VIF](https://github.com/xenserver/xenadmin/blob/b210cd2c2d8547f5bb48b49d71f17429c7d65e44/XenModel/Actions/VM/VMCrossPoolMigrateAction.cs#L141-L170)、[存储映射](https://github.com/xenserver/xenadmin/blob/b210cd2c2d8547f5bb48b49d71f17429c7d65e44/XenAdmin/Wizards/CrossPoolMigrateWizard/CrossPoolMigrateStoragePage.cs#L114-L142) | `copy=true` 与源 Session 的 Async Task；处理历史独有 VIF 和快照磁盘映射。该固定开源版本不代表当前商业 XenCenter。 |
| [XO 复制](https://github.com/vatesfr/xen-orchestra/blob/3923756ff5d56871c963616d67fe71b737e498b7/packages/xo-server/src/xapi/index.mjs#L376-L446) | 同池 clone/copy 与跨池导出/导入分开实现。其跨池流式路径不同，不能据此推断本工具 `migrate_send(copy=true)` 保留 VM 快照历史。 |

## 修复后的边界

- 跨池副本只核对当前磁盘容量、设备、SR 和业务网络；源端继续核对包含快照/挂起镜像的完整 fingerprint。界面和预检说明明确“不保留快照历史”。已有记录使用相同验证逻辑，无需重发复制。历史传输可能产生的后端存储对象不按名称认领或自动删除。
- 持久记录明确未越过提交边界、也没有 Task/副本身份时，重启将其记为失败并落盘。用户可以明确发起新复制。已发出请求但响应丢失，或含有服务器身份的记录保留未知并核对原任务，避免重复创建。
- 进度、取消、失败/取消后的 Task 清理仅绑定原源池；目标离线不影响这些操作。成功后先持久保存副本引用，目标恢复且 UUID 匹配后继续核对。不会因连接 ID 被其他池复用而访问错误对象。

## 验证

回归覆盖源有快照但目标无快照的成功、历史映射缺失拒绝、当前 SR/网络/磁盘容量不符、源历史丢失、重启前未提交与丢失响应的区别、目标离线时的源 Task 观察/取消/清理、成功身份持久恢复和池身份变化。测试模拟服务器协议与重启，不代表实机验收。

- 固定 Node `24.22.0`、npm `11.19.1`，工具链预检通过。`vm-copy-workflow.test.ts` 从 26 项增至 40 项，严格清单同步。
- `npm test -- tests/unit/vm-copy-workflow.test.ts tests/unit/vm-copy-contract.test.ts tests/components/CopyVmSafetyGate.test.tsx tests/components/CopyTaskPanel.test.tsx tests/unit/product-claims.test.ts tests/unit/audited-features.test.ts tests/unit/ipc-vm-contract.test.ts tests/unit/ipc-vm-preload.test.ts`：8 个文件、80 项，零失败、零跳过、零 warning/stderr。包括遗留快照数量错误记录的重启恢复，不会创建第二个副本。
- `typecheck:node`、`typecheck:web`、全仓 `lint`、`build` 及 `git diff --check` 通过。build 生成应用 bundle，没有安装或发布。
- 全量尝试未通过：运行期间有并行主题改动，VM 状态 badge（5 项）、告警等级（1 项）和监控时间范围（1 项）的旧 class 断言失败；新增 AppearanceMenu 测试造成收集清单漂移，同时有 stderr。另 1 项 README 能力表未同步由本轮引入，已修复并通过聚焦复测。没有将这次全量结果记作最终通过。


## ISO 介质保护与焦点回归（2026-10-23）

重新下载固定版本的 XAPI、XCP-ng 及 XenAdmin 公开源码，复核跨池 action、向导、存储映射页、过滤器、存储容器和诊断中的光驱处理。XAPI 与 XCP-ng 的 `xapi_vm_migrate.ml` 文件相同，SHA-256 均为 `77f41a8a75828ff726bdd4ce492a07f126d71d9a65d1c820f3ac9ac1b156d5a9`。

| 直接依据 | 结论与本次处理 |
| --- | --- |
| [XAPI 光驱筛选及弹出](https://github.com/xapi-project/xen-api/blob/e2d37d9c0949ebdab915c0f4061ac3b0e90341c9/ocaml/xapi/xapi_vm_migrate.ml#L846-L891)、[执行位置](https://github.com/xapi-project/xen-api/blob/e2d37d9c0949ebdab915c0f4061ac3b0e90341c9/ocaml/xapi/xapi_vm_migrate.ml#L1533-L1534)；[XCP-ng 对照](https://github.com/xcp-ng/xen-api/blob/dd71d314ecd72f5212a351d98e6439be131c65cf/ocaml/xapi/xapi_vm_migrate.ml#L846-L891) | 当前非挂起 VM 的 CD 未映射回原 SR 时会被弹出，此路径不检查 `copy=false`。预检要求用户先手动弹出当前 ISO，后台提交前再次检查；不会自动变更源介质。历史快照 CD 不在弹出筛选范围。 |
| [XenAdmin 存储映射](https://github.com/xenserver/xenadmin/blob/b210cd2c2d8547f5bb48b49d71f17429c7d65e44/XenAdmin/Wizards/CrossPoolMigrateWizard/CrossPoolMigrateStoragePage.cs#L143-L161)、[跨池 action](https://github.com/xenserver/xenadmin/blob/b210cd2c2d8547f5bb48b49d71f17429c7d65e44/XenModel/Actions/VM/VMCrossPoolMigrateAction.cs#L94-L111) | 保留非 Tools ISO 的原 SR 映射仅用于同池迁移；跨池 action 使用 `migrate_send(copy=true)`，没有自动插回源光盘的动作。不能把同池 CD 映射直接用于跨池。存储页 SHA-256 为 `44f156ec5de61fa361205f9059d72a9af2292d83064c8540f9b069b1bcfe0304`。 |
| [Testing Library 交互说明](https://testing-library.com/docs/guide-events/#focusblur) | `fireEvent.click` 只派发事件，不模拟鼠标交互的自动聚焦；焦点返回测试在打开正常关闭确认框前显式 `focus()`，继续验证取消后返回原触发按钮。 |

源设备指纹补充当前和历史光驱的 VBD、设备号、介质 VDI 与 empty 状态；复制完成后发现介质关系变化时保留目标引用并保持未知，不销毁成功 Task、不重发复制。无光驱记录保持原指纹格式；旧未确认记录未保存光驱基线时不补造基线。公共 IPC 结构保持兼容。

预检被阻止时隐藏不可用的复制方式和目标 SR 控件，保留具体原因、重读入口与禁用的提交按钮。规范、桌面工作流及前端规范同步。新增 9 项服务回归和 1 项组件回归，覆盖 VM/模板挂载 ISO、同池两种方式、空光驱重启、受理后插入 ISO、复制期间介质变化、历史光驱与旧记录恢复。

固定 Node 24.22.0、npm 11.19.1 的专项门禁 4 个文件、71 项全部通过，零跳过、零 warning/stderr；Node/Web 类型检查、全仓 lint 与生产 bundle 构建通过。临时工具链从官方发行源下载并按 SHA-256 / npm integrity 校验，未变更系统安装或仓库版本约束。

全量首轮有 1 项能力提示文案的旧断言失败；当前工作区对应断言已同步，保留新的用户提示。随后在固定工具链下重跑正式全量门禁，193 个文件、1943 项全部通过，零失败、零跳过、零 warning/stderr，严格收集清单无漂移。没有执行真实资源池复制、安装或发布；上述结果限于本地模拟、loopback 和源码构建。
