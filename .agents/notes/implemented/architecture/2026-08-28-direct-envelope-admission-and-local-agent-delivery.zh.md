# Agent Note: Direct Envelope admission and local Agent delivery

Status: implemented

[English](2026-08-28-direct-envelope-admission-and-local-agent-delivery.md) | 中文

## Problem

Team Hub 可以在没有 Lead Session 的情况下保留 channel 状态，但 channel 尚不能接收 participant message，也不能让这一持久事实可用于本地 Participant 的模型。复用实验性 mailbox 会重新引入隐式的 Session-as-Team identity，并把 Hub 耦合到 AgentLoop。

## Decision

`TeamRuntime.postChannelEnvelope()`接收由可信调用方解析的 sender identity、观测到的 channel cursor 和未盖章 draft。`@clocky/clocky-team-hub`锁定所属 Team 和 channel，要求 active sender 和显式 audience membership，要求每个 `causationId`引用该 channel 中已提交的 Envelope，应用 `send` policy，校验 adapter draft，为 Envelope 盖章，并将它与 adapter follow-up record 原子追加。`maxEnvelopeBytes`是 Hub 配置，默认值为 `65536`。

`@clocky/clocky-team-channel-direct`提供初始的 direct v1 adapter。它接收至少有两个不同 participant、没有 adapter limit、一个明确的非自身 recipient，以及只包含非空 text 的 `message` payload 的 channel。它的 fold state 为 `null`，不会发出自动 reply，并派生一条 delivery intent 而不执行 delivery。Team Hub 会在 WAL append 前，对派生的 pending-recipient projection 应用 `maxPendingDeliveriesPerChannel`；满载 channel 会拒绝后续 admission，直到 receipt 移除容量。

`@clocky/clocky-team-agent-client`是 Consumer，不是 Hub extension。它会在接收投递前，将 Agent Session header 中已物化的不透明 Team 和 Participant 配对 id 与准确的持久 activation binding 同步，然后打开已配置的 activation-bound Link。Link 拥有可取消的 pending-page replay 和 notification；其 claim 会在 Hub 协调下原子验证匹配的 running 或 idle activation、Session、channel 和 pending recipient admission。client 会重新检查返回的 claim，根据持久 `user/message`和 live inbox state 对 Envelope 去重，通过公开 Agent inbox operation 追加确定性的 `team-envelope:<EnvelopeId>` message，等待 `ctx.sessions.flush()`，并记录 recipient receipt。唤醒输入携带 pre-step barrier，因此 source 会在模型请求继续前 flush。已有同 channel recipient reply 且 causation 匹配时会变成 receipt，而不会再次写入 inbox。只等待 receipt retry 的已 flush source 会被确认，而不会再次写入 inbox；在 `user/message`前被拒绝的 claimed source 会重新接纳。该 message source 保留 Team、channel、Envelope、sender、delivery intent 和可选 causation id。

## Alternatives considered

**从 Team Hub 执行 delivery。** 不予采纳，因为 Hub 必须独立于 Agent、Session、AgentLoop 和 placement provider；持久 admission 与本地 inbox delivery 具有不同的所有权和恢复规则。

**复用实验性 Agent Teams mailbox。** 不予采纳，因为它从 Lead Session 派生 Team identity，并保留持久 Team 模型要移除的 direct-child lifecycle。

**新增单独的 delivery record。** 不予采纳，因为 pending delivery 定义为已接收 Envelope 减去 receipt。Hub 从 adapter plan 和 channel WAL 派生 pending recipient admission；单独的 delivery record 会重复 authority。

## Consequences

本地路径证明一条 participant-to-participant direct message 可以从 Hub WAL acceptance 到已 flush 的目标 Session 和持久 receipt，而无需 parent Session relationship。`context`、`turn` 和 `steer`使用现有公开 inbox behavior，重复的 Link notification 不会创建另一条目标 message，拥有持久 binding 的 Agent 会在 terminal transport failure 后重新连接其 Link。[持久本地 activation binding 决策](2026-08-28-durable-local-activation-binding.zh.md)拥有 bind-before-delivery 条件。

Conversation client 会在 projection 中保留这一 intent：持久化的 `turn` Envelope 显示为 user message，`steer` 显示为 steering message，`context` 显示为 injected-context row。这样可见 transcript 和 pending queue 会与 Host、Agent Client 使用的同一 source distinction 保持一致。

[Direct v4 消息决策](../feature/2026-09-06-direct-v4-recipient-delivery.zh.md)将该 receipt 机制扩展到显式子集和广播。Scheduling、transport 和产品入口有独立 Consumer，不属于 direct adapter。[本地 Team Link recovery 决策](2026-08-28-cancellable-local-team-link-recovery.zh.md)拥有 Link replay 和 reconnect 行为。[线性化 direct delivery claim 决策](2026-08-28-linearized-direct-delivery-claims.zh.md)拥有 activation/channel cutoff 与 causal-reply 行为。[local Team Hub 决策](2026-08-27-local-team-hub-durable-authority.zh.md)保持活跃，因为它拥有 Team 和 channel durability rule。

## Verification

核心 schema 和 fake provider 覆盖已认证 post、receipt 和 claim request。Team Hub 测试使用 JSON 和 SQLite 证明盖章的 Envelope 持久化、adapter batch atomicity、派生 pending delivery、claim/receipt idempotence 与 high-water ordering、causal-reply 抑制、restart recovery、cursor conflict、membership、policy、adapter、channel lifecycle 和 byte-limit rejection。direct adapter 测试证明 protocol restriction 和纯 delivery planning。local client 测试使用真实 Agent factory 和 Session persistence，证明 claim-gated context、turn 和 steer inbox admission、唤醒模型请求前的 source flush、包含 delivery intent 的 source provenance、重复 event 与 causal-reply 去重、startup replay 和 unload cutoff。Host Team API 测试证明 Team `steer` source 在 `session/queue` projection 中仍是 pending `steering` item。
