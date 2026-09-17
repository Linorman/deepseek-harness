# Agent Note: Team recovery and evidence handoffs

Status: implemented

English | [中文](2026-09-13-team-recovery-and-evidence-handoffs.zh.md)

## Problem

A durable task can lose progress when recovery resumes a different turn without its task source, when one scheduling phase consumes the entire drive, or when a review channel exists before its first request is stored. A coordinator also cannot validate a worker result if the normal tool result omits its evidence, and a replacement worker cannot rely on another worker's conversation for rework instructions.

## Decision

[Team Agent Client](../../../../packages/team/team-agent-client/README.md) retains assignment provenance on deterministic continuation messages. Session inbox records own the per-attempt continuation count across delivery replacement; an in-flight turn operation prevents duplicate concurrent recovery. Inputs pass the existing flush barrier. Output truncation and missing-report reminders have separate configured limits; exhausted model-request failures settle the exact current attempt. Cancellation, expiry, settlement, and replacement remain authoritative vetoes. A deployment may disable normal-end report reminders with zero without disabling output-limit recovery.

[The scheduler](../../../../packages/team/team-scheduler-dag/README.md) gives wake recovery, review dispatch, and new assignment independent bounded progress. Review dispatch has its own configurable allowance. [The Hub](../../../../packages/team/team-hub/README.md) derives each review channel identity from Team, task, attempt, and reviewer and revalidates the scheduler proof and policy on reuse. An attached empty channel is recoverable without an in-memory reservation or a second channel.

[Task wait](../../../../packages/team/tool-team-task/README.md) preserves retained evidence, artifact references, changed paths, verification, and integration facts. Failed results preserve their exact outcome kind. The existing tool spill policy owns oversized rendered results. Assignment input carries only the latest previous attempt and matching review reason, under a UTF-8 limit with an explicit truncation notice. It never copies the worker's full conversation or entire attempt history.

Workflow input exposes its complete nested parameters and a runnable dependency example. The coordinator prompt supplies the configured worker capability and owns delegation strategy: independently useful, verifiable work justifies delegation; an arbitrary minimum task count does not. Task tools describe operations rather than repeating strategy. Dependency briefs identify the artifact or input needed by the next task.

[Team Link](../../../../packages/core/team-link/README.md) defines provider-owned connection recoverability. Consumers pause a known non-retryable failure until a provider registration change or a new activation; unknown failures retain normal reconnect behavior. The WebSocket provider marks definite configuration and protocol failures non-retryable. A remote operation rejection alone does not establish permanence. Provider-added observers cannot veto registration.

Shared-workspace observations exclude deployment-configured runtime directories. Product bundles select the actual Clocky home, so the harness’s own Session and database writes do not become worker change evidence. Exclusions do not suppress neighboring user files.

Workflow role readiness uses the existing placement owner before channel creation. A compiling plan can retain completed activation work across retry, while its tasks remain unschedulable. Dormant authorized roles use explicit deployment routes and preserve their Session; unknown termination remains with activation recovery. This avoids a second provisioning policy in the workflow compiler. Placement registers shutdown through `ctx.effect()`, so unloading waits for admitted role startup and controller-owned termination before unload completes. Placement retains each admitted activation before workspace eligibility checks. A failed termination stays owned for retry during placement unload; successful termination removes the lease only after the controller confirms quiescence. A failed close releases its cached rejection so a later close can retry retained leases without reopening admission.

Review channels retain a payload-bearing bounded view policy. A local reviewer turn that ends without a durable response causes task/workflow wait to report an actionable error after rechecking the task revision; the worker result and review state remain intact. A durable response awaits scheduler reconciliation rather than being treated as failure. This avoids turning a reviewer transport or model failure into a fabricated worker rework decision.

## Alternatives considered

**Recover from the most recent task in memory.** Rejected because a replacement delivery and a new turn need persisted exact-attempt provenance, and another queued task can be newer than the failed one.

**Increase the shared wake budget.** Rejected because a larger assigned backlog recreates starvation; independent scheduling stages need their own bounded opportunities.

**Retry review publication without a creation identity.** Rejected because a crash or failed append leaves a channel with no request from which to recover its task identity. Deterministic provider-owned identity avoids a second durable mapping and preserves proof checks.

**Return summaries only or copy all worker history.** Rejected because summaries lose structured evidence while full conversations add irrelevant context. Task results and the latest attempt already retain the necessary facts; existing spill and explicit handoff limits bound their presentation.

**Retry every failure or automatically switch models.** Rejected because configuration and protocol errors require correction, while changing a model or preset can change task capabilities. Request retry, task retry, and connection recovery remain with their current owners.

## Consequences

Recovery messages and task evidence are model-visible Session content. Prompt, tool, and Loader tests must verify the actual messages and terminal state, including distinct continuation turns and the receiving coordinator's next request. Review recovery tests include an append failure followed by a new Hub instance; scheduler tests retain pending wakes while an idle participant receives independent work.

The [task-outcome reporting](2026-08-28-task-agent-outcome-reporting.md), [deterministic scheduler](2026-08-28-deterministic-team-dag-scheduler.md), [Team Link registry](2026-08-28-team-link-registry.md), and [exact task cancellation](2026-09-06-exact-single-task-cancellation.md) decisions retain their authority for reporting, leases, transport identity, and stop evidence. This decision complements those mechanisms; it does not replace their authorization or lifecycle rules.
