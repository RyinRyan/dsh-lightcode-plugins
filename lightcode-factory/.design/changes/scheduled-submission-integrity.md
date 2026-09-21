# 定时创建提交完整性修复

- Change ID: `scheduled-submission-integrity`
- 变更类型: `web`
- 影响组件: Web 表单、测试、Factory 发布 metadata、lockfile、安装文档
- 设计状态: 已实现并验证

## 1. 需求与成功标准

实际 `lightcode@0.4.1` Profile 中，用户选择了定时执行和 14:57，但 durable run 在 14:56:25 创建时 `scheduled_for` 为 NULL，首个事件为立即任务的 `run.queued`。这证明创建表单在真实交互路径中遗漏了 `scheduledFor`，Runtime 因而只能正确地立即执行。

成功标准：表单提交从原生 form 当前选中的执行方式和时间读取值；定时模式缺少、非法或已过期的时间必须显示错误且绝不调用 `start()` 创建立即任务；发布为可区分的 `0.4.2` Bundle。

## 2. 组件选择与职责边界

选择 Web，因为缺失发生在 Browser 表单到 Runtime Client 的命令构造之前。Runtime 已把缺少 `scheduledFor` 解释为明确的立即任务，不能从 durable command 推断用户在 UI 中的意图。Contracts、Storage、Workflow 与 Remote 不变；Factory metadata 只为发布该 Web 修复。

## 3. 当前实现证据

- `FactoryBoard` 用 React `executionMode` 和 `scheduledLocal` state 决定是否向 `start()` 传第三个参数；
- Web slot adapter 将 `start(workflowId, input, scheduledFor)` 包装为只接收两个参数的函数，确实会丢弃第三个参数；
- 真实 run 的 `scheduled_for` 为 NULL，事件为 `run.queued` 和 `run.started`，说明调用方传的是两参数 immediate command；
- 已安装的 `lightcode-factory@0.4.1` 包包含定时表单和 Runtime 到期 guard，因此问题不在 timer 到期判断；
- 当前单测只覆盖 state 已同步后的成功定时路径，没有覆盖定时表单缺少有效时间时不得退化为 immediate。

## 4. 目标契约与数据流

表单 `onSubmit` 从 `FormData` 读取 `execution-mode` 和 `scheduled-for`。当 DOM 声明 `scheduled` 时，只要时间缺失、无法解析或不在未来，就终止提交并显示 `task.scheduleFuture`；只有有效时间才调用 `start(workflowId, input, isoTime)`。Web slot adapter 必须将第三个参数原样传给 Runtime Client。当 DOM 声明 `immediate` 时调用两参数 `start()`。

这不改变 Runtime Remote wire contract：`scheduledFor` 仍是可选字段，省略只表示用户明确选取的立即执行。

## 5. 状态、并发与生命周期

不修改 Runtime run/node 状态、队列、timer、取消、卸载、停止或重启恢复。Web 在切换回立即模式时清空本地时间，避免旧输入影响下一次创建；关闭对话框的 reset 语义保持一致。

## 6. 持久化、Remote 与兼容性

不修改 schema、SQLite、Remote descriptor 或历史 run。有效定时请求继续持久化 `scheduled_for`；无效定时请求不创建任何 run，因此不存在迁移或回滚数据。

## 7. Web 与交互

执行方式 radio 和计划时间 input 具有原生 `name`，提交以可见表单的真实值为准。用户选择定时但未提供有效未来时间时会看到“请选择未来的执行时间”，而不是任务悄然变成立即任务。按钮文字与现有模式保持一致。

## 8. 安全与数据边界

只读取已有的本地日期时间文本，不新增 credential、持久化字段、日志或 Browser 暴露数据。错误不回显用户输入。

## 9. 实现与接线计划

1. Web 表单给执行方式与计划时间添加 stable form names；
2. `onSubmit` 读取 `FormData` 并将模式和时间传入提交函数；
3. Web slot adapter 保留 `scheduledFor` 第三个参数；
4. 在立即模式切换时清除旧时间；
5. 增加缺少计划时间不得调用 immediate `start()` 和 adapter 透传时间的回归测试；
6. 将全部 Factory 同发布包升级到 `0.4.2`，同步锁文件和 README；
7. 审计、测试、构建、打包，并安装到活动 Profile 验证。

## 10. 测试与验收

- Web 单测：定时本地时间转换、定时模式缺少时间不调用 `start()`、立即模式仍省略 `scheduledFor`；
- 全量 audit/typecheck/test/build/pack；
- 检查六个 tarball 及 Factory 内嵌成员均为 `0.4.2`；
- 在 `lightcode` Profile 安装新包，创建短延时任务，确认 durable `scheduled_for` 非 NULL、首事件为 `run.scheduled`，到点前保持 queued。

### 实际验证结果

2026-09-21 已通过设计审计、typecheck、全量测试（8 个测试文件、36 项测试）、build、pack 和 built 审计；六个 tarball 的 package manifest 都是 `0.4.2`，且没有 `.pack-*` staging。新增 Web adapter 回归测试证明 `scheduledFor` 从 slot injection 原样传到 Runtime Client；新增表单回归测试证明定时模式缺少时间时不会调用 immediate `start()`。

活动 `lightcode` Profile 的安装曾被失效的配置中心 tarball 阻断；从该 Profile 已安装的 `dsh-configuration-center@0.1.0` 重建缺失 tarball 后，`lightcode-factory@0.4.2` 已成功安装。另创建专用 `lightcode-workflow-verify` Profile（仅安装 Factory `0.4.2`），于 `127.0.0.1:3897` 成功启动。用户已在该 Profile 完成实际功能验证并确认通过；定时创建不会再丢失 `scheduledFor`。Profile 仅隔离插件依赖，Factory SQLite 仍位于 DSH Home 下，若需要数据库隔离应另设 `DSH_HOME`。

## 11. 文档同步

- 更新 README 的安装文件名和定时提交保证；
- 更新 architecture 的 Browser 表单数据流；
- 新增本设计的实际验证记录；
- 不修改 migration、Skill 和历史版本设计：契约、schema 与历史发布事实不变。

## 12. 风险、限制与回滚

风险是原生 form 值和 UI state 不一致。以 form 当前值作为命令权威，并对 scheduled 缺时间 fail closed 降低风险。回滚可重新安装 `0.4.1`；数据库兼容且无数据迁移。一次性定时、单 Host 和无 Cron 等既有限制不变。

## 13. 设计自检

- [x] 问题边界在 Web，不把 UI 意图推断塞入 Runtime；
- [x] 无公开契约或数据格式变更；
- [x] 无效定时请求 fail closed；
- [x] 版本、Bundle 与文档接线已纳入；
- [x] 自动化与实际 Profile 验收范围明确。
