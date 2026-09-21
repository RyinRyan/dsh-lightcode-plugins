# 核心契约：Contracts、Runtime、Storage、Workflow 与 Web 的边界

本文件只描述应长期稳定的规则，不记录具体版本号、依赖版本、限制值、CSS 数值或当前实现文件的偶然细节。

## 1. 产品模型

LightCode Factory 是统一运行底座：

- Contracts 负责共享类型、runtime schema、Workflow/Repository Port 和 Remote；
- Runtime 负责 Workflow 注册、任务接纳、调度、状态转换、取消、评审和 Browser 接口；
- Storage 实现 Contracts 定义的 Repository Port，负责 durable 事务、查询、migration、备份和生命周期；
- Web 负责工作流选择、统一看板、运行详情、节点输出、事件时间线和轨迹；
- 业务 Workflow 是独立注册单元，只负责参数、顺序节点、业务执行、节点输出和节点内部观测；同发布、权限、依赖和生命周期边界的内置 Workflow 组成一个 Catalog Host 包。

Runtime 是 durable run 状态和生命周期的唯一决策者；Storage 是基础设施适配器；Web 是统一 Browser 投影；Workflow 是业务执行扩展；Contracts 是跨组件契约权威。Factory Bundle 只负责安装装配。

Workflow 的“可插拔”含义是：Catalog 或独立包安装并装配后出现，卸载后注销；不复制底座、不改变其他 Workflow，也不要求专属页面才能运行。

## 2. 组件选择与平台扩展

满足以下条件时属于普通 Workflow：

- 现有参数契约可以表达输入；
- 可以拆成底座支持的顺序节点；
- 节点结果可以表达为有界 JSON-safe output 或 artifact 引用；
- 内部过程可以表达为 observation；
- 可以复用统一运行详情和轨迹；
- 可以接受底座现有的状态、取消和评审语义。

出现以下任一情况时，先判定为平台能力扩展：

- DAG、并行分支、循环、动态节点或条件跳过；
- 自动重试、checkpoint、断点恢复、幂等启动键或分布式调度；
- 现有参数类型无法表达的上传、复杂表单或凭据输入；
- 新的 run 状态、持久化字段、Remote 命令或权限模型；
- 统一页面无法表达的专属交互；
- Workflow 需要直接拥有任务状态或绕过 Runtime。

底座扩展必须按职责选择组件：契约进入 Contracts，执行/状态/Remote Host 进入 Runtime，持久化进入 Storage，共享 Browser 表达进入 Web，业务节点留在 Workflow。

## 3. 强制不变量

### 插件边界

- 同发布、权限、依赖和生命周期边界的内置 Workflow 可以进入一个 Catalog 包；边界不同的 Workflow 必须独立成包。
- 只依赖 Contracts 公开 exports 和正式声明的宿主服务。
- 不导入其他包 `src/*`、Web 组件或 DSH 深层实现。
- 默认不提供 Browser Client；统一页面由 Web 提供。
- 注册和注销必须遵循 Cordis 生命周期。

### 状态所有权

- Runtime 是 run 状态和生命周期事件的唯一决策者。
- Workflow 不修改 run 状态，不发送 run 生命周期事件，不建立第二套持久状态机。
- 节点失败通过抛错表达，取消通过共享信号表达，完成和评审由 Runtime 判定。
- `scheduledFor` 表达通用的一次性接纳计划；Workflow 既不校验计划时间，也不创建 timer、到点入队或重启恢复。

### Contracts 与 Runtime 契约

- 共享 JSON 类型、持久化 runtime schema、Remote wire schema、Host 实现和 Browser facade 必须协同演进。
- 同一 run 的 durable mutation 必须串行；取消、卸载、停止和晚到结果不得产生第二个终态。
- 新增 durable 字段必须同步 type、schema、Repository、Storage、Remote 与消费者。
- Runtime 只提供跨 Workflow 的通用能力，不得按 Workflow id 或业务节点分支。

### Storage 契约

- Contracts 定义异步 Repository Port；Storage 与 Runtime 依赖公开 Port，Runtime 不依赖具体数据库。
- Storage 只保存 Runtime 已决定的聚合，不实现状态机或业务校验。
- 聚合写入必须事务化，陈旧更新必须通过 revision 或等价机制拒绝。
- schema migration、历史导入、备份和回滚必须可测试；禁止长期双写形成两个权威状态。
- SQLite 仅用于单机本地持久卷，不得描述为共享文件系统上的多主数据库。

### Web 契约

- Web 只消费 Runtime Browser Client 的有界 page/detail 和 command facade，不访问 Host、Storage 或 Workflow 实现。
- Web 不写 run/node 状态，不复制状态机，不把本地 UI 状态冒充 durable 状态。
- 新 renderer 必须基于跨 Workflow 的公开字段语义，并保留未知 JSON 的安全回退。
- 交互需要可访问的键盘/语义替代，并覆盖 loading、error、review 与终态。

### 节点执行

- 声明节点与执行节点一一对应，顺序一致。
- 每个节点通过公开的节点执行 API 包裹。
- 不得跳过、偷偷并行或启动脱离生命周期的后台任务。
- 模型、工具、网络请求和子进程必须接收取消信号并释放资源。

### 数据和安全

- 参数、输出和观测均可能被持久化或发送给 Browser，应按可见数据处理。
- 参数不得承载密码、Token、私钥或其他 credential。
- 输出必须有界且 JSON-safe；大结果使用 artifact 引用。
- 观测不得包含 secret、完整私有 prompt、不必要的个人数据或内部堆栈。

### 统一页面

- `node.output` 表示节点最终结果，显示在运行详情。
- observation 表示内部执行过程，显示在轨迹。
- 点击节点必须切换到该节点的输出。
- 未知输出形状必须能通过通用回退显示。
- 不得按 Workflow id、包名或节点名称增加共享页面特例。

### 设计和交付

- Workflow 行为代码前必须存在 `.design/workflows/<workflow-id>.md`；Contracts/Runtime/Storage/Web/跨组件代码前必须存在 `.design/changes/<change-id>.md`。
- 实现变化必须同步设计。
- 相关的 `docs/architecture.md`、`README.md` 和 Skill reference 必须随代码刷新。
- 测试、文档审计、接线、构建和适用的打包/隔离安装/真实交互未全部通过时，不得声明完成。

## 4. 七个 Gate 的通过条件

| Gate | 通过条件 | 不通过时 |
| --- | --- | --- |
| 当前事实 | 源码、测试、manifest 与适用文档已读 | 停止猜测，完成探索 |
| 组件选择 | Contracts/Runtime/Storage/Workflow/Web/跨组件职责明确 | 重新分类，不在错误层绕过 |
| 设计 | 对应设计完整，契约、兼容、文档和验收自洽 | 补充设计，不写代码 |
| 实现 | 依赖单向、状态唯一、无业务特例和私有越界 | 回退到公开契约实现 |
| 文档与接线 | 架构/使用/Skill 文档及 workspace/Bundle 接入同步 | 补齐后再测试 |
| 验证 | 分层自动化和适用的真实 DSH 核心交互均有证据 | 明确失败项，不宣称完成 |
| 交付 | 设计、版本、产物、文档、验证和限制可追溯 | 补齐交付信息 |
