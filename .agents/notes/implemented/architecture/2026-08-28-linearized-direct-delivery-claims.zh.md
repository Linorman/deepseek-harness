# Agent Note: Linearized direct delivery claims

Status: implemented

[English](2026-08-28-linearized-direct-delivery-claims.md) | 中文

## Problem

本地 direct-delivery client 会分别读取 activation binding 与 channel，然后写入模型可见 inbox item。两次读取和 inbox 写入之间可能提交 Team status transition。唤醒型 `followup()`或`steer()`也可能在 target Session flush 保存 source Envelope 前到达 Agent loop，使因果关联的 result 先写入 channel WAL。

## Decision

`clocky-team`定义 proof-only `claimChannelDelivery()`。本地 Link 或已认证 WebSocket listener 会传递其私有 activation-proof lease 中的 proof，以及仅有的 `channelId`和`envelopeId`。`clocky-team-hub`先取得 Team queue，再取得 channel queue，解析并重新校验准确的 running 或 idle binding，派生 Team、activation、Session、recipient 和 pending delivery，然后返回不可变的临时 claim。claim 不写入 journal 或 checkpoint record，不保留模型 turn，也没有后续 settlement operation。

`claimTaskAttemptStart()`使用同一条 Link 持有的 proof。其 JSON input 只包含 task、attempt、assignment-revision、channel 和 Envelope identity。在 Team/channel queue 内，Hub 从重新校验的 binding 派生 Team、Participant、activation 和 Session，然后在启动 attempt 前验证 assigned lease 与持久 assignment Envelope。

recipient 已有 receipt 时，Hub 不返回 claim。相同 recipient 已提交同一 channel 的 Envelope，且其 `causationId`命名 pending Envelope 时，Hub 会在该 critical section 内追加持久 receipt，并且不返回 claim。pending-minus-receipt WAL projection 仍是持久 delivery 的真源。

`clocky-team-agent-client`把其 activation-bound Link claim 作为 direct inbox admission 前最后一个等待的 authorization。缺少 claim 不会写入 inbox 或唤醒。对于 `turn`和`steer`，它会在公开的唤醒调用前安装 Envelope 专用的 `agent/pre-step` barrier。该 barrier 仅在 `ctx.sessions.flush()`成功后允许拟议模型步骤；flush 失败会拒绝该步骤，并让 receipt 保持 pending。

## Alternatives considered

**在 inbox 写入前立即重新检查 activation。** 不予采纳，因为另一项 Team status transition 仍可在该读取与 inbox operation 之间提交。

**把 channel WAL、Team journal 和 Session flush 变成一个 transaction。** 不予采纳，因为三个 stream 拥有独立的持久所有者。已排序的 fact 与幂等 replay 仍是可靠性模型。

**把 recipient high-water cursor 作为因果证明。** 不予采纳，因为乱序 receipt 可能将 cursor 推进到较早的 pending Envelope 之后。

## Consequences

Hub 为本地 direct delivery 建立一个线性化点：claim 会在 stopping/offline transition 前获胜，或在其后失败。实现保留 at-least-once notification 与幂等的持久 admission；它不声明 exactly-once 模型执行或工具 effect。只有同一 channel 和 recipient 的 causal reply 才会抑制重放的 source turn。

claim 是本地临时事实。本地 Link 和已认证 WebSocket listener 会私有地保留其 proof lease，因此 proof 不会跨越 wire 或 durable boundary。[本地 Team Link recovery 决策](2026-08-28-cancellable-local-team-link-recovery.zh.md)拥有本地已认证 post/receipt operation、pending-delivery paging 和 reconnect 行为；[WebSocket Team Link transport 决策](2026-08-29-websocket-team-link-transport.zh.md)拥有已认证 remote framing 与跨进程 delivery。[持久 activation binding 决策](2026-08-28-durable-local-activation-binding.zh.md)仍是 activation ownership 的权威。[Team actor proof control-plane 提案](../../proposed/architecture/2026-09-01-team-actor-proof-control-plane.zh.md)拥有剩余 Team write-operation migration，而[原生多 agent 工作系统提案](../../proposed/architecture/2026-08-27-native-multi-agent-work-system.zh.md)在调度、workspace 与产品阶段完成前仍为 proposed。

同一条由 Link 持有的 proof lease 也授权 proof-only recipient receipt、task-attempt heartbeat 与 settlement。receipt input 只包含 channel、Envelope 与 observed-cursor identity，Hub 会在重新校验 binding 后派生当前 recipient；`team-run`只为其精确默认 topology coordinator final 使用独立的 source-scoped proof。task input 包含 task、attempt 和已观测 revision，settlement 额外带有 typed outcome；Hub 在 Team lock 下重新校验 binding，并派生当前 lease owner。普通 Link post 和 review operation 保留各自的 request contract。本决策继续拥有 delivery claim 与 task-attempt start；[Team actor proof control-plane 提案](../../proposed/architecture/2026-09-01-team-actor-proof-control-plane.zh.md)拥有 receipt 与剩余 write-operation migration。

## Verification

core 测试验证严格的 proof-only claim input 和抽象 runtime surface。Hub 测试覆盖准确的 proof-derived Team／participant／activation／Session 匹配、pending 与 receipt 行为、task-assignment delivery 校验、dispatch policy、causal reply 抑制、JSON／SQLite recovery 以及分离的 claim。local 和 WebSocket Link 测试覆盖转发私有 lease proof，且不接受 caller-selected identity field。local client 测试覆盖 claim no-op 与 mismatch、唤醒模型请求前的 source flush、flush failure、重复 notification、不会启动 target turn 的 causal-reply replay，以及有界 teardown。
