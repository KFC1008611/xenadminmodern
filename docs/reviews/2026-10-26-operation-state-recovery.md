# 操作状态残留修复（2026-10-26）

## 研究依据

- [XAPI Task API](https://xapi-project.github.io/xen-api/classes/task.html)：`cancel` 只是请求，任务可以成功、失败或稍后取消；`destroy` 销毁 Task 对象。展示终态不能由取消请求的受理回复决定。
- [Xen Orchestra Task API](https://github.com/vatesfr/xen-orchestra/blob/master/packages/xo-server/src/api/task.mjs)：分别调用 `task.cancel`、`task.destroy`，没有把二者合并。当前修复的本地记录移除不会调用任一服务器写接口。
- [XenAdmin HistoryPage.cs](https://github.com/xenserver/xenadmin/blob/b210cd2c2d8547f5bb48b49d71f17429c7d65e44/XenAdmin/TabPages/HistoryPage.cs#L323-L368)：已结束事件可以移除；移除操作更新 `ConnectionsManager.History`。本轮请求的 XenCenter 文档链接实际返回首页，故采用已固定版本的官方源码核对，没有将重定向首页作为有效证据。
- [Zustand 持久化指南](https://github.com/pmndrs/zustand/blob/main/docs/reference/integrations/persisting-store-data.md)：`partialize` 选择持久字段，`merge` 合并恢复状态。当前实现不保存弹窗打开和瞬时提交忙碌标志；恢复旧版本操作时保留历史与原池身份，释放终态向导引用。
- 网卡不存在的判断沿用项目 `mutation-result.ts` 中仅将 `HANDLE_INVALID` 作为删除证据的约定。超时、权限不足、空清单及跨池连接均不用于清除防重复提交记录。

## 修改

1. 导入终态记录留在历史，重新打开向导进入新草稿。移除当前记录时同步清除向导引用，兼容旧版缺少 history 的持久数据，保留原池 UUID 和文件信息。原受理回复未返回时禁止清空草稿；旧预览请求用序号失效，晚到结果不覆盖新选择。
2. 导入、导出收到本地进度 null 后保存 `recordMissing`，停止轮询、动画和活动计数，允许仅移除本地记录。IPC 抛错继续按原读取重试。不会将本地记录丢失标为服务器成功、失败或取消。
3. 导出取消意图在请求发出前更新；取消回复不再回写正在取消，迟到失败不污染已确认终态。导入和导出 store 拒绝旧活动状态覆盖既有终态。
4. 网卡删除成功或原池已知 VIF 明确 `HANDLE_INVALID` 后，保存已删除标记；新的请求可以创建，旧请求 ID 仍禁止重放。创建与删除的较晚回执不能复活记录，其他资源池的相同引用不受影响。原请求仅发生读取故障时仍冻结参数并保留恢复路径。

## 验证

固定 Node 24.22.0 / npm 11.19.1，7 个文件、89 项测试通过，无失败、跳过、todo 或 stderr。新增 31 项覆盖终态重新打开、历史移除与旧存储恢复、记录不存在和 IPC 读取故障的区别、迟到取消/进度、已删除请求防重放、新建解锁、权限及连接隔离。Node/Web 类型检查、完整 lint 和差异格式检查通过。

完整门禁通过 199 个文件、2211 项测试，严格收集清单无漂移，零失败、跳过、todo、warning 或 stderr；生产 bundle 构建通过。[完整门禁结果](2026-10-26-operation-state-recovery/full-test-gate.json)保存机器可读证据。

真实 React App 使用离线夹具和独立 Chrome 临时配置，在 1024×768、1280×800、1440×900、1920×1080 的浅色、深色共 8 组场景中验证：外观菜单在任务浮层可见时能够切换主题；失联记录停止活动计数和进度动画；重新打开终态导入进入新草稿并保留历史；移除本地记录不调用服务器取消接口。页面无横向溢出、弹窗和任务浮层处于视口内，renderer 无异常。[界面结果](2026-10-26-operation-state-recovery/visual-verification.json)、[浅色任务面板](2026-10-26-operation-state-recovery/light-1024-panels.png)、[深色新导入](2026-10-26-operation-state-recovery/dark-1024-new-import.png)可复查。

上述为本地模拟验证。未执行真实资源池写入，也未提交、打包、安装或替换当前应用。
