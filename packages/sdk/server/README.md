# @clocky/clocky-sdk-jsonrpc-server

English | [中文](README.zh.md)

`simulation/requests-list` and `simulation/requests-retry` parse exact actor-free selectors before resolving current administration. Metadata discovery exposes original receipts without stored inputs or native ownership. Explicit retry dispatches only accepted backend-retained semantics, keeps terminal outcomes unchanged and rechecks the original operation admission. Cold accepted review or outbox-grant retry still requires explicit owner restoration.

`simulation/runs-preflight` parses the actor-free draft before resolving current authenticated administration. The read allocates no run or durable command and starts no inference; safe readiness issues are distinct from authentication, undeployed-service and unexpected internal failures. Creation independently rechecks readiness before recording its original command.

Original maintenance outcomes forward only explicitly typed safe source diagnoses from the owning pipeline. Primary failure and unconfirmed cleanup remain distinct; ordinary private exceptions continue through the existing redaction path.

`simulation/operation-retry` uses the current authenticated administration owner after strict input parsing. The original accepted grant outlives its transport waiter, but queued/native admission rechecks current authorization. No retry target is published and no inference is started by this method or original-result lookup. A cold original receipt remains readable; a new cold grant needs explicit owner restoration. Publication resumes only through explicit scheduling.

`simulation/runs-statuses` parses the bounded exact batch before service resolution, prefers installed administrative enrichment, and otherwise uses the native product reader. Every run remains independently observed under the current credential lease, while the complete batch retains authorization and byte bounds. Administrative metadata does not grant control or body access and never acquires a cold execution owner.

`simulation/task-reviews-list` and `simulation/task-reviews-resolve` dispatch through the installed administration owner and current authenticated lease. Template opt-in grants only that scene's run-owner review; ordinary Team human writes remain independently denied. Cold original results are journal reads; cold review writes require explicit restore.

`simulation/sources-inspect` resolves the current product source reader and forwards the authenticated call. That owner separately verifies its frozen selection/disclosure policy and the current Team human reader before and after source IO; the SDK has no raw-channel fallback.

`simulation/records-list` routes to the authenticated directory read owner. Original sequence inspection uses the same read-only native history as metadata; it neither opens an execution owner nor grants access through a source reference. Independent whole-run historical-content grants govern original JSON text and are rechecked across provider IO.

Authenticated `simulation/*` dispatch resolves the currently mounted product directory or administration service. It forwards the connection lease through each product operation and rejects late responses after credential replacement or retirement. Missing optional services return `SIMULATION_PRODUCT_UNAVAILABLE`; known product failures preserve their public code, while uncategorized diagnostics are withheld. Metadata and original-result reads never open a native writer. Accepted creation, preparation and maintenance belong to the administration service and outlive a disconnected SDK waiter; stopping this runtime process drains that owner through Cordis teardown. Scheduling uses original ordered intents, checkpoint collection leaves the run paused, and restore validates retained history/current suffix without rollback or inference. Ingress targets one allowed entity with server-derived attribution and exposes assignment separately from consumption.

`team/task-update` binds original command identity, revision and editable fields to current human authority. Accepted replies expose original receipt and current task with private artifacts removed; committed semantic refusals preserve their original native failure code. `team/task-update-result` reads acceptance/refusal metadata under the Team read guard before and after provider success or failure. Canonical-parent readership permits lookup without edit authority.

The `jsonrpc` plugin serves newline-delimited JSON-RPC over stdio so out-of-process SDK clients can create and control the local product Teams that it owns. [`HarnessSdkJsonRpcServer`](src/server.ts) owns the protocol methods and notifications; the transport and named wire types live in [`clocky-sdk-protocol`](../protocol/README.md), shared with the client SDKs; [`jsonrpc-demo`](../../examples/jsonrpc-demo/README.md) supplies the surrounding `cordis.yml` application.

`team/list` uses current-principal safe metadata and encrypted continuations; it omits grants, goal budget bodies and scan counts. Selected-Team management reads retain direct or canonical parent authority through IO and recheck before publication, including failed reads. Raw channel reads/waits resolve ownership privately. Selection exposes member or parent-inspection access; missing/private Team refusal is `SDK_TEAM_FORBIDDEN`. Artifact results share the Host private-reference projection. See the [SDK reader decision](../../../.agents/notes/implemented/architecture/2026-09-28-sdk-principal-team-readers.md).


`simulation/tasks-list` and `simulation/tasks-cancel` dispatch to the currently composed administrative owner under the current transport credential. Cancellation requires the exact original operation, revision and attempt or explicit no-lease `null`; strict parsing rejects actor fields before owner lookup. Durable receipts and `requests-get` preserve the original cancellation across response loss. Deployment absence, permission rejection and invalid input remain distinct; this route grants no ordinary Team mutation authority.

## Wiring

`inject: ['agents', 'teamRuns', 'productPrincipals']`. `initialize` authenticates and retains one connection-scoped product-principal lease before any later method dispatch. `team/create` delegates the default human/coordinator/worker topology, direct-v3 ingress, and final-result lifecycle to `ctx.teamRuns`; it never creates a standalone product Session. The adapter for the requested route must already be registered by the surrounding composition; an unowned provider fails initialization. A fresh remote activation additionally requires `ctx.sessionPersistence` so its paired Team/Participant Session header is durable before publication. Other capabilities come from the surrounding `cordis.yml`.

## Config

`maxPendingNotificationFrames` (default 4096) and `maxPendingNotificationBytes` (default 8388608) bound notifications through authorization and output drain, including the active frame and complete UTF-8 JSON-RPC encoding. Overflow or unexpected publication failure closes the transport, disposes the root runtime, and exits with code 1. `JsonRpcConfig.input`, `output`, and `exit` are runtime-only transport hooks; production uses process stdio and `process.exit`.

## stdout is the protocol

Notifications recheck current Team membership before writing; Session facts require a durable member binding or the server's exact owned remote Agent. Reinitialization discards old-generation packets. Credential/provider retirement stops idle and pending streams; shutdown removes the retirement listener before releasing its lease. See [notification ownership](../../../.agents/notes/implemented/architecture/2026-09-29-sdk-principal-notification-ownership.md).

Stdout carries only JSON-RPC frames. The deployment must not compose a stdout logger; diagnostics belong on stderr.

## Shutdown and exit semantics

The plugin answers `shutdown`, flushes the response, disposes the root context so SDK-owned agents, subscriptions, and persistence reach quiescence, then exits with code 0. EOF and signal exits belong to the app bin, which also disposes the root context. Unloading only this plugin stops serving without exiting the process.

## Wire notes

`initialize` is the runtime-readiness boundary: when the server is mounted by a Loader composition, it waits for the current plugin tree to settle before replying, so async sibling capabilities such as initial MCP tool discovery are visible to the first Team. Hand-built contexts without Loader remain immediately usable. `initialize.serverInfo.name` is the wire-stable `clocky-sdk-runtime`. An optional positive `initialize.maxTokens` becomes the request output cap of each SDK-created coordinator; invalid values reject initialization, while omission sends no SDK cap and allows the selected adapter or provider route default to apply. `team/create` creates a default Team, admits the initial direct-v3 human content, and returns Team, coordinator transcript, and initial Envelope identities. `team/wait-final` returns only after a coordinator `team_final` Envelope has its human receipt, the local topology settles, and admitted notifications finish publication; `team/cancel` terminally releases only a Team that this process still owns. `team/archive` directly reaches the Hub through the authenticated connection's human `close` proof and can address a detached or restarted terminal Team. `team/resume` binds its required observed cursor to the active human's `activate` proof, performs provider preflight, and retains that authorization through coordinator publication. Member changes, channel open/post/close, goal update/transition, task create/update/cancel/delete/review, and archive remain actor-free on the wire and require the authenticated connection's `teamHumanActors` binder; without it they fail with the same code. A Team or participant id selects durable state but cannot authenticate a caller. List, get, audit and bounded member/channel/task reads and watches require current principal read authority; process-local metrics retain Host metadata semantics. The server streams currently authorized Session facts as `session.event` and their whole-agent lifecycle transitions as `session.status`; Sessions are transcript sources, not product run targets. Persistence roots and persona come from `cordis.yml`.

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
