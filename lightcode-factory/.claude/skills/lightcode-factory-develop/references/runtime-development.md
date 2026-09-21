# Runtime 开发规范

Runtime 是 Factory 控制面与唯一状态决策者：任务接纳、调度、状态转换、取消、评审、恢复、Remote Host 和 Browser Client。公共类型与 Port 属于 Contracts，具体数据库属于 Storage。

## 1. 修改入口

| 层 | 目录 | 规则 |
| --- | --- | --- |
| 公共类型/schema | `packages/contracts/src/types.ts`、`schema.ts` | JSON-safe；durable 与 wire 同步 |
| Workflow Port | `packages/contracts/src/workflow.ts` | 只含进程内注册/执行能力 |
| Repository Port | `packages/contracts/src/repository.ts` | 异步、有界查询、revision save |
| Remote | `packages/contracts/src/remote.ts` | 严格 schema、稳定 request/result |
| Host Runtime | `packages/runtime/src/index.ts` | 状态机、调度、mutation、Repository 调用 |
| Browser Client | `packages/runtime/src/client/index.ts` | 有界页面、详情、命令与轮询；不复制状态机 |

Contracts 不能依赖 Runtime。Runtime 不能依赖 `storage-sqlite`。Web 和 Workflow 不能访问 Repository。

## 2. 状态与并发

- 先定义合法转换、命令前置条件和终态；拒绝非法转换。
- 同一 run mutation 串行，按 Repository revision 保存；durable 写成功后才发布。
- 取消先保存终态，再 abort；晚到 output/observation 不得覆盖终态。
- 队列必须处理 queued cancel、Catalog 卸载、admission 中卸载、Runtime stop 和 finally 补位。
- 一次性计划使用 durable `queued + scheduledFor`：未到点不进入 runnable queue、不占并发槽；到点和取消竞态必须重读 durable status。长计划分段布防，Runtime stop 清 timer，相同 workflow id/version 注册后才恢复。
- 重试/恢复必须显式设计 attempt、幂等、副作用和 checkpoint；不能只加内存循环。
- registration disposer 必须阻止新 run，并取消/等待已捕获 implementation 的任务。

## 3. Remote 与查询

- `catalog`、`listRuns`、`getRun` 与命令职责分离；禁止重新引入无界 snapshot。
- list limit 在 wire、Runtime 和 Storage 三层设上限；cursor 必须严格解码、不能暴露 SQL。
- Browser 轮询只刷新第一页；详情单独读取；加载更多按 id 去重。
- 新字段同步修改 Contracts type、Zod schema、Repository、Storage、Remote、Client、Web 和测试。
- 错误信息稳定且安全，不向 Browser 暴露 stack、路径、SQL 或 secret。

## 4. 测试要求

覆盖 registration/disposer、参数校验、正常和非法状态、节点顺序、输出/观测限制、取消与晚到结果、revision 竞态、Catalog 卸载、Runtime stop、重启中断、定时不到点/到点/取消/卸载重注册/重启恢复/版本不匹配、cursor/limit、Remote descriptor 以及 Client 刷新/分页/disposer。真实组合使用 SQLite Adapter、Typert 和公开 Cordis lifecycle。

## 5. 完成检查

- 没有第二个状态写入者或只在内存成立的 durable 语义；
- Contracts、Host、Repository、Remote、Client、Web 与调用方一致；
- 查询有界，cursor/详情路径有行为测试；
- timer/controller/task/disposer 不泄漏；
- architecture、README、设计、Skill 和实际验证同步。
