# Agent Note: Durable channel delivery expiry

Status: implemented

[English](2026-09-01-durable-channel-delivery-expiry.md) | 中文

## Problem

Channel Envelope 已经携带可选的 `ttlMs`，但 Hub 过去只会把该值保留在 source Envelope 上。永不确认的 recipient 因此会无限保留 expired delivery 的 pending entry；恢复时也没有 durable fact 区分 expired delivery 与 live work。若只在内存中删除，restart 还会再次生成它。

## Decision

`clocky-team`拥有`ChannelDeliveryExpiredRecord`和 proof-only `expireSchedulerChannelDeliveries()` operation。一条 `TeamSystemSchedulerChannelProof`会绑定 active Team、attached channel、两条 observed cursor、trusted clock observation 与有界 record limit；Hub 会选择已到期的 TTL-bound pending delivery，为每个 recipient 追加一条 expiry record，并返回更新后的 channel snapshot 与本次追加的 record。它是幂等的，因为 expiry record fold 时要求该 delivery 仍然 pending 且确实带 TTL。

Hub 会从已接收的 Envelope 为每个 pending delivery 推导并 checkpoint absolute `expiresAt`。Channel fold 会在删除 pending entry 前校验 recipient ownership、source Envelope sequence、TTL presence 与 expiry time；它不会推进 recipient receipt high-water。Expiry record 允许在 channel closure 后追加，因此 terminal channel 仍能清理过期 pending work。同一 record 现在也会携带 explicit cancellation 或 closure abandonment reason，因此 channel WAL 与 checkpoint version 现在为 5 和 8；更早的 pre-release stream 会快速失败。

该 drive 是 provider-owned operation，不是 model-facing 或 Host mutation route。Scheduler 或 lifecycle Consumer 会在自身 expiry budget 内提供 trusted clock 并调用它；Hub 不增加自动 timer，因此 deployment 可以控制 drive cadence 与 shutdown behavior。

## Alternatives considered

**在 `listChannelPendingDeliveries()` 中读取时删除过期 pending entry。** 不采用：read 不应改变 delivery state，而且删除无法在 restart 后重建。Expiry 必须是显式的 append-only command。

**把 expired delivery 当作 implicit receipt。** 不采用：expiry 证明的是未投递，而不是目标持久化。它不能推进 receipt high-water，也不能让 delivery consumer 把 expiry 误认为已经确认的 model input。

**只保留 Envelope TTL，每次 drive 都扫描完整 WAL。** 不采用：这会把无界 recovery scan 重新带入常规 expiry。Folded pending projection 携带 derived deadline，source Envelope 仍是 replay validation 的权威。

**为每个 channel 增加 Hub-owned timer。** 不采用：timer cadence、shutdown order 与 deployment load 属于 provider policy。显式 drive 更容易有界、测试，并与现有 scheduler pulse 组合。

## Consequences

过期 recipient work 现在会留下 durable、可 replay 的 audit fact，不会再无限阻塞 Team quiescence。多个 overdue delivery 可以按 bounded batch 清理，restart 会同时保留已过期的删除结果与仍 live 的 TTL deadline。代价是 expiry 依赖 scheduler 或其他 trusted Consumer 调用 drive；idle deployment 不会悄悄创建后台 work。

Core schema／fold test、JSON／SQLite Hub test、scheduler test 以及 keyless native Team Loader snapshot 覆盖 TTL deadline derivation、checkpoint reconstruction、bounded expiry、explicit closure／cancellation abandonment、receipt separation、malformed expiry rejection、restart replay、scheduler invocation 和幂等 re-drive。Property/model-based、real-model、distributed、browser/GIF 以及 load/retention evidence 仍按 [native multi-agent work-system proposal](../../proposed/architecture/2026-08-27-native-multi-agent-work-system.zh.md) 保持 pending。
