# @clocky/clocky-agent-runtime

English | [中文](README.zh.md)

`@clocky/clocky-agent-runtime` defines the named `ctx.agentRuntimes` registry for Participant-bound Agent activation. It separates stable Team membership from a provider-owned activation epoch and imports neither a Team Hub, model tool, subagent runtime, nor concrete Agent loop.

## Provider contract

An `AgentRuntimeProvider` registers under one placement name and receives a resolved Team, participant, Session, fresh/fork/resume seed mode, Agent composition, and pre-publication cancellation signal. A fork seed includes its source Session id and copied events. Its `activate()` call returns an `ActivationHandle` only after the activation is published; concurrent calls joining one epoch return its exact handle. The handle reports its current immutable health projection, subscribes callers to later immutable status changes, owns interruption and quiescent disposal for that epoch, and does not determine Team membership, task assignment, channel delivery, or parent authority.

`AgentRuntime.activate()` requires the returned activation and Session to match the request, rejects `stopping` or `offline` as initial residency, disposes a rejected returned handle, and emits immutable `agent-runtime/activation-changed` notifications for initial publication and later lifecycle-valid status changes. Duplicate or invalid status edges are ignored after a contained diagnostic. Provider registration is effect-scoped: unloading a provider blocks future activation requests while leaving previously returned handles with their callers.

An `AgentRuntimeFencer` registers separately for one provider name. `validate()` proves that this deployment owns a persisted plan without signaling; `fence()` resolves only after the old epoch cannot send or settle Team work. It never starts or replaces an activation.

[`clocky-agent-runtime-in-process`](../../agent-runtime/agent-runtime-in-process/README.md) supplies the first local provider. It materializes fresh and fork Session headers with their opaque Team/Participant provenance before Agent publication, preserves fork lineage, verifies provenance on cold resume, and keeps accepted handles independent of provider reload.

## Model Experience

### Activation registry

#### What the model sees

`ctx.agentRuntimes` registers no prompt section, tool, or model-visible event. A future Team client owns any model input admitted through an activated Agent.

#### Token effect

Zero direct token effect.

#### KV Cache effect

This package owns no model request prefix.

## Known Limitations and Deferred Work

- **No ACP placement** — the in-process provider composes a requested `agent.preset` when `ctx.agentPresets` is available; the SDK provider owns remote placement. ACP placement remains absent.
- **No Team delivery or durable activation registry** — the registry accepts Team-resolved values as data. [`clocky-team-activation-controller`](../../team/team-activation-controller/README.md) owns local bind-or-dispose handoff and durable health updates; Envelope delivery, receipts, scheduling, and product entry points remain outside this Service Definition.

The [AgentRuntime service-definition decision](../../../.agents/notes/implemented/architecture/2026-08-27-agent-runtime-service-definition.md) records this ownership split. The [AgentRuntime subsystem reference](../../../docs/subsystems/agent-runtime.md) defines its public registry operations and events.
