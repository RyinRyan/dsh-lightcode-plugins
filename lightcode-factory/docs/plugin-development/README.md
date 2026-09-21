# DSH Plugin Bundle 开发手册

这套材料服务于第一次接触 DSH、Cordis 和双端插件的人，也服务于需要根据原始需求快速产出 plugin bundle 的 Agent。课程基线是 DSH `0.1.5-rc.2`、Cordis `4.0.2`、Node `24`；相邻版本不可直接视为兼容。

## 从哪里开始

- 想先建立整体认识：运行 `npm run docs:serve`，打开终端显示的地址。
- 想开发纯后端能力：读 [后台服务](04-backend-service.md)。
- 想开发 DSH Web 页面：读 [Web 前台](03-web-client.md)。
- 想交付一个可安装包：读 [打包与依赖](05-packaging-and-dependencies.md)。
- 已经报错或行为不符合预期：读 [调试与测试](06-debugging-and-testing.md) 和 [踩坑手册](07-pitfalls.md)。
- 想让 Agent 根据需求直接开工：把 [Agent 开发协议](08-agent-playbook.md) 作为任务约束。

## 文档地图

| 文档 | 回答的问题 | 产出 |
| --- | --- | --- |
| [Cordis 基础](01-cordis-foundations.md) | 插件、Context、Service、inject、effect 是什么？ | 正确的生命周期心智模型 |
| [DSH 插件原理与分类](02-plugin-model-and-types.md) | 应该写工具、Hook、Service、Web UI 还是 Bundle？ | 插件形态选择 |
| [Web 前台](03-web-client.md) | 浏览器代码怎样加载、怎样访问后台？ | `lib/client.js` 与 UI 注册 |
| [后台服务](04-backend-service.md) | 如何提供服务、持久化、执行任务和处理取消？ | Host 插件与稳定服务协议 |
| [打包与依赖](05-packaging-and-dependencies.md) | npm 依赖放哪、bundle 怎样安装？ | `.tgz` plugin bundle |
| [调试与测试](06-debugging-and-testing.md) | 如何分层验证、怎样定位 PENDING/404/重复 React？ | 可重复的调测闭环 |
| [踩坑手册](07-pitfalls.md) | 本次实现中哪些做法曾失败，为什么？ | 症状到根因的排障表 |
| [Agent 开发协议](08-agent-playbook.md) | 如何把一段业务需求变成可验收的 bundle？ | 可直接复用的实现流程 |

## 一个典型双端插件的组成

```text
my-product-bundle                 安装入口 / bundle
├─ my-backend                     Host：状态、调度、存储、Remote
├─ my-web                         Host + Client：页面挂载与 UI
└─ my-workflow                    Host：业务工作流注册与执行
```

这不是所有插件都必须采用的拆分。单一工具通常只需一个包；只有当后台协议、Web 页面、业务实现需要独立演进时才拆开。

## 完成定义

一个 plugin bundle 只有同时满足以下条件才算完成：

1. 使用固定 DSH/Cordis 版本构建和验证。
2. 所有 `inject`、Remote schema、输入输出 schema 和配置 schema 都有明确契约。
3. Host、Client、业务插件的依赖方向单向且无重复运行时。
4. `npm ci && npm run build && npm test && npm run pack` 全部通过。
5. 在隔离 profile 中完成 add、dump-config、启动、核心交互、重启和 remove 验证。
6. 文档写明安全边界、持久化位置、取消行为、已知限制与升级策略。
