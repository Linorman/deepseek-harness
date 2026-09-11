# Agent Note: Versioned Team channel protocols

Status: implemented

[English](2026-08-30-versioned-team-channel-protocols.md) | 中文

## Problem

Team Hub 已经拥有持久 Envelope 以及 direct/task-assignment 适配器，但还没有有界 consult、多方 discussion 或声明式 handoff 的原生协议。如果把终止交给各个 Consumer，已完成的对话可能会以 active channel 的状态持久化。

## Decision

`@clocky/clocky-team-channel-basic` 注册 v1 `consult` 和 `discussion` 适配器。Consult 固定一个 initiator 和一个 respondent，严格接受一次 request 后一次 response，并在接纳 response 时请求 Hub 追加关闭记录。Discussion 固定有序 roster、显式的 `round-robin` 或 `free-form` speaker policy 以及必需的 `maxTurns` 上限。其 delivery plan 只会将显式 audience 或 `null` 广播展开为其他 roster 成员。

`@clocky/clocky-team-channel-workflow` 注册 v1 workflow 适配器。其 JSON `TransitionGraph` 会在通道创建前校验有序 condition、抽象 target、participant membership 和硬性轮次上限。回放针对已接纳的 Envelope 计算第一个匹配的 condition，并确定性地解析 `participant`、`round-robin`、`stay`、`return-to-initiator` 和 `terminate` target。

Workflow 包挂载 effect-scoped 的 `ctx.workflowExtensions` registry。带版本的 condition 和 target implementation 会在 graph admission 前校验 JSON config，只能通过适配器的纯 resolver 执行；准确实现不可用时会明确失败，extension 也不能返回 channel roster 之外的 participant。

`TeamChannelAdapter.closeAfterAccept()` 是可选能力。当它返回 reason 时，`TeamHub` 会在与 Envelope 和 adapter record 相同的 channel-WAL batch 中追加 `closing` 及终态 `closed` 记录。现有适配器省略该 hook，因此保持既有生命周期。

## Alternatives considered

**让所有协议都成为 direct channel 的变体。** 不采纳，因为 direct channel 有意不拥有 speaker state、turn cap 或协议终止；加入这些职责会使产品适配器含义不清。

**由 Consumer 在稍后操作中关闭已完成通道。** 不采纳，因为 Envelope 接纳与关闭之间发生崩溃时，协议持久状态会与生命周期不一致。

**导入第三方 GroupChat 实现。** 不采纳，因为其进程内可变 manager 无法提供 Hub 的持久回放、带品牌身份、策略边界或 Cordis 注册生命周期。

## Consequences

Channel adapter 保持同步、纯函数式并独立版本化。Hub 拥有原子生命周期持久化；Link 和 Agent Client Consumer 仍负责投递、receipt 和模型执行。Workflow graph 是持久数据，回放必须保留准确的 adapter 版本。

## 验证

Workflow 测试覆盖 condition／target resolution、graph 与 state rejection、terminal transition 以及 effect-scoped extension registry。Registry 测试证明重复和 malformed extension rejection、按 registration order 列表、准确 lookup、add／remove event 与幂等 disposal。组装后的 Team snapshot suite 覆盖 workflow-plan compilation 与 restart reconstruction。

TypeScript 与 Python SDK 子进程测试使用同一份[channel-view wire 测试集](../../../../packages/sdk/protocol/tests/fixtures/team-channel-view-cases.json)。它们保留合法内容和可选 review provenance 的原值，并拒绝缺失 surface marker、可忽略的 view、无效版本、重复或错序的来源标识，以及格式错误的可选权限字段。Session 重放测试还保留仅属于频道的上下文，不凭空添加任务、回复或 review provenance。
