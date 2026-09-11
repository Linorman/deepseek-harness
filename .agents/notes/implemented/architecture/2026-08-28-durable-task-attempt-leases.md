# Agent Note: Durable task attempts and leases

Status: implemented

English | [中文](2026-08-28-durable-task-attempt-leases.zh.md)

## Problem

A task revision and dependency graph cannot identify the execution that is allowed to change a task. A generic full-task replacement lets a stale worker rewrite phase, retry policy, or instructions after another attempt has started. A lease that exists only in a scheduler process disappears on restart, while a separate attempt log risks a half-persisted task/attempt pair. The future scheduler also needs durable capability eligibility, review decisions, bounded retry state, and a minimal result or failure record before it can safely select or reassign work.

## Decision

`TeamTaskSnapshot` remains the complete value in one `task/changed` Team-journal record. It freezes ancestry, required capabilities, priority, scopes, workspace mode, budget, a closed review route, `maxAttempts`, and an optional activation-authorized task-create command. It contains either no lease or one `assigned`/`running` lease, plus a settled attempt and review-decision history. Attempt ids and task-local ordinals never repeat; `attemptCount` equals the settled history plus the current lease. A lease records its assignment revision, fixed duration, renewal/deadline facts, Participant, an optional attached wake channel, and an exact `ActivationId` for agent participants. Human and service leases omit the activation field.

The Team service exposes narrow task details, cancellation, deletion, review, assignment, start, delivery-bound start claim, heartbeat, settlement, and expiry operations. Owner operations fence the current revision, attempt id, Participant, and applicable activation epoch. Assignment validates active membership, frozen capability requirements, and an optional active attached wake channel. `claimTaskAttemptStart()` verifies the retained assignment revision, exact activation/session binding, attached channel, and an accepted task-addressed Envelope; repeating the same current running claim returns the existing projection without another Team-journal record. Completion records a summary and either completes directly under a no-review route or enters review for the exact configured reviewer, whose decision retains a reason. Failed, released, and expired attempts return to pending until the frozen attempt limit, then fail; cancellation is terminal. The Hub has no scheduler timer and no owner-selection loop.

The Hub validates the same task-create command, attempt, capability, epoch, deadline, wake-channel reference, and leased-field continuity rules while folding journals and restoring checkpoints as it does on public commands. It writes Team journal format 9 and Team checkpoints format 10. Channel WAL format 2 and channel checkpoint format 5 remain independent. A completed attempt retains `TaskAttemptResult { summary }`; a failed attempt retains `TaskAttemptFailure { code, message }`. Artifact references remain absent until an artifact provider owns branded ids, provenance, visibility, and retention. Workspace allocation snapshots now retain provider-minted metadata and lifecycle separately from a task, while roots remain live provider handles.

## Alternatives considered

**Write attempts into a separate journal or stream.** Rejected because settlement and task phase would need an atomic cross-stream pair; a complete task snapshot gives one replayable source of truth.

**Keep the unrestricted task replacement operation.** Rejected because a stale lease holder could construct a valid-looking task snapshot and bypass the exact attempt fence.

**Fence attempts only by logical Participant.** Rejected because a previous local or remote activation of the same Participant could still renew or settle after a newer epoch became resident.

**Introduce artifact ids in the task contract.** Rejected because no existing generic artifact or allocation owner can define their lifecycle, provenance, or storage guarantees.

## Consequences

The [activation-authorized Team task-creation decision](2026-08-29-activation-authorized-task-creation.md) owns durable creator commands and retry identity. The [deterministic Team DAG scheduler decision](2026-08-28-deterministic-team-dag-scheduler.md) provides initial shared-work selection and explicit expiry through this contract. Task-delivery adapters and clients publish the assignment Envelope and invoke the delivery-bound start claim; review/retry/stall policy, quiescence, and artifact publication remain separate work. A client cannot treat a task attempt as a model turn, Agent handle, workspace allocation, or transport connection.

`maxTaskAttemptsPerTask` and `maxTaskLeaseDurationMs` bound task creation and assignment at the Hub. Attempts are at-least-once execution coordination, not exactly-once model or tool execution. The [local Team Hub decision](2026-08-27-local-team-hub-durable-authority.md) remains the authority for Hub ownership and recovery; the [native multi-agent work-system proposal](../../proposed/architecture/2026-08-27-native-multi-agent-work-system.md) remains proposed because scheduling, Goal/workflow convergence, workspace, remote Link, and product phases are unfinished.

## Verification

Core tests cover strict durable parsers, chronology, result/failure facts, capability declarations, epoch-fence unions, delivery-bound start claims, and every narrow runtime method. Hub tests cover JSON and SQLite recovery across assigned/running/expired/reassigned attempts, cap enforcement, capability eligibility, wake-channel validation, stale revision/attempt/Participant/activation/session/channel/Envelope rejection, idempotent claim replay, review/cancel/delete transitions, deadline boundaries, malformed journal and checkpoint rejection, and preservation of leased task details. Invariant tests accept only projections that satisfy the folded attempt relationship.
