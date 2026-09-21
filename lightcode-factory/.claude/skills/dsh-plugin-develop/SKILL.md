---
name: dsh-plugin-develop
description: 根据原始产品需求设计、实现、打包、安装并验证通用 DSH/Cordis 插件或插件套件，包括 Host Service、Web Client、Remote、Tool、Hook 和 Bundle。为 lightcode-factory 新增或修改组件时不要使用；改用 lightcode-factory-develop。
---

# DSH 插件开发

将用户需求（直接调用时为 `$ARGUMENTS`）实现为满足预期、可独立安装的最小 DSH 插件方案。严格遵循用户请求的任务类型：用户要求设计、诊断或解释时不要擅自改代码；用户直接调用本 Skill 并要求开发时，必须完成实现与验证，不能只输出方案。

## 先建立基础认知

每次使用本 Skill 开发或设计插件时，必须先读取 [DSH 插件与 Cordis 基础](references/00-foundations.md)，并用其中的术语理解需求。不得把 npm 包、Cordis 插件、Service、Browser Client、Bundle、Profile、Patch、Tool、Workflow 和 Skill 混为一谈。

开发时遵循以下原则：

- **扩展而非侵入**：优先通过插件、Service、Tool、Hook、Slot 和 Bundle 组合能力，不修改 DSH Core。
- **最小职责**：一个包只承担清晰职责；只有需要独立配置、生命周期、协议或发布时才拆包。
- **依赖能力**：消费者依赖稳定的 Service key 和公开 exports，不依赖实现类或未公开的深层文件。
- **生命周期对称**：创建的监听、注册、定时器、进程和连接必须在插件释放时完整撤销。
- **状态单一权威**：每种持久状态只能有一个写入者，Web 只展示事实并发送命令。
- **协议先行**：Config、输入输出、Remote、错误、状态机、取消和恢复先定义并测试，再实现页面。
- **安全分层**：Host 保存密钥和权限；Browser 只接收必要数据；不可信代码在进程外隔离。
- **以安装产物为准**：源码可运行不代表插件可发布，最终以真实 tarball 和隔离 Profile 验证结果为准。

## 从已验证事实开始

在设计或编码前：

1. 阅读仓库指令并检查现有变更，保留用户的无关代码和未提交工作。
2. 记录会影响任务的准确版本与环境：DSH CLI、已安装 SDK、Cordis、Node、包管理器、OS、Profile 和 DSH Home。
3. 检查目标版本公开的 package exports、类型声明、插件 manifest、Service key、事件、Slot 和示例。不得依靠记忆猜测 DSH API。
4. 优先使用公开扩展点并创建独立插件 workspace。除非用户明确要求为 DSH 核心贡献代码，否则不得修改 DSH Core。
5. 将版本相关或尚未验证的行为列为风险；没有可运行证据时不得宣称支持。

将新需求转换为架构或选择包边界时，读取 [需求与架构](references/requirements-and-architecture.md)。创建或修改 Service、`inject`、事件订阅、注册表、定时器、Worker 或 disposer 前，继续读取 [Cordis 与生命周期](references/cordis-and-lifecycle.md)。

## 翻译用户需求

提取用户、触发方式、输入输出、持久状态、取消、超时、重试、审批、并发、外部系统、UI、安全、安装、升级和验收要求。信息不足时采用保守默认值：

- 密钥和高权限操作只保留在 Host；
- 前后台只传递有大小限制的 JSON；
- 长任务支持取消；
- 未实现并测试 checkpoint、重试或恢复时，不宣称具备这些能力；
- 先支持一个准确的 DSH 版本；
- 在保持职责清晰的前提下使用最少的包。

只有缺失选择会改变产品行为、状态所有权、安全边界或包拓扑时才向用户提问。其他情况说明假设并继续实现。

根据职责选择扩展形态：

- 模型发起的无状态动作：Tool；
- 拦截、审批、审计或策略：Hook；
- 可复用状态或生命周期：Host Service；
- 多步骤持久任务：建立在 Service 上的 Workflow/Feature；
- 可视化交互：Browser Client + Remote；
- 一次安装多个包：Bundle。

## 实现前确定约定

先定义并测试以下内容，再让实现依赖它们：

- Config 运行时 Schema 和安全默认值；
- Service key、公开方法、注册与释放行为；
- Remote 方法、JSON Schema、错误码、大小限制、revision/sequence；
- 状态机、终态和唯一状态写入者；
- 取消、超时、幂等、并发和重启行为；
- Host/Client 入口、package exports、Browser external 和 Bundle patch；
- 敏感数据和不可信代码的安全边界。

涉及 Host 状态、执行、持久化、队列、取消和停机时，读取 [后台服务](references/backend-service.md)。涉及 wire API 或流式更新时，读取 [Remote 协议](references/remote-contract.md)。

## 按风险顺序实现

除非现有仓库已经提供更安全的固定流程，否则按以下顺序开发：

1. 类型、运行时 Schema、状态转换和单元测试。
2. Host Service、持久化、串行 mutation 和停机流程。
3. Tool/Workflow/Feature 注册以及绑定生命周期的 disposer。
4. Remote 注册及不依赖 UI 的协议测试。
5. 纯 Props React 组件，再接入 Client Store、Slot、本地化和样式。
6. Host/Client 构建产物、package manifest 和 Bundle patch。
7. 真实 tarball 打包以及隔离 Profile 安装。

涉及 Web 时读取 [Web Client](references/web-client.md)。涉及 manifest、Browser external、TypeScript 或构建时读取 [依赖与构建](references/dependencies-and-build.md)。只有新建 workspace 或包结构时才读取 [参考工程骨架](references/reference-scaffold.md)，按需求裁剪，不要复制不需要的包。

## 必须保持的关键约束

- `import`、Cordis `inject` 和 `dsh.client.inject` 是三种不同的依赖机制。
- TypeScript 声明合并不会安装运行时 Service。
- 所有订阅、定时器、注册项、连接和 Worker 都必须绑定生命周期并可释放。
- 停机顺序为：停止接收新任务、取消执行、等待任务和 mutation、刷新并关闭存储。
- 先持久化取消状态，再广播取消信号；晚到结果不得覆盖终态。
- Browser 不得导入 Host 实现，也不得获得凭据或私有执行能力。
- React、Cordis 和具备对象身份的 DSH Client 模块由宿主提供，并从 Browser bundle 中 externalize。
- 不得深层导入 package exports 未公开的实现文件。
- Agent/Tool 沙箱不会隔离宿主进程内的可信插件；不可信插件应放入独立进程或容器。
- 不得假设 Bundle/Profile patch 的 config 会深度合并。

## 打包并验证可安装产物

新增或更新 Bundle、发布 tarball 前读取 [Bundle 打包与安装](references/bundle-packaging-and-install.md)。Workspace 链接不是可发布的依赖闭包：先打包成员，在 staging 中安装真实文件，再打包外层 Bundle。每次发布必须升级版本，不能覆盖同版本 tarball。

先运行仓库自己的检查，再执行适用的验证阶梯：

```text
类型检查
  → Service/状态机单元测试
  → 真实 Loader 组合测试
  → UI 组件测试
  → 构建产物检查
  → 打包
  → 隔离 DSH Home/Profile 安装 + dump-config + 启动
  → 核心路径、取消路径和错误路径
  → 重启与历史数据
  → 升级与卸载
```

验证和诊断时读取 [测试与调试](references/testing-and-debugging.md)。遇到插件 PENDING、页面缺失、旧 Bundle 缓存、重复 React/Cordis、Windows `EPERM`、端口冲突、认证 401、取消竞态或重启问题时，读取 [踩坑手册](references/pitfalls.md)。

构建完成后，在适用时运行 Skill 附带的静态审计：

```bash
node "${CLAUDE_SKILL_DIR}/scripts/audit-dsh-plugin.mjs" <workspace> --built
```

审计警告代表需要人工核查；交付前必须修复所有错误。静态审计不能替代真实的隔离 Profile 安装验证。

## 交付要求

最终结果必须说明：实现结果、包拓扑、准确的 tarball 路径和版本、执行过的检查及结果、安装/启动/升级/卸载命令、持久化数据位置、安全边界、Fixture 的验证范围和未支持能力。明确区分已验证行为和假设。必要的构建、打包或隔离安装检查失败时，不得宣称完成。
