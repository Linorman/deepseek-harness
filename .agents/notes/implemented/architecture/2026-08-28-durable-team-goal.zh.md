# Agent Note: 持久 Team Goal

Status: implemented

[English](2026-08-28-durable-team-goal.md) | 中文

## Problem

一个 Team 可以超出任何特定 Session、Participant activation、task attempt 或 scheduler process 的生命周期。仅把 objective 复制到 Team header 会丢失 policy 和 recovery 所需的 revision fence、blocked 说明和 Goal 专用 budget。复用 same-session Goal 则会把共享工作绑定到一个 Session 的日志、continuation round 和 process-local activation。

## Decision

Team journal 拥有一个带 revision 的 `TeamGoalSnapshot`。`team/created`携带完整的 revision-one active Goal，包括 Team id、objective 和 Goal 专用 budget。`goal/changed`携带完整的 mutation 后值。Hub 比较 `expectedRevision`，通过 `goal-mutate`授权 definition 与 phase change，并且只在该值成功 fold 后追加。

Goal replay 要求封闭它的 Team id、创建时 revision 为一、之后 revision 每次连续递增一、允许的 phase edge、非空且规范化的 objective、JSON-object budget，以及仅在 phase 为 `blocked`时存在的 blocker。Goal phase 为 `active`、`paused`、`blocked`和 `complete`；Team failure 和 cancellation 仍是 Team lifecycle fact。checkpoint 在 Team summary 和 direct state projection 中都保留当前 Goal，recovery 会拒绝不一致的值。

`tool-team-goal`是唯一已发布的 model Consumer。它将 `get_goal`和仅编辑 objective 的 `update_goal`限定给准确、live 的默认 TeamRun coordinator。一次 edit 要求当前可信 human direct-v3 Envelope；TeamRun 从 coordinator lease 派生 activation actor，Hub 会重新检查该准确 binding。Goal round、phase mutation、Agent activation、task dispatch 与 scheduler wake 都不属于这些 tool。

## Alternatives considered

**复用 same-session Goal domain。** 不予采纳，因为它的 Session ownership、continuation round budget 和 process-local activation 不能描述拥有独立 Participant 和生命周期的 Team。

**只在 Team creation 中存储 objective string。** 不予采纳，因为 policy 和 recovery 会缺少 compare-and-set identity、blocked 说明和可变 Goal budget。

**追加部分 Goal field。** 不予采纳，因为严格 replay 和 checkpoint validation 需要每项已接收 mutation 的一个完整 current value。

## Consequences

当前 Team journal 使用 format 12，checkpoint 使用 format 13；channel format 保持独立，unsupported format 会被拒绝。[本地 Team Hub 决策](2026-08-27-local-team-hub-durable-authority.zh.md)仍拥有 stream ownership 和 recovery；[原生多 agent 工作系统提案](../../proposed/architecture/2026-08-27-native-multi-agent-work-system.zh.md)仍为 proposed。

## Verification

Core 测试覆盖严格的 Goal parser、revision fence、phase edge 和 blocker rule。Hub 测试覆盖完整值 journal fold、错误的初始和变更 Goal、checkpoint 一致性、policy deny、stale revision、持久 restart、提交后 Goal notification invariant 及 activation fence。TeamRun 与 tool 测试覆盖 scope 内 human-Envelope authorization path。Hub source 保持每文件 100% coverage。
