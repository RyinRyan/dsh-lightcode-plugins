# 01 · Cordis 基础：先理解插座，再开发电器

Cordis 是 DSH 的插件运行时。最有用的类比不是“框架调用一堆回调”，而是“带生命周期管理的配电板”：`Context` 是配电板，Service 是有稳定名称的插座，插件是插上去的设备，`inject` 声明设备需要哪些插座，`effect` 记录拔下设备时要撤销什么。

## 五个核心概念

### Plugin

最小插件是导出 `apply(ctx)` 的模块。Cordis 激活插件时调用它；插件不应在模块顶层注册业务副作用。

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'hello-plugin'
export function apply(ctx: Context) {
  ctx.logger.info('plugin activated')
}
```

插件可用函数、对象或 `Service` 子类表达。只消费能力时优先函数；需要向其他插件提供稳定 `ctx.<key>` 时使用 Service。

### Context

`ctx` 是当前插件作用域看到的服务容器，也是事件和生命周期 API 的入口。消费者依赖服务名，而不是直接导入服务实现：

```ts
declare module '@deepseek-ai/cordis' {
  interface Context {
    reportRuntime: ReportRuntime
  }
}
```

声明合并只提供 TypeScript 类型，不会真的安装服务。运行时仍需插件创建并发布 `reportRuntime`。

### Service 与 inject

`inject` 是运行时依赖，不是 import 列表。Cordis 会让插件等待所需服务就绪；缺少依赖时插件通常停在 `PENDING`，而不是按文件顺序侥幸启动。

```ts
export const inject = ['tools', 'sessions']
```

依赖服务的方法，不依赖具体实现包。比如扩展 Agent 时依赖公共 Agent 服务，不要依赖默认 agent loop 实现。

### Event

事件用于观察、策略包裹和松耦合通信。常见模式：

| 模式 | 用途 | 心智模型 |
| --- | --- | --- |
| `emit` | 同步通知 | 广播消息 |
| `parallel` | 等待所有并行监听者 | 并行扇出 |
| `serial` | 按顺序等待 | 流水线 |
| `bail` | 第一个有效结果终止 | 责任链 |
| `waterfall` | `next()` 包裹下游 | 中间件洋葱 |

不要把所有通信都做成事件。明确的能力调用用 Service 方法；需要多方观察、插入策略或替换行为时用事件。

### Effect 与 Dispose

注册必须可逆。`ctx.on()` 已与当前插件生命周期绑定；自建定时器、连接、业务注册等使用 `ctx.effect()`：

```ts
export function apply(ctx: Context) {
  ctx.effect(() => {
    const timer = setInterval(() => void refresh(), 10_000)
    return () => clearInterval(timer)
  }, 'report refresh timer')
}
```

工作流注册应把后端返回的 disposer 交给 `ctx.effect`，这样插件卸载后不会残留重复注册：

```ts
ctx.effect(
  () => ctx.workflowBackend.registerWorkflow(registration),
  'register report workflow',
)
```

## 生命周期顺序

```text
发现配置行
  → 解析模块
  → 等待 inject 服务
  → 校验 Config
  → apply / Service.init
  → 正常工作、HMR 或配置变更
  → 停止接收新工作
  → dispose effect（通常逆序）
  → 释放服务与 fiber
```

需要异步停机的后台服务应在 dispose 中先阻止新请求，再取消在途工作，再等待任务落稳，最后关闭存储或连接。不要只“发取消信号就返回”。

## 配置

部署可变项必须进入 `Config`，并由 Schemastery 在插件加载时校验：

```ts
import Schema from '@deepseek-ai/schemastery'

export interface Config {
  timeoutMs?: number
}

export const Config: Schema<Config> = Schema.object({
  timeoutMs: Schema.natural().min(100).default(30_000),
})
```

如果 timeout、并发数、输出上限、存储路径或外部地址可能因部署不同而变化，就不应硬编码。

## 三个最常见的误解

1. `import` 不等于 `inject`：前者解析代码，后者等待运行时服务。
2. `declare module` 不等于提供服务：它只改变类型系统。
3. 热重载不是重新执行一遍就完事：旧插件必须完整 dispose，否则会留下重复监听、计时器和注册项。
