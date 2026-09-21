# {{WORKFLOW_NAME}} Workflow 设计

- Workflow ID: `{{WORKFLOW_ID}}`
- 承载方式: [填写：Catalog `packages/workflows/src/catalog/{{WORKFLOW_ID}}/` / 独立 Host 包]
- 设计状态: 草稿
- 底座适配类型: [填写：普通 Workflow / 平台能力扩展]

## 1. 需求与目标

[填写：用户问题、触发方式、最终可观察结果和成功标准。]

## 2. 底座适配结论

[填写：说明现有参数、顺序节点、输出、观测、统一页面、取消、评审和一次性定时接纳是否足够。若不够，列出平台缺口和影响范围；说明为何选择 Catalog 或独立包。]

## 3. 输入参数

| name | 页面标签 | 必填 | 默认值 | 业务校验 | 安全说明 |
| --- | --- | --- | --- | --- | --- |
| [填写] | [填写] | [是/否] | [填写] | [填写] | [确认不包含凭据] |

## 4. 节点与执行顺序

| 顺序 | node id | 用户可见名称 | 职责 | 输入来源 | 取消点 | 失败语义 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | [填写] | [填写] | [填写] | [填写] | [填写] | [填写] |

## 5. 输出与页面映射

| node id | output shape | 运行详情展示 | renderer/回退 | artifact 策略 |
| --- | --- | --- | --- | --- |
| [填写] | [填写 JSON 结构] | [填写] | [通用 JSON 或已验证语义] | [填写] |

## 6. 观测设计

| node id | observation kind | title/detail 摘要 | callId/sessionId | 轨迹用途 |
| --- | --- | --- | --- | --- |
| [填写] | [填写] | [填写] | [填写或不适用] | [填写] |

## 7. 状态、失败与取消

[填写：正常路径、错误传播、超时、取消信号传递、评审和终态。若用户可选定时，说明其复用 Runtime `scheduledFor`，不由 Workflow 建 timer 或恢复计划。]

## 8. 安全与数据边界

[填写：credential 获取方式、日志/观测脱敏、输出大小、artifact 目录、子进程或网络权限。]

## 9. 依赖与配置

[填写：公开宿主服务、模型/工具/API/子进程依赖、非敏感配置和默认行为。]

## 10. Workspace 与 Bundle 接线

[填写：若为 Catalog，填写目录、Catalog 注册、配置和测试；若为独立包，填写 manifest、TypeScript references、build、pack、Factory dependencies、bundleDependencies、patch 和 lockfile。]

## 11. 测试与验收

[填写：节点单测、真实 Runtime/Storage/Loader 组合、disposer、参数、成功、失败/取消、评审；按影响范围补充定时接纳、页面节点切换、轨迹、tarball 和隔离安装。]

## 12. 文档同步

[填写：将更新对应设计、architecture、README 和哪些 Skill references；对检查过但不更新的候选文档说明理由。]

## 13. 限制与非目标

[填写：当前明确不支持或本次不实现的能力。]

## 14. 设计自检

- [ ] 所有用户目标都有节点或输出承接。
- [ ] 需求可由当前底座表达，或已明确列出平台扩展并取得授权。
- [ ] Workflow 选择了 Catalog 或独立 Host 包，不需要专属 Browser Client。
- [ ] 节点声明、执行顺序和页面顺序一致。
- [ ] 每个 output 都是有界 JSON-safe 数据或 artifact 引用。
- [ ] 运行详情只显示节点结果，内部过程只进入轨迹。
- [ ] 页面无需按 Workflow id、包名或节点名称增加特例。
- [ ] 参数、输出和观测均不包含 credential。
- [ ] 取消信号、错误和资源释放路径明确。
- [ ] Catalog 或独立包所需的 workspace、Bundle、测试、打包和隔离验收接线完整。
- [ ] 相关 architecture、README 和 Skill 文档的同步范围与理由完整。
