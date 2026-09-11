# Agent Note: Multi-Hub projection reconciliation

Status: implemented

English | [中文](2026-08-31-multi-hub-projection-reconciliation.zh.md)

## Problem

SQLite permits a replacement Hub process to open the same durable Team and channel streams, but an already-running Hub retained an in-memory projection from before the replacement or another writer appended. Returning that stale projection on a later read made a successful handoff appear to lose state; blindly merging a concurrent mutation would be unsafe.

## Decision

`team-hub` reconciles an already-loaded Team or channel by reading and validating the bounded durable suffix before read-oriented operations return. The suffix is folded with the same pure journal/WAL fold used during cold recovery, post-commit observers receive the newly discovered records, and concurrent callers share one reconciliation promise per resource. If a local operation advanced the projection while the external scan was awaiting storage, the scan never overwrites the newer local state.

Existing cursor waiters belong to the old in-memory generation. When a durable suffix is adopted, that generation is closed and a fresh `CursorActivity` is installed; stale expected-cursor mutations therefore still produce the established cursor-conflict path, while future reads and watches use the reconciled projection. Watch registration intentionally skips the asynchronous reconciliation step so disposal can close an admitted waiter deterministically.

The SQLite backend remains the multi-process durability boundary. JSON storage continues to reserve one process-wide log owner. This change does not introduce multi-Hub consensus, leader election, or split-brain resolution; concurrent mutations still use expected-tail compare-and-set and invalidate stale projections on conflict.

## Alternatives considered

**Return the cached projection until a write conflicts.** Rejected because read-only failover and UI reconnects would observe stale Team/channel state indefinitely.

**Reload the complete journal for every read.** Rejected because it defeats checkpoints and incremental projections; only a suffix is needed when the durable tail advances.

**Merge an external suffix into a projection while retaining old cursor waiters.** Rejected because those waiters could observe an ambiguous generation and a stale CAS caller could be mistaken for a successful writer. Closing the old activity generation makes the handoff explicit.

**Add consensus or leader election to the local Hub.** Rejected as a separate distributed-authority design outside this proposal. SQLite expected-tail transactions provide a clear single-storage consistency boundary without claiming federation.

## Consequences

Two Hub processes sharing a SQLite database can hand off durable reads and continue mutations after one process exits; an active process converges on externally appended Team and channel records before subsequent reads. JSON remains intentionally single-process. Cross-Hub cursor conflicts, unsupported records, and malformed suffixes remain loud and never silently repair business state.

## Verification

- Team Hub edge tests cover read-time reconciliation of externally appended Team and channel records, bidirectional subsequent writes, stale cursor conflict, and deterministic disposal of admitted watches. The SQLite load test replays 256 Envelope records across a Hub handoff, verifies checkpoint-backed suffix reconstruction, and preserves pending-delivery order.
- Existing JSON/SQLite restart, external-tail-conflict, WAL, checkpoint, and invariant suites remain green.
- `pnpm exec vitest run packages/team/team-hub/tests/edge-cases.spec.ts packages/team/team-hub/tests/load.spec.ts` passes.
