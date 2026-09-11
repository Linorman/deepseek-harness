# Agent Note：Durable Team channel replay watermark

Status: implemented

[English](2026-09-01-team-replay-watermark.md) | 中文

## 问题

本地 Link reconnect 总是从 cursor `-1` 开始发现 pending-delivery。Durable pending projection 会阻止已经确认的 Envelope 再次投递，但 protocol 没有公开 Link 可以安全跳过的 source prefix，terminal-channel compaction 也没有明确命名 replay boundary。

## 决策

`ChannelSnapshot` 可以公开 `replayWatermark`，它由 durable pending-delivery projection 派生。对每个 channel participant，安全边界是该 participant 最早仍 pending 的 Envelope 之前的 cursor；当该 participant 没有 pending delivery 时，边界就是 channel cursor。Channel watermark 是所有 participant 边界的最小值。Receipt 与 TTL-expiry record 只有在各自完成 durable validation 后才会移除 pending entry，因此该边界可在 restart 后重建，且不会把内存 claim 当成 acknowledgement。

纯 `channelReplayWatermark()` fold helper 拥有这项派生逻辑，供 Hub channel snapshot、metrics、Link 和 compaction 共用。Local 与 WebSocket Team Link 会在 connection 或 reconnect 后的第一次 pending-delivery page 使用该 watermark。每个发现的 Envelope 仍然必须经过精确 activation-bound claim、subscriber handoff、Session flush 与 durable receipt。Terminal channel compaction request 会在 pending-delivery gate、精确 channel cursor、causation reachability、source checkpoint 和 audit retention checkpoint 之外检查 watermark。Source cursor 仍是 authoritative sequence；watermark 是 replay-safety projection，不是新的 business cursor。

## 考虑过的替代方案

**把最大 receipt cursor 当作 replay watermark。** 否决，因为 receipt cursor 是 high-water value；当 acknowledgement 乱序到达时，它可能跳过较低但仍 pending 的 Envelope。

**持久化一个可变的 Link cursor。** 否决，因为 Link residency 可以被替换，而 process-local cursor 既不能跨 restart 保留，也不能证明 recipient admission。

**只要当前 pending entry 恰好为空就 compact active channel。** 否决，因为 active channel 的 protocol state、未来 causation 和 adapter lifecycle 仍需要 terminal retention policy 与 checkpoint gate。

## 后果

Reconnect scan 可以跳过已确认 prefix，同时不削弱 at-least-once delivery。Watermark 从 checkpoint/fold 后的 pending state 计算，因此可在 Hub restart 后重现。不公开可选 field 的 provider 仍使用既有的 `-1` discovery 行为。Terminal compaction 仍要求没有 pending delivery；watermark check 让这项 safety condition 显式化，并保护未来更宽 retention path 的 provider implementation。

Core schema、Team Hub、Link-local 和 WebSocket Hub integration test 覆盖 watermark serialization、pending 与 exhausted value、compaction gate、restart 可见的 retained cursor，以及 WebSocket 第一页 cursor。Hub replay-property suite 会生成独立的 receipt interleaving，并将纯 watermark 与 pending state 及 checkpoint round-trip 对比。完整 multi-host replay 与 distributed watermark evidence 仍由 native multi-agent work-system proposal 负责。

配套的 Team task state-machine suite 会生成 retry、lease renewal 和 terminal outcome path，并检查每个 fold 后的 task 都可以完成 checkpoint round-trip。它补充 channel property coverage，但不会把 task lifecycle 变成第二个 authority source。
