# XAPI `VM.snapshot` 方法签名与版本边界

研究日期：2026-07-13

## 结论

1. XCP-ng 8.2.1 使用的 `xapi` 1.249 系列服务器只接受两个业务参数：`vm`、`new_name`。加上所有常规 XAPI 调用都携带的 `session_id`，XML-RPC/JSON-RPC 线上参数为 3 项。
2. `ignore_vdis` 于 2021-12-07 合入上游 xapi，首个包含该变更的上游 tag 是 `v21.4.0`。它是带空集合默认值的版本化参数，因此新服务器同时接受省略和提供 `ignore_vdis` 的调用。
3. 当前 XenCenter/XenAdmin 的普通“创建快照”动作仍显式调用不带 `ignore_vdis` 的旧重载。它没有针对快照签名做运行时探测或失败重试。
4. `MESSAGE_PARAMETER_COUNT_MISMATCH` 的官方参数顺序是 `method, expected, received`，其中计数不含 `session_id`。`MESSAGE_PARAMETER_TYPE_ERROR` 未出现在本次核验的 xapi-project/XCP-ng 官方错误注册表、服务器源码和官方 C# SDK 中，因而没有可据以说明其参数含义的官方定义。

## 1. 服务器方法签名

### XCP-ng 8.2.1 / xapi 1.249

XCP-ng 官方 `v1.249.41-8.2` 分支的 `VM.snapshot` datamodel 使用固定 `params`，且只有：

```text
vm: VM ref
new_name: string
```

来源：[XCP-ng 8.2 分支 `datamodel_vm.ml`](https://github.com/xcp-ng/xen-api/blob/99351ea5cc07dcdb3d75a7bb571f14739a64b2b6/ocaml/idl/datamodel_vm.ml#L245-L257)。该分支提交标题也明确标识 `xapi: 1.249.38`：[提交 99351ea5](https://github.com/xcp-ng/xen-api/commit/99351ea5cc07dcdb3d75a7bb571f14739a64b2b6)。

因此两个协议上的请求参数均为：

```text
VM.snapshot(session_id, vm, new_name)
Async.VM.snapshot(session_id, vm, new_name)
```

这里 XML-RPC 与 JSON-RPC 的方法业务签名相同；差别只在传输编码。官方使用指南说明绝大多数 API 调用都把 session reference 作为第一个参数：[xapi-project “Authentication and session handling”](https://xapi-project.github.io/xen-api/usage.html#authentication-and-session-handling)。

8.2 的服务器 dispatcher 对无默认值的方法使用精确列表匹配；匹配失败时生成参数数量错误：[XCP-ng 8.2 `gen_server.ml`](https://github.com/xcp-ng/xen-api/blob/99351ea5cc07dcdb3d75a7bb571f14739a64b2b6/ocaml/idl/ocaml_backend/gen_server.ml#L428-L444)。

### 上游 xapi v21.4.0 及以后

上游提交 [`948cdd89`](https://github.com/xapi-project/xen-api/commit/948cdd89ac706b5a96f60f73170b5ca9c7c07afd) 将 `ignore_vdis` 加入 `VM.snapshot`。提交内容把方法改为 `versioned_params`，并为新参数设置 `Some (VSet [])` 默认值。`v21.3.0` 尚无该参数，而 `v21.4.0` 已包含它：[v21.4.0 datamodel](https://github.com/xapi-project/xen-api/blob/v21.4.0/ocaml/idl/datamodel_vm.ml#L245-L257)。

2024 年提交 [`29f844cc`](https://github.com/xapi-project/xen-api/commit/29f844cc62c30e2b0ba9513e6d53050595c64a18) 将原先的 `next_release` 明确改成 `numbered_release "21.4.0"`。当前上游定义为：

```text
vm: VM ref                 required
new_name: string           required
ignore_vdis: set(VDI ref)  optional, default []
```

来源：[当前上游 `datamodel_vm.ml`](https://github.com/xapi-project/xen-api/blob/7dffaf0b37308b790c6c0c9748f709412b227fed/ocaml/idl/datamodel_vm.ml#L476-L499)。

新服务器生成器把必填参数与尾部 `default_args` 分开；缺少可选参数时从 datamodel 取默认值：[当前上游 `gen_server.ml` 参数匹配](https://github.com/xapi-project/xen-api/blob/7dffaf0b37308b790c6c0c9748f709412b227fed/ocaml/idl/ocaml_backend/gen_server.ml#L59-L110)、[默认值解码](https://github.com/xapi-project/xen-api/blob/7dffaf0b37308b790c6c0c9748f709412b227fed/ocaml/idl/ocaml_backend/gen_server.ml#L183-L205)。因此支持该参数的新服务器可以接受：

```text
VM.snapshot(session_id, vm, new_name)
VM.snapshot(session_id, vm, new_name, ignore_vdis)
```

这也说明：生成 C# SDK 中的 `First published in Unreleased` 注释不能单独作为服务器是否支持该参数的版本证据。它来自参数仍标为 `next_release` 时生成的 SDK；上游 datamodel 后来已把发布版本校正为 `21.4.0`。

## 2. XCP-ng 产品版本边界

| 服务器线 | 官方源码状态 | 可接受的业务参数 |
| --- | --- | --- |
| XCP-ng 8.2.1 / xapi 1.249 | 固定 `params`，无 `ignore_vdis` | `vm, new_name` |
| XCP-ng 8.3 分支 | `ignore_vdis` 为默认 `[]` 的版本化参数 | `vm, new_name`，或 `vm, new_name, ignore_vdis` |
| 上游 xapi v21.3.0 | 无 `ignore_vdis` | `vm, new_name` |
| 上游 xapi v21.4.0+ | 引入可选 `ignore_vdis` | 两种形式均可 |

XCP-ng 8.3 的直接来源：[官方 8.3 分支 `datamodel_vm.ml`](https://github.com/xcp-ng/xen-api/blob/77b4bae8510f9ae28a17d8a84a3c22fa9079cd67/ocaml/idl/datamodel_vm.ml#L459-L505)。

## 3. 参数数量错误的官方语义

XCP-ng 8.2 官方 datamodel 将错误参数注册为：

```text
MESSAGE_PARAMETER_COUNT_MISMATCH(method, expected, received)
```

来源：[XCP-ng 8.2 `datamodel_errors.ml`](https://github.com/xcp-ng/xen-api/blob/99351ea5cc07dcdb3d75a7bb571f14739a64b2b6/ocaml/idl/datamodel_errors.ml#L80-L92)。服务器帮助函数按同一顺序返回它们：[XCP-ng 8.2 `server_helpers.ml`](https://github.com/xcp-ng/xen-api/blob/99351ea5cc07dcdb3d75a7bb571f14739a64b2b6/ocaml/xapi/server_helpers.ml#L67-L72)。

dispatcher 计算 `received` 时会从线上参数总数减去 session 参数，故错误中的 `expected` 和 `received` 均是业务参数数目，不含 `session_id`：[XCP-ng 8.2 `gen_server.ml`](https://github.com/xcp-ng/xen-api/blob/99351ea5cc07dcdb3d75a7bb571f14739a64b2b6/ocaml/idl/ocaml_backend/gen_server.ml#L436-L443)。

因此：

```text
[MESSAGE_PARAMETER_COUNT_MISMATCH, VM.snapshot, 2, 3]
```

严格表示：服务器的 `VM.snapshot` 需要 2 个业务参数，但收到了 3 个。这一错误本身不说明第三个参数的值或类型，只说明数量不符。

### `MESSAGE_PARAMETER_TYPE_ERROR`

本次在以下一手来源中均未找到 `MESSAGE_PARAMETER_TYPE_ERROR`：

- xapi-project 当前源码及可达 Git 历史；
- XCP-ng 8.2、8.3 官方服务器树；
- XenServer/XenCenter 官方 C# SDK 的 `Failure` 常量。

官方可确认的相邻错误是 `FIELD_TYPE_ERROR(field)` 与 `XMLRPC_UNMARSHAL_FAILURE(expected, received)`，见同一份 [XCP-ng 8.2 错误注册表](https://github.com/xcp-ng/xen-api/blob/99351ea5cc07dcdb3d75a7bb571f14739a64b2b6/ocaml/idl/datamodel_errors.ml#L80-L92)。因此不能把 `MESSAGE_PARAMETER_TYPE_ERROR` 当作已有官方 XAPI 错误并推断其参数含义。

## 4. XenCenter/XenAdmin 如何调用

当前 XenServer 官方 XenCenter 源码的普通快照动作直接调用：

```csharp
VM.async_snapshot(Session, VM.opaque_ref, _newName)
```

来源：[XenServer XenCenter `VMSnapshotCreateAction.cs`](https://github.com/xenserver/xenadmin/blob/b210cd2c2d8547f5bb48b49d71f17429c7d65e44/XenModel/Actions/VM/VMSnapshotCreateAction.cs#L98-L108)。

同一 SDK 同时生成了三参数业务重载和带 `ignore_vdis` 的四参数业务重载（C# 方法还显式包含 `Session`）：[XenServer XenCenter `VM.cs`](https://github.com/xenserver/xenadmin/blob/b210cd2c2d8547f5bb48b49d71f17429c7d65e44/XenModel/XenAPI/VM.cs#L2358-L2406)。但是普通创建快照动作固定选择旧重载；没有在该动作里先探测服务器版本，也没有在参数数量错误后切换签名。

仓库内参考代码行为相同：[`refs/xenadmin/XenModel/Actions/VM/VMSnapshotCreateAction.cs`](../../refs/xenadmin/XenModel/Actions/VM/VMSnapshotCreateAction.cs#L98-L108)。

作为对照，官方客户端确实会在 `session.login_with_password` 中捕获 `MESSAGE_PARAMETER_COUNT_MISMATCH` 并回退旧签名；但该策略只在登录方法中明确实现，不能外推到 `VM.snapshot`：[XenCenter `Session.cs`](https://github.com/xenserver/xenadmin/blob/b210cd2c2d8547f5bb48b49d71f17429c7d65e44/XenModel/XenAPI/Session.cs#L353-L394)。

## 5. 现场验证（非文档推断）

在两台 XCP-ng 8.2.1、XAPI API 2.16 服务器上，用无效对象引用 `OpaqueRef:NULL` 直接调用 `VM.snapshot`：

- 传 2 个业务参数时进入对象校验并返回 `HANDLE_INVALID`，证明参数数量已被 dispatcher 接受；
- 传 3 个业务参数时返回 `[MESSAGE_PARAMETER_COUNT_MISMATCH, VM.snapshot, 2, 3]`。

现场结果与 XCP-ng 8.2 官方 datamodel 和 dispatcher 完全一致。它证明这两台具体服务器使用二业务参数签名；并不依赖 C# SDK 注释或客户端错误文案作推断。

## 6. 本研究可以与不可以证明什么

可以证明：XCP-ng 8.2.1 的 `VM.snapshot` 不接受 `ignore_vdis`；错误数组中的 `2,3` 是不含 session 的期望/实收业务参数数目；官方 XenCenter 普通快照动作使用旧签名。

不能仅凭这些资料证明：任意未知版本服务器都只接受旧签名，或任意参数错误文案都由参数数量引起。对未知服务器必须先取得原始 XAPI 错误数组和服务器/API 版本，再与对应版本 datamodel 核对。
