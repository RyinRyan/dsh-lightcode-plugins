# LightCode Factory Agent 开发规范

本文件适用于整个仓库。修改前必须读取本文件、`README.md`、`docs/architecture.md` 和 `.claude/skills/lightcode-factory-develop/SKILL.md`。当前源码、Contracts、测试、manifest、lockfile 和构建脚本是事实来源；文档冲突时在同一变更修正。

## 1. 开发视图

| 组件 | 目录 / 包 | 职责 | 不应承载 |
| --- | --- | --- | --- |
| Contracts | `packages/contracts` / `lightcode-factory-contracts` | JSON-safe 类型、Zod schema、Workflow/Repository Port、Remote | Service、SQL、React、文件系统 |
| Runtime | `packages/runtime` / `lightcode-factory-runtime` | 注册、接纳、调度、状态决策、取消、评审、恢复、Remote Host、Browser Client | SQL、业务特例、页面布局 |
| SQLite Storage | `packages/storage-sqlite` / `lightcode-factory-storage-sqlite` | schema、事务、revision、seek 分页、索引、备份、连接生命周期 | 状态转换、调度、Workflow 分支 |
| Workflow Catalog | `packages/workflows` / `lightcode-factory-workflows` | 内置业务参数、顺序节点、执行、output、observation | 状态机、Repository、专属页面 |
| Web | `packages/web` / `lightcode-factory-web` | Catalog 表单、六状态看板、分页、详情、轨迹、命令交互 | 业务执行、状态写入、存储访问 |
| Factory Bundle | `packages/factory` / `lightcode-factory` | 安装清单、成员依赖、patch 与发布装配 | 业务、状态、SQL、UI 逻辑 |

需求跨组件时按 `Contracts -> Runtime/Storage -> Runtime Client -> Web/Workflows -> Bundle` 演进。不得为少改一个包把 Runtime 能力写进 Workflow，或在 Web 按 workflowId 写业务分支。

## 2. 命名与目录规范

- 组件目录用角色名；npm 包统一 `lightcode-factory-<role>`，具体 Adapter 写出介质。
- Cordis Host service：`lightcodeFactoryRuntime`、`lightcodeFactoryRunRepository`；Browser service：`lightcodeFactoryClient`。
- Workflow id 与目录使用 kebab-case，位于 `packages/workflows/src/catalog/<workflow-id>/`。
- 内置、同发布/权限/依赖边界的 Workflow 放入 Catalog；边界不同才建立独立包。
- UI 组件使用职责名，如 `FactoryBoard`、`RunOverview`、`RunTrace`，不使用历史 Backend/Platform/Demo 命名。
- 禁止旧包/service/Remote alias；破坏性演进通过版本和明确迁移策略处理。

## 3. 架构不变量

- Runtime 是 run/node 状态与生命周期事件的唯一决策者；Storage 只执行 Repository durable 读写。
- Contracts 是跨组件契约权威；durable type、runtime schema、Repository、Remote 和调用方同变更演进。
- Workflow 顺序 `await run.node(...)`；抛错表示失败，`AbortSignal` 表示取消。
- Web 只通过 Runtime Browser Client 读取有界 page/detail 并发送命令。
- `node.output` 是最终结果，observation 是执行过程；二者不得混用。
- 参数、输出、观测和事件会持久化并发送 Browser；禁止 credential、私钥、完整私有 prompt、无界日志和机器绝对路径。
- Repository 列表必须有界并使用 seek cursor；禁止重新引入全历史 snapshot。
- 一次性定时任务使用 durable `queued + scheduledFor`；timer、到点释放、取消和重启恢复只属于 Runtime，Storage/Web/Workflow 不得自行调度。只有相同 workflow id/version 能恢复计划。
- SQLite 只支持单 Host、本地持久卷；网络共享、多主写和高可用需要新的 Adapter/控制面设计。
- 当前只支持可信进程内插件、文本参数、顺序节点、人工评审；不得声称已支持 DAG、checkpoint、自动重试、多租户或高可用。

## 4. 开发流程与文档门禁

1. 用 `git status --short`、`rg --files` 和源码/测试确认事实并保护用户改动。
2. 使用 Skill 的组件选择规则确定职责。
3. Workflow 行为维护 `.design/workflows/<id>.md`；Contracts/Runtime/Storage/Web/跨组件维护 `.design/changes/<id>.md`。先设计并通过审计，再编码。
4. 先改 Contracts，再改实现和消费者；保持单一状态权威。
5. 补行为测试；Browser 使用用户可观察断言，Storage 覆盖事务/分页/备份恢复。
6. 同步 `docs/architecture.md`、README、migration、设计和相关 Skill reference。
7. 新增/重命名包同步 manifest、paths/references、Vitest、build、pack、Bundle、patch、lockfile 和版本。

## 5. 完成验证

```powershell
npm.cmd run audit:ai
npm.cmd run typecheck
npm.cmd test -- --run
npm.cmd run build
```

涉及 Bundle/数据库时还需 `npm.cmd run pack`、tarball 检查、隔离 DSH 安装/启动、真实核心交互、分页、重启读取和备份恢复。不能用 typecheck、HTTP 200、dump-config 或局部截图代替对应行为验收。

TypeScript 只能使用公开 package exports，禁止跨包 `src/*`；Host/Browser 入口分离；Cordis 注册、timer、controller 和资源必须由 effect/disposer 管理。Runtime mutation 串行，Storage 事务化并用 revision CAS，取消、卸载、停止、重启恢复和晚到 timer/结果必须有竞态测试。
