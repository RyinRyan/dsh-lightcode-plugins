# LightCode Factory 0.4.1 发布版本

- Change ID: `release-0-4-1`
- 变更类型: `cross-cutting`
- 影响组件: 根工作区、Contracts、Runtime、SQLite Storage、Workflow Catalog、Web、Factory Bundle、lockfile 与安装文档
- 设计状态: 已实现并验证

## 1. 需求与成功标准

上一轮修复了未来定时任务可能提前进入执行队列的问题，但只重新生成了 `0.4.0` tarball。DSH 以包版本识别安装版本，重用版本号会让安装、升级和排障无法可靠区分修复后的构件。

成功标准：所有 Factory 成员和 Bundle 统一发布为 `0.4.1`，Bundle 内嵌的成员版本一致，README 安装命令指向 `lightcode-factory-0.4.1.tgz`，且生成的六个 tarball 全部为 `0.4.1`。

## 2. 组件选择与职责边界

选择 Factory 发布接线与所有同发布边界成员的 manifest。此变更不改变 Contracts、Runtime、Storage、Workflow 或 Web 的源码契约、状态、数据和交互；它只将已经实现的修复作为新的可安装版本交付。

## 3. 当前实现证据

- 根 workspace、五个成员包和 Factory Bundle manifest 当前都是 `0.4.0`；
- Factory 对五个成员使用精确 `0.4.0` 依赖，lockfile 镜像相同版本；
- `scripts/pack.mjs` 按各 manifest 名称与版本生成 tarball，README 仍引用 `lightcode-factory-0.4.0.tgz`；
- `0.4.0` 的定时功能与旧验证记录属于历史发布事实，不改写 migration 或历史设计。

## 4. 目标契约与数据流

版本由 `0.4.0` 补丁升级到 `0.4.1`。Bundle 数据流不变：五个成员 tarball 作为实际文件安装到 staging，再打包 Factory；唯一变化是所有 package metadata 与最终文件名使用 `0.4.1`。

## 5. 状态、并发与生命周期

Runtime 状态机、timer、取消、卸载、停止、恢复和并发语义均不改变。新版本只携带已经验证的执行前计划时间二次校验。

## 6. 持久化、Remote 与兼容性

SQLite schema 仍为 v2，Remote v2、durable aggregate 与 Workflow registration 不变。`0.4.1` 可以读取现有 `0.4.0` 数据库；无需 migration。升级时用新 tarball 替换同名 plugin，仍应遵守现有备份建议。

## 7. Web 与交互

页面、Remote 命令和 Browser Client 不变。用户可通过安装命令显式选择 `0.4.1` 包，并获得定时任务提前执行防护。

## 8. 安全与数据边界

不新增输入、输出、凭据、日志或安装权限。最终 tarball 检查仍禁止 workspace link、绝对路径和敏感配置。

## 9. 实现与接线计划

1. 将根 workspace 与五个成员包版本统一改为 `0.4.1`；
2. 将内部精确依赖与 package-lock 对应 workspace entries 同步为 `0.4.1`；
3. 更新 README 的安装文件名和当前补丁发布说明，更新生产审查的当前基线；
4. 运行审计、类型检查、测试、构建、打包和 tarball metadata 检查；
5. 提交并推送独立发布提交。

## 10. 测试与验收

- 运行 `audit:ai`、typecheck、全量 test、build 与 pack；
- 检查 `dist` 只有六个 `0.4.1` tarball，且没有 `.pack-*`；
- 解包/读取 Factory 与成员 manifest，确认版本、依赖闭包和 Bundle 成员均为 `0.4.1`；
- 本次不重复 Runtime 或 Browser 行为验收：它们已由修复提交验证，发布版本本身由 metadata 与完整 Bundle 检查证明。

### 实际验证结果

2026-09-21 已通过设计审计、`npm.cmd run typecheck`、全量 `npm.cmd test -- --run`（7 个测试文件、34 项测试）、`npm.cmd run build`、`npm.cmd run pack` 和 built 审计。沙箱内打包因本机 npm 缓存写入返回 `EPERM`，使用本机缓存后成功生成 `dist/lightcode-factory-0.4.1.tgz`。`dist` 只包含 Factory 与五个成员共六个 `0.4.1` tarball，没有 `.pack-*`；逐个读取 manifest 与 Factory 内嵌 member manifest，名称、版本和精确依赖均为 `0.4.1`。

## 11. 文档同步

- 更新 README：安装命令和当前发布说明；
- 更新生产就绪审查：当前 checkout 的版本基线；
- 不修改 architecture、migration、Skill 或历史定时设计：组件契约、数据流与 `0.4.0` 历史发布事实均不变。

## 12. 风险、限制与回滚

主要风险是漏改某个成员版本，造成 Bundle 安装时解析旧成员或生成混合 tarball。以精确依赖、lockfile 同步、打包和 manifest 检查防止。回滚是安装/发布先前的 `0.4.0` tarball；数据库兼容策略不变。

## 13. 设计自检

- [x] 发布版本职责归属 Factory 接线；
- [x] 不改变公开契约、状态、存储或 UI；
- [x] 所有内部精确依赖与 lockfile 已纳入计划；
- [x] 历史版本文档与验证记录不会被改写；
- [x] tarball 验收和文档同步范围明确。
