# 04 · DSH Web 页面开发

Web 页面运行在 Browser Cordis Context 中，不是 Host 插件的“另一个文件夹”。它有独立的模块图、入口、依赖、生命周期和构建产物。

## 最小双端目录

```text
task-web/
├─ package.json
├─ src/
│  ├─ index.ts                    # Host face，可为空或注册 Host 能力
│  └─ client/
│     ├─ index.ts                 # Browser apply/inject
│     ├─ TaskPanel.tsx            # 纯 props 组件
│     ├─ TaskPanel.module.css
│     └─ locales.ts
└─ lib/
   ├─ index.js
   ├─ client.js
   └─ types/
```

## package.json

```json
{
  "name": "task-web",
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/types/index.d.ts",
  "exports": {
    ".": { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
    "./client": { "types": "./lib/types/client/index.d.ts", "default": "./lib/client.js" }
  },
  "files": ["lib/index.js", "lib/client.js", "lib/types"],
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

`dsh.client.inject` 描述包级 Browser 依赖图；Client 入口导出的 Cordis `inject` 决定插件实际何时激活。两者都要正确。

## 加载链路

```text
Host Loader 行启用 task-web
  → 扫描 package.dsh.client
  → 暴露 /plugins/<id>/client.js
  → Browser ModuleLoader 执行 factory
  → 解析 external
  → 等待 Client inject
  → apply 注册 sidebar/slot/panel/store
```

生产加载的是 `lib/client.js`，不是 `src/client`。源码已改但页面不变时，先检查 build、tarball 和 profile 中实际安装的版本。

## 组件边界

- `ctx` 停留在 Client `apply` 和注入层，业务组件通过 props 接收数据、命令和翻译。
- 页面组合通过 DSH slots/renderer 注册，不直接 import 另一个业务插件的 React 组件。
- Client Store 保存筛选、选中、草稿等交互状态；业务事实来自 Host snapshot/event。
- 所有可见文案通过 locale；稳定 id、wire enum 和存储值不本地化。
- CSS Modules 优先使用宿主语义 token；自定义 style 注入要有稳定 key 并可清理。
- React、Cordis 和 DSH Client 基座必须来自宿主唯一实例。

## 页面状态必须完整

至少实现：

```text
initial/loading
ready + empty
ready + data
refreshing（保留旧数据）
recoverable error + retry
command pending/disabled
permission denied
disconnected/reconnecting（若使用 stream）
```

不要让 Remote 异常永远停留在 loading；不要在命令执行中允许重复提交。

## 数据更新

- 简单、低频：轮询 snapshot。
- 中频：Host 发布事件，Client 收到后重新拉 snapshot。
- 高频流式：增量事件 + sequence/revision + 断线补拉。

流式协议必须说明顺序、重复、缺口、重连和取消；否则宁可先轮询。

## UI 测试

在 jsdom 中直接传真实形状 props：

- 断言可见文本、可访问名称、按钮状态和命令参数。
- 验证空态、错误态、慢请求和重复点击。
- 不断言 CSS module hash 或 React 内部结构。
- 单独测试 store 的订阅与 disposer，避免 HMR 后重复更新。

## 页面不出现时的固定排查顺序

1. `dsh --profile <name> --dump-config` 是否启用了 Host 行。
2. manifest 是否声明 `dsh.client.platform: web`。
3. `exports["./client"]` 和 `files` 是否指向真实产物。
4. tarball 内是否有 `lib/client.js`。
5. `/plugins/<id>/client.js` 是否返回 200。
6. Browser console 是否提示 ModuleLoader/external 失败。
7. Client `inject` 是否等待不存在的 service/slot。
8. slot 注册是否使用目标 DSH 版本的正确名称。
