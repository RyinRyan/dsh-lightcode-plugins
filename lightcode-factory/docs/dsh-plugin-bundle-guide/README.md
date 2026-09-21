# DSH Plugin Bundle 独立开发指南

本手册用于指导开发者或编码 Agent 从一段原始需求出发，完成 DSH 插件的架构设计、Host 后台、Web 页面、前后台协议、依赖管理、构建打包、安装升级和调试验收。

本文档独立于任何具体业务实现。示例包统一使用以下中性名称：

```text
task-suite-workspace/        # 仅用于开发，不发布
├─ packages/task-runtime/    # Host Service、持久化、Remote
├─ packages/task-web/        # Host face + Browser Client
├─ packages/task-feature/    # Tool、Workflow 或业务能力
└─ packages/task-suite/      # 一键安装 Bundle
```

不要机械照搬四包结构：单一工具通常只需一个包；只有后台协议、Web 页面和业务插件需要独立演进时才拆包。

## 已验证版本基线

| 项目 | 版本/环境 |
| --- | --- |
| DSH CLI | `0.1.5-rc.1` |
| DSH SDK packages | `0.1.5-rc.2` |
| Cordis | `4.0.2` |
| Node.js | `24.11.0` |
| OS | Windows |

DSH 处于快速演进阶段。Service key、事件结构、Client loader、Remote 和 profile 行为都可能变化；其他版本必须重新核对源码、类型声明和真实安装行为。

## 阅读顺序

1. [需求到架构](01-requirements-and-architecture.md)：把原始需求翻译成插件边界。
2. [Cordis 与插件生命周期](02-cordis-and-lifecycle.md)：理解 `Context`、`Service`、`inject` 和 `effect`。
3. [后台服务](03-backend-service.md)：实现状态、执行、持久化和取消。
4. [Web 页面](04-web-client.md)：实现 Browser Client、Slot、Store 和样式。
5. [前后台协议](05-remote-contract.md)：设计可演进的 JSON wire contract。
6. [依赖与构建](06-dependencies-and-build.md)：避免重复 React/Cordis 和错误模块图。
7. [Bundle 打包安装](07-bundle-packaging-and-install.md)：生成真正可迁移的 `.tgz`。
8. [测试调试](08-testing-and-debugging.md)：按六层测试梯定位问题。
9. [踩坑手册](09-pitfalls.md)：从症状快速找到根因和修复方式。
10. [Agent 开发协议](10-agent-playbook.md)：直接附加到 Agent 的开发任务中。
11. [参考工程骨架](11-reference-scaffold.md)：按模板快速建立 workspace 和交付结构。

## 完成定义

一个插件套件只有满足下面条件才算完成：

- 固定并记录 DSH、SDK、Cordis、Node、OS 和包管理器版本。
- Config、Service、Remote、状态机、错误、取消和恢复语义均有契约。
- Host、Client、业务插件依赖方向单向，Browser bundle 没有第二份 React/Cordis。
- `typecheck → unit → composition → UI → build → pack` 全部通过。
- 检查真实 tarball 内容，并在隔离 DSH home/profile 中完成 add、dump-config、启动、核心交互、重启和 remove。
- 文档写明安全边界、数据位置、升级策略、fixture 范围与未实现能力。

## 三条底线

1. 不修改 DSH 核心来绕过公开扩展点。
2. 不把 credential、动态 token、主机权限或可信执行能力放进 Browser Client。
3. 未在目标版本验证过的接口和能力不能声明为“支持”。
