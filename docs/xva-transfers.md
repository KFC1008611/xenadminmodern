# XVA 导入导出规范与实现依据（2026-10-23）

本轮修复对象为当前工作区的 VM、用户模板 XVA 流程，包含已有未提交修改。能力仍属实验性；本地故障注入、HTTP 回环与 renderer 检查不代替真实资源池验收。

## 对照资料

以 XCP-ng 官方推荐的 Xen Orchestra 为现行能力对照，以官方 XenAdmin 源码为桌面向导对照。“最好用”没有统一排名，不把已弃用的 XCP-ng Center 当作现行能力上限。

| 来源 | 核对结果及采用的设计 |
| --- | --- |
| [XCP-ng 管理文档](https://docs.xcp-ng.org/management/) | Xen Orchestra 为主要管理入口；XCP-ng Center 已弃用、不再支持。 |
| [XO 管理文档](https://docs.xen-orchestra.com/manage-your-infrastructure/manage_infrastructure) | XVA 导入选择池和 SR；运行中 VM 可以通过自动快照导出。压缩、OVA 等是另外的能力范围。 |
| [XenAdmin ExportApplianceWizard.cs](https://github.com/xenserver/xenadmin/blob/b210cd2c2d8547f5bb48b49d71f17429c7d65e44/XenAdmin/Wizards/ExportWizard/ExportApplianceWizard.cs) | Finish 后通过 RunAsync 执行，并将 VerifyExport 传给导出操作。采用后台执行和明确的归档检查阶段。 |
| [XenAdmin ImportWizard.cs](https://github.com/xenserver/xenadmin/blob/b210cd2c2d8547f5bb48b49d71f17429c7d65e44/XenAdmin/Wizards/ImportWizard/ImportWizard.cs) | 目的地、存储、网络及完成页分别管理；完成页集中提供核对信息。 |
| [XO VM API](https://github.com/vatesfr/xen-orchestra/blob/3923756ff5d56871c963616d67fe71b737e498b7/%40xen-orchestra/xapi/vm.mjs) | snapshot/checkpoint 默认可能带模板标记；XO 在导出使用前将其调整为普通 VM。当前工具只调整本操作拥有的临时检查点，并核对结果；真正模板直接导出。 |
| [XAPI export.ml](https://github.com/xapi-project/xen-api/blob/e2d37d9c0949ebdab915c0f4061ac3b0e90341c9/ocaml/xapi/export.ml) | `/export` 支持任务关联，`use_compression=true` 表示 gzip。默认不保留挂起状态，必须传 `preserve_power_state=true` 才包含 suspend VDI；当前所有导出显式传入该参数。VDI 数据按映射后的外部引用命名；ISO 不作为磁盘流导出。 |
| [XAPI stream_vdi.ml](https://github.com/xapi-project/xen-api/blob/e2d37d9c0949ebdab915c0f4061ac3b0e90341c9/ocaml/xapi/stream_vdi.ml#L254-L295) | 磁盘按 1 MiB 分块，中间零块可省略，首尾数据块必须存在。raw streaming 超过 5 秒未传输时可写入零长度保活块；序号递增，磁盘偏移不增加。保活块同样带内联校验：`.checksum` 为 SHA-1，`.xxhash` 为 seed 0 的 XXH64 十六进制值。 |
| [XCP-ng stream_vdi.ml](https://github.com/xcp-ng/xen-api/blob/dd71d314ecd72f5212a351d98e6439be131c65cf/ocaml/xapi/stream_vdi.ml#L549-L633) | 对照目标产品分支的发送端和 `recv_all_vdi` 接收端：磁盘偏移按缺失序号对应的零块与实际载荷长度累计，不能直接使用序号乘以 1 MiB。 |
| [XAPI import.ml](https://github.com/xapi-project/xen-api/blob/e2d37d9c0949ebdab915c0f4061ac3b0e90341c9/ocaml/xapi/import.ml) | 存在旧版末尾校验表格式；本轮完整校验明确支持内联校验 XVA，不把未实现的旧格式判为已验证。 |
| [XAPI xapi_vif.ml](https://github.com/xapi-project/xen-api/blob/e2d37d9c0949ebdab915c0f4061ac3b0e90341c9/ocaml/xapi/xapi_vif.ml) | 挂起 VM 的 VIF 不属于活动设备；`VIF.move` 更新网络记录，保留后续恢复运行时的网络映射。 |
| [XAPI server_helpers.ml](https://github.com/xapi-project/xen-api/blob/e2d37d9c0949ebdab915c0f4061ac3b0e90341c9/ocaml/xapi/server_helpers.ml) | Async 调用返回服务器 Task 引用。保存已知原 Task；受理响应丢失时保留未知结果，依据原 VM UUID、电源状态或唯一检查点名称恢复，不重新发送关机/checkpoint。 |
| [Node 24 HTTP](https://nodejs.org/docs/latest-v24.x/api/http.html#requestsettimeouttimeout-callback) | request.setTimeout 是 socket 空闲期限，触发后需主动销毁连接。传输使用空闲期限，同时覆盖连接建立阶段；正常有进度的传输没有短总时长限制。 |
| [XAPI import.ml HTTP handler](https://github.com/xapi-project/xen-api/blob/master/ocaml/xapi/import.ml#L2652-L2666) / [Node HTTP response 事件](https://nodejs.org/docs/latest-v24.x/api/http.html#event-response) | 2026-10-26 核对：XAPI 在读取归档流之前发送 HTTP 200 响应头；Node 收到响应头便触发 response 回调。成功响应头不能作为停止上传或导入完成的依据。 |
| [XAPI Task API](https://xapi-project.github.io/xen-api/classes/task.html) / [XO Task API](https://github.com/vatesfr/xen-orchestra/blob/master/packages/xo-server/src/api/task.mjs) | 取消调用仅请求取消；任务仍可能正常成功或失败。XO 分别提供 `cancel` 和 `destroy`。迟到取消回复不得回退原 Task 的已知终态，清除本地卡片不调用这两个服务器接口。 |
| [XenAdmin HistoryPage.cs](https://github.com/xenserver/xenadmin/blob/b210cd2c2d8547f5bb48b49d71f17429c7d65e44/XenAdmin/TabPages/HistoryPage.cs#L345-L368) / [Zustand 持久化](https://github.com/pmndrs/zustand/blob/main/docs/reference/integrations/persisting-store-data.md) | XenAdmin 移除事件行使用本地 History 集合。当前客户端分别管理历史、草稿与瞬时忙碌状态；通过 partialize/merge 兼容旧存储，已结束历史不再充当新导入的提交锁。 |

上述源码版本为本轮研究时获取的版本。原 XenCenter 文档地址本轮访问时跳转到网站首页，因此向导行为直接核对官方源码，没有将跳转页当作有效文档证据。

完整校验为每个磁盘单独保存上个序号和累计结束偏移。下一块起点为 `上个结束偏移 + (本次序号 - 上个序号 - 1) × 1 MiB`，结束偏移再加实际载荷长度。零长度块不计作磁盘数据，仍检查顺序和内联校验；首块必须从序号 0 开始并包含数据，普通数据块必须符合剩余容量，最终累计长度必须等于元数据容量。因此连续保活、保活前后的稀疏缺块和不足 1 MiB 的尾块可以组合，越界、缺失尾块和损坏校验仍会失败。

## 操作约定

### 导出

1. 受理前检查 VM 能力、原池身份和保存位置。最终路径按真实父目录及平台路径规则登记；同一路径同时只能有一个非终态操作。已存在文件要求选择新名称。
2. 返回操作 ID 后在后台准备。关机或检查点使用 Async Task，写请求前保存阶段、VM UUID 和唯一操作名称；有 Task 引用后立即持久化。关机完成后保持关闭，不自动开机。
3. 受理响应丢失显示未知结果。恢复只读取原池、原任务和原对象；找不到唯一匹配的检查点时保持未知。准备阶段取消不承诺撤销已经完成的关机。
4. 只有本操作拥有的临时检查点可以调整名称、模板标记和清理。检查点须属于原 VM；名称、类型写入均读回验证。检查点模式包含内存，可能短暂挂起并恢复 VM；挂起 VM 直接导出同样保留内存镜像。HTTP 请求显式保留电源状态，不能仅靠创建 checkpoint 保证内存已进入归档。
5. HTTP 数据写入同目录独有 partial 文件。完成下载后扫描整个 TAR、元数据、磁盘边界及校验值，再观察原服务器 Task。完整归档和 Task 成功同时满足，才使用排他硬链接发布最终文件；选路径后新出现的文件也不会被覆盖。发布失败保留已验证 partial 的路径。
   下载与校验分别回报阶段进度。下载显示实际接收字节、已用时间和平均速度；百分比仅使用真实 Content-Length，长度未知时显示“总大小未知”，不使用虚拟磁盘容量或预计导出大小。后续校验按实际文件位置回报百分比与平均校验速度；等待 Task 和清理阶段使用不定进度。
6. 最终结果在一次临时快照/Task 清理尝试结束后才对外发布；失败项以结构化 warnings 返回。任务通知中的导出记录显示实际接收字节数、目标文件路径及完整警告。残留资源在原池重连后可继续清理。重启读取旧版已结束记录时保留终态；未确认的清理另给警告，避免永久停在“清理中”。若记录明确表明清理尚未尝试，后续进度查询仍触发原池清理恢复，不因内部 Task 已结束而跳过；清理通过当前原池连接执行，完成后移除恢复时的待清理提示。

### 导入

1. 选择文件时只快速读取并校验元数据。页面明确区分预览与完整检查；受理后的后台阶段先完整检查归档，再上传。损坏或缺失磁盘数据的文件不会上传。
   本地完整校验以 `validating` 状态回报实际已检查字节数、XVA 文件总字节数及已用时间，扫描期间最多每 500 毫秒更新一次，开始和完成另行回报。确认页与任务通知中的导入记录显示独立校验进度和平均速度；全部结构、磁盘边界和校验值通过后才达到 100%，随后切换为上传进度。上传回报实际已读取并交给 HTTP 请求流的字节数、本地文件总大小与已用时间；百分比直接使用字节比值，不能等同于服务端已经持久写入的磁盘数据量。耗时取决于实际归档大小、读取速度及校验算法，不按虚拟磁盘容量估算，也不承诺固定完成时长。
2. 草稿绑定连接 ID、池 UUID 和 epoch。切换池或重连代次变化后清空主机、SR、网络选择；成功读取的资源列表每 10 秒更新，过期选择禁用提交。IPC 同时携带原池和 epoch。
3. 主进程在受理和完整文件检查后各检查一次放置条件：主机 enabled 且有 live 指标，SR 有附加到该主机的 PBD，物理网络有可用 PIF，真正无 PIF 的内部网络可在池内使用。自动放置也要求至少一个主机同时满足全部存储与网络条件。
4. 容量未知、无可用空间或未接通的 SR 不可提交。显示可用空间及归档虚拟容量（含内存镜像）；虚拟容量超过可用空间时明确提示。稀疏归档大小不等于实际分配量，最终分配仍由存储后端决定，不按文件大小断言足够。
5. 上传失败或响应丢失后只读取原 Task；Task 成功后按返回对象配置。完成前检查 VM UUID、归档模板标记、指定 Home Server、名称覆盖、VIF 设备与网络以及 VBD/VDI 的 VM/SR 归属和磁盘数量。保留电源状态的归档还检查电源状态；挂起归档检查 suspend VDI 的目标 SR 和容量。导入确认页说明包含内存镜像、导入后保持挂起；恢复运行仍需兼容的目标主机。
   HTTP 200 响应头到达时继续上传完整文件，不能关闭源文件流；重定向或拒绝响应才停止当前上传。提前成功响应之后发生的源文件读取或请求错误必须传给响应读取方，取消与空闲超时仍终止传输。HTTP 响应结束后继续核对原 Task 与最终对象，不能仅凭成功响应头发布完成结果。
   声明 Content-Length 的上传检查源流字节数，源流提前结束、意外关闭或超过声明长度时立即结束本次传输并核对原 Task，避免等待剩余内容直到空闲超时。该检查不替代服务端 Task 和最终对象校验。
   服务器处理使用 Task 的原始进度，并标明“服务器进度”；上传、服务器处理不再组合成 70%/25% 的整体权重，配置核对也不再固定显示 97%。Task 未提供有效进度或正在配置时使用不定进度。各阶段平均速度以本阶段已处理字节数除以实际已用时间，不含准备及其他阶段；没有字节计数的服务器处理不显示速度。
6. 配置开始后遇到不确定结果，保留 Task、VM 引用及 UUID。恢复读取已知对象，配置已经符合预期则完成；仍不一致则保留具体未通过字段。不会重复上传、创建或自动重放配置写入。
   新操作在 HTTP 请求前持久记录上传阶段。若重启时明确知道尚未开始上传，则结束该条未执行记录并清理空 Task，提示新建导入；旧记录缺少该阶段信息时继续按原 Task 观察。
7. 操作历史独立于新草稿。已受理后可以关闭弹窗、切换页面或新建导入，原记录继续在右上角“任务通知”的导入任务中观察。未知状态不会锁住所有新导入；同一旧操作也不能通过编辑原草稿重复提交。
   关闭已结束操作后，再次打开向导从选择文件开始；重启恢复的旧版终态记录仅作为历史，不锁住向导。移除当前终态记录同步清除向导引用，不在重启时补回。受理响应返回前不能清空忙碌草稿，以免丢失已经提交的请求身份。
8. 确认页列出文件、VM/模板、池、Home Server、SR、CPU、内存、磁盘与每张网卡映射。已创建对象提供原池内的查看入口；连接未确认属于原池时禁用该入口。

### 观察、超时和取消

- 正常进度在上一轮读取结束后等待 1 秒；未知结果/读取失败退避到 10 秒，仍读取同一个操作。主进程按请求触发有界的原 Task 核对，每轮最多等待 10 分钟，连续 5 次 Task 读取失败保留未知结果。
- HTTP 连接建立或 socket 连续 10 分钟无活动会关闭该次连接，然后核对原服务器 Task。该期限不是整个大文件的传输时长限制。
- 导入确认响应及导出的 HTTP 错误响应最多读取 64 KiB；超过限制或响应中断时关闭本次响应并核对原 Task。响应的 error、aborted 和提前 close 均须结束本地等待，取消不能卡在等待错误响应结束的阶段。正常 XVA 下载继续流式写盘，不受该文本响应大小限制。
- 取消是请求意图，服务器 cancelled 才确认取消。准备已完成、上传/下载尚未开始时，可停止后续步骤。已经进入配置的导入不能取消；配置结果未知时可查看对象，系统继续只读核对。
- 已确认 completed、failed 或 cancelled 的展示状态不能由较晚的取消回复或旧进度回退。取消的本地意图在发出请求时更新，回复不再次写入正在取消。
- 主进程进度接口明确返回 null，只确认本地操作记录不存在，不说明服务器 Task 或 VM 的结果。前端保存此观察，停止该记录的自动查询和活动计数，隐藏取消入口，并允许移除本地卡片；不删除服务器 Task、VM、partial 或最终文件。IPC 抛错仍作为读取故障重试，不转换为记录不存在。此本地观察随历史恢复，重启不重新启动无依据的查询。
- 取消意图持久保存，重启恢复不会继续一个已经请求取消的导出准备流程。新导入记录明确尚未上传时，可直接确认本地取消并清理空 Task。
- 不向其他资源池发送原引用的取消或清理。恢复后的进度携带当前原池连接 ID，前端更新取消和导航目标。
- 取消入口先加载持久记录，不依赖进度读取已先执行。仍以原操作与提交连接匹配，再按保存的原池 UUID 找到当前连接发送原 Task 的取消请求；缺少原池 UUID 的恢复记录禁止仅凭本地连接 ID 取消。请求取消不等于服务器确认取消。
- 每次恢复重试都重新匹配可用管理连接：优先使用仍属于原池的原连接，原本地连接 ID 失效后按持久保存的池 UUID 查找已连接的原池。一次重连通知到达时即使旧核对仍在运行，后续进度查询也能通过当前连接继续观察原 Task；不依赖旧连接 ID 永久重试，不重放上传。缺少原池 UUID 或只有其他池连接时不推断目标。
- 读取恢复记录显示“本地导入/导出记录已恢复”，不能仅根据恢复流程声称应用发生过重启。无法读取原任务结果时显示静态原因，停止上传动画；弹窗不重复显示同一原因。网络恢复只恢复任务观察，不能续传已经断开的 XVA HTTP 上传。
- 已知导入成功与后续清单刷新失败分别显示。完成后按该次结果返回的当前原池连接刷新 VM、Task 和模板，不使用弹窗创建时保存的旧连接，也不重复刷新 VM。关闭窗口和移除已结束的展示记录不会删除 VM、模板或本地文件。

## 本轮范围与后续验收

当前支持未压缩、包含内联 SHA-1/XXH64 校验的 XVA。压缩选项在主进程明确拒绝，不产生随后必然无法验证的文件。OVA/OVF、磁盘镜像转换、仅磁盘在线快照导出及压缩往返不在本轮扩展范围。旧式仅末尾校验表 XVA 需要另行实现兼容验证。

正式验收仍需真实 XCP-ng/XenServer 的 VM 与模板往返、checkpoint 导出后启动、不同存储后端容量边界、证书/成员重定向、断线/重启时序和大文件测试。没有更新已安装应用或执行真实资源池写操作。

本轮修复对照与验证记录见 [修复记录](reviews/2026-10-23-xva-transfers.md)。本地回归及桌面证据见 `.scratch/import-export-fixes-2026-10-23/`；原始缺陷复现保留于 `.scratch/import-export-review-2026-10-23/`。诊断执行不等同于正式 gate 通过。

## 统一入口（2026-11-04）

导入、导出与其他操作均放入右上角“任务通知”，默认收起，受理及终态不自动展开。折叠不停止串行进度读取；操作窗口继续显示当前对象的反馈。导入配置核对等不可中断阶段保留原因；取消仍须原 Task 确认。已结束或本地记录明确不存在时可删除本地卡片，仍需清理的导出不能删除。删除不取消服务器 Task、不删除对象或归档文件；原导入/导出独立面板展开状态不再恢复。详见[前端规范](frontend-spec.md#统一任务通知2026-11-04)。
