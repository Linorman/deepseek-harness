# @clocky/clocky-sdk-protocol

`simulation/raw-archive` returns source-bound raw text parts with original journal version and explicit non-validation metadata. Parameters accept only a registered run and bounded continuation; the protocol carries no Native state, filesystem selector or permission override.

`simulation/runs-run-control` shares the Product stop-target command/result schemas. Explicit null is required for clear; the original receipt and the currently observed stopping state remain separate.

English | [中文](README.zh.md)

`simulation/world-management-fields`, `world-management-preview` and `world-management-submit` share strict Product DTOs. Submit fixes the full original form, command ID and Native preview revision/hash; clients cannot supply principal, simulated requester or policy authority. `requests-get` exposes original management outcome metadata separately from callback and business results. `world-case-cancel` requires the fixed revision/hash from its actual allowed cancellation preview. Missing quotes, substituted original choices and contradictory authenticated-user case sources reject.

`simulation/world-preflight`, `world-create`, `world-prepare` and `world-export` reuse the Host-owned strict World DTO parsers. Portable definitions select installed symbolic versions; provider configuration, principals and Native snapshots reject at ingress. Preflight is inert, creation/preparation retain their original command and return paused runs, and export returns only the original creation definition bound to its selected run. Export is not a private run backup; explicit start and cold restore use the existing control protocol.

v1 `organization.hiringFees` carries only explicitly authored one-time hiring terms: a fixed policy, hiring operation, position, distinct existing debit/credit accounts, unit, positive decimal quantity, distinct grant references and a positive simulated reservation period. Omission remains undeclared; no fee or payment default is inserted. Missing/malformed fields and unknown properties reject. Control and operational DTOs preserve the closed `resource-capacity`, `resource-history-limit` and `resource-reservation-expired` stops. The Host/Native owns account resolution, authorization, debit and recovery; the SDK introduces no payment mutation API or private compilerVersion field.

World Native allowances include `maxResourceReservationHistory`: resolved limits require a positive safe integer, while scenario inputs may request a bounded positive override. It caps all retained resource reservation history; cancellation or simulated expiry does not return history capacity. Reservation, commit and cancellation remain observable through existing operation metadata and authorized original journal text. The SDK exposes no Native transaction mutation API; missing required fields, unknown structural fields and unauthorized bodies still reject.

`simulation/world-case-inspect` shares the product's strict result parser. The common committed outcome contains only `kind`; business identities belong to required JSON `payload`. When a hiring reservation is present, its original entity, relation and plan must match that payload; other domain results do not require a hiring reservation. The former hiring outcome fields and non-JSON payloads reject. SDK methods expose actor-free product selectors rather than Native intent creation. Versioned case summaries carry `clocky.world-case/v3`, domain/operation/version and the original target. Only exact hiring apply plans own Persona; non-hiring cases refuse hiring reservations. A required null request notification means no Channel post. Old summaries and position aliases reject rather than being stripped. Required lifecycle tracks separate request, plan, callback/business and notification from the same Native prefix; contradictory details, missing tracks and v1 responses reject.

`simulation/requests-list` carries an actor-free run selector and returns distinct original receipt rows, total count, run-specific revision and optional continuation. No private command input is returned. `simulation/requests-retry` carries only `runId` and the existing `commandId`, returning the original receipt family; caller-supplied replacement input rejects. Accepted commands retain their original semantics and terminal receipts remain immutable.

`simulation/runs-preflight` shares strict product draft/result parsers. The draft omits `commandId`; `ready` carries resolved `limits`, budget interval, rule/policy/tick labels and shared model capacity, while `invalid` carries bounded field issues. Simulated `maxTime` remains a canonical positive decimal string. Catalog configuration exposes defaults and editable allowance keys; creation may carry only the allowlisted optional `limits`.

Recovery `diagnostic` is a closed stage/code/subject contract. Session subjects bind their exact Session, Team and participant; it is permitted only on failed checkpoint/restore receipts or failed checkpoint details. The wire contract never infers a category by parsing private messages and does not expose path or stack fields.

`simulation/operation-retry` requires the original `commandId`, exact `operationId`, positive safe `expectedAttemptCount` and nonempty normalized reason. Its result belongs to `retry-operation`, with `retry-operation-failed` for a retained failure. `simulation/requests-get` carries the exact original `retryOperation` input only for that family and binds its run/command to the receipt. Extra actor, configuration or forged outcome fields reject.

`simulation/runs-statuses` carries ordered independent `observed`, `missing` or `unavailable` run observations and one optional real-time shared model-pool observation. Native metrics retain exact decimal simulated intervals; token charges include reserved/unknown work, while Host permits count current infrastructure admission. New inspection/control fields may be absent on older peers, but provided fields remain strict and unavailable observations cannot carry invented zero counts.

`simulation/task-reviews-list` and `simulation/task-reviews-resolve` reuse strict scene-scoped product DTOs. The list discloses only canonical source/attempt metadata; resolve binds the original command, operation, attempt, revision, outcome and reason. `requests-get` includes the original `review` payload exactly for `kind: review`; receipt and current task phase remain independent.

`simulation/sources-inspect` uses closed actor-free source selectors and text-only results. Missing, withheld, unavailable, searching and found states remain distinct; only found results carry body fragments. A reference ordinal or known Envelope position is not an authorization credential.

`simulation/records-list` shares the product journal request/result schema. Metadata and original modes remain distinct; original bodies are ordered JSON text parts under a separate historical-content policy. Strict results reject text when mode or permission withholds it. Filters, source sequence, observed revision and read-policy version remain explicit.

`SimulationSdkRequestMap` covers authenticated product metadata, original creation/preparation requests, scheduling controls, checkpoint/restore and single-entity ingress. Inputs use opaque wire strings and reuse the strict [product parsers](../../simulation/simulation-product/README.md); results remain bounded redacted product DTOs. Provider/spec selection and principal identity are server-derived. Simulation time, slots and writer epochs remain canonical decimal strings. Management, command and ingress identities persist across exact retries; `not-found` never establishes failure. Restore verifies retained history and the current suffix without rollback or inference.

`team/task-update` requires `commandId` and returns `{ value: { receipt, task } }` on acceptance; receipt describes the original operation while task is current. `team/task-update-result` reads `applied` metadata, terminal `rejected` metadata or `not-found` for exact Team/task/command identity. Refusal reasons are closed and preserve original expected/observed revisions. Lookup omits actor proofs, submitted input and private diagnostics; absence cannot establish failure.

The shared wire protocol for Clocky SDK runtime: one newline-delimited JSON-RPC 2.0 transport class plus the named request, result, and notification types both wire ends speak. The package root enumerates the protocol consumer interface; source modules are not exported as deep imports. The server side is the [`clocky-sdk-jsonrpc-server`](../server/README.md) plugin; [`clocky-sdk-client`](../client/README.md) consumes the Team product surface, and the [Python SDK](../../../python/README.md) follows the same wire cutover. A pure library — no plugin, no Config, no registration.

`team/list` returns the authenticated principal's safe product summaries and an optional encrypted continuation. Physical scan counts, grants and goal budget bodies are absent. A continuation is bound to principal and credential generation; expiry requires an explicit first-page read. Selected-Team `readAccess` is server-derived and grants no mutation authority.


`simulation/tasks-list` returns bounded run-owned canonical task controls; `simulation/tasks-cancel` binds the original command, source operation, task revision and exact attempt or explicit no-lease `null`. Actor fields and missing fences reject. A `cancel-task` receipt confirms the original request family; `requests-get` reconstructs its immutable `cancellation` with the same run and command. Private task bodies and general Team authority are absent.

`readSimulationWorldDomain` (`read_simulation_world_domain` in Python) uses the shared `simulation/world-domain-read` method. Its strict `clocky.world-read/v1` result binds the complete original selector and independently bounded coverage; unknown fields and substituted identities, versions, sections or coverage reject. Continue with the returned cursor and original revision/readVersion. Unknown residency and nullable obligation counts remain unknown, while simulated times and norm/proposal versions remain canonical decimal strings. Reads do not restore, attach or infer; body grants never imply Session authority.

`simulation/draft-read` and `simulation/draft-save` share strict private authoring DTOs with the Host. New drafts carry a required null parent; later revisions retain their exact parent and original save ID. Saved revisions include authenticated author attribution. Unknown fields and inconsistent ancestry reject; conflicts preserve both definitions. Draft logs are separate from Native run history.

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

## Private backup export

`simulation/backup-export` selects a completed retention original by run and command. Its closed result includes the full private bundle string, source archive hash and exact bundle hash. It is a private-record read with no scheduling side effect; redacted datasets cannot use its `full-private-backup` kind. Full branch exports additionally require current ancestor disclosure grants or an explicit exact-branch `includeProvenance: true` grant; branch-only permission does not disclose ancestor bytes.

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

`simulation/world-branch`, `world-branch-read`, `world-causal` and `world-compare` reuse the strict Product experiment DTOs. Branch commands retain a caller-owned UUID, original retention cut and explicit memory policy. Causal results echo their source; comparisons echo both archived observations. Private history, target factories, authority overrides and automatic merge are outside this wire contract.
