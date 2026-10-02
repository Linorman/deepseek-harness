# Agent Note: Authenticated task-authoring capability observations

Status: implemented

English | [中文](2026-09-28-team-task-capability-observations.zh.md)

## Problem

A workspace mode in a browser enum does not prove that the human can use it, a provider serves it, or a scheduler can assign it. Team journal notifications also cannot reveal a provider unloading. Repeated full Team snapshots to answer these questions copy unrelated task and activation history.

## Decision

The human-proof issuer uses `resolveHumanActor()` to select one active principal-owned member and its operation names under the Hub serializer. `getTaskCapabilities()` requires an exact `task-capabilities-read` membership proof, checks the current grant, normalizes authored scopes with task-creation rules, and projects lifecycle, task-count, wall-time and attempt limits without exposing grants or authorized path prefixes.

Host `team.capabilities` combines that projection with the actual workspace registry and the `team/task-scheduling-modes` waterfall. Live schedulers advertise their configured modes through effect-owned listeners and delegate before combining results. Missing providers and unsupported scheduling modes have distinct reason codes. An observation digest covers the principal credential generation, Team projection and observed runtime availability; it is not a write credential or a promise that a later assignment succeeds. The existing Team read guard retains the same exact identity proof across the scheduler/provider observation and revalidates it on success or failure. Ending durable membership during this IO withholds prior capability hints, even if the transport credential remains valid. Task creation still repeats all authorization, graph, budget, placement and policy checks.

The client runtime owns one form observation and its cancellation, failure and reconnect state. The UI plugin supplies a validated polling interval so availability converges even without Team WAL changes. Closing the form releases reads and timers. Network failure retains display hints but prevents submission; an authorization denial clears those hints. Scope edits, provider changes and retries never rewrite the form draft. Advanced controls explain unavailable modes and permit explicit removal of stale scope selections.

The [bounded control-plane decision](2026-09-01-bounded-team-control-plane-pages.md) retains collection and inspection ownership. The [Team/Simulation product proposal](../../proposed/architecture/2026-09-28-web-team-simulation-product-integration.md) retains member readiness, identity resolution, attention and Simulation requirements; these observations do not implement those capabilities.

## Alternatives considered

**Filter a browser-owned mode enum.** The browser lacks current grants, provider registration and scheduler configuration, so guessed defaults either invite predictable rejections or conceal supported options.

**Expose complete grants and Team snapshots.** This discloses authorized path prefixes and copies histories unrelated to authoring. The proof issuer needs only membership and operation names; the form needs decisions for its supplied scopes.

**Invalidate only on Team journal updates.** Workspace and scheduler registrations change independently. Configured polling rechecks their actual owners without requiring a Team mutation or full-page reload.

## Consequences

The form can explain known authoring restrictions without widening any mutation authority. Queries are read-only observations across separate owners, not atomic reservations or policy preapproval. Fine-grained budget, placement and custom policy failures still belong to the write path. Polling adds bounded requests while a form is open; it pauses on disconnect and ends on disposal. Member execution readiness remains a separate query because workspace-mode availability does not imply a matching member or free capacity.
