# 04 · 后台服务与业务工作流

后台插件负责浏览器不应承担的事情：持久化、文件系统、进程、凭据、Agent 调用、调度、幂等与权限边界。页面只是控制台，不应成为工作流状态权威。

## 何时提供 Service

当能力需要被多个插件复用、拥有状态或生命周期、需要替换实现时，提供稳定 `ctx.<key>`：

```ts
export class ReportRuntime extends Service {
  static inject = ['storageDomain', 'typert']

  constructor(ctx: Context, config: Config) {
    super(ctx, 'reportRuntime')
  }

  protected async [Service.init]() {
    // open storage, register remotes, recover durable state
  }
}
```

Service 名是公共契约，类名是实现细节。消费者通过 `inject = ['reportRuntime']` 等待服务。

## 状态权威与恢复

每一种状态只允许一个权威写入者。推荐的职责划分是：

- Backend 拥有 run、node、event、queue 和 review 状态。
- Workflow 插件拥有业务执行函数，但只能通过 `context.node/report/log` 提交事实。
- Web Client 只展示 snapshot 并发出命令。

启动时必须决定如何处理重启前的 `queued/running` 记录。如果没有 checkpoint 恢复能力，应明确标记为失败并记录“宿主重启导致执行中断”，不要把它伪装成自动续跑。

## 工作流注册契约

推荐注册 metadata + 完整执行函数，而不是为每个 runner 写中央 switch：

```ts
export const inject = ['workflowBackend']

export function apply(ctx: Context) {
  ctx.effect(() => ctx.workflowBackend.registerWorkflow({
    id: 'report',
    version: '1.0.0',
    name: '生成报告',
    description: '读取项目并输出结构化报告',
    parameters: [{ name: 'subject', label: '主题', required: true }],
    nodes: [{ id: 'scan', name: '扫描' }, { id: 'write', name: '生成' }],
    async execute(run) {
      const facts = await run.node({ id: 'scan', name: '扫描' }, async node => {
        node.signal.throwIfAborted()
        await node.log('开始扫描')
        return { files: 42 }
      })
      await run.node({ id: 'write', name: '生成' }, async node => {
        node.signal.throwIfAborted()
        return { title: run.input.subject, facts }
      })
    },
  }), 'register report workflow')
}
```

## 执行协议必须包含什么

- `runId`、`nodeId`、`attemptId` 或等价定位信息。
- `AbortSignal`，并传到模型、工具、网络和子进程。
- JSON 可序列化且有大小上限的输出。
- 有界日志/观测，避免持久化无限增长。
- 明确的状态机和终态不可逆规则。
- 幂等键或重复提交策略。
- 插件卸载时的接受边界：已接收任务由谁完成或取消。
- 超时、重试和人工评审属于谁。

## 取消不是一个布尔值

正确取消至少包含：先把 durable 状态变成 terminal，通知在途执行，拒绝晚到结果覆盖终态，等待资源收敛。一个不合作的节点即使稍后返回，结果也不能重新把任务标记为成功。

## 并发与队列

先用明确、可测试的策略：

- admission 先持久化，再进入内存队列。
- `maxConcurrentRuns` 是部署配置，不是常量。
- 同一资源需要串行时，把串行键写进协议。
- 所有状态变更经单一 mutation 链，避免并发读改写。
- 后台停止时先阻止 admission，再取消/等待 active task。

## 安全边界

- 凭据、token 和外部服务认证只保存在 Host。
- 用户输入进入 shell/路径/查询前必须结构化校验。
- 生成代码默认是不可信输入；由宿主沙箱与审批策略决定执行权限。
- 不可信第三方业务节点不要进程内加载，使用独立 worker 和窄 RPC。

## 保守的能力边界

第一版工作流建议只承诺顺序节点，不默认承诺 DAG 并行、checkpoint 续跑、自动重试或多进程调度。扩展这些能力前应先版本化运行协议和状态迁移，而不是只在 `execute` 中增加控制流。
