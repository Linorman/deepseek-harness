# Agent Note: Durable channel delivery expiry

Status: implemented

English | [中文](2026-09-01-durable-channel-delivery-expiry.zh.md)

## Problem

Channel Envelopes already carried an optional `ttlMs`, but the Hub only retained that value on the source Envelope. A recipient that never acknowledged an expired delivery therefore kept a pending entry indefinitely, and recovery had no durable fact distinguishing an expired delivery from live work. Removing the entry in memory would also make a restart recreate it.

## Decision

`clocky-team` owns `ChannelDeliveryExpiredRecord` and the proof-only `expireSchedulerChannelDeliveries()` operation. A `TeamSystemSchedulerChannelProof` binds the active Team, attached channel, both observed cursors, trusted clock observation, and bounded record limit; the Hub selects due TTL-bound pending deliveries, appends one expiry record per recipient, and returns the updated channel snapshot plus the appended records. It is idempotent because a delivery must still be pending and TTL-bound when the expiry record folds.

The Hub derives and checkpoints each pending delivery's absolute `expiresAt` from the accepted Envelope. The channel fold validates recipient ownership, source Envelope sequence, TTL presence, and expiry time before removing the pending entry; it does not advance the recipient receipt high-water. Expiry records are accepted after channel closure so a terminal channel can still drain expired pending work. Explicit cancellation and closure abandonment carries a durable reason on the same record, so channel WAL and checkpoint versions are now 5 and 8; older pre-release streams fail loudly.

The drive is intentionally provider-owned rather than a model-facing or Host mutation route. A scheduler or lifecycle Consumer supplies the trusted clock and invokes it within its own expiry budget; no automatic timer is added to the Hub, so deployments retain control over drive cadence and shutdown behavior.

## Alternatives considered

**Delete expired pending entries during `listChannelPendingDeliveries()`.** Rejected because a read would mutate delivery state, and the deletion would not be reconstructable after restart. Expiry is an explicit append-only command.

**Treat an expired delivery as an implicit receipt.** Rejected because expiry proves non-delivery rather than target durability. It must not advance receipt high-water or let delivery consumers mistake an expiry for an acknowledged model input.

**Store only the Envelope TTL and rescan the complete WAL on every drive.** Rejected because it reintroduces an unbounded recovery scan into routine expiry. The folded pending projection carries the derived deadline, while the source Envelope remains authoritative for replay validation.

**Add a Hub-owned timer for every channel.** Rejected because timer cadence, shutdown ordering, and deployment load are provider policy. The explicit drive is easier to bound, test, and compose with the existing scheduler pulse.

## Consequences

Expired recipient work now leaves a durable, replayable audit fact and no longer blocks Team quiescence indefinitely. Multiple overdue deliveries can be drained in bounded batches, and a restart preserves both already-expired removal and still-live TTL deadlines. The trade-off is that expiry depends on a scheduler or other trusted Consumer calling the drive; an idle deployment does not silently create background work.

Core schema/fold tests, JSON/SQLite Hub tests, scheduler tests, and the keyless native Team Loader snapshot cover TTL deadline derivation, checkpoint reconstruction, bounded expiry, explicit closure/cancellation abandonment, receipt separation, malformed expiry rejection, restart replay, scheduler invocation, and idempotent re-drive. Property/model-based, real-model, distributed, browser/GIF, and load/retention evidence remains pending under the [native multi-agent work-system proposal](../../proposed/architecture/2026-08-27-native-multi-agent-work-system.md).
