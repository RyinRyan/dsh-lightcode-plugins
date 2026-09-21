# 06 · 调试、测试与验收

调试 DSH 插件最有效的方法是分层证明，而不是直接打开完整 Web 后凭感觉点击。每一层只回答一个问题，失败时定位范围很小。

## 六层测试梯

### 1. 静态契约

```powershell
npm run typecheck
```

检查 Context 声明、schema 类型、Host/Client import 边界和构建引用。

### 2. 纯业务与状态机

用 Vitest 直接挂载最小 Cordis Context，测试注册、状态转换、取消、异常、大小限制和重启恢复。不要依赖浏览器。

### 3. 组合测试

通过真实 Loader 配置加载 backend + workflow，挂载确定性模型 adapter 和真实工具/子进程，证明插件组合方式与生产一致。

### 4. UI 组件测试

在 jsdom 中给组件传真实形状的 props，断言用户可见行为、可访问名称、按钮命令和错误态。不要断言 class 名或 React 内部实现。

### 5. 打包检查

对 `.tgz` 解包或 `npm pack --dry-run`，确认发布视图和依赖闭包。源码测试通过但 tarball 缺 `lib/client.js` 是常见失败。

### 6. 隔离 Profile 端到端

完成 add → dump-config → 启动 → 核心交互 → 重启 → 历史验证 → remove。测试 profile、端口、DSH home 和模型 fixture 与用户环境隔离。

## 调试顺序

### 插件完全不启动

1. `--dump-config` 是否出现配置行。
2. patch 的 `id/name` 是否正确。
3. 模块能否从 profile 的依赖目录解析。
4. Config schema 是否拒绝配置。
5. `inject` 服务是否存在；若长期 PENDING，检查服务名而非调整文件顺序。

### Host 正常但页面没有出现

1. package 是否有 `dsh.client.platform: web`。
2. 是否导出 `./client`，tarball 是否包含 `lib/client.js`。
3. `/plugins/<id>/client.js` 是否 200。
4. ModuleLoader factory 格式是否正确。
5. external 是否能由基座或动态 provider 精确满足。
6. Client 的 Cordis `inject` 是否等待不存在的服务或 slot。

### 页面出现但数据不更新

1. Remote 是否在 Host 注册相同 namespace。
2. wire schema 与运行值是否一致。
3. 订阅 disposer 是否存活，HMR 后是否重复。
4. 客户端 store 是否产生新 snapshot。
5. 轮询/stream 在切页和断线后是否重建。

### 任务卡住或无法取消

1. AbortSignal 是否传到底层模型、网络与子进程。
2. 是否先提交 durable terminal 再处理晚到返回。
3. node 是否忘记 `await`，产生 detached task。
4. dispose 是否等待 tasks/mutations 彻底落稳。
5. 队列 admission 与插件卸载是否存在竞态。

## 确定性模型 fixture

测试模型只返回固定 tool call / 文本，用于验证 Agent 工具链和脚本执行，不证明真实模型质量。测试中必须明确：

- 模型 adapter 是 fixture，不打包进生产。
- 权限配置只对已知测试脚本开放。
- 不调用用户真实网关，不消费真实凭据。
- 会话标题等后台模型调用要与业务响应区分，避免 fixture 次序被意外消耗。

## 观察什么

- Loader：解析、PENDING、Config 校验和 dispose 日志。
- Remote：方法名、rpcId、入参摘要、错误码、耗时；不记录 secret。
- Workflow：run/node/attempt id、状态变更、取消原因、输出大小。
- Browser：模块加载图、网络请求、console error、重复 React/Context。
- Storage：重启前后状态、schema 兼容、损坏记录隔离。

## 一套可复用的验收基线

执行 `npm ci && npm run build && npm test && npm run pack`；随后在与目标 SDK 匹配的官方 CLI、Node 24 和隔离 profile 中验证页面、任务创建、真实工具调用、子进程、评审、重启保留历史与卸载。确定性模型 fixture 只能证明调用链，真实外部模型质量需要单独联调。
