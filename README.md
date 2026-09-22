# dsh-lightcode-plugins

DSH（DeepSeek Harness，npm 包 `@deepseek-ai/dsh`）的 Web 插件集合。仓库内每个顶层目录是一个独立插件项目，拥有自己的依赖、构建脚本和测试；本仓库不提供统一构建入口，请在对应插件目录内开发与验证。

## 插件一览

| 目录 | 插件 | 版本 | 职责 |
| --- | --- | --- | --- |
| [`configcenter/`](configcenter/) | 配置中心 | 0.1.0 | 在一个 Web 面板中集中管理凭据变量与本地插件 Tar 包安装 |
| [`lightcode-factory/`](lightcode-factory/) | LightCode Factory | 0.4.2 | 独立 Workflow 工厂：Catalog 表单、六状态看板、一次性定时执行、SQLite 持久化；验证基线 Windows / Node 24.11 / DSH CLI 0.1.5-rc.1 |

## 安装

各插件在自己的目录内构建并打包，再通过 DSH CLI 以本地 tarball 安装到目标 profile：

```powershell
# 在插件目录内（以 configcenter 为例；lightcode-factory 的打包命令为 npm run pack）
npm install
npm run build
npm test
npm run pack:tarball

# 安装到 profile，随后重启该 profile
dsh plugin --profile my-profile add .\dist\configcenter-0.1.0.tgz --ignore-scripts
```

卸载：`dsh plugin --profile my-profile remove <插件名>`。

- **configcenter**：安装后 DSH 左侧栏出现“配置中心”，含“凭据管理”与“插件管理”两个页签；其他 Host 插件声明 `inject: ['credentialVariables']` 后，即可用 `ctx.credentialVariables.get/require` 读取凭据变量。
- **lightcode-factory**：默认数据位于 DSH home 下 `lightcode-factory/factory.sqlite3` 与 `lightcode-factory/artifacts/<runId>/`；卸载不会删除数据库、artifact 或备份。

## 开发

- 各插件独立构建与测试，具体命令见其 README。
- 修改 `configcenter` 前，先阅读其 [AGENTS.md](configcenter/AGENTS.md)（组件使用、开发流程与开发规范）。
- 修改 `lightcode-factory` 前，先阅读其 [AGENTS.md](lightcode-factory/AGENTS.md) 与 [docs/architecture.md](lightcode-factory/docs/architecture.md)；Workflow 行为与跨组件变更的设计记录在其 `.design/` 下，先设计并通过审计，再编码。
- `lightcode-factory` 内附 DSH/Cordis 插件教学站：`npm run docs:serve`，入口 `docs/plugin-development/site/index.html`。
- 提交信息遵循 Conventional Commits（`feat:` / `fix:` / `docs:` / `release:`）。

## 文档索引

- [configcenter README](configcenter/README.md) — 功能、凭据 Service API、`cordis.patch.yml` 配置与数据目录、从旧插件迁移
- [configcenter AGENTS.md](configcenter/AGENTS.md) — 组件使用、开发流程与开发规范
- [LightCode Factory README](lightcode-factory/README.md) — 安装基线、包职责、内置 Workflow、安全与生产边界
- [LightCode Factory 架构](lightcode-factory/docs/architecture.md)、[迁移记录](lightcode-factory/docs/migration.md)、[生产就绪审查](lightcode-factory/docs/production-readiness-review.md)
