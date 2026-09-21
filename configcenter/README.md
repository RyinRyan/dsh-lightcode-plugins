# configcenter

一个统一的 DSH Web 配置插件：在“配置中心”中通过“凭据管理”和“插件管理”两个页签，集中维护密钥变量与本地插件 Tar 包。其他插件仍可通过 `ctx.credentialVariables` 按变量名读取当前值。

## 功能

- 在 DSH 左侧栏提供一个“配置中心”入口，包含“凭据管理”和“插件管理”两个页签。
- 新增、搜索、编辑和删除变量。
- 变量名采用环境变量格式：`[A-Za-z_][A-Za-z0-9_]*`。
- 数据持久化到 `$DSH_HOME/dsh-credential-center/variables.json`；可通过插件配置 `dataDir` 改写目录。
- 列表接口只返回变量名、说明和更新时间，绝不返回明文值。
- 在“插件管理”中校验并安装 `.tgz` / `.tar.gz`，查看当前 Profile 的已安装包，并在需要时重启 DSH。
- 向同一 DSH Host 内的其他插件提供 `credentialVariables` Cordis Service。

## 安装

先构建并打包：

```powershell
npm install
npm run build
npm test
npm run pack:tarball
```

将生成的 tarball 安装到目标 profile：

```powershell
dsh plugin --profile my-profile add .\dist\configcenter-0.1.0.tgz --ignore-scripts
```

重新启动该 profile 后，左侧栏会出现“配置中心”。

## 从旧插件迁移

将旧的 `dsh-credential-center` 和 `dsh-tar-installer` 都替换为本包：删除它们各自在 Profile 中的依赖和 patch 行，再安装 `configcenter`。默认凭据数据目录保持为 `$DSH_HOME/dsh-credential-center`，因此已有变量会被直接复用；不要复制或暴露 `variables.json` 中的明文值。

## 页面使用

1. 在“凭据管理”页签中点击“新增变量”。
2. 输入变量名、说明和值。
3. 保存后，其他 Host 插件下一次读取就会得到新值，不需要重启 DSH。
4. 编辑变量时，值输入框留空表示只修改说明并保留原值。
5. 在“插件管理”页签中上传 npm pack 生成的包，确认归档检查结果后安装。

浏览器不会读取已经保存的明文值。列表中的圆点只表示该变量已经配置，不是明文值的替代传输。

## 其他插件如何读取

消费插件需要声明 `credentialVariables` 注入。Cordis 运行时按 service 名称连接，不需要运行时 `import` 本包；凭据中心和消费插件只要同时出现在同一个 DSH profile 即可。

消费插件可以在自己的源码中声明它所依赖的 Service 类型。这样本地调试不需要安装、链接或导入 `dsh-credential-center`，也不会在编译结果中留下该包的依赖：

```ts
import type { Context } from '@deepseek-ai/cordis'

interface CredentialVariables {
  get(name: string): string | undefined
  require(name: string): string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    credentialVariables: CredentialVariables
  }
}

export const name = 'my-model-plugin'
export const inject = ['credentialVariables']

export function apply(ctx: Context): void {
  // 可选变量：不存在时返回 undefined。
  const optionalBaseUrl = ctx.credentialVariables.get('DEEPSEEK_BASE_URL')

  // 必需变量：不存在时抛出带变量名的明确错误。
  const apiKey = ctx.credentialVariables.require('DEEPSEEK_API_KEY')

  ctx.logger.info('credential loaded; base URL configured: %s', optionalBaseUrl !== undefined)
  // 将 apiKey 直接传给后端 SDK。不要写日志，也不要通过 Remote 返回浏览器。
  void apiKey
}
```

`inject` 是运行时前置条件：如果 profile 没有安装凭据中心，消费插件不会激活；它不是 npm 依赖声明。

如果凭据中心和消费插件位于不同仓库，而你希望复用凭据中心导出的 TypeScript 声明，也可以把下面这行作为**仅开发期**类型导入。`import type` 会在 JavaScript 构建产物中被移除：

```ts
import type {} from 'dsh-credential-center'
```

此可选做法要求本地 TypeScript 能解析该包，例如消费插件 `devDependencies` 使用本地 tarball 或本地目录；它不应放在 `dependencies` 或 `peerDependencies` 中。

```json
{
  "devDependencies": {
    "dsh-credential-center": "file:../dsh-credential-center"
  }
}
```

### API

```ts
interface CredentialVariables {
  get(name: string): string | undefined
  require(name: string): string
}
```

- `get(name)`：变量不存在时返回 `undefined`。
- `require(name)`：变量不存在时抛出 `credential variable "NAME" is not configured`。
- 每次调用都读取内存中的最新值；页面保存成功后立即生效。
- Service 只存在于 Host。Client 插件和浏览器 Remote 不应获得此 Service。

## 配置和数据文件

安装插件后，修改目标 profile 的 patch 文件：

```text
C:\Users\<用户名>\.dsh\profiles\<profile>\cordis.patch.yml
```

默认数据文件不需要额外配置，位于：

```text
C:\Users\<用户名>\.dsh\dsh-credential-center\variables.json
```

该路径来自 `$DSH_HOME/dsh-credential-center/variables.json`；`DSH_HOME` 未设置时，Windows 默认是 `C:\Users\<用户名>\.dsh`。Profile 目录和数据目录是两处不同的位置。

在 `cordis.patch.yml` 中添加或覆盖本插件的 `config`：

```yaml
- id: dsh-configuration-center
  config: {}
```

如需指定数据目录，将 `config` 改为：

```yaml
- id: dsh-configuration-center
  config:
    dataDir: D:/private/dsh-credentials
```

Web profile 会在修改 `cordis.patch.yml` 后实时重载；其他 profile 请重启。不要把数据目录放进 Git 仓库。持久化文件包含明文密钥，应仅允许运行 DSH 的用户读取；插件写入时会请求 owner-only 文件权限，Windows 上最终访问控制仍由所在目录 ACL 决定。
