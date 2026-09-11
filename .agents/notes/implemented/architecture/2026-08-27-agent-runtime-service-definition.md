# Agent Note: AgentRuntime service definition

Status: implemented

English | [中文](2026-08-27-agent-runtime-service-definition.zh.md)

## Problem

The current continuable-subagent lifecycle combines stable child identity, parent authority, Session lineage, placement, activation, inbox delivery, and teardown in one parent-scoped implementation. A Team participant needs an activation epoch that can be provisioned, resumed, interrupted, and disposed without deriving authority from a parent Agent or Session.

## Decision

`@clocky/clocky-agent-runtime` provides `ctx.agentRuntimes`, a named effect-scoped registry of activation providers. An activation request carries Team-resolved Participant and Session identities, a fresh/fork/resume seed, Agent composition, and pre-publication cancellation. A fork names the source Session whose events it copies. A provider returns an `ActivationHandle` only after publishing its own activation epoch. The registry verifies that the returned activation and Session match the requested Team and Participant, disposes a rejected handle, and emits one immutable `agent-runtime/activation-changed` notification for each accepted handle identity.

`@clocky/clocky-agent-runtime-in-process` is the first provider. It accepts only local-agent Participants, creates fresh/fork Agents in root-owned activation scopes, materializes their paired opaque Session Team/Participant provenance before publication, preserves fork lineage, and verifies provenance before a cold resume publishes. A requested named Agent preset mounts in the Agent factory setup and is recorded on a fresh Session header; an absent or unusable preset roster rejects with a typed provider error before publication. Its handle reports immutable local running, idle, stopping, and offline health, notifies later status changes, owns cancellation and disposal, remains caller-owned across provider reload, and becomes offline when structural AgentLoop disposal releases the stale placement slot.

The registry owns provider discovery, request dispatch, request/handle identity checks, initial residency validation, lifecycle-valid status observation, and contained diagnostics. A provider owns its accepted handle; `stopping` and `offline` are not publishable initial statuses, and duplicate or invalid later status edges are not emitted. [`clocky-team-activation-controller`](../../../../packages/team/team-activation-controller/README.md) owns the bind-or-dispose handoff to the Team journal. Team membership, parent authority, channel delivery, receipts, task scheduling, and workspace allocation remain outside these packages. The definition imports neither Team Hub, subagent runtime, model tool, nor Agent loop.

## Alternatives considered

**Extend `SubagentRuntime` for Team activation.** Rejected because its stable identity and authorization model are a live parent Agent and its direct Session descendants. Adding a Team parameter would preserve those hidden ownership assumptions.

**Let the Team Hub own local Agent handles.** Rejected because durable Team authority and volatile process placement evolve independently. The Hub passes resolved Team values to a provider and does not depend on a concrete placement implementation.

**Create the in-process provider before defining a registry.** Rejected because ACP, SDK, and local placement need one provider contract before implementation-specific Session composition or delivery semantics become public.

## Consequences

The repository has a local Participant activation path with durable Session provenance, optional named preset composition, cold resume, concurrent-handle sharing, interruption, and quiescent disposal without a parent Session relationship. `parentSession` remains fork lineage and never grants Team authority. The [durable activation binding decision](2026-08-28-durable-local-activation-binding.md) owns Team-journal binding and status synchronization. Delivery, scheduling, and ACP placement remain separate decisions. The [SDK remote placement decision](2026-08-28-sdk-remote-agent-runtime-placement.md) adds a separate remote provider under this registry.

The [local Team Hub decision](2026-08-27-local-team-hub-durable-authority.md) remains the authority for durable Team projections. The [native multi-agent work-system proposal](../../proposed/architecture/2026-08-27-native-multi-agent-work-system.md) remains proposed because its placement providers, delivery, scheduler, workspace, and product phases are unfinished. Existing subagent decisions remain active for the current parent-scoped implementation; none is archived or consolidated by this definition.

## Verification

Registry and in-process-provider tests cover effect-scoped registration, duplicate rejection, stale disposer safety, rejected-handle cleanup, handle-observation deduplication, fresh/fork/resume provenance, fork lineage, successful scoped preset mounting, unavailable preset rejection, concurrent activation, running/idle/stopping/offline health, active-turn interruption, provider/AgentLoop reload, Session mismatch, unsupported Participants, and quiescent disposal. JSONL, SQLite, and query-index tests preserve paired header fields and header-only materialization across restart. Controller tests cover the later durable Team binding.
