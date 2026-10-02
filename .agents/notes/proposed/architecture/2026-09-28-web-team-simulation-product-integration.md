# Agent Note: Capability-aware Team controls and Simulation product ownership

Status: proposed

English | [中文](2026-09-28-web-team-simulation-product-integration.zh.md)

## Problem

Team presentation can confuse missing page-local information with authoritative absence, and its forms offer choices that the default human grant or execution placement cannot satisfy. Simulation has durable world and coordination services, but no complete Web run-management owner; ordinary Team controls cannot represent its scheduling, checkpoint and recovery semantics.

## Proposal

Preserve Team, Simulation and Session as separate authoritative owners. Add authenticated capability/readiness projections for Team controls, retain identity and selected dependencies independently of list pages, and keep empty and failed collections actionable. Backend authorization remains mandatory for every mutation.

Add an opt-in Simulation product service that owns run discovery, access control, one live handle per provider/run identity, and a bounded versioned scenario driver. Reuse durable phase management, ingress, checkpoint and restore operations. Browsing never starts inference; restore validates retained history and current suffixes and returns paused rather than rolling the world back. A dedicated UI consumes bounded authorized projections instead of complete world snapshots.

Automatic Simulation task execution requires a separately validated executor with durable task/attempt/decision linkage and narrowly scoped Hub authority. Keep ordinary Team delivery bypasses closed and actor tools restricted. Existing task creation and reconciliation do not establish automatic execution. The [product design](../../../../design/webui-team-simulation-2026-09-28/design.md), [API/runtime design](../../../../design/webui-team-simulation-2026-09-28/api-and-runtime.md), and [implementation plan](../../../../design/webui-team-simulation-2026-09-28/implementation-plan.md) own the detailed proposal and acceptance matrix.

## Relationship to existing decisions

The [product-directory decision](../../implemented/architecture/2026-09-29-simulation-product-directory.md) implements immutable registration, authenticated Host metadata/history reads, and sectioned object metadata collections. This proposal retains private-context and event-history reads, Web/SDK integration, live owner coalescing, administrative control and automatic execution requirements.

The [Team workspace decision](../../implemented/architecture/2026-09-11-team-workspace-ui.md) remains active: its navigation, read-only inspection and UI ownership still apply. The [durable Simulation proposal](2026-09-17-durable-simulation-coordination.md) remains active: its world, writer, outbox and recovery rules are prerequisites. The [Team product-convergence proposal](2026-09-04-native-multi-agent-p1-product-convergence.md) retains its broader protocol scope. This proposal adds product adapters and execution readiness without superseding those independent decisions; no note is archived or rejected.

The [persistent creation decision](../../implemented/architecture/2026-09-29-persistent-company-creation.md) owns public allocation, original request outcomes and paused preparation handles; scheduling, ingress, restore and automatic execution retain separate owners.

## Alternatives considered

**Reuse ordinary Team controls for Simulation.** A Team lifecycle action does not own Simulation scheduling or cross-owner checkpoint collection, and can imply unsupported authority. The product service must route each operation to its actual owner.

**Open and close a run for every HTTP request.** This conflicts with long-lived execution ownership and coordinator exclusion. A Host-owned handle outlives browser requests, while discovery uses safe read projections.

**Enable normal Team tools and delivery for Simulation actors.** This bypasses accepted operations, restricted model tools and durable publication proofs. Automatic tasks need explicit executor authority and recovery responsibilities.

**Rewrite the UI and runtime together.** Existing lifecycle and replay tests provide useful guarantees. Fix observed behavior first, split modules by responsibility, and optimize only measured costs.

## Acceptance criteria

Cross-page owner and dependency behavior, empty-state actions, default-grant controls and member readiness pass component and real-Host browser checks. Simulation supports authenticated bounded inspection, idempotent management, a production scenario driver, and keyless JSON/SQLite checkpoint/recovery journeys. Automatic task mode remains unavailable until assignment, durable input, real decision execution, completion/review and reconciliation pass without test helpers completing tasks. New executor responsibilities participate in checkpoint and crash recovery.

## Risks

A run directory introduces recoverable multi-owner creation work; HTTP cancellation must not abandon accepted operations. Capability data can become stale and must never replace authorization. Private world and model context require explicit read projections. Executor authority adds protocol and persistence work, so it ships separately from read-only inspection. Performance improvements require measured evidence and must preserve replay and fencing checks.
