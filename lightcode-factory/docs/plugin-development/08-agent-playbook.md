# 08 · Agent 开发协议：从原始需求到 Plugin Bundle

把本文件连同用户原始需求交给开发 Agent。目标不是“尽快写出代码”，而是先把需求翻译成可验证的插件边界，再实现一个能独立安装、升级和卸载的 bundle。

## 输入模板

```text
业务目标：用户完成什么任务？
触发方式：模型自主调用 / 用户点击 / 定时 / 外部协议？
输入与输出：字段、大小、敏感性、是否持久化？
外部系统：API、文件、数据库、命令、认证方式？
交互：是否需要页面、实时进度、取消、审批？
执行：是否长任务、并发、重试、checkpoint、幂等？
发布：目标 DSH/Node/OS、registry、升级和卸载要求？
```

缺失信息先采用保守默认：Host 保存 secret；输出必须 JSON；长任务支持取消；不声称 checkpoint/重试；以精确版本构建；用隔离 profile 验证。

## 第 1 步：固定事实基线

1. 读取目标 DSH 的精确版本、对应源码/文档和现有 profile。
2. 记录 Node、包管理器、OS、Cordis 与相关 DSH 包版本。
3. 核对要用的扩展点、Service key、Client manifest 和 Remote 机制。
4. 将未验证能力写为风险，不以记忆猜 API。

产出：`compatibility.md` 或 README 中的版本矩阵。

## 第 2 步：做能力分解

把需求拆为：

- 确定性动作 → Tool 或普通函数。
- 可复用/有状态能力 → Host Service。
- 多步、长任务、评审 → Workflow runtime + 业务插件。
- 用户交互 → Client plugin + Remote。
- 安装组合 → Bundle。

只有职责确实独立演进时才拆包。单一工具不应机械复制“后台 + Web + 工作流 + Bundle”的四包结构。

## 第 3 步：先写契约

在实现前明确：

- Config schema 与默认值。
- Service key、public methods、注册/dispose 语义。
- Remote 入参/返回/错误 schema。
- 状态机、终态、重启行为。
- 取消、超时、重试、幂等与并发所有者。
- 数据大小、日志留存、secret 和权限边界。
- package exports、`dsh.client` 和 bundle patch。

## 第 4 步：按风险顺序实现

1. 纯类型/schema 与状态机。
2. Host Service，先用内存或 fixture 测试。
3. 业务插件注册与取消闭环。
4. Remote contract。
5. Client store 与纯 props 组件。
6. Slot/页面注册。
7. 构建、打包与安装入口。

不要从漂亮页面开始；先证明后台状态与生命周期。

## 第 5 步：依赖审计

对每个 import 回答：

1. 它在哪个端面运行，Host 还是 Browser？
2. 是类型、构建输入还是运行值？
3. 是否必须与宿主共享唯一身份？
4. Client 是私有打包还是 module external？
5. tarball 中由谁提供它？

找不到明确答案的依赖不能进入发布物。

## 第 6 步：验证梯

```text
typecheck
  → state/service unit
  → Loader composition
  → UI component
  → build artifact inspection
  → pack
  → isolated profile install
  → dump-config
  → end-to-end core path
  → restart/recovery
  → remove
```

每一步保存命令和结果。若使用 fixture model 或放宽权限，必须写清没有验证什么。

## 第 7 步：交付文档

至少包含：

- 产品能力与非目标。
- 包拓扑、Host/Client 边界和状态权威。
- 开发、构建、测试、打包、安装、卸载命令。
- 配置字段和持久化位置。
- 安全边界、权限、secret 与生成代码风险。
- 版本矩阵、升级策略、已知限制与排障入口。

## Agent 完成前自检

- [ ] 没有修改 DSH 核心来绕过公开扩展点。
- [ ] 没有把 token/credential 放进 Client、日志、prompt 或文档示例。
- [ ] 所有注册都有 disposer，所有 async teardown 被等待。
- [ ] 取消后晚到结果不能覆盖终态。
- [ ] Client bundle 没有第二份 React/Cordis。
- [ ] 发布物不依赖相邻源码 checkout。
- [ ] 相邻 DSH 版本未验证时没有声称兼容。
- [ ] tarball 在隔离 profile 实际安装运行过。
- [ ] 文档准确区分“已验证”“fixture 验证”“尚未验证”。
