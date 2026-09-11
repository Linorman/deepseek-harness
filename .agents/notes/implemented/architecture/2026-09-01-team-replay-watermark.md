# Agent Note: Durable Team channel replay watermark

Status: implemented

English | [中文](2026-09-01-team-replay-watermark.zh.md)

## Problem

Local Link reconnects always began pending-delivery discovery at cursor `-1`. Durable pending projections prevented acknowledged Envelopes from being delivered again, but the protocol did not expose the safe source prefix a Link could skip, and terminal-channel compaction did not name that replay boundary explicitly.

## Decision

`ChannelSnapshot` may expose `replayWatermark`, derived from the durable pending-delivery projection. For each channel participant, the safe bound is the cursor immediately before that participant's earliest still-pending Envelope; when no pending delivery remains for a participant, its bound is the channel cursor. The channel watermark is the minimum of those participant bounds. Receipt and TTL-expiry records remove pending entries only after their own durable validation, so the derived bound is restart-safe and does not treat an in-memory claim as an acknowledgement.

The pure `channelReplayWatermark()` fold helper owns this derivation for Hub channel snapshots, metrics, Links, and compaction. The local and WebSocket Team Links use this watermark for their first pending-delivery page after a connection or reconnect. Every discovered Envelope still goes through the exact activation-bound claim, subscriber handoff, Session flush, and durable receipt path. A terminal channel compaction request checks the watermark alongside the pending-delivery gate, exact channel cursor, causation reachability, source checkpoint, and audit retention checkpoint. The source cursor remains the authoritative sequence; the watermark is a replay-safety projection, not a new business cursor.

## Alternatives considered

**Use the maximum receipt cursor as the replay watermark.** Rejected because receipt cursors are high-water values and may skip a lower pending Envelope when acknowledgements arrive out of order.

**Persist a separate mutable Link cursor.** Rejected because Link residency is replaceable and a process-local cursor cannot survive restart or prove recipient admission.

**Compact active channels after all current pending entries happen to be empty.** Rejected because active channel protocol state, future causation, and adapter lifecycle still require the channel's terminal retention policy and checkpoint gate.

## Consequences

Reconnect scans can skip acknowledged prefixes without weakening at-least-once delivery. The watermark is computed from checkpointed/folded pending state and is therefore reproducible after Hub restart. Providers that do not expose the optional field retain the existing `-1` discovery behavior. Terminal compaction still requires zero pending delivery; the watermark check makes that safety condition explicit and protects future provider implementations that add broader retention paths.

Core schema, Team Hub, Link-local, and WebSocket Hub integration tests cover watermark serialization, pending and exhausted values, compaction gating, restart-visible retained cursors, and the WebSocket first-page cursor. The Hub replay-property suite generates independent receipt interleavings and checks the pure watermark against pending state plus checkpoint round-trips. Full multi-host replay and distributed watermark evidence remains pending under the native multi-agent work-system proposal.

The companion Team task state-machine suite generates retry, lease-renewal, and terminal outcome paths and checks that each folded task remains checkpoint-round-trippable. It complements the channel property without making task lifecycle state a second source of authority.
