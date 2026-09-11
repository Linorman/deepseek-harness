# @clocky/clocky-sdk-protocol

English | [中文](README.zh.md)

The shared wire protocol for Clocky SDK runtime: one newline-delimited JSON-RPC 2.0 transport class plus the named request, result, and notification types both wire ends speak. The package root enumerates the protocol consumer interface; source modules are not exported as deep imports. The server side is the [`clocky-sdk-jsonrpc-server`](../server/README.md) plugin; [`clocky-sdk-client`](../client/README.md) consumes the Team product surface, and the [Python SDK](../../../python/README.md) follows the same wire cutover. A pure library — no plugin, no Config, no registration.

## Transport

`JsonRpcLineTransport` frames JSON-RPC 2.0 over caller-owned byte streams, one compact JSON frame per `\n`-terminated line. Frames with `id` and `method` are requests, `id` alone is a response, `method` alone is a notification; malformed JSON lines are ignored. `start()` attaches stream listeners, `close()` detaches them and rejects pending requests without destroying the streams. Missing request handlers answer `-32601`; ordinary handler rejections answer `-32603`, while `JsonRpcRequestError` preserves its selected code and optional data. An error response rejects the pending `request()` with `JsonRpcResponseError`, which preserves the wire `code` and optional `data`. `JsonRpcTransportPeer` is the outbound surface (request/notify) the server class is typed against.

## Wire types

The Team list, participant list, task list, and channel-read methods are page contracts. Their params accept an optional exclusive `afterCursor` and positive `limit`; their results carry at most one bounded page and an optional `nextCursor`. List cursors are provider-order ordinals, while channel-read cursors are channel-WAL sequences. Omitting the fields selects the server's bounded default page; callers that need the rest continue explicitly from the returned cursor.

`types.ts` names every payload of the protocol served by `HarnessSdkJsonRpcServer`:

| Direction | Method | Types |
|---|---|---|
| client→server | `initialize` | `InitializeParams` → `InitializeResult` |
| client→server | `team/create` | `TeamCreateParams` → `TeamCreateResult` |
| client→server | `team/wait-final` | `TeamWaitFinalParams` → `TeamWaitFinalResult` |
| client→server | `team/cancel` | `TeamCancelParams` → `TeamCancelResult` |
| client→server | `team/archive` | `TeamArchiveParams` → `TeamArchiveResult` |
| client→server | `team/goal-update` | `TeamGoalUpdateParams` → `TeamGoalUpdateResult` |
| client→server | `team/goal-transition` | `TeamGoalTransitionParams` → `TeamGoalTransitionResult` |
| client→server | `team/metrics` | `TeamMetricsParams` → `TeamMetricsResult` |
| client→server | `team/artifact-read` | `TeamArtifactReadParams` → `TeamArtifactReadResult` |
| client→server | `activation/open` | `ActivationOpenParams` → `ActivationOpenResult` |
| client→server | `activation/link-enroll` | `ActivationLinkEnrollParams` → `ActivationLinkEnrollResult` |
| client→server | `activation/status` | `ActivationStatusParams` → `ActivationStatusResult` |
| client→server | `activation/interrupt` | `ActivationInterruptParams` → `{}` |
| client→server | `activation/dispose` | `ActivationDisposeParams` → `ActivationDisposeResult` (terminal state) |
| client→server | `shutdown` | no params → `{}` |
| server→client | `activation.status` | `ActivationStatusNotification` |
| server→client | `session.event` | `SessionEventNotification` (every session in the runtime, unfiltered) |
| server→client | `session.status` | `SessionStatusNotification` (whole-agent `running`/`idle` transition) |

`HarnessSdkRequestMap` and `HarnessSdkNotificationMap` index these by method name. `team/create` records a non-empty objective, creates the default local topology, and admits one non-empty direct-v3 human content sequence. Its receipt exposes the Hub Team id, coordinator transcript id, and initial Envelope id; `team/wait-final` and `team/cancel` operate only on that server's current TeamRun. The wire carries no actor, principal, proof, or caller-selected identity. After `initialize` authenticates the connection, a runtime composed with `teamHumanActors` can bind resume, member changes, channel open/post/close, goal update/transition, task create/update/cancel/delete/review, and terminal archive to its active human; without that binder they fail with `SDK_TEAM_AUTHENTICATED_ACTOR_UNAVAILABLE`. Resume requires the observed Team cursor, binds the complete input to `activate`, and retains the proof through coordinator recovery. Goal writes bind the complete parsed payload and observed goal revision. Archive directly reaches the Hub and can address a detached or restarted terminal Team when the active human has `close` authority. List/get, quiescence/audit, metrics, and bounded member/channel/task reads and watches remain available. Every activation command carries one exact `target` (`activationId`, `teamId`, `participantId`, `sessionId`); a returned or notified `SdkActivationState` repeats that target, adds a closed residency status, and carries a nondecreasing per-epoch `statusSequence` for query/notification ordering. `activation/open` accepts only `fresh` and `resume`; the protocol does not transfer fork history. `activation/link-enroll` is a trusted placement-owner operation after the Hub has committed the matching binding: its binding repeats the target and names the placement provider, while its short-lived opaque credential must not be logged or persisted. `JsonRpcRequestError` lets a request handler preserve a selected wire code and structured data instead of collapsing a validated rejection to `-32603`. Exported zod schemas strictly parse bootstrap, Team, shutdown, activation command, result, and notification wrappers; the merge-extensible `ContentBlock` parser requires a non-empty type while preserving deployment-specific block fields.

`team/task-create` requires a caller-supplied idempotency key and retains an optional `TeamTaskIntegrationSpec` with the completed source task/attempt, provider, target, expected target revision, and proposal or integrate mode. The server binds the complete parsed create payload to the authenticated human proof. `team/task-review` accepts only team, task, revision, decision, and reason; the Hub derives the reviewer from that proof.

`team/artifact-read` accepts a Team and durable artifact id, selects the exact non-private reference from completed task results, and returns verified bytes as canonical base64 with a bounded byte count. Provider-less, private, ambiguous, missing, or oversized artifacts fail with a typed SDK Team error.

`team/metrics` returns process-local counters for active admissions, Team events, channel events, policy denials, adapter failures, delivery claims, task assignments, retries, and audit projection repair/failure. Team state responses additionally carry durable pending/settled human-action records and provider-reported token/turn/cost usage when the Team provider supports them. Archive requests carry the caller's observed Team cursor and bind it to the active human's `close` proof; foreign, stale, active, or unauthorized Teams reject at the Hub. The [Team actor-proof control-plane proposal](../../../.agents/notes/proposed/architecture/2026-09-01-team-actor-proof-control-plane.md) owns generic authenticated reintroduction.

`InitializeParams.maxTokens` is an optional positive safe integer that caps each SDK-created Team coordinator request; omission allows the selected adapter's exact-model default to apply, or otherwise preserves provider behavior. Clients can inspect Session facts through `session.event` and `session.status`, but Sessions are not product run targets. The notification payload types depend on `SessionEvent` (`clocky-session`), and the Team input parser depends on `ContentBlock` (`clocky-llm`). `serverInfo.name` stays the wire-stable `clocky-sdk-runtime`.

## Authenticated human writes

`team/resume`, `team/member-*`, `team/channel-open`, `team/channel-post`, `team/channel-close`, goal update/transition, task create/update/cancel/delete/review, and terminal archive remain actor-free on the wire. After `initialize` authenticates the connection, a runtime composed with `teamHumanActors` derives the owned active human and binds each complete parsed payload plus its cursor or revision before Hub admission. Without that binder, these methods fail with `SDK_TEAM_AUTHENTICATED_ACTOR_UNAVAILABLE`. The active human must hold the immutable grant for the requested operation.

## Model Experience

None, as this package defines the client-facing wire protocol; the model-visible surfaces belong to the runtime plugins composed behind the serving [`clocky-sdk-jsonrpc-server`](../server/README.md) entry.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **No protocol-version negotiation** — Team lifecycle and graph operations are versioned by the selected Hub/adapters; the handshake carries only `serverInfo.version` (`0.0.1`, unvalidated by clients) and the pre-release runtime makes no compatibility promise.
- **No fork seed or Team binding** — the first lifecycle wire supports fresh/resume only and neither creates an AgentRuntime provider nor records a Team journal binding.
- **Remote placement remains internal** — `activation/*` is the AgentRuntime SDK contract, not a product Team management API.
- **No detached run control** — current server-owned `team/wait-final` and `team/cancel` remain narrow TeamRun operations.
- **Server→client requests are dead capability** — the transport supports them, but the server never sends one; the Python SDK's responder surface exists for future approval flows.

### Single-task cancellation

Task cancellation accepts Team/task ids, `expectedRevision`, and optional `reason`. Responses retain `TeamTaskSnapshot.cancellation`; assigned or running phases report pending owner termination rather than completed cancellation. Task deletion does not accept cancellation reasons. [Cancellation ownership](../../../.agents/notes/implemented/architecture/2026-09-06-exact-single-task-cancellation.md).
