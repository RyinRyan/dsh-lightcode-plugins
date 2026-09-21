# 测试、打包与交付

验证目标是证明 Contracts、Runtime、Storage、Workflow Catalog、Web、文档和发布装配一致，不以“能编译”代替行为证据。

## 1. 测试矩阵

### Contracts

- type、Zod schema、Repository/Workflow Port 与 Remote descriptor 一致；
- 必填 durable 字段和非法 wire request 被拒绝；
- Remote 只有当前版本的有界 catalog/list/detail/command 操作。

### Runtime

- registration/disposer、参数、合法/非法状态、节点顺序、输出/观测限制；
- admission、queued/running cancel、晚到结果、revision 竞态；
- 一次性定时任务不到点/到点、取消竞态、长 timer、Workflow 卸载重注册、Runtime 重启恢复和版本不匹配；
- 并发补位、Catalog 卸载、Runtime stop、Host 重启；
- cursor/limit、catalog/list/get/start/cancel/review；
- Browser Client refresh/loadMore/getRun/command 与 polling disposer。

### SQLite Storage

- schema、外键、唯一约束和关键索引；
- aggregate create/get/page/save round-trip；
- seek 分页边界、稳定排序、状态过滤和 limit；
- revision 冲突与事务失败无部分写入；
- migration（含带历史数据的 user_version 升级）、计划时间 NULL/ISO round-trip、在线备份不覆盖、停止后从备份重开恢复；
- Runtime 真实组合与连接关闭。

### Workflow Catalog

- 每个 id 的参数、节点顺序、JSON-safe output、observation 和 AbortSignal；
- Catalog 同时注册多个内置 Workflow，单个重依赖 Workflow 不阻断轻量 Workflow；
- 成功、业务失败、取消、评审和公开 disposer。

### Web

- definition 表单、立即/定时提交、本地时间转 ISO、命令 pending/error、六状态看板与计划时间展示；
- next cursor 控制加载更多，loading-more 防重复；
- 打开详情触发 getRun，节点 output/error 切换，未知 JSON 回退；
- observation 只进入轨迹，筛选/检查器正确；
- 对话框焦点、Escape、ARIA、键盘、无溢出/真实溢出。

## 2. 接线审计

检查 manifest/exports、内部依赖版本、Cordis peer、根 TypeScript references/path、Vitest alias、build/pack、Factory dependencies/bundleDependencies/patch、lockfile、最终产物和绝对路径。Contracts 需要 bundle，但不作为 Cordis plugin 装配。

```powershell
node .claude/skills/lightcode-factory-develop/scripts/audit-lightcode-workflow.mjs . --built --design .design/changes/<change-id>.md --docs
```

## 3. 构建与打包

按依赖顺序 typecheck、test、build、audit、pack。最终 tarball 检查：版本正确、五个成员包是实际文件、Contracts 可被成员解析、patch 只装配 Runtime/Storage/Workflows/Web、无 workspace link、绝对依赖或敏感配置。

## 4. 隔离 DSH 与浏览器验收

使用独立 DSH Home/Profile：安装 tarball、检查 patch、dump-config、启动服务、创建两个 Workflow、核对状态/节点/输出/轨迹、失败或取消、评审、分页加载、重启历史、备份恢复和卸载。HTTP 200 与 dump-config 不能代替业务交互。

浏览器必须在完整桌面页面和较窄窗口验证：原生侧栏对齐、节点溢出、点击与拖拽、长输出、纵向事件、轨迹与详情不重复、loading/error/review/终态、加载更多。发现问题要补自动化回归。

## 5. 完成定义

- 设计状态“已实现并验证”且与源码一致；
- 所有组件只通过公开契约依赖；
- 查询有界，备份可恢复，状态只有 Runtime 决策；
- build/test/pack/audit 通过，tarball 隔离安装并激活；
- 真实核心交互和页面显示验证；
- AGENTS、architecture、README、migration、设计和 Skill 同步；
- 未验证项和生产边界明确记录。
