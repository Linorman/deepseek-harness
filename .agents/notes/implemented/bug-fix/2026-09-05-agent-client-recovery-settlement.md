# Agent Note: Agent Client recovery and accepted-operation settlement

Status: implemented

English | [中文](2026-09-05-agent-client-recovery-settlement.zh.md)

## Problem

A restored workspace handle owns cleanup before its durable activation and Agent-root publication finish. Losing that handle after a failed commit leaves a provider resource without its live release owner. A disposal timeout also leaves accepted operations running; revoking their proof source or forgetting their pending promises can interrupt durable confirmation or let activation disposal finish too early.

A repeated channel claim can encode the same JSON-owned view with a different object-key order. Comparing serialized text rejects that valid retry even though its content and provenance are unchanged.

## Decision

The [Agent Client](../../../../packages/team/team-agent-client/README.md) retains workspace proof sources, leases, and release promises until accepted work settles. Closing immediately stops new delivery and rejects pending pre-step barriers. A timeout reports incomplete shutdown while final cleanup remains attached to the settlement promise. A terminal allocation record removes root exposure but does not settle an outstanding provider operation. Preparation, reservation, materialization, restoration, or activation that returns after closing finishes its abandon/release path instead of publishing a new Agent root.

If restoration returns a handle but activation or root publication fails, the client uses its unpublished-allocation cleanup: record release intent, release the exact handle, and confirm release. A failed physical release records preservation; a failed confirmation retains the release intent. The original failure and cleanup failures remain observable.

Channel-view retries compare field and ordered-content values structurally. They reuse the stored Session event and pending inbox message. Durable inbox claims followed by a model step prove prior consumption; an unrun claim, canceled input, or inherited fork seed does not establish consumption by the current Agent.

Internal checks follow their owners: published allocations and snapshots share private map keys, the Session channel-view projection always produces a user message, and startup validates local dependencies before recovery can yield. These facts do not replace checks on durable allocation references, claim provenance, or provider failures.

## Alternatives considered

**Revoke authority when the timeout expires.** Rejected because accepted work can still need that exact proof source. Recreating a source after disposal can hide the interruption and leak its registration.

**Preserve every restored handle after an activation failure.** Rejected because the client already owns its release capability. Preservation records a failed cleanup; it is not a substitute for attempting cleanup of an unpublished handle.

**Forget a release promise when its allocation becomes terminal.** Rejected because another owner can publish preservation while this process still awaits a provider operation. Activation settlement must retain and await that promise independently.

**Compare serialized JSON text.** Rejected because object-key order is not a content or provenance change. Structural comparison still rejects changed fields and array order.

## Consequences

Shutdown remains bounded for its caller while incomplete backend work retains the authority needed to settle. Failed recovery blocks model admission instead of falling back to the Session root. Cleanup failures remain explicit and retryable through their durable allocation state.

The [shared-root decision](../architecture/2026-08-28-shared-team-workspace-root.md) and [detached-worktree decision](../architecture/2026-08-28-detached-team-worktree-allocation.md) remain active: they own provider allocation and release policy. This note owns the consumer's handle and promise lifetimes.

## Verification

Package tests use real Session and Inbox logs for persistence barriers, claim/step replay, fork seeds, cancellation, changed-view rejection, and object-key reordering. JSON-backed Hub tests cover restore/activation failures, unpublished-root cleanup, release-confirmation reconciliation, late completion after timeout, closure at each asynchronous setup stage, concurrent external preservation, multiple allocations, retired dependencies, and bounded usage failures. No new coverage exclusions are used.
