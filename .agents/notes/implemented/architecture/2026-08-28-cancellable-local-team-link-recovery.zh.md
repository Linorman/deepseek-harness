# Agent Note: Cancellable local Team Link recovery

Status: implemented

[English](2026-08-28-cancellable-local-team-link-recovery.md) | 中文

## Problem

一个同时拥有 Hub event subscription、WAL replay 和 transport recovery 的 direct Agent client，无法与远端连接共享这些职责。在 listener rejection 后推进 pending-delivery page，也会让仍 pending 的 Envelope 在无关的 reconnect 前丢失；无界 notification fan-out 则会破坏 page-size backpressure。activation status 是可变的，因此把 status snapshot 当作 Link identity 会在正常的 idle-to-running transition 中拒绝本来有效的连接。过期的 activation-bound Link 也不能在其 epoch 已停止或被替换后继续 post 或 acknowledge。

## Decision

`clocky-team-link`使用 activation id、Team、Participant、Session 和 placement provider 标识 Link；provider 会重新校验 residency status，而不会把它作为 connection identity 比较。每个 Link 公开 `done`：正常关闭时 resolve，provider-owned terminal failure 时 reject。本地 provider 会在发布前验证当前为 idle 或 running 的 binding，并在其绑定的 post 和 receipt operation 中携带 activation id 与 Session。`clocky-team-hub`会在 policy evaluation 或持久 mutation 前，在其 Team-to-channel lock 下校验该 proof。

`clocky-team-link-local`会在读取 pending-delivery page 前启动 Team 和 channel cursor watch。它会读取每个不可变 channel manifest，忽略不包含其绑定 Participant 的 channel，因此一个 Participant 的 Link 不会因另一个 Participant 的 channel 而失败。它会在推进到下一个 page item 前等待每个 subscriber handoff，因此 `pageSize`限制单个 channel 的 in-flight replay。rejected listener 只保留该 subscriber 与 Envelope，按 `notificationRetryDelayMs`延迟重试；它不会推进 receipt state、重新扫描完整 WAL，或中断其他 subscriber。unsubscribe、Link failure 和 Link close 都会取消待处理 retry 与 wait。

`FixedBindingTeamAgentLinkDelivery`接收一个准确 Agent 和持久 binding，不读取 `ctx.teams`，也不监听 `team/changed`。它打开已配置的 Link，并拥有 claim、inbox admission、source flush、receipt、soft-interrupt acknowledgement、reconnect 和 close。connection failure 或被 reject 的 `done`仅会在该 Agent 与 binding 仍然 current 时安排有界的延迟 reconnect。只有当 Team Envelope 到达 `user/message`、仍存在于 live inbox，或已完成 flush 正等待 receipt 时，它才把该 Envelope 视为已接纳；rejected claimed splice 会在 retry 时重新接纳。close、Agent disposal 和 inbox discard 都会拒绝未完成的 source barrier，使 owner 消失后没有 pre-step 被永久阻塞。`TeamAgentClient`仍是本地 Session-provenance 与 Team-change discovery 包装层：它会为每个已接纳 binding 创建一个固定投递消费方。

## Alternatives considered

**让 Agent client 保留 raw channel subscription。** 不予采纳，因为本地 replay 与远端 reconnect 会在每个 consumer 中重复 cursor、cancellation 和 notification ownership。

**在任何 listener callback 后推进 delivery cursor。** 不予采纳，因为失败的 flush 或 receipt acknowledgement 会留下一个没有返回该 listener 路径的 pending Envelope。

**在 post 或 receipt 前通过预读取校验 Link binding。** 不予采纳，因为 activation 可以在该读取后、Hub 追加 Envelope 或 receipt 前 transition。

**将 residency status 视为 Link identity field。** 不予采纳，因为 idle-to-running update 会改变 availability，但不会改变 activation epoch 或其 Session authority。

## Consequences

本地 notification 保持 at-least-once：重放的 Envelope 可以多次到达 consumer，而 Hub claim 与 recipient receipt 建立持久 admission。该设计不承诺 exactly-once 模型执行或外部 effect。`notificationRetryDelayMs`和 `reconnectDelayMs`是部署配置，因为其值需要在 recovery latency 与 retry pressure 之间权衡。

Hub 仍是 activation availability、journal、pending delivery、claim 和 receipt 的权威。[Team Link 注册表决策](2026-08-28-team-link-registry.zh.md)仍拥有 provider registration；[线性化 direct delivery claim 决策](2026-08-28-linearized-direct-delivery-claims.zh.md)仍拥有 inbox cutoff 与 causal reply suppression。[WebSocket Team Link 传输决策](2026-08-29-websocket-team-link-transport.zh.md)将同一套 Link client API、terminal signal、已认证 operation 和 recipient replay rule 应用于远程连接。

## Verification

核心 registry 测试覆盖 connection identity verification 期间的 status change。本地 Link 测试覆盖 watch-before-page recovery、bounded page handoff、延迟的单 Envelope retry、retry cancellation、binding-derived post 与 receipt fact、terminal failure 和 close。Agent client 测试覆盖 failed connection 与 terminal-Link reconnect、没有重复 model-visible input 的 transient flush 与 receipt recovery，以及 in-flight pre-step barrier 的 cancellation。核心与 Hub 测试覆盖可选但必须成对的 activation proof，以及 epoch 改变后其在 Team-to-channel lock 下的拒绝。Local provider boundary suite 还证明：没有挂载 workspace provider registry 时，artifact integration 会在 Team authority 之前 fail closed。
