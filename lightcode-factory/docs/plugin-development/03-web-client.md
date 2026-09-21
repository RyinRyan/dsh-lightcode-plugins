# 03 · Web 前台插件开发

DSH Web 页面不是把 React 代码塞进 Host 包后自动出现。一个双端包必须同时交付 Host 入口和浏览器 `./client` 入口，并通过 `package.json` 的 `dsh.client` 描述浏览器 bundle 如何加载。

## 最小目录

```text
my-web-plugin/
├─ package.json
├─ src/
│  ├─ index.ts                 # Host face，可为空插件或注册 Remote
│  └─ client/
│     ├─ index.ts              # Browser apply/inject
│     ├─ FeaturePanel.tsx      # 纯 props 组件
│     └─ FeaturePanel.module.css
└─ lib/
   ├─ index.js
   ├─ client.js
   └─ types/
```

## package.json 的关键声明

```json
{
  "main": "lib/index.js",
  "exports": {
    ".": { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
    "./client": { "types": "./lib/types/client/index.d.ts", "default": "./lib/client.js" }
  },
  "files": ["lib/index.js", "lib/client.js", "lib/types"],
  "dsh": {
    "client": {
      "platform": "web",
      "inject": ["@deepseek-ai/dsh-client-ui-slots"]
    }
  }
}
```

`dsh.client.inject` 是包级浏览器图的说明信息；真正的 Cordis 激活顺序仍由客户端入口导出的 Service `inject` 决定。不要把两者混为一谈。

## 浏览器加载链路

```text
已启用的 Loader 行
  → Host 扫描 dsh.client manifest
  → /plugins/<id>/client.js
  → ModuleLoader 注册 factory
  → 解析 external 模块
  → Client Cordis 等待 inject
  → apply 注册 slot / store / renderer
```

生产环境读取的是构建后的 `lib/client.js`，不是 `src/client`。页面没更新时，第一件事是重新构建并确认包内确实包含该文件。

## UI 组件纪律

1. `ctx` 只出现在 client `apply` 和注入工厂里，不传进 React 业务组件。
2. 组件通过 props 接收数据、回调、翻译和 store 视图。
3. 页面组合通过 slots 注册，不直接 import 另一个业务插件的组件。
4. 共享 UI 运行时由宿主提供；React、Cordis 等必须 external，避免第二份实例。
5. 所有用户可见文本走 locale 字典；wire 数据和稳定 id 不要本地化。
6. 样式优先 CSS Modules，使用宿主语义 token；style 注入必须在 HMR/卸载时可回收。

## 前后台通信

浏览器只消费窄 Remote，不直接共享 Host 对象。建议把 wire schema 单独放在一个可被 Host 与 Client 类型引用的模块中：

```ts
export interface ReportRemote {
  snapshot(): Promise<ReportSnapshot>
  start(input: StartRequest): Promise<RunView>
  cancel(input: RunRequest): Promise<RunView>
}
```

要求：

- 入参、返回值和事件都必须可 JSON 序列化。
- schema 对未知字段、枚举值、数据量上限作出决定。
- UI 只获得展示需要的数据；凭据和私有路径不得出现在 wire 上。
- 轮询、SSE 或 stream 需要明确断线恢复和取消语义。

推荐将 `remote.ts` 作为前后端共享契约，Host 通过 Typert 注册，Client 挂载自己的命名空间；无需修改 DSH 内建 remotes。

## 状态管理

- 业务事实留在 Host 或领域对象层。
- Client store 只保存选择项、过滤器、草稿、面板宽度等 viewing/interaction state。
- Remote snapshot 必须可替换且可比较；订阅更新要避免每个 token/日志触发全页面重绘。
- 组件测试直接传 props，不依赖真实 Cordis Context。

## 最小验证

1. `lib/client.js` 存在，且没有打入第二份 React/Cordis。
2. `dsh.client` 的 `./client` export 与实际文件一致。
3. `dsh --profile <name> --dump-config` 能看到 Host 配置行。
4. 浏览器请求 `/plugins/<id>/client.js` 返回 200。
5. 侧栏/面板出现，HMR 后不重复，卸载后消失。
6. Remote 错误有明确空态/错误态，不能无限 loading。
