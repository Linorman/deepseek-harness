# Agent Note: 持久 participant 软中断

Status: implemented

[English](2026-08-29-durable-participant-soft-interrupt.md) | 中文

## Problem

内存中的 Agent cancellation 无法在断线后得到授权、恢复或投递到远程 activation。将 WebSocket peer 视为 interrupt authority 还会让一个远程 participant 在没有持久 Team 决定的情况下停止另一个 participant。

## Decision

`ctx.teams`拥有持久 soft-interrupt command。可信 actor 为一个 active participant 请求中断；Hub 解析其当前 idle 或 running activation，并记录精确的 Team、participant、activation、Session 和 provider target。`interrupt` policy 授权该请求。相同的未确认 target 返回已有 command，并且只有同一 target binding 可以列出或确认它。

Team journal 记录 requested 与 acknowledged command，checkpoint 跨 restart 保留 pending command。acknowledgement 只证明 target execution side 已执行 `Agent.cancel({ kind: 'user' }, { keepInbox: true })`；它不声称 turn、task、Team 或 process 已结束。

`TeamLink`承载 target-bound interrupt notification 和 acknowledgement。本地 Agent client 在确认前取消其精确的 live Agent。WebSocket Link frame 使用 v2：Hub 发送 `interrupt`，client 只能为其保留的 delivery 和匹配 target 发送 `interrupt-ack`。listener failure 会让持久 command 保持 pending 以便 replay；peer 无法创建 interrupt command。

## Alternatives considered

**让 WebSocket peer 请求 interrupt。** 不予采用，因为 connection possession 是一个 binding 的 delivery authority，而不是控制 Team member 的 authority。

**使用 task 或 Team cancellation 作为 interrupt record。** 不予采用，因为取消无 lease task 或 Team 不能标识正在执行的 activation、保留 acknowledgement，或区分 cooperative stop 与 lifecycle settlement。

**让 acknowledgement 表示完成。** 不予采用，因为 cancellation 是异步的：Session turn-end event 和 runtime status 仍是后续执行状态的持久证据。

## Consequences

本地与远程 execution side 可以在不共享 process memory 的情况下接收一个可恢复、精确 target 的 soft interrupt。[WebSocket Team Link 传输决策](2026-08-29-websocket-team-link-transport.zh.md)拥有 framing、capability 和 connection 规则；本 Note 拥有 command authority 及其 negative guarantee。

hard participant 或 Team cancellation 仍是独立内容：它必须停止未来 admission、settle task lease 和 workspace、dispose activation，并以持久 offline state 作为完成证据。multi-Hub consensus 和 remote process force-termination 不属于此 command。
