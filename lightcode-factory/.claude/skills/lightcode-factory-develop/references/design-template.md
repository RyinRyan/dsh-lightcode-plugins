# 设计门禁：代码前先证明可插拔

设计文档的作用不是复述需求，而是证明这个业务可以在现有 Factory 底座上正确运行、展示、观测、取消和交付。

## 1. 文件与创建方式

每个 Workflow 使用：

```text
.design/workflows/<workflow-id>.md
```

`workflow-id` 必须是稳定的 kebab-case。优先从模板创建：

```powershell
node .claude/skills/lightcode-factory-develop/scripts/init-workflow-design.mjs <workflow-id> "<工作流名称>" .
```

若脚本不可用，复制 `templates/workflow-design.md`。不得覆盖已有设计；修改现有 Workflow 时直接更新原设计。

## 2. 从原始需求提炼设计

Agent 必须把原始描述转成以下内容：

1. 用户最终想获得的可观察结果；
2. 创建任务时真正需要的非敏感输入；
3. 可以被用户理解的节点，而不是代码函数或底层 API 步骤；
4. 每个节点的输入来源和 JSON-safe 输出；
5. 哪些是最终结果，哪些是模型/工具/进程内部过程；
6. 每个可阻塞动作的取消点、超时和失败表现；
7. 页面如何使用通用 renderer 或 JSON 回退显示输出；
8. 插件需要的宿主服务、配置和 artifact；
9. 接入 workspace/Bundle 的完整影响；
10. 可重复执行的测试和真实验收场景。
11. 需要刷新的 architecture、README、Skill reference，以及无需更新的候选文档和理由。

节点应按用户可理解的阶段划分。不要把一个模型调用拆成“准备 prompt、发送 HTTP、解析 JSON”三个业务节点，也不要把多个具有独立结果和失败语义的阶段塞进一个巨大节点。

## 3. 底座适配判定

设计必须明确选择其一：

- `普通 Workflow`：不修改 Contracts、Runtime、Web 或 DSH Core；
- `平台能力扩展`：列出当前公开契约无法表达的内容、影响包和迁移策略。

若是平台能力扩展，必须解释为什么不能通过参数、顺序节点、结构化输出、observation 或 artifact 解决。用户未授权扩大范围时，Agent 在设计阶段停止。

## 4. 页面映射必须逐节点写清楚

对每个节点记录：

| 字段 | 必须回答的问题 |
| --- | --- |
| output shape | 返回哪些字段，是否 JSON-safe、有界 |
| 运行详情 | 用户点击该节点后看到什么 |
| observation | 内部模型、工具、进程或业务事实如何记录 |
| 轨迹 | 哪些记录可搜索、按 callId/sessionId 关联 |
| artifact | 大结果是否改为引用，用户如何识别 |

如果依赖增强 renderer，必须先从当前 Web 源码确认字段契约。否则使用通用 JSON 回退，不得假设页面会理解自创字段。

## 5. 自检和继续条件

设计完成后逐项勾选模板中的检查项，并运行：

```powershell
node .claude/skills/lightcode-factory-develop/scripts/audit-lightcode-workflow.mjs . --design .design/workflows/<workflow-id>.md
```

脚本只检查结构完整性，不能替代语义判断。Agent 还必须确认：

- 所有用户目标都有节点或输出承接；
- 所有声明节点都有明确执行和测试方案；
- 页面无需 Workflow 专属分支；
- output 和 observation 没有职责混淆；
- credential 不会进入 run；
- 取消信号能到达最底层；
- 失败时用户能从统一页面理解原因；
- 接线和验收没有遗漏。

用户只要求设计时，提交设计供审核并停止。用户要求实现时：普通 Workflow 在自检通过后继续；关键产品选择缺失或涉及平台能力扩展时，先让用户决定。

## 6. 设计必须持续同步

以下变化必须先更新设计，再更新代码：

- 参数、默认值或校验语义；
- 节点数量、顺序、名称或职责；
- output shape 或 renderer 选择；
- observation kind、callId/sessionId 关联；
- 失败、取消、超时或 artifact 策略；
- 新增宿主依赖、配置或 Bundle 接线。
- 用户能力、组件边界、页面语义、已知限制或验证范围。

最终交付时，设计状态应为“已实现并验证”，并记录实际验证结果和文档同步结果，而不是保留预测性描述。
