# LightCode Factory 当前架构

本文描述 0.4 当前 checkout 的逻辑视图、开发视图、依赖、状态所有权、数据流、持久化和部署边界。字段与限制以 Contracts、源码和测试为准。

## 1. 重构背景与目标

早期实现把共享类型、状态实现、Repository 和 Remote 集中在 Backend 包，将 Web 称为 Platform，并把每个内置 Workflow 发布成独立 npm 包。0.2 引入 SQLite 后，Browser 仍周期性读取全部历史。0.3 是不保留旧包/API/数据兼容的架构收口：按职责建立 Contracts、Runtime、SQLite Storage、Workflow Catalog 和 Web，并用分页/详情 Remote 替代全量 snapshot。

目标是让人类和 AI 从目录与包名就能判断职责；共享契约与实现解耦；内置 Workflow 在一个 Catalog 中按 id 分目录；历史增长不再放大每次轮询；Factory Bundle 仍只负责装配。0.4 在这个边界上增加一次性定时执行，调度仍由 Runtime 统一拥有。

## 2. 逻辑视图

```text
                         ┌────────────────────────────┐
                         │ Contracts                  │
                         │ types / schema / ports /   │
                         │ Remote v2                  │
                         └──────┬────────┬────────┬───┘
                                │        │        │
                     implements │        │ uses   │ uses
                                ▼        ▼        ▼
┌───────────────┐       ┌────────────┐  ┌───────────────┐
│ SQLite Storage│◄──────│ Runtime    │◄─│ Workflow      │
│ transaction   │ Port  │ state owner│  │ Catalog       │
│ page / backup │       │ scheduler  │  │ business nodes│
└───────────────┘       └─────┬──────┘  └───────────────┘
                              │ Remote v2 + Browser Client
                              ▼
                        ┌───────────────┐
                        │ Web           │
                        │ board/detail/ │
                        │ trace/page    │
                        └───────────────┘

Factory Bundle：组合并安装以上成员，不承载业务逻辑。
```

Runtime 是 run/node 状态和生命周期事件的唯一决策者。Storage 不判断转换是否合法；Workflow 不写状态；Web 不写 durable 数据；Contracts 不执行逻辑。

## 3. 开发视图与组件定位

```text
packages/
  contracts/             # 跨组件稳定契约
  runtime/               # Host 控制面 + Browser Client
  storage-sqlite/        # 单机 SQLite Adapter
  workflows/
    src/catalog/
      morning-script-demo/
      release-readiness/ # 内置 Workflow，每个 id 一个目录
  web/                   # FactoryBoard / RunOverview / RunTrace
  factory/               # Bundle composition root
```

| 组件 | npm 包 | 架构定位 |
| --- | --- | --- |
| Contracts | `lightcode-factory-contracts` | JSON-safe types、Zod aggregate schema、Workflow/Repository Port、Remote v2 descriptor |
| Runtime | `lightcode-factory-runtime` | 注册、任务接纳、立即/定时队列、状态机、节点执行、取消、评审、定时恢复、重启中断处理、Remote Host 和 Browser Client |
| SQLite Storage | `lightcode-factory-storage-sqlite` | 单连接、关系 schema、事务、revision CAS、seek 分页、索引和一致性备份 |
| Workflow Catalog | `lightcode-factory-workflows` | 当前两个内置 Workflow 的业务参数、顺序节点、output 与 observation |
| Web | `lightcode-factory-web` | Catalog 表单、六状态看板、加载更多、详情、轨迹与命令交互 |
| Bundle | `lightcode-factory` | 固定成员、安装 patch、发布闭包 |

依赖方向：Runtime、Storage、Workflows 都依赖 Contracts；Web 依赖 Contracts 和 Runtime Client；Bundle 依赖全部成员。禁止 Runtime → Storage 实现、Storage → Workflow/Web、Workflow/Web → Repository 和任意跨包 `src/*`。

## 4. Contracts 视图

`packages/contracts/src/`：

- `types.ts`：definition、run、node、event、page 和 command request；
- `schema.ts`：完整 durable aggregate runtime schema；
- `workflow.ts`：registration、execution/node context 和 `lightcodeFactoryRuntime` Port；
- `repository.ts`：stored revision、seek cursor、bounded query 与 Repository；
- `remote.ts`：Typert Remote v2 descriptor 和 namespace augmentation。

0.3 aggregate 要求 `workflowVersion` 和 `input` 必填，不接受早期缺字段记录。0.4 增加可选 ISO datetime `scheduledFor`，同时用于 durable aggregate 和 start command。Contracts 不包含 Service、SQL、React 或 Node 文件系统逻辑。

## 5. Runtime 与状态模型

`LightcodeFactoryRuntime` 发布 Cordis service `lightcodeFactoryRuntime`，注入 `lightcodeFactoryRunRepository` 和 Typert。它保存当前 registrations、已接纳 implementation、队列、controller、task 和 per-run mutation chain。

```text
scheduled queued --due--> runnable queued -> running -> review -> completed
       |                         |             |          |
       +-------------------------+-------------+----------+-> cancelled
                                                   |
                                                   +--------> failed
```

节点状态是 `pending | running | completed | cancelled | failed`。同一 run mutation 串行；每次先读取 revision、计算新聚合，再 CAS 保存。取消先保存 cancelled 后清理 timer/abort，晚到 timer、output 或 observation 不能覆盖终态。带 `scheduledFor` 的 queued 在相同 workflow id/version 注册后恢复计时；已过期计划立即进入可运行队列。执行队列在启动节点前会重读 durable run 并再次校验计划时间，未来任务即使收到提前入队信号也只会重新布防 timer。running 和无计划时间的遗留 queued 在 Host 重启后标记 failed，不伪造 checkpoint 恢复。

Workflow registration disposer 注销 definition，并取消/等待已捕获该 implementation 的活动任务；尚未到期的 scheduled queued 保留 durable 记录并解除 timer，等同 id/version 再注册。Runtime stop 停止接纳、清理 timer、等待 admission、abort/等待 tasks 和 mutations；随后 Storage 才关闭。超过 JavaScript timer 上限的计划分段布防，到点前不占并发槽。

## 6. Remote v2 与 Browser 数据流

namespace 是 `factory`：

| 方法 | 作用 |
| --- | --- |
| `catalog()` | 当前 Workflow definitions |
| `listRuns({ limit, cursor?, statuses? })` | 最大 100 条的有界页面和 opaque next cursor |
| `getRun({ runId })` | 单条最新完整 aggregate |
| `start/cancel/review` | durable 命令；start 可带一次性 `scheduledFor`，返回最新 aggregate |

Browser service `lightcodeFactoryClient` 首次并行读取 catalog 与第一页；750ms 轮询只刷新默认 60 条第一页。`loadMore()` 追加下一页并按 id 去重；打开卡片调用 `getRun()` 刷新详情；命令后刷新第一页并保留返回 aggregate。创建表单在提交时从原生 form 当前选中的执行方式和 `datetime-local` 读取值；定时模式缺少有效未来时间会拒绝提交，只有有效时间才转为 ISO UTC 发送给 Runtime。不存在全历史 snapshot API。

Web 只从 `FactoryClientSnapshot` 派生页面。运行详情展示 output/error 与 Runtime 生命周期事件；轨迹展示 observation、callId/sessionId；未知 JSON 使用通用回退。禁止按 workflowId、包名、节点 id 或中文名称分支。

## 7. Workflow Catalog

内置 Workflow 位于 `packages/workflows/src/catalog/<workflow-id>/`：

- `release-readiness`：确定性输入规范化、风险评分和发布清单；只需要 Runtime。
- `morning-script-demo`：问候、当前模型生成脚本、受宿主策略约束的进程执行；需要 Agent/Model/Sandbox/Subprocess。

Catalog 先注册轻量 Workflow；Demo 通过独立 `ctx.inject` 等待重依赖，重能力缺失不阻断 release-readiness。两个 Workflow 共享发布、配置和生命周期边界，因此合并为一个包；未来边界不同的 Workflow 才独立发布。

## 8. SQLite 数据视图

权威数据库默认位于 DSH home 的 `lightcode-factory/factory.sqlite3`。

| 表 | 作用 | 约束/索引 |
| --- | --- | --- |
| `factory_runs` | run 主状态、input、可选 scheduled_for、revision | PK id；created/id、status/created/id、workflow/created/id 索引 |
| `factory_run_nodes` | node 状态、output、error | PK run+node；唯一 run+ordinal；FK cascade |
| `factory_run_events` | append-only 生命周期事件 | PK run+sequence |
| `factory_node_observations` | 有界过程事实 | PK run+node+ordinal；复合 FK |
| `factory_schema_migrations` | schema 版本 | PK version；SQLite user_version 同步 |

列表使用 `(created_at DESC, id DESC)` seek pagination，读取 `limit + 1` 判断 continuation；状态过滤参数化。一个 mutation 的主记录、节点、observation 和事件在 `BEGIN IMMEDIATE` 事务中提交。revision 冲突回滚全部写入。

当前 `user_version = 2`。空库直接创建 v2；0.3 的 schema v1 通过 `ALTER TABLE` 增加 nullable `scheduled_for` 并记录 migration 2，历史 NULL 等价于立即任务。`createBackup(destinationPath)` 使用 SQLite 在线 backup API，拒绝覆盖和源/目标相同。恢复需要停止活动连接，以备份启动新的 Repository 并核对数据。0.4 不读取 `workflow_platform.json`，也不承诺读取 0.2 SQLite；检测到未标记的旧 Factory schema 时明确拒绝启动。

## 9. 部署视图

```text
一个 DSH Host
  └─ 一个 Factory Runtime
       ├─ 一个本地 SQLite 文件
       ├─ 一个本地 artifact 目录
       └─ 进程内可信 Workflow Catalog
```

SQLite 必须位于本机持久卷，不支持网络共享文件系统多主写。多实例/远程 Worker/高可用需要新 PostgreSQL Adapter、durable queue、attempt、lease、heartbeat、幂等和恢复协议，不能让多个 Runtime 共享当前 SQLite。

当前 Node 24.11 的 `node:sqlite` 仍发出实验特性警告；正式生产发布前必须固定经过验证的 Node/SQLite 版本并完成故障注入与规模负载验收。

## 10. 当前能力与限制

已实现：Contracts 分层、可信进程内 Workflow Catalog、文本参数、顺序节点、有界 JSON output/observation、并发队列、一次性定时执行及重启恢复、取消、人工评审、SQLite 事务/revision/seek 分页/备份、Remote v2、详情查询、统一 Web 看板/详情/轨迹。

未实现：Cron/重复任务/修改计划、复杂/凭据输入、DAG/并行/循环/动态节点、自动重试、checkpoint、run attempt、幂等启动键、事件推送、跨进程 Worker、多租户隔离、恶意插件沙箱、PostgreSQL、高可用、自动归档和对象存储。

## 11. 修改入口与验证

- 仓库规范：`AGENTS.md`
- Skill：`.claude/skills/lightcode-factory-develop/SKILL.md`
- 当前定时变更设计：`.design/changes/scheduled-workflow-runs.md`
- 生产架构基线设计：`.design/changes/production-architecture-completion.md`
- Contracts/Runtime/Storage/Workflows/Web：对应 `packages/*/src` 与 `tests`
- 构建/打包：`scripts/build.mjs`、`scripts/pack.mjs`

基础门禁：`npm.cmd run audit:ai`、`npm.cmd run typecheck`、`npm.cmd test -- --run`、`npm.cmd run build`、`npm.cmd run pack`。Bundle 变更还需隔离 DSH 安装/启动、真实 Workflow/Web 交互、重启读取和备份恢复。
