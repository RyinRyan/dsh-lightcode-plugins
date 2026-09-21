# 独立发布改造

## 目标与边界

DSH 是未修改的宿主，LightCode Factory 是独立安装包。0.3 Bundle 包含 Contracts library、Runtime、SQLite Storage、Workflow Catalog 和 Web 五个成员包；安装入口只提供组合配置。用户模型配置不迁移。

## 接口与装配

Runtime 拥有任务状态决策、调度和评审，持久化通过 Contracts 的 `WorkflowRunRepository` Port 下沉到 SQLite Storage。Storage 只负责事务、一致性、分页、备份和查询，不解释状态机。Workflow Catalog 通过 `registerWorkflow` 注册完整实现，按顺序等待 `context.node`；节点通过 `report`/`log` 上报有界观测并响应 `AbortSignal`。

Runtime Browser Client 通过原生 Remote `$mount` 注册 `factory` namespace；Web 通过原生 Slots 注册面板和侧栏，不修改宿主页面。Remote v2 使用 catalog、有界 run page、单条 detail 和 command，不再提供全历史 snapshot。

构建使用公开 npm 依赖、TypeScript 及 esbuild。通信 schema 与 Typert 注册描述由插件自身统一声明，避免公开生成器只能识别源码工作区依赖的问题。浏览器产物遵守 DSH ModuleLoader factory 格式，共享 React 和 Cordis，不私自携带第二份框架实例。包中不引用相邻 DSH 源码。

## 发布与安全

安装入口携带五个成员包的构建产物；Contracts 只作为 library bundle，不在 Cordis patch 中启动。tarball 验证完成后才能作为发布候选。不触碰用户默认 DSH home，不把测试模型注入用户配置。原生工具与生成脚本继续使用 DSH 权限策略。

安装包依赖进程内可信插件机制，不承诺隔离恶意第三方插件。当前仅支持顺序节点；无断点续跑和自动重试。卸载不自动删除 SQLite 历史。0.3 不向前兼容旧 JSON、0.2 SQLite、旧包名、旧 Service 或 Remote v1；升级需要新数据库，回滚需要恢复旧 Bundle 和旧数据库副本。

## 验证记录

2026-09-16，在官方 CLI 0.1.5-rc.1 / SDK 0.1.5-rc.2、Node 24.11.0、Windows 环境完成：

- 独立 TypeScript/esbuild 构建与单元/组合/UI 测试。
- 打包为一个内含当时三个业务插件的 tgz，通过原生 `dsh plugin add` 安装到隔离 profile；无需启动时产品 patch。
- 看板和任务选择器加载成功；原生 Agent 调用测试工具，观测页展示工具参数和返回值；模型产出代码并启动真实 Node 进程，stdout 为 `{"sum":28}`、exitCode 为 0。
- 人工评审转为已完成；去掉测试模型 patch 后重启，已完成历史保留。
- 原生 `dsh plugin remove` 移除安装入口和 profile 装配；历史数据保留。
- 0.1.1 将运行详情调整为 DSH Trajectory 风格：三泳道时序概览、节点分组事件账本、搜索和记录检查器；仍通过 Factory observation 协议保持与 DSH Session 内部实现解耦。
- 0.1.2 恢复原型中的运行详情三栏布局，内部执行过程仅在“轨迹”页展示，运行详情只呈现节点状态、最终输出、运行信息、整体进度和事件时间线。
- 0.1.3 优化运行详情视觉层级：进度置顶、移除大面积灰底、节点输出改为单开折叠，并限制长内容和事件时间线的高度。
- 0.1.4 将事件时间线移至三栏内容下方并采用多列紧凑布局，消除右栏过长导致的左侧大面积留白。
- 0.1.5 按三排结构重构运行详情：进度与横向节点轨道、节点选择与 IDE 输出及运行信息、可折叠的纵向事件时间线。
- 0.2.0 新增独立 Storage 插件和 `WorkflowRunRepository` 端口，默认使用 SQLite；已在隔离 profile 中验证安装、启动、建表和 schema migration，并使用旧 JSON 副本验证全部运行记录导入、备份和幂等行为。浏览器与 Backend 的 Remote v1 协议保持不变。
- 0.3.0 将共享契约抽入 Contracts，Backend 更名 Runtime，Platform 更名 Web，两个内置 Workflow 合并为 Catalog，SQLite Adapter 名称显式包含介质；Remote v2 改为有界 seek pagination 与独立 detail，并增加 SQLite 在线备份/恢复验证。该版本是明确的破坏性升级。
- 0.3.0 候选 Bundle 已在全新隔离 profile `factory-03` 安装、启动并完成发布就绪 Workflow 的创建、运行详情、9 条轨迹、评审通过和完成态闭环；390×844 窄屏无根级横向溢出。实际数据库 `user_version = 1`，包含五张 Factory 表和三个 run 查询索引，在线备份后从副本重开读取的 3 条 run 与源库一致。全量测试为 6 个文件、22 项，候选包 SHA-256 为 `7A214CF77054A1D141734F79DE2EC3C3C637DF19770AF6E519A68CB3DBA8F8F4`。
- 0.4.0 增加一次性 `scheduledFor`：立即任务保持原协议行为，定时任务以 queued 持久化，到点才入执行队列；取消、Workflow 卸载/重注册和 Host 重启均由 Runtime 按 durable 状态收口。SQLite 从 `user_version = 1` 原地迁移到 2，新增 nullable `factory_runs.scheduled_for`；回滚 0.3 必须恢复迁移前备份。晨间脚本的 Agent 非完成错误会提示检查当前 DSH 模型/API Key，但 Factory 不管理凭据。最终验证证据见 `.design/changes/scheduled-workflow-runs.md`。

测试模型是单独、未打包的确定性 adapter，不代表真实外部模型已联调。生产插件不修改权限配置。测试使用隔离 home，并仅针对已知脚本启用测试执行权限。原 `dsh` 目录和用户 settings.yaml 未由本次迁移修改。
