# SQLite Storage 开发规范

`packages/storage-sqlite` 是 Factory 单机持久化 Adapter：实现 Contracts 的 `WorkflowRunRepository`，负责 schema、事务、revision、seek 分页、索引、migration、备份和连接生命周期。它不决定状态转换。

## 1. 边界与依赖

- Repository Port 属于 Contracts；Runtime 与 Storage 都依赖 Contracts，互不依赖。
- Storage 接收 Runtime 已判定合法的聚合，不实现状态机或按 Workflow id 分支。
- Workflow 和 Web 不得导入或注入 Repository。
- SQL、数据库路径、驱动错误和 revision 不跨 Remote。

## 2. Schema、写入与查询

- 列表过滤/排序字段结构化存储；input/output 使用有界 JSON。
- 一个 aggregate mutation 的主记录、节点、事件和 observation 在同一事务提交。
- revision compare-and-swap 拒绝陈旧更新；冲突不能部分写入。
- 事件 sequence 由 Runtime 产生，Storage 用唯一约束防重。
- 外键、唯一约束和索引显式创建。
- 列表必须使用 `(created_at, id)` seek cursor 和 limit；禁止新增无界 `listAll`。
- 状态过滤只接受枚举，所有值参数化；不得拼接用户 SQL。

## 3. Migration、备份与恢复

- migration 单向、按版本记录，启动完成后才提供 Repository。
- 新增 nullable 调度字段时，历史 NULL 的运行语义必须明确；迁移同时更新 migration 表与 `PRAGMA user_version`，并用带旧数据的数据库验证。
- 不支持的数据版本明确拒绝启动，不能静默读取或部分迁移。
- 在线备份使用 SQLite backup API，目标不得覆盖，且不得等于活动数据库。
- 恢复通过停止旧连接、以备份启动新 Repository 并核对数据演练；运行中原地覆盖禁止。
- 不长期双写，不自动删除数据库或备份。

## 4. 生命周期与部署

- 连接由 Cordis Storage 生命周期拥有；Runtime 排空任务/mutation 后 Storage 再关闭。
- SQLite 只用于一个 Host、本地持久卷；网络共享、多 Runtime 或高可用应增加 PostgreSQL Adapter。
- WAL、synchronous、busy timeout 必须与实际 Node/SQLite 版本验证。当前默认 rollback journal + FULL synchronous。
- `node:sqlite` 若仍有实验警告，交付必须明确记录。

## 5. 测试与完成

覆盖 schema/index、aggregate round-trip、分页边界/排序/过滤、revision 冲突、事务回滚、migration、备份不覆盖、恢复重开、连接关闭和 Runtime 真实组合。涉及 Bundle 时检查 tarball、patch、隔离安装、重启读取和备份恢复。

完成前同步 architecture、README、设计与本规范，运行审计、typecheck、全量测试、build 和 pack。
