# Agent Note: Member execution readiness from live owners

Status: implemented

English | [中文](2026-09-28-team-member-execution-readiness.zh.md)

## Problem

An active member may have no matching execution route, and a durable idle binding may outlive its writer. Task rows on the current page cannot establish whether another member is executing. These facts require different operator actions; calling all of them active obscures both configuration failures and recovery obligations.

## Decision

`getMemberReadiness()` uses a payload-bound membership read proof. The Hub reads only the requested identities and projects current participation, active attempts, live-activation and task-concurrency capacity, pending reservations and retained binding evidence. Responses are byte-bounded, preserve requested order, and fence continuation with the Team cursor. The query does not activate, recover, fence or stop any actor.

The scoped `team/member-execution-observe` waterfall reads the actual lifecycle owners while the Hub serializer is held. Listeners delegate, do not reenter Hub reads, and return no handles or startup options. The activation controller reports its retained entries, pending starts and unresolved cleanup. TeamRun identifies managed members by its retained roster and frozen profiles; placement matches the same descriptor fields as its production activation path. Exact managed ownership takes precedence over configured placement. Conflicting owners fail rather than depend on plugin order.

AgentRuntime providers declare `participantKinds`. The registry enforces this declaration before invoking a provider; in-process supports local agents, SDK and ACP support remote agents. Readiness checks the same declaration instead of guessing from provider names. The controller treats an unsupported kind as a known pre-start rejection and releases any startup reservation. Previously accepted handles keep their ownership when a provider unregisters.

Only a live controller observation matching the durable epoch can establish resident or busy state. Unowned or unsettled epochs require recovery; capacity is not released merely because an epoch is offline. Human, service and Simulation-managed participants have explicit explanations instead of local-model role assumptions. Ready is an observation of the route and current admission facts, not a guarantee that a later task, model call or remote process succeeds.

The runtime publishes the finite requested member set atomically after its bounded pages succeed, retaining each row's observation version. It shares polling, cancellation and reconnect ownership with task capabilities. Network failure preserves an explicitly stale prior observation; authorization rejection clears it. The UI distinguishes participation from execution and rechecks independent runtime changes at the configured interval. The [capability observation decision](2026-09-28-team-task-capability-observations.md) retains task-form authorization; the [product proposal](../../proposed/architecture/2026-09-28-web-team-simulation-product-integration.md) retains the wider Simulation work; [execution-profile selection](2026-09-28-team-execution-profile-selection.md) owns deployment choices.

## Alternatives considered

**Derive execution from active membership, roles or visible task rows.** These do not establish route ownership, residency, off-page work or capacity.

**Treat durable idle/running bindings as live execution.** A stopped Host can leave those records behind. Current owner evidence is required before presenting residency; recovery retains the unresolved responsibility.

**Check provider names only.** In-process and remote runtime mechanisms accept different participant kinds. A declaration enforced by the activation operation keeps the observation and actual admission consistent.

**Read full Team snapshots or start actors to discover readiness.** Full histories are unrelated to the displayed member set, and starting work would turn inspection into execution. Bounded projections and owner-only observations avoid both.

## Consequences

Members can remain eligible while their execution configuration is unavailable. Provider removal, capacity changes and recovery ownership are observable independently of the loaded member/task page. Each query reflects a point in time across durable and live facts, not a global reservation. Route/preset/model startup validation still runs at execution. Deployment choices follow the execution-profile selection decision; principal-scoped names follow the [identity resolution decision](2026-09-28-team-identity-resolution.md).

## Verification

Pure projection and runtime tests cover ownership mismatch, recovery, capacity, kind compatibility, continuation rejection, cancellation and atomic publication. JSON and SQLite tests preserve requested order and response byte limits without journal mutations. The real Web scenario keeps an unrouted member unactivated and completes a routed member's task through the production scheduler, activation, delivery and model-facing reporting tool; no task-completion helper supplies the result.
