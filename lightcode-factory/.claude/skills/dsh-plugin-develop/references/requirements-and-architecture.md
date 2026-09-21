# 01 · 从原始需求到插件架构

## 1. 建立需求卡

不要直接从页面或目录结构开始。先把原始需求整理成以下字段：

```text
用户：谁使用这个能力？
触发：模型调用、用户点击、定时、Webhook 还是外部协议？
输入：字段、格式、大小、敏感性？
输出：JSON、文件、流式文本、页面还是外部副作用？
状态：瞬时调用还是长任务？是否保留历史？
控制：取消、超时、重试、审批、并发、幂等怎么处理？
依赖：模型、工具、文件、数据库、HTTP、子进程有哪些？
页面：入口、列表、详情、实时刷新、空态和错误态是什么？
安全：谁持有密钥？是否执行用户或模型生成的代码？
交付：单插件还是 bundle？目标 DSH/Node/OS 是什么？
```

信息不足时采用保守默认：secret 留在 Host；wire 只传有界 JSON；长任务允许取消；不承诺自动重试和 checkpoint；先适配一个精确 DSH 版本。

## 2. 选择正确扩展面

| 需求特征 | 首选形态 | 不要误用 |
| --- | --- | --- |
| 模型自主调用的一次性确定动作 | Tool | 不要为无状态查询建完整后台 |
| 拦截、审计、审批既有执行 | Hook/Policy | 不要复制执行器 |
| 有状态、可复用、可替换能力 | Host Service | 不要用全局变量冒充服务 |
| 多步骤、长任务、人工门禁 | Workflow + Service | 不要让 prompt 持有 durable 状态 |
| 页面、侧栏、控制台 | Web Client + Remote | 不要让 Browser 直接 import Host |
| 一键装配多个插件 | Bundle | Bundle 本身不应承载业务状态 |

## 3. 画清依赖和状态权威

推荐依赖方向：

```text
task-feature ──inject──▶ task-runtime ◀──Remote── task-web/client
      │                       ▲
      └──── DSH services ─────┘

task-suite ──bundle patch──▶ runtime + feature + web
```

状态流：

```text
用户/模型 ──command──▶ Host 状态权威 ──snapshot/event──▶ Web
                           │
                           ├── Agent/Tool
                           ├── Storage
                           └── Subprocess/API
```

每种状态只能有一个写入权威。Web 保存筛选器、选中项、草稿等交互状态，但不拥有任务事实。业务插件提交事实，Runtime 决定状态转换并持久化。

## 4. 确定包数量

采用最少包原则：

- 一个 Tool、没有 UI：一个 Host 包。
- 一个简单页面和少量 Host 方法：一个双端包，提供 `.` 和 `./client` 两个入口。
- 多个业务插件共享状态、协议和页面：拆成 runtime、web、feature、bundle。
- 不可信第三方插件：不要加载进 Host 进程；独立 worker/container + JSON-RPC、MCP 或 gRPC。

## 5. 写架构决策

编码前至少输出：

```markdown
## 版本矩阵
## 包拓扑与每个包的运行端面
## Service key 与 inject 清单
## Config 和 Remote schema
## 状态机及终态
## 取消、超时、重试、幂等和重启规则
## 数据、凭据、文件和执行权限边界
## 非目标与已知风险
## 分层验收用例
```

如果某个用户选择会改变状态权威、安全边界或包拓扑，必须先确认；普通命名、布局和内部实现细节可以采用合理默认值推进。

## 6. 推荐实施顺序

1. 固定版本，确认实际扩展点和 Service key。
2. 写 types/schema/state machine 和单元测试。
3. 实现 Host Service、持久化和 dispose。
4. 实现 Tool/Workflow，并把 `AbortSignal` 传到底层。
5. 注册 Remote，先在无 UI 条件下验证协议。
6. 实现纯 props React 组件，再接 Store/Slot。
7. 构建、检查 tarball、隔离安装、重启和卸载。

这个顺序能把业务错误、Cordis 激活错误、Browser 模块错误和打包错误分开定位。
