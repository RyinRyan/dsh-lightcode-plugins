# 08 · 测试、调试与验收

不要直接打开完整 Web 后凭感觉排查。按层证明，每层只回答一个问题。

## 六层测试梯

### 1. 类型与 Schema

```powershell
npm run typecheck
```

验证 Context 声明、Config、wire schema、Host/Client import 边界和 project references。

### 2. Service 与状态机

使用最小 Cordis Context 测试：注册/注销、状态转换、重复 id、幂等、取消竞态、超限、存储失败、启动恢复和 dispose drain。

### 3. Loader 组合

加载真实 patch 与插件组合，使用确定性 model/tool/storage fixture，证明 `inject`、配置、Agent/Tool/Process 组合与生产一致。

### 4. UI 组件

jsdom 中传真实 props，验证用户可见行为、a11y name、命令参数、loading/empty/error/disconnected 和重复点击。

### 5. 构建与 Tarball

检查 `lib/index.js`、`lib/client.js`、types、exports、files、依赖闭包、绝对路径和重复运行时。源码测试通过但 tarball 缺 Client 是高频问题。

### 6. 隔离 Profile E2E

```text
create isolated home/profile
  → add tarball
  → dump-config
  → start
  → core interaction
  → cancel/error path
  → restart/history
  → update
  → remove
```

测试 profile、端口、DSH home、存储和 model fixture 与用户真实环境隔离。

## 按症状定位

### 插件 PENDING/完全不启动

1. dump-config 是否有正确 `id/name/config`。
2. 包能否从 profile 的依赖目录解析。
3. Config 是否校验失败。
4. `inject` 的 service key 是否真实存在且端面正确。
5. provider 是否因更早错误没有激活。

### Host 正常但页面没有出现

1. manifest 有无 `dsh.client.platform: web`。
2. 是否公开 `./client` export。
3. tarball/profile 中是否实际存在 `lib/client.js`。
4. `/plugins/<id>/client.js` 是否返回 200。
5. Browser ModuleLoader/external 是否解析成功。
6. Client `inject` 与 slot 名是否正确。

### 页面出现但没有数据

1. Remote namespace 和方法是否两端一致。
2. wire runtime schema 是否拒绝数据。
3. Client store 是否提交新 snapshot。
4. event/轮询 subscription 是否已 dispose 或重复。
5. 错误是否被吞掉并误显示为 loading。

### 任务卡住或取消失败

1. 是否漏 `await` 导致 detached work。
2. signal 是否真正传到 Agent、fetch、工具和进程。
3. 取消是否先持久化终态。
4. 晚到结果提交前是否再次检查终态。
5. dispose 是否等待 active tasks 和 mutation。

### 安装后仍是旧页面

1. 源码是否已重新 build。
2. tarball 是否包含新 `client.js`。
3. 版本号是否提升，profile manifest/lockfile 指向哪个包。
4. 是否仍有旧 DSH 进程占用端口和已加载模块。
5. Browser 是否需要强制刷新；不要用刷新掩盖服务端仍是旧版本。

## 确定性 Fixture 的边界

fixture model/tool 可验证协议、工具调用、观测和执行链，但不证明真实模型质量。必须：

- 不打进生产 bundle。
- 不读取用户真实 credential。
- 只对已知测试文件/进程开放权限。
- 记录哪些结论来自 fixture，哪些经过真实外部集成验证。

## 可观测性

- Loader：解析、PENDING、Config 和 dispose。
- Remote：requestId、方法、状态、耗时、大小；不记录 secret。
- Runtime：run/node/attempt、状态转换、取消原因、输出限制。
- Browser：plugin request、module graph、console、重复 React/Context。
- Storage：revision、schema version、重启前后状态、损坏记录隔离。

## 验收报告模板

```markdown
版本：DSH CLI / SDK / Cordis / Node / OS
产物：tarball 名称、大小、SHA256
自动测试：typecheck、unit、composition、UI
安装测试：add、dump-config、启动 URL、核心路径
韧性测试：取消、错误、重启、历史、更新、卸载
安全检查：secret、权限、sandbox、路径、安装脚本
未验证：真实模型质量、其他 OS、其他 DSH 版本……
```
