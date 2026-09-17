# Clocky Architecture

English | [中文](architecture.zh.md)

Read this before changing anything under `packages/`. It assumes you know Cordis; if you do not, start with the [primer](cordis-primer.md) or the [tutorial](cordis-tutorial/index.md).

We recommend using an agent to explore the codebase and understand its architecture.

## Cordis

[Cordis](cordis-primer.md) is the framework under clocky: plugins contribute services, typed events, and reversible effects to a shared context. Every part of the product is a plugin, including the model adapter, the tool registry, the session log, and the agent loop itself, so every part is replaceable from configuration.

There is no privileged core to patch: you extend clocky by mounting a plugin beside the others, and registrations are effects that unwind when their plugin unloads.

## Profiles and bundles

A running `clocky` is a plugin tree composed at boot from ordered layers.

A **profile** is a named composition stored in the Harness home. It lists the bundles it stacks, holds any out-of-tree plugins it installs, and keeps the user's own `cordis.patch.yml`. `web` and `headless` ship as templates.

A **bundle** is a distribution format for Cordis config rows and the code they mount, so whatever it inserts stays patchable by the layers above it.

Each declares itself in its own `package.json` under a `clocky` field: `clocky.profile` lists a profile's bundles, and `clocky.bundle` points at a bundle's patch file.

[`clocky-base`](../packages/bundle/base/README.md) is the first layer of every profile: model adapters, tools, persistence, sandbox and approval policy, settings, credentials, telemetry. [`clocky-web-app`](../packages/bundle/web-app/README.md) adds the browser application; [`clocky-headless`](../packages/bundle/headless/README.md) adds a one-shot runner with no server at all.

Layers apply to an empty entry list in this order: each bundle in the profile's listed order, then the profile's `cordis.patch.yml`, then the home-level one, then any `--patch` overlay. A patch targets a row by id and replaces its whole config, or inserts new rows.

To see the tree your machine actually boots:

```sh
clocky --profile web --dump-config
```

Any row it prints can be replaced by a patch of your own.

Composition mechanics are in [app-boot](../packages/boot/app-boot/README.md#profiles); config fields are in the generated [config catalog](config-catalog.md).

## Core packages

Here are some core packages that contribute to the Cordis tree.

| Package | Owns | `ctx` key |
|---|---|---|
| [`core/session`](subsystems/session.md) | The append-only `SessionEvent` log and in-memory store | `ctx.sessions` |
| [`core/system-prompt`](subsystems/system-prompt.md) | Prompt-section and tool-schema assembly | `ctx.systemPrompt` |
| [`core/tools`](subsystems/tools.md) | The scoped tool registry and guarded execution pipeline | `ctx.tools` |
| [`core/agent`](subsystems/core.md) | The `Agent` interface, live registry, and `agent/*` events | `ctx.agents` |
| [`core/agent-runtime`](subsystems/agent-runtime.md) | Participant-bound Agent activation provider registry | `ctx.agentRuntimes` |
| [`core/team-link`](subsystems/team-link.md) | Activation-bound Team Link provider registry | `ctx.teamLinks` |
| [`core/team-workspace`](../packages/core/team-workspace/README.md) | Task execution-root provider registry | `ctx.teamWorkspaces` |
| [`core/team-artifact`](../packages/core/team-artifact/README.md) | Provider-independent Team artifact storage registry | `ctx.teamArtifacts` |
| [`core/agent-loop`](subsystems/core.md) | The default driver implementing that interface | `ctx.agentLoop` |
| [`core/scope`](subsystems/scope.md) | The per-agent scoped-registration primitive | library, no key |
| [`core/team`](subsystems/team.md) | Team work-system Service Definition, Envelope admission/receipts, adapter registry, and policy waterfalls | `ctx.teams` |
| [`llm/llm`](subsystems/llm-streaming.md) | Message and stream vocabulary plus the adapter seam | `ctx.llm` |

## Events

Events are the extension points, and picking the right domain is the first decision in most changes.

- **Session events** are durable facts appended to the log and broadcast through `session/event`. Use one when the fact must survive a reload.
- **Agent events** (`agent/*`) carry a live `Agent`: inbox, step, status, request, validation, continuation. Use one to observe or intercept work in flight.
- **Capability events** attach policy and adapters to a seam (`fs/*`, `tools/*`, `telemetry/*`) without importing the loop.

The [event map](event-producer-consumer.md) lists every event's producers and consumers.

## Turn flow

A **step** is one model request plus the tools it calls. A **turn** is zero or more steps: it opens before its first input is claimed and closes once nothing is owed.

```text
turn/start
  claim next-step input plus one queued message
  assemble prompt sections + tool schemas
  -> agent/pre-step                   reject | enter(messages)
     reject, or a first enter rewritten empty -> close the turn with no step
     step/start
     append entered messages as user/message
     derive model history from the log
     agent/request -> llm/stream -> assistant/chunk* -> assistant/message
     tool/call* -> tools/pre-execute -> tools/execute -> tools/post-execute -> tool/result*
     step/end
     tools owe another request, or next-step input arrived -> claim -> next step
  -> agent/turn-stopping
turn/end
```

`turn/*`, `step/*`, `user/message`, `assistant/*`, and `tool/*` are durable session events; the rest are live extension points across three domains. `agent/pre-step`, `agent/request`, `llm/stream`, and the three `tools/*` events are waterfalls, whose listeners must call `next()` to delegate; `agent/turn-stopping` is serial and has no `next()`.

Input reaches the driver through one inbox. Some messages wake it immediately; injected context waits in the inbox until another message does.

`agent/pre-step` decides what the model sees. Listeners may rewrite the claimed messages or reject them outright; a rejected or empty first claim still closes a durable turn that spent no step, so the log records the attempt. Each step reads the prompt sections and tool schemas that plugins registered.

Details: the [sequence diagram](agent-lifecycle.md), the [tool pipeline](tool-execution-pipeline.md), and [cancellation and error recovery](subsystems/core.md#the-agent-handle).

## Session log

The session log is the source of the context the model sees. `deriveMessages()` projects model history from it, and raw `assistant/chunk` events preserve replay and UI fidelity. Fork, resume, transcripts, telemetry, and persistence all derive from this stream.

**Model-visible means logged.** Anything that reaches a model request must be reconstructable from the log, and a runtime invariant asserts it. This is why a new model-visible input requires a new session event: extend `SessionEventMap` and render from the log.

## Capability seams

A **seam** is a swappable capability with three roles: a **Service Definition** declaring the interface, a **Service Provider** implementing it, and a **Consumer** using it, commonly a model-facing tool. A package may combine roles, but one role alone is not a seam; adding a capability means designing all three ([capability graph](capability-seams.md)).

Seams are why one provider swap changes the whole product. Filesystem and subprocess providers share one execution world, so pointing them at a remote sandbox moves Bash, PTY, and LSP with them, with no provider forks. [Subagent providers](subsystems/subagent.md) vary just as widely behind one interface, from a fresh child agent to a delegated turn in another product.

[`core/team`](subsystems/team.md) is the Team Service Definition. [`team/team-hub`](../packages/team/team-hub/README.md) is an explicitly mounted local provider for Team journals, channel WALs, activation projections, recovery, cursor watches, authenticated Envelope admission, durable recipient receipts, ephemeral delivery claims, revision/epoch-fenced task attempt leases, and exact-target soft interrupts. [`team/team-activation-controller`](../packages/team/team-activation-controller/README.md) exposes durable bind-or-dispose ownership at `ctx.teamActivations` and explicit fenced cold replacement; [`team/team-channel-direct`](../packages/team/team-channel-direct/README.md) supplies product direct v4 multicast with independent recipient receipts; [`team/team-channel-task-assignment`](../packages/team/team-channel-task-assignment/README.md) supplies the single-assignee assignment protocol; [`core/team-link`](subsystems/team-link.md) registers activation-bound transport clients and dynamic enrollment issuers; [`team/team-link-local`](../packages/team/team-link-local/README.md) owns local pending-delivery and soft-interrupt replay; [`team/team-link-websocket`](../packages/team/team-link-websocket/README.md) supplies the remote v4 client provider with cooperative endpoint termination and [`team/team-link-websocket-hub`](../packages/team/team-link-websocket-hub/README.md) authenticates Hub upgrades and issues activation-local credentials; [`core/team-workspace`](../packages/core/team-workspace/README.md) resolves task workspace modes to execution-root providers; [`team/team-workspace-shared`](../packages/team/team-workspace-shared/README.md) accepts only local Agents whose exact Session root already matches a canonical shared directory; [`core/team-artifact`](../packages/core/team-artifact/README.md) resolves provider-owned artifact bytes and references; [`team/team-artifact-local`](../packages/team/team-artifact-local/README.md) stores content-addressed files, patches, logs, screenshots, and reports; [`team/team-agent-client`](../packages/team/team-agent-client/README.md) claims direct or task-assignment Link notifications for a durable-bound Agent, starts only a delivery-bound task attempt, consumes the provider-owned workspace root, flushes its source before waking a model step, records its receipt, acknowledges a soft interrupt after cancellation, and reconnects an eligible binding after terminal Link failure; [`team/tool-team`](../packages/team/tool-team/README.md) exposes scoped task reporting and explicit final output; [`team/team-scheduler-dag`](../packages/team/team-scheduler-dag/README.md) expires durable leases, opens persistent task-assignment channels, and commits their assignment Envelopes deterministically without directly waking an Agent; and [`team/team-run`](../packages/team/team-run/README.md) owns the local default Team topology, reviewer routing, workspace outcome publication, and human final-result receipt used by the headless profile. Workspace allocation consumes provider roots, `publish()` materializes bounded artifacts, `integrate()` creates reviewable proposals or defers merge authority, and ACP/SDK process teardown uses bounded termination; automatic multi-host Hub recovery remains a deployment concern.

The v4 WebSocket Link supports cooperative endpoint termination. Explicitly mounted [`team/team-activation-recovery`](../packages/team/team-activation-recovery/README.md) scans matching unfinished or externally fenced SDK/ACP epochs at startup and optionally on a bounded pulse. It delegates replacement to the controller through local fencers or configured remote supervisors; locally settled epochs only retry wake cleanup.

[`team/team-channel-basic`](../packages/team/team-channel-basic/README.md) and [`team/team-channel-workflow`](../packages/team/team-channel-workflow/README.md) provide the bounded consult, discussion, and declarative workflow channel adapters used by Team compositions. [`team/team-channel-admission`](../packages/team/team-channel-admission/README.md) waits for durable endpoint consent and drives invitation expiry; [`team/team-channel-summary`](../packages/team/team-channel-summary/README.md) extracts bounded summaries from Hub-authorized WAL ranges; [`team/team-delegation`](../packages/team/team-delegation/README.md) drives the parent-owned child-Team saga through Team, channel, and workspace policies.

[`core/agent-runtime`](subsystems/agent-runtime.md) resolves named placement providers and stale-epoch fencers for one Team-resolved Participant activation. It does not own Team authority; its in-process provider creates local fresh/fork/resume activations, while its SDK provider places active `remote-agent` Participants for fresh/resume activation through the SDK lifecycle/status protocol, enrolls a fixed remote Link after durable bind when configured, and can fence an explicitly profiled same-host child before the activation controller resumes its Session under a new epoch. The activation controller owns durable bind-or-dispose handoff.

## Where new behavior goes

New behavior attaches to a documented extension point. Changing the loop itself updates this map.

| Goal | Mechanism |
|---|---|
| Add a model provider | register its adapter on `ctx.llm` |
| Add a model-facing capability | register on `ctx.tools`; its schema joins prompt assembly |
| Give one session a different capability set | compose an agent preset; a service row there needs an `isolate` realm |
| Add shell execution | register a `ctx.shell` backend; the local one spawns through `ctx.subprocess` |
| Add persistent terminal execution | register a `ctx.terminals` backend plus `clocky-tool-terminal` |
| Add a human command | register on `ctx.commands`; it dispatches without a model turn |
| Add background work | register on `ctx.jobs`; `job_*` tools collect or stop it |
| Add filesystem access or policy | register a `ctx.fs` provider or listen to `fs/*` events |
| Confine spawned processes | use a `ctx.sandbox` backend; consumers wrap argv before spawning |
| Intercept a request, tool, or turn | use its `agent/*` or `tools/*` event; `agent/turn-stopping` stops a turn |
| Add model-facing context | call `agent.inject()`; it lands in the next admitted request |
| Add UI or editor integration | drive `ctx.agents` and render from `session/event` |
| Add a Web Client Chat node | register a `ConversationNodeDefinition` + keyed renderer |
| Add durable session state | extend `SessionEventMap`; render and replay from the log |
| Generate session titles | register the sole `ctx.sessionTitle` provider |
| Manage a same-session objective | use `ctx.goals`; continue through `agent/*` |
| Fork a live session | `ctx.sessions.fork(source, boundary?, childSessionId?)` |
| Scope a registration to one agent | use that agent's `agent.ctx` |

The [extension cookbook](cookbook/extension-cookbook.md) maps features to capabilities and indexes the step-by-step guides for [packages](cookbook/adding-a-package.md), [tools](cookbook/adding-a-tool.md), [LLM adapters](cookbook/adding-an-llm-adapter.md), [Chat nodes](cookbook/adding-a-conversation-node.md), and [settings cards](cookbook/adding-a-settings-card.md).

## Task-scoped interruption

Task cancellation belongs to Team plugins. The Agent primitive `cancel(cause, { keepInbox: true, resumePending: true })` preserves retained waking input without promoting non-waking injected context. The task consumer uses the exact Session claim and corresponding `turn/end` as its stop evidence; it does not substitute `whenIdle()`, which can follow unrelated queued work. Allocation release and durable task settlement remain with their existing owners.
