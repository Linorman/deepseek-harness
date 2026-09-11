# Agent Note: GPT-6 Astra 贡献者指令

Status: implemented

[English](2026-09-05-astra-agent-instructions.md) | 中文

## Problem

贡献者工作流若要求单独提供范围参数、只回复待命消息，或等待用户并未保留的选择，就可能中断已获授权的工作。宽泛的审计流程也可能把局部 Markdown 编辑扩展为远端 PR（Pull Request）查询或无关的编译器检查。对于严格遵循 skill（技能）措辞的模型，指令冲突的影响尤其明显。

## Decision

[根指令](../../../../AGENTS.md#agent-workflow-gpt-6-astra)根据 2026-09-05 查阅的[官方 GPT-6 Astra 提示指南](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-6-astra#prompting-best-practices)调整贡献者行为，规定完成任务、沿用授权、从上下文确定范围、有界委派、简洁沟通和相关验证。系统与开发者指令仍具有优先权；用户指令优先于 skill 指导。

专门工作流界定适用操作。文字编辑 skill 推断请求范围，不擅自扩展为文档集审计。动画审计请求保持只读，规划请求直接产出有依据的计划，不插入选择确认；明确的实现请求通过相应动画 skill 继续执行。除非用户已授权代选，原型集成仍需用户选择。审查格式根据发现的问题和用户要求调整。

文档编辑保留 doc-sync（文档同步门禁）与空白检查。代码、JSDoc 或 lint 配置发生变化时执行 lint；归档验证器实现变化时运行其测试。贡献者指令编辑使用 skill 元数据与 Markdown 验证；产品可见提示仍须满足可运行示例快照要求。只有输入未变时才能复用已通过的验证证据。

仅显式调用的原型、库选择和动画审查 skill 在 Codex 元数据中设置 `policy.allow_implicit_invocation: false`，依照[官方 skill 策略](https://developers.openai.com/codex/skills/#optional-metadata)，与既有 frontmatter 及描述保持一致。

本策略补充[常规翻译决策](2026-08-08-lightweight-routine-documentation-translation.zh.md)和[显式变更范围报告](2026-07-27-explicit-change-scope-report.zh.md)。两者继续有效：常规翻译仍由当前 agent（智能体）直接完成，使用范围报告命令时仍须提供已验证的基准。没有既有决策被完全替代。这些指令约束贡献者，不选择运行时 provider、不更改模型默认值，也不迁移 Clocky 的 API 请求。

## Alternatives considered

**将完整模型指南复制到每个 skill。** 重复内容增加上下文开销，也让共用规则出现多个维护位置。根指令负责共同行为，skill 只保留特定任务的决策。

**移除所有暂停和检查。** 这会丢失只读审查范围、用户有意保留的原型选择、外部操作授权与必要验证。自主执行仅适用于任务已有授权。

**只增加根级覆盖规则。** 局部停止指令冲突与调用元数据不一致仍然存在。负责该流程的 skill 必须直接表达预期工作方式。

## Consequences

贡献者可以减少普通工作中的流程性中断，同时保留项目特有的不变量和发布保护。可选建议减少格式与编排开销。仅显式调用的 skill 仍可按需使用。

元数据与 Markdown 检查能证明结构一致，不能证明模型遵从。行为改善需要观察有代表性的 Astra 会话；本记录不宣称已执行真实模型评估。未来模型更新适合触发有针对性的指令审计，不能由本记录推导出运行时迁移任务。
