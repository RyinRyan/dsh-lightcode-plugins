# 定时执行工作流任务设计

- Change ID: `scheduled-workflow-runs`
- 变更类型: `cross-cutting`
- 影响组件: Contracts、Runtime、SQLite Storage、Web、Workflow Catalog、Factory Bundle 与文档
- 设计状态: 已实现并验证

## 1. 需求与成功标准

当前新建任务只有“创建并执行”，所有 run 持久化后立即进入内存执行队列。用户需要在相同创建表单中选择立即执行或指定未来时间进行一次性执行。同时，隔离验收中的“晨间脚本生成”连续三次在第二节点失败；数据库证据显示首节点完成，`generate-script` 以 `Agent did not complete: error` 失败。该 Profile 启动时跳过模型 API Key 配置，因此故障属于模型依赖未就绪，而不是 Runtime/SQLite 调度失败，但现有错误缺少可操作提示。

成功标准：

1. 新建任务可选择“立即执行”或“定时执行”，定时模式必须提供未来日期时间；
2. 定时任务先以 `queued` 持久化，到点才占用并发槽并执行，页面明确显示计划时间；
3. 到点前取消会持久化 `cancelled` 并释放 timer，晚到 timer 不能启动任务；
4. Host 意外重启后，未到点的定时任务保持 queued，在相同 workflow id/version 注册后恢复计时；运行中的任务仍按现有策略标记 failed；
5. SQLite schema 迁移保存计划时间，旧的当前 0.3 schema 可原地升级；不恢复 0.2/JSON 兼容；
6. 晨间脚本的 Agent 错误提示明确建议检查当前 DSH 模型与 API Key 配置，不暴露凭据；
7. Contracts、Storage、Runtime、Browser Client、Web、测试、文档、Bundle 版本和真实 DSH 验收一致。

非目标：周期任务、Cron、重复规则、时区管理界面、修改计划时间、重试、checkpoint、跨 Host 调度和模型凭据管理。

## 2. 组件选择与职责边界

- Contracts 定义可持久化/可传输的 `scheduledFor` ISO 时间；
- Runtime 是计划校验、计时、到点入队、取消和恢复的唯一状态决策者；
- SQLite Storage 只迁移和保存字段，不创建 timer、不决定何时执行；
- Web 提供通用的一次性执行方式选择并显示计划时间，不按 workflow id 分支；
- Workflow Catalog 不拥有调度，仅改进晨间脚本的模型依赖错误说明；
- Factory Bundle 只随成员版本更新重新打包，不新增装配成员。

演进顺序为 Contracts → Storage/Runtime → Runtime Client → Web/Workflow → Bundle。定时调度不能放进具体 Workflow，否则每个业务流程都会复制状态和 timer；也不能放进 Web，否则关闭页面后任务无法执行。

## 3. 当前实现证据

- `WorkflowStartRequest` 只有 `workflowId/input`，`WorkflowRunView` 没有计划时间；Zod durable schema 与 Remote start schema同样没有该字段；
- Runtime `queueRun()` 写入 queued 后立刻加入 `queuedIds` 并 `pump()`；内存结构没有 scheduled timer；
- Runtime 启动时把 `listInterruptedRuns()` 返回的 queued/running 全部标记 failed；
- registration disposer 会取消所有已接纳的 queued/running run；
- SQLite `user_version = 1`，`factory_runs` 没有计划时间列；
- Browser Client 的 `start()` 只发送 workflowId/input；Web 表单只有业务参数和“创建并执行”；
- RunOverview 把 `createdAt` 回退成开始时间，因此尚未执行的 queued run 会出现误导性耗时；
- 最新三条 `morning-script-demo` 均在 `generate-script` 节点失败，错误为 `Agent did not complete: error`。

## 4. 目标契约与数据流

`WorkflowStartRequest` 与 `WorkflowRunView` 新增可选 `scheduledFor: string`。Browser 将 `datetime-local` 的本地值转换为 ISO UTC 字符串；Remote/Runtime 严格校验为有效且未来的时间。立即执行不传字段。

```text
Web execution mode + local datetime
  -> Browser Client start(workflowId, input, scheduledFor?)
  -> Remote start request
  -> Runtime validate + create durable queued aggregate
  -> SQLite scheduled_for
  -> immediate: queuedIds/pump
     scheduled: Runtime timer -> due -> queuedIds/pump
```

列表和详情沿用现有聚合，无新增 Remote 方法。计划时间是 aggregate 的通用字段，所有 Workflow 自动获得能力。

## 5. 状态、并发与生命周期

状态仍为六态，定时任务使用 queued，不增加只为页面存在的新状态。Runtime 保存 `scheduledTimers`；未到点的任务不进入 `queuedIds`、不占并发槽。长于 JavaScript 单次 timer 上限的任务分段重新布防。

- 创建：先 durable create，再接纳 registration，最后布防 timer；写入中插件卸载仍走已有取消语义；
- 到点：删除 timer，再进入 queuedIds；`drainQueue()` 重新读取 durable run，非 queued 或 registration 缺失时不执行；
- 取消：先 durable cancelled，再清 timer/abort；timer 与取消竞态由 durable status 二次检查收口；
- Workflow 显式卸载：立即任务按现有规则取消；尚未执行的定时任务解除本次 registration/timer 但保留 durable queued，等待同 id/version 再注册或由用户取消；
- Runtime stop：清理全部 timer，等待 admission/task/mutation；不把未到点任务改为失败；
- 重启：running 和无计划时间的遗留 queued 仍标记 failed；合法 scheduled queued 保留，等相同 id/version 注册后重新布防；版本不匹配不执行并标记 failed，避免新实现执行旧计划；
- 晚到 timer、重复注册或重复布防不能产生重复 `queuedIds`。

## 6. 持久化、Remote 与兼容性

SQLite schema 升至 `user_version = 2`，`factory_runs` 新增 nullable `scheduled_for TEXT`。空库直接创建 v2；当前 v1 在事务中 `ALTER TABLE` 并记录 migration 2。仍拒绝 user_version 0 的旧 Factory 表、0.2 数据和 JSON 导入。

Zod schema 要求 `scheduledFor`（若存在）是 datetime 字符串；Remote start 接受相同可选字段。历史 v1 数据迁移后该列为 NULL，行为等价立即执行。版本统一升级到 0.4.0。

## 7. Web 与交互

创建对话框增加通用“执行方式”单选组：立即执行默认选中；选择定时执行后显示必填 `datetime-local`。过去时间、空值或非法值在浏览器和 Runtime 均拒绝。提交按钮文本分别为“创建并执行”和“创建定时任务”。

queued 卡片在存在未来 `scheduledFor` 时显示“计划于 … 执行”；详情运行信息显示计划时间。真正的开始时间来自 `run.started` 事件/节点时间，不再用 createdAt 冒充；未开始任务不显示累计耗时。交互保持键盘、label/fieldset/legend 和错误区域可访问，窄屏沿用表单单列回退。

## 8. 安全与数据边界

计划时间不含 credential。Runtime 只接受可解析的未来 ISO datetime，并限制 wire 字符串长度；错误不回显请求对象或环境信息。模型失败提示只建议检查 DSH 模型/API Key，不读取、持久化或显示 Key。所有 input/output/observation 边界保持不变。

## 9. 实现与接线计划

1. Contracts 增加 `scheduledFor` type、durable schema、Remote request schema；
2. SQLite 增加 schema v2 migration 和字段 round-trip；
3. Runtime 增加校验、timer、到点入队、取消/卸载/停止清理和重启恢复；
4. Browser Client 与 Web 表单/卡片/详情/locale/CSS 消费字段；
5. Workflow Catalog 改进 Agent 非完成错误信息；
6. 更新 Contracts/Storage/Runtime/Web 测试以及晨间 Workflow 失败断言；
7. 版本、lockfile、architecture、README、migration、AGENTS 与 Skill runtime/web/storage/testing references同步；Factory patch 成员不变；
8. build、pack、隔离安装，将现有 v1 验收库迁移到 v2并完成立即/定时/取消/重启恢复和 Browser 验收。

## 10. 测试与验收

- Contracts：scheduledFor durable/wire 接受合法值、拒绝非法格式；
- Storage：空库 v2、v1→v2 migration、NULL/ISO round-trip、备份恢复；
- Runtime：立即执行、未来时间不提前执行、到点执行、过去时间拒绝、到点前取消、timer/取消竞态、停止清理、重启恢复、版本不匹配、插件卸载/重注册；
- Browser Client：start 正确发送/省略 scheduledFor；
- Web：默认立即、切换定时、必填/提交、错误反馈、卡片/详情计划时间、可访问名称；
- Workflow：Agent error 提示包含模型配置建议；
- 全量 audit/typecheck/test/build/pack 和 tarball 清单；
- 隔离 DSH：从实际 v1 数据库启动完成 v2 migration，Browser 创建立即任务、短延时任务和取消任务，观察不到点不执行、到点执行与页面时间。

### 实际验证结果

2026-09-18 已完成：`npm.cmd run audit:ai`、带 `--built --design --docs` 的审计、`npm.cmd run typecheck`、全量 `npm.cmd test -- --run`、build 和 pack 均通过。全量测试为 7 个测试文件、33 项测试，包含定时不到点/到点、取消、卸载重注册、Runtime 重启恢复、版本不匹配、SQLite v1→v2 migration、Browser Client request 省略/发送字段、Web 本地时间转换，以及晨间脚本模型失败提示。

生成 Bundle `dist/lightcode-factory-0.4.0.tgz`，SHA-256 为 `34B30B60071E905F502C00345C8C21749128B4D3F9A0F5F97BAF83C2A87AED76`。它已安装到隔离 DSH Profile `factory-03` 并启动于 `127.0.0.1:3896`；该 Profile 的 package manifest 显示 `lightcode-factory@0.4.0`。保留的 0.3 验收数据库包含 4 条 run，启动后实际为 `user_version = 2`，含 `scheduled_for`，migration 表为版本 1、2。未经 token 的请求返回 DSH 认证要求，表明 Host 正常响应。

本次无法完成新的桌面浏览器点击验收：Codex 浏览器控制被当前账户用量限制拒绝，且不能绕过该安全限制。自动化的 Web/Client 行为测试已通过；待可用时应在上述服务 URL 用认证链接手动复核短延时创建、未到点卡片时间、到点执行和取消。

## 11. 文档同步

更新 `AGENTS.md` 的定时状态不变量、`docs/architecture.md` 的 Runtime/Remote/SQLite/Web 数据流、README 用户能力与生产边界、`docs/migration.md` 的 0.4 migration/验证记录，以及 Skill 的 Runtime/Storage/Web/测试 references。`production-storage-foundation.md` 是 0.2 历史设计，保留当时 19 项测试和 0.2 制品事实，不改写成当前验证结果。

## 12. 风险、限制与回滚

风险是 timer 与取消竞态、插件卸载、长延时溢出和 v1 migration。以 durable status 二次检查、分段 timer、相同 workflow version 恢复和事务 migration 降低风险。

回滚到 0.3 不能直接打开 v2 数据库；需恢复升级前备份或继续使用 0.4。当前仍是单 Host 进程内 timer：Host 停机期间不会执行，恢复后对已过期任务立即入队；没有 Cron、重复任务、分布式 lease、错过窗口策略或时区规则管理。

## 13. 设计自检

- [x] 当前实现证据来自本 checkout 的源码和测试。
- [x] 组件选择正确，没有把业务特例放入 Runtime/Web。
- [x] Runtime 仍是 durable run 状态的唯一决策者。
- [x] 类型、storage schema、wire schema 与调用方影响已覆盖。
- [x] 数据迁移或破坏性策略明确。
- [x] 取消、失败、卸载、停止、重启和竞态已分析。
- [x] Web 有通用回退、可访问性和无业务特例保证。
- [x] 安全、凭据、日志/输出边界明确。
- [x] 测试、构建、Bundle 和真实验收范围完整。
- [x] 文档同步清单与无需更新的理由完整。
