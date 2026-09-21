# 02 · Cordis 与插件生命周期

Cordis 是 DSH 的插件运行时。可以把 `Context` 看成带生命周期的服务容器，把 `Service` 看成稳定插座，把 `inject` 看成依赖声明，把 `effect` 看成安装副作用及其撤销动作。

## 最小插件

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'task-feature'
export const inject = ['tools']

export function apply(ctx: Context): void {
  ctx.logger.info('task feature activated')
}
```

模块顶层只放类型、常量和纯函数。事件监听、定时器、业务注册和连接应在 `apply`/Service 生命周期中创建。

## Context 与声明合并

消费者依赖能力名而不是实现类：

```ts
declare module '@deepseek-ai/cordis' {
  interface Context {
    taskRuntime: TaskRuntime
  }
}
```

声明合并只让 TypeScript 知道 `ctx.taskRuntime`，并不会创建运行时服务。真正的 Service 插件必须已装配并成功激活。

## Service

需要状态、生命周期或跨插件复用时使用 Service：

```ts
import { Service, type Context } from '@deepseek-ai/cordis'

export class TaskRuntime extends Service {
  static inject = ['storageDomain']

  constructor(ctx: Context, readonly config: Config) {
    super(ctx, 'taskRuntime')
  }

  protected async [Service.init](): Promise<void> {
    // 打开存储、恢复状态、注册 Remote
  }
}
```

Service key 是公共协议，类名是实现细节。修改 key 会影响所有 `inject` 消费者。

## inject 不是 import

- `import` 决定模块解析和代码依赖。
- `inject` 决定 Cordis 激活前需要哪些运行时服务。
- `dsh.client.inject` 描述 Browser 包级加载图，也不等于 Client 插件自身的 Cordis `inject`。

插件长期处于 `PENDING` 时，应核对 service key、运行端面和提供者是否激活；调整 YAML 顺序通常不能修复错误依赖。

## effect 与 disposer

所有可撤销副作用都要绑定当前插件 fiber：

```ts
export function apply(ctx: Context): void {
  ctx.effect(() => {
    const dispose = ctx.taskRuntime.registerFeature(registration)
    const timer = setInterval(() => void refresh(), 30_000)
    return async () => {
      clearInterval(timer)
      await dispose()
    }
  }, 'register task feature')
}
```

`ctx.on()` 通常已绑定生命周期；自行创建的 timer、连接、worker、registry entry 和文件 watcher 必须显式释放。否则 HMR 后会出现重复监听和重复注册。

## 生命周期顺序

```text
组合 Profile/Bundle/Patch
  → 解析 Loader 行和模块
  → 等待 inject
  → 校验 Config
  → apply / Service.init
  → 运行或 HMR
  → 停止 admission
  → dispose effects
  → abort 并等待任务
  → flush/close storage
```

后台 dispose 不能只发送取消信号后立即返回；应等待任务、mutation 和持久化彻底收敛。

## Config

部署可变项用 Schemastery 校验：

```ts
import z from '@deepseek-ai/schemastery'

export interface Config {
  timeoutMs?: number
  maxConcurrent?: number
}

export const Config: z<Config> = z.object({
  timeoutMs: z.natural().min(100).default(30_000),
  maxConcurrent: z.natural().min(1).max(64).default(2),
})
```

存储路径、外部地址、并发、超时、输出上限和功能开关都不应硬编码。secret 不要写进公开页面、日志或 bundle patch 示例。

## Event 还是 Service 方法

- 明确的一对一能力调用：Service method。
- 多方观察：event。
- 需要替换/包裹策略：waterfall/hook。
- 可被模型调用：Tool。

不要把所有通信都做成事件；事件过多会让错误传播、返回值和所有权变得模糊。
