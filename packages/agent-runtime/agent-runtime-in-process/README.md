# @clocky/clocky-agent-runtime-in-process

English | [中文](README.zh.md)

`@clocky/clocky-agent-runtime-in-process` registers a local placement provider on `ctx.agentRuntimes`. It requires `clocky-agent-runtime`, the public `ctx.agents` factory, and `ctx.sessionPersistence`; its default provider name is `in-process` and `providerName` changes that registration name.

## Activation semantics

Only a `local-agent` Participant can use this provider. A fresh or fork activation creates an Agent in a root-owned activation scope, writes the paired opaque `SessionHeader.teamId` and `participantId` plus optional resolved `cwd` and `agentPreset` values before publication, and transfers ownership to the returned handle. A request naming `agent.preset` mounts that preset in the unpublished Agent scope; absent or unusable preset service/configuration rejects with `AGENT_RUNTIME_IN_PROCESS_PRESET_UNAVAILABLE`. Fork requests also persist their source `parentSession` and copied-event `seedLength`. A resume verifies the stored Team/Participant pair before publishing an Agent and mounts its requested preset in the same setup boundary.

Concurrent activation requests for one Team/Participant share the exact handle only when they name the same Session. `health()` reports the immutable local `running`, `idle`, `stopping`, or `offline` projection; `onStatus()` observes later transitions without replaying the initial state. The handle interrupts the current turn with `keepInbox: true`; disposal cancels, drains, removes the Agent, and releases its activation scope. Provider unloading blocks new activation while accepted handles remain caller-owned. An AgentLoop reload clears the stale local slot and marks its handle offline so a later activation creates a new epoch.

The provider rejects non-local Participants, named presets it cannot serve, mismatched Session requests, and resume provenance that names another Team participant. It does not infer parent-Agent authority; `parentSession` remains fork lineage only.

## Model Experience

### Local placement

#### What the model sees

`ctx.agentRuntimes` adds no prompt section or tool. A requested named preset contributes its scoped prompt sections and tools before the Team client delivers durable channel input to the local Agent.

#### Token effect

The provider itself has zero direct token effect; a requested preset owns its own effect.

#### KV Cache effect

This package owns no request prefix; a requested preset owns its own scoped prefix.

## Known Limitations and Deferred Work

- **No Team delivery or durable activation registry** — [`clocky-team-activation-controller`](../../team/team-activation-controller/README.md) binds an accepted local handle to the Team journal and mirrors local health. Envelope admission, receipts, scheduling, and remote placement remain outside this provider.

The [AgentRuntime decision](../../../.agents/notes/implemented/architecture/2026-08-27-agent-runtime-service-definition.md) and [subsystem reference](../../../docs/subsystems/agent-runtime.md) define the shared registry boundary.
