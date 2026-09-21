# dsh-tar-installer — 设计说明

## 目标

提供一个独立 DSH Web 插件，将本地 tar 上传、预检、确认和 `dsh plugin add` 串成可观察流程。它不是通用市场，不访问远程注册表，也不负责插件更新和卸载。

## 参考实现与取舍

实现参考 `dsh-market/dsh-market` 的 Host 安装模型：浏览器不直接执行命令；Host 通过当前 DSH 启动入口重新调用 CLI；修改接口做同源检查；耗时安装脱离请求生命周期继续运行；Windows `.cmd` 通过 `cmd.exe` 的受控 argv 路径调用。市场中的远程目录、更新、热挂载、冲突分析和备份恢复不属于本插件职责。

## 运行结构

```text
Browser panel
  POST /inspect (raw tgz) -> Host tar validator -> temporary staging token
  POST /install (token)   -> InstallerService -> persist under Profile -> dsh plugin --profile P add FILE --ignore-scripts
                              -> Hot Include subtree when the bundle patch is a plain insert list
  GET  /status            <- operation snapshot + current direct dependencies (polling)
  POST /restart           -> loopback/same-origin guard -> detached relaunch helper -> SIGTERM current host
```

- Host 是 staged tar 与安装状态的唯一权威。
- Browser 只保留展示状态，不持久化路径或执行命令。
- `InstallerService` 串行化 mutation；安装任务在响应 `202` 后独立完成。
- staging token 是随机 UUID，只映射 Host 内存中的绝对临时路径。
- 在调用 DSH CLI 前，InstallerService 将 staging 文件复制到当前 Profile 的 `.dsh-tar-installer/tarballs/`；这是 `file:` 依赖的持久来源，不能在安装结束时删除。
- 已安装包由 Host 从当前 Profile 的 `package.json` 直接依赖与其已解析的 `node_modules` 清单读取；浏览器只接收名称、版本、来源类别和 DSH 标识，不接收本地路径或完整依赖规格。
- 安装成功后，Host 读取新包的 Bundle Patch。仅当它是无配置、无表达式的纯 `insert/id/name` 列表时，才以 Profile 解析出的绝对模块 URL 写入进程临时 Include 子树并等待激活；其余形式保守地返回 `restart-required` 和原因。持久的下一次启动仍完全由 DSH Profile bundle 层负责。
- 手动重启路由仅接受同源、无转发痕迹的 loopback POST；拒绝安装进行中、调试器环境及配置禁用的请求。独立 helper 等待请求实际访问的端口释放后，用原启动 argv 拉起替代进程，避免端口竞争。

## 状态

```text
empty -> inspected -> running -> succeeded
                     \--------> failed
```

新检查在 `running` 期间被拒绝。token 在进入 `running` 前消费，不能重放。终态保留到下一次检查，便于页面刷新后查看结果。

## 已知限制

- v0.4 只热挂载纯 `insert/id/name` patch。带配置/表达式的包、已解析映射的替换、或 Host 不支持 Include 时必须重启；页面会显示原因。
- v0.5.2 提供受控的手动 DSH 重启；Windows 使用脱离父 Job 的 PowerShell `Start-Process` 拉起 helper，并记录 bootstrap 失败。它会中断运行中的工作，且在受监管部署中应配置 `allowRestart: false`，由外部监管器负责重启。
- v0.4 不自动回滚 DSH CLI 在失败前可能写入的 profile 依赖记录；失败输出会保留，用户应使用 `dsh plugin --profile <name> list` 检查。后续版本若增加回滚，必须先采用 DSH profile 的正式事务/快照接口，而不是猜测文件布局。
- tar 预检拒绝链接和特殊条目，可能拒绝某些非 `npm pack` 生成的自定义归档；这是有意的安全收敛。
