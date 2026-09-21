# LightCode Factory

LightCode Factory 是安装到 DSH 的独立 Workflow 工厂插件。它不修改 DSH 源码，由 Contracts、Runtime、SQLite Storage、内置 Workflow Catalog 和 Web 五个成员包组成，`lightcode-factory` 只负责离线 Bundle 装配。

开发前先读 [AGENTS.md](AGENTS.md)、[当前架构](docs/architecture.md) 和 [开发 Skill](.claude/skills/lightcode-factory-develop/SKILL.md)。

## 安装与启动

当前验证基线是 Windows、Node 24.11、DSH CLI 0.1.5-rc.1 / SDK 0.1.5-rc.2。其他版本必须重新验证宿主接口。

```powershell
dsh --profile lightcode --from-default-profile web --dump-config
dsh plugin --profile lightcode add "D:\develop\dsh-workflow\dsh-lightcode-plugins\lightcode-factory\dist\lightcode-factory-0.4.2.tgz" --ignore-scripts
dsh --profile lightcode --no-open --host 127.0.0.1 --port 3892
```

打开终端打印的 token 地址。卸载：

```powershell
dsh plugin --profile lightcode remove lightcode-factory
```

卸载不会删除数据库、artifact 或备份。默认数据位置：

- SQLite：DSH home 下 `lightcode-factory/factory.sqlite3`
- Workflow artifact：`lightcode-factory/artifacts/<runId>/`

0.4 可把当前 0.3 SQLite schema v1 原地迁移为 schema v2；升级前仍应备份数据库。它不读取旧 `workflow_platform.json`，也不承诺打开 0.2 SQLite；没有自动兼容或双写。回滚到 0.3 必须恢复升级前的数据库副本。

## 包与职责

| 包 | 职责 |
| --- | --- |
| `lightcode-factory-contracts` | 共享类型、Zod schema、Workflow/Repository Port、Remote v2 |
| `lightcode-factory-runtime` | 任务注册、立即/一次性定时调度、状态决策、取消、评审、恢复、Remote Host 和 Browser Client |
| `lightcode-factory-storage-sqlite` | SQLite schema、事务、revision、seek 分页、索引和一致性备份 |
| `lightcode-factory-workflows` | `morning-script-demo` 与 `release-readiness` 内置 Catalog |
| `lightcode-factory-web` | Catalog 表单、六状态看板、加载更多、运行详情和轨迹 |
| `lightcode-factory` | 安装装配；不包含业务逻辑 |

新建任务可选择立即执行或指定浏览器本地日期时间进行一次性定时执行。定时提交从当前表单的执行方式和时间读取：时间缺失、非法或已过期会明确报错，绝不会静默创建立即任务。定时任务以 durable `queued` 保存，到点才占用并发槽；执行前会再次核对持久化计划时间，提前或重复的入队信号不会使其提前运行。Host 重启后由相同 workflow id/version 恢复，到点前可取消。页面首次读取最多 60 条 run，轮询只刷新第一页；历史通过 opaque cursor 加载更多，详情通过单条查询刷新。SQLite backup API 可生成不覆盖的一致性副本。

## 新增内置 Workflow

在 `packages/workflows/src/catalog/<workflow-id>/` 增加实现，并从 `lightcode-factory-contracts/workflow` 使用公开契约：

```typescript
import type { WorkflowRegistration } from 'lightcode-factory-contracts/workflow'

const node = { id: 'hello', name: '问候' }
export const helloWorkflow: WorkflowRegistration = {
  id: 'hello', version: '1.0.0', name: '问候', description: '最小示例',
  parameters: [], nodes: [node],
  async execute(run) {
    await run.node(node, async context => {
      context.signal.throwIfAborted()
      await context.log('开始执行')
      return { message: '你好' }
    })
  },
}
```

在 Catalog `src/index.ts` 用 `ctx.effect(() => ctx.lightcodeFactoryRuntime.registerWorkflow(...))` 注册。相同发布、权限、依赖和配置边界的 Workflow 放入 Catalog；边界不同才建立独立包。Workflow 不修改 Runtime/Web，不访问 Repository，节点逐个 `await`，output 必须是有界 JSON。

## 开发与验证

```powershell
cd D:\develop\dsh-workflow\lightcode-factory
npm ci
npm.cmd run audit:ai
npm.cmd run typecheck
npm.cmd test -- --run
npm.cmd run build
npm.cmd run pack
```

构建依赖锁定在 `package-lock.json`。Host 与 Browser 共享宿主 Cordis/React/DSH 能力，不内嵌第二套框架。最终 Bundle 内含五个真实成员包，Contracts 作为 library 随包发布但不在 Cordis patch 中单独启动。

`npm.cmd run pack` 会重建 `dist` 并在结束时回收临时 staging；`dist` 是单次、可再生的当前版本产物，不作为历史发布归档。上线前的七项质量结论、P0/P1 门槛和故障/容量验收矩阵见 [生产就绪审查](docs/production-readiness-review.md)。

0.4.2 修复定时表单提交：定时模式缺少有效计划时间时会拒绝创建，而不会退化成立即任务。该版本已在专用 `lightcode-workflow-verify` Profile 完成实际功能验收；详细验证与 Profile 隔离边界见[定时提交完整性修复设计](.design/changes/scheduled-submission-integrity.md)。0.4.1 是 0.4.0 的补丁发布：定时任务在执行前会再次核对 durable 计划时间，提前或重复的入队信号不会使其提前运行。0.4.0 增加一次性定时执行、重启恢复、到期前取消和 SQLite schema v2 migration。晨间脚本若模型未完成会明确提示检查当前 DSH 模型与 API Key 配置；凭据仍只由 DSH 管理，不进入 Factory 数据。0.3.0 的历史发布证据保留在 [迁移记录](docs/migration.md)。

本仓库还包含 DSH/Cordis 插件教学站：

```powershell
npm run docs:serve
```

入口是 `docs/plugin-development/site/index.html`，任务式索引是 `docs/plugin-development/README.md`。

## 安全与生产边界

- 参数会持久化并显示，禁止输入密码、Token、私钥或完整私有 prompt。
- 当前 Workflow 是可信进程内插件，不隔离恶意代码。
- Demo 会调用当前模型并执行生成脚本；必须使用合适的宿主沙箱策略并人工审查。
- 晨间脚本依赖当前 DSH Profile 已配置且可用的模型与 API Key；Factory 不读取或代管凭据。
- 当前只支持顺序节点，没有 DAG、checkpoint、自动重试或跨进程 Worker。
- 定时执行是单 Host 的一次性内存 timer 加 durable 计划；停机期间不会执行，恢复后已过期任务会立即排队，不支持 Cron、重复任务或分布式 lease。
- SQLite 只支持一个 Host 和本机持久卷；不支持网络共享、多主写或高可用。
- 当前 Node 24.11 的 `node:sqlite` 会发出实验特性警告；生产发布必须固定并验证 Node/SQLite 版本。
- Remote 已分页，但仍采用轮询；没有 SSE/推送和自动归档。

历史发布与迁移验证见 [docs/migration.md](docs/migration.md)，详细依赖、状态与数据视图见 [docs/architecture.md](docs/architecture.md)。
