# @clocky/clocky-sdk-client

English | [中文](README.zh.md)

`listSimulationRequests()` discovers bounded original receipt metadata after reconnecting; `retrySimulationRequest()` retries only the backend-retained original identified by run and command. Both public clients validate the returned run, original command, requested revision and page size. They never traverse pages or retry automatically, accept no replacement command payload and preserve immutable terminal receipts. A stale continuation requires an explicit first-page read.

`preflightSimulation()` on `Clocky` and `HarnessClient` validates an allowlisted creation draft without allocating a command or run. It returns resolved immutable allowances or safe field issues and reserves no resources. Both SDK clients validate input and result before use; unknown native configuration rejects. Retain `maxTime` as an exact decimal string and pass the same draft into creation with a newly retained command identity; create rechecks current deployment readiness.

Failed checkpoint/restore receipts and checkpoint reference details may include a typed `diagnostic` with stage, fixed public code, canonical subject and independent unconfirmed-cleanup marker. These fields preserve source identity across original-result queries; raw provider text, filesystem paths and arbitrary cause fields are rejected.

`retrySimulationOperation()` grants one extra existing bounded outbox retry budget for the exact unknown operation and observed attempt count. The caller retains the original command and reason; `getSimulationRequest()` returns its normalized `retryOperation` intent and immutable receipt. The client verifies run/command/family, rejects malformed original inputs and never silently changes the target or count. Grant and query do not publish or start models; explicit scheduling performs target reconciliation. `not-found` remains uncertainty.

`getSimulationRunStatuses({ runIds })` reads one exact bounded authorized batch. Native metrics report simulated interval charges, retained resident slots and pending work; shared model-pool permits use real time and remain separate from configured budget caps. Current administrative metadata includes only trusted scenario versions and owner/driver/stop/retry facts. The client verifies every returned ID in request order and never opens or restores a run for observation.

`listSimulationTaskReviews()` and `resolveSimulationTaskReview()` expose bounded canonical metadata and original scene review commands. Review authority comes from the trusted template and authenticated run owner. Clients correlate run/revision/page or original command/kind, and `getSimulationRequest()` retains the exact original review input after response loss. See [administrative review](../../simulation/simulation-product/README.md).

`inspectSimulationSource()` follows a frozen decision source ordinal. A searching reply continues lookup with its cursor; a found reply continues text with its cursor and exact `envelope.sequence`. Responses are correlated to run, decision, source, revision and requested page size. Text requires both the Simulation source grant and current Team readership.

`readSimulationRecords()` reads `simulation/records-list` with exact run, kind/sequence filters and metadata/original mode. It validates echoed filters, revision and page size. Original JSON text needs an independent whole-run historical-content grant; record count and text-part count differ. Consumers retain the original cursor and policy version when reconstructing a record or exporting a pinned observation.

Knowledge sections preserve exact decision references and current audience checks; optional `reference` is correlated across request, selection and result. Report source bodies require explicit Host knowledge/source grants.

`watchSimulation()` performs one bounded invalidation wait with an explicit prior cursor or zero-wait probe; it returns no body and starts no execution. A reset invalidates old policy/body responses. Clients never start a recurring watch automatically.

`Clocky` and `HarnessClient` expose product metadata, original creation/preparation requests, `getSimulationControl()`, `manageSimulation()`, `getSimulationManagement()`, `checkpointSimulation()`, `restoreSimulation()`, `ingressSimulation()` and `getSimulationIngress()`. The caller retains the original command, management or ingress ID and payload across uncertain outcomes; `not-found` neither establishes failure nor creates another identity. Creation prepares a paused run without inference. Old scheduling retry returns its original intent without undoing later pause; full checkpoint/restore leave a paused owner, and restore validates the current suffix without rollback or inference. Input assignment and consumption are separate facts. Clients validate public DTOs and exact selection/revision, command kind, restore target, scheduling phase and ingress target/time. These methods require the [product composition](../../simulation/simulation-product/README.md) and never automatically retry commands or traverse pages. `inspectSimulationObject()` supports independently paged entity relationships and frozen decision context. Body permission comes from the Host; source references grant no Team/Session access, and the context view is not the complete model request.

Retain `commandId` and original fields for `updateTeamTask()` or `HarnessTeam.updateTask()`. Accepted retries return original receipt and current task; refused retries preserve the original failure after conditions change. `getTeamTaskUpdateResult()` and `HarnessTeam.updateResult()` read acceptance, terminal refusal or current absence without writing. The client checks exact Team/task/command identity across every outcome. `not-found` leaves the original operation unresolved.

The TypeScript client SDK for driving a Clocky runtime as a subprocess over stdio JSON-RPC — the design twin of the [Python SDK](../../../python/README.md) (`clocky`), sharing the same runtime peer, protocol, and layering: `Clocky` is the high-level owned-run API, `HarnessClient` the lower-level protocol client. The package root enumerates the consumer interface: the two client layers, caller-facing types, and `JsonRpcResponseError`; source modules, normalization helpers, and subscription-delivery machinery are not consumer imports. A pure library: it registers nothing on a Cordis context; the runtime process it spawns is a complete harness whose composition its own `cordis.yml` decides.

`listTeams()` reads one authorized safe directory page without scan counts or grant bodies. Keep its encrypted `nextCursor` only within the current principal generation; expired continuations require an explicit first-page read. `getTeamSelection()` reports member or parent-inspection access; reads do not start or resume a Team.

Unlike the Python SDK, the launch spec is fully explicit (`command`/`args`): this package is for repo-adjacent TypeScript consumers — including the [`clocky-subagent-clocky-sdk`](../../compat/subagent-clocky-sdk/README.md) backend and automation — that know which runtime they are launching. Bundled-runtime resolution (finding a packaged executable) remains the Python distribution's concern.


`Clocky` and `HarnessClient` expose `inboxRead({ afterCursor?, limit? })`, `inboxWatch(...)`, and `inboxAcknowledge({ throughCursor })`. They select the initialized principal's durable final inbox without accepting caller identity. Omitted read cursors resume after the shared display position; display acknowledgement never creates a channel receipt. The [inbox Consumer](../../team/team-human-client/README.md) owns persistence, permissions, bounds, and current limitations.

Team-list continuations are opaque strings, with `-1` selecting a fresh scan. `scanned` accounts for discovery work; follow `nextCursor` even when `items` is empty. On `TEAM_DISCOVERY_CURSOR_EXPIRED`, begin a fresh scan. Member, task and channel cursors remain numeric.


`listSimulationTasks()` reads bounded canonical run-owned task controls. `cancelSimulationTask()` retains one source operation, task revision, command ID and exact attempt ID; an explicit `null` requires no active attempt lease. The client rejects another run, command or receipt family. `getSimulationRequest()` returns the original `cancellation` only for `cancel-task`; query and exact retry allocate no new command. These methods neither grant general Team writes nor start inference.

Simulation catalog/preflight results require a discriminated `readiness`; `ready.model` is the exact route to pass as creation `expectedModel`. Preflight omits that confirmation and the command ID. Missing/unknown readiness fields or routes reject before application use. A model-change refusal requires a fresh review; uncertain responses retain the original command identity.

## Clocky

```ts
import { Clocky } from '@clocky/clocky-sdk-client'

await using harness = new Clocky({
  launch: { command: 'node', args: ['lib/bin.js', 'cordis.yml'] },
  credential: 'product-credential',
  provider: 'test-provider',
  model: 'test-model',
  maxTokens: 49_152,
})
const result = await harness.run('say hi')
console.log(result.finalResponse)
```

The subprocess starts lazily on first use and stays owned by the instance across `run()` calls; `close()` (or `await using`) is required so the child is always reaped. `credential` is an opaque product credential sent only during `initialize`; the client removes it from the child environment, rejects it in launch command/arguments, and redacts it from client errors. `start()` memoizes the `initialize` handshake (the workspace cwd — resolved absolute before it crosses the wire — plus the provider/model route and optional positive `maxTokens` output cap); a failed handshake reaps the runtime and swaps in a fresh client, so a later call retries with a new subprocess (until `close()`, which is terminal). The cap applies to each Team coordinator request; compaction plugins own their separate summary limits. `createTeam(input, { objective? })` returns a `HarnessTeam` with Hub-minted `id`, coordinator transcript id, `waitForFinal()`, and `cancel()`. Those methods operate only while the spawned runtime retains that TeamRun. After either terminal operation settles, `HarnessTeam.archive()` binds its observed cursor to the authenticated human's `close` authority; terminal detached or restarted Teams can be archived through `HarnessClient.archiveTeam()` by the same authenticated owner. `HarnessTeam.resume()` and the generic member/channel/goal/task mutation helpers use the connection's authenticated human proof and remain actor-free on the wire.

`run(input, { objective?, onNotification? })` creates one Team, admits the initial human Envelope, and waits for its explicit final result. It returns `RunResult { teamId, finalResponse, final, events, notifications }`; `final` includes the final channel and Envelope ids, while `finalResponse` is that human-addressed final text. `events` and `notifications` contain coordinator Session facts in wire order. Queued notifications preceding the final response are collected even when the result and notifications arrive in one transport batch. The prompt text is the default objective; textless content requires `objective`. `resumeTeam(teamId)` reads a fresh Team cursor and submits an authenticated actor-free resume request; a durable Team id is not authentication. Transport loss, timeout, stale fences, and protocol violations reject.

`inspectTeamTask({ teamId, taskId, section: "record" })` reads current fields and history counts. Select `"attempts"` or `"reviews"` with `afterCursor`, `limit` and the returned revision as `expectedRevision` to read bounded history windows. Each response must match the requested Team, task, section, revision and window; a changed task requires refreshing its record. Private artifact references are omitted; this read never activates an Agent.

## HarnessClient

`listTeams()`, `listTeamMembers()`, `listTeamTasks()`, and `HarnessTeam.channel()` expose the bounded page fields `afterCursor` and `limit`; each result includes an optional `nextCursor`. The high-level calls preserve the page boundary, so a caller can continue a large Team or channel read without asking the subprocess for an unbounded response.

The available Team inspection operations include list/get, member/channel/task reads and watches, quiescence, audit, and process-local metrics through `teamMetrics()` and `HarnessTeam.metrics()`. Team state reads include durable pending/settled human actions and provider-reported token/turn/cost usage when the mounted Team provider supports those optional records.

`HarnessClient.readTeamArtifact()` and `HarnessTeam.readArtifact()` read one visible provider-backed artifact by its durable id and return the exact reference, byte count, and base64 data. Private, ambiguous, provider-less, missing, and oversized artifacts remain unavailable through this SDK surface.

The protocol client under the owned-run API: explicit `start()`/`initialize()`/`createTeam()`/`resumeTeam()`/`waitForTeamFinal()`/`cancelTeam()`/`archiveTeam()`/`request()`/`close()`, plus notification subscriptions. `createTeam()` returns after durable Team and first-Envelope admission; `waitForTeamFinal()` and `cancelTeam()` operate only on a current local Team. After initialization, member mutations, channel open/post/close, goal update/transition, task create/update/cancel/delete/review, terminal archive, and resume use the connection's authenticated human proof when the runtime composes `teamHumanActors`; each proof binds its complete payload and observed cursor or revision, while archive and resume directly reach the Hub for detached or restarted Teams. Missing binders reject with `SDK_TEAM_AUTHENTICATED_ACTOR_UNAVAILABLE`. Team ids, cursors, revisions, and participant ids do not prove authority. `subscribe(filter?)` returns a `NotificationSubscription` (awaitable `next()`, non-blocking `tryNext()`, async iteration). Error surfaces are typed and exported from this package: `JsonRpcResponseError` (wire error response, code/data preserved), `RequestTimeoutError` (a configured bound elapsed), `SdkProtocolError` (a response outside the documented protocol), `TransportClosedError` (the runtime is gone — message carries the exit code and a bounded stderr tail).

`HarnessClient.openActivation({ target, seed })`, `enrollActivationLink({ target, binding, enrollment })`, `getActivationStatus({ target })`, `interruptActivation({ target, cause })`, and `disposeActivation({ target })` are the lower-level remote-placement lifecycle. Each `target` carries `activationId`, `teamId`, `participantId`, and `sessionId`; each returned state repeats that provenance with its residency status and `statusSequence`. `enrollActivationLink()` is for a trusted placement owner after durable bind: it supplies the matching provider-bearing binding and short-lived opaque credential to start the child’s fixed delivery, not a product Team API. Subscribe before opening, pass `activation.status` notifications through `parseActivationStatusNotification()`, and reconcile a later query by the same target and sequence. The helpers validate outgoing frames and every typed response; malformed frames reject with `SdkProtocolError`. `disposeActivation()` releases only that remote Agent and leaves the runtime process available for another activation or Team.

`close()` requests protocol `shutdown` (bounded by `shutdownTimeoutMs`, default 1000 ms), then walks a stdin-EOF → SIGTERM → SIGKILL ladder (`disposeEofGraceMs` default 6000, `disposeGraceMs` default 3000) until the process has actually exited. The ladder is private to this client: it runs outside any harness context, so it cannot ride the [`clocky-subprocess`](../../subprocess/README.md) service — the seam's documented exception for SDK-managed transports. `detached` is an opt-in hosting control for a stale-process fencer; normal callers omit it, and enabled clients reap the whole isolated POSIX group. It is idempotent, and a closed client refuses reuse.

`HarnessClientOptions.env` replaces the child environment entirely when given (`undefined` inherits the parent's); callers own credential policy — `scrubbedParentEnv` from `clocky-subprocess` is the shared scrub base for isolation-minded launches.

## Model Experience

None, as this is a client-process library; the model runs in the spawned runtime, whose experience is owned by the plugins its `cordis.yml` composes.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **No bundled-runtime resolution** — callers name the runtime executable explicitly; packaged-executable discovery stays Python-side until a TypeScript distribution consumer exists.
- **No detached current-run control** — `waitForTeamFinal()` and `cancelTeam()` remain tied to a TeamRun retained by this SDK server. Resume and terminal archive use the authenticated human proof against the Hub; the [authenticated product-principal Team control note](../../../.agents/notes/implemented/architecture/2026-09-04-authenticated-product-principal-team-control.md) records the connection binding.
- **No automatic integration** — workspace providers own explicit publish/integrate authority and never auto-merge user changes.
- **No AgentRuntime provider or Team binding** — these helpers expose the lifecycle wire only. A placement provider owns process loss, status-sequence reconciliation, and durable Team bind-or-dispose handoff.
- **No fork activation seed** — remote activation accepts fresh or persisted resume; it does not transfer Session event history.
- **Client→server notifications and server→client requests are unimplemented** on both wire ends; the transport carries them for future approval flows.

### Single-task cancellation

`cancelTeamTask()` and `HarnessTeam.cancelTask()` accept an optional reason and return durable cancellation progress. Assigned or running results still retain live work; observe task state until cancelled. This operation leaves the Team available for other tasks. [Cancellation ownership](../../../.agents/notes/implemented/architecture/2026-09-06-exact-single-task-cancellation.md).
