# 05 · 打包、安装与依赖管理

插件能在源码 checkout 里运行，不代表它能被用户安装。交付时必须同时解决：入口产物、npm 依赖、宿主共享运行时、浏览器模块图和 DSH 组合配置。

## 四类依赖不要混放

| 关系 | 写在哪里 | 示例 | 作用 |
| --- | --- | --- | --- |
| Host 运行时库 | `dependencies` | `zod`、普通业务库 | 安装后 Node 入口真实 import |
| 宿主身份必须唯一 | `peerDependencies` | `@deepseek-ai/cordis` | 复用宿主实例，避免第二个 Context 类型/运行时 |
| 构建、类型、测试输入 | `devDependencies` | TypeScript、esbuild、React 类型 | 只在开发/构建使用 |
| Bundle 成员 | bundle 的 `dependencies` + `bundleDependencies` | backend/platform/workflow | 一个 tarball 携带整组插件 |

浏览器还多一层：构建器决定哪些模块打进 `lib/client.js`，哪些作为 external 由 DSH 模块表提供。npm section 与 bundle external 是两个独立决策。

## 不要打包第二份宿主

Cordis、React 和 DSH Client 基座依赖宿主共享身份。若把它们 bundle 进插件，常见结果是：hook 失效、Context 服务看不见、React invalid hook call 或重复 store。构建时把基座列为 external；manifest 只为非基座的动态模块请求声明 `dsh.client.external`。

## 一个可安装 Bundle

```text
my-product/
├─ package.json
├─ index.js
└─ cordis.patch.yml
```

```json
{
  "name": "my-product",
  "version": "1.0.0",
  "type": "module",
  "main": "index.js",
  "files": ["index.js", "cordis.patch.yml"],
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } },
  "dependencies": {
    "my-backend": "1.0.0",
    "my-web": "1.0.0"
  },
  "bundleDependencies": ["my-backend", "my-web"]
}
```

```yaml
- insert:
    - id: my-backend
      name: my-backend
    - id: my-web
      name: my-web
```

`cordis.patch.yml` 中的 `id` 用于后续 patch 精确覆盖；保持稳定。`name` 是实际模块解析名。

## 为什么 workspace Bundle 常需要 staging 打包

npm workspace 的本地依赖常是符号链接，直接 pack 安装入口并不会自动把多个 workspace 包变成可离线安装的真实文件。可靠做法是先分别 `npm pack` 业务包，再在临时 staging 目录用 `file:` tarball 离线安装，最后恢复正式 manifest 并打包外层 bundle。这样最终 `.tgz` 内包含真实成员，不依赖相邻源码目录。

## 标准构建和打包链

```powershell
npm ci
npm run build
npm test
npm run pack
```

构建应先 typecheck，再生成 Host ESM、Client bundle、类型声明和必要资源。`files` 是发布白名单；不要把源码测试、密钥、fixture 配置和用户数据打进去。

## 隔离 Profile 安装

```powershell
dsh --profile plugin-dev --from-default-profile web --dump-config
dsh plugin --profile plugin-dev add "D:\path\my-product-1.0.0.tgz" --ignore-scripts
dsh --profile plugin-dev --dump-config
dsh --profile plugin-dev --no-open --host 127.0.0.1 --port 3892
```

卸载：

```powershell
dsh plugin --profile plugin-dev remove my-product
```

添加、移除或更新 bundle 后要重启 Profile；普通 profile/home patch 在启用 live reload 时可热重载。

## 版本和缓存

- DSH developer preview 期间固定精确宿主版本或 commit。
- Bundle 与所有成员统一升级版本；不要覆盖同版本 tarball，包管理器可能复用缓存。
- 在 `peerDependencies` 写出已验证 Cordis/DSH 范围；没有验证过相邻版本就不要扩大范围。
- 发布 npm 前使用组织 scope 或私有 registry，确认包名归属。
- 从 Git 安装会要求 `prepare` 构建，pnpm 10+ 默认需要 `allowBuilds` 授权；tarball/registry 的预构建产物不需要安装时执行脚本。

## 发布前检查 tarball

```powershell
npm pack --dry-run
npm view . --json
```

至少确认：入口存在、`exports` 指向真实文件、Client bundle 被包含、没有源码 secret、依赖闭包完整、License 在包内、包体大小符合预期。
