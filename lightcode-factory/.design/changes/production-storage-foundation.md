# 生产化存储底座重构设计

- Change ID: `production-storage-foundation`
- 变更类型: `cross-cutting`
- 影响组件: Backend、Storage、Factory Bundle、开发规范与架构文档；Workflow 和 Platform 仅参与兼容回归
- 设计状态: 已实现并验证

## 1. 需求与成功标准

当前 Backend 通过 DSH Storage Domain 把完整 `WorkflowRunView` 聚合作为 JSON KV 记录保存，Browser 继续使用现有完整 snapshot。该实现可以支撑功能验证，但存储实现、状态机和 DSH Domain 生命周期耦合，缺少领域查询、事务版本、关系索引和独立迁移边界。

本阶段是整体生产化方案的第一个可交付切片，目标是：新增独立 `lightcode-factory-storage` 包；由 Backend 定义异步 `WorkflowRunRepository` Port；使用 SQLite 关系表持久化 run、node、event 和 observation；从历史 `workflow_platform.json` 幂等导入；保持 Workflow 注册协议、Remote v1、Platform 页面和状态语义不变；完成真实组合测试、构建和 Bundle 打包。

非目标：本阶段不重命名 Backend/Platform，不合并 Workflow 包，不新增 Remote v2，不实现分页 UI、自动重试、checkpoint、多实例调度或 PostgreSQL。完整 snapshot 的网络扩展性仍作为后续阶段限制保留。

## 2. 组件选择与职责边界

这是 Backend + Storage + Bundle 的跨组件变更。Backend 仍是 run/node 状态和事件的唯一写入决策者，定义 Repository Port 并按 revision 进行原子保存；Storage 是基础设施适配器，只负责 schema、查询、事务、乐观并发、历史 JSON 导入和连接生命周期；Bundle 负责先装配 Storage、再装配 Backend。Workflow 不应感知数据库，Platform 不应访问 Storage，因此二者不增加实现能力。

依赖方向为 `Backend（Port） <- Storage（Adapter）`，两者都通过 Backend 公开的 JSON-safe run 类型工作。Backend 不依赖 SQLite 包；Storage 只通过 Backend 的公开 exports 导入 Port 和 schema，禁止导入 `src/*`。

## 3. 当前实现证据

当前 `packages/backend/src/index.ts` 注入 `storageDomain`，打开 `workflow_platform` version 1 的 `runs` 表，并通过 `KvTable.get/entries/put` 同步读取、异步全记录覆盖。`src/spec.ts` 同时声明 Zod schema 和 DSH DomainSpec。Backend 的 `snapshot()` 遍历全部内存记录；Browser Client 每 750ms 请求完整 snapshot。两个 Workflow 组合测试和 Backend 测试均装配 DSH Storage、JSON Backend 和 Storage Domain。Factory Bundle 当前装配 Backend、两个 Workflow 与 Platform，没有独立 Storage 成员。

当前历史文件位于 DSH home 的 `storages/workflow_platform.json`。记录中的 optional `workflowVersion`、`input` 和默认空 observations 用于兼容早期 Demo 数据，迁移必须继续通过同一 `workflowRunSchema` 验证。

## 4. 目标契约与数据流

Backend 新增公开 Host-only Port：`StoredWorkflowRun { run, revision }` 与 `WorkflowRunRepository`，包含 `listRuns`、`listInterruptedRuns`、`getRun`、`createRun`、`saveRun(expectedRevision)`。所有方法为异步，允许未来实现 PostgreSQL；Port 不跨 Browser wire。

Storage Cordis 服务键为 `lightcodeFactoryRunRepository`。Backend 启动时读取中断记录并沿用现有语义标记失败；start 先创建 queued 聚合；每次 update 在同一 run mutation 链上读取最新 revision、计算下一状态并事务保存；保存成功后才通知订阅者。Storage 使用 prepared statements 重建聚合，列表按 `created_at DESC` 排序。

Remote v1 的 route id、请求、响应和 `WorkflowRunView` 完全不变。Platform 仍由 Backend Browser Client 轮询 snapshot。

## 5. 状态、并发与生命周期

合法 run/node 状态及转换不变。Backend 的 per-run mutation promise chain 保持应用层顺序；Storage 的 `revision` compare-and-swap 再次阻止跨调用或未来跨进程的陈旧覆盖。取消仍先持久化 cancelled，再 abort；晚到 output/observation 通过 Backend 状态检查和 revision 保存不能覆盖终态。

Storage 在 Cordis init 中创建目录、打开数据库、执行迁移和可选 JSON 导入；在 disposer 中拒绝后续操作并关闭唯一数据库连接。Backend 停止时先停止接纳、等待 admission、abort/等待任务和 mutation；Repository 的关闭由 Storage 自己的生命周期负责，Backend 不关闭注入服务。Bundle 必须保证 Storage 在 Backend 前装配，并由 Cordis 依赖关系保证 teardown 顺序。

重启语义本阶段保持兼容：遗留 queued/running 被标记 failed，不声称支持恢复执行。

## 6. 持久化、Remote 与兼容性

SQLite schema 使用 `factory_runs`、`factory_run_nodes`、`factory_run_events`、`factory_node_observations`、`factory_schema_migrations` 和 `factory_imports`。run 主表保存可查询列、JSON input 和 revision；node 保存 output JSON；event 以 `(run_id, sequence)` 唯一；observation 以 `(run_id, node_id, ordinal)` 唯一。索引覆盖 `(status, created_at)`、`(workflow_id, created_at)` 和子记录顺序读取。

保存一个 run 时在单事务中执行主表 revision 更新、node upsert、该 run 的 bounded observation 替换和新 event 追加。数据库只使用一个连接；默认 rollback journal + FULL synchronous，避免把当前未验证的 Node/SQLite WAL 组合写成生产前提。WAL 作为未来经过固定 Node/SQLite 版本验证后的配置能力，而非默认值。

JSON 导入仅在数据库没有 run 且没有成功导入标记时发生：读取文件、计算 SHA-256、用 `workflowRunSchema` 验证全部记录、创建不覆盖原文件的 `.bak`、在单事务导入并记录 source/hash/count。数据库已有数据时不得混合导入；失败回滚数据库并保留原 JSON。原文件不会自动删除。

Remote schema、Workflow runtime 类型和 Browser 消费不变。`workflowRunSchema` 从 DSH DomainSpec 中解耦但导出路径保持兼容；`workflowPlatformDomain` 不再作为当前存储入口，对外移除前必须检查是否有仓库外消费者，本阶段不再由 Backend 使用。

## 7. Web 与交互

Platform 源码和可观察交互不变：仍显示六状态看板、完整 run 详情、节点输出、事件和轨迹；Remote v1 命令不变。存储读取转为异步后，Backend remote 返回 Promise，但 Typert 调用形状不变。完整 snapshot 与 750ms 轮询仍是已知性能上限，将在 Remote v2 阶段通过分页、详情和增量变更解决。

## 8. 安全与数据边界

迁移继续验证历史记录，拒绝畸形记录，不把内部 SQL、绝对数据库路径或 stack 返回 Browser。SQL 全部使用 prepared statement 参数，不接受 Workflow 提供的表名或 SQL。数据库目录由 DSH home 配置，Bundle 不写死开发机绝对路径。当前 input 仍可能被持久化，因此 credential 禁止进入普通 Workflow input 的规则不变。

备份包含与原 JSON 相同的敏感级别，不打印内容或 hash 之外的业务数据。测试只使用临时目录与合成记录。

## 9. 实现与接线计划

1. 在 Backend 增加 `repository.ts` Port，解耦 `spec.ts` 的 Zod schema 与 DSH DomainSpec，并把 Backend 所有持久化读取改为异步 Repository。
2. 新增 `packages/storage`，实现 Cordis service、SQLite migration、关系聚合读写、revision 冲突和 legacy JSON importer。
3. 更新 Backend、Demo、release-readiness 测试装配，新增 Storage CRUD、冲突、事务和导入幂等测试。
4. 更新 root TypeScript references/path、build/pack 成员、Factory dependencies/bundleDependencies/patch 和 lockfile；Storage 必须在 Backend 前装配。
5. 同步 AGENTS、architecture、README、Skill 路由/Backend/测试/文档规范；新增 Storage 开发 reference。
6. 完成后把设计状态改为“已实现并验证”，记录实际验证和未验证项。

## 10. 测试与验收

Storage 单测覆盖：空库迁移、aggregate round-trip、按时间排序、revision 冲突、失败事务不产生部分写入、旧 JSON 导入、重复启动不重复导入、畸形 JSON 拒绝且原文件保留。Backend 回归覆盖现有 admission、执行、取消、晚到结果、失败、评审、重启历史和旧记录 schema。

真实组合测试使用公开 Cordis lifecycle 装配 Storage + Typert + Backend + Workflow，验证 definition、执行、持久化和卸载。Remote schema 和 Platform 测试保持通过。实际结果：`audit:ai` 与带 `--built --design` 的设计审计均为 0 错误/0 警告；typecheck 通过；5 个测试文件、19 个测试全部通过；build 通过；skill-creator `quick_validate.py` 通过；真实 pack 生成 `dist/lightcode-factory-0.2.0.tgz`，SHA-256 为 `12D6721878E9390AF62089C45C0D70EE48CA6DCA2023D008E5A0C79768B5F198`，tarball 含 Storage 成员。

隔离 DSH Home/Profile 已完成 0.2.0 安装、dump-config 装配顺序检查和真实 Web Host 启动，3895 端口监听后正常停止；SQLite 创建 6 张 Factory 表并记录 migration version 1。另将当前 `workflow_platform.json` 复制到隔离目录进行真实形状迁移，5 条 run 全部导入且生成 `.bak`，没有输出业务内容或修改原文件。由于 Remote/UI 不变，本阶段未重复完整浏览器交互；自动化 Platform 测试继续通过。

## 11. 文档同步

更新 `AGENTS.md` 的组件表与状态所有权、`docs/architecture.md` 的逻辑/开发/数据视图、README 的成员/存储位置/迁移/边界、Skill 入口和 repository-discovery/component-selection/backend-development/documentation-sync/testing-and-delivery；新增 Storage reference。`platform-development.md` 与 `platform-display-contract.md` 已核对，因 Remote/UI 语义不变无需修改；两个 Workflow 设计因业务参数、节点、输出和依赖协议不变无需修改；通用 `docs/plugin-development/` 不描述 Factory 领域存储，无需修改。

## 12. 风险、限制与回滚

主要风险是 SQLite 同步 API 阻塞事件循环、完整 snapshot 随历史线性增长，以及异步 Repository 改造引入竞态。通过真实历史副本迁移、单连接、组合测试和 revision CAS 缓解。本阶段 snapshot 仍全量，SQLite 不能解决 Browser 网络扩展性；默认不启用 WAL；SQLite 只面向单机单 Runtime，不支持网络文件系统多主写。当前 Node 24.11 会对 `node:sqlite` 发出实验特性警告，正式生产发布前必须升级并锁定经过验证的 Node/SQLite 版本。

回滚时保留原 JSON 和自动备份，恢复旧 Bundle/Backend 即可继续读取 JSON。SQLite 数据不会自动回写 JSON；在正式切流前必须完成导入校验，切流后若需要长期双向回滚应另行实现导出工具，禁止长期双写产生两个状态权威。未验证项为完整桌面浏览器交互、真实备份恢复演练、断电/磁盘满故障注入和生产规模负载测试。

## 13. 设计自检

- [x] 当前实现证据来自本 checkout 的源码和测试。
- [x] 组件选择正确，没有把业务特例放入 Backend/Platform。
- [x] Backend 仍是 durable run 状态的唯一写入者。
- [x] 类型、storage schema、wire schema 与调用方影响已覆盖。
- [x] 历史数据、旧 Workflow 和 Browser 兼容策略明确。
- [x] 取消、失败、卸载、停止、重启和竞态已分析。
- [x] Platform 有通用回退、可访问性和无业务特例保证。
- [x] 安全、凭据、日志/输出边界明确。
- [x] 测试、构建、Bundle 和真实验收范围完整。
- [x] 文档同步清单与无需更新的理由完整。
