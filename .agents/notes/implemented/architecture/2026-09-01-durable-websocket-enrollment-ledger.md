# Agent Note: Durable WebSocket enrollment ledger

Status: implemented

English | [中文](2026-09-01-durable-websocket-enrollment-ledger.zh.md)

## Problem

Dynamic WebSocket enrollment credentials previously lived only in the Hub process. A Hub restart erased every dynamic credential even though the remote activation binding and unacknowledged deliveries remained durable. Reissuing an arbitrary credential after restart would either require the child to coordinate outside the Team authority or risk accepting a stale credential. The existing WebSocket replay path also scanned from the beginning of every channel WAL instead of using the Hub's durable pending-delivery boundary.

## Decision

`clocky-team-link-websocket-hub` owns one versioned `storageLog` stream per `enrollmentProviderName`. It records the exact binding, SHA-256 credential digest, monotonic generation, issuer timestamp, and revocation timestamp. Credential plaintext never enters the ledger, configuration, Team journal, Session log, wire response, or diagnostic.

The listener fully validates and folds its ledger before registering its enrollment issuer or HTTP upgrade route. A current dynamic credential authenticates only its current issued generation. Reserving an already issued binding appends a replacement generation, invalidates the former digest, and closes the old attached socket. A revoker affects only its exact current generation; an old revoker is a no-op after replacement. Restart reconstructs the latest state from the ledger and accepts only the recovered current credential.

The WebSocket pending-delivery reader uses `ChannelSnapshot.replayWatermark` for its first page, as the local Link already does. It retains the existing claim, notification, Session-flush, and receipt ordering for every delivery after that boundary.

## Alternatives considered

**Keep dynamic credentials in the listener map.** Rejected because a process restart loses authorization while durable bindings and pending delivery still require recovery.

**Persist credential plaintext or encrypt it in the Team journal.** Rejected because the Hub needs only equality testing; retaining a reusable secret would enlarge the durable attack surface and couple transport credentials to Team business authority.

**Reuse one global enrollment stream for every provider name.** Rejected because independent provider registries need independent recovery and revocation domains; provider-namespaced streams make a conflicting record fail loudly.

**Rescan every channel from `-1` after reconnect.** Rejected because the durable watermark proves which acknowledged prefix every recipient can skip without weakening at-least-once delivery.

## Consequences

Dynamic credential recovery now survives full local Hub restart on JSON and SQLite log backends, including a restart across two separate Hub processes using the same SQLite durable root. Static environment credentials remain configuration-owned; v4 cancellation frames provide cooperative endpoint stop before a revoked or rotated socket closes, while hard remote termination and multi-Hub consensus remain separate work. A listener fails before exposure when its enrollment ledger is malformed, unsupported, or cannot be recovered.

## Verification

Enrollment-ledger tests cover JSON and SQLite recovery, generation rotation, exact-generation revocation, plaintext absence, malformed records, and unsupported formats. WebSocket Hub tests cover rotation closing an old socket, cooperative cancellation acknowledgement, revoked credential denial after restart, dynamic credential recovery with pending delivery replay and claim/ack across a Hub child and Link child sharing SQLite, both an in-process restart and two separate Hub processes, and the first pending page starting at the durable replay watermark.
