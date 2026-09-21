# 09 · 实践踩坑手册

## 依赖与打包

| 症状 | 根因 | 修复 |
| --- | --- | --- |
| 源码能跑，tarball 安装后找不到成员包 | workspace 只是本地链接 | 成员先 pack，staging 离线安装，再 pack 外层 bundle |
| `invalid hook call` 或 Cordis 服务彼此不可见 | Client 内嵌第二份 React/Cordis | 宿主基座 external + peer dependency |
| Git 安装后没有 `lib/` | 安装拿到源码且 `prepare` 未获准执行 | 发布预构建 tarball/registry 包，或明确配置 allowBuilds |
| 更新 tarball 后还是旧代码 | 同版本缓存、lockfile 或旧进程已加载模块 | 升版本、停服务、重新安装、核对 profile manifest |
| 本机可用，换目录/机器失败 | 依赖相邻源码、绝对路径或 workspace link | 临时空目录做离线安装验证 |
| `EPERM` 无法替换 profile 包 | Windows 运行进程锁住 hardlink | 精确停止占端口的目标 DSH 进程后再升级 |
| pack 写 npm cache 被拒绝 | cache 在受限用户目录 | 使用允许的 cache 目录或经授权运行，不能静默跳过打包 |

## Cordis 生命周期

| 症状 | 根因 | 修复 |
| --- | --- | --- |
| 插件一直 PENDING | `inject` 使用错误 key、错误端面或 provider 未启动 | 查目标版本实际 service key，不靠调整顺序 |
| Context 类型存在但运行时 undefined | `declare module` 只改变类型 | 安装真正 Service provider 并声明 inject |
| HMR 后事件执行两次 | listener/timer/registry 没有 disposer | 所有副作用进入 `ctx.effect` |
| 重载后重复注册 | registry 不拒绝重复或旧注册未释放 | fail loud + disposer + 生命周期测试 |
| 停机后数据缺失 | 只 abort，未等待 task/mutation/storage | stop admission → abort → await → flush → close |

## Host 与状态

| 症状 | 根因 | 修复 |
| --- | --- | --- |
| 取消后又变成功 | 晚到节点结果覆盖 terminal | 先持久化取消，所有提交点复查终态 |
| 日志/节点顺序随机 | 并发读改写同一记录 | 单一 mutation chain 或事务 |
| 重启后永远 running | 未定义 recovery | 有 checkpoint 才恢复，否则明确失败 |
| UI 与后台状态冲突 | 两端都当状态权威 | Host 拥有事实，Client 只发命令和展示 |
| 内存队列有任务但数据库没有 | admission 先入队后落盘 | durable queued record 先于 enqueue |
| 输出导致存储或页面崩溃 | 未限制日志、观测和响应大小 | 分层上限 + artifact/pagination |

## Web 双端

| 症状 | 根因 | 修复 |
| --- | --- | --- |
| Host 正常，侧栏/面板不出现 | 缺 `dsh.client`、`./client` 或产物 | 同时检查 manifest、exports、files 和 tarball |
| Browser import 报 Node API 错误 | Client 图引用了 Host 文件 | 双入口分离，只共享纯类型/schema |
| Client 导入另一个业务组件后升级脆弱 | feature 运行时耦合 | 用 Slot 组合；共享原语建窄静态包 |
| 页面一直 loading | Remote 错误被吞、订阅未启动 | 明确 phase/error/retry 状态 |
| CSS 重载后累积 | style 注入无稳定 key/cleanup | 使用构建管线或 lifecycle cleanup |
| Remote 偶发解析失败 | 类型与运行时 schema 漂移 | wire contract 单一来源并做边界测试 |

## 配置、Profile 与认证

| 症状 | 根因 | 修复 |
| --- | --- | --- |
| 覆盖一个 config 字段后其他字段消失 | Patch 对该行整体替换，不是深合并 | 覆盖时重述所需完整 config |
| 安装后不重启看不到 Bundle | Bundle 集合在启动时确定 | add/remove/update 后重启 profile |
| 隔离 profile 却读到旧业务数据 | 同一 DSH home 的 storage 可能共享 | E2E 使用独立 `DSH_HOME` |
| 根 URL 返回 401 | 尚未用 launch token 换取浏览器 cookie | 打开 DSH 输出的带 token URL |
| 端口显示占用但启动日志不清楚 | 旧服务仍监听 | `netstat -ano` 精确定位 PID，确认后只停该服务 |

## 安全误区

- Tool/子进程使用 sandbox，不代表插件代码本身被隔离。
- 安装脚本在 Agent sandbox 之外运行，非必要使用 `--ignore-scripts`。
- 隐藏页面按钮不是授权；Host Remote 必须重新校验。
- 生成代码是非可信输入，即使由当前默认模型生成也一样。
- 测试中的 `danger-full-access`、`approval: never` 不能复制到生产 profile。

## 排障原则

先确定故障边界：

```text
Bundle/Profile composition
  → npm/module resolution
  → Cordis activation
  → Host domain logic
  → Remote/wire
  → Browser ModuleLoader
  → React/store/slot
  → packaging/cache/process
```

一次只验证一个假设，不同时修改配置、业务代码和构建脚本。
