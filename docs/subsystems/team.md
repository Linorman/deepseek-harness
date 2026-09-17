# Team work system

English | [中文](team.zh.md)

`@clocky/clocky-team` defines the durable Team vocabulary and the `ctx.teams` Service Definition. [`@clocky/clocky-team-hub`](../../packages/team/team-hub/README.md) is the explicitly mounted local provider: it owns journals, channel WALs, source-specific durable audit projections, roster/task/activation projections, bounded root-or-child hierarchy, authenticated Envelope admission, derived pending deliveries, receipt cursors, recovery, cursor watches, ephemeral delivery claims, fenced task attempts, revisioned Team goals, durable declarative workflow plans, process-local metrics, and durable archival of terminal Teams without deleting their state. [`@clocky/clocky-team-activation-controller`](../../packages/team/team-activation-controller/README.md) exposes the bind-or-dispose owner at `ctx.teamActivations`; [`@clocky/clocky-team-channel-direct`](../../packages/team/team-channel-direct/README.md) supplies product direct v4 multicast with independent recipient receipts; [`@clocky/clocky-team-link-local`](../../packages/team/team-link-local/README.md) owns local pending-delivery replay; [`@clocky/clocky-team-agent-client`](../../packages/team/team-agent-client/README.md) owns local Agent inbox admission and consumes provider-owned task workspace roots; [`@clocky/clocky-team-scheduler-dag`](../../packages/team/team-scheduler-dag/README.md) expires leases, keeps compiling workflow tasks dormant, makes deterministic shared-work assignments, and can run an explicitly configured terminal-channel retention drive; [`@clocky/clocky-command-team-goal`](../../packages/team/command-team-goal/README.md) scopes human `/goal` control to a bound Team participant; and [`@clocky/clocky-team-run`](../../packages/team/team-run/README.md) owns the local default human/coordinator/worker topology, reviewer routing when configured, workspace outcome publication, declarative workflow compilation, and explicit final-result receipt. Local and WebSocket Links, Host Remotes, the TypeScript/Python SDKs, and the Web Team page consume this spine. The worktree provider supplies an opt-in policy/CAS integration authority, and SQLite-backed Hubs reconcile externally appended projections before reads. Automatic leader election/failover, remote push authority, and hard cancellation remain separate deployment work. The [local Team Hub decision](../../.agents/notes/implemented/architecture/2026-08-27-local-team-hub-durable-authority.md) owns the local-provider rationale.

[`@clocky/clocky-team-channel-basic`](../../packages/team/team-channel-basic/README.md) supplies bounded consult and discussion protocols, and [`@clocky/clocky-team-channel-workflow`](../../packages/team/team-channel-workflow/README.md) supplies bounded declarative workflow transitions. Their adapters validate manifests and fold state without executing delivery or model turns.

[`@clocky/clocky-team-workspace-sandbox`](../../packages/team/team-workspace-sandbox/README.md) supplies provider-owned local `sandbox` roots with optional source seeding, bounded changed-file publication, and an opt-in portable target-directory integration authority. [`@clocky/clocky-team-workspace-e2b`](../../packages/e2b/team-workspace-e2b/README.md) supplies opt-in `remote` roots inside an existing E2B execution world and an opt-in portable target-directory integration authority while that world remains live. Both providers verify exact allocation manifests; neither performs Git ref integration or claims a distributed lock.

The local Hub's `compactChannel()` is an explicit retention boundary for terminal channels: it requires an authorized actor, no pending delivery, a current audit projection, and a checkpoint before preserving the configured audit tail and removing old source records. The scheduler's optional retention drive supplies the actor and a bounded source tail, while the Hub remains the authority for every watermark check. Older cursors receive a typed compaction error.

## Independent identities

`TeamId`, `ParticipantId`, `ActivationId`, `ChannelId`, `EnvelopeId`, `TeamTaskId`, and `TaskAttemptId` are separate brands. Durable or wire input passes through the matching Zod parser; no Session identity is rebranded as a Team identity. An activation binding couples one epoch to an exact Session and named provider. A Participant retains offline epochs, uses one Session across epochs, and has at most one resident epoch. Human Participants retain a closed immutable `TeamParticipantOwner`: an interactive binding names a product principal and an unattended root names the system; replay rejects missing, malformed, changed, or duplicate active principal owners. A root Team has `depth: 0`; a nested Team carries paired `parentTeamId` and `parentTaskId`, its resolved depth, and its inherited `maxTeamDepth`. Team, participant, activation, channel, and task lifecycle values are closed unions. Pure transition checks reject an invalid initial, backward, or terminal edge before a provider appends its record.

Tasks freeze ancestry, capability requirements, priority, read/write scopes, workspace mode, budget, a closed review route, and an attempt limit. A task compiled from a workflow plan also freezes its plan and template provenance. A task-create command carries only a retry key plus runtime proof. The local Hub derives either the active coordinator activation binding or an authenticated human creator with only Team and Participant ids, then revalidates the proof before replay or policy. Workflow-plan admission remains coordinator-only and derives its durable actor. A current lease belongs to one active `assigned` or `running` attempt and records the owner Participant plus an agent epoch where applicable. Settled attempt history retains immutable outcome summaries or failures and never reuses an id or ordinal. A `none` review route completes a successful attempt directly; a participant route enters `review` and retains the exact reviewer's accepted or rework decision with a reason. `team-scheduler-dag` keeps workflow tasks dormant until their whole plan is `ready`, then uses the provider's first durable task-record order after priority, capability surplus, active lease load, and Participant id to make bounded shared-work assignments under the plan parallelism cap. Workspace providers publish bounded changed-path and artifact manifests through an explicit non-integrating boundary; the worktree provider materializes file references with provenance and its optional policy/CAS integration path supplies merge authority, while sandbox and E2B providers can apply their own portable change sets to explicit target directories under provider-specific fences. Typed Team closure and cancellation commands carry JSON-only fields plus an opaque runtime authority; under the Team/channel locks, the Hub derives and persists a durable participant or scoped-system actor, never a caller-selected actor or proof. Cancellation admission is distinct from terminal closure. The scheduler-owned `expireSchedulerChannelDeliveries()` command records TTL expiry before removing a recipient's pending delivery and never treats that record as a receipt. Its explicit `summarizeChannel()` command validates source provenance and appends a durable summary consumed by the summarized view policy.

An integration task adds an immutable source task/attempt, provider, target, expected target revision, and proposal or merge mode to the same Team task record. Its completed attempt retains a target-matching integration result with a resulting target version for success or conflict paths for a failed merge; the Hub validates the source, `workspace-integrate` policy, and result around the existing task CAS append.

`ActivationBindingSnapshot.fencedAt` records provider-confirmed termination while closure-owned allocations remain unsettled; it is immutable and does not imply full quiescence. `quiescedAt` still requires released allocations and settled task leases. `requireSystemClosureDriverProof()` resolves only a live runtime token; its consumers must also check the exact durable intent, Team cursor and resource epoch before acting. A controller closure-stall scope binds that intent identity and epoch without permitting resume, replacement, or a new closure.

`TeamTaskDependencyOutcome` records an unstarted workflow task’s terminal prerequisite id, revision, and failed/cancelled/deleted phase. `TeamRunWorkflowTaskCancelRequest` selects an owned plan/template binding; its result includes nullable `blockedByOutcome` (null means no dependency cancellation). Terminal plans may retain their configured task-result projection for completed, failed, or cancelled outcomes.

`ActivationReservationSnapshot` retains one provider-start admission under a branded `ActivationReservationId`. `ActivationReservationRequest` combines JSON `ActivationReservationInput` with a runtime-only controller proof. `ParticipantSnapshot.activationReservation` persists before provider startup; `ActivationBindingSnapshot.reservationId` consumes that identity once. `maxLiveActivations` counts pending starts, unquiesced epochs and delegated child capacity under the tighter Team budget or grant. Unknown startup blocks closure with `ACTIVATION_STARTUP_UNCONFIRMED`.

`TeamDiscoveryCursor` is an opaque provider scan position, distinct from numeric journal and collection cursors. `TeamListPage.scanned` counts examined entries, including skipped names; a page with no visible items can still continue. `TEAM_DISCOVERY_CURSOR_EXPIRED` requests a fresh `afterCursor: -1` scan.

`TeamTaskExecution` distinguishes Participant attempts from child-Team work; the child variant freezes its template, authority grant and budget. `TeamTaskDelegationSnapshot` retains the reserved child identity, replayable creation payload, cursor, failure and admitted result. The parent task has no Participant lease. `TeamChildRunBinding` identifies the service recipient, coordinator and consult channel; `TeamDelegationResultAdmission` binds the accepted response to its parent task. [`@clocky/clocky-team-delegation`](../../packages/team/team-delegation/README.md) is the Consumer driving these records. It contributes no `ctx` service and registers its cancellation driver with TeamRun.

## Provider registration

`transitionTeamPhase()` accepts JSON-only lifecycle fields plus a source-owned `TeamSystemPhaseProof`. The Hub resolves the registered source under the Team lock, validates the exact transition and target, and supplies its derived system identity to close policy. Test fixture state is seeded directly in a private journal helper rather than introducing a public generic transition authority.

`compactTeam()` and `compactChannel()` accept JSON-only prefix fields plus `TeamSystemMaintenanceProof`. Only `team-scheduler-dag` can resolve one exact terminal Team-journal or channel-WAL prefix; its scope fixes the Team/channel, cursor, and `throughSequence` before policy, audit repair, checkpoint, or storage compaction can occur.

Activation lifecycle commands carry JSON-only fields plus `TeamSystemActivationProof`. `team-activation-controller` owns exact bind/status/fence/quiesce scopes, while `team-activation-recovery` owns only wake-cleanup retry for an offline epoch recorded as locally quiesced. The Hub resolves a source proof before Team selection and under the Team lock before policy, lease cleanup, or journal acceptance; its durable activation records retain only the derived binding.

`TeamRuntime` declares common Team, participant, activation, task, channel, authenticated Envelope-admission, recipient-receipt, delivery-claim, and source-cursor audit-read operations, then supplies the registrations shared by providers. Task operations separate lease-free detail/cancel/review/delete actions from assignment and owner-fenced attempt actions; a provider maps reported outcomes to direct completion or review, retry, failure, or cancellation under its frozen limits and route. `postChannelEnvelope()` receives only a runtime actor plus JSON cursor/retry/draft fields. An activation proof derives the current sender; TeamRun, scheduler and delegation source proofs derive only their scoped human-input, assignment, review or parent-service post. Task-assignment and review-request drafts require the scheduler source rather than an activation proof. `resolveTaskReview()` derives its configured reviewer from an activation or authenticated-human runtime proof and takes no caller-selected Participant identity; the scheduler recovers only an exact closed consult response through a separate source-scoped proof after it validates the task and both Envelope records. Receipt and delivery claims derive the recipient from their runtime actor under the Team-to-channel lock before policy evaluation or durable mutation. `updateTeamGoal()` and `transitionTeamGoalPhase()` receive JSON-only fields plus `TeamActorProof`; the Hub resolves the exact current Team, Participant, activation, Session, and provider from that proof rather than accepting a caller-supplied actor identity. A claim proves an exact running/idle activation and pending recipient admission at one Hub linearization point without reserving a model turn or appending a claim record. A duplicate receipt, or an already-committed recipient reply with the incoming Envelope as `causationId`, produces no local delivery. `bindActivation()` and `updateActivationStatus()` use the Team cursor and return detached bindings; a duplicate activation id, Session change, or concurrent resident epoch rejects. A duplicate receipt returns its original record without another WAL append. A child creation request names a parent Team and task; the provider validates that task under the parent queue and snapshots its depth policy in the child journal. A channel adapter registers under an exact `(type, version)` identity and is removed by its effect disposer. A channel manifest freezes that identity and its participants; the WAL records lifecycle edges separately. Policies register per Team operation and compose through the `team/policy` waterfall: an allowing policy calls `next()`, while a denial returns a structured decision. The local Hub appends one rebuildable audit entry per business record after commit, repairs missing audit suffixes before `readAudit()`, and never treats a failed audit append as a reason to roll back business state.

`requestParticipantInterrupt()` accepts only TeamRun's source proof for its exact current human-to-coordinator topology, resolves the current idle/running coordinator target under Team/channel locks, and applies `interrupt` policy with the derived human requester. Only that target's activation proof may list or acknowledge the request; acknowledgement is idempotent and has no Team-cancellation or turn-settlement effect.

The Host API proxy owns approval/question action proofs. Its public request carries only Team/cursor fields, while a retained verified interaction entry supplies the complete pending action or terminal outcome; the Hub re-resolves that scope under the Team lock and derives the durable action, policy actor, and timestamp. An API proxy that lost its verified entry fails closed rather than reconstructing raw authority after restart. Bound local Agents retain a private activation proof and forward only final Session provider/model usage facts to `recordUsage()`; the Hub revalidates the binding and derives Team/Participant/Session/timestamp before duplicate replay, policy, or durable accounting. The method replaces duplicate turn/step observations and maintains durable Team-subtree token, turn, and provider-cost totals; child charges are repaired before more child work, and a typed cost ceiling rejects unknown pricing instead of counting it as zero. Exceeding a frozen ceiling stalls the Team.

The scheduler owns task-lease proofs. `assignTask()` and `expireTaskAttempt()` receive only JSON task/lease fields plus a scope for one exact selected assignment or elapsed attempt; the Hub checks it before parent-charge or channel work and again under its Team and attached wake-channel locks. A failed assignment closes its just-opened wake channel, and a cleanup failure remains observable.

TeamRun owns workflow compiler proofs. A channel open with `workflowPlanId`, plan channel/task binding, and plan phase transition each require an exact scope for the compiling plan revision and payload. The Hub re-resolves that proof under the relevant Team/channel locks. A separate scoped command closes only an attached, active, unbound workflow channel for that same compiling plan after compiler failure.

TeamRun also owns current-coordinator default-worker task-control proofs. Owner proposal and cancellation scopes bind the durable creator identity, task revision, and selected payload; after the coordinator releases, cancellation cleanup intentionally uses different authority.

## Post-commit notifications

Providers call the protected Team and channel notification helpers only after durable acceptance. Observers receive immutable Team or identified channel notifications; a throwing or rejecting observer is logged and cannot change an already committed result. The service definition records no Team state itself; the local Hub materializes it only when mounted.

## Local product run

`TeamActivationRequest` selects one active agent Participant, the durable Session it owns, a named placement provider, Agent options, and an optional local execution root. `TeamActivationLease` exposes the bound epoch, its optional local Agent, health, interruption, and quiescent disposal through `ctx.teamActivations`.

`TeamFinalAdmissionInput` selects exact WAL content by Team/channel/Envelope identity, sequence, fingerprint, and retry key. `TeamFinalAdmissionRequest` adds a runtime-only `TeamSystemFinalReceiptProof`; `TeamFinalAdmission` adds the sink kind, derived recipient and owner, and admission timestamp. The closed result sink records this fact independently before channel receipt; [the Hub contract](../../packages/team/team-hub/README.md) owns recovery and retention.

`ChannelSummarySelectionInput` selects a channel, expected WAL cursor, inclusive source range and idempotency key. `ChannelSummarySourceRequest` adds a current coordinator or authenticated human proof; `ChannelSummarySource` returns authorized source Envelopes and their fingerprint, or an existing retry result. `ChannelSummarizeRequest` additionally carries the canonical Consumer output proof. `ChannelSummaryRecord.sourceFingerprint` binds the complete canonical ordered source Envelopes. The [summary Consumer](../../packages/team/team-channel-summary/README.md) owns extraction limits and caller-visible behavior; the Hub validates channel-wide source visibility during admission and replay.

`TeamRunCreateRequest` creates one local default Team. `TeamRunHandle` retains its human, coordinator, provisioned worker, direct v4 channel, and coordinator lease. `TeamRunHumanInputRequest` appends trusted text/image human content; `TeamRunFinalWaitRequest` waits for the coordinator's explicit final Envelope; and `TeamRunFinal` returns the received human-facing text after its durable receipt and narrow topology settlement. `TeamRunCoordinatorTaskAuthority` and `TeamRunCoordinatorGoalAuthority` are opaque exact-coordinator capabilities. `TeamRunCoordinatorGoalUpdateRequest` carries only the observed revision and replacement objective; TeamRun issues a private short-lived activation proof and admits it only from the current human direct-v4 turn. `TeamRunDefaultWorkerTaskStartRequest` carries its branded retry key, instructions, and read/write scopes; `TeamRunDefaultWorkerTask` identifies the accepted task and extends `TeamRunDefaultWorkerTaskReview`, whose frozen `reviewPolicy` and nullable `reviewResult` identify only the active attempt or, without an active lease, the latest settled attempt; `TeamRunDefaultWorkerTaskWaitRequest` supplies an owned task id and local wait cancellation; `TeamRunDefaultWorkerTaskWatchRequest` supplies the last observed Team cursor and local watch cancellation; `TeamRunDefaultWorkerTaskCancelRequest` supplies an owned task id; `TeamRunDefaultWorkerTaskOwnerProposalRequest` supplies an owned task id and optional preferred Participant; `TeamRunDefaultWorkerTaskList` and `TeamRunDefaultWorkerTaskWatch` return compact task phases and review facts; `TeamRunDefaultWorkerTaskOwnerProposal` returns the retained advisory hint; and `TeamRunDefaultWorkerTaskTerminal` preserves its terminal result or attempt outcome. `TeamRunWorkflowPlanStartRequest` accepts a complete JSON `TeamWorkflowPlan` and a lineage-derived retry key; `TeamRunWorkflowPlanWaitRequest` waits for one owned plan; and `TeamRunWorkflowPlanTerminal` contains the durable projected task results or terminal failure.

`workerCount` snapshots the local worker pool in new Team rules. Slot zero uses role `worker`; later slots use `worker-2`, `worker-3`, and so on, each with its own activation-bound Session. Workflow channels may include these role names while task assignment continues to apply the scheduler's capability, load, workspace, and plan-parallelism checks.

`TeamTaskInspectRequest` combines exact Team/task ids with `TeamTaskInspectionSelection` and an optional revision fence; the provider resolves it to `TeamTaskInspectSpec`. `TeamTaskInspection` contains either a history-free `TeamTaskRecord` with counts, or an indexed attempt/review page with explicit start, total, scan count and continuation. The [Core contract](../../packages/core/team/README.md) owns response bounds and private-artifact filtering.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxteamactivations--teamactivationcontroller"></a>

### `ctx.teamActivations` — `TeamActivationController`

Team Consumer that owns the small two-system transaction from a published AgentRuntime handle to a durable Team binding. Each provider owns the execution-specific mechanism behind its handle status stream.

```ts cordis-catalog
/** Begin terminal-intent-driven release of every exact activation handle currently owned by this controller. */
start(): void

/**
 * Recover at most one epoch selected from an existing durable lifecycle intent.
 * Missing ownership records produce a durable stall; successful fencing first
 * requests allocation release and only later records complete quiescence.
 * @param input - exact closure-driver proof and its observed Team cursor.
 * @returns settlement of this bounded pass; callers reread state before issuing another proof.
 */
async recoverClosure(input: TeamClosureContinuationRequest): Promise<void>

/**
 * Activate one active agent participant and persist its binding before the
 * caller receives a lease. Concurrent callers for the same Team/participant
 * and Session join the exact accepted lease.
 * @param input - fully resolved activation inputs.
 * @returns a controller-owned durable activation lease.
 */
async activate(input: TeamActivationRequest): Promise<TeamActivationLease>

/**
 * Fence one stale external epoch, atomically release its current task leases
 * and persist it offline, then publish a new activation with the same Team
 * participant and Session under a new id.
 * @param input - exact old binding plus replacement composition selected by the recovery owner.
 * @returns a durable lease for the newly bound persisted-resume epoch.
 */
async coldReplace(input: TeamActivationColdReplaceRequest): Promise<TeamActivationLease>

/**
 * Fence one activation left running after a Host restart before a Team can be resumed.
 * @param input - Exact stale activation and recovery authorization selected by the recovery owner.
 */
async fenceStale(input: TeamActivationStaleFenceRequest): Promise<void>

/**
 * Confirm that a human-authorized coordinator recovery can reach the selected provider without mutating Team state.
 * @param input - exact durable coordinator binding and live human resume authorization.
 * @returns resolution after provider and durable binding checks pass.
 */
async preflightResume(input: TeamActivationResumePreflightRequest): Promise<void>

/** Stop admission, release every accepted handle, and await bounded settlement. */
close(): Promise<void>
```

Source: [`packages/team/team-activation-controller/src/index.ts`](../../packages/team/team-activation-controller/src/index.ts)

<a id="ctxteamchanneladmission--teamchanneladmission"></a>

### `ctx.teamChannelAdmission` — `TeamChannelAdmission`

Shared channel admission Consumer; endpoint acknowledgements remain owned by their authenticated receivers.

```ts cordis-catalog
/**
 * Replay one bounded discovery/expiry pass; acknowledged invitations are never reissued.
 * @returns settlement after this pass's accepted Hub operations finish.
 */
runOnce(): Promise<void>

/**
 * Wait for durable required endpoint consent before dispatching channel work.
 * @param request - exact channel and caller cancellation lifetime.
 * @returns an active channel snapshot; terminal admission rejects without dispatch.
 */
waitUntilActive(request: ChannelAdmissionWaitRequest): Promise<ChannelSnapshot>
```

Source: [`packages/team/team-channel-admission/src/index.ts`](../../packages/team/team-channel-admission/src/index.ts)

<a id="ctxteamchannelsummaries--teamchannelsummary"></a>

### `ctx.teamChannelSummaries` — `TeamChannelSummary`

Concrete Consumer with one ephemeral proof per exact summary commit.

```ts cordis-catalog
/** Return detached public bounds for command discovery.
 * @returns Summary policies and input/output limits of this Consumer.
 */
describe(): import('@clocky/clocky-team').ChannelSummaryCapabilities

/**
 * Generate one explicit channel-wide summary or return its committed retry result.
 * @param request - Current coordinator/human proof and exact bounded source selection.
 * @returns The durable summary with its original source fingerprint and retry identity.
 */
summarize(request: ChannelSummarySourceRequest): Promise<ChannelSummaryRecord>

/** Stop new admissions, revoke outstanding proofs and await owned operations. @returns Completion after accepted operations settle. */
async close(): Promise<void>
```

Source: [`packages/team/team-channel-summary/src/index.ts`](../../packages/team/team-channel-summary/src/index.ts)

<a id="ctxteamclosuredriver--teamclosuredriver"></a>

### `ctx.teamClosureDriver` — `TeamClosureDriver`

Provider-routed Team closure scanner with one serializer and one proof map per mounted driver.

```ts cordis-catalog
/**
 * Subscribe before scanning so notifications racing startup request a later
 * pass, then finish one bounded startup recovery drive.
 * @returns resolution after the initial bounded drive settles.
 */
async start(): Promise<void>

/**
 * Discover every eligible Team or drive one selected Team. The backend owns
 * semantic cleanup; this consumer only serializes current-state observations.
 * @param request - optional durable Team restriction.
 * @returns resolution after every pass selected by this request settles.
 */
drive(request: TeamClosureDriverDriveRequest = {}): Promise<void>

/**
 * Admit one current coordinator turn result before its product caller
 * reports the missing final or structured failure.
 * @param request - exact activation, Session, turn, and durable reason observation.
 * @returns resolution after the corresponding Team fact is accepted.
 */
recordTurnEnd(request: TeamClosureDriverTurnEndRequest): Promise<void>

/**
 * Admit one frozen budget exhaustion observation through the same
 * proof-bound Hub path used by restart recovery.
 * @param request - Team identity and exact budget reason.
 * @returns resolution after the durable stalled phase is accepted.
 */
recordBudgetStall(request: TeamClosureDriverBudgetStallRequest): Promise<void>

/**
 * Stop watches and new drives, then await already admitted backend calls
 * within the configured disposal bound while retaining their proofs.
 * @returns resolution after accepted calls settle, or their aggregate failure.
 */
close(): Promise<void>
```

Source: [`packages/team/team-closure-driver/src/index.ts`](../../packages/team/team-closure-driver/src/index.ts)

<a id="ctxteamclosuredriverhub--teamclosuredriverhub"></a>

### `ctx.teamClosureDriverHub` — `TeamClosureDriverHub`

Real Core Team backend that continues only a driver-issued durable recovery scope.

Source: [`packages/team/team-closure-driver/src/hub.ts`](../../packages/team/team-closure-driver/src/hub.ts)

<a id="ctxteamclosuredrives--teamclosuredrivebackendregistry"></a>

### `ctx.teamClosureDrives` — `TeamClosureDriveBackendRegistry`

Named registry for provider bridges that own the durable closure commands.

```ts cordis-catalog
/**
 * Register one backend bridge. Disposing the provider fiber removes it from
 * future passes without invalidating an already admitted backend call.
 * @param backend - Hub-facing implementation selected by a composition.
 * @returns HMR-safe disposer for this exact backend registration.
 */
registerBackend(backend: TeamClosureDriveBackend): () => void

/**
 * Resolve one live backend without changing its registration lifetime.
 * @param backend - configured backend identity.
 * @returns the live provider bridge, or `undefined` after removal.
 */
getBackend(backend: string): TeamClosureDriveBackend | undefined

/**
 * Resolve the exact configured bridge or reject before recovery can silently
 * skip durable closure work.
 * @param backend - configured backend identity.
 * @returns the live provider bridge.
 * @throws {@link TeamClosureDriveError} when the backend is unavailable.
 */
requireBackend(backend: string): TeamClosureDriveBackend

/**
 * List current backend identities in registration order.
 * @returns detached registered backend references.
 */
listBackends(): readonly TeamClosureDriveBackendRef[]
```

Source: [`packages/team/team-closure-driver/src/index.ts`](../../packages/team/team-closure-driver/src/index.ts)

<a id="ctxteamhumanactors--teamhumanactor"></a>

### `ctx.teamHumanActors` — `TeamHumanActor`

Effect-scoped product-principal to active-human binder.

```ts cordis-catalog
/**
 * Map one authenticated principal to exactly one active human participant and
 * hold its exact payload-bound proof only while the supplied operation runs.
 * @param call - runtime-only authenticated product call retained by its transport lease.
 * @param input - complete parsed JSON-only mutation input and observed fence.
 * @param operation - Hub call that may resolve the proof more than once before settling.
 * @returns the operation result after the proof is revoked.
 */
async withProof<T>( call: AuthenticatedProductCall, input: TeamHumanActorProofInput, operation: (proof: TeamHumanActorProof) => Promise<T>, ): Promise<T>

/** Invalidate every outstanding proof before the source leaves the Team runtime. */
close(): void
```

Types: [AuthenticatedProductCall](core.md)

Source: [`packages/team/team-human-actor/src/index.ts`](../../packages/team/team-human-actor/src/index.ts)

<a id="ctxteamhumandelivery--teamhumandeliveryruntime"></a>

### `ctx.teamHumanDelivery` — `TeamHumanDeliveryRuntime`

Provider-owned principal inbox consumed by Hub admission and authenticated product APIs.

```ts cordis-catalog
/**
 * Persist the exact authorized final before Hub admission or receipt.
 * @param input - Hub-authorized exact final content.
 * @param proof - Runtime-only Hub final-admission proof.
 * @returns Durable inbox delivery.
 */
admitFinal(input: TeamHumanFinalInput, proof: TeamHumanSinkProof): Promise<TeamHumanInboxFinal>

/**
 * Persist a Hub-authorized ordinary delivery.
 * @param input - Exact Envelope and optional rendered view.
 * @param proof - Runtime-only Hub human-delivery proof.
 * @returns Durable inbox item.
 */
admitMessage(input: TeamHumanMessageInput, proof: TeamHumanSinkProof): Promise<TeamHumanInboxMessage>

/**
 * Recover a receipt's existing sink.
 * @param input - Hub-validated owner and Envelope.
 * @param proof - Runtime-only Hub human-delivery proof.
 * @returns Exact admission, or undefined.
 */
getMessageAdmission(input: Pick<TeamHumanMessageInput, 'principalId' | 'teamId' | 'envelopeId'>, proof: TeamHumanSinkProof): Promise<TeamHumanInboxMessage | undefined>

/**
 * Register a live action continuation owner.
 * @param responder - Host-owned continuation resolver.
 * @returns Registration disposer.
 */
registerActionResponder(responder: TeamHumanActionResponder): () => void

/**
 * Answer one exact durable request.
 * @param call - Authenticated principal.
 * @param input - Actor-free answer and retry fence.
 * @returns Durable acceptance or unavailable result.
 */
respond(call: AuthenticatedProductCall, input: TeamHumanActionResponseInput): Promise<TeamHumanActionResponseResult>

/**
 * Read one bounded authorized page.
 * @param call - Current authenticated transport lease.
 * @param input - Actor-free pagination.
 * @returns Visible inbox page.
 */
read(call: AuthenticatedProductCall, input: TeamHumanInboxReadInput): Promise<TeamHumanInboxPage>

/**
 * Wait within the deployment timeout for a fresh page.
 * @param call - Revocable authenticated call.
 * @param input - Actor-free pagination.
 * @returns Visible page or an empty timeout result.
 */
watch(call: AuthenticatedProductCall, input: TeamHumanInboxReadInput): Promise<TeamHumanInboxPage>

/**
 * Persist a monotonic shared display position.
 * @param call - Current authenticated call.
 * @param input - Retained delivery selected by the client.
 * @returns Durable shared display cursor.
 */
acknowledge(call: AuthenticatedProductCall, input: TeamHumanInboxAcknowledgeInput): Promise<TeamHumanInboxAcknowledgement>
```

Types: [AuthenticatedProductCall](core.md)

Source: [`packages/core/team/src/human-delivery-types.ts`](../../packages/core/team/src/human-delivery-types.ts)

<a id="ctxteamplacement--teamplacement"></a>

### `ctx.teamPlacement` — `TeamPlacement`

Activation owner for tasks whose participants have an explicit deployment route.

```ts cordis-catalog
/**
 * Prepare idle owners for currently ready tasks without assigning any lease.
 * @param teamId - Durable Team selected by the scheduler.
 * @param signal - First caller's cancellation, retained by all coalesced callers of that preparation.
 * @returns number of activations published by this pass.
 */
prepare(teamId: TeamId, signal?: AbortSignal): Promise<number>

/** Prepare declared workflow roles before channel admission or task publication.
 * @param teamId - Team whose active membership authorizes the roles.
 * @param roles - Unique roles already resolved by the workflow compiler.
 * @param signal - Cancellation of this compilation.
 * @returns resolution when every agent role has a resident activation; unavailable routes reject.
 */
async prepareRoles(teamId: TeamId, roles: readonly string[], signal?: AbortSignal): Promise<void>

/** Stop new preparation and cancel provider admission; failed releases remain available to a later close.
 * @returns Shared in-flight cleanup; rejects with collected failures until all owned leases settle.
 */
close(): Promise<void>
```

Source: [`packages/team/team-placement-default/src/index.ts`](../../packages/team/team-placement-default/src/index.ts)

<a id="ctxteamruns--teamrunservice"></a>

### `ctx.teamRuns` — `TeamRunService`

Owns the current local default Team topology, trusted human ingress, and explicit final-output receipt. Existing Team services retain authority for durable state, activation, Envelope admission, and Agent turns.

```ts cordis-catalog
/**
 * Resolve a named child template before the parent task reserves its durable child identity.
 * @param templateId - exact deployment template name; unavailable versions never fall back.
 * @param templateVersion - exact positive template revision selected by the parent task.
 * @returns detached JSON rules with execution configuration and an explicit coordinator model route; no workspace authority.
 */
describeChildTemplate(templateId: string, templateVersion: number): JsonObject

/**
 * Publish a reserved child Team's model residency and parent-service result endpoints.
 * The parent service owns invitation consent and the initial consult request.
 * @param request - opaque parent authorization and its exact child identity.
 * @returns durable endpoints, including an identical already-published binding on retry.
 */
async startChild(request: TeamRunChildRequest): Promise<TeamChildRunBinding>

/** Cancel a child under fresh parent authority before releasing its local execution leases.
 * @param request - exact cancellation authority and child identity.
 * @returns terminal state or explicit durable cleanup progress.
 */
async cancelChild(request: TeamRunChildRequest): Promise<TeamStateSnapshot>

/**
 * Create the default human/coordinator/worker-pool Team topology and publish
 * its local coordinator residency before any human input enters its channel.
 * @param request - objective, coordinator execution root, and optional activation cancellation.
 * @returns the durable topology and current local coordinator lease.
 */
async create(request: TeamRunCreateRequest): Promise<TeamRunHandle>

/**
 * Re-attach a durable default Team to a fresh local coordinator activation.
 * The persisted Session header and request context provide the exact identity
 * and model route; no new Team, Participant, channel, or Session is created.
 * @param request - Team identity and optional replacement coordinator choices.
 * @returns the re-owned durable topology and current coordinator lease.
 */
async resume(request: TeamRunResumeRequest): Promise<TeamRunHandle>

/**
 * Wait for durable Team quiescence without assuming a local coordinator owner.
 * @param teamId - Team identity to inspect.
 * @param signal - optional cancellation for the local wait.
 * @returns the latest quiescence diagnostics.
 */
async waitForQuiescence(teamId: TeamId, signal?: AbortSignal): Promise<TeamQuiescenceSnapshot>

/**
 * Create the default topology and admit its first human Envelope. Retries
 * with the same key return the same accepted result while this local owner lives.
 * @param request - topology inputs, first human content, and retry identity.
 * @returns the created topology plus its accepted first human Envelope.
 */
async start(request: TeamRunStartRequest): Promise<TeamRunStartResult>

/**
 * Append trusted human content only after the default topology and coordinator
 * residency have committed.
 * @param request - Team identity, human content, and requested delivery intent.
 * @returns the immutable channel Envelope accepted by the Team Hub.
 */
async postHumanInput(request: TeamRunHumanInputRequest): Promise<TeamEnvelope>

/**
 * Request one soft interrupt from this TeamRun's durable human participant
 * to its current local coordinator. A non-active Team has no interruptable
 * product run, so this returns `undefined` without touching the Hub.
 * @param teamId - current locally owned Team run selected by ACP.
 * @returns the committed interrupt, or `undefined` when the Team is no longer active.
 */
async requestCoordinatorInterrupt(teamId: TeamId): Promise<ParticipantInterruptSnapshot | undefined>

/**
 * Mint a capability for one exact local coordinator without exposing Team,
 * participant, activation, or Session identity to its consumer.
 * @param coordinator - current local coordinator Agent selected by a scoped consumer.
 * @returns an opaque capability accepted only while this exact coordinator remains current.
*/
coordinatorTaskAuthority(coordinator: Agent): TeamRunCoordinatorTaskAuthority

/**
 * Set the coordinator's desired local worker-pool size and reconcile durable
 * worker Participants. Requests above the deployment ceiling are clamped and
 * returned as saturated capacity so a coordinator can keep queueing work.
 * @param authority - opaque capability for the exact current coordinator.
 * @param request - requested worker count, including the default `worker` slot.
 * @returns bounded pool and queued-task status after reconciliation.
 */
async setWorkerPoolSize( authority: TeamRunCoordinatorTaskAuthority, request: TeamRunWorkerPoolSetRequest, ): Promise<TeamRunWorkerPoolStatus>

/**
 * Mint a capability for an exact local coordinator, or leave ordinary Agents outside the scoped Team-goal tools.
 * @param coordinator - candidate current local coordinator Agent selected by a scoped consumer.
 * @returns an opaque capability, or `undefined` when the Agent owns no current default Team run.
 */
tryCoordinatorGoalAuthority(coordinator: Agent): TeamRunCoordinatorGoalAuthority | undefined

/**
 * Read the durable objective visible to the exact current coordinator.
 * @param authority - opaque capability minted for the exact current coordinator.
 * @returns the current detached Team objective.
 */
async readCoordinatorGoal(authority: TeamRunCoordinatorGoalAuthority): Promise<TeamGoalSnapshot>

/**
 * Compare-and-set the durable objective from an active coordinator turn carrying its trusted human input.
 * @param authority - opaque capability minted for the exact current coordinator.
 * @param request - observed revision and replacement objective.
 * @returns the committed detached Team objective.
 */
async updateCoordinatorGoal( authority: TeamRunCoordinatorGoalAuthority, request: TeamRunCoordinatorGoalUpdateRequest, ): Promise<TeamGoalSnapshot>

/**
 * Compare-and-set the durable objective phase from an exact coordinator activation.
 * @param authority - opaque capability for the current coordinator.
 * @param request - expected revision, next phase, and optional blocker.
 * @returns the committed durable objective.
 */
async transitionCoordinatorGoalPhase( authority: TeamRunCoordinatorGoalAuthority, request: TeamRunCoordinatorGoalPhaseRequest, ): Promise<TeamGoalSnapshot>

/**
 * Lazily activate the default worker and create one bounded scheduler-owned task.
 * @param authority - opaque capability minted for the exact current coordinator.
 * @param request - caller retry key and durable task fields.
 * @returns the accepted or replayed task's compact durable identity.
 */
async startDefaultWorkerTask( authority: TeamRunCoordinatorTaskAuthority, request: TeamRunDefaultWorkerTaskStartRequest, ): Promise<TeamRunDefaultWorkerTask>

/**
 * Admit one child-Team task under the current coordinator's narrowed authority.
 * @param authority - Opaque authority of this Team's current coordinator.
 * @param request - Durable objective, requested scopes and budget, and optional complete template identity.
 * @returns The accepted or replayed parent task; its Consumer owns child startup.
 */
async startDelegatedTask( authority: TeamRunCoordinatorTaskAuthority, request: TeamRunDelegatedTaskStartRequest, ): Promise<TeamRunDefaultWorkerTask>

/**
 * Wait for one task previously accepted through this coordinator authority.
 * @param authority - opaque capability minted for the exact current coordinator.
 * @param request - owned task identity and optional local wait cancellation.
 * @returns the task's terminal result or retained terminal attempt fact.
 * @throws TeamRunError when the Team stalls or a local reviewer stops without an accepted decision.
 */
async waitForDefaultWorkerTask( authority: TeamRunCoordinatorTaskAuthority, request: TeamRunDefaultWorkerTaskWaitRequest, ): Promise<TeamRunDefaultWorkerTaskTerminal>

/**
 * List compact task state owned by the exact current coordinator.
 * @param authority - opaque capability for the exact current coordinator.
 * @returns the current bounded list of non-workflow default-worker tasks.
 */
async listDefaultWorkerTasks(authority: TeamRunCoordinatorTaskAuthority): Promise<TeamRunDefaultWorkerTaskList>

/**
 * Set or clear an advisory owner proposal for one pending coordinator-owned task.
 * @param authority - opaque capability for the exact current coordinator.
 * @param request - owned task identity and optional preferred Participant.
 * @returns the task phase and retained scheduler hint after the CAS.
 */
async proposeDefaultWorkerTaskOwner( authority: TeamRunCoordinatorTaskAuthority, request: TeamRunDefaultWorkerTaskOwnerProposalRequest, ): Promise<TeamRunDefaultWorkerTaskOwnerProposal>

/**
 * Wait for a Team cursor advance, then return the bounded owned-task snapshot.
 * This observes unrelated Team changes too; the returned cursor lets the
 * coordinator establish the next no-gap watch.
 * @param authority - opaque capability for the exact current coordinator.
 * @param request - last observed cursor and local cancellation.
 * @returns the current cursor and compact owned-task state.
 */
async watchDefaultWorkerTasks( authority: TeamRunCoordinatorTaskAuthority, request: TeamRunDefaultWorkerTaskWatchRequest = {}, ): Promise<TeamRunDefaultWorkerTaskWatch>

/**
 * Request cancellation of one coordinator-owned task through the durable Team CAS.
 * @param authority - opaque capability for the exact current coordinator.
 * @param request - owned task identity.
 * @returns accepted stop progress, or an unchanged terminal task.
 */
async cancelDefaultWorkerTask( authority: TeamRunCoordinatorTaskAuthority, request: TeamRunDefaultWorkerTaskCancelRequest, ): Promise<TeamRunDefaultWorkerTask>

/**
 * Validate and durably compile one declarative workflow plan. Compilation is
 * retry-safe: the plan, each task binding, and the workflow channel are all
 * recovered from Team records rather than inferred from model code.
 * @param authority - opaque capability minted for the exact coordinator.
 * @param request - complete plan, retry identity, and optional local cancellation.
 * @returns the ready or already-terminal durable workflow plan.
 */
async startWorkflowPlan( authority: TeamRunCoordinatorTaskAuthority, request: TeamRunWorkflowPlanStartRequest, ): Promise<TeamWorkflowPlanSnapshot>

/**
 * Cancel one exact task binding owned by the current coordinator's workflow.
 * @param authority - current coordinator capability.
 * @param request - plan/template selection and optional cancellation reason.
 * @returns task stop progress; independent workflow tasks remain available.
 */
async cancelWorkflowTask( authority: TeamRunCoordinatorTaskAuthority, request: TeamRunWorkflowTaskCancelRequest, ): Promise<TeamRunWorkflowTaskCancelResult>

/**
 * Wait for all bound tasks to settle and read the Hub-owned terminal result.
 * @param authority - opaque capability minted for the exact coordinator.
 * @param request - owned workflow plan identity and local wait cancellation.
 * @returns the durable workflow terminal phase and projected task results.
 */
async waitForWorkflowPlan( authority: TeamRunCoordinatorTaskAuthority, request: TeamRunWorkflowPlanWaitRequest, ): Promise<TeamRunWorkflowPlanTerminal>

/**
 * Await and receipt the coordinator's explicit final Envelope, then settle
 * the narrow default topology from active through quiescing to completed.
 * @param request - Team identity, last observed channel cursor, and local wait cancellation.
 * @returns the exact human-addressed final value retained in the channel WAL.
 */
async waitForFinal(request: TeamRunFinalWaitRequest): Promise<TeamRunFinal>

/**
 * Cancel a current local Team run after the Hub has durably closed admission.
 * @param teamId - Team selected from the current local product run map.
 * @param humanOwner - optional authenticated product owner that must match the run's durable human.
 * @returns resolution after Team terminal state and local coordinator lease settle.
 */
async cancel( teamId: TeamId, humanOwner?: Extract<TeamParticipantOwner, { readonly kind: 'product-principal' }>, ): Promise<void>

/**
 * Archive one terminal Team only when this service retained the local owner
 * after settling that Team. The opaque proof is minted for this single Hub
 * call and cannot be reconstructed from a Team id or terminal snapshot.
 * @param request - terminal Team identity and observed Team-journal cursor.
 * @returns the Team state with its durable archive marker.
 */
async archiveTerminal(request: TeamArchiveInput): Promise<TeamStateSnapshot>

/** Release current local coordinator leases without mutating durable Team phase on plugin disposal. */
close(): Promise<void>
```

Types: [Agent](core.md)

Source: [`packages/team/team-run/src/index.ts`](../../packages/team/team-run/src/index.ts)

<a id="ctxteams--teamruntime-abstract-seam"></a>

### `ctx.teams` — `TeamRuntime` (abstract seam)

Team Service Definition (`ctx.teams`). A provider supplies Team operations; this base class owns adapter/policy registration and post-commit observer dispatch without depending on an Agent, Session, Hub, storage medium, or transport.

```ts cordis-catalog
/** Validate provider ownership before calling any capability method supplied by a caller.
 * @param token - child operation capability returned by this exact provider.
 * @returns current immutable scope after asynchronous parent and workspace validation.
 */
async assertChildRunAuthorization(token: TeamChildRunAuthorization): Promise<TeamChildRunScope>

/** Register the owner of parent delegation operations and live shared-root resolution.
 * @param source - exact runtime proof resolver retained by the delegation Consumer.
 * @returns effect-owned registration disposer.
 */
registerSystemDelegationProofSource(source: TeamSystemDelegationProofSource): () => void

/**
 * Publish exact service/coordinator endpoints for a reserved child Team.
 * @param _request - live parent authorization, observed child cursor and complete endpoint binding.
 * @returns the durable immutable binding; an identical retry returns its original value.
 */
bindChildRun(_request: import('./types.ts').TeamChildRunBindRequest): Promise<import('./types.ts').TeamChildRunBinding>

/** Register a child runtime or parent saga result owner.
 * @param source - Owner retaining its own nonserializable proofs.
 * @returns Effect disposer that invalidates this source.
 */
registerSystemChildResultProofSource(source: TeamSystemChildResultProofSource): () => void | Promise<void>

/** Accept a child response into the parent task without settling the parent.
 * @param _request - Exact parent task fence and delegation-owned response selection.
 * @returns Durable parent result admission.
 */
admitTaskDelegationResult(_request: TeamTaskDelegationResultAdmitRequest): Promise<TeamDelegationResultAdmission>

/** Admit and receipt an already parent-accepted result, then begin child completion.
 * @param _request - Exact child-result proof and child cursor.
 * @returns Current child state; completed is possible only after resource quiescence.
 */
completeChildTeam(_request: TeamChildResultCommandRequest): Promise<TeamStateSnapshot>

/** Record child cancellation before releasing runtime resources, including partial bootstrap.
 * @param _request - Provider-owned parent cancellation capability and exact child input.
 * @returns Durable cancellation-admitted child state.
 */
cancelChildTeam(_request: TeamChildCancelRequest): Promise<TeamStateSnapshot>

/** Record an actual coordinator turn ending without its bound service response.
 * @param _request - Live child runtime observation proof and current child cursor.
 * @returns Unchanged state when a response exists, otherwise a durable missing-result stall.
 */
recordChildResultMissing(_request: TeamChildResultCommandRequest): Promise<TeamStateSnapshot>

/**
 * Open one trusted issuer for activation-bound runtime proofs. The issuer
 * validates and freezes each durable binding; its closure prevents later
 * issuance but does not revoke leases it already returned.
 * @returns an issuer whose leases may be revoked independently.
 */
openActivationActorProofIssuer(): ActivationActorProofIssuer

/**
 * Register one system owner that privately resolves opaque proofs for exact
 * activation lifecycle mutations. Registration is effect-scoped: disposing
 * the contributing fiber immediately makes all of its proofs invalid.
 * @param source - named resolver that owns proof construction and lifetime.
 * @returns an HMR-safe disposer that removes exactly this source.
 * @throws {@link TeamError} when the source name is invalid or already registered.
 */
registerSystemActivationProofSource(source: TeamSystemActivationProofSource): () => void

/**
 * Register one Host owner that privately resolves opaque proofs for exact
 * approval or question action mutations. Registration is effect-scoped:
 * disposing the contributing fiber immediately makes all proofs invalid.
 * @param source - named resolver that owns proof construction and lifetime.
 * @returns an HMR-safe disposer that removes exactly this source.
 * @throws {@link TeamError} when the source name is invalid or already registered.
 */
registerSystemHumanActionProofSource(source: TeamSystemHumanActionProofSource): () => void

/**
 * Register one authenticated-human binder that privately resolves opaque
 * proofs for exact product Team mutations. Registration is effect-scoped:
 * disposal immediately invalidates every outstanding proof from this source.
 * @param source - named resolver that owns human proof construction and lifetime.
 * @returns an HMR-safe disposer that removes exactly this source.
 * @throws {@link TeamError} when the source name is invalid or already registered.
 */
registerHumanActorProofSource(source: TeamHumanActorProofSource): () => void

/**
 * Register a named endpoint or expiry owner and revoke its proofs with its effect lifetime.
 * @param source - owner retaining exact runtime operation scopes.
 * @returns an HMR-safe disposer for this registration.
 */
registerSystemChannelAdmissionProofSource(source: TeamSystemChannelAdmissionProofSource): () => void

/**
 * Register one scheduler owner that privately resolves opaque proofs for
 * exact task assignment and elapsed lease expiry. Registration is
 * effect-scoped: disposing the contributing fiber immediately invalidates
 * every proof retained by that source.
 * @param source - named resolver that owns proof construction and lifetime.
 * @returns an HMR-safe disposer that removes exactly this source.
 * @throws {@link TeamError} when the source name is invalid or already registered.
 */
registerSystemTaskLeaseProofSource(source: TeamSystemTaskLeaseProofSource): () => void

/**
 * Register one workflow compiler owner that privately resolves opaque proofs
 * for exact workflow channel openings, bindings, phase transitions, and
 * orphan-channel cleanup. Registration is effect-scoped: disposing the
 * contributing fiber immediately invalidates every proof retained by it.
 * @param source - named resolver that owns proof construction and lifetime.
 * @returns an HMR-safe disposer that removes exactly this source.
 * @throws {@link TeamError} when the source name is invalid or already registered.
 */
registerSystemWorkflowProofSource(source: TeamSystemWorkflowProofSource): () => void

/**
 * Register one TeamRun owner that privately resolves opaque proofs for exact
 * default-worker owner proposals and current-coordinator cancellations.
 * Registration is effect-scoped: disposing the contributing fiber
 * immediately invalidates every proof retained by it.
 * @param source - named resolver that owns proof construction and lifetime.
 * @returns an HMR-safe disposer that removes exactly this source.
 * @throws {@link TeamError} when the source name is invalid or already registered.
 */
registerSystemTaskControlProofSource(source: TeamSystemTaskControlProofSource): () => void

/**
 * Register one owner that privately resolves opaque proofs for exact root
 * Team creation. Registration is effect-scoped: disposing the contributing
 * fiber immediately invalidates every proof retained by it.
 * @param source - named resolver that owns proof construction and lifetime.
 * @returns an HMR-safe disposer that removes exactly this source.
 * @throws {@link TeamError} when the source name is invalid or already registered.
 */
registerSystemRootCreationProofSource(source: TeamSystemRootCreationProofSource): () => void

/**
 * Register one owner that privately resolves opaque proofs for exact child
 * Team creation. No shipped product composition registers this source until
 * parent-task delegation has an owning consumer.
 * @param source - named resolver that owns proof construction and lifetime.
 * @returns an HMR-safe disposer that removes exactly this source.
 * @throws {@link TeamError} when the source name is invalid or already registered.
 */
registerSystemChildCreationProofSource(source: TeamSystemChildCreationProofSource): () => void

/**
 * Register one owner that privately resolves opaque proofs for exact durable
 * channel summary appends. No shipped product composition registers this
 * source until a summarization consumer owns the operation.
 * @param source - named resolver that owns proof construction and lifetime.
 * @returns an HMR-safe disposer that removes exactly this source.
 * @throws {@link TeamError} when the source name is invalid or already registered.
 */
registerSystemChannelSummaryProofSource(source: TeamSystemChannelSummaryProofSource): () => void

/**
 * Register one owner that privately resolves opaque proofs for exact generic
 * channel openings and closures. Shipped product compositions register no
 * generic lifecycle source until an owning consumer needs this route.
 * @param source - named resolver that owns proof construction and lifetime.
 * @returns an HMR-safe disposer that removes exactly this source.
 * @throws {@link TeamError} when the source name is invalid or already registered.
 */
registerSystemChannelLifecycleProofSource(source: TeamSystemChannelLifecycleProofSource): () => void

/**
 * Register one owner that privately resolves opaque proofs for exact
 * workspace allocation bindings and cleanup transitions.
 * @param source - named resolver that owns proof construction and lifetime.
 * @returns an HMR-safe disposer that removes exactly this source.
 * @throws {@link TeamError} when the source name is invalid or already registered.
 */
registerSystemWorkspaceAllocationProofSource(source: TeamSystemWorkspaceAllocationProofSource): () => void

/**
 * Register one TeamRun owner that privately resolves opaque proofs for exact
 * terminal Team archive. Registration is effect-scoped: disposing the
 * contributing fiber immediately invalidates every proof retained by it.
 * @param source - named resolver that owns proof construction and lifetime.
 * @returns an HMR-safe disposer that removes exactly this source.
 * @throws {@link TeamError} when the source name is invalid or already registered.
 */
registerSystemArchiveProofSource(source: TeamSystemArchiveProofSource): () => void

/**
 * Register one TeamRun owner that privately resolves opaque proofs for exact
 * bootstrap, worker, and reviewer topology mutations. Registration is
 * effect-scoped: disposing the contributing fiber immediately invalidates
 * every proof retained by it.
 * @param source - named resolver that owns proof construction and lifetime.
 * @returns an HMR-safe disposer that removes exactly this source.
 * @throws {@link TeamError} when the source name is invalid or already registered.
 */
registerSystemTopologyProofSource(source: TeamSystemTopologyProofSource): () => void

/**
 * Register one scheduler owner that privately resolves opaque proofs for exact
 * review and task-assignment channel lifecycle mutations. Registration is
 * effect-scoped: disposing the contributing fiber immediately invalidates
 * every proof retained by it.
 * @param source - named resolver that owns proof construction and lifetime.
 * @returns an HMR-safe disposer that removes exactly this source.
 * @throws {@link TeamError} when the source name is invalid or already registered.
 */
registerSystemSchedulerChannelProofSource(source: TeamSystemSchedulerChannelProofSource): () => void

/**
 * Register one TeamRun owner that privately resolves opaque proofs for exact
 * post-release cleanup after a durable cancellation intent. Registration is
 * effect-scoped: disposing the contributing fiber immediately invalidates
 * every proof retained by it.
 * @param source - named resolver that owns proof construction and lifetime.
 * @returns an HMR-safe disposer that removes exactly this source.
 * @throws {@link TeamError} when the source name is invalid or already registered.
 */
registerSystemCancellationCleanupProofSource(source: TeamSystemCancellationCleanupProofSource): () => void

/**
 * Register one TeamRun owner that privately resolves opaque proofs for exact
 * post-release channel cleanup after a durable human-receipted final result.
 * Registration is effect-scoped: disposal immediately invalidates every proof.
 * @param source - named resolver that owns proof construction and lifetime.
 * @returns an HMR-safe disposer that removes exactly this source.
 * @throws {@link TeamError} when the source name is invalid or already registered.
 */
registerSystemFinalizationCleanupProofSource(source: TeamSystemFinalizationCleanupProofSource): () => void

/**
 * Register one system owner that privately resolves opaque proofs for exact
 * coordinator-final human receipts. Registration is effect-scoped: disposing
 * the contributing fiber immediately makes all of its proofs invalid.
 * @param source - named resolver that owns proof construction and lifetime.
 * @returns an HMR-safe disposer that removes exactly this source.
 * @throws {@link TeamError} when the source name is invalid or already registered.
 */
registerSystemFinalReceiptProofSource(source: TeamSystemFinalReceiptProofSource): () => void

/**
 * Register one system owner that privately resolves opaque proofs for exact
 * ordinary Envelope admissions. Registration is effect-scoped: disposing the
 * contributing fiber immediately makes all of its proofs invalid.
 * @param source - named resolver that owns proof construction and lifetime.
 * @returns an HMR-safe disposer that removes exactly this source.
 * @throws {@link TeamError} when the source name is invalid or already registered.
 */
registerSystemEnvelopePostProofSource(source: TeamSystemEnvelopePostProofSource): () => void

/**
 * Register one system owner that privately resolves opaque proofs for exact
 * durable task-review recovery. Registration is effect-scoped: disposing the
 * contributing fiber immediately makes all of its proofs invalid.
 * @param source - named resolver that owns proof construction and lifetime.
 * @returns an HMR-safe disposer that removes exactly this source.
 * @throws {@link TeamError} when the source name is invalid or already registered.
 */
registerSystemTaskReviewProofSource(source: TeamSystemTaskReviewProofSource): () => void

/**
 * Register one system owner that privately resolves opaque proofs for exact
 * Team closure commands. Registration is effect-scoped: disposing the
 * contributing fiber immediately makes all of its proofs invalid.
 * @param source - named resolver that owns proof construction and lifetime.
 * @returns an HMR-safe disposer that removes exactly this source.
 * @throws {@link TeamError} when the source name is invalid or already registered.
 */
registerSystemClosureProofSource(source: TeamSystemClosureProofSource): () => void

/**
 * Register one closure driver that privately resolves opaque proofs for
 * exact already-durable lifecycle continuation passes.
 * @param source - named resolver that owns proof construction and lifetime.
 * @returns an HMR-safe disposer that removes exactly this source.
 * @throws {@link TeamError} when the source name is invalid or already registered.
 */
registerSystemClosureDriverProofSource(source: TeamSystemClosureDriverProofSource): () => void

/**
 * Resolve one current closure-driver proof. A source owns the opaque token
 * in private memory; this runtime validates and freezes its durable scope
 * before a provider continues lifecycle settlement.
 * @param proof - runtime-only proof supplied by a registered closure driver.
 * @returns immutable source attribution and the exact durable recovery scope.
 * @throws {@link TeamError} with `TEAM_ACTOR_PROOF_INVALID` when no live source owns the proof or its scope is invalid.
 */
requireSystemClosureDriverProof( proof: TeamSystemClosureDriverProof, ): TeamSystemClosureDriverProofResolution

/**
 * Register one system owner that privately resolves opaque proofs for exact
 * Team phase transitions. Registration is effect-scoped: disposing the
 * contributing fiber immediately makes all of its proofs invalid.
 * @param source - named resolver that owns proof construction and lifetime.
 * @returns an HMR-safe disposer that removes exactly this source.
 * @throws {@link TeamError} when the source name is invalid or already registered.
 */
registerSystemPhaseProofSource(source: TeamSystemPhaseProofSource): () => void

/**
 * Register one system owner that privately resolves opaque proofs for exact
 * destructive Team-maintenance operations. Registration is effect-scoped:
 * disposing the contributing fiber immediately makes all of its proofs invalid.
 * @param source - named resolver that owns proof construction and lifetime.
 * @returns an HMR-safe disposer that removes exactly this source.
 * @throws {@link TeamError} when the source name is invalid or already registered.
 */
registerSystemMaintenanceProofSource(source: TeamSystemMaintenanceProofSource): () => void

/**
 * Register one system owner that privately resolves opaque proofs for exact
 * TeamRun human-to-coordinator soft-interrupt requests. Registration is
 * effect-scoped: disposing the contributing fiber immediately makes all of
 * its proofs invalid.
 * @param source - named resolver that owns proof construction and lifetime.
 * @returns an HMR-safe disposer that removes exactly this source.
 * @throws {@link TeamError} when the source name is invalid or already registered.
 */
registerSystemInterruptProofSource(source: TeamSystemInterruptProofSource): () => void

/**
 * Create one Team, mint its identity, and commit its initial durable state.
 * A nested request names both its parent Team and the parent task; a provider
 * resolves its separate runtime proof and persists the resulting depth under
 * its deployment policy.
 * @param request - JSON-only Team payload plus root or child runtime authority.
 * @returns the detached state committed for the new Team.
 */
abstract createTeam(request: TeamCreateRequest): Promise<TeamStateSnapshot>

/**
 * Read the complete detached state of one Team.
 * @param request - Team identity to read.
 * @returns the current Team state and its journal cursor.
 */
abstract getTeam(request: TeamGetRequest): Promise<TeamStateSnapshot>

/** Read one current human action without copying the Team projection.
 * @param request - Exact Team and action identity.
 * @returns the bounded action snapshot; unsupported providers reject.
 */
getHumanAction(request: TeamHumanActionReadRequest): Promise<TeamHumanActionSnapshot>

/** Read initial Team identity, bounded display text, counts and exact coordinator binding without history arrays.
 * @param request - Team selected for read-only inspection.
 * @returns the lightweight selection projection; no activation is created or resumed.
 */
abstract getTeamSelection(request: TeamSelectionRequest): Promise<TeamSelectionSnapshot>

/** Read bounded display summaries without materializing task/plan execution history.
 * @param request - Team, collection, provider-order cursor and requested row limit.
 * @returns a byte- and row-limited page, with actual scan work and optional continuation.
 */
abstract browse(request: TeamBrowseRequest): Promise<TeamBrowsePage>

/** Read current task fields or one bounded attempt/review history page, without private artifact references.
 * @param request - Exact Team/task, section, optional revision fence and history continuation.
 * @returns detached data capped by the provider's response budget; indivisible oversized records reject.
 */
abstract inspectTask(request: TeamTaskInspectRequest): Promise<TeamTaskInspection>

/** Resolve the latest published Session of one retained Team member without starting an Agent.
 * @param request - exact owning Team and member.
 * @returns published binding, including offline history; missing members or bindings reject.
 */
abstract getMemberSession(request: TeamMemberSessionRequest): Promise<TeamMemberSessionSnapshot>

/** Read non-secret member metadata and one capability page without activating an Agent.
 * @param request - Team/member identity and optional cursor-pinned capability continuation.
 * @returns bounded detail; a changed Team cursor rejects continuation until refreshed.
 */
abstract inspectMember(request: TeamMemberInspectRequest): Promise<TeamMemberInspection>

/**
 * Retain one host-mediated approval/question in the Team journal. Providers
 * that do not offer durable interaction records fail explicitly so callers
 * cannot mistake a transient mux frame for Team truth.
 * The Host source derives the pending action, policy actor, and timestamps;
 * callers provide only runtime proof and JSON routing fields.
 * @param request - Host runtime authority, Team identity, and observed cursor.
 * @returns the accepted or idempotently replayed interaction snapshot.
 */
upsertHumanAction(request: TeamHumanActionUpsertRequest): Promise<TeamHumanActionSnapshot>

/**
 * Settle one durable Team human action through its cursor fence.
 * The Host source derives the action identity, terminal outcome, and policy
 * actor; callers provide only runtime proof and JSON routing fields.
 * @param request - Host runtime authority, Team identity, and observed cursor.
 * @returns the settled interaction snapshot.
 */
resolveHumanAction(request: TeamHumanActionResolveRequest): Promise<TeamHumanActionSnapshot>

/**
 * Record one activation-authorized provider usage sample for Team-subtree
 * budget accounting. Providers derive Team, Participant, and Session from
 * the runtime proof; a child Team's sample is charged to each parent before
 * more child work proceeds. Unsupported providers fail explicitly instead
 * of silently presenting process-local estimates.
 * @param request - runtime activation authority plus JSON-only cursor and
 * provider/model usage facts; callers do not select durable Team,
 * participant, Session, or observed-time provenance because the Hub derives them.
 * @returns the durable aggregate after accepting or replaying the sample.
 */
recordUsage(request: TeamUsageRecordRequest): Promise<TeamUsageSnapshot>

/**
 * Inspect durable Team state for a completion-policy-safe quiescence result.
 * This read never mutates state and intentionally reports blocked tasks,
 * resident activations, and open channels instead of treating incomplete
 * work as completed.
 * @param teamId - Team identity to inspect.
 * @returns detached quiescence diagnostics derived from current Team state.
 */
async inspectQuiescence(teamId: TeamId): Promise<TeamQuiescenceSnapshot>

/**
 * List a bounded page of visible Team summaries for product and transport consumers.
 * @param request - opaque discovery position or -1, plus a physical scan-work limit.
 * @returns detached summaries, scanned work and an optional continuation, including for empty pages.
 */
abstract listTeamsPage(request: TeamListPageRequest): Promise<TeamListPage>

/**
 * Archive one terminal Team without deleting its journals or descendants.
 * @param request - JSON-only Team/cursor fields plus a current runtime archive proof.
 * @returns the complete detached state after archival.
 */
abstract archiveTeam(request: TeamArchiveRequest): Promise<TeamStateSnapshot>

/**
 * Authorize one authenticated human to recover local ownership of an active or stalled Team.
 * @param request - Team cursor fence and runtime-only authenticated-human proof.
 * @returns an opaque authorization that must remain live through coordinator recovery.
 */
authorizeHumanResume(request: TeamHumanResumeRequest): Promise<TeamHumanResumeAuthorization>

/**
 * Read a bounded provider-owned audit projection for the Team journal or one attached channel WAL.
 * @param request - selected Team/source, cursor, and page limit.
 * @returns source records projected without changing authoritative state.
 */
abstract readAudit(request: TeamAuditReadRequest): Promise<TeamAuditReadResult>

/**
 * Wait until a Team journal moves beyond a caller-observed cursor, closes, or
 * the caller aborts its local wait. Providers omit `request.signal` before
 * parsing the JSON-only request fields; cancellation changes no durable data.
 * @param request - Team identity, last observed journal cursor, and optional local cancellation.
 * @returns an advanced cursor, or closed at an immutable archived tail or provider shutdown.
 * @throws when `request.signal` aborts before the watch resolves.
 */
abstract watchTeam(request: TeamWatchRequest): Promise<TeamWatchResult>

/**
 * Compare-and-set one Team lifecycle transition.
 * @param request - Team identity, observed cursor, and next lifecycle phase.
 * @returns the complete detached state after the committed transition.
 */
abstract transitionTeamPhase(request: TeamPhaseTransitionRequest): Promise<TeamStateSnapshot>

/**
 * Validate a Consumer call against its live provider-owned sink capability.
 * @param proof - Runtime-only capability supplied by the Hub command.
 * @param scope - Complete operation and exact data selected for this storage call.
 */
validateHumanSinkProof(proof: TeamHumanSinkProof, scope: TeamHumanSinkScope): void

/**
 * Register an exact ordinary-human-delivery proof owner.
 * @param source - Consumer that retains proof construction and lifetime.
 * @returns Effect disposer that immediately revokes the source.
 */
registerSystemHumanDeliveryProofSource(source: TeamSystemHumanDeliveryProofSource): () => void | Promise<void>

/**
 * Persist one ordinary human delivery and then its receipt under exact source authority.
 * @param request - Current source proof and observed pending-delivery selection.
 * @returns Durable inbox item and recipient receipt.
 */
admitHumanChannelDelivery(request: TeamHumanChannelDeliveryRequest): Promise<TeamHumanChannelDeliveryResult>

/** Accept a live Host-owned answer before invoking its callback.
 * @param request - Exact source proof and Team cursor.
 * @returns Durable action with response acceptance.
 */
acceptHumanActionResponse(request: TeamHumanActionResolveRequest): Promise<TeamHumanActionSnapshot>

/** Cancel an unrecoverable action and stall its Team without inventing a callback.
 * @param request - Failure-only Host proof.
 * @returns Explicit unavailable action.
 */
unavailableHumanAction(request: TeamHumanActionResolveRequest): Promise<TeamHumanActionSnapshot>

/**
 * Persist final acceptance through the closed TeamRun result owner.
 * @param request - exact WAL content selection and current source-owned proof.
 * @returns the flushed admission, or its original value for an identical retry.
 */
admitTeamFinalResult(request: TeamFinalAdmissionRequest): Promise<TeamFinalAdmission>

/**
 * Accept an authenticated completion intent; receipt repair requires separate durable final admission.
 * @param request - exact authorized closure selection.
 * @returns the durable completion intent state.
 */
completeTeam(request: TeamCompleteRequest): Promise<TeamStateSnapshot>

/**
 * Accept one Team failure intent through the provider's failure policy.
 * @param request - authenticated structured failure command.
 * @returns the durable quiescing state; a closure driver commits terminal failure after owned work settles.
 */
failTeam(request: TeamFailRequest): Promise<TeamStateSnapshot>

/**
 * Cancel one Team through the provider's admission and quiescence policy.
 * @param request - authenticated structured cancellation command.
 * @returns the terminal Team state, or the durable quiescing/stalled state
 *   while an owned resource still needs to settle.
 */
cancelTeam(request: TeamCancelRequest): Promise<TeamStateSnapshot>

/**
 * Continue one source-owned Team lifecycle observation or already durable
 * closure/cancellation through a runtime-only recovery proof.
 * @param request - cursor-fenced durable Team selection plus recovery proof.
 * @returns the current Team state after one provider-owned recovery pass.
 */
continueTeamClosure(request: TeamClosureContinuationRequest): Promise<TeamStateSnapshot>

/**
 * Compare-and-set a Team objective's text and/or goal-specific resource limits through one exact activation or authenticated-human proof.
 * @param request - runtime authority, Team identity, observed goal revision, and at least one replacement field.
 * @returns the complete detached state after the committed objective update.
 */
abstract updateTeamGoal(request: TeamGoalUpdateRequest): Promise<TeamStateSnapshot>

/**
 * Compare-and-set a Team objective lifecycle transition through one exact activation or authenticated-human proof.
 * @param request - runtime authority, Team identity, observed goal revision, next objective phase, and optional blocker.
 * @returns the complete detached state after the committed objective transition.
 */
abstract transitionTeamGoalPhase(request: TeamGoalPhaseTransitionRequest): Promise<TeamStateSnapshot>

/**
 * Invite one participant, mint its identity, and commit its initial phase.
 * @param request - topology or authenticated-human proof plus Team identity, observed cursor, and participant descriptor.
 * @returns the detached participant projection after invitation.
 */
abstract inviteParticipant(request: ParticipantInviteRequest): Promise<ParticipantSnapshot>

/**
 * List a bounded page of detached participant projections for one Team.
 * @param request - Team identity, provider-order cursor, and page limit.
 * @returns participant projections and an optional continuation cursor.
 */
abstract listParticipantsPage(request: TeamMemberListPageRequest): Promise<TeamMemberListPage>

/**
 * Compare-and-set one participant-membership lifecycle transition.
 * @param request - topology or authenticated-human proof plus Team/participant identities, observed cursor, and next phase.
 * @returns the detached participant projection after the transition.
 */
abstract transitionParticipantPhase(request: ParticipantPhaseTransitionRequest): Promise<ParticipantSnapshot>

/**
 * Persist a published activation's immutable Session and provider binding.
 * @param request - source-owned runtime proof, observed Team cursor, and published activation binding.
 * @returns the detached durable binding after acceptance.
 */
abstract bindActivation(request: ActivationBindRequest): Promise<ActivationBindingSnapshot>

/** Reserve capacity before invoking an activation provider.
 * @param request - Exact controller-owned startup identity and cursor.
 * @returns the durable startup reservation.
 */
abstract reserveActivation(request: ActivationReservationRequest): Promise<ActivationReservationSnapshot>

/** Release an unpublished startup only after its controller proves cleanup.
 * @param request - Exact reservation, owner and current cursor.
 * @returns the reservation carrying its durable release time.
 */
abstract releaseActivationReservation(request: ActivationReservationRequest): Promise<ActivationReservationSnapshot>

/**
 * Persist one permitted residency-status transition for a bound activation.
 * @param request - source-owned runtime proof, Team/activation identity, observed cursor, and next status.
 * @returns the detached binding after its durable status update.
 */
abstract updateActivationStatus(request: ActivationStatusUpdateRequest): Promise<ActivationBindingSnapshot>

/**
 * Atomically release task leases held by one externally fenced activation,
 * record its offline fence proof, and retire any recorded wake channels.
 * Callers must prove process termination before invoking this trusted recovery operation.
 * @param request - source-owned runtime proof, exact activation relation, and current Team cursor.
 * @returns the complete detached Team state after lease release and offline transition.
 */
abstract fenceActivation(request: ActivationFenceRequest): Promise<TeamStateSnapshot>

/**
 * Release task leases held by one locally settled activation and persist its
 * quiescence proof before another epoch can use the same Session.
 * @param request - source-owned runtime proof, exact activation relation, and current Team cursor.
 * @returns the complete detached Team state after quiescence settles.
 */
abstract quiesceActivation(request: ActivationQuiesceRequest): Promise<TeamStateSnapshot>

/**
 * Read one durable activation binding.
 * @param request - Team and activation identities.
 * @returns the current durable binding.
 */
abstract getActivation(request: ActivationGetRequest): Promise<ActivationBindingSnapshot>

/**
 * Resolve the current TeamRun human/coordinator topology from one
 * source-owned proof and commit its soft interrupt request. A matching
 * unacknowledged target returns its existing durable request without another append.
 * @param request - runtime TeamRun authority, Team identity, and observed cursor.
 * @returns the durable request bound to the resolved activation, Session, and provider.
 */
abstract requestParticipantInterrupt(request: ParticipantInterruptRequest): Promise<ParticipantInterruptSnapshot>

/**
 * List unacknowledged soft interrupts for one exact current activation proof.
 * @param request - runtime target authority without caller-selected binding identities.
 * @returns detached pending interrupts in durable request order.
 */
abstract listPendingParticipantInterrupts( request: ParticipantInterruptListPendingRequest, ): Promise<readonly ParticipantInterruptSnapshot[]>

/**
 * Acknowledge one soft interrupt from the exact current activation it targets.
 * Repeating an acknowledgement returns the original durable acknowledgement.
 * @param request - runtime target authority and selected interrupt identity.
 * @returns the acknowledged durable interrupt.
 */
abstract acknowledgeParticipantInterrupt( request: ParticipantInterruptAcknowledgeRequest, ): Promise<ParticipantInterruptSnapshot>

/**
 * Create one Team task, mint its identity, and commit its initial phase. The runtime proof derives either an
 * activation creator or an authenticated human creator; the provider replays its original task before cursor
 * comparison. A conflicting command reuse rejects.
 * @param request - Team identity, observed cursor, complete task fields, retry command, and runtime proof.
 * @returns the detached task projection after creation or matching command replay.
 */
abstract createTask(request: TeamTaskCreateRequest): Promise<TeamTaskSnapshot>

/**
 * Compare-and-set an advisory preferred owner for one pending task. The
 * proposal is a scheduler hint only; it does not grant task or Participant
 * authority and a provider may select another eligible owner.
 * @param request - Team/task identity, observed task revision, and optional preferred Participant.
 * @returns the detached task projection after the proposal change.
 */
proposeTaskOwner(request: TeamTaskOwnerProposalRequest): Promise<TeamTaskSnapshot>

/**
 * Admit one complete JSON workflow plan before any compiled task or channel
 * record is created. Providers retain the plan in `compiling` so recovery can
 * resume the compiler from durable bindings.
 * @param request - Team cursor, retry identity, complete workflow plan, and current coordinator proof.
 * @returns the accepted or idempotently replayed workflow plan.
 */
admitWorkflowPlan(request: TeamWorkflowPlanAdmissionRequest): Promise<TeamWorkflowPlanSnapshot>

/** Read current workflow metadata and one task/dependency window.
 * @param request - Exact workflow, optional revision and page selection.
 * @returns a bounded inspection without complete plan or result bodies.
 */
inspectWorkflowPlan(request: TeamWorkflowInspectRequest): Promise<TeamWorkflowInspection>

/**
 * Read one durable workflow plan and its compiled task/channel bindings.
 * @param request - owning Team and workflow plan identities.
 * @returns the current detached workflow plan projection.
 */
getWorkflowPlan(request: TeamWorkflowPlanGetRequest): Promise<TeamWorkflowPlanSnapshot>

/**
 * List a bounded page of workflow plans in durable admission order.
 * @param request - Team identity, provider-order cursor, and page limit.
 * @returns detached workflow plan projections and an optional continuation cursor.
 */
listWorkflowPlansPage(request: TeamWorkflowPlanListPageRequest): Promise<TeamWorkflowPlanListPage>

/**
 * Bind one durable Team task to its plan-local template.
 * @param request - TeamRun workflow proof plus JSON-only Team/plan cursor fences and task binding.
 * @returns the updated detached workflow plan projection.
 */
bindWorkflowPlanTask(request: TeamWorkflowPlanTaskBindRequest): Promise<TeamWorkflowPlanSnapshot>

/**
 * Bind one durable workflow channel to its plan.
 * @param request - TeamRun workflow proof plus JSON-only Team/plan cursor fences and channel identity.
 * @returns the updated detached workflow plan projection.
 */
bindWorkflowPlanChannel(request: TeamWorkflowPlanChannelBindRequest): Promise<TeamWorkflowPlanSnapshot>

/**
 * Advance a workflow plan to `ready` or retain one terminal result/failure.
 * @param request - TeamRun workflow proof plus JSON-only Team/plan cursor fences and next durable phase.
 * @returns the updated detached workflow plan projection.
 */
transitionWorkflowPlan(request: TeamWorkflowPlanPhaseRequest): Promise<TeamWorkflowPlanSnapshot>

/**
 * Read one detached Team task projection, including a deleted tombstone.
 * @param request - Team and task identities to read.
 * @returns the current task projection.
 */
abstract getTask(request: TeamTaskGetRequest): Promise<TeamTaskSnapshot>

/** Reserve one child identity and complete creation payload under parent-task CAS.
 * @param request - exact source-owned reservation and resolved child template.
 * @returns the running parent task retaining its child reservation.
 */
abstract beginTaskDelegation(request: TeamTaskDelegationBeginRequest): Promise<TeamTaskSnapshot>

/** Bind a published child runtime to its existing parent reservation.
 * @param request - current task/delegation/child identities and revision.
 * @returns the active parent delegation projection.
 */
abstract bindTaskDelegation(request: TeamTaskDelegationBindRequest): Promise<TeamTaskSnapshot>

/** Settle a child task only after terminal child execution and parent charging.
 * @param request - exact child reservation and current parent task revision.
 * @returns the terminal parent task retaining child result and failure provenance.
 */
abstract settleTaskDelegation(request: TeamTaskDelegationSettleRequest): Promise<TeamTaskSnapshot>

/** Retain a child operational stall without releasing its concurrency or scopes.
 * @param request - current parent task and exact stall reason.
 * @returns the stalled delegation projection.
 */
abstract stallTaskDelegation(request: TeamTaskDelegationStallRequest): Promise<TeamTaskSnapshot>

/** Authorize one child startup or cancellation with live parent and workspace checks.
 * @param request - source-owned exact operation and parent revision.
 * @returns a provider-owned runtime capability whose caller must close after settlement.
 */
abstract authorizeChildRun(request: TeamChildRunAuthorizeRequest): Promise<TeamChildRunAuthorization>

/**
 * List a bounded page of current detached task projections for one Team.
 * @param request - Team identity, provider-order cursor, and page limit.
 * @returns detached task projections and an optional continuation cursor.
 */
abstract listTasksPage(request: TeamTaskListPageRequest): Promise<TeamTaskListPage>

/** Resolve one visible, unambiguous Team artifact reference.
 * @param request - Team identity and artifact id selected by the caller.
 * @returns the visible reference, or `undefined` for missing, private, or ambiguous identities.
 */
getArtifact(request: TeamArtifactGetRequest): Promise<TeamArtifactReference | undefined>

/** List a bounded page of visible, unambiguous Team artifact references.
 * @param request - Team identity, provider-order cursor, and page limit.
 * @returns visible artifact references and an optional continuation cursor.
 */
listArtifactsPage(request: TeamArtifactListPageRequest): Promise<TeamArtifactListPage>

/**
 * Compare-and-set a lease-free task details edit without changing phase, scheduler facts, or attempts.
 * @param request - current coordinator proof plus JSON-only task detail fields.
 * @returns the detached task projection after the committed details edit.
 */
abstract updateTaskDetails(request: TeamTaskDetailsUpdateRequest): Promise<TeamTaskSnapshot>

/**
 * Persist a single-task cancellation while exact live work retains ownership.
 * @param request - Team/task identities and the observed task revision.
 * @returns accepted stop progress or the settled task after owner cleanup.
 */
abstract cancelTask(request: TeamTaskCancelRequest): Promise<TeamTaskSnapshot>

/**
 * Continue an accepted lease-free cancellation after interrupted channel cleanup.
 * @param request - scheduler proof and the exact retained cancellation revision.
 * @returns the task after its corresponding review channel closes.
 */
abstract reconcileTaskCancellation(request: TeamTaskCancellationReconcileRequest): Promise<TeamTaskSnapshot>

/**
 * Cancel one exact pending task only while a durable TeamRun cancellation
 * intent still owns the selected Team. This narrow post-release cleanup
 * command deliberately does not grant generic task-cancellation authority.
 * @param request - TeamRun cancellation-cleanup proof plus Team/task/cancellation cursor fences.
 * @returns the detached cancelled task projection.
 */
cancelTeamCancellationTask(request: TeamCancellationTaskCancelRequest): Promise<TeamTaskSnapshot>

/**
 * Replace a lease-free non-review task with its deleted tombstone after provider DAG and policy checks.
 * @param request - current coordinator proof plus JSON-only task tombstone fields.
 * @returns the detached deleted task projection after the committed tombstone.
 */
abstract deleteTask(request: TeamTaskDeleteRequest): Promise<TeamTaskSnapshot>

/**
 * Resolve a lease-free review task through task-mutate policy for the reviewer
 * derived from its current activation proof.
 * @param request - runtime reviewer proof plus JSON-only task/revision/decision fields.
 * @returns the detached task projection after the committed review resolution.
 */
abstract resolveTaskReview(request: TeamTaskReviewResolveRequest): Promise<TeamTaskSnapshot>

/**
 * Recover one task review from the exact durable consult response selected by
 * a registered system source. The source scope, rather than caller fields,
 * identifies the Team, reviewer, request, response, decision, and reason.
 * @param request - runtime-only system recovery proof.
 * @returns the detached task projection after the recovered review decision.
 */
abstract resolveTaskReviewFromResponse(request: TeamTaskReviewRecoverRequest): Promise<TeamTaskSnapshot>

/**
 * Assign a pending task, mint its next non-reusable attempt id, and commit its bounded lease.
 * The scheduler source selects the exact task, participant, optional activation,
 * wake channel, and lease duration through runtime-only authority.
 * @param request - scheduler proof plus JSON-only assignment identifiers and bounds.
 * @returns the detached assigned task projection with its current lease.
 */
abstract assignTask(request: TeamTaskAssignRequest): Promise<TeamTaskSnapshot>

/**
 * Start the exact current attempt after checking its revision, id, participant, and optional activation epoch.
 * @param request - current activation proof plus JSON-only task attempt fence.
 * @returns the detached running task projection with its current lease.
 */
abstract startTaskAttempt(request: TeamTaskAttemptStartRequest): Promise<TeamTaskSnapshot>

/**
 * Claim and start the exact assigned attempt after its durable assignment
 * Envelope reaches the activation bound to the request's runtime-only actor
 * proof. Providers derive the Team, Participant, activation, and Session
 * from that proof. Repeating the same current claim after it starts returns
 * the running task without another durable transition.
 * @param request - Runtime actor proof, lease identity, assignment revision, assignment channel, and accepted Envelope.
 * @returns the detached running task projection for the current attempt.
 */
abstract claimTaskAttemptStart(request: TeamTaskAttemptStartClaimRequest): Promise<TeamTaskSnapshot>

/**
 * Renew the exact current attempt for its fixed lease duration after resolving its runtime-only actor proof.
 * Providers derive the Team, Participant, activation, and Session from that proof before renewing the lease.
 * @param request - Runtime actor proof, task-attempt identity, and observed revision.
 * @returns the detached task projection with its renewed current lease.
 */
abstract heartbeatTaskAttempt(request: TeamTaskAttemptHeartbeatRequest): Promise<TeamTaskSnapshot>

/**
 * Settle the exact current attempt once, retaining its closed outcome and removing its lease.
 * The provider maps completed to direct completion or review from the frozen route, cancelled to cancelled,
 * and released or failed to pending until maxAttempts, then failed.
 * Providers resolve the runtime-only actor proof and derive the Team, Participant, activation, and Session
 * before mapping the closed outcome.
 * @param request - Runtime actor proof, task-attempt identity, observed revision, and closed outcome.
 * @returns the detached task projection with the settled attempt in its bounded history.
 */
abstract settleTaskAttempt(request: TeamTaskAttemptSettleRequest): Promise<TeamTaskSnapshot>

/**
 * Expire an elapsed current lease once, retaining a lease-expired outcome before retry or failure.
 * The provider returns the task to pending until maxAttempts, then fails it.
 * @param request - scheduler proof plus JSON-only task-attempt fence.
 * @returns the detached task projection with the expired attempt in its bounded history.
 */
abstract expireTaskAttempt(request: TeamTaskAttemptExpireRequest): Promise<TeamTaskSnapshot>

/**
 * Commit a provider-owned bounded workspace observation against its exact allocation and prior scan.
 * @param request - Live provider proof and complete scan facts with allocation revision and prior observation CAS.
 * @returns The durable observation with derived task/attempt identity and scope classifications.
 */
abstract recordWorkspaceObservation(request: TeamWorkspaceObservationRequest): Promise<TeamWorkspaceObservation>

/**
 * Reserve one provider allocation before its filesystem root is materialized.
 * @param request - source-owned allocation reservation scope.
 * @returns the durable allocation snapshot after reservation.
 */
abstract reserveWorkspaceAllocation(request: TeamWorkspaceAllocationReserveRequest): Promise<TeamWorkspaceAllocationSnapshot>

/**
 * Mark one reserved or preserved allocation active after provider materialization or restore.
 * @param request - source-owned allocation activation scope.
 * @returns the durable allocation snapshot after activation.
 */
abstract activateWorkspaceAllocation(request: TeamWorkspaceAllocationActivateRequest): Promise<TeamWorkspaceAllocationSnapshot>

/**
 * Persist release intent before the provider starts physical cleanup.
 * @param request - source-owned allocation release-intent scope.
 * @returns the durable allocation snapshot after release intent.
 */
abstract requestWorkspaceAllocationRelease(request: TeamWorkspaceAllocationReleaseRequest): Promise<TeamWorkspaceAllocationSnapshot>

/**
 * Preserve one source-owned provider allocation that cannot yet be released.
 * @param request - source-owned allocation preservation scope.
 * @returns the durable allocation snapshot after preservation.
 */
abstract preserveWorkspaceAllocation(request: TeamWorkspaceAllocationPreserveRequest): Promise<TeamWorkspaceAllocationSnapshot>

/** Persist exact provider loss without inferring resource release.
 * @param request - source-owned allocation/world/revision and retained artifacts.
 * @returns the unavailable allocation retaining its exact loss observation.
 */
abstract recordWorkspaceAllocationLoss(request: TeamWorkspaceAllocationLossRequest): Promise<TeamWorkspaceAllocationSnapshot>

/**
 * Confirm successful release of one source-owned provider allocation.
 * @param request - source-owned allocation release-confirmation scope.
 * @returns the durable allocation snapshot after release.
 */
abstract confirmWorkspaceAllocationRelease( request: TeamWorkspaceAllocationReleaseConfirmRequest, ): Promise<TeamWorkspaceAllocationSnapshot>

/**
 * Open one channel, mint its identity, and commit its immutable manifest.
 * TeamRun bootstrap and workflow-plan channels require their exact runtime
 * proofs; other generic channels retain their existing JSON-only request form.
 * @param request - Team identity, observed cursor, adapter identity, manifest fields, and runtime proof when applicable.
 * @returns the detached channel projection after opening.
 */
abstract openChannel(request: ChannelOpenRequest): Promise<ChannelSnapshot>

/**
 * Read durable channel invitations without acknowledging endpoint support.
 * @param request - channel whose admission is inspected.
 * @returns exact channel and invitation projection.
 */
getChannelAdmission(request: ChannelGetRequest): Promise<ChannelAdmissionSnapshot>

/**
 * List attached channels for the current authenticated human Team member.
 * @param request - Exact actor-free page selection plus its runtime membership proof.
 * @returns Bounded channel projections and an optional insertion-index continuation.
 */
listTeamChannels(request: TeamChannelListRequest): Promise<TeamChannelListPage>

/**
 * Read one retained Envelope after checking current Team-human membership.
 * @param request - Exact Team, channel, Envelope and current source-owned proof.
 * @returns Immutable accepted content; missing or compacted Envelopes reject.
 */
getHumanChannelEnvelope(request: ChannelHumanEnvelopeGetRequest): Promise<TeamEnvelope>

/**
 * Read an attached channel's invitation status for an authenticated Team human.
 * @param request - Team, channel and current payload-bound principal proof.
 * @returns Complete admission state without granting endpoint consent authority.
 */
getHumanChannelAdmission(request: ChannelHumanAdmissionGetRequest): Promise<ChannelHumanAdmissionSnapshot>

/**
 * Read only the authenticated human's invitation without accepting the protocol.
 * @param request - channel identity and current payload-bound human proof.
 * @returns manifest and the caller's own invitation.
 */
getHumanChannelInvitation(request: ChannelHumanInvitationGetRequest): Promise<ChannelHumanInvitationSnapshot>

/**
 * Confirm a manifest using the invited endpoint's current activation proof.
 * @param request - exact invitation revision, accepted manifest and retry identity.
 * @returns the durable acknowledgement and possibly activated channel.
 */
acknowledgeChannelInvitation(request: ChannelInvitationAcknowledgeRequest): Promise<ChannelAdmissionSnapshot>

/**
 * End due invitations using an admission-owned clock and exact durable cursors.
 * @param request - source proof and bounded channel selection.
 * @returns the durable invitations and resulting channel phase.
 */
expireChannelInvitations(request: ChannelInvitationExpireRequest): Promise<ChannelAdmissionSnapshot>

/**
 * Open one exact scheduler-owned consult channel for a participant-review task.
 * @param request - scheduler channel proof plus Team/task/review binding fences.
 * @returns the detached opened consult channel projection.
 */
openSchedulerReviewChannel(request: SchedulerReviewChannelOpenRequest): Promise<ChannelSnapshot>

/**
 * Open one exact scheduler-owned self-addressed task-assignment wake channel.
 * @param request - scheduler channel proof plus Team/task/activation binding fences.
 * @returns the detached opened wake channel projection.
 */
openSchedulerWakeChannel(request: SchedulerWakeChannelOpenRequest): Promise<ChannelSnapshot>

/**
 * Authenticate, authorize, stamp, and atomically append one channel Envelope.
 * The JSON input carries only the observed cursor, optional retry key, and
 * unstamped draft. An activation proof derives a current sender; an
 * authenticated-human proof derives an active product human sender; a
 * registered system proof derives only its scoped TeamRun human input or
 * scheduler-owned assignment/review post. Task-assignment and review-request
 * drafts reject an activation proof before policy or WAL admission.
 * @param request - runtime actor proof plus JSON-only channel post fields.
 * @returns the immutable Envelope accepted by the durable channel WAL.
 */
abstract postChannelEnvelope(request: ChannelEnvelopePostRequest): Promise<TeamEnvelope>

/**
 * Atomically prepare and append one protocol-owned final Envelope. The
 * provider derives the sender, peer, draft, and cursor under its channel write lock.
 * @param request - runtime actor proof plus selected channel, retry key, and final text.
 * @returns the immutable final Envelope accepted by the durable channel WAL.
 */
abstract postChannelFinalEnvelope(request: ChannelFinalPostRequest): Promise<TeamEnvelope>

/**
 * Append one durable receipt after an authenticated recipient persists the
 * referenced Envelope in its own delivery target. A duplicate receipt
 * returns the original durable record without another channel-WAL append.
 * The runtime-only actor derives the recipient; providers resolve it before
 * policy evaluation or pending-delivery removal.
 * @param request - runtime authority plus JSON-only accepted Envelope and cursor fields.
 * @returns the immutable receipt accepted by the durable channel WAL.
 */
abstract ackChannelEnvelope(request: ChannelEnvelopeReceiptRequest): Promise<ChannelReceiptRecord>

/**
 * Atomically claim one unacknowledged Envelope delivery through an opaque
 * activation proof. The provider resolves the proof under its Team/channel
 * serializers before it derives the recipient binding and treatment. A
 * defined claim neither reserves a model turn nor promises exactly-once
 * delivery; it is ephemeral and has no claim identifier or settlement operation.
 * @param request - runtime-only activation proof plus JSON-only channel and Envelope identities.
 * @returns the claim, or `undefined` when the recipient already durably acknowledged the Envelope.
 */
abstract claimChannelDelivery(request: ChannelDeliveryClaimRequest): Promise<ChannelDeliveryClaim | undefined>

/**
 * List a bounded page of currently pending deliveries for one recipient.
 * `afterCursor` is an exclusive source channel-WAL cursor, never a receipt
 * high-water. This discovery read neither claims nor acknowledges a delivery;
 * a consumer must call {@link claimChannelDelivery} before delivery.
 * @param request - channel, recipient, exclusive source cursor, and page limit.
 * @returns detached pending deliveries and the cursor for the next page or watch.
 */
abstract listChannelPendingDeliveries(request: ChannelPendingDeliveryListRequest): Promise<ChannelPendingDeliveryPage>

/**
 * Durably expire one exact bounded TTL delivery batch through a scheduler-owned proof.
 * @param request - scheduler channel proof plus Team/channel cursors, clock observation, and bound.
 * @returns the channel projection and expiry records committed by the authorized batch.
 */
expireSchedulerChannelDeliveries(request: SchedulerChannelDeliveryExpireRequest): Promise<ChannelDeliveryExpireResult>

/**
 * Read bounded channel-wide source content for an authenticated explicit summary selection.
 * @param request - Current coordinator/human proof and exact channel/range/retry selection.
 * @returns The ordered source content and fingerprint, or the matching committed result.
 */
abstract readChannelSummarySource(request: ChannelSummarySourceRequest): Promise<ChannelSummarySource>

/**
 * Append one idempotent durable summary over a bounded channel source range.
 * @param request - runtime summary proof plus JSON-only channel source and retry fields.
 * @returns the committed channel summary record.
 */
abstract summarizeChannel(request: ChannelSummarizeRequest): Promise<ChannelSummaryRecord>

/**
 * Read one detached channel projection.
 * @param request - channel identity to read.
 * @returns the current channel projection and WAL cursor.
 */
abstract getChannel(request: ChannelGetRequest): Promise<ChannelSnapshot>

/**
 * Read channel metadata only for a current member activation, including pending admission.
 * @param request - current actor proof and channel identity, without caller-selected member identity.
 * @returns manifest, phase and cursors; no messages, summaries or adapter state.
 */
getChannelForActor(request: ChannelActorGetRequest): Promise<ChannelSnapshot>

/**
 * Read records committed after one caller-observed channel-WAL cursor.
 * @param request - channel identity and last observed WAL cursor.
 * @returns the detached channel projection and ordered record suffix.
 */
abstract readChannel(request: ChannelReadRequest): Promise<ChannelReadResult>

/**
 * Read a bounded page of records committed after one channel-WAL cursor.
 * @param request - channel identity, cursor, and page limit.
 * @returns the detached channel projection, page records, and continuation cursor.
 */
abstract readChannelPage(request: ChannelReadPageRequest): Promise<ChannelReadPageResult>

/**
 * Compact a terminal channel's obsolete WAL prefix after durable delivery
 * and checkpoint watermarks prove the prefix is no longer required.
 * @param request - Team/channel identity, observed cursor, and prefix bound.
 * @returns the channel projection and compaction watermarks.
 */
abstract compactChannel(request: TeamChannelCompactRequest): Promise<TeamChannelCompactResult>

/**
 * Compact a terminal Team journal's obsolete prefix after durable audit and
 * checkpoint watermarks prove the prefix is no longer required.
 * @param request - Team identity, maintenance actor, observed cursor, and prefix bound.
 * @returns the Team projection and compaction watermarks.
 */
abstract compactTeam(request: TeamJournalCompactRequest): Promise<TeamJournalCompactResult>

/**
 * Compare-and-set closure of one channel.
 * @param request - channel identity, observed WAL cursor, and optional reason.
 * @returns the detached terminal channel projection.
 */
abstract closeChannel(request: ChannelCloseRequest): Promise<ChannelSnapshot>

/**
 * Close one exact scheduler-owned wake channel only when no current lease owns it.
 * @param request - scheduler channel proof plus immutable wake-manifest and channel cursor fences.
 * @returns the detached terminal wake channel projection.
 */
closeSchedulerFailedWakeChannel(request: SchedulerFailedWakeChannelCloseRequest): Promise<ChannelSnapshot>

/**
 * Close one exact active channel only while a durable TeamRun cancellation
 * intent still owns the selected Team. This narrow post-release cleanup
 * command deliberately does not grant generic channel-close authority.
 * @param request - TeamRun cancellation-cleanup proof plus Team/channel/cancellation cursor fences and reason.
 * @returns the detached terminal channel projection.
 */
closeTeamCancellationChannel(request: TeamCancellationChannelCloseRequest): Promise<ChannelSnapshot>

/**
 * Close one exact active channel only while a durable human-receipted TeamRun
 * final result still owns the selected Team. This narrow post-release cleanup
 * command deliberately does not grant generic channel-close authority.
 * @param request - TeamRun finalization-cleanup proof plus Team/final/channel cursor fences and completion reason.
 * @returns the detached terminal channel projection.
 */
closeTeamFinalizationChannel(request: TeamFinalizationChannelCloseRequest): Promise<ChannelSnapshot>

/**
 * Close one exact active workflow channel only while its compiling plan has
 * not bound that channel. TeamRun uses this narrow cleanup command after a
 * failed compiler open/bind attempt so no orphaned workflow channel remains.
 * @param request - TeamRun workflow proof plus Team/plan/channel cursor fences and optional reason.
 * @returns the detached terminal channel projection.
 */
closeWorkflowChannel(request: TeamWorkflowChannelCloseRequest): Promise<ChannelSnapshot>

/**
 * Wait until a channel WAL moves beyond a caller-observed cursor, closes, or
 * the caller aborts its local wait. Providers omit `request.signal` before
 * parsing the JSON-only request fields; cancellation changes no durable data.
 * @param request - channel identity, last observed WAL cursor, and optional local cancellation.
 * @returns whether the cursor advanced or the provider closed the watch.
 * @throws when `request.signal` aborts before the watch resolves.
 */
abstract watchChannel(request: ChannelWatchRequest): Promise<ChannelWatchResult>

/**
 * Register one synchronous pure channel adapter. Registration is effect-scoped
 * and duplicate accepting `(type, version)` identities reject before publication.
 * @param adapter - adapter implementation for future channel openings.
 * @returns an HMR-safe disposer that retires exactly this registration while existing leases retain its object.
 */
registerAdapter(adapter: TeamChannelAdapter): () => void

/**
 * Resolve one exact adapter implementation that still accepts new work.
 * @param ref - type and version frozen in a channel manifest.
 * @returns the accepting registered adapter.
 * @throws {@link TeamError} when no accepting exact adapter remains registered.
 */
getAdapter(ref: TeamAdapterRef): TeamChannelAdapter

/**
 * Acquire one exact adapter object for an already admitted channel. Retiring
 * its registration blocks later acquisitions but does not invalidate this
 * handle.
 * @param ref - type and version frozen in a channel manifest.
 * @returns a release-once handle retaining the exact adapter object.
 * @throws {@link TeamError} when no accepting exact adapter is registered.
 */
acquireAdapter(ref: TeamAdapterRef): TeamAdapterLease

/**
 * List registered adapter identities in registration order.
 * @returns detached adapter references.
 */
listAdapters(): TeamAdapterRef[]

/**
 * Register one pure versioned channel view policy through a Cordis effect.
 * @param policy - view-policy implementation.
 * @returns an HMR-safe disposer that retires the registration while existing leases retain its object.
 */
registerViewPolicy(policy: TeamViewPolicy): () => void

/**
 * Resolve one exact durable channel view policy identity that still accepts new work.
 * @param ref - versioned view-policy identity.
 * @returns the accepting registered pure view-policy implementation.
 * @throws {@link TeamError} when no accepting exact view policy remains registered.
 */
getViewPolicy(ref: TeamViewPolicyRef): TeamViewPolicy

/**
 * Acquire one exact view-policy object for an already admitted channel.
 * Retiring its registration blocks later acquisitions but does not invalidate
 * this handle.
 * @param ref - type and version frozen in a channel manifest.
 * @returns a release-once handle retaining the exact policy object.
 * @throws {@link TeamError} when no accepting exact view policy is registered.
 */
acquireViewPolicy(ref: TeamViewPolicyRef): TeamViewPolicyLease

/**
 * List registered channel view policies in registration order.
 * @returns detached view-policy identities.
 */
listViewPolicies(): TeamViewPolicyRef[]

/**
 * Return process-local counts for accepting and retired implementation
 * registrations plus the channel leases retaining them.
 * @returns a detached snapshot for HMR and runtime diagnostics.
 */
getImplementationLeaseMetrics(): TeamImplementationLeaseMetrics

/**
 * Return a detached operational counter/gauge snapshot for dashboards and alerts.
 * @returns current in-process Team metrics.
 */
getMetrics(): TeamMetricsSnapshot

/** Record one workspace integration conflict observed by a Team provider. */
reportWorkspaceConflict(): void

/**
 * Register one named policy for exactly one Team operation. Matching requests
 * reach it through the `team/policy` waterfall; nonmatching hooks delegate.
 * @param hook - Team operation this policy intercepts.
 * @param policy - named policy implementation.
 * @returns an HMR-safe disposer that removes exactly this policy.
 */
registerPolicy(hook: TeamPolicyHook, policy: TeamPolicy): () => void

/**
 * List current policy registrations in hook and registration order.
 * @returns detached diagnostic identities.
 */
listPolicies(): TeamPolicyRegistration[]

/**
 * Run the policy waterfall for one provider-validated Team operation.
 * @param request - operation facts to authorize or govern.
 * @returns the final allow or deny decision.
 */
async authorize(request: TeamPolicyRequest): Promise<TeamPolicyDecision>
```

Types: [TeamWorkspaceAllocationLossRequest](team-workspace.md) · [TeamWorkspaceObservation](team-workspace.md) · [TeamWorkspaceObservationRequest](team-workspace.md)

Source: [`packages/core/team/src/runtime.ts`](../../packages/core/team/src/runtime.ts)

<a id="ctxteamtelemetry--teamtelemetrybackend-abstract-seam"></a>

### `ctx.teamTelemetry` — `TeamTelemetryBackend` (abstract seam)

Team telemetry backend Service Definition. A deployment provider extends this class and composes TeamTelemetryCoordinator; the coordinator owns capture and correlation, while batching, retry, loss, and export stay with the provider.

```ts cordis-catalog
/**
 * See {@link TeamTelemetrySink.emit}.
 * @param record - detached telemetry record owned by the backend.
 */
abstract emit(record: TeamTelemetryRecord): void

/** See {@link TeamTelemetrySink.flush}. */
flush?(): void

/**
 * See {@link TeamTelemetrySink.shutdown}.
 * @returns completion after the backend reaches quiescence.
 */
abstract shutdown(): Promise<void>
```

Source: [`packages/core/team/src/telemetry.ts`](../../packages/core/team/src/telemetry.ts)

<a id="channel-events"></a>

### `channel/*` events

<a id="channelchanged--emit"></a>

#### `channel/changed` — emit

A provider committed a channel WAL record. Listener failure cannot roll back the already committed fact.

```ts cordis-catalog
/**
 * A provider committed a channel WAL record. Listener failure cannot roll
 * back the already committed fact.
 * @param event - identified committed channel record.
 * @mode emit
 */
'channel/changed'(this: TeamRuntime, event: ChannelEvent): void
```

Source: [`packages/core/team/src/runtime.ts`](../../packages/core/team/src/runtime.ts)

<a id="team-events"></a>

### `team/*` events

<a id="teamadapter-added--emit"></a>

#### `team/adapter-added` — emit

A Team channel adapter became available for future channel openings.

```ts cordis-catalog
/**
 * A Team channel adapter became available for future channel openings.
 * @param adapter - registered adapter identity.
 * @mode emit
 */
'team/adapter-added'(this: TeamRuntime, adapter: TeamAdapterRef): void
```

Source: [`packages/core/team/src/runtime.ts`](../../packages/core/team/src/runtime.ts)

<a id="teamadapter-removed--emit"></a>

#### `team/adapter-removed` — emit

A Team channel adapter stopped accepting new channels. Existing leases retain the exact implementation until their owners release them.

```ts cordis-catalog
/**
 * A Team channel adapter stopped accepting new channels. Existing leases
 * retain the exact implementation until their owners release them.
 * @param adapter - removed adapter identity.
 * @mode emit
 */
'team/adapter-removed'(this: TeamRuntime, adapter: TeamAdapterRef): void
```

Source: [`packages/core/team/src/runtime.ts`](../../packages/core/team/src/runtime.ts)

<a id="teamchanged--emit"></a>

#### `team/changed` — emit

A provider committed a Team-journal record. Listener failure cannot roll back the already committed fact.

```ts cordis-catalog
/**
 * A provider committed a Team-journal record. Listener failure cannot roll
 * back the already committed fact.
 * @param event - committed Team record projection.
 * @mode emit
 */
'team/changed'(this: TeamRuntime, event: TeamEvent): void
```

Source: [`packages/core/team/src/runtime.ts`](../../packages/core/team/src/runtime.ts)

<a id="teampolicy--waterfall"></a>

#### `team/policy` — waterfall

Authorize one Team operation. An allowing listener must call `next()`; a denial returns a decision without delegating.

```ts cordis-catalog
/**
 * Authorize one Team operation. An allowing listener must call `next()`;
 * a denial returns a decision without delegating.
 * @param request - provider-validated operation facts.
 * @mode waterfall
 */
'team/policy'(this: TeamRuntime, request: TeamPolicyRequest, next: () => Promise<TeamPolicyDecision>): Promise<TeamPolicyDecision>
```

Source: [`packages/core/team/src/runtime.ts`](../../packages/core/team/src/runtime.ts)

<a id="teampolicy-added--emit"></a>

#### `team/policy-added` — emit

A policy began intercepting one Team operation.

```ts cordis-catalog
/**
 * A policy began intercepting one Team operation.
 * @param policy - registered policy identity.
 * @mode emit
 */
'team/policy-added'(this: TeamRuntime, policy: TeamPolicyRegistration): void
```

Source: [`packages/core/team/src/runtime.ts`](../../packages/core/team/src/runtime.ts)

<a id="teampolicy-removed--emit"></a>

#### `team/policy-removed` — emit

A policy no longer intercepts future Team operations.

```ts cordis-catalog
/**
 * A policy no longer intercepts future Team operations.
 * @param policy - removed policy identity.
 * @mode emit
 */
'team/policy-removed'(this: TeamRuntime, policy: TeamPolicyRegistration): void
```

Source: [`packages/core/team/src/runtime.ts`](../../packages/core/team/src/runtime.ts)

<a id="teamview-policy-added--emit"></a>

#### `team/view-policy-added` — emit

A pure channel view policy became available for future channel reads.

```ts cordis-catalog
/** A pure channel view policy became available for future channel reads.
 * @param policy - registered view-policy identity.
 * @mode emit
 */
'team/view-policy-added'(this: TeamRuntime, policy: TeamViewPolicyRef): void
```

Source: [`packages/core/team/src/runtime.ts`](../../packages/core/team/src/runtime.ts)

<a id="teamview-policy-removed--emit"></a>

#### `team/view-policy-removed` — emit

A channel view policy stopped accepting new channels; existing leases retain its exact implementation.

```ts cordis-catalog
/** A channel view policy stopped accepting new channels; existing leases retain its exact implementation.
 * @param policy - removed view-policy identity.
 * @mode emit
 */
'team/view-policy-removed'(this: TeamRuntime, policy: TeamViewPolicyRef): void
```

Source: [`packages/core/team/src/runtime.ts`](../../packages/core/team/src/runtime.ts)

<a id="team-scheduler-events"></a>

### `team-scheduler/*` events

<a id="team-schedulerassigned--emit"></a>

#### `team-scheduler/assigned` — emit

The scheduler committed a task lease and its durable assignment Envelope. This observation remains advisory; a task-delivery Consumer pulls the channel WAL after restart before it starts an owner-fenced attempt.

```ts cordis-catalog
/**
 * The scheduler committed a task lease and its durable assignment Envelope.
 * This observation remains advisory; a task-delivery Consumer pulls the
 * channel WAL after restart before it starts an owner-fenced attempt.
 * @param notice - immutable assignment task, activation, channel, and Envelope.
 * @mode emit
 */
'team-scheduler/assigned'(this: TeamDagScheduler, notice: TeamTaskAssignmentNotice): void
```

Source: [`packages/team/team-scheduler-dag/src/index.ts`](../../packages/team/team-scheduler-dag/src/index.ts)

<a id="team-telemetry-events"></a>

### `team-telemetry/*` events

<a id="team-telemetryrecord--waterfall"></a>

#### `team-telemetry/record` — waterfall

Transform one Team telemetry record before export. A listener must call `next()` to preserve lower redaction or enrichment layers.

```ts cordis-catalog
/**
 * Transform one Team telemetry record before export. A listener must call
 * `next()` to preserve lower redaction or enrichment layers.
 * @param record - detached candidate record.
 * @param next - remaining telemetry policy waterfall.
 * @mode waterfall
 */
'team-telemetry/record'(record: TeamTelemetryRecord, next: () => TeamTelemetryRecord): TeamTelemetryRecord
```

Source: [`packages/core/team/src/telemetry.ts`](../../packages/core/team/src/telemetry.ts)
<!-- END GENERATED cordis-surface -->
