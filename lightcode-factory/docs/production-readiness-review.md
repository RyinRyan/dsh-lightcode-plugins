# LightCode Factory 生产就绪审查

审查基线：0.4.1 当前 checkout。结论是：**适合受控的单 Host、小规模内部试运行，但尚不建议作为无人值守、强 SLA 或多租户生产服务直接上线。** 架构分层和数据一致性基础较好；主要缺口集中在故障恢复、读写放大、操作可观测性和生成代码执行边界。

## 1. 上线判定

### P0：上线前必须关闭或完成

1. **生成代码执行边界**：`morning-script-demo` 在宿主策略为 `danger-full-access` 时会直接执行模型生成的脚本。生产 profile 至少应设置 `demoEnabled: false`；若必须启用，应强制受验证的 sandbox policy、限制网络/文件系统/进程能力，并做恶意输入验收。
2. **命令幂等与结果语义**：Browser Client 在 `start/cancel/review` 成功后同步调用 `refresh()`；如果 durable 命令成功而刷新失败，调用方会收到失败并可能重试。当前 `start` 没有 idempotency key，重试可能创建重复任务。应让命令结果独立成功、后台刷新失败单独呈现，并为 start 引入幂等键。
3. **调度与持久化故障恢复**：队列泵、scheduled release 和 run mutation 在 Repository 暂时失败时只有日志或 Promise rejection，没有有界重试、重新入队、dead-letter/人工恢复协议。应补故障分类、退避重试、最终状态和重启恢复测试，避免 durable queued/running 记录悬挂。
4. **操作可观测性**：建立结构化日志、指标和告警最低集，至少覆盖 runId/workflowId/revision、队列深度、活跃数、排队/执行时长、成功/失败/取消、SQLite 延迟与冲突、timer 恢复、备份结果、Browser Remote 错误。当前用户事件不能替代运维日志。
5. **发布与恢复演练**：固定经过验证的 Node/SQLite 版本；完成目标规模负载、磁盘满/只读/锁等待/进程强杀/模型超时/忽略 AbortSignal 的故障注入；建立自动备份、保留、校验和恢复演练。`node:sqlite` 的实验特性警告必须作为显式风险接受项。

### P1：扩大流量前完成

1. 把列表读取从“每条 run 读取完整 aggregate”改成轻量 summary projection；详情才读取 nodes/events/observations。
2. 把每次 mutation 的节点/观测全删全插改为增量 upsert/append；事件只追加新增 sequence。
3. 把固定 750ms 的每客户端轮询改为可见性暂停、single-flight、指数退避和 jitter，随后评估 SSE/事件推送。
4. 拆分 Runtime 的 admission、scheduler、state transition、node executor 和 Remote adapter，降低 500+ 行单类的变更耦合。
5. 引入参数类型/校验/敏感字段元数据与显式 output renderer 契约，替代根据字段名、标签和 `code/stdout` 形状猜测 UI。

## 2. 七项质量审查

| 维度 | 现状与优点 | 主要问题 | 优先级 |
| --- | --- | --- | --- |
| 可读性 | Contracts、Runtime、Storage、Workflows、Web、Bundle 命名和职责清楚；公开类型有注释 | Runtime 单文件/单类过大；Web 含密集单行 JSX；状态集合、事件字符串和字段语义散落；缺少统一 lint/format 门禁 | P1 |
| 可维护性 | 有设计门禁、公开 exports、33 项自动化测试和隔离发布流程 | build/pack/tsconfig/Vitest/Bundle 多处硬编码成员；重复 JSON/时间/状态辅助逻辑；没有覆盖率阈值、lint、依赖/许可证/漏洞门禁；发布版本需多 manifest 同步 | P1 |
| 架构合理性 | 单一 Runtime 状态权威、Repository Port、SQLite Adapter、seek cursor、revision CAS、Bundle composition 边界合理 | Runtime 同时承担注册、接纳、调度、状态机、执行和 Remote；可信进程内 Workflow 无隔离；同步 SQLite 与 Host 事件循环耦合；缺少授权/租户/配额边界 | P0/P1 |
| 可扩展性 | WorkflowRegistration 和 Catalog 能低成本增加同边界顺序流程 | 仅文本参数、静态顺序节点、人工评审；无 attempt/retry/checkpoint/DAG；Web 用标签/字段名启发式识别多行输入和代码输出，扩展新语义容易误渲染 | P1 |
| 韧性 | cancel-before-abort、revision CAS、定时任务持久化、重启处理和 lifecycle disposer 有测试 | 无 start 幂等、自动重试、dead-letter、运行超时或强制 drain deadline；Repository/轮询异常路径可能形成未处理 rejection、丢失内存队列项或“命令成功但 UI 报错”；单 Host/单 SQLite | P0 |
| 性能 | page limit 与 seek cursor 防止无界历史扫描，output/observation 有界 | 每 750ms 每客户端读取 catalog + 60 个完整 aggregate；列表产生明显 N+1 查询；每条 observation 都读完整 aggregate并重写全部 nodes/observations、遍历全部 events；DatabaseSync 阻塞事件循环 | P0/P1 |
| 日志完备性 | Runtime 对 scheduled recovery/release、持久化失败和 observer 异常有少量日志；durable event/observation 便于用户追踪 | 日志非结构化且多数没有 runId/workflowId/revision；Storage、migration、backup、Remote、命令、耗时、队列和生命周期几乎无运维日志；无 metrics/trace/health/readiness/告警，错误脱敏策略未集中 | P0 |

## 3. 关键证据

- `packages/runtime/src/index.ts`：Runtime 集中管理 registrations、admissions、queue、timers、controllers、mutations、Remote 方法和节点执行；异常日志没有统一上下文字段。
- `packages/runtime/src/client/index.ts`：`refresh()` 每次并行读取 catalog 和第一页；固定 750ms interval；command 在 Remote 成功后等待 refresh。
- `packages/storage-sqlite/src/sqlite-run-repository.ts`：list page 先读 id，再逐 run 执行 aggregate 查询；save 时删除并重建全部节点/观测，并对完整事件数组逐条 `INSERT OR IGNORE`。
- `packages/workflows/src/catalog/morning-script-demo/index.ts`：模型输出落盘并执行；当 policy 为 `danger-full-access` 时没有 confinement。
- `packages/web/src/client/FactoryBoard.tsx` 与 `RunOverview.tsx`：参数控件和 output workbench 依赖名字/标签及 `code/stdout/artifactPath` 字段形状推断。

## 4. 本轮已完成的清理

- 删除没有入口、测试、构建、打包或文档引用的 `scripts/build-fixture.mjs` 和 `tests/fixture-plugin.ts`；保留仍被 Workflow 测试使用的 `tests/mock-adapter.ts`。
- `scripts/pack.mjs` 现在每次重建 `dist`，并在成功或失败时回收 `.pack-*` staging，避免旧版本 tarball 和完整临时安装树持续累积。
- 保留通用 `.claude/skills/dsh-plugin-develop/` 和 `docs/plugin-development/`；它们服务普通 DSH 插件开发，不是无效 Factory 代码。

## 5. 建议的生产验收矩阵

在 P0 修复后，以预期峰值的 2 倍客户端数、run 量、单 run observation 量和并发数执行至少以下验收：

- 正常路径：立即/定时、取消、评审、分页、重启恢复、备份恢复、升级和回滚。
- 故障路径：Remote 断线、重复提交、SQLite busy/只读/磁盘满、备份失败、Host 强杀、timer 晚到、模型/子进程超时、Workflow 忽略取消。
- 安全路径：敏感输入阻断、恶意生成脚本、artifact 越界、日志/错误脱敏、profile 权限和 token 访问。
- 容量指标：p50/p95/p99 command 与 list/detail 延迟、event-loop lag、数据库大小与写放大、CPU/内存、轮询 QPS、恢复时间和备份恢复点。

只有 P0 关闭、目标容量与故障注入通过、隔离 tarball 安装和真实浏览器验收完成后，才建议把状态从“受控试运行”提升为“生产可上线”。
