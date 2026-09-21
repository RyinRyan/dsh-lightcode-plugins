# 生产就绪清理与审查设计

- Change ID: `production-readiness-cleanup`
- 变更类型: `cross-cutting`
- 影响组件: Factory 构建/打包、测试辅助代码、仓库文档；不改变 Contracts、Runtime、Storage、Workflows 或 Web 运行时契约
- 设计状态: 已实现并验证

## 1. 需求与成功标准

上线准备前清理 LightCode Factory 中不再参与任何入口、测试、构建或打包的代码，以及会持续累积的本地产物；同时从可读性、可维护性、架构合理性、可扩展性、韧性、性能和日志完备性七个方面形成可追踪的生产审查结论。

成功标准：删除无引用的历史组合验证入口；打包不再遗留 `.pack-*` 临时目录或混入旧版本 tarball；清理当前旧打包产物；保留仍被测试使用的共享 mock、通用 DSH Skill 和教学站；全量审计、类型检查、测试、构建与打包通过；审查报告给出证据、风险级别和上线门槛。

非目标：本次不改变业务 Workflow、run 状态、数据库 schema、Remote、页面交互，也不在一次清理中实现高可用、重试、幂等、监控或存储增量写入。

## 2. 组件选择与职责边界

选择 Factory 工程接线与仓库级文档。`scripts/pack.mjs` 是产物生命周期所有者，应负责清理 `dist` 和 staging；无引用 fixture 属于仓库测试辅助代码。七项审查只记录问题，不把跨层生产能力偷偷塞进 Workflow 或 Web。未来修复须按 Contracts -> Runtime/Storage -> Runtime Client -> Web/Workflows -> Bundle 演进。

## 3. 当前实现证据

- `scripts/build-fixture.mjs` 只引用 `tests/fixture-plugin.ts`，两者未被根 scripts、Vitest、构建、打包、文档或当前验证门禁引用；`tests/mock-adapter.ts` 仍被 Workflow 测试使用，必须保留。
- `dist` 同时保留 0.1.x、0.2、0.3、0.4 tarball 和多个 `.pack-*` 完整安装树；`.verification` 保留隔离 Home、浏览器 profile、截图与一次性脚本，二者均被 `.gitignore` 排除。
- `scripts/pack.mjs` 在 `dist/.pack-*` 创建 staging，但没有成功/失败清理，也不会删除旧产物。
- 当前基线 `audit:ai`、`typecheck` 和 7 个文件 33 项测试通过；Node 24.11 的 `node:sqlite` 仍打印实验特性警告。

## 4. 目标契约与数据流

公开类型、Remote、Repository、Workflow 和 Browser 数据流不变。打包数据流调整为：清空并重建 `dist` -> 打包五个成员 -> 创建 staging -> 离线安装 -> 打包 Factory -> `finally` 回收 staging。最终 `dist` 只包含本次版本的六个 tarball。

## 5. 状态、并发与生命周期

Runtime 仍是 durable run 状态唯一决策者；合法转换、取消、卸载、停止、重启、timer 和晚到结果均不变。打包脚本的 staging 生命周期由 `try/finally` 管理，失败也不遗留安装树。

## 6. 持久化、Remote 与兼容性

数据库 schema、migration、Remote v2 和历史数据兼容策略不变。删除的 fixture 从未进入发布包。清空 `dist` 只作用于 `.gitignore` 明确标记的可再生产物，不删除源码、数据库或用户 artifact。

## 7. Web 与交互

无页面行为、renderer、分页、可访问性或响应式变化。审查报告会记录现有轮询和详情错误处理风险，但本次不改 UI。

## 8. 安全与数据边界

不读取或输出 credential。`.verification` 可能包含本机 profile、token 化启动信息和运行痕迹，清理它可减少误留本地敏感验证数据的风险。审查报告不复制业务输入、私有 prompt 或绝对 artifact 内容。

## 9. 实现与接线计划

1. 删除无引用的 `scripts/build-fixture.mjs` 与 `tests/fixture-plugin.ts`。
2. 修改 `scripts/pack.mjs`，打包前清空 `dist`，并在 `finally` 中删除 staging。
3. 由 pack 清理旧 `dist` 并只生成当前产物。`.verification` 是 ignored 的本地验收证据，不属于无效代码，本轮不删除。
4. 新增 `docs/production-readiness-review.md`，更新 README 的生产准备入口。
5. 保持 manifest、lockfile、Bundle patch 和运行时代码不变。

## 10. 测试与验收

运行 `npm.cmd run audit:ai`、`npm.cmd run typecheck`、`npm.cmd test -- --run`、`npm.cmd run build`、`npm.cmd run pack`；检查 `dist` 只含当前 0.4.0 tarball、没有 `.pack-*`，并检查最终 tarball 成员闭包。由于运行时和页面不变，本次不重复隔离 DSH 与浏览器业务验收，并在报告中明确它仍是正式上线前门槛。

## 11. 文档同步

新增本设计和生产审查报告；README 增加报告链接并说明打包产物是单次、可再生输出。已核对 `AGENTS.md`、`docs/architecture.md`、`docs/migration.md`、Workflow 设计和 Skill references：架构、契约、数据、状态与开发规则均未改变，因此不修改。通用 `docs/plugin-development/` 与 `.claude/skills/dsh-plugin-develop/` 仍有独立用途，不删除。

## 12. 风险、限制与回滚

清空 `dist` 会移除旧的本地 tarball，但它们是 ignored 可再生产物，历史发布信息仍在 Git 与 migration 文档中；需要旧包时应从对应 commit 重新构建。回滚代码可恢复两个 fixture 文件和旧 pack 脚本，但不恢复已清理的旧 tarball。`.verification` 未删除。生产能力缺口不会因清理而消失，必须按报告的 P0/P1 门槛处理。

## 13. 设计自检

- [x] 当前实现证据来自本 checkout 的源码和测试。
- [x] 组件选择正确，没有把业务特例放入 Runtime/Web。
- [x] Runtime 仍是 durable run 状态的唯一决策者。
- [x] 类型、storage schema、wire schema 与调用方均不受影响。
- [x] 不涉及数据迁移或破坏性运行时兼容。
- [x] 取消、失败、卸载、停止、重启和竞态语义不变。
- [x] Web 通用回退、可访问性和业务无特例约束不变。
- [x] 安全、凭据、日志/输出边界已说明。
- [x] 测试、构建、Bundle 和真实验收范围完整。
- [x] 文档同步清单与无需更新的理由完整。

## 14. 实际验证结果

2026-09-18 在 Windows、Node 24.11.0 下完成：

- `npm.cmd run audit:ai`：6 个 Factory 包及 Agent 文档，0 错误、0 警告；
- `npm.cmd run typecheck`：通过；
- `npm.cmd test -- --run`：7 个测试文件、33 项测试通过；
- `npm.cmd run build`：Host 与 Browser 产物构建通过；
- `npm.cmd run pack`：生成 0.4.0 Factory 与五个成员 tarball；`dist` 仅 6 个当前版本 tarball，`.pack-*` 数量为 0；
- 最终 Factory tarball 包含根 manifest、patch、入口，以及 Contracts、Runtime、SQLite Storage、Workflows、Web 五个成员 manifest；
- `git diff --check` 通过。

首次 sandbox 内 pack 因本机 npm cache `EPERM` 失败；获准使用本机 npm cache 后通过。这是执行环境权限，不是仓库构建错误。运行时、数据库 schema、Remote 和 UI 未变化，因此本轮未重复隔离 DSH/浏览器验收；正式上线仍必须按生产审查的 P0 和验收矩阵完成。
