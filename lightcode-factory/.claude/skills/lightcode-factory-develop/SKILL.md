---
name: lightcode-factory-develop
description: 在 lightcode-factory 中设计、实现、测试并交付 Contracts、Runtime、SQLite Storage、Workflow Catalog 或 Web 变更。用于判断组件边界，开发业务流程，演进状态/Repository/Remote 契约，开发统一 Web 展示并同步架构文档；仅做仓库外普通 DSH 插件时不要使用。
---

# LightCode Factory 开发

目标是让 Agent 先选择职责层，再按公开契约实现，并在交付前刷新设计、架构文档和验证证据。

```text
Contracts（共享类型、schema、Workflow/Repository Port、Remote）
   ↑             ↑                 ↑
Runtime       Storage          Workflows
   ↓
Browser Client → Web

Factory Bundle：只负责安装装配
```

## 必须执行的七个 Gate

### Gate 1：读取当前事实

1. 完整读取根 `AGENTS.md`、`docs/architecture.md` 和 [仓库探索](references/repository-discovery.md)。
2. 检查工作区状态，保护用户已有修改。
3. 从当前源码、测试、manifest、lockfile 和脚本确认版本、接口、限制与接线；不得把 Skill 快照当事实。

### Gate 2：选择组件

完整读取 [组件选择](references/component-selection.md)：

- Contracts：跨 Host/Browser/Storage/Workflow 的稳定类型、schema 或 Port；
- Runtime：共享接纳、调度、状态决策、取消、评审、恢复、Remote 或生命周期；
- SQLite Storage：持久化介质、migration、事务、索引、分页、备份或恢复；
- Workflow Catalog：内置业务流程的参数、顺序节点、执行、输出与观测；同发布/权限/依赖边界时默认在一个 Catalog 内按 id 分目录；
- Web：共享 Browser 信息架构、交互、renderer、轨迹或响应式行为；
- Factory Bundle：只在成员、安装或发布装配变化时接线。

普通 Workflow 无法表达需求时，不得在业务目录私建状态机、timer 或页面特例；应改判为 Contracts/Runtime/Web 扩展。一次性 `scheduledFor` 是 Runtime 的通用接纳能力，不是 Workflow 参数或节点。

### Gate 3：设计先行

Workflow 行为变更完整读取 [设计门禁](references/design-template.md)，维护 `.design/workflows/<workflow-id>.md`：

```powershell
node .claude/skills/lightcode-factory-develop/scripts/init-workflow-design.mjs <workflow-id> "<工作流名称>" .
```

Contracts、Runtime、Storage、Web 或跨组件变更完整读取 [底座变更设计](references/change-design.md)，维护 `.design/changes/<change-id>.md`：

```powershell
node .claude/skills/lightcode-factory-develop/scripts/init-factory-change.mjs <change-id> "<变更名称>" <runtime|storage|web|cross-cutting> .
```

只有设计自检通过，且架构、破坏性升级和数据策略没有悬而未决，才能编码。

### Gate 4：按组件实现

- Contracts：只放公开类型、runtime schema、Port 和 Remote descriptor；不放 Service、SQL、React 或文件系统逻辑。
- Runtime：完整读取 [Runtime 开发规范](references/runtime-development.md)。保持单一状态所有者，协同演进 schema、Repository、Remote、Host 与 Browser Client。
- SQLite Storage：完整读取 [Storage 开发规范](references/storage-development.md)。实现 Contracts Repository Port，不决定状态转换，覆盖 migration、事务、revision、分页与备份。
- Workflow Catalog：完整读取 [Workflow 实现规范](references/workflow-implementation.md) 和 [统一页面契约](references/web-display-contract.md)。先判定 Catalog 内置或独立包边界；每个 id 一个目录，顺序 `await run.node(...)`，输出 JSON-safe，观测有界。
- Web：完整读取 [Web 开发规范](references/web-development.md) 和 [统一页面契约](references/web-display-contract.md)。只消费 Runtime Browser Client，保证通用回退、分页、可访问交互和无业务特例。
- 跨组件：按 `Contracts -> Runtime/Storage -> Runtime Client -> Web/Workflows -> Bundle` 推进。

### Gate 5：同步接线与文档

完整读取 [文档同步](references/documentation-sync.md)。契约、状态、数据流、参数、节点、输出、页面语义、限制、命令、安装或包成员变化，都必须先更新设计，再同步 `docs/architecture.md`、`README.md` 和相关 Skill reference。

新增/重命名包时同步 manifest、TypeScript references/path、Vitest alias、build、pack、Factory dependencies、bundleDependencies、patch、lockfile 与版本。Contracts 是 bundled library，不在 Cordis patch 中单独装配；Factory Bundle 不承载业务逻辑。

### Gate 6：分层验证

完整读取 [测试与交付](references/testing-and-delivery.md)。至少运行：

```powershell
npm.cmd run audit:ai
npm.cmd run typecheck
npm.cmd test -- --run
npm.cmd run build
```

把对应设计传给审计脚本。涉及 Bundle、安装或发布时运行 `npm.cmd run pack`，检查 tarball，并在隔离 DSH Home/Profile 中完成真实核心交互和 Browser 验收。

### Gate 7：完成与交付

只有设计、代码、测试、文档、接线和适用安装验收全部通过，才能声明完成。最终列出组件选择、公开契约和数据流变化、设计与文档、验证结果、未验证项及生产边界。

## 禁止事项

- 不得先写代码、后补设计或文档。
- 不得导入其他包的 `src/*` 或 DSH 深层内部路径。
- 不得让 Workflow/Storage/Web 决定 run 状态或自建第二套状态机。
- 不得让 Runtime 依赖 SQLite 实现，或让 Web/Workflow 访问 Repository。
- 不得让 Web 按 Workflow id、包名、节点 id 或中文名称增加特例。
- 不得修改 durable 字段却漏改 runtime schema、Repository、Remote 和调用方。
- 不得把 credential、完整私有 prompt、无界日志或本机绝对路径写入参数、输出或 observation。
- 不得用类型检查、HTTP 200、`dump-config` 或窄面板截图代替行为验收。
- 不得跳过文档审计；“代码即文档”不是完成条件。

[workflow-development.md](references/workflow-development.md) 作为完整规范索引保留。
