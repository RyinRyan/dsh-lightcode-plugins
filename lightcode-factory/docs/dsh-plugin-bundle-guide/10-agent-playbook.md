# 10 · 给开发 Agent 的执行协议

把本文件与用户的原始需求一起交给 Agent。目标是得到一个可独立安装、升级、卸载和验证的 DSH plugin bundle，而不是只能在当前源码目录运行的演示。

## Agent 的第一份输出

在写代码前必须给出：

1. 用户目标和非目标。
2. 精确版本基线：DSH CLI/SDK、Cordis、Node、OS、包管理器。
3. Tool/Hook/Service/Workflow/Web/Bundle 的选择理由。
4. 最小包拓扑和单向依赖图。
5. 状态权威、Config、Service、Remote 和状态机契约。
6. credential、文件、子进程、模型生成内容和第三方插件的安全边界。
7. 分层测试与最终验收标准。
8. 未验证接口和需要用户决定的高影响问题。

Agent 不得凭记忆断言 DSH API；必须检查目标版本 package exports、类型声明、实际源码或官方材料。

## 开发步骤

### A. 固定事实

- 读取现有 workspace 指令和未提交变更，不覆盖用户代码。
- 获取 `dsh --version`、Node、Cordis 和已安装 SDK 版本。
- 记录目标 profile、DSH home、端口和数据隔离策略。
- 验证所需 Service key、event、slot、Remote 和 client manifest。

### B. 先写契约

- Config runtime schema。
- JSON-safe wire schema、错误码、revision/sequence。
- 状态机、终态、取消、超时、重试、幂等和恢复。
- feature 注册/dispose 协议。
- package exports、`dsh.client`、external 和 bundle patch。

### C. 按风险实现

```text
types/schema/state machine
  → Host Service + persistence
  → feature/tool/workflow
  → Remote
  → Client store + pure React component
  → Slot/page registration
  → build/pack/install scripts
```

### D. 依赖审计

对每个 import 回答运行端面、运行/类型性质、唯一身份要求、Browser external 提供者和 tarball 安装责任。禁止使用未公开的深层 import 作为稳定方案。

### E. 验证

```text
typecheck
  → service/state unit
  → loader composition
  → UI component
  → build artifact inspection
  → pack
  → isolated profile add/dump-config/start
  → core/cancel/error path
  → restart/history
  → update/remove
```

测试失败必须定位根因，不能通过修改 DSH 核心、放宽生产权限、吞异常或跳过真实 tarball 验证来“通过”。

## 默认工程决策

用户没有明确指定时：

- 使用 TypeScript strict、ESM 和 project references。
- 使用精确 DSH/Cordis 版本。
- Host 保存 secret；Client 只收最小 JSON view。
- 所有注册返回 disposer 并进入 `ctx.effect`。
- 所有长任务带 `AbortSignal`，输出/日志有上限。
- 没有 checkpoint 就在重启时明确失败，不伪装续跑。
- React/Cordis/DSH Client 基座 external，不打第二份。
- 发布新版本号，不覆盖同版本 tarball。
- 使用隔离 DSH home/profile 与 fixture，不读取用户真实凭据。

## Agent 完成前检查表

- [ ] 没有修改 DSH core。
- [ ] 没有把 credential/token 写入 Client、prompt、日志或文档示例。
- [ ] Host/Client 文件和依赖图分离。
- [ ] Service key、inject 和 Context 声明一致。
- [ ] Config 与 Remote 有运行时 schema。
- [ ] 所有 listener/timer/registry/connection 有 disposer。
- [ ] dispose 等待任务、mutation 和存储收敛。
- [ ] 取消后的晚到结果无法覆盖终态。
- [ ] Browser bundle 没有第二份 React/Cordis。
- [ ] 发布物不依赖相邻 checkout、绝对开发路径或 workspace link。
- [ ] tarball 内容已检查并在隔离 profile 真实安装。
- [ ] add、dump-config、启动、核心路径、重启、升级和 remove 已验证。
- [ ] 文档区分已验证、fixture 验证和未验证事项。

## 推荐交付报告

```markdown
# Plugin Bundle 交付报告

## 结果
- 实现了什么；未实现什么。

## 包与协议
- 包拓扑、Service key、Remote、状态和数据位置。

## 构建产物
- tgz 路径、版本、大小、SHA256。

## 验证
- 自动测试数量与结果。
- 隔离 profile 安装/启动/重启/卸载结果。

## 安全与限制
- credential、权限、sandbox、生成内容、恢复策略。

## 用户操作
- 安装、启动、升级、回滚、卸载的标准命令。
```

最终答复以用户可执行的结果为主，不堆砌工具过程；涉及本地文件时提供准确链接。
