# Agent Note: Durable Simulation task assignment

Status: implemented

English | [中文](2026-09-30-simulation-task-assignment.zh.md)

## Problem

A task assignment can commit before its caller receives a response. Without a source reservation, retry or recovery can create another attempt, lose its writer identity, or publish a checkpoint that omits its responsibility. Logical offline status alone does not prove physical termination.

## Decision

The explicit [connection assignment](../../../../packages/simulation/simulation-team/src/task-assignment.ts) reserves the creation operation, canonical task revision, selected entity/participant/Session, writer epoch/activation/reservation, attempt ordinal and lease duration in the Run journal before Hub IO. Retries retain that selection and reconcile the exact target attempt. No task input or inference is implicit.

The Hub's dedicated method accepts only the Simulation owner's runtime-only proof. It rechecks canonical creation, current activation and exact request under its task lock before and after policy awaits. Ordinary capability, workspace, budget, review and retry constraints remain owned by Team. The proof grants no channel authority and is revoked after its operation.

[Controller cleanup](../../../../packages/simulation/simulation-team/src/task-retirement.ts) retains exact task facts or an original-epoch retirement after actual quiescence. The Hub atomically pairs affected attempt retirement metadata with activation quiescence. Replay, checkpoints and complete-prefix reads reject unpaired or mismatched evidence. Simulation leases interrupted before completion fail with `SIM_WRITER_RETIRED`; retirement cannot claim completed. Native cleanup writes survive close admission, safe eviction excludes unfinished task owners, and full collection drains assignments and verifies their retained cross-owner references. Native journal format is 45; Team journal and Team checkpoint formats are 40.

The [source-evidence decision](2026-09-30-simulation-task-source-evidence.md) retains independent interaction and fulfillment rules. The [cognition decision](2026-09-30-simulation-task-cognition.md) owns recorded input and scoped start; the [completion decision](2026-09-30-simulation-task-completion.md) owns evidence-backed settlement and bounded automatic batches. The [coordination proposal](../../proposed/architecture/2026-09-17-durable-simulation-coordination.md) and [product proposal](../../proposed/architecture/2026-09-28-web-team-simulation-product-integration.md) retain product scheduling, automatic attempt recovery and complete fault-matrix requirements. None is fully superseded.

## Alternatives considered

**Assign first and infer source identity later.** A response loss leaves no stable responsibility to reconcile.

**Give a general scheduler or channel proof to the actor.** It grants operations beyond this reserved attempt and omits native writer revocation.

**Accept offline status or a caller boolean as retirement.** Neither proves controller quiescence or prevents late completion.

## Consequences

Assignment is explicit, requires a resident actor and starts no model. Old epochs lose authority; a new attempt uses another identity and the remaining Team attempt budget. Unknown assignment outcomes retain their original reservation. Completed target facts remain unchanged during cleanup. The completion owner selects effect evidence; product automatic-mode activation remains separate.

## Verification

JSON/SQLite real Loader snapshots interrupt after source reservation, Hub assignment and native observation. Recovery retires the same old responsibility before explicit replacement, keeps one task, respects actual attempts and performs zero inference. Native and connection unit tests cover changed selectors, revoked proof during policy IO, response loss, immutable facts, cleanup retries and checkpoint references. The example uses production assignment and controller retirement; it does not construct a successful execution through helpers.

The [proof-source regressions](../../../../packages/simulation/simulation-team/tests/task-authority.spec.ts) verify missing source/attempt/input/result, released writers, nonserializable start proofs, revocation after Hub completion and a substituted creation receipt at collection. The task authority and captured target-reference modules each have complete statement, branch, function and line coverage with their owning native and executor tests.
