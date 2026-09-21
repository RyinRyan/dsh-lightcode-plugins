# 仓库探索：以当前源码为事实

Skill 不固定工作区版本、DSH/SDK/Cordis/Node 版本、限制值、页面像素或构建成员。Agent 每次开发都必须从当前 checkout 重新发现。

## 1. 先确认仓库与变更边界

1. 找到 `lightcode-factory` 根目录，完整读取适用的 `AGENTS.md`、`docs/architecture.md` 和项目说明。
2. 检查工作区状态，保护用户已有修改；不要覆盖或回滚无关内容。
3. 使用 `rg --files` 和 `rg` 定位文件，不根据旧记忆猜路径。
4. 用组件选择表记录本次范围：内置 Workflow 默认只改 `packages/workflows/src/catalog/<id>/`、Catalog 注册、设计和测试；只有发布/权限/依赖/生命周期边界不同才建立独立包。Contracts/Runtime/Storage/Web 变更必须记录跨层影响。

## 2. 必查事实

从当前源码确认：

| 事实 | 优先来源 |
| --- | --- |
| workspace、Node 和脚本 | 根 `package.json` |
| DSH、SDK、Cordis 和测试依赖 | 根 manifest 与 lockfile |
| 注册与节点公开类型 | Contracts package exports 的 Workflow Port |
| run、node、output、observation 形状 | Contracts types、schema 与 Remote |
| Repository Port、revision 与查询 | Contracts repository export、Storage Adapter 与测试 |
| 数据库 schema、migration 与历史导入 | Storage 源码、迁移测试和 Bundle 配置 |
| 接纳、立即/定时执行、取消、评审和恢复语义 | Runtime 实现及其测试 |
| Browser Remote 命令 | Contracts Remote、Runtime Client 与 Web |
| 当前通用输出 renderer | Web 运行详情源码与测试 |
| 当前轨迹分类 | Web 轨迹源码、locale 与测试 |
| 业务包范例 | 已有最接近的 Workflow 包；范例不是权威契约 |
| TypeScript 接线 | 根 tsconfig references |
| 构建和打包成员 | 实际 build/pack 脚本 |
| Bundle 装配 | Factory manifest、bundleDependencies、patch 和 lockfile |
| 当前版本策略 | 所有成员 manifest、lockfile 和最近发布产物 |
| 当前组件边界与已知限制 | `docs/architecture.md`，并用源码/测试复核 |
| 仓库开发与文档门禁 | 根 `AGENTS.md`、Skill 与审计脚本 |
| Contracts/schema 一致性 | types、schema、Workflow/Repository Port 与 Remote |
| Runtime/Web 接线 | Host、Browser Client、board/overview/trace、locale、CSS 与测试 |

若文档与公开类型或可运行测试不一致，以当前源码和测试为事实，并在本次任务中修正文档。

## 3. 输出探索摘要

写设计前，Agent 应形成一段简短的内部工作摘要：

```text
当前 Runtime 注册入口：...
当前 Workflow 是 Catalog 内置还是独立包：...
当前参数能力：...
当前节点执行模型：...
当前 output/observation 页面语义：...
当前状态所有者与 schema：...
当前 `scheduledFor` 的接纳/恢复语义：...
当前 Repository/Storage Adapter 与迁移：...
当前 Web 数据源和命令：...
当前 Bundle 接线点：...
当前测试/构建/打包命令：...
需要同步的文档：...
发现的底座限制：...
```

摘要用于支撑设计，不要求另建永久文件；重要限制必须进入设计文档。

## 4. 禁止使用静态快照代替探索

以下内容即使曾经正确，也必须现场确认：

- `lightcode-factory`、DSH、SDK、Cordis、Node 的版本号；
- 单节点输出和 observation 的数量或字节限制；
- Host 重启后的任务处理方式；
- Browser 刷新间隔；
- renderer 支持的字段名；
- CSS 宽度、响应式断点和测试 viewport；
- 成员包列表、tarball 名称和安装命令。

若 `docs/architecture.md` 与源码不同，必须把修正文档纳入当前任务，不能只在回复中说明。

文档可以记录“如何查”，不应把一次验证结果写成永久前提。
