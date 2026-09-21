# {{CHANGE_NAME}} 设计

- Change ID: `{{CHANGE_ID}}`
- 变更类型: `{{CHANGE_TYPE}}`
- 影响组件: [填写：contracts / runtime / storage / workflows / web / factory，可多选]
- 设计状态: 草稿

## 1. 需求与成功标准

[填写：用户可观察问题、目标、非目标和可验收结果。]

## 2. 组件选择与职责边界

[填写：为何选择这些组件；为何不应放在其他组件；跨层时的契约演进顺序。]

## 3. 当前实现证据

[填写：当前源码、公开类型、runtime/wire/storage schema、测试和页面行为。不要引用旧快照代替当前证据。]

## 4. 目标契约与数据流

[填写：新增或变化的类型、命令、数据流、输入输出及调用方向。]

## 5. 状态、并发与生命周期

[填写：状态所有者、合法转换、mutation 顺序、取消、失败、卸载、停止、重启和晚到结果。纯 Web 变更说明为何不影响状态。]

## 6. 持久化、Remote 与兼容性

[填写：数据版本、runtime schema、wire schema、Workflow/Browser 的迁移或破坏性策略。]

## 7. Web 与交互

[填写：页面信息架构、通用 renderer/回退、轨迹、分页、可访问性和响应式影响；纯 Runtime 变更说明 Browser 影响。]

## 8. 安全与数据边界

[填写：credential、权限、敏感信息、输出/日志限制、artifact 和错误暴露。]

## 9. 实现与接线计划

[填写：按依赖顺序列出包、文件、测试、build/pack/Bundle/lockfile 接线。]

## 10. 测试与验收

[填写：单元、真实组合、竞态、schema/Remote、Browser、构建、tarball 和隔离 DSH 验收。]

## 11. 文档同步

[填写：将更新 AGENTS、architecture、README、设计和哪些 Skill references；对检查过但不更新的候选文档说明理由。]

## 12. 风险、限制与回滚

[填写：已知限制、发布风险、数据风险、回滚/降级方式和未验证项。]

## 13. 设计自检

- [ ] 当前实现证据来自本 checkout 的源码和测试。
- [ ] 组件选择正确，没有把业务特例放入 Runtime/Web。
- [ ] Runtime 仍是 durable run 状态的唯一决策者。
- [ ] 类型、storage schema、wire schema 与调用方影响已覆盖。
- [ ] 数据迁移或破坏性策略明确。
- [ ] 取消、失败、卸载、停止、重启和竞态已分析。
- [ ] Web 有通用回退、可访问性和无业务特例保证。
- [ ] 安全、凭据、日志/输出边界明确。
- [ ] 测试、构建、Bundle 和真实验收范围完整。
- [ ] 文档同步清单与无需更新的理由完整。
