# @clocky/clocky-team-closure-driver

English | [中文](README.zh.md)

`@clocky/clocky-team-closure-driver` is the bounded, restart-safe Consumer that discovers nonterminal Teams with durable closure or cancellation work and serializes one Core proof-bound recovery pass per Team. It owns no Team mutation policy or final-result selection.

## Configuration

`backend` names the paired Hub bridge; `maxTeamsPerDrive`, `pageSize`, `disposalTimeoutMs`, and `observerRetryAttempts` are positive deployment choices. `pulseIntervalMs` optionally retries bounded discovery after startup. Mount the `/registry` service entry and `/hub` bridge before this Consumer; `inject` enforces that barrier and a missing or retired backend fails with `TEAM_CLOSURE_DRIVE_BACKEND_UNAVAILABLE`.
A repeated or rewound Team-list continuation fails the discovery pass with `TEAM_CURSOR_CONFLICT` rather than retaining the same cursor for another scan.

## Backend contract

`TeamClosureDriveBackend.drive()` receives a detached Team state, coalesced triggers, an abort signal, and a Core `TeamSystemClosureDriverProof`. The Driver derives its exact scope from an already durable completion, failure, or cancellation fact, or from a current turn/budget observation submitted by an owner, and registers it on `ctx.teams`; the Hub bridge forwards it to `continueTeamClosure()`, which revalidates the intent and resource fences under its serializers. A receipt-pending completion intent remains quiescing until its final human receipt is durable. The proof remains valid for an admitted pass until that pass settles during disposal.

Concurrent `start()` calls await the same initial recovery sweep. The driver detaches turn and budget observations before queueing them, coalesces duplicates, and settles every queued observation before reporting pass failures. Disposal rejects observers that have not entered a backend pass, closes admission, retains proofs until accepted backend work settles, and removes the exposed driver even when cleanup fails.

The Hub bridge requires the activation controller. For an accepted closure or cancellation intent, it first delegates one exact-epoch resource recovery action through `teamActivations.recoverClosure()`. If that action advances the Team cursor, the pass ends so the next drive can obtain a fresh proof; otherwise the Hub continues lifecycle settlement with the original cursor. Team events continue accepted TeamRun completion without requiring a polling pulse. Current turn/budget observations reach the Hub directly and cannot authorize resource recovery before an intent exists.

Budget scans and Hub revalidation select the same tighter typed/deployment ceiling and reason. Reaching that ceiling stalls the Team; zero typed token/turn/cost ceilings and fractional cost units retain their schema-defined meaning. Deployment count and cost limits remain positive integers. Retry counts and occupied concurrency slots do not turn an already admitted attempt into a global budget stall.

## Model Experience

### Closure recovery

#### What the model sees

Nothing; `TeamClosureDriver` neither admits messages nor changes prompt content.

#### Token effect

Zero direct token effect.

#### KV Cache effect

This package does not modify model-request prefixes.

## Known Limitations and Deferred Work

- **Hub bridge required** — the driver deliberately has no fallback closure command; the paired `/hub` entry is the shipped bridge to the mounted Team provider's scoped recovery API.
