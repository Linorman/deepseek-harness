# Agent Note: Bounded Simulation task progression

Status: implemented

English | [中文](2026-10-01-simulation-task-progression.zh.md)

## Problem

An accepted decision can leave a real task unfinished because its scene requires another action. A reviewer can also return a completed attempt to pending. Reusing the first decision or its terminal result cannot fulfill either responsibility and risks mixing an old attempt with new work.

## Decision

The [executor](../../../../packages/simulation/simulation-product/src/task-executor.ts) uses the existing native ordered decision associations. Trusted `nextDecision` chooses waiting, blocked or another cognition after due effects are driven and scene completion still lacks evidence. It sees frozen facts and cannot obtain additional task authority. New decisions retain their exact predecessor, reason, cognition policy and canonical task instructions before execution. Retry resumes the last recorded association; it never reruns the selector to replace an already recorded decision. `maxControlSteps` bounds each batch and `maxDecisionsPerAttempt` bounds cognitive steps within one attempt, defaulting to one. Native model, context, writer and task checks still govern admission.

An exact canonical review returning the latest completed attempt to pending permits a new attempt with a new ordinal and identity. The original result remains immutable. Cancellation, dependencies, remaining attempts and source/interaction checks remain required. Ordinary waiting, failed results and pending review cannot authorize new attempts. Physical writer retirement follows the existing separately configured recovery policy.

The choice stays in the trusted scenario consumer rather than a new durable protocol: the native log already records all selected decisions and their inputs. The default company template retains its single-step/no-review contract. An installed buyer-reviewed variant explicitly enables report cognition and administrative review; public creation still accepts no selector or extra execution authority.

The installed `task-workflow/1` scene selects sequential deterministic report tasks from immutable deployment steps, independently routing creator, executor, recipient and reviewer within the prepared topology. Its pure policies accept only the recorded task creation, report or empty acknowledgement; report completion checks one exact attempt-owned operation and matching persisted recipient receipts. Administrative review derives the reviewer from that step rather than a company role. Different exact task creations from one source may have distinct executor routes; wildcard/exact overlaps and duplicate exact routes reject. Model-driven workflow steps reject during configuration because post-effect completion checks cannot restrict a model’s valid but unrelated world operations.

Completed report tasks do not discard accepted future inputs. A pending ingress keeps the driver active: it advances to the earliest pending native event using exact decimal ticks, then records an empty acknowledgement for the selected actor. Paused runs consume nothing until explicit resume. Retrying the original consumed input preserves its receipt and decision; it does not create another report, task or resource effect.

## Alternatives considered

**Repeat the first decision until completion.** This repeats accepted effects and loses the durable predecessor needed to reconstruct new model inputs.

**Treat missing completion evidence as permission to infer.** Waiting can mean future delivery, review or external evidence; only an explicit trusted choice can admit another bounded cognition.

**Reuse a completed attempt after rework.** The previous outcome is immutable, and reusing its identity bypasses Team attempt and review constraints.

## Consequences

Scenario authors must define useful subsequent decisions and their completion predicate together. Waiting and blocked remain explicit stops without additional cognition; a request beyond the configured decision limit blocks. Recorded successors survive response loss without another effect or computation. New review attempts receive current canonical instructions through the existing task decision path.

Rework does not grant permission to repeat a fulfilled transfer. Native continuation still requires its original retired-writer evidence. Arbitrary topology, additional effect kinds and the complete new-scene process-exit/browser matrix remain separate work. The installed buyer-reviewed company scene separates its single inventory transfer from report rework and uses the [scoped review authority](../architecture/2026-10-01-simulation-task-review-authority.md).

## Verification

The [progression regressions](../../../../packages/simulation/simulation-product/tests/task-executor-progression.spec.ts) exercise JSON/SQLite two-decision completion, lost association/execution responses, waiting/blocked/decision limits and real canonical rework with exhausted/available attempts. The [Loader snapshot](../../../../examples/simulation-company/tests/task-executor.snapshot.ts) verifies two ordered deterministic decisions in one actual attempt and two reviewed attempts after rework on both storage backends, with recorded inputs, exact inventory effects, immutable old result and complete final checkpoint. Existing model and deterministic single-step Loader paths remain covered. These checks do not establish coverage percentages or the deferred full fault matrix.

The [workflow regressions](../../../../packages/simulation/simulation-product/tests/task-scenario.spec.ts) verify JSON/SQLite sequential report tasks with different executor routes, supplier review, wrong-reviewer refusal, rework feedback, no inventory transfers or model requests, and rejection of model/executable configuration. [Administrative regressions](../../../../packages/simulation/simulation-product/tests/task-scenario-administration.spec.ts) verify run-owned review, paused intent, exact durable retries and inert cold reads on both backends.

The [future-input regressions](../../../../packages/simulation/simulation-product/tests/workflow-ingress.spec.ts) verify JSON/SQLite delivery to an additional auditor after workflow completion, paused admission followed by explicit resume at tick `9007199254740993`, exact consumed receipt/decision/body, unchanged task/report/resource effects and idempotent input retries without model inference.
