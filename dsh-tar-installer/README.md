# dsh-tar-installer

一个面向 DSH Web Profile 的本地 Tar 包安装插件。它在侧栏增加“Tar 包安装”页面，允许拖入 `npm pack` 生成的 `.tgz` / `.tar.gz`，先检查包清单与归档安全属性，再安装到当前 Profile。

## 安装

```powershell
npm run build
npm run pack:tarball
dsh plugin --profile web add .\dist\dsh-tar-installer-0.5.2.tgz --ignore-scripts
```

重启 `dsh web`，打开侧栏“Tar 包安装”。

## 使用流程

1. 拖入或选择插件 Tar 包。
2. 核对包名、版本、SHA-256、Host/Client/Bundle 声明和目标 Profile。
3. 点击“确认安装”。默认向 DSH CLI 传递 `--ignore-scripts`。
4. 安装成功后，页面会自动刷新“当前已安装包”清单，并尝试立即热挂载新插件。页面会显示“已即时生效”或给出确切的重启原因。

页面底部的“当前已安装包”只展示此 Profile 的**直接依赖**，包含已解析版本、来源类别（不会暴露本地绝对路径）及 DSH 插件标识。可手动刷新或按包名筛选。

## 即时生效

对于只含 `insert → id/name` 行的普通 Bundle Patch，安装器会通过 DSH 的 Include 子树把新插件挂载到当前进程，无需重启。带 `config`、表达式、替换既有包映射，或 Host 未提供 Include 能力的包不会被冒险降级挂载：它们会安装成功，并在页面说明为何仍需要重启。这是为了避免丢失配置或产生重复插件 ID。

## 手动重启 DSH

页面右上角的“重启 DSH”会重新拉起**当前** DSH Profile。确认后，安装器先让浏览器收到响应，再由独立 helper 等待原端口释放并复用原始启动参数启动替代进程；浏览器连接会自动重试。安装任务进行中、调试器环境、非回环/非同源请求，以及 `allowRestart: false` 时会拒绝重启。重启会中断正在执行的任务。

## 安全设计

- 上传与安装接口只接受同源 POST；上传大小默认上限 128 MiB。
- Host 解压到内存检查 tar 头，不把归档内容直接展开到文件系统。
- 拒绝绝对路径、`..`、反斜杠路径、软链接、硬链接和特殊设备条目。
- 必须包含有效的 `package/package.json`，并声明 `dsh.bundle` 或 `dsh.client`。
- 临时文件使用随机 token 映射，30 分钟过期；安装开始后 token 立即失效，安装结束即删除文件。
- 开始安装前，归档会复制到目标 Profile 的 `.dsh-tar-installer/tarballs/`；DSH 的 `file:` 依赖始终引用这份持久副本，绝不会引用会被清理的临时上传文件。
- 同一时刻只运行一个安装操作；页面离开不会中止已经开始的安装。
- 安装脚本默认禁用。只有管理员在 `cordis.patch.yml` 将 `allowInstallScripts` 设为 `true` 后，页面才显示显式勾选项。

插件代码仍以当前系统用户权限运行。只安装你信任来源的 Tar 包；归档检查不能替代源码审计。

## 配置

```yaml
- id: dsh-tar-installer
  name: dsh-tar-installer
  config:
    maxUploadMiB: 128
    allowInstallScripts: false
    allowRestart: true
    # profile: web  # 通常无需设置，插件自动使用宿主当前 Profile
```

## 开发验证

```powershell
npm run typecheck
npm test
npm run build
npm run pack:tarball
```
