# 模板显示与磁盘清理

统一列表默认只显示虚拟机和用户模板，系统自带模板可通过类型筛选显示。创建向导继续提供系统模板。

删除模板增加默认不勾选的“同时删除所属硬盘”。每次打开窗口或切换模板都使用独立状态，避免继承上次的磁盘删除选择。提交期间禁止关闭、修改选择或重复提交。模板已删除后如果磁盘保留或清理失败，窗口列出具体 VDI 引用，并禁止再次提交模板删除；刷新清单失败单独展示。

后端识别 XAPI provisioner 使用的空字符串 `owner` 标记及已有的 `owner=true` 标记；`owner=false` 和无标记继续保留。模板磁盘清理要求 Disk/RW、唯一 VBD、非共享、非只读、非快照且无当前操作。光驱介质不删除，读取失败不开始删除。模板记录由 XAPI 确认删除后才执行 VDI 清理。快照自身的快照 VDI 清理仍沿用原规则，已有回归改用实际快照/只读标志验证此边界。

## 官方依据

- [XAPI 模板 provisioner](https://github.com/xapi-project/xen-api/blob/master/ocaml/xapi/xapi_templates.ml)：新建磁盘的 VBD 使用空字符串 `owner` 标记。
- [XO 模板管理](https://docs.xen-orchestra.com/vm-templates)：模板记录删除与关联 VDI 清理需要分别处理。
- [XenAdmin/XenCenter 删除确认](https://github.com/xenserver/xenadmin/blob/master/XenAdmin/Dialogs/ConfirmVMDeleteDialog.cs)：区分光驱与磁盘，检查其他 VM 是否使用同一 VDI，并提供显式磁盘选择。

## 本地验证

固定 Node 24.22.0 / npm 11.19.1 下，最终代码的相关服务与组件测试为 122 项，结果见 [专项测试](focused-test-gate.json)；全量门禁通过 199 个文件、2232 项测试，严格收集清单无漂移，零失败、跳过、todo、warning/stderr，见 [全量门禁](full-test-gate.json)。Node/Web 类型检查、完整 lint、生产构建及 `git diff --check` 通过。规范、桌面工作流与严格测试收集清单同步更新。

离线真实 React App 在浅色/深色和 1024×768、1280×800、1440×900、1920×1080 共 8 组场景中验证：系统模板默认隐藏、类型筛选可显示与隐藏、硬盘默认保留、勾选后果可见、Escape 关闭、再次打开立即清除勾选，以及页面/窗口无横向溢出。检查实际主题属性及页面错误。记录见 [界面验证](visual-verification.json)，对应截图与本文件同目录。

所有浏览器检查均使用隔离夹具，没有提交删除请求，没有连接真实 XCP-ng。未打包、安装、发布或提交代码；本地模拟、类型检查与构建不能代替真实资源池删除验收。
