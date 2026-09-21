# 文档同步门禁

文档是本仓库面向 Agent 的公共契约，不是实现后的可选总结。每次代码变更都要先判断文档影响，并在同一变更中刷新相关内容。

## 1. 文档职责

| 文档 | 何时更新 |
| --- | --- |
| `AGENTS.md` | 仓库级规范、架构原则、验证门禁或目录约定变化 |
| `docs/architecture.md` | 组件职责、依赖、状态所有权、数据流、公共契约、限制变化 |
| `README.md` | 用户能力、安装、启动、版本、包成员、命令或已验证范围变化 |
| `.design/workflows/*.md` | Workflow 参数、节点、输出、观测、失败、取消、依赖或接线变化 |
| `.design/changes/*.md` | Contracts/Runtime/Storage/Web/跨组件设计、迁移、测试和实际结果 |
| Skill references | 开发步骤、架构原则、测试矩阵或完成条件变化 |
| `docs/plugin-development/` | 通用 DSH/Cordis 插件教学内容被当前实现推翻或扩展 |

## 2. 变更映射

- `packages/workflows/src/catalog/<id>`：至少更新对应 Workflow 设计与 Catalog 注册/测试；若公开能力或限制变化，再更新 README/architecture。独立 Workflow 包才同步其 manifest、workspace 和 Bundle 接线。
- `packages/contracts/src`：更新 architecture；同步所有受影响消费者和契约规范。
- `packages/runtime/src`：更新 architecture；涉及开发规则时更新 core/runtime/testing references；用户能力或配置变化更新 README。
- `packages/storage-sqlite/src`：更新 architecture 和 Storage reference；涉及数据库位置、migration、备份、部署或 Bundle 时更新 README。
- `packages/web/src`：更新 architecture 与 web-display/web-development；用户可见能力变化更新 README。
- `packages/factory`、`scripts/build.mjs`、`scripts/pack.mjs`、manifest/lockfile：更新 README 的安装/打包/成员信息，必要时更新 architecture。
- 测试变化若揭示了此前未记录的契约，也要反向刷新架构或 Skill，不能只修测试。

## 3. 可审计规则

完成前运行 `npm.cmd run audit:ai`。`--docs` 模式会读取本地 Git 变更并检查 Contracts、Runtime、Storage、Web、Workflow Catalog 与 Bundle 的设计/文档映射。

该检查是最低门槛：它只能证明“有相关文档文件发生变化”，不能证明内容正确。Agent 仍需逐项核对：

- 文档描述的是当前实现，不是计划状态；
- 没有复制易漂移的版本/数值，或已明确它们的事实来源；
- 入口链接可达，文件/类型/命令名与当前仓库一致；
- 设计状态和实际验证结果一致；
- 未验证项没有被写成已支持能力。

若候选文档确实无需修改，在设计的“文档同步”章节记录检查过的文档与不修改理由。没有设计记录的“无需更新”不算完成。
