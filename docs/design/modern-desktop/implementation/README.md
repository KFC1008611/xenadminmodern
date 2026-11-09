# React 前端落地与验证

日期：2026-10-23。实际前端按[界面规范](../../../frontend-spec.md)迁移，项目 [AGENTS.md](../../../../AGENTS.md) 已引用规范。深浅色入口统一放在顶部「外观」菜单，连接页使用同一控件，选择在本机保存。原 HTML 继续作为视觉参考。

侧栏、顶部上下文、主列表、详情、表单、弹窗、图表及任务浮层统一使用语义颜色。虚拟机列表保留快捷电源按钮，其余动作放入带文字的更多操作菜单；操作范围、能力保护和危险操作确认保留。

根据后续要求精简常规界面文案：正常读取不再显示成功条；删除重复范围说明、清单标题条、空泛引导和零模板类别。禁用提示直接说明不可用的操作，内部批次、审计编号和实现阶段不进入常规提示。读取异常、旧数据时间、重试入口、禁用保护和操作后果保留。

## 浏览器验证环境

使用[固定数据入口](../../../../tests/visual/frontend-theme.html)加载真实 React App、路由、页面和组件；[fixture](../../../../tests/visual/frontend-theme.tsx)仅提供显式读取方法，不安装 Electron IPC，不连接真实 XAPI，不执行服务器写操作。页面标题标明固定测试数据，资源地址使用文档示例地址。

在仓库根目录、项目要求的 Node.js 24.22.0 / npm 11.19.1 环境运行：

```sh
npm run dev:visual
```

打开 `http://127.0.0.1:4178/tests/visual/frontend-theme.html#/pool/prod/vms`。添加 `?disconnected` 可检查连接页，添加 `?read-error` 可检查读取失败。预览服务仅绑定本机。

## 布局与交互

在内置浏览器验证四组桌面尺寸：1024×768、1280×800、1440×900、1920×1080。每组覆盖深浅两种主题及 12 个路由，共 96 条布局记录；逐条检查实际主题、文档及内容区宽度、顶部外观入口，全部通过。表格可在内部横向滚动，未扩大页面。路由包括仪表盘、主机、虚拟机、存储、网络、任务、批量任务、用户与权限、资源池管理、告警、主机详情、虚拟机详情。

另检查了主题刷新恢复、外观菜单键盘关闭、任务浮层展开时切换主题、读取异常展开后切换主题、连接页两主题、添加服务器表单打开与取消、创建向导的模板及名称步骤、存储和网络详情、仪表盘图表展开。强制关闭确认只打开并取消，取消后焦点回到原行操作按钮；向导取消后也返回原按钮。浏览器未记录警告或脚本错误。

发现并修正的层级问题：顶部菜单曾被正文读取状态或任务浮层覆盖，导致选项存在但无法点击。顶栏调整到 45 层，位于任务浮层之上、模态弹窗之下，并验证实际主题变化。

[浏览器记录](browser-validation.json)保存布局与交互结果；[颜色对比记录](contrast-validation.json)覆盖 70 组正文、辅助文字、按钮、状态文字及其背景，最低比值 4.579:1。该计算不包含禁用控件透明度、边框、图标和图表线条。

## 截图

- 虚拟机列表：[浅色](virtual-machines-light.jpg)、[深色](virtual-machines-dark.jpg)、[并排对比](theme-comparison.jpg)
- 顶部外观：[深色菜单](appearance-menu-dark.jpg)、[任务浮层展开时](appearance-over-task-panel.jpg)
- 任务浮层：[浅色](export-panel-light.jpg)、[深色](export-panel-dark.jpg)
- 连接页：[浅色](connect-light.jpg)、[深色](connect-dark.jpg)、[连接表单](add-server-light.jpg)
- 详情与反馈：[虚拟机](vm-detail-dark.jpg)、[存储](storage-detail-dark.jpg)、[网络浅色](network-detail-light.jpg)、[网络深色](network-detail-dark.jpg)、[读取异常](read-error-dark.jpg)
- 表单与确认：[创建向导](create-vm-light.jpg)、[强制关闭确认](force-shutdown-confirm-light.jpg)、[仪表盘](dashboard-dark.jpg)、[展开图表](dashboard-metrics-dark.jpg)

## 源码检查与边界

最终检查结果见 [verification.json](verification.json)：当前工作区 193 个测试文件、1943 项测试全部通过，无跳过项、警告或 stderr；前端与主进程类型检查、lint、构建及差异空白检查通过。界面自动化覆盖主题保存、系统初始偏好、存储异常、菜单键盘行为、禁用动作、资源池范围、危险操作确认和取消回焦。

本轮交付为源码与本机构建 bundle；未替换已安装应用，未生成正式安装包，未进行真实 XCP-ng 写操作或实机验收。浏览器 fixture 的演示资源和任务不进入产品。
