# @clocky/clocky-sdk-jsonrpc-server

English | [中文](README.zh.md)

The `jsonrpc` plugin serves newline-delimited JSON-RPC over stdio so out-of-process SDK clients can create and control the local product Teams that it owns. [`HarnessSdkJsonRpcServer`](src/server.ts) owns the protocol methods and notifications; the transport and named wire types live in [`clocky-sdk-protocol`](../protocol/README.md), shared with the client SDKs; [`jsonrpc-demo`](../../examples/jsonrpc-demo/README.md) supplies the surrounding `cordis.yml` application.

## Wiring

`inject: ['agents', 'teamRuns', 'productPrincipals']`. `initialize` authenticates and retains one connection-scoped product-principal lease before any later method dispatch. `team/create` delegates the default human/coordinator/worker topology, direct-v3 ingress, and final-result lifecycle to `ctx.teamRuns`; it never creates a standalone product Session. The adapter for the requested route must already be registered by the surrounding composition; an unowned provider fails initialization. A fresh remote activation additionally requires `ctx.sessionPersistence` so its paired Team/Participant Session header is durable before publication. Other capabilities come from the surrounding `cordis.yml`.

## Config

`JsonRpcConfig.input`, `output`, and `exit` are runtime-only transport hooks; production uses process stdio and `process.exit`.

## stdout is the protocol

Stdout carries only JSON-RPC frames. The deployment must not compose a stdout logger; diagnostics belong on stderr.

## Shutdown and exit semantics

The plugin answers `shutdown`, flushes the response, disposes the root context so SDK-owned agents, subscriptions, and persistence reach quiescence, then exits with code 0. EOF and signal exits belong to the app bin, which also disposes the root context. Unloading only this plugin stops serving without exiting the process.

## Wire notes

`initialize` is the runtime-readiness boundary: when the server is mounted by a Loader composition, it waits for the current plugin tree to settle before replying, so async sibling capabilities such as initial MCP tool discovery are visible to the first Team. Hand-built contexts without Loader remain immediately usable. `initialize.serverInfo.name` is the wire-stable `clocky-sdk-runtime`. An optional positive `initialize.maxTokens` becomes the request output cap of each SDK-created coordinator; invalid values reject initialization, while omission sends no SDK cap and allows the selected adapter or provider route default to apply. `team/create` creates a default Team, admits the initial direct-v3 human content, and returns Team, coordinator transcript, and initial Envelope identities. `team/wait-final` returns only after a coordinator `team_final` Envelope has its human receipt and the local topology settles; `team/cancel` terminally releases only a Team that this process still owns. `team/archive` directly reaches the Hub through the authenticated connection's human `close` proof and can address a detached or restarted terminal Team. `team/resume` binds its required observed cursor to the active human's `activate` proof, performs provider preflight, and retains that authorization through coordinator publication. Member changes, channel open/post/close, goal update/transition, task create/update/cancel/delete/review, and archive remain actor-free on the wire and require the authenticated connection's `teamHumanActors` binder; without it they fail with the same code. A Team or participant id selects durable state but cannot authenticate a caller. List, get, audit, metrics, and bounded member/channel/task reads and watches remain available. The server streams every durable Session fact as `session.event` and every whole-agent lifecycle transition as `session.status`; Sessions are transcript sources, not product run targets. Persistence roots and persona come from `cordis.yml`.

`activation/open` reserves the complete Team/Participant/Session/epoch target, emits `starting`, then returns only after the exact Agent is published and reports `idle` or `running`. Fresh creation materializes the paired Session header before publication; resume requires its stored header to match exactly. One resident epoch owns one Session and one Team participant. `activation/link-enroll` then accepts only the same live target and matching provider-bearing durable binding. An identical enrollment is idempotent; a changed or second enrollment rejects. The server retains only a credential fingerprint, registers an activation-local WebSocket provider, and starts fixed delivery for that Agent. Retry, status, interrupt, and dispose requests repeat the whole target; an id changed to another target is rejected. `activation.status` carries the full state and increasing `statusSequence`; it is derived only from that exact Agent's lifecycle, never from an unrelated `session.status`. Interrupt keeps queued inbox work. Dispose first closes fixed delivery and removes its provider, then emits `stopping`, waits for that Agent handle to release, emits terminal `offline`, and does not exit the SDK process. These methods are the internal remote-placement contract for `clocky-agent-runtime-sdk`.

`team/artifact-read` is the read-only SDK artifact path. It selects a non-private reference from completed task results, verifies the named provider's bytes, enforces the same bounded read limit used by the Host path, and returns canonical base64. It never accepts a caller-supplied URI as authority.

## Authenticated human writes

`team/resume`, `team/member-*`, `team/channel-open`, `team/channel-post`, `team/channel-close`, goal update/transition, task create/update/cancel/delete/review, and archive accept no actor, principal, proof, or reviewer field after initialization. The server derives the connection principal only while the retained credential lease is active, and requires a composed `teamHumanActors` binder; an absent binder fails with `SDK_TEAM_AUTHENTICATED_ACTOR_UNAVAILABLE`. It binds each complete parsed payload plus its cursor or revision before Hub admission; resume binds `{ teamId, expectedCursor }` to `activate`, goals bind their full input to `goal-mutate`, task review derives its reviewer from proof, and archive binds the same cursor fence to `close`. The active human must hold the immutable grant for the requested operation. SDK deployments must provide that binder and a credential provider whose bootstrap reaches the SDK client; this package does not create a credential carrier.

## Model Experience

### Team human input

#### What the model sees

For each accepted `team/create`, the coordinator receives the caller-supplied text/image content through a durable direct-v3 Team Envelope and a provenance-bearing `user/message`. The scoped coordinator prompt requires an explicit `team_final` Envelope; this package adds no system-prompt prose or tool schema beyond the Team stack composed by `cordis.yml`.

#### Token effect

Data-dependent user-message tokens enter retained session history and are resent on later turns until another package compacts them. The JSON-RPC frames, session notifications, and server bookkeeping add zero model-context tokens.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- **No cross-process Team recovery** — list/get, quiescence, audit, metrics, and bounded participant/channel/task reads and watches are available through the mounted local Hub; automatic multi-host Hub recovery remains outside this server.
- **No detached run control** — `team/create`, plus `team/wait-final` and `team/cancel` for an active TeamRun this server still owns, remain current-run operations. Terminal archive and resume use the active human proof against the Hub. The [Team actor-proof control-plane proposal](../../../.agents/notes/proposed/architecture/2026-09-01-team-actor-proof-control-plane.md) owns remaining generic reintroduction.
- **stdout purity is deployment-enforced** — a surrounding config can still load a stdout logger and corrupt the JSON-RPC channel; this plugin does not inspect or veto sibling loggers.
- **The server does not mount adapters** — the surrounding composition must register every provider route before `initialize`; this keeps SDK transport independent of provider selection.
- **No AgentRuntime provider or Team binding is mounted** — this server owns one process-local activation record, not remote placement policy or durable Team authority.
- **No fork activation seed is accepted** — a future protocol version must define bounded, validated event transfer first.

### Single-task cancellation

The task-cancel route binds optional `reason` to the authenticated human proof’s complete payload. It returns the Hub Task snapshot, including pending cancellation and its exact attempt target, without closing the Team. [Cancellation ownership](../../../.agents/notes/implemented/architecture/2026-09-06-exact-single-task-cancellation.md).
