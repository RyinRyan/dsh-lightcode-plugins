# AI 友好的三组件开发体系设计

- Change ID: `ai-friendly-development`
- 变更类型: `cross-cutting`
- 影响组件: 开发规范、Skill、文档与审计工具；不改变运行时 Backend/Platform/Workflow 行为
- 设计状态: 已实现并验证

## 1. 需求与成功标准

现有 Skill 只覆盖新增 Workflow，缺少 Backend、Platform 的选择条件、职责、开发方式和架构原则；仓库也缺少可被 Agent 自动发现的根级规范与当前架构说明。成功标准是：Agent 能从根入口识别三个组件，按职责路由到具体规范，理解当前状态/数据流，并在代码完成前被文档同步审计阻止遗漏。

## 2. 组件选择与职责边界

本变更不修改产品运行组件，而是建立跨组件开发控制：Workflow 承载业务流程，Backend 承载共享控制面和唯一 durable 状态，Platform 承载统一 Browser 投影，Factory Bundle 只装配。规范明确需求跨层时按 Backend 契约到调用方的顺序演进，禁止在 Workflow 私建底座能力或在 Platform 写业务特例。

## 3. 当前实现证据

从当前 checkout 核对了 Backend 的共享类型、runtime 类型、storage spec、Remote、Host service 和 Browser client；核对了 Platform 的 slot/locale 注册、任务面板、运行详情、轨迹和组件测试；核对了两个 Workflow、workspace references、build/pack 脚本、Factory manifest 与 patch。当前 Backend 使用串行 mutation 写 JSON storage，Browser client 轮询 snapshot，Workflow 只能顺序执行声明节点。

## 4. 目标契约与数据流

新增的开发契约由根 `AGENTS.md` 作为自动发现入口，`docs/architecture.md` 作为当前架构导航，Skill 作为七段 Gate 和任务路由，分组件 reference 作为实施细则。新增变更设计模板覆盖 Backend/Platform/跨组件任务；审计脚本接受两类设计并检查文档入口、Skill 链接和本地代码/文档变更映射。

## 5. 状态、并发与生命周期

运行时状态、并发和生命周期不变。文档固化 Backend 是 durable run/node 状态唯一写入者、同一 run mutation 串行、取消先持久化终态再 abort、插件卸载与 Backend 停止需要 drain 的现状。此次工具变更不创建第二套状态。

## 6. 持久化、Remote 与兼容性

不改变持久化 domain、runtime schema、Remote schema 或公共 TypeScript 类型，对历史 run、已安装 Workflow 和 Browser 无运行时兼容影响。Skill 路径和历史索引文件保持不变，旧链接继续可用。

## 7. Web 与交互

不改变 Platform UI。新增规范说明统一页面只能消费公开 snapshot/commands，output 与 observation 分工、通用 JSON fallback、无 Workflow 特例、可访问性和完整桌面浏览器验收要求。

## 8. 安全与数据边界

不引入凭据或权限。规范继续要求 credential 不进入参数、output、observation 或文档示例；审计只读取仓库内 Git 文件清单，不读取文件内容之外的外部数据，也不修改 Git 状态。

## 9. 实现与接线计划

新增根 `AGENTS.md`、`docs/architecture.md`、组件选择/Backend/Platform/文档同步 references、跨组件设计模板和初始化脚本；重写 Skill 入口并更新核心契约、探索、设计、Workflow、页面、测试与旧索引；扩展审计脚本，增加根 `audit:ai` 命令；更新 README 开发入口。无 Bundle 成员、lockfile 或产品版本变化。

## 10. 测试与验收

已检查 Skill frontmatter 与所有入口文档链接，内置 skill-creator 的 `quick_validate.py` 通过；审计脚本验证本设计和文档映射为 0 错误、0 警告；两个初始化脚本均成功生成模板，新变更脚本会拒绝重复文件和非法组件类型。Node 语法检查、`npm.cmd run typecheck`、15 个全量测试和 `npm.cmd run build` 均通过。由于无运行时或装配变化，未重新打包，也未重复隔离 DSH Browser 验收。

## 11. 文档同步

更新 `AGENTS.md`、`docs/architecture.md`、根 README、Skill 入口及所有受影响 reference，并新增本设计。`docs/plugin-development/` 是面向通用 DSH/Cordis 插件开发的教学站，本次只改变 Factory 仓库 Agent 工作流，核对后无需修改。

## 12. 风险、限制与回滚

Git diff 文档审计只能证明相关文档文件发生变化，不能判断语义正确，因此保留设计自检和人工核对。审计基于本地未提交变更，已提交但未执行审计的变更无法追溯阻止。回滚只需移除新增文档/模板/命令并恢复 Skill 与审计脚本，不影响产品数据。

## 13. 设计自检

- [x] 当前实现证据来自本 checkout 的源码和测试。
- [x] 组件选择正确，没有把业务特例放入 Backend/Platform。
- [x] Backend 仍是 durable run 状态的唯一写入者。
- [x] 类型、storage schema、wire schema 与调用方影响已覆盖。
- [x] 历史数据、旧 Workflow 和 Browser 兼容策略明确。
- [x] 取消、失败、卸载、停止、重启和竞态已分析。
- [x] Platform 有通用回退、可访问性和无业务特例保证。
- [x] 安全、凭据、日志/输出边界明确。
- [x] 测试、构建、Bundle 和真实验收范围完整。
- [x] 文档同步清单与无需更新的理由完整。
