# 03 · Host 后台服务开发

Host 负责浏览器不能承担的能力：持久化、文件系统、子进程、凭据、Agent 调用、队列、幂等、取消、恢复和权限边界。页面只是控制台，不是状态权威。

## Service 的职责边界

一个通用任务 Runtime 通常负责：

- 注册与注销业务能力。
- 校验输入并创建 durable run。
- 队列和并发控制。
- 状态机与事件序列。
- 节点输出、观测和错误留存上限。
- 取消、超时、人工门禁。
- 重启恢复策略。
- 向 Web 暴露窄 Remote。

业务 Feature 负责：业务 metadata、节点列表和 `execute`，不直接写 Runtime 存储。

## 注册协议

推荐注册 metadata + 执行函数，并返回 disposer：

```ts
export interface FeatureRegistration {
  id: string
  version: string
  name: string
  parameters: readonly Parameter[]
  nodes: readonly NodeDefinition[]
  execute(context: RunContext): Promise<void>
}

ctx.effect(
  () => ctx.taskRuntime.registerFeature(registration),
  'register feature',
)
```

注册时拒绝重复 `id`；卸载时明确处理该插件拥有的排队和执行中任务。不要在中央 Runtime 为每种业务写 switch。

## 状态机

先写允许的转换，再写执行代码：

```text
queued → running → completed
             └──→ review → completed
queued/running/review → cancelled
queued/running/review → failed
```

终态不可逆。所有 mutation 通过事务或单一串行链执行，避免两个异步回调同时读改写。

## Admission 与队列

可靠顺序：

1. 校验 feature、版本、输入和幂等键。
2. durable write 创建 `queued` 记录。
3. 返回 `runId`。
4. 加入内存队列并按并发策略调度。

不要先入内存队列再持久化；进程在两步之间退出会产生不可追踪任务。

## 节点执行上下文

```ts
export interface NodeContext {
  runId: string
  nodeId: string
  attemptId: string
  signal: AbortSignal
  log(message: string): Promise<void>
  report(event: ObservationInput): Promise<void>
}
```

输出必须 JSON 可序列化并设置大小上限；日志和观测采用条数/字符数/字节数上限。文件产物保存路径或 artifact id，不把大文件塞进 Remote snapshot。

## 正确取消

取消不等于设置一个布尔值：

1. 在 mutation 链中将 run 写成 `cancelled`。
2. 记录取消原因和操作者。
3. 触发对应 `AbortController`。
4. 将 signal 传给 Agent、fetch、工具和子进程。
5. 节点返回和提交结果前再次检查 durable 终态。
6. 等待资源退出；晚到结果不得覆盖终态。

协作式取消仍需超时与强制清理策略，否则不响应 signal 的子进程会阻塞停机。

## 重启恢复

启动时扫描非终态记录并选择一种明确策略：

- 有完整 checkpoint、版本固定且节点可幂等：恢复。
- 任务可安全重放：创建新 attempt 并重试。
- 条件不足：标为 failed，写入“宿主重启导致中断”。

不要只把数据库中的 `running` 改回队列；没有恢复点时会重复副作用。

## 停机顺序

```text
stop admission
  → cancel queued/active according to policy
  → await active tasks
  → await pending mutations
  → flush storage
  → close connections/workers
```

每一步设上限并记录未能收敛的资源。Service disposer 必须可重复调用且不抛出无关异常。

## 安全

- credential、token 和外部认证只存在 Host。
- 用户输入进入路径、shell、SQL 和 URL 前进行结构化校验。
- 模型生成代码默认不可信；使用 DSH sandbox/policy 和审批机制约束执行。
- 进程内插件本身是可信代码；不可信第三方扩展必须隔离到独立 worker/container。
- 日志只记录请求 id、耗时、状态和脱敏摘要。
