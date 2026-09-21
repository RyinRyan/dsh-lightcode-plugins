# 02 · DSH 插件原理与分类

DSH 是基于 Cordis 组合出来的 agent harness。模型、工具、会话、Agent loop、沙箱、权限、存储和 Web UI 都是可替换或可扩展的插件能力。开发插件的本质是选择正确的扩展面，而不是修改一个“中央内核”。

## 先按职责分类

| 类型 | 典型需求 | 主要接口 | 是否需要 Web |
| --- | --- | --- | --- |
| 工具插件 | 让模型读取业务数据、执行确定性动作 | `ctx.tools.register(defineTool(...))` | 否 |
| Hook / 策略插件 | 审批、限流、超时、审计、结果变换 | `tools/pre-execute`、`tools/execute`、`tools/result` 等 | 否 |
| Prompt / Skill 插件 | 注入说明、按需暴露工作方法 | system prompt、Skill provider、tool | 否 |
| Service / Provider | 提供可复用能力或替换实现 | `Service`、`ctx.<key>`、provider registry | 可选 |
| Agent / Workflow 插件 | 驱动多步业务过程 | Agent API、workflow engine 或业务 runtime | 可选 |
| 协议驱动 | 接入 ACP、MCP、JSON-RPC 或自有客户端 | gateway + Agent/Service | 可选 |
| Web UI 插件 | 页面、侧栏、面板、业务状态 | Client bundle、slots、store、Remote | 是 |
| Bundle | 把多个插件和配置作为一个产品安装 | `dsh.bundle.patch` | 取决于成员 |

一个业务功能可以跨多类，但每个包只应有清晰职责。典型双端产品可以拆为：后端 runtime、Web 页面、业务工作流和安装 bundle。

## 工具、工作流和后台服务如何选择

- 单次输入能直接得到输出，且模型需要自主调用：做工具。
- 需要稳定状态、并发控制、持久化、取消或供多个插件复用：做后台 Service。
- 有多个节点、人工评审、业务状态机或长任务：在 Service 之上做 Workflow，不要把 durable 状态塞进提示词。
- 只是拦截或观测现有调用：做 Hook，不要复制整个执行器。

## DSH 的双端插件

有页面的插件实际上有两个运行时：

```text
Node Host                                      Browser Client
┌──────────────────────────┐                  ┌────────────────────────┐
│ Cordis Host Context      │   Remote/RPC     │ Cordis Client Context  │
│ 存储 / 文件 / 进程 / Agent│ ◀──────────────▶ │ React / Slots / Store  │
│ 权限与可信边界            │                  │ 纯展示与用户交互         │
└──────────────────────────┘                  └────────────────────────┘
```

两端的 `ctx` 不是同一个对象。浏览器不能直接读取 Host Service；需要一个可校验的 wire contract。密钥、凭据、动态 token、文件系统路径和执行权限只能留在 Host。

## Bundle、Profile 与 Patch

- **插件包**：提供代码能力，可被配置行加载。
- **组合包 Bundle**：npm 包 + `dsh.bundle.patch`，说明“安装后贡献哪些配置行”。
- **Profile**：用户机器上的可启动组合，说明“按什么顺序使用哪些 Bundle”。
- **Patch**：对插件树插入或替换配置行的 YAML 层。

层的顺序是：profile 中的 bundles → profile patch → home patch → 命令行 `--patch`。后层覆盖前层，且同一行的 `config` 是整体替换，不是深合并。

## 可信边界

普通 DSH 插件是宿主进程内的可信代码。它可以获得被注入服务的能力，npm 安装脚本还可能在 Agent 沙箱之外执行。因此：

- 第三方不可信插件需要独立进程或容器，并通过 JSON-RPC、MCP、gRPC 等窄协议通信。
- 协议必须带版本、输入输出 schema、能力声明、超时/取消、幂等键和结构化事件。
- “用了 sandbox 插件”不等于“插件本身被隔离”；沙箱通常约束工具或子进程执行。

## 推荐的工作流契约

后台 runtime 负责 durable 状态、队列、并发、取消、评审和 Remote；业务工作流只注册 metadata + `execute`。这样增加新工作流时无需改后台或看板，且一个工作流插件卸载时可撤销注册并取消它拥有的运行。
