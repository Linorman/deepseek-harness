# @clocky/clocky-team-workspace-recovery

English | [中文](README.zh.md)

`@clocky/clocky-team-workspace-recovery` is an explicitly mounted Team Consumer for provider-owned allocations left in durable `release-requested` state. It never opens or restores active workspaces. For each bounded scan result, it asks the selected provider to reconcile the exact metadata, then records `released`; a provider failure records `preserved` with a recovery reason.

## Configuration

`pageSize` and `maxTeamsPerDrive` are required positive integers. `maxPendingTeams` bounds the event queue and defaults to `maxTeamsPerDrive`; overflow requests a durable sweep whose cursor advances across bounded drives. `confirmationAttempts` defaults to `3`, and `confirmationRetryDelayMs` defaults to `100` milliseconds. They bound durable confirmation retries after one successful provider release. Exhaustion records preservation with the failed-confirmation reason; if preservation also cannot be persisted, recovery reports all failures. `pulseIntervalMs` optionally repeats the bounded scan. Mount the Consumer after `clocky-team`, `clocky-team-workspace`, and every provider it may reconcile.

In Loader configurations, the Consumer entry requires `inject: [loader]` and `intercept: { loader: { await: true } }`, as the shipped headless and Web profiles declare. The `teamWorkspaces` dependency alone waits for the registry, not asynchronous provider registration. In a standalone Context, await each provider’s `ctx.plugin()` before mounting recovery.

## Semantics

Recovery uses a short-lived `TeamSystemWorkspaceAllocationProof` for each confirmation or preservation. The provider receives only the Team-retained allocation metadata and exact task-attempt identity; filesystem roots and credentials never enter the Team journal. A missing, dirty, or otherwise unprovable provider resource is preserved rather than recreated or deleted heuristically.

Durable `release-requested` events trigger a coalesced, single-flight drive even without a pulse. A drive observes the configured Team bound, attempts every selected allocation despite sibling failures, and reports their aggregate after settlement. Unload stops event and timer admission, waits for accepted provider work and its durable confirmation, then revokes the proof source.
A non-advancing Team-list continuation fails the drive with `TEAM_CURSOR_CONFLICT` instead of repeating the same page.

`readAttempts` defaults to `3` and `readRetryDelayMs` to `100` milliseconds. They retry transient Team and Team-page reads independently of release confirmation, so a missed read needs no new allocation event. Recognized durable-format, Team-permission and filesystem-permission failures stop immediately; exhausted I/O retries report all failures. Accepted read retries drain during unload before proof revocation. `readRetryDelayMs`, `confirmationRetryDelayMs` and `pulseIntervalMs` cannot exceed Node’s `2147483647` millisecond timer limit.

Provider-confirmed E2B loss is recorded before cleanup continues. An unavailable allocation with confirmed termination and an earlier durable release request remains eligible after restart; recovery restores that release intent and confirms cleanup. A missing manifest or changed world without termination proof remains unavailable and stalled. [Loss settlement](../../../.agents/notes/implemented/architecture/2026-09-08-e2b-workspace-loss-settlement.md).

## Model Experience

### Workspace release recovery

#### What the model sees

Nothing. This Consumer neither admits messages nor changes prompt content, so no `release-requested` notice reaches a model request.

#### Token effect

Zero direct token effect.

#### KV Cache effect

This package does not modify model-request prefixes.

## Known Limitations and Deferred Work

- **Release-only recovery** — this Consumer reconciles only durable release requests. The Agent Client or an exact closure-owned activation fence must request release of active/reserved allocations first.
