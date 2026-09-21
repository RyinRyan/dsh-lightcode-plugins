# 05 · 前后台 Remote 通信协议

Host 与 Browser 是两个运行时，不能共享普通对象。Remote 应是一份版本化、可校验、只传 JSON 的窄协议。

## 单一契约来源

把 wire 类型和 runtime schema 放在 Host 与 Client 都能引用、且不引入 Node API 的模块中：

```ts
export interface TaskSnapshot {
  revision: number
  tasks: readonly TaskView[]
}

export interface StartTaskRequest {
  featureId: string
  input: Readonly<Record<string, string>>
  idempotencyKey?: string
}

export interface TaskRemote {
  snapshot(afterRevision?: number): Promise<TaskSnapshot>
  start(request: StartTaskRequest): Promise<TaskView>
  cancel(request: { taskId: string }): Promise<TaskView>
}
```

TypeScript 类型不能替代运行时校验。Host 在信任输入前解析 schema，Client 在接收不可信/跨版本数据时也应有兼容策略。

## 协议设计规则

1. 只传 JSON-safe value；不用 `Date`、`Error`、class、Map、Buffer、函数或 AbortSignal。
2. 时间用 ISO 8601 字符串，持续时间用整数毫秒。
3. enum 使用稳定机器值，显示文本由 locale 处理。
4. 路径、secret、provider credential 和内部堆栈不进入 Browser。
5. 列表提供游标/revision/上限，不返回无限历史。
6. 大输出使用 artifact id 或分页接口。
7. 每个 command 明确幂等性和重复提交结果。

## 错误模型

不要把任意异常字符串作为唯一协议：

```ts
export interface RemoteErrorView {
  code: 'NOT_FOUND' | 'INVALID_STATE' | 'VALIDATION' | 'CONFLICT' | 'INTERNAL'
  message: string
  retryable: boolean
  requestId: string
  details?: Readonly<Record<string, string>>
}
```

Host 日志可保留 stack，但 Client 只获得安全、可操作的信息。UI 根据 `code/retryable` 决定重试、刷新还是返回列表。

## Snapshot 与事件

推荐组合：

```text
首次进入 → snapshot()
收到 changed(revision) → 若 revision 连续则局部更新或重新 snapshot
断线/缺号 → snapshot(lastKnownRevision)
```

事件只是变化通知时最稳定：让 Host snapshot 继续作为事实权威。若传完整增量，需要定义 sequence、去重、顺序和历史补拉。

## 兼容性

- 加字段通常向后兼容，删除/改名/改语义需要协议版本。
- Client 对未知枚举显示“未知状态”，不要崩溃。
- 持久化 schema 与 wire schema 分开版本化，避免数据库结构直接泄漏到页面。
- Feature 版本记录在每个 run 中，历史数据按创建时版本解释。

## 安全与容量

- 每个字符串、数组、日志、观测和请求体都设上限。
- 对 id 使用 schema 和所属关系校验，不能只检查“像 UUID”。
- Remote 命令在 Host 重新做授权；按钮隐藏不是权限控制。
- 日志记录 requestId、方法、状态、耗时和大小，不记录请求 secret。
- Client 搜索和排序参数必须限制复杂度，防止昂贵查询。

## 协议测试

- 正常输入、边界值和未知字段。
- 不可序列化输出和超限输出。
- 重复 command/idempotency。
- 旧 Client 读取新增字段的新 Host 数据。
- 断线、乱序、重复事件和 revision 缺口。
- 错误码到 UI 行为的映射。
