# DSH 插件与 Cordis 基础

每次设计或开发 DSH 插件前先建立本页的概念模型。后续所有架构、目录和依赖判断都以这些定义为基础。

## 1. 什么是 DSH 插件

DSH 插件是由 DSH Loader 装配、由 Cordis 管理生命周期的代码模块。最小插件通常导出 `apply(ctx)`；它可以声明运行时依赖、接收经过 Schema 校验的配置、消费现有能力或向其他插件提供新能力。

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'example-feature'
export const inject = ['tools']

export function apply(ctx: Context): void {
  // 在当前插件生命周期内注册能力或消费服务
}
```

插件不是：

- 任意 npm 包：npm 包只有被 Loader 配置行加载后才成为运行中的插件。
- 一段提示词：插件是确定性代码和生命周期单元。
- 天然隔离的沙箱：普通插件运行在可信 Host 进程中。
- 必然包含页面的应用：纯 Host Tool 或 Hook 也可以是完整插件。
- Bundle：Bundle 负责组合插件，业务插件负责提供能力。

## 2. 什么是 Cordis

Cordis 是 DSH 使用的插件运行时，负责：

- 创建和划分 `Context` 作用域；
- 按 `inject` 等待运行时依赖；
- 安装和释放插件；
- 管理 Service、事件和 effect；
- 在配置变化或热重载时撤销旧生命周期。

Cordis 不负责：

- npm 包下载和版本解析；
- 自动设计业务状态机；
- 自动为插件提供进程隔离；
- 自动把 Host 对象传到 Browser；
- 自动让 workspace link 变成可发布 tarball。

可以把它理解为“具备依赖注入、作用域和释放能力的插件容器”，但实现时必须使用准确 API 和 Service key，不能只依赖类比。

## 3. 核心概念

### Context

`ctx` 是插件当前作用域能够看到的 Service、事件和生命周期入口。Host 和 Browser 各自有独立 Context，不共享普通 JavaScript 对象。

### Service

Service 是通过稳定 key 发布给其他插件的运行时能力，例如 `ctx.taskRuntime`。需要共享状态、生命周期或可替换实现时使用 Service。TypeScript 的 `declare module` 只增加类型，不会创建 Service。

### inject

`inject` 声明插件激活前必须存在的 Service key。它不同于：

- `import`：代码和 npm 模块依赖；
- `dependencies`：包管理器安装关系；
- `dsh.client.inject`：Browser 包级模块加载关系。

### effect 与 disposer

effect 表示“安装副作用并登记撤销动作”。插件创建的注册、订阅、定时器、Watcher、Worker、连接和进程必须在释放时清理，否则热重载会产生重复实例。

### Event 与 Hook

Event 适合多方观察；Hook/Waterfall 适合包裹或替换策略；明确的一对一能力调用优先使用 Service 方法。不要把所有通信都做成事件。

## 4. DSH 中容易混淆的对象

| 对象 | 定义 | 主要职责 |
| --- | --- | --- |
| npm 包 | 文件和依赖的发布单元 | 让 Node/Browser 能解析代码 |
| Cordis 插件 | Loader 装配的生命周期单元 | 注册、消费或组合运行时能力 |
| Service | 通过 `ctx.<key>` 提供的能力 | 跨插件复用状态或行为 |
| Tool | 暴露给模型调用的确定性动作 | 接收 Schema 输入并返回结构化结果 |
| Hook/Policy | 执行链上的拦截或策略 | 审批、审计、超时、权限、变换 |
| Workflow/Feature | 多步骤业务执行定义 | 使用 Runtime 提交节点事实和输出 |
| Browser Client | 浏览器端插件入口 | 页面、Slot、Store、本地化和命令 |
| Remote | Host 与 Browser 的 JSON 协议 | 查询快照、发送命令、传递安全错误 |
| Bundle | 包含 patch 的安装组合 | 一次安装并启用多个插件包 |
| Profile | 一套可启动的 DSH 组合 | 决定启用哪些 Bundle 和覆盖配置 |
| Patch | 对 Loader 插件树的配置变更 | 插入、覆盖或禁用配置行 |
| Skill | 提供给模型的工作方法或知识 | 指导模型如何完成某类任务 |

## 5. Host、Client 与 Composition 三个平面

```text
Host（Node.js）                         Client（Browser）
存储、文件、进程、Agent、凭据           React、Slot、Store、交互
状态与权限权威                           展示快照并发送命令
            │                              │
            └──── Remote：有界 JSON ───────┘

Composition：Bundle + Profile + Patch → Loader 插件树 → Cordis 激活
```

Host 与 Client 不能直接共享 Service 实例。Browser 需要 Host 数据时必须使用经过验证的 Remote 协议。Composition 只决定装配，不拥有业务状态。

## 6. 插件生命周期

```text
Profile/Bundle/Patch 组合配置
  → Loader 解析模块
  → Cordis 等待 inject
  → Config Schema 校验
  → apply / Service.init
  → 正常运行或热重载
  → 停止接收新工作
  → 释放 effect
  → 等待任务、mutation 和持久化收敛
```

一个插件的初始化和释放必须对称。能够启动但无法安全卸载、重载或停止的代码，不是完整插件实现。

## 7. 基础开发原则

1. **公开扩展点优先**：通过公开 exports、Service、事件和 Slot 扩展；不从构建产物深层导入内部组件。
2. **最小包与最小权限**：职责无需独立演进时不拆包；插件只注入完成任务所需能力。
3. **配置与代码分离**：部署可变项进入 Config Schema，不硬编码路径、并发、超时和服务地址。
4. **状态只有一个写入权威**：页面、Feature 和 Runtime 不得同时修改同一持久状态。
5. **协议只传必要数据**：Remote 使用可版本化、有大小限制的 JSON，不传 secret、Host 对象和内部堆栈。
6. **取消与停机完整闭环**：先提交终态，再发取消信号，拒绝晚到结果，最后等待资源释放。
7. **依赖身份唯一**：React、Cordis 和 DSH Client 基座不得被第二次打入 Browser bundle。
8. **信任边界明确**：Tool 沙箱不等于插件沙箱；第三方不可信插件应独立进程或容器运行。
9. **精确版本验证**：DSH 快速演进，目标版本的类型、exports 和实际运行行为才是依据。
10. **以可安装产物验收**：必须在离开源码链接的隔离 Profile 中验证真实 tarball。

## 8. 判断是否需要拆包

- 单个无 UI Tool：一个 Host 插件包。
- 简单页面和少量 Host 方法：一个同时提供 `.` 与 `./client` 的双端包。
- 多个 Feature 共享状态和页面：Runtime、Web、Feature、Bundle 分层。
- 不可信扩展：独立 Worker/Container，不作为普通进程内 Feature 加载。

拆包依据是独立职责、配置、生命周期、协议或发布节奏，不是页面数量或代码文件数量。
