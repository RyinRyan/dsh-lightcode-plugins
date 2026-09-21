# 生产架构重构收口设计

- Change ID: `production-architecture-completion`
- 变更类型: `cross-cutting`
- 影响组件: Contracts、Runtime、SQLite Storage、Workflow Catalog、Web、Factory Bundle、Skill 与仓库文档
- 设计状态: 已实现并验证

## 1. 需求与成功标准

0.2.0 已把 JSON 全文件持久化替换为 Repository Port + SQLite Adapter，但开发视图仍沿用 Backend/Platform/Demo 等历史命名，共享类型、运行时协议、Repository 和 Remote schema 聚集在 Backend 包中；两个内置 Workflow 分散为两个发布包；Browser 每 750ms 拉取全部历史聚合。文档把 Contracts、Runtime、Web、Workflow Catalog 和分页 Remote 标记为后续计划。

本次得到明确授权，不要求包名、服务名、Remote v1、旧 JSON 或 0.2.0 SQLite 的向前兼容。成功标准：

1. 形成 `contracts/runtime/storage-sqlite/workflows/web/factory` 六层开发视图，目录、npm 包名、Cordis service 和 Browser 模块名同义；
2. 共享契约从 Runtime 实现中分离，所有跨组件依赖只指向公开 package exports；
3. 两个同部署边界的内置 Workflow 合并为一个 Catalog 包，并按 workflow id 分目录；
4. Repository 与 Remote 使用有界游标分页，Web 不再周期性拉取全部历史；详情通过独立查询刷新；
5. SQLite 保持事务、revision、索引和单状态权威，并新增可验证的一致性备份能力；删除 legacy JSON 导入和兼容字段；
6. 旧包、旧服务名、旧 Remote namespace 和兼容 alias 全部删除；构建、测试、Bundle、文档和 Skill 只出现新架构；
7. typecheck、全量测试、build、审计、pack、隔离安装/启动、分页/备份恢复验证全部通过。

## 2. 组件选择与职责边界

这是跨组件重构。业务节点行为不属于 Runtime/Web/Storage，不做语义改写；包拓扑、公共契约、查询方式和 UI 数据加载必须在相应层协同完成。

| 目录 | npm 包 | 定位 | 依赖 |
| --- | --- | --- | --- |
| `packages/contracts` | `lightcode-factory-contracts` | JSON-safe 类型、Zod schema、Workflow/Repository Port、Remote v2 描述 | Zod、Typert protocol、Cordis 类型 |
| `packages/runtime` | `lightcode-factory-runtime` | 唯一状态决策者、调度、执行、评审、Remote Host 与 Browser Client | Contracts |
| `packages/storage-sqlite` | `lightcode-factory-storage-sqlite` | SQLite Adapter、migration、事务、revision、分页、备份 | Contracts |
| `packages/workflows` | `lightcode-factory-workflows` | 内置 Workflow Catalog；每个 workflow 一个目录 | Contracts 与所需 DSH Host 能力 |
| `packages/web` | `lightcode-factory-web` | 通用看板、详情、轨迹和分页交互 | Contracts、Runtime Browser Client |
| `packages/factory` | `lightcode-factory` | 唯一装配根 | 以上五个成员 |

Runtime 决定 run/node 状态；Storage 只保存和查询；Workflow 只执行业务节点；Web 只显示投影；Contracts 不执行任何业务。Factory 不吸收实现。

## 3. 当前实现证据

当前 checkout 的 `packages/backend` 同时拥有 JSON-safe types、Zod schema、Workflow runtime types、Repository Port、Remote descriptor、Host runtime 和 Browser client；`packages/storage` 已实现单连接 SQLite 与 revision CAS，但 `listRuns()` 仍返回全部聚合并保留 legacy JSON importer；`packages/demo` 与 `packages/release-readiness` 分别发布；`packages/platform` 每 750ms 调用完整 `snapshot()`。根 TypeScript references、build/pack 脚本和 Factory Bundle 固定装配五个成员包。现有测试覆盖 19 项并已验证 0.2.0 Bundle，但架构文档明确把 Contracts/Runtime/Web/Catalog/分页列为后续计划。

### 3.1 命名规范

- 目录使用组件角色：`contracts`、`runtime`、`storage-sqlite`、`workflows`、`web`、`factory`。
- npm 包统一使用 `lightcode-factory-<role>`；具体存储 Adapter 在角色后写介质，避免把 SQLite 冒充抽象 Storage。
- Cordis Host service 使用 `lightcodeFactoryRuntime`、`lightcodeFactoryRunRepository`；Browser service 使用 `lightcodeFactoryClient`。
- Workflow id 使用稳定 kebab-case；目录与 id 一致，如 `catalog/release-readiness/`。
- 内置 Catalog 的插件名是 `lightcode-factory-workflows`，不再用一个 npm 包对应一个 Workflow。
- 类名表达实现：`LightcodeFactoryRuntime`、`SqliteWorkflowRunRepository`、`LightcodeFactoryClient`。
- 删除 Backend、Platform、Demo 包名和旧 service/namespace alias；发布版本统一升级到 `0.3.0`。

## 4. 目标契约与数据流

Contracts 拥有：共享 run/definition 类型、严格 runtime schema、Workflow registration/execution Port、Repository Port、Remote v2 request/result schema 与 Typert namespace augmentation。它不包含 Cordis Service 实现、SQL、React 或 Node 文件系统调用。

依赖方向固定为：

```text
Contracts <- Runtime <- Web
     ^          ^
     |          |
SQLite       Workflows
     \          /
       Factory Bundle
```

Storage、Workflows 和 Web 不互相依赖。Runtime 不依赖 SQLite。产品代码禁止跨包 `src/*` 导入。

## 5. 持久化、Remote 与兼容性

`WorkflowRunRepository` 改为：

- `listRuns({ limit, before?, statuses? })` 返回 `{ runs, nextCursor? }`；
- `before` 是结构化 `{ createdAt, id }`，SQL 使用 `(created_at, id)` 倒序 seek，查询 `limit + 1`；
- `getRun`、`createRun`、`saveRun(expectedRevision)` 和 `listInterruptedRuns` 保持职责；
- limit 在 Runtime 和 Adapter 两侧限制，状态过滤只接受枚举值；
- 创建 `(created_at DESC, id DESC)` 与 `(status, created_at DESC, id DESC)` 索引。

Storage 暴露 Host-only `createBackup(destinationPath)`，使用 SQLite 在线 backup API 生成一致性副本，拒绝覆盖现有文件。恢复不在运行中的 Service 上原地覆盖；验收通过停止源 Repository、打开备份为新 Repository并核对数据完成恢复演练。

不再读取 `workflow_platform.json`，不创建 `factory_imports`，不保留 `legacyJsonPath`。`workflowVersion` 和 `input` 在新 schema 中必填；数据库 schema 以新版本从空库建立，不承诺读取 0.2.0 数据。

## 6. Web 与交互

Remote namespace 改为 `factory`，包含：

- `catalog()`：返回当前 Workflow definitions；
- `listRuns({ limit, cursor?, statuses? })`：返回有界 run page；wire cursor 是 Runtime 编解码的 opaque string；
- `getRun({ runId })`：返回最新完整聚合；
- `start/cancel/review`：返回最新完整聚合。

Browser Client 首次并行拉 catalog 与第一页，轮询只刷新第一页；`loadMore()` 追加下一页并按 id 去重；打开详情时 `getRun()` 刷新单条聚合；命令后刷新第一页和对应详情。Web 显示“加载更多”，没有 next cursor 时不渲染按钮。单页默认 60、最大 100，因此历史增长不再放大每次轮询。

## 7. Workflow Catalog 开发视图

`packages/workflows/src/catalog/<workflow-id>/index.ts` 各自导出 `WorkflowRegistration` 或注册函数，公共 `src/index.ts` 负责生命周期装配。`release-readiness` 只需 Runtime；`morning-script-demo` 的 Agent/Sandbox/Subprocess 能力通过独立 `ctx.inject` 激活，避免重能力缺失阻断整个 Catalog。

两个 Workflow 的 id、参数、节点、output 和 observation 语义保持当前行为；只是发布/配置边界合并。Catalog config 集中管理共享 artifact root 与 Demo 限制。新增内置 Workflow 时默认进入该目录；需要不同权限、依赖、配置或发布节奏时才建立独立包。

## 8. 状态、并发与生命周期

Runtime 继续是单一状态权威。分页、重命名和目录合并不改变合法状态转换。每个 run mutation 仍串行并使用 revision CAS；取消先持久化终态再 abort；晚到结果不能覆盖终态。queued/running 重启后明确 failed，不伪造 checkpoint 恢复。

Catalog 卸载分别注销其 registrations，并等待 Runtime 取消/排空已接纳任务。Runtime 停机排空后 SQLite Adapter 才关闭。Browser polling、listener 和 UI effect 都随 Cordis lifecycle 释放。

## 9. 安全与数据边界

分页 cursor 不携带 secret，只编码创建时间和 id，并在 Runtime 严格解码。SQL 参数化，状态过滤不拼接任意用户字符串。input/output/observation 继续有界；credential 禁止进入普通 Workflow input。备份目录由管理员配置或显式调用方决定，不返回数据库路径给 Browser。

SQLite 仍限定一个 Host/本地持久卷；多实例和高可用需要新增 PostgreSQL Adapter、durable queue、lease/heartbeat 和 attempt，不在本次把多个 Runtime 指向一个 SQLite 文件。`node:sqlite` 的版本警告必须在交付限制中保留，不虚构已完成高可用。

## 10. 实现与接线计划

1. 新建 Contracts 包并迁移 types/schema/runtime/repository/remote；
2. Backend 重命名 Runtime，只依赖 Contracts，并改 Remote v2 与 Browser Client；
3. Storage 重命名 SQLite Adapter，实现 seek 分页、索引与 backup，删除 JSON importer；
4. 合并两个 Workflow 为 Catalog 包，迁移测试；
5. Platform 重命名 Web，改新 Client/Contracts imports 与加载更多交互；
6. 更新 root paths/references、Vitest、build/pack、Factory dependencies/bundleDependencies/patch、lockfile 和所有版本；
7. 删除旧目录、旧包名、旧 service/Remote 名与兼容测试；
8. 更新 AGENTS、architecture、README、migration、Skill 名称/路由/引用和审计脚本。

## 11. 测试与验收

- Contracts：schema 拒绝缺失必填字段，Remote descriptor 与类型一致，cursor 解码拒绝畸形输入；
- Storage：空库 migration、分页顺序/边界/状态过滤、revision 冲突、事务回滚、备份与新 Repository 恢复；至少生成多页数据证明单次返回受限；
- Runtime：catalog/list/get/start/cancel/review、非法 cursor/limit、取消竞态、失败、重启中断和 Workflow disposer；
- Workflows：两个真实 Workflow 都通过统一 Catalog 注册，release-readiness 完整执行/评审，Demo 组合路径保留；
- Web：第一页、加载更多、详情刷新、命令、六状态看板、输出/轨迹、无 next cursor；
- 发布：typecheck、全量测试、build、文档审计、pack、tarball 成员检查；隔离 DSH profile 安装、dump-config、启动、数据库分页/备份恢复；完整 Browser 页面至少复核创建、详情、轨迹和较窄窗口。

## 12. 文档同步

更新 `AGENTS.md`、`docs/architecture.md`、`README.md`、`docs/migration.md`；Skill 重命名为 `.claude/skills/lightcode-factory-develop`，同步入口、组件选择、Repository/Runtime/Storage/Web/Workflow Catalog、测试与文档规则；审计脚本只识别新目录。通用 DSH 插件教程不依赖 Factory 具体包名，仅核对链接，不做无关改写。

## 13. 风险、限制与回滚

主要风险是一次性包拓扑变化、Remote v2 客户端协同和合并 Workflow 后的注入生命周期。通过无兼容 alias 的全仓搜索、真实 Bundle、公开生命周期组合测试和隔离安装降低风险。

由于明确不要求向前兼容，回滚只能恢复整个旧版本及其数据库副本；不实现旧 JSON/0.2 SQLite 自动升级、旧 npm 包 alias、旧 Cordis service 或 Remote v1。高可用、多租户、恶意插件隔离、DAG、自动重试/checkpoint、对象存储和 PostgreSQL 不是本次“代码开发视图与单机生产底座重构”的组成部分，文档继续明确其边界。

## 14. 设计自检

- [x] 组件职责、依赖方向和命名规范明确。
- [x] 明确采用破坏性升级，不保留旧接口或数据迁移。
- [x] Runtime 仍是状态唯一决策者，Storage 不实现状态机。
- [x] Contracts 不包含实现，Web/Workflow 不访问 Repository。
- [x] 分页、详情、备份和恢复证据有对应测试计划。
- [x] Workflow Catalog 合并条件与重依赖注入边界明确。
- [x] Bundle、lockfile、版本、Skill 和文档接线完整列出。
- [x] 安全、生命周期、取消、失败和部署限制已覆盖。
- [x] 非目标没有被描述为已实现能力。

## 15. 实际验证结果

2026-09-18 在 Windows、Node 24.11.0、DSH CLI 0.1.5-rc.1 / SDK 0.1.5-rc.2 下完成：

- `npm.cmd run audit:ai`、`npm.cmd run typecheck`、`npm.cmd test -- --run`、`npm.cmd run build` 和 `npm.cmd run pack` 通过；全量测试为 6 个测试文件、22 项测试；
- `dist/lightcode-factory-0.3.0.tgz` 只包含 Runtime、SQLite Storage、Workflow Catalog、Web、Factory 五个可启动成员以及作为 library 打包的 Contracts，不含旧 Backend/Platform/Demo 包；
- Bundle 安装到全新隔离 DSH home/profile `factory-03`，`dump-config` 仅出现 `lightcode-factory-storage-sqlite`、`lightcode-factory-runtime`、`lightcode-factory-workflows`、`lightcode-factory-web`，Host 启动成功；
- Browser 完成发布就绪任务的创建、执行、运行详情、9 条轨迹记录、人工评审与完成态闭环；390×844 视口下 document/body `scrollWidth` 均等于 `innerWidth`，没有根级横向溢出；
- 实际隔离数据库 `user_version = 1`，包含五张 `factory_*` 表和三个运行查询索引；在线备份后用新的 Repository 打开副本，源库与副本均读取 3 条完整 run；
- tarball SHA-256 为 `7A214CF77054A1D141734F79DE2EC3C3C637DF19770AF6E519A68CB3DBA8F8F4`。

未验证项仍为非目标：多 Host/高可用、PostgreSQL、durable queue、checkpoint/自动重试、恶意插件隔离、外部真实模型质量与网络存储。Node 24.11.0 运行 `node:sqlite` 时仍打印实验特性警告。
