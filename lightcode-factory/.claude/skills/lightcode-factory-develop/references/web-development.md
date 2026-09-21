# Web 开发规范

Web 是共享 Browser 展示层，负责 Workflow Catalog、六状态看板、任务创建、运行详情、轨迹、分页和用户命令。它只消费 Runtime Browser Client 与 Contracts 类型，不拥有执行或持久化状态。

## 1. 组件边界

- Browser 注册入口负责 locale、slot 和依赖注入；资源跟随 Cordis lifecycle。
- Board 负责页面编排和命令触发，不复制 Runtime 状态机。
- RunOverview 展示节点 output/error 和生命周期事件；RunTrace 展示 observation。
- CSS 属于插件自身，不污染宿主全局样式。
- Web 不导入 Storage、Host Runtime 或具体 Workflow。

## 2. 数据与命令

- 只从 `FactoryClientSnapshot` 派生 UI。
- `refresh/loadMore/getRun/start/cancel/review` 通过 Runtime Browser Client 调用。
- 首屏与轮询必须有界；只有存在 `nextCursor` 才显示加载更多。
- 打开详情先用已有 page 投影响应，再调用 `getRun` 刷新最新聚合。
- 新展示字段先扩展 Contracts/Runtime，不读取私有对象。
- `datetime-local` 表示浏览器本地时间，提交前转为 ISO；Web 可做即时校验，但未来时间与执行资格仍由 Runtime 判定。
- 未知 output/observation 必须安全回退。

## 3. 通用展示与可访问性

- renderer 禁止按 workflowId、包名、节点 id 或中文名称分支。
- 节点轨道承担进度和输出选择；只有真实溢出时显示横向导航。
- 运行详情展示结果，轨迹展示过程。
- loading、empty、error、loading-more、queued、running、review 和终态都有可理解表现。
- 使用语义化 button/form/nav/main/label；对话框支持焦点、Escape、防重复与错误反馈；状态不能只靠颜色表达。

## 4. 测试与完成

覆盖 definition 表单、立即/定时提交与本地时间转换、命令 pending/error、六状态看板、计划时间展示、分页按钮、详情刷新、节点切换、JSON 回退、轨迹筛选/检查器、对话框键盘与 ARIA、无溢出/真实溢出。完整浏览器验收必须在 DSH 原生桌面页面和较窄窗口完成。

完成前确认无状态写入、业务特例、Storage/Host 私有导入；locale、slot、timer/listener disposer、构建 external、architecture、统一页面契约和 README 已同步。
