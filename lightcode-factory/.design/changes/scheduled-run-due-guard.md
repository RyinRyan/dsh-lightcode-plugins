# 定时任务到期防护修复

- Change ID: `scheduled-run-due-guard`
- 变更类型: `runtime`
- 影响组件: Runtime、测试、架构文档
- 设计状态: 已实现并验证

## 1. 需求与成功标准

一次性定时任务虽然在正常创建路径中只布防 timer，但 Runtime 的最终执行队列只校验 durable 状态为 `queued`，没有再次校验 `scheduledFor` 是否已经到期。任何重复或陈旧的入队信号一旦把未来任务放入 `queuedIds`，任务就会提前进入 `running`。

成功标准：未来的 durable `queued + scheduledFor` 即使误入可运行队列，也必须重新布防 timer，不能执行 Workflow；只有到期后才能开始执行。

## 2. 组件选择与职责边界

选择 Runtime，因为调度、到期判断和状态转换只由 Runtime 拥有。不修改 Contracts、Storage、Remote 或 Web：公开字段、持久化格式和交互均不变化。Workflow 不能承担共享调度防护。

## 3. 当前实现证据

- `queueRun()` 对定时任务正常调用 `armScheduledRun()`，而不是立即调用 `enqueueRun()`；
- timer 回调的 `releaseScheduledRun()` 会重读 durable run 并检查到期时间；
- `drainQueue()` 重读 durable run 后只校验 registration 和 `status === queued`，随后直接调用 `execute()`，缺少计划时间防护；
- 现有测试只覆盖正常 timer 路径，没有模拟未来任务意外进入 `queuedIds`。

## 4. 目标契约与数据流

当前：timer/recovery -> `enqueueRun()` -> `drainQueue()` -> 仅检查 `queued` -> `execute()`。

目标：timer/recovery -> `enqueueRun()` -> `drainQueue()` -> 重读 durable run -> 若 `scheduledFor` 仍在未来则重新布防并跳过 -> 到期后才 `execute()`。

到期判断继续使用 Runtime 的宿主时钟；取消、卸载、重启恢复、版本匹配和 Storage 数据不变。

## 5. 状态、并发与生命周期

不增加状态。未来计划仍为 durable `queued`，但不能占用 `activeCount`；执行队列发现计划未到期时重新布防 timer 并继续处理其他 runnable run。取消先落 `cancelled`、Runtime stop 清 timer、Workflow 卸载/重注册和 Host 重启恢复语义均保持不变。

## 6. 持久化、Remote 与兼容性

`scheduledFor` 字段、SQLite schema v2、Remote v2 和 Browser Client 均不变化。历史数据、当前 0.4 数据和 Bundle 接线兼容，无 migration。

## 7. Web 与交互

Web 表单、时间转换、卡片和详情展示不变化。用户可观察变化只有未来定时任务不再提前进入 running。

## 8. 安全与数据边界

不新增输入或持久化数据，不改变 credential、output、observation 或错误信息边界。防护只读取已经通过 schema 校验的 durable `scheduledFor`。

## 9. 实现与接线计划

1. 在 `drainQueue()` 启动 task 前增加未来计划时间防护；
2. 增加回归测试，主动模拟未来定时任务误入 runnable queue，断言到点前不执行、到点后只执行一次；
3. 更新架构文档与 README，明确执行队列会二次校验 durable 到期时间；
4. 运行设计审计、typecheck、全量测试和 build。

不需要数据库迁移、Bundle 成员变更或 Remote 兼容处理。若基础验证通过，是否重新打包并安装到隔离 DSH Profile 作为后续发布验证记录。

## 10. 测试与验收

- Runtime 回归：未来计划正常保持 queued；人为触发提前入队后仍不执行；到点后只执行一次并进入 review；
- 回归门禁：`audit:ai`、设计审计、typecheck、全量 test、build；
- 本次没有 UI 代码变更，Browser 验收不是证明该 Runtime 防护的必要条件；若重新发布 Bundle，再执行隔离安装与真实短延时任务验收。

### 实际验证结果

2026-09-20 已通过设计文档审计、`npm.cmd run audit:ai`、`npm.cmd run typecheck`、全量 `npm.cmd test -- --run`（7 个测试文件、34 项测试）和 `npm.cmd run build`。新增 Runtime 回归用例证明未来计划即使提前进入 runnable queue，仍保持 queued，到点后只执行一次。本次没有重新打包、安装或执行桌面 Browser 验收。

## 11. 文档同步

- 更新 `docs/architecture.md`：记录执行前 durable 到期二次校验；
- 更新 `README.md`：记录定时任务不会因提前入队信号而提前执行；
- 不修改 AGENTS/Skill：既有“到点才入执行队列”原则没有变化，本次只是补齐实现防线；
- 不修改 migration：schema 和兼容策略没有变化。

## 12. 风险、限制与回滚

主要风险是错误地把已到期任务继续布防，或让未来任务阻塞其后的立即任务。实现使用严格的 `scheduledFor > Date.now()` 判断，并在重新布防后 `continue` 队列循环。回滚只需移除 Runtime guard 和对应测试/文档，无数据回滚。

既有限制不变：单 Host、进程内 timer、停机期间不执行、恢复后过期任务立即入队，不支持 Cron、重复任务或分布式 lease。

## 13. 设计自检

- [x] 状态所有者仍只有 Runtime；
- [x] 无公开契约、数据格式或迁移变化；
- [x] 取消、卸载、停止和重启语义不变；
- [x] 回归测试可直接证明用户报告的提前执行问题；
- [x] 文档与验证范围明确。
