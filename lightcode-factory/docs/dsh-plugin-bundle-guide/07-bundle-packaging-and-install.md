# 07 · Bundle 打包、安装与升级

Bundle 是“安装后把哪些插件行装配进 profile”的交付包。它不等于业务插件，也不应成为状态权威。

## Bundle 最小结构

```text
packages/task-suite/
├─ package.json
├─ index.js
└─ cordis.patch.yml
```

`package.json`：

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

`cordis.patch.yml`：

```yaml
- insert:
    - id: task-runtime
      name: task-runtime
      config:
        maxConcurrent: 2
    - id: task-feature
      name: task-feature
    - id: task-web
      name: task-web
```

`id` 是后续 patch 覆盖的稳定定位符，`name` 是模块解析名。依赖 Service 的插件通过 `inject` 等待，不要靠 YAML 顺序碰运气。

## 为什么直接 pack workspace 常失败

workspace 成员通常是符号链接/硬链接。只对外层 bundle 执行 `npm pack`，不会自动把链接目标变成可迁移文件。离开源码目录后就会找不到成员包。

可靠 staging 流程：

1. 分别 `npm pack` runtime、web、feature。
2. 创建临时 staging 目录。
3. 拷贝 bundle 的 manifest、入口、patch、License。
4. 临时把成员依赖改成 `file:D:/.../member-1.0.0.tgz`。
5. 在 staging 中离线安装，得到真实 `node_modules`。
6. 将 staging manifest 恢复为正式版本依赖。
7. 对 staging 执行最终 `npm pack`。
8. 解包最终 tarball，验证成员真实存在且无绝对 file 依赖。

临时目录用 `mkdtemp`/`New-Item` 创建，不覆盖源码 manifest。

## 安装到隔离 Profile

```powershell
dsh --profile plugin-dev --from-default-profile web --dump-config
dsh plugin --profile plugin-dev add "D:\packages\task-suite-1.0.0.tgz" --ignore-scripts
dsh --profile plugin-dev --dump-config
dsh --profile plugin-dev --no-open --host 127.0.0.1 --port 3892
```

打开 DSH 打印的带 token URL。普通根 URL在尚未写入认证 cookie 时会返回 401，这是浏览器认证机制，不等于服务未启动。

## Profile、Home 与 Patch

- Bundle：提供默认插件组合。
- Profile：一个可启动组合和依赖目录。
- Profile patch：对当前 profile 覆盖。
- Home patch：同一 DSH home 的全局覆盖。
- 命令行 `--patch`：一次启动的最后覆盖层。

后层覆盖前层；同一 Loader 行的 `config` 通常是整体替换，不应假设深合并。Profile 隔离不必然等于数据隔离，E2E 最好使用单独 `DSH_HOME`。

## 升级

1. 所有成员和 bundle 使用新版本号。
2. 构建、测试、pack，并记录 tarball hash。
3. 停止使用该 profile 的 DSH 进程。
4. `dsh plugin add` 安装新 tarball。
5. `--dump-config` 核对装配。
6. 启动并做 smoke/restart/history 测试。

不要覆盖同版本 tarball再期望包管理器刷新；缓存、lockfile 和 hardlink 可能继续使用旧内容。

## Windows 文件锁

运行中的 Node/DSH 进程可能锁住 profile 下的 hardlink，导致：

```text
EPERM / access denied / failed to remove existing directory
```

先用 `netstat -ano`/`Get-NetTCPConnection` 精确确认监听进程，只停止目标测试服务，确认端口释放后再安装。不要批量杀掉所有 Node 进程。

## 卸载与数据

```powershell
dsh plugin --profile plugin-dev remove task-suite
```

卸载通常移除 bundle 装配和包，不应默认删除业务历史、artifact 或数据库。文档必须说明数据位置和显式清理流程；删除前验证绝对路径和恢复方案。

## 发布前 tarball 清单

- 入口、exports、types 和 Client bundle 均存在。
- Bundle 成员真实内嵌或能从 registry 解析。
- 不含源码 secret、fixture、用户数据和开发机绝对路径。
- `package.json` 没有遗留 `file:` 开发依赖。
- License、版本、engine、peer dependency 正确。
- 在没有源码 checkout 的临时目录安装成功。
