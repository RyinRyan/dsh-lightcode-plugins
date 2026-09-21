# 11 · 可复制的参考工程骨架

本章提供结构模板，不代表所有插件都需要四个包。删除不需要的层，再将 `task-*` 替换为自己的稳定 npm 包名。

## 目录

```text
task-suite-workspace/
├─ package.json
├─ package-lock.json
├─ tsconfig.base.json
├─ tsconfig.host.json
├─ tsconfig.client.json
├─ tsconfig.json
├─ vitest.config.ts
├─ scripts/
│  ├─ build.mjs
│  └─ pack.mjs
├─ packages/
│  ├─ runtime/
│  │  ├─ package.json
│  │  └─ src/
│  │     ├─ index.ts
│  │     ├─ types.ts
│  │     ├─ spec.ts
│  │     ├─ remote.ts
│  │     └─ client/index.ts
│  ├─ web/
│  │  ├─ package.json
│  │  └─ src/
│  │     ├─ index.ts
│  │     └─ client/
│  │        ├─ index.ts
│  │        ├─ TaskPanel.tsx
│  │        ├─ TaskPanel.module.css
│  │        └─ locales.ts
│  ├─ feature/
│  │  ├─ package.json
│  │  └─ src/index.ts
│  └─ bundle/
│     ├─ package.json
│     ├─ index.js
│     └─ cordis.patch.yml
└─ tests/
   └─ fixtures/
```

## 根 package.json

```json
{
  "name": "task-suite-workspace",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "workspaces": ["packages/*"],
  "engines": { "node": ">=24" },
  "scripts": {
    "typecheck": "tsc -b",
    "build": "node scripts/build.mjs",
    "test": "vitest run",
    "pack": "node scripts/pack.mjs"
  },
  "devDependencies": {
    "@deepseek-ai/cordis": "4.0.2",
    "@types/node": "24.3.0",
    "@types/react": "18.3.1",
    "esbuild": "0.25.9",
    "react": "18.3.1",
    "typescript": "6.0.3",
    "vitest": "4.1.8"
  }
}
```

DSH SDK 依赖按目标版本和实际扩展点添加，并固定精确版本。示例版本只是经过验证的参考，不代表未来兼容。

## Runtime manifest

```json
{
  "name": "task-runtime",
  "version": "1.0.0",
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/types/index.d.ts",
  "exports": {
    ".": { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
    "./types": { "types": "./lib/types/types.d.ts", "default": "./lib/types/types.js" },
    "./client": { "types": "./lib/types/client/index.d.ts", "default": "./lib/client.js" },
    "./package.json": "./package.json"
  },
  "files": ["lib"],
  "peerDependencies": { "@deepseek-ai/cordis": "4.0.2" }
}
```

若 runtime 没有 Browser Remote face，可删除 `./client` 和对应构建入口。

## Web manifest

```json
{
  "name": "task-web",
  "version": "1.0.0",
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/types/index.d.ts",
  "exports": {
    ".": { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
    "./client": { "types": "./lib/types/client/index.d.ts", "default": "./lib/client.js" },
    "./package.json": "./package.json"
  },
  "files": ["lib"],
  "dependencies": { "task-runtime": "1.0.0" },
  "peerDependencies": { "@deepseek-ai/cordis": "4.0.2" },
  "dsh": {
    "client": {
      "platform": "web",
      "inject": [
        "task-runtime",
        "@deepseek-ai/dsh-client-locale",
        "@deepseek-ai/dsh-client-ui-slots"
      ]
    }
  }
}
```

## Feature 入口

```ts
import type { Context } from '@deepseek-ai/cordis'
import type {} from 'task-runtime'

export const name = 'task-feature'
export const inject = ['taskRuntime']

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.taskRuntime.registerFeature({
    id: 'example',
    version: '1.0.0',
    name: 'Example feature',
    parameters: [],
    nodes: [{ id: 'run', name: 'Run' }],
    async execute(run) {
      await run.node({ id: 'run', name: 'Run' }, async node => {
        node.signal.throwIfAborted()
        await node.log('started')
        return { ok: true }
      })
    },
  }), 'register example feature')
}
```

## Bundle manifest 与 patch

```json
{
  "name": "task-suite",
  "version": "1.0.0",
  "type": "module",
  "main": "index.js",
  "files": ["index.js", "cordis.patch.yml"],
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } },
  "dependencies": {
    "task-runtime": "1.0.0",
    "task-web": "1.0.0",
    "task-feature": "1.0.0"
  },
  "bundleDependencies": ["task-runtime", "task-web", "task-feature"]
}
```

```yaml
- insert:
    - id: task-runtime
      name: task-runtime
    - id: task-feature
      name: task-feature
    - id: task-web
      name: task-web
```

`index.js` 可以是无副作用的空 ESM 入口：

```js
export const name = 'task-suite'
```

## 构建原则

`scripts/build.mjs` 应按以下顺序执行：

1. `tsc -b`。
2. 每个 Host `src/index.ts` 构建为 Node ESM。
3. Runtime/Web 的 Client 入口构建为 DSH 支持的 Browser ModuleLoader factory。
4. React、Cordis、Client Store/Slots/Primitives 设置为 external。
5. 处理 CSS Modules并生成稳定映射。
6. 保留 sourcemap 和类型声明。

不要从示例中复制固定 external 清单后就停止检查；目标 DSH 版本和实际 imports 决定清单。

## 打包脚本原则

`scripts/pack.mjs` 应：

1. 清空或创建明确的 `dist` 输出（不要递归删除不确定路径）。
2. 分别 pack runtime/web/feature。
3. 创建 staging 临时目录。
4. 用成员 tarball 临时安装 bundle dependencies。
5. 恢复正式 manifest 后 pack 外层 bundle。
6. 输出最终 tarball 绝对路径、版本、大小和可选 SHA256。

## 第一个测试

在写真实业务前，先做贯通 fixture：

- Runtime 能注册 feature 并创建一个 run。
- Feature 产生一个 JSON output。
- Remote 返回 snapshot。
- Web 显示该 output。
- Bundle 在隔离 profile 中安装后出现页面。
- 重启后 run 仍存在，remove 后页面消失但历史处理符合文档。

贯通后再增加模型、工具、子进程、审批和复杂 UI；这样出错时能判断是基础装配还是新业务能力。
