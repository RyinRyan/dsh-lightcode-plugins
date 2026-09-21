# 06 · 依赖管理与构建

插件在 workspace 中能运行，不代表安装后能运行。需要同时管理 npm 依赖、Cordis 运行时依赖、Browser module external 和 Bundle 成员四张图。

## 四种依赖

| 类型 | 表达位置 | 示例 | 含义 |
| --- | --- | --- | --- |
| Node 运行时依赖 | `dependencies` | schema、业务 SDK | Host 入口真实 import |
| 宿主唯一身份 | `peerDependencies` | `@deepseek-ai/cordis` | 必须复用宿主实例 |
| 构建与测试 | `devDependencies` | TypeScript、esbuild、Vitest、React types | 不进入生产运行时 |
| Cordis 能力依赖 | `inject` | `tools`、`storageDomain` | 激活前等待 service |

Browser 还有两项：

- bundler `external`：不打进 `lib/client.js`，运行时由 DSH ModuleLoader 提供。
- `dsh.client.inject`：声明 Client 包级图需要哪些 DSH/业务包。

它们与 npm sections 互不替代。

## 不要打包第二份宿主运行时

React、Cordis、DSH Client Store/Slots 等依赖对象身份。若 bundle 内嵌第二份，常见结果是：

- React `invalid hook call`。
- 插件注册了 Service，但消费者看不见。
- Context、store、slot 各有两套实例。
- HMR 或卸载只清理其中一份。

做法：将宿主共享模块设为 browser build external；Cordis 用精确或已验证范围的 peer dependency；开发环境再放 dev dependency 供类型和测试使用。

## Workspace 根 manifest

```json
{
  "name": "task-suite-workspace",
  "private": true,
  "type": "module",
  "workspaces": ["packages/*"],
  "engines": { "node": ">=24" },
  "scripts": {
    "typecheck": "tsc -b",
    "build": "node scripts/build.mjs",
    "test": "vitest run",
    "pack": "node scripts/pack.mjs"
  }
}
```

锁文件必须提交。DSH/SDK/Cordis 在 developer preview 阶段优先固定精确版本，避免 `^` 自动漂移。

## TypeScript 工程

推荐 project references：

```text
tsconfig.base.json      公共 strict/module 设置
tsconfig.host.json      Node/Host 类型和输出
tsconfig.client.json    DOM/React 类型和 Client 输出
tsconfig.json           references 到各 package
```

Host 与 Client 分开 typecheck 能更早发现 Browser import 了 `node:fs`、Host import 了 JSX runtime 等端面错误。

## 构建目标

Host：ESM、Node 24、将 npm 运行时依赖留为 external。  
Client：Browser bundle、DSH 支持的 ModuleLoader factory 格式、共享基座 external、CSS 资源可追踪。  
Types：同时生成 `.` 与 `./client` 的声明文件。

产物应满足：

```text
lib/index.js
lib/client.js             # 仅双端包
lib/types/index.d.ts
lib/types/client/index.d.ts
```

## package exports 和 files

```json
{
  "main": "lib/index.js",
  "types": "lib/types/index.d.ts",
  "exports": {
    ".": { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
    "./client": { "types": "./lib/types/client/index.d.ts", "default": "./lib/client.js" },
    "./package.json": "./package.json"
  },
  "files": ["lib/index.js", "lib/client.js", "lib/types"]
}
```

不要依赖未导出的深层路径。某个包内部存在组件，并不代表可以通过 public exports 稳定复用。

## 依赖审计问题

每个 import 都回答：

1. 运行在 Host 还是 Browser？
2. 是类型、构建输入还是运行值？
3. 是否必须与宿主共享唯一实例？
4. Browser 中是 bundle 还是 external？谁在运行时提供？
5. 最终 tarball 中谁负责安装它？
6. 是否使用了 package exports 之外的内部路径？

回答不清的依赖不要进入发布物。

## 构建后的检查

```powershell
npm run typecheck
npm run build
npm test
npm pack --dry-run
```

再搜索 Client bundle 是否意外包含 React/Cordis 实现、绝对开发路径、fixture 凭据和 Node-only 模块。
