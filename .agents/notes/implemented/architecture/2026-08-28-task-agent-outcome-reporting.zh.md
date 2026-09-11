# Agent Note: Task Agent outcome reporting

Status: implemented

[English](2026-08-28-task-agent-outcome-reporting.md) | 中文

## Problem

task-assignment delivery 会启动 lease-backed attempt 并记录 model-visible instruction，但运行中的 Agent 需要一个安全的结果报告方式。若让模型工具用自由提供的 Team、Participant、activation 或 phase 值调用 Hub，stale 或无关 Agent 就能构造看似属于 owner 的请求。Hub settlement 成功后若响应或 Session result write 丢失，重试还会产生工具错误，尽管不可变 attempt outcome 已持久化。

## Decision

`@clocky/clocky-tool-team`只会在 Session header 命名 Team 与 Participant 的 Agent scope 中安装 `team_task_report`。工具接受 task id、attempt id 和一种 worker-owned outcome：带 summary 的 completed、带 code 和 message 的 failed，或 released。它解析恰好一条持久化 `team-task-assignment` `user/message` source，要求其 Team、task、attempt、activation、wake channel 和 post-start `runningRevision` 匹配当前 running lease，并验证 activation binding 匹配调用 Session 与 Participant。

有本地 Team authority 时，工具保留短生命周期的已配置 `TeamLink`。远程 child 只能通过 owner-scoped callback 借用其精确 Agent-owned 固定 Link；它不能读取 credential 或打开第二条连接。`settleTaskAttempt()`从 Link binding 导出 Team、Participant 和 activation fact，然后 Hub 应用 owner fence 与 `task-mutate` policy。模型不能提供 revision、recipient、activation、Session、next phase、review decision、cancellation 或 lease-expiry outcome。Hub 仍会把 completed work 映射到 review，并按 task 冻结的 attempt limit 将 released 或 failed work 映射到 retry 或 terminal failure。

在 settlement 前以及 Link settlement failure 后，工具都会检查不可变 attempt history。Hub 还会为相同 binding、attempt 与 outcome 的重试返回原 task snapshot；不同结果、expired attempt 或 replaced lease 会被拒绝。普通 `tool/call` 和 `tool/result` record 会保留请求 report 与返回 task state，因此不需要新的 Session event。

## Alternatives considered

**从模型工具直接调用 `ctx.teams.settleTaskAttempt()`。** 不予采纳，因为工具需要重建并提供 owner identity field，而 remote Link 还需要一条平行的 authentication path。

**把模型工具放入 `team-agent-client`。** 不予采纳，因为 inbox admission 与 model control 有不同 owner，未来 remote client 也需要相同 report behavior，不能继承 local delivery state。

**让模型选择 task phase 或 resolve review。** 不予采纳，因为结果报告与持久 review/retry policy 是不同的 Hub decision。

## Consequences

[持久 task attempt 与 lease 决策](2026-08-28-durable-task-attempt-leases.zh.md)仍是 task outcome、phase mapping、fence 和 replay validation 的权威。[Team Link 注册表决策](2026-08-28-team-link-registry.zh.md)仍是 activation-bound transport identity 的权威。两条记录在 scoped archive audit 后保持 active：它们保留独立有用的 durable 与 transport boundary，而本记录只拥有 model-report path。

`team_task_report` operation 本身不会路由 reviewer、分配 workspace 或 complete Team。同一个 scoped package 还提供独立的 activation-bound operation，用于续租、执行 durable integration task、resolve review assignment 以及向显式 channel 发送 message；每个 operation 都使用独立的 operation identity，并且不会把 caller 提供的 authority 放进 model arguments。task 有 workspace allocation 且 report 为 completed 时，仍会在 settlement 前经过 provider 的显式 report-only publish 边界。它要求 Agent Client 先 durably admit task-assignment source。Remote worker 使用这些 borrowed-Link path；remote coordinator 使用独立的 borrowed-Link `team_final` path。

## Verification

`tool-team`测试覆盖 scoped registration 与 disposal、准确 source/binding/lease check、每种 worker outcome、heartbeat renewal 与 recovery、integration provenance 与 result projection、review response ordering、显式 message audience 与 retry identity、invalid input、stale identity、lost response 后的 replay、conflicting report、workspace publication、operation-specific presentation，以及 Link close failure containment。真实 local 与 SDK-child composition 会先投递 assignment，再由 scoped tool 报告其准确 running attempt。
