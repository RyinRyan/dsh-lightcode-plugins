# 07 · 踩坑手册：症状 → 根因 → 修复

以下问题覆盖从本地源码插件到独立可安装 bundle 的常见故障模式。

## 依赖与打包

| 症状 | 根因 | 修复 |
| --- | --- | --- |
| 源码能跑，安装 tarball 后找不到成员包 | workspace 依赖只是本地链接，外层 pack 没带真实文件 | 先 pack 成员，在 staging 中离线安装，再 pack 外层 bundle |
| 页面报 invalid hook call / 服务看不见 | Client bundle 内嵌了第二份 React 或 Cordis | 把宿主基座设为 external，用 peer dependency 复用身份 |
| 安装 Git 包后没有 `lib/` | Git 安装拿到源码且没有获准执行 `prepare` | 提供自包含 prepare 并授权 `allowBuilds`，或交付预构建 tarball/npm 包 |
| 更新包后仍运行旧代码 | 覆盖了同版本 tarball，缓存命中 | 每次发布升级版本；测试时清晰记录 tarball digest |
| 包在本机可用，换机器失败 | 构建偷偷引用相邻 DSH 源码或绝对路径 | 只依赖公开包；在临时目录/隔离 profile 验证发布物 |

## Cordis 生命周期

| 症状 | 根因 | 修复 |
| --- | --- | --- |
| 插件一直 PENDING | `inject` 写了不存在或端面错误的 service key | 查实际 service 名与 Host/Client face，不要靠调整配置顺序 |
| HMR 后回调执行两次 | 注册没有绑定 effect/disposer | 所有注册、timer、subscription、连接进入 `ctx.effect` |
| 重载后同名工作流重复 | registry 无重复保护或旧注册没释放 | 注册时 fail loud；返回 disposer 并交给插件 fiber |
| 关闭时数据丢失 | dispose 只 abort，没有等待 task/mutation | stop admission → abort → await tasks → flush/close storage |
| 声明了 Context 类型但运行时报 undefined | `declare module` 只影响类型，不提供服务 | 安装真正的 Service 插件并声明 inject |

## Web 双端

| 症状 | 根因 | 修复 |
| --- | --- | --- |
| Host 正常、侧栏不出现 | 未声明 `dsh.client`、缺 `./client` 或没构建 `lib/client.js` | 同时验证 manifest、exports、files 和产物 |
| Client 导入另一个业务组件后构建/热更不稳定 | 把业务插件当组件库，形成 feature 运行时耦合 | 通过 slots 组合；共享原语放入窄静态 owner |
| 浏览器直接 import Host 文件失败 | Node API/密钥/运行时进入浏览器图 | 分离 Host/Client 入口，通过 Remote 传 JSON 值 |
| CSS HMR 后不断累积 | style 注入没有稳定 key 或清理 | 使用框架样式管线；自管时用稳定 id 并绑定 dispose |
| Remote 值偶发解析失败 | 两端 schema 漂移或输出不可 JSON 化 | wire contract 单一来源，运行时校验并限制大小 |

## 工作流与状态

| 症状 | 根因 | 修复 |
| --- | --- | --- |
| 取消后节点又变成功 | 晚到返回覆盖 terminal 状态 | 先持久化取消；提交节点结果前再次检查终态 |
| 节点日志顺序随机或状态竞争 | 多个读改写并发落库 | 每个 run 使用单一 mutation 链或事务 |
| 重启后任务永远 running | 没有定义恢复协议 | 有 checkpoint 才恢复；否则明确失败并记录原因 |
| UI 和 Backend 状态互相覆盖 | 两端都是状态权威 | Backend 拥有事实，UI 只发命令和展示 snapshot |
| 模型工作流承担队列/基线推进 | 把 durable 控制面交给提示词 | 平台代码负责队列、幂等、重试、发布门禁；模型负责语义工作 |
| 自称支持沙箱隔离第三方插件 | 混淆子进程工具沙箱与进程内插件信任 | 不可信代码独立进程/容器，走窄协议 |

## 配置与版本

- Patch 替换整段 `config`，不会深合并；覆盖时要重述所有需要字段。
- Bundle 集合在启动时确定；add/remove/update 后重启 Profile。
- Profile 数据与同一 DSH home 下的存储不一定隔离；测试要使用隔离 home。
- DSH 仍处于快速演进阶段；插件、checkpoint、event、client module 接口要按精确版本重新验证。
- 测试中的全权限配置不能复制到真实模型环境。

## 一条排障原则

先确认问题发生在哪个边界：配置组合、模块解析、Cordis 激活、Host 业务、Remote、Client 模块、React 展示、打包发布。不要一次修改多个边界；每次用最小测试证明一个假设。
