# Contracts / Runtime / Storage / Web 变更设计门禁

Contracts、Runtime、Storage、Web 或跨组件变更必须在编码前创建 `.design/changes/<change-id>.md`。设计要证明职责放置正确、状态只有一个所有者，并明确迁移、文档和验证影响。

## 1. 创建

```powershell
node .claude/skills/lightcode-factory-develop/scripts/init-factory-change.mjs <change-id> "<变更名称>" <runtime|storage|web|cross-cutting> .
```

`change-id` 使用稳定 kebab-case。脚本拒绝覆盖已有设计。仅修改 Workflow 时继续使用 `.design/workflows/` 模板。

## 2. 设计必须回答

1. 用户可观察问题和成功标准是什么？
2. 为什么选择 Contracts、Runtime、Storage、Web 或跨组件，而不是 Workflow？
3. 当前代码路径、类型/schema、状态和页面行为是什么？
4. 目标契约、数据流、状态所有者和失败/取消语义是什么？
5. 对 Workflow、持久化数据、Remote 和 UI 有何迁移或破坏性影响？
6. 需要修改哪些包、文件、构建/Bundle 接线？
7. 哪些单测、组合测试、Browser 验收和安装验收能证明它？
8. 哪些文档必须刷新；不修改某份候选文档的理由是什么？

## 3. 继续条件

Agent 完成模板自检并运行：

```powershell
node .claude/skills/lightcode-factory-develop/scripts/audit-lightcode-workflow.mjs . --design .design/changes/<change-id>.md --docs
```

脚本只检查结构和本地文档变更，不替代语义评审。存在未决产品选择、破坏兼容、数据迁移、凭据输入、权限扩大或 DSH 未验证接口时，应先请求用户决定。

实现过程中契约、状态、组件范围、兼容策略或验证计划变化时，先刷新设计，再继续编码。完成时将设计状态改为“已实现并验证”，并记录实际命令、结果和未验证项。
