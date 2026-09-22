# configcenter Agent 开发规范

本文件适用于 `configcenter/` 目录下的全部改动。动手前先读取本文件与 `README.md`；当前源码、`tests/`、`package.json`、`cordis.patch.yml` 与 `scripts/` 是事实来源，文档与实现冲突时在同一变更内修正。提交信息遵循 Conventional Commits（`feat:` / `fix:` / `docs:` / `release:`）。

## 1. 组件定位

configcenter 是安装进 DSH Profile 的统一 Web 配置中心插件：左侧栏一个面板，内含“凭据管理”与“插件管理”两个页签。Host 侧负责凭据持久化、`credentialVariables` Cordis Service 与本地插件 tar 包的安装/卸载/热挂载/自助重启；浏览器侧只通过同源 JSON 路由交互。

| 事实 | 值 |
| --- | --- |
| 包名 / 插件 id | `configcenter`（Host 半 `configcenter`，浏览器半 `configcenter/client`） |
| 验证基线 | DSH `0.1.5-rc.1`（`package.json` → `dsh.compatibility`），Node >= 22 |
| 凭据数据 | `$DSH_HOME/dsh-credential-center/variables.json`（沿用旧 `dsh-credential-center` 位置，`dataDir` 可覆盖） |
| HTTP 路由前缀 | `/dsh-credential-center`（凭据）、`/dsh-tar-installer`（安装器），沿用旧插件名 |
| 对外 Cordis Service | `credentialVariables`（仅 Host） |

## 2. 如何使用该组件

### 2.1 构建与安装

```powershell
npm install
npm run build
npm test
npm run pack:tarball
dsh plugin --profile my-profile add .\dist\configcenter-0.1.0.tgz --ignore-scripts
```

重启该 profile 后左侧栏出现“配置中心”。卸载：`dsh plugin --profile my-profile remove configcenter`；安装器自身也拒绝卸载 `configcenter`。从旧 `dsh-credential-center` / `dsh-tar-installer` 迁移：删除旧依赖与 patch 行后安装本包，默认数据目录不变，已有变量直接复用；不要复制或暴露 `variables.json` 明文。

### 2.2 页面使用

- **凭据管理**：新增、搜索、编辑、删除变量。变量名必须匹配 `[A-Za-z_][A-Za-z0-9_]*`，说明 ≤ 240 字符，值 1–64 KiB；编辑时值留空表示保留原值，新建必须给值。列表只回显名称、说明、更新时间与“已配置”圆点——浏览器永远拿不到明文值。
- **插件管理**：上传 npm pack 产生的 `.tgz` / `.tar.gz` → Host 校验并暂存（30 分钟 TTL）→ 确认安装（默认禁用安装脚本）→ 尽力热挂载，不支持时明确提示重启；可查看当前 Profile 的直接依赖、卸载包、自助重启 DSH（浏览器自动重连）。同一时刻只允许一个安装/卸载操作。

### 2.3 其他插件读取凭据

消费插件不 import 本包，声明注入后直接调用（Cordis 按 service 名连接，双方在同一 profile 即可）：

```ts
export const inject = ['credentialVariables']

const optional = ctx.credentialVariables.get('DEEPSEEK_BASE_URL')   // 缺失 → undefined
const apiKey = ctx.credentialVariables.require('DEEPSEEK_API_KEY')  // 缺失 → 抛错
```

- 保存成功后立即生效，无需重启；每次调用都读取内存最新值。
- Service 只存在于 Host；Client 插件与浏览器 Remote 不应获得它。凭据值直接传给后端 SDK，不写日志、不回传浏览器。
- `inject` 是运行时前置条件（未安装配置中心则消费插件不激活），不是 npm 依赖。仅开发期可 `import type {} from 'configcenter'` 复用类型声明，且只能放 `devDependencies`（本地路径或本地 tarball）。

### 2.4 插件配置与数据文件

安装后编辑目标 profile 的 `cordis.patch.yml`（`C:\Users\<用户名>\.dsh\profiles\<profile>\cordis.patch.yml`）：

| 配置 | 默认值 | 说明 |
| --- | --- | --- |
| `dataDir` | `$DSH_HOME/dsh-credential-center` | 凭据数据目录 |
| `profile` | 自动探测 | 目标 Profile：profileContext → `--profile` → `web` |
| `maxUploadMiB` | `128` | 上传大小上限（1–512 MiB） |
| `allowInstallScripts` | `false` | 是否允许运行包安装脚本 |
| `allowRestart` | `true` | 是否允许自助重启 |

数据文件含明文密钥：不得进 Git，目录权限仅限运行 DSH 的用户（写入时请求 owner-only，Windows 上最终由所在目录 ACL 决定）。Web profile 修改 patch 后实时重载，其他 profile 需重启。

## 3. 如何开发该组件

### 3.1 开发视图

| 模块 | 目录 | 职责 | 不应承载 |
| --- | --- | --- | --- |
| 组合根 | `src/index.ts` | Config schema、装配 store/installer/路由、发布 Service、生命周期与降级 | 领域逻辑 |
| 共享协议 | `src/shared/`、`src/tar-installer/shared/` | wire envelope（`ApiResult`/`WireErrorCode`）、类型与输入校验 | node/React/DOM 依赖 |
| Host 凭据 | `src/host/` | 同源 JSON 管道、profile 发现、`VariableStore`、凭据路由 + 503 兜底 | 安装器逻辑、UI |
| Host 安装器 | `src/tar-installer/host/` | tar 校验、暂存、CLI 执行、热挂载、重启、已装清单 | 凭据存取 |
| 浏览器 | `src/client/`、`src/tar-installer/client/` | 传输、词典、状态机、面板、样式注入 | `node:` 内建、明文凭据、存储访问 |
| 测试 | `tests/` | node:test 行为测试 | — |

关键设计：

- `dispatchApi`（凭据）与 `InstallerRouter.handle`（安装器）是纯分发：输入 method/pathname/body，输出 status/body，不依赖 node:http，可直接单测。
- `VariableStore`：所有变更经一条 promise 链串行；落盘走临时文件 + rename（Windows EPERM/EACCES/EBUSY 短重试，失败留 `.orphan`）；revision 单调递增。
- `InstallerService`：单写者状态机；`run/remove/readInstalled/persist/activate/deactivate/audit` 全部可注入，测试不打真实 `dsh`。
- `inspectTarball`：gzip + tar 逐块解析校验，永不解压落盘。
- `StagingStore`：上传暂存（`tmpdir()`，30 分钟 TTL），安装前按 token 取回并复核 SHA-256；token 不编码文件系统路径。
- `hot.ts`：仅纯 `- insert:` patch 可热挂载；Include 类必须来自 profile 运行时副本（specifier 拼接防止被打包内联）。
- `restart.ts`：仅回环同源请求；分离 helper 进程轮询端口释放后按原命令行拉起。

运行期数据位置（开发排查用）：

| 数据 | 位置 |
| --- | --- |
| 凭据明文 | `$DSH_HOME/dsh-credential-center/variables.json` |
| 上传暂存 | `tmpdir()/dsh-tar-installer-<pid>/`（TTL 30 分钟） |
| 持久 tar 包 | `<profileDir>/.dsh-tar-installer/tarballs/` |
| 热挂载输入 | `<profileDir>/.dsh-tar-installer/hot/`（启动时清理遗留） |
| 重启 helper 与日志 | `tmpdir()/dsh-configcenter-restart-<stamp>.{cjs,log}` |

### 3.2 命令与构建管线

- `npm run typecheck`：`tsc -b` 走 project references（`shared → host/client → test`）。host 与 client 是不相交编译单元，跨半 import 直接编译失败。
- `npm test`：node:test 直跑 `tests/*.spec.(ts|tsx)`；`ts-hooks.mjs` 注册 module hooks（`.js` → `.ts/.tsx` 解析 + 即时转译）并注入 jsdom 全局。
- `npm run build`：先 `tsc -b --force` 产声明（`lib/types`），再 rollup 出两个 bundle——Host → `lib/index.js`（ESM，external 仅 `node:*`，`@deepseek-ai` 依赖全部内联）；client → `lib/client.js`（CJS，`window.__ModuleLoader__.load({ id: "configcenter" })` 包装，external react 系与 `@deepseek-ai/dsh-client-*`）。末尾硬检查：client 必须带 ModuleLoader 包装、不得内嵌 React、不得引用 `node:` 模块；host 不得有运行时 `@deepseek-ai` import。检查是产物契约，失败修因，不得改脚本绕过。
- `npm run pack:tarball`：先清 `dist/` 内旧 `configcenter-*.tgz`，`npm pack --ignore-scripts` 后打印 size 与 SHA-256。`lib/`、`dist/` 均不入库（见根 `.gitignore`）。

### 3.3 测试结构

- `protocol.spec.ts`：共享输入校验（变量名格式、save 输入归一化）。
- `store.spec.ts`：`VariableStore` 持久化语义——快照不含明文、编辑留空保留原值、新建必须给值（临时目录）。
- `service.spec.ts`：真实 Cordis `Context` 上 `apply()` 发布 `credentialVariables`。
- `panel.spec.tsx`：`renderToStaticMarkup` 断言面板用户可见信息层级。

新行为必须落到对应 spec；浏览器断言用用户可观察输出，Host 断言覆盖错误码与降级路径。

### 3.4 改动流程

1. 读源码与测试确认事实，确定改动归属：wire 协议变化先改 `shared/`，两半同变更。
2. 编码顺序：`shared` → `host` → `client`；Host 表面用结构化 interface（`ProfileContextLike`、`CredentialRouteHost`、`WebServerHost`、`HotContext`），不引硬依赖。
3. 行为变化同步 `README.md`（用户事实文档）与 `cordis.patch.yml` 默认值。
4. 版本变更同步 `package.json` `version` 与 README 中 tarball 文件名；新 DSH 版本必须重新验证宿主接口后再更新 `dsh.compatibility.dshReleases`。

## 4. 开发规范

### 4.1 安全不变量（违反即缺陷）

- 明文凭据只存在于 Host 内存与 `variables.json`；读接口、快照、日志、Remote 一律只出元数据（`VariableView` 没有值字段）。
- 上传 tar 只在 Host 校验：gzip magic、tar 逐块解析、路径安全（拒绝绝对路径/反斜杠/`..`）、拒绝链接与 PAX/GNU 扩展头、`package/package.json` ≤ 1 MiB、包名合法、必须声明 `dsh.bundle.patch`（字符串）或 `dsh.client`；永不解压落盘；安装前按 SHA-256 复核暂存内容。
- 用户数据永不进 shell：`spawn` 一律 `shell: false`；Windows 仅 PATH 回退 cmd.exe shim 且逐参数转义；profile 名与包名先过白名单正则。
- 写操作必须过同源校验（origin 与 host 匹配；无 origin 头的非浏览器客户端放行）。重启更严：仅回环地址、拒绝转发头、origin 必须存在且匹配；`allowRestart: false` 或调试器挂载时拒绝并返回稳定 reasonCode。
- 审计日志只记元数据（name/version/size/exitCode/succeeded），不记路径、归档内容、凭据。
- `configcenter` 不能卸载自身；安装脚本默认禁用（`--ignore-scripts`），开启需配置显式允许且仅限完全可信的包。

### 4.2 架构不变量

- 单写者：同一时刻至多一个安装/卸载操作，冲突返回 `BUSY` 409；操作运行中拒绝重启。
- 路由纯分发 + 独立 HTTP 适配层：body 限长（凭据 JSON 70 KiB、上传 `maxUploadBytes`、install/remove 4096），统一 `sendJson`（`no-store` + `nosniff`）。
- Host 资源（路由、Service、样式、timer）一律经 `ctx.effect`/disposer 管理；store 加载失败要可见降级（503 unavailable 路由 + 日志），不是 404。
- 热挂载是进程级尽力而为：只接受纯 `- insert:` + `id:` + `name:` patch，其余一律 `restart-required` + 稳定 `reasonCode`（`include-unavailable` / `patch-missing` / `patch-unsupported` / `mount-failed` / `not-mounted`）；启动时清理上次遗留的 mount 文件。
- 重启必须复刻当前命令行（node + execArgv + launcher + 原参数），分离 helper 轮询端口释放（≤ 30 s）后拉起，随后 SIGTERM 自身。
- `dsh` CLI 子进程 15 分钟超时并杀整个进程树（Windows `taskkill /T /F`），输出只保留尾部 96 KiB。
- Profile 解析顺序固定：`config.profile → profileContext.name → argv --profile → web`；目录取 `profileContext.dir`（不含 NUL 的字符串）否则 `$DSH_HOME/profiles/<name>`；`$DSH_HOME` 未设置时取 `~/.dsh`。

### 4.3 协议、命名与代码规范

- 所有跨端响应走统一 envelope：`ApiResult` + 稳定 `WireErrorCode`（`VALIDATION` / `NOT_FOUND` / `CONFLICT` / `METHOD` / `ORIGIN` / `BUSY` / `RESTART_DISABLED` / `INTERNAL`）+ 可选 `reasonCode`。Host message 保持技术性英文；浏览器按 code/reasonCode 查词典本地化，未知错误原样透出 message。
- 浏览器所有请求走统一 transport（`fetchJson` + `withTimeout` 12 s + `unwrapJson` → `ApiClientError`）；唯一例外是 inspect 上传不设超时。
- locale 单命名空间 `configcenter`：`zh` 是 key 事实来源，`en` 必须全覆盖；安装器词条以 `installer.` 前缀隔离。
- React 分层：状态机（`useVariables`）与纯展示（`CredentialPanel`）分离；样式经 `injectStylesOnce` 幂等注入（`data-plugin-css`）；CSS 类前缀 `dsh-cc-` / `dsh-config-center`；语义 aria（`tablist`/`tab`/`tabpanel`/`alert`/`status`）。
- 命名：路由前缀沿用旧名保持兼容，新路由挂在各自前缀下；侧栏面板 id `configuration-center`（order 38）；插件名 `configcenter` / `configcenter/client`。
- TypeScript：strict + `verbatimModuleSyntax` + `isolatedModules` + NodeNext；相对导入写 `.js` 扩展名，类型导入用 `import type`；宿主表面用结构化 interface，不引硬依赖。
- 产物边界：client 不得引用 `node:` 内建、不得内嵌 React/Cordis（复用宿主提供的）；host 自包含（运行时 `@deepseek-ai` 依赖全部内联，仅 external `node:*`）。

### 4.4 完成验证

```powershell
npm run typecheck
npm test
npm run build
npm run pack:tarball
```

涉及安装/卸载/热挂载/重启/凭据存取的变更，还必须在隔离 profile 做真实验收：安装 tarball 并重启、面板出现、凭据增删改查且列表无明文、消费插件 `get`/`require` 读到新值、上传→校验→安装→（热挂载或重启提示）全流程、卸载、重启后浏览器回连。不能用 typecheck、HTTP 200 或打包成功代替行为验收。
