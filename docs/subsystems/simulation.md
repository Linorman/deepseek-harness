# Simulation

English | [中文](simulation.zh.md)

`SimulationProductSourceInput` names only a retained decision source ordinal and optional position/continuation. `SimulationProductSourceInspection` distinguishes lookup progress from authorized text. Each read requires a Simulation source grant and independent current Team membership, with no arbitrary channel selection or inference. The [source read contract](../../packages/simulation/simulation-product/README.md) owns bounds, redaction and continuation.

The `knowledge` entity/decision sections retrieve current or exact originally selected knowledge under explicit content grants and current transitive audience checks. `knowledgeVisible/selectKnowledge` are shared pure definition-package projections; local providers own their durable writes. Original delivered report text requires separate source permission and retained delivery evidence. These attributed records do not represent verified world truth, and current audience changes release cached knowledge before revalidation.

`SimulationProductWatchInput/Result` describe one authenticated bounded metadata wait. Its non-authorizing `readVersion` fences frozen-context responses, and reset discards old continuations. Independent `SimulationProductContextReader` contributions use a process-local registrar; policy-plugin removal wakes watches without replacing directory or execution ownership. The [product read policy](../../packages/simulation/simulation-product/README.md) owns real-time limits, current-principal checks and teardown.

`SimulationProductObjectInput` selects independently paged entity relationships or frozen decision context. Relations retain exact validity intervals. The product directory’s explicit principal/entity context readers disclose only historical plain-text parts; metadata ownership alone withholds bodies. Frozen context records preserve original projections and sources, remain distinct from the full model request, and grant no current knowledge or Team/Session source access. [Product read policy](../../packages/simulation/simulation-product/README.md#relationships-and-frozen-context) owns configuration, budgets and retirement.

`SimulationProductAdministrationControl` separates maintenance actions from scheduling. It carries bounded ingress targets/time/byte limits and compatible checkpoint metadata; completed native checkpoints retain real `publishedAt` in journal version 44. Recovery references remain read-only until explicit native validation, and current-suffix recovery never requests historical rollback.

`SimulationProductPreflightInput` contains template selection, permitted initial parameters and optional immutable `SimulationProductLimits`, without a command identity. `SimulationProductPreflightResult` carries exact resolved `SimulationProductConfiguration` or bounded field issues; configuration includes read-only shared Host concurrency and version/time metadata. Current deployment and capacity checks allocate no run, Team, actor or permit. The [creation contract](../../packages/simulation/simulation-product/README.md) owns allowlisted reductions, zero-token deterministic workflows and repeated create admission.

`SimulationProductRequestsInput/RequestsPage` expose bounded receipt-only discovery under current run-owner authorization. Their snapshot revision belongs to the administrative journal, independently of Native world revision. `SimulationProductRetryRequestInput` selects only original runId/commandId; explicit retry dispatches the retained payload, returns terminal receipts unchanged and preserves cold owner-restore prerequisites. Native phase and ingress histories remain separate. The [request recovery contract](../../packages/simulation/simulation-product/README.md) owns cursor isolation, privacy and bounded admission.

`SimulationProductControlBudget` exposes the original model route, per-request reservation, per-simulation-interval token allowance, exact interval, resident limit and configured shared-host model concurrency. Control snapshots report observed start/pause preconditions and in-flight work separately from original receipts. The [product administration](../../packages/simulation/simulation-product/README.md) owns admission and command identity; the [browser workspace](../../packages/client/ui-simulation/README.md) owns explicit confirmation, original-result recovery and bounded raw drafts.

The opt-in [product directory](../../packages/simulation/simulation-product/README.md) provides `ctx.simulationProducts.list/inspect` and authenticated Host fetch reads. Immutable registrations associate opaque product IDs with private provider/spec selection and one owning principal. Directory metadata is independent of provider activation; exact history inspection returns a bounded public world summary without knowledge, profiles or model context. `SimulationProductRunId` and `SimulationProductCursor` brand product selection and encrypted pagination; `SimulationProductRunInspection` distinguishes missing history from an observed world and retains canonical decimal time. Reads neither acquire execution ownership nor restore or drive a run.

`SimulationProductBrowseInput` selects entity, decision, operation or checkpoint filters; `SimulationProductCollectionPage` carries their redacted rows, exact `snapshotRevision`, filtered total and bound continuation. `SimulationProductObjectInput` selects an exact identity and section, optional read revision and supported detail page. `SimulationProductObjectInspection` distinguishes authorized absence from matching section data. Native identity brands are available through the pure `./identities` entry. Technical attempts and checkpoint references paginate independently; knowledge/context text remains withheld. A completed checkpoint reports `sourceValidation: 'not-performed'`, and effect/publication/recipient/task evidence remains distinct. The [metadata read contract](../../packages/simulation/simulation-product/README.md) owns fields, budgets and expiry.

The product package also provides [company preparation](../../packages/simulation/simulation-product/README.md): `SimulationCompanyPreparation` defines trusted initial settings and collector bounds; `SimulationCompanyPrepared` carries canonical identities and a complete initial checkpoint. It reconciles paused, unstarted topology without activation or inference. Caller lifetime, retained-fact checks and terminal checkpoint retries belong to the package contract.

The [company driver](../../packages/simulation/simulation-product/README.md) provides bounded `advance()/drain()` on a caller-owned prepared/restored run. `SimulationCompanyDriverConfig` fixes version, route and offsets; `SimulationCompanyDriveResult` separates stop reason, control work, exact revision/time and interruption identity. It uses native actor/window/model/effect owners and preserves submitted work across pause. Background scheduling and driver ownership remain separate.

Trusted `SimulationCompanyDriverConfig.scenario` selects a finite deterministic `task-workflow/1` with exact source, executor, recipient and reviewer routes over prepared actors. Each task completes from its own authorized persisted report; review evidence may omit procurement inventory facts. The [workflow contract](../../packages/simulation/simulation-product/README.md) owns configuration, routing, rework and unsupported topology/model limits.

`SimulationTaskExecutorConfig` fixes trusted source/entity routing, cognition/completion generations, optional interaction, lease duration, batch bound and per-attempt decision limit. `SimulationTaskExecutorOptions` supplies canonical task reads, authorized context, residency, lifetime and an optional trusted bounded successor selector; `SimulationTaskExecutorResult` separates task/effect/recovery stops with exact source and attempt references. The [task executor contract](../../packages/simulation/simulation-product/README.md#automatic-task-batches) owns original-identity retry and caller scheduling/checkpoint responsibility.

The explicit `./administration` entry provides `ctx.simulationAdministration.catalog/preflight/create/prepare/request`. `SimulationCompanyTemplate` defines trusted versioned configuration; `SimulationCompanyCreation` retains its exact private resolution. `SimulationProductCommandId` and `SimulationProductTemplateId` brand public selection, while create/prepare inputs omit authority and deployment configuration. `SimulationProductRequestReceipt` preserves accepted/terminal outcomes; `SimulationProductRequestResult` distinguishes found results from non-authoritative absence. The separate command journal accepts before native IO, preserves original identities across retry, and owns paused preparation handles. Reads/startup do not open or drive runs. The [creation contract](../../packages/simulation/simulation-product/README.md) owns limits, reconciliation and retirement.

`ctx.simulations.resolveInspection()` and `inspect()` observe existing history independently of execution open. The immutable provider/spec selection is validated before bounded replay. Local inspection acquires no coordinator, changes no phase, and does not restore or execute writers; owner status is an observation rather than takeover permission. Native snapshots include private world facts, so the consumer owns authorization and public redaction. The [read-only history decision](../../.agents/notes/implemented/architecture/2026-09-29-simulation-readonly-history.md) owns storage consistency and lifecycle; product authorization and administration have separate owners.

Simulation runs have a named provider, a stable `SimulationRunId`, and a persisted `SimulationRunSpec` containing clock and rules/policy versions. `SimTime` is a canonical non-negative decimal string. A `SimulationSnapshot` contains the exact spec, journal revision, administrative phase, entities and organization relations. Entity kind/cognition remain stable, profile revisions are independent, and termination is irreversible. Relation rules constrain endpoint kinds, explicitly permitted organization scope kinds and cycles within the same scope at a common simulation time; validity intervals are half-open. The `SimulationRun` handle owns revision-checked phase writes and draining close; a running phase alone does not execute model or business work.

`SimulationEntitySnapshot` contains `runId`, global `revision` and an optional detached `entity`. `SimulationRun.inspectEntity(id)` reads that observation without copying other entities, decisions or history. Unknown identities yield no entity; authority consumers re-read it after policy waits.

The [registry](../../packages/simulation/simulation/README.md) defines provider selection. The [local provider](../../packages/simulation/simulation-local/README.md) owns dedicated storage, strict replay and same-host coordinator exclusion. [Coordination design and status](../../.agents/notes/proposed/architecture/2026-09-17-durable-simulation-coordination.md) cover Entity writers, Team integration, scheduling and business effects.

An idle actor can hibernate through its exact controller-owned activation after accepted delivery work drains and its Session checkpoint succeeds. Resume retains the canonical Session and restores pending input before another decision. Failed cleanup retains its writer and capacity.

`SimulationRun.population()` reports non-terminated entities and charged writer slots. The persisted `maxEntities` and `maxResidentActors` limits apply before entity creation and runtime reservation; revoked writers remain charged until release.

`ctx.simulationTeams.modelUsage()` reports service-wide model permits and bounded FIFO waiters. Permits survive cancellation requests until stream cleanup; waiting requests revalidate their writer and recorded context before dispatch.

`ctx.simulationTeams` attaches one run to its canonical execution Team. `SimulationSnapshot.channelReservations` retains configured direct-channel identities, membership and confirmation; unconfirmed reservations prevent execution. `SimulationEntity.participantReservation` retains actor configuration and canonical Participant/Session identities before Team IO. `SimulationTeamConnection` provisions that membership, binds the reserved Session, activates entities and reconciles local recovery. `SimulationWriterLease` carries one epoch-scoped activation/revocation/release capability for the controller; unresolved writers keep the run owner lock. The [controller lifecycle interface](../../packages/team/team-activation-controller/src/lifecycle.ts) defines the trusted callbacks selected by immutable Team rules.

A `SimulationWindow` fixes a shared run revision, ordered decisions and their prepared contexts. Its `submitted` decisions retain proposals without operation intents; ordered acceptance precedes window closure and world execution. `maxDecisionsPerWindow` bounds admitted actors. A decision’s `inference` retains real-time start, deadline and completion or expiry; `decisionTimeoutMs` fixes the budget at run creation. Timeout cancels an uncompleted slot without cancelling an already submitted proposal.

A decision fixes its input cursor and writer epoch before proposals are accepted. Acceptance and all initial intents commit together. `executeOperation()` applies conserved resource transfers and exact one-use grants in slot/index order; retries return the original result. Interactions keep reply and execution states separate, and commitments require world-transfer evidence or explicit creditor confirmation.

`SimulationIngress` retains the request, receipt ordinal, event identity, assigned key and journal sequence. Consumption creates a recipient wake; its decision retains `ingressId`. Context preparation inserts the exact text as required input with a scoped run-event reference. Pausing or receiving more input does not change existing window views.

Resource conflicts atomically retain a `conflict-retry` event or an exhausted retry marker with their failed outcome. Retry decisions inherit a root decision and attempt through their consumed wake. Exhaustion requires acknowledgement before explicit resume; this does not restore the consumed retry budget.

Scheduled events retain their original ordering key and terminal history. A consumed wake is a durable responsibility, independently of Session input consumption. Deferred replies and deadlines produce queue records in the same batch as their business transition. `drive()` stops for pending decisions, the configured work limit, pause or a typed microstep stall.

`SimulationTeamTransport` is a trusted idempotent publication capability. An outbox attempt stores real timestamps independently of simulation time, and its receipt retains run, Team, recipient and exact Envelope sequence as well as operation id, fingerprint and channel. Checkpoint collection and restoration verify applied targets against the corresponding Envelope or immutable task-creation record. Unknown outcomes retain their intent and require an explicit retry-budget decision after exhaustion. Publication does not imply recipient persistence or business acceptance.

`SimulationTaskExecutionRequest.interaction.execution` selects an open `obligation` or an evidence-checked `continuation`. A continuation retains fulfilled transfer references from physically retired attempts of the same task/assignee/Session, records fresh input and an empty acknowledgement, and admits no new world proposals. Original failed attempts and closed business facts remain unchanged. The [native task contract](../../packages/simulation/simulation/README.md) owns eligibility and result evidence; local journal version 44 rejects earlier formats. Installed company templates report `cognition-only` or `automatic-tasks`; task mode uses the product owner's timer and complete checkpoint/recovery protocol.

`SimulationProductTaskReviewListInput` and `SimulationProductTaskReviewPage` describe bounded canonical review targets and fixed scene evidence. `SimulationProductTaskReviewResolveInput` binds the original command, source operation, attempt and task revision; installed buyer-reviewed company templates separate report rework from their one inventory transfer. The [administrative review contract](../../packages/simulation/simulation-product/README.md#administrative-task-review) owns current authority, cold queries, exact retries and explicit scheduling.

`SimulationProductRunStatusesInput` selects an exact finite registered-run batch; `SimulationProductRunStatusesPage` isolates each provider observation and exposes no execution authority. Native `SimulationRuntimeMetrics` shares budget and writer-slot calculations with admission: token charges include unresolved reservations, while unknown attempts remain separate. Administrative operational state, immutable scenario versions and the real-time Host model pool are distinct from run-local interval consumption. The [status contract](../../packages/simulation/simulation-product/README.md) owns byte/credential bounds and unavailable states.

`SimulationProductOperationRetryInput` selects an exact unknown external operation and its recorded attempt-count fence. The product persists the original command before `retryOutbox()` grants one bounded allowance under the unchanged native policy; neither granting nor querying publishes, infers or resumes. Exact retries preserve the original native grant and accepted time, including after cold replay or later results. Explicit scheduling rechecks target authority and reconciles the original Envelope/task identity. Current capability metadata distinguishes confirmed results from operations that simply do not require manual authorization. The [retry contract](../../packages/simulation/simulation-product/README.md) owns command limits and recovery.

`SimulationCheckpointDiagnostic` contains only fixed stage/category and canonical reference metadata, with cleanup confirmation separate from the primary failure. Native failed checkpoints and product checkpoint/restore receipts retain the original diagnosis; private provider messages and paths remain withheld. Session/channel references include their canonical Team binding so navigation can select the exact protected target. Unknown failures are unavailable rather than inferred from prose. The [diagnosis decision](../../.agents/notes/implemented/architecture/2026-10-01-simulation-checkpoint-failure-diagnostics.md) owns classification and persistence; referenced body reads retain independent authorization.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxsimulationadministration--simulationadministration"></a>

### `ctx.simulationAdministration` — `SimulationAdministration`

One administration journal and one Host handle per original product creation; startup never resumes models.

```ts cordis-catalog
/**
 * Read the complete bounded installed company catalog under current authentication.
 * @param call - Transport-authenticated principal and wait lifetime.
 * @returns safe version/route/limit metadata; never resolves a native execution handle.
 */
catalog(call: AuthenticatedProductCall): Promise<SimulationProductCatalog>

/**
 * Validate permitted creation settings and current deployment/capacity without durable acceptance.
 * @param request - Template, names, stock and explicitly allowlisted immutable allowances.
 * @param call - Current authenticated principal and read lifetime.
 * @returns bounded field issues or exact defaults; readiness reserves no run, writer, actor or model permit.
 */
preflight(request: SimulationProductPreflightInput, call: AuthenticatedProductCall): Promise<SimulationProductPreflightResult>

/**
 * Persist one original allocation and launch bounded preparation after durable acceptance.
 * @param request - Caller-retained command and permitted template parameters.
 * @param call - Current authenticated owner; carrier cancellation never cancels accepted preparation.
 * @returns stable run/command receipt; exact retries return its historical state and changed payloads reject.
 */
create(request: SimulationProductCreateInput, call: AuthenticatedProductCall): Promise<SimulationProductRequestReceipt>

/**
 * Register a distinct explicit preparation attempt on the original owned creation.
 * @param request - Original run and new or exact-retried preparation identity.
 * @param call - Authenticated owning principal; known/private absence has one refusal.
 * @returns immutable preparation attempt receipt; original failed attempts remain failed.
 */
prepare(request: SimulationProductPrepareInput, call: AuthenticatedProductCall): Promise<SimulationProductRequestReceipt>

/**
 * Query the exact original accepted or terminal request without running reconciliation.
 * @param request - Original command identity.
 * @param call - Current authenticated principal.
 * @returns original fact or non-authoritative not-found; no outcome is inferred from a disconnected waiter.
 */
request(request: SimulationProductRequestInput, call: AuthenticatedProductCall): Promise<SimulationProductRequestResult>

/**
 * Discover original receipts after reconnecting or reauthenticating without opening a native owner.
 * @param request - Owned run, bounded page and optional exact journal revision.
 * @param call - Current authenticated principal; continuations bind this credential and service lifetime.
 * @returns receipt-only page ordered by acceptance time and command identity; journal changes retire continuations.
 */
listRequests(request: SimulationProductRequestsInput, call: AuthenticatedProductCall): Promise<SimulationProductRequestsPage>

/**
 * Resume only the selected original retained semantics after an explicit user retry.
 * @param request - Exact owned run and original durable command identity; unknown selections refuse without allocation.
 * @param call - Current authenticated run owner; the original operation rechecks authority and native admission.
 * @returns original receipt unchanged when terminal; accepted commands use their existing public operation.
 * Cold accepted review/retry-operation commands require explicit owner restoration first. Disconnected waiters do
 * not cancel accepted preparation or maintenance; authentication-sensitive review/retry mutations keep their rules.
 */
async retryRequest(request: SimulationProductRetryRequestInput, call: AuthenticatedProductCall): Promise<SimulationProductRequestReceipt>

/**
 * Retain a full checkpoint request before closing scheduling admission and collecting native owners.
 * @param request - Original product run and caller-retained command; collector policy is server-derived.
 * @param call - Current authenticated owning principal; its retirement only ends the waiter.
 * @returns durable operation receipt; query the same command to distinguish accepted from terminal outcome.
 */
checkpoint(request: SimulationProductCheckpointInput, call: AuthenticatedProductCall): Promise<SimulationProductRequestReceipt>

/**
 * Explicitly validate a full checkpoint and the current suffix, retire old writers and acquire a paused product owner.
 * @param request - Original run, command and completed checkpoint; implementation/policy versions are server-derived.
 * @param call - Current authenticated owner; a lost waiter does not cancel accepted recovery.
 * @returns original durable recovery receipt; a new command revalidates history even after prior recovery success.
 */
restore(request: SimulationProductRestoreInput, call: AuthenticatedProductCall): Promise<SimulationProductRequestReceipt>

/**
 * Register one attributed input without adding world authority or changing the scheduling phase.
 * @param request - Exact original input identity, allowed entity, text and canonical earliest time.
 * @param call - Current authenticated owner; attribution comes from this principal, not browser fields.
 * @returns original assignment and independently observed consumption; identical retries do not inject twice.
 */
ingress(request: SimulationProductIngressInput, call: AuthenticatedProductCall): Promise<SimulationProductIngressReceipt>

/**
 * Read one original assignment and its recorded decision consumption without starting or attaching a run.
 * @param request - Exact original run/input identity.
 * @param call - Current authenticated owner checked around provider IO.
 * @returns original metadata or non-authoritative absence; text and principal details are omitted.
 */
ingressRequest(request: SimulationProductIngressQuery, call: AuthenticatedProductCall): Promise<SimulationProductIngressResult>

/**
 * Inspect current scheduling ownership and preconditions without attaching or driving actors.
 * @param request - Original registered product run.
 * @param call - Current authenticated owning principal.
 * @returns separate durable phase, driver and in-flight work; a cold run remains recovery-required.
 */
control(request: SimulationProductControlInput, call: AuthenticatedProductCall): Promise<SimulationProductControl>

/**
 * Enrich one bounded authorized Native status batch with independent current company scheduling metadata.
 * @param request - Exact registered run identities; native reads authorize the entire batch before provider IO.
 * @param call - Current authenticated reader; absent company administration never denies permitted directory metadata.
 * @returns bounded native facts, trusted original scenario version and real shared permits, without acquiring any owner.
 */
runStatuses(request: SimulationProductRunStatusesInput, call: AuthenticatedProductCall): Promise<SimulationProductRunStatusesPage>

/**
 * Persist scheduling intent and drive the owned company through bounded background batches.
 * @param request - Exact caller-retained management identity and target phase; no proxy-only CAS is accepted.
 * @param call - Current authenticated owner; retiring the carrier ends only its wait, not admitted scheduling.
 * @returns original redacted management result and separate current observation; terminal retry never undoes later pause.
 */
manage(request: SimulationProductManageInput, call: AuthenticatedProductCall): Promise<SimulationProductManageResult>

/**
 * Query a durable original scheduling result through read-only history when its execution owner is absent.
 * @param request - Original product run and management identity.
 * @param call - Current authenticated owner, checked before and after provider IO.
 * @returns historical redacted result or non-authoritative absence; never opens a run or resumes models.
 */
managementRequest(request: SimulationProductManagementInput, call: AuthenticatedProductCall): Promise<SimulationProductManagementResult>

/**
 * Read current run-owned task controls without exposing task bodies, opening execution or starting inference.
 * @param request - Exact owned run, canonical observation fence and bounded continuation.
 * @param call - Current authenticated owner; every canonical read rechecks ownership before publication.
 * @returns one bounded task-source window; its cursor binds both world and canonical task revisions.
 */
listTasks(request: SimulationProductTasksInput, call: AuthenticatedProductCall): Promise<SimulationProductTasksPage>

/**
 * Persist one original scoped cancellation before canonical task IO; accepted work outlives its transport waiter.
 * @param request - Original command and exact source/task revision/attempt selection, with authored reason.
 * @param call - Current run owner; native authority is minted from the retained accepted source.
 * @returns original request receipt; completion confirms cancellation/cleanup, never general Team write access.
 */
cancelTask(request: SimulationProductTaskCancelInput, call: AuthenticatedProductCall): Promise<SimulationProductRequestReceipt>

/**
 * Observe bounded canonical task review metadata without opening a run, attaching actors or invoking models.
 * @param request - Owned run, exact world revision and bounded continuation.
 * @param call - Current authenticated product owner; revoked reads reject after canonical IO.
 * @returns only run-owned latest attempt metadata and current non-authorizing action hints.
 */
listTaskReviews(request: SimulationProductTaskReviewListInput, call: AuthenticatedProductCall): Promise<SimulationProductTaskReviewPage>

/**
 * Persist a scene-scoped original review before canonical mutation; browser fields never grant Team authority.
 * @param request - Exact task creation, completed attempt, observed task revision and immutable outcome/reason.
 * @param call - Current authenticated run owner, rechecked at the serialized write position.
 * @returns original accepted or terminal request receipt; cold writes require explicit restore, cold reads stay inert.
 */
resolveTaskReview(request: SimulationProductTaskReviewResolveInput, call: AuthenticatedProductCall): Promise<SimulationProductRequestReceipt>

/**
 * Retain one exact retry permission before native IO; unknown accepted outcomes keep their original identity.
 * @param request - Original command, accepted external operation, positive attempt-count fence and reason.
 * @param call - Current authenticated run owner; queued native mutation rechecks this lease.
 * @returns original accepted or terminal receipt. Cold accepted requests require explicit owner restore and this same retry.
 */
retryOperation(request: SimulationProductOperationRetryInput, call: AuthenticatedProductCall): Promise<SimulationProductRequestReceipt>
```

Types: [AuthenticatedProductCall](core.md)

Source: [`packages/simulation/simulation-product/src/administration.ts`](../../packages/simulation/simulation-product/src/administration.ts)

<a id="ctxsimulationproducts--simulationproducts"></a>

### `ctx.simulationProducts` — `SimulationProducts`

One Host-owned metadata directory; list/inspect never take Simulation execution ownership.

```ts cordis-catalog
/**
 * Obtain a process-local registration capability for the trusted creation owner; it cannot cross JSON transports.
 * @returns a writer that persists the original allocated registration, coalesces exact retries and refuses changed ownership/spec.
 * The caller persists its creation intent first and drains this capability before its own teardown. Reads never invoke it.
 */
creationRegistrar(): (record: SimulationProductRecord) => Promise<void>

/**
 * Read safe metadata for the current principal without opening provider history.
 * @param request - Actor-free query and opaque continuation.
 * @param call - Transport-authenticated current principal and cancellation lifetime.
 * @returns complete bounded authorized directory window; new observations require first-page restart.
 */
list(request: SimulationProductListInput, call: AuthenticatedProductCall): Promise<SimulationProductRunPage>

/**
 * Inspect exact registered history under current ownership association before and after provider IO.
 * @param request - Registered run identity only.
 * @param call - Transport-authenticated principal and cancellation lifetime.
 * @returns bounded administrative world summary without knowledge, instructions or physical paths.
 */
inspect(request: SimulationProductInspectInput, call: AuthenticatedProductCall): Promise<SimulationProductRunInspection>

/**
 * Observe a finite authorized directory window without opening, restoring or executing any native run.
 * @param request - Distinct registered run identities bounded by maxPageSize and complete request bytes.
 * @param call - Current authenticated principal and credential-retirement lifetime.
 * @returns request-ordered observations; independent provider or accounting failures yield safe per-run unavailability.
 * Missing authorization or credential retirement rejects the whole batch, and complete response overflow rejects without partial rows.
 */
runStatuses(request: SimulationProductRunStatusesInput, call: AuthenticatedProductCall): Promise<SimulationProductRunStatusesPage>

/**
 * Inspect one exact Team Envelope reference retained by a prepared decision.
 * @param request - Frozen source ordinal, bounded lookup/body continuation and optional exact position.
 * @param call - Authenticated owner; Simulation disclosure and Team membership remain independent.
 * @returns inert source text, explicit lookup progress or redacted absence; every IO is followed by authority checks.
 */
inspectSource(request: SimulationProductSourceInput, call: AuthenticatedProductCall): Promise<SimulationProductSourceInspection>

/**
 * Browse original journal sequences without opening execution or inferring history from snapshots.
 * @param request - Exact run, optional kind/sequence and policy-bound continuation.
 * @param call - Current authenticated owner and transport lifetime.
 * @returns bounded metadata or explicit whole-run-authorized JSON text parts; policy changes reject the old page.
 */
readRecords(request: SimulationProductRecordsInput, call: AuthenticatedProductCall): Promise<SimulationProductRecordsPage>

/**
 * Read one filtered administrative collection at an exact native world revision.
 * @param request - Registered run, collection-specific filters and opaque continuation.
 * @param call - Current transport-authenticated principal and cancellation lifetime.
 * @returns bounded redacted rows and authoritative filtered total; changed revision/query rejects continuation.
 */
browse(request: SimulationProductBrowseInput, call: AuthenticatedProductCall): Promise<SimulationProductCollectionPage>

/**
 * Read exact object sections; private context text requires a separate trusted entity-scoped reader.
 * @param request - Registered run, branded object and section, optional revision fence and section page.
 * @param call - Current authenticated principal and cancellation lifetime.
 * @returns bounded section or authorized absence; stale revision/page requires explicit refresh.
 */
inspectObject(request: SimulationProductObjectInput, call: AuthenticatedProductCall): Promise<SimulationProductObjectInspection>

/**
 * Obtain the process-local registration capability for the original administration owner.
 * @returns single-reader registrar; its disposer removes hints and invalidates pending observations without native effects.
 */
operationRetryReaderRegistrar(): (reader: SimulationProductOperationRetryReader) => () => void

/**
 * Obtain a runtime-only policy registration capability for trusted deployment plugins, with no effect merely from discovery.
 * @returns a registrar whose validated grants retire with their disposer. It cannot be serialized or used after this service closes.
 */
contextReaderRegistrar(): (readers: readonly SimulationProductContextReader[]) => () => void

/**
 * Obtain the trusted whole-run historical journal policy registrar.
 * @returns process-local registrar; disposal revokes content and invalidates waiting readers without stopping execution.
 */
recordReaderRegistrar(): (readers: readonly SimulationProductRecordReader[]) => () => void

/**
 * Wait for metadata invalidation without opening execution or returning bodies. Polls use ordinary bounded read admission.
 * @param request - Exact run, prior authenticated cursor and optional real wait; zero is an immediate probe.
 * @param call - Current credential lease; cancellation and unload retire the wait and drain admitted native IO.
 * @returns current policy lifetime and world observation. Expired/foreign cursors reset; provider absence is explicit.
 */
watch(request: SimulationProductWatchInput, call: AuthenticatedProductCall): Promise<SimulationProductWatchResult>
```

Types: [AuthenticatedProductCall](core.md)

Source: [`packages/simulation/simulation-product/src/index.ts`](../../packages/simulation/simulation-product/src/index.ts)

<a id="ctxsimulations--simulations"></a>

### `ctx.simulations` — `Simulations`

Registry whose providers own run IO and exclusive coordinator lifetimes.

```ts cordis-catalog
/**
 * Register an implementation.
 * @param provider - Named implementation.
 * @returns effect-scoped disposer.
 */
registerProvider(provider: SimulationProvider): () => void

/**
 * Validate explicit selection before IO.
 * @param request - Run request.
 * @returns resolved selection.
 */
resolve(request: SimulationRunRequest): SimulationRunSelection

/**
 * Open a resolved run.
 * @param selection - Explicit provider and run configuration.
 * @returns caller-owned run.
 */
open(selection: SimulationRunSelection): Promise<SimulationRun>

/**
 * Resolve immutable selection and provider support before read-only IO.
 * @param request - Provider and expected run spec; no execution or storage path flags.
 * @returns validated supported inspection selection.
 */
resolveInspection(request: SimulationInspectionSelection): SimulationInspectionSelection

/**
 * Read existing run facts without opening an execution owner or changing phase.
 * @param selection - Resolved inspection selection.
 * @returns detached history and owner observation, or undefined for a missing run; caller owns authorization and redaction.
 */
inspect(selection: SimulationInspectionSelection): Promise<SimulationRunObservation | undefined>
```

Source: [`packages/simulation/simulation/src/index.ts`](../../packages/simulation/simulation/src/index.ts)

<a id="ctxsimulationteams--simulationteams"></a>

### `ctx.simulationTeams` — `SimulationTeams`

Named run attachments using durable Team rules to prevent controller bypass.

```ts cordis-catalog
/**
 * Open an existing run, verify a completed manifest and every retained owner suffix, then retire old writers.
 * @param selection - Exact existing run configuration; create mode rejects.
 * @param request - Completed checkpoint id, required implementation version and owner-movement retry bound.
 * @param signal - Optional cancellation; admitted controller cleanup is still drained.
 * @returns caller-owned run and connection, paused without model calls or outbox effects. Repeated restores
 * revalidate current retained suffixes; they never roll state back to the checkpoint. Retired decision windows
 * close only after every slot is accepted or cancelled; restoration never accepts a submitted proposal.
 */
restore(selection: import('@clocky/clocky-simulation').SimulationRunSelection, request: import('@clocky/clocky-simulation').SimulationCheckpointRestoreRequest, signal?: AbortSignal): Promise<import('./types.ts').SimulationCheckpointRestoration>

/**
 * Inspect host-local Simulation model admission across all attached runs.
 * @returns reserved/executing permits, queued requests and their configured limits.
 */
modelUsage(): { readonly active: number; readonly queued: number; readonly limit: number; readonly queueLimit: number }

/**
 * Create or reconcile the run's canonical execution Team before attaching its lifecycle owner.
 * @param run - Open, unattached run whose root identity is journal-owned.
 * @param creation - Explicit Team goal, budgets and optional authority grant.
 * @param ownerName - Immutable lifecycle owner used by the subsequent attachment.
 * @returns the confirmed Team; target response loss reuses the reserved identity.
 */
ensureTeam(run: SimulationRun, creation: Omit<import('@clocky/clocky-team').TeamRootCreateInput, 'rules'>, ownerName: string): Promise<import('@clocky/clocky-team').TeamStateSnapshot>

/**
 * Register one trusted bounded pure task completion rule; source disposal retires future evaluation.
 * @param policy - Exact policy generation and deterministic world-effect evaluator.
 * @returns HMR-safe disposer; accepted result retries use the recorded result without re-evaluation.
 */
registerTaskCompletionPolicy(policy: import('@clocky/clocky-simulation').SimulationTaskCompletionPolicy): () => void

/**
 * Register a versioned pure summary policy over explicitly selected authorized knowledge.
 * @param policy - Bounded synchronous, IO-free transformation; ambient histories must not be read.
 * @returns effect-scoped disposer; retained summaries do not depend on the implementation remaining loaded.
 */
registerSummaryPolicy(policy: import('@clocky/clocky-simulation').SimulationSummaryPolicy): () => void

/**
 * Register an effect-scoped pure computation policy; duplicate ids reject even across versions.
 * @param policy - Explicit identity/version and bounded synchronous computation over a frozen authorized view.
 * @returns disposer stopping new computation; already recorded outputs remain durable.
 */
registerDeterministicPolicy(policy: import('@clocky/clocky-simulation').SimulationDeterministicPolicy): () => void

/**
 * Execute a model operation using its actual current Agent identity.
 * @param agent - Registry-owned local caller, supplied by tool execution.
 * @param request - Observation, replacement proposals or submission without caller-selected identities.
 * @param signal - Calling tool cancellation.
 * @returns authorized observations or proposal acknowledgement, never fabricated world results.
 */
modelRequest(agent: Agent, request: SimulationModelRequest, signal: AbortSignal): Promise<SimulationModelResult>

/**
 * Attach one run to a dedicated Team whose immutable activationLifecycleOwner rule names this owner.
 * @param run - Caller-owned open run.
 * @param teamId - Canonical Team selected by the deployment.
 * @param ownerName - Exact durable rule value, unique in this controller.
 * @returns a connection that derives entity identity and drains activation ownership on close.
 */
async attach(run: SimulationRun, teamId: TeamId, ownerName: string): Promise<SimulationTeamConnection>
```

Types: [Agent](core.md) · [TeamId](team.md) · [TeamRootCreateInput](team.md) · [TeamStateSnapshot](team.md)

Source: [`packages/simulation/simulation-team/src/index.ts`](../../packages/simulation/simulation-team/src/index.ts)

<a id="simulation-events"></a>

### `simulation/*` events

<a id="simulationcommitted--emit"></a>

#### `simulation/committed` — emit

Projection published after the matching journal append or replay. The run may contain several independently bound Sessions.

```ts cordis-catalog
/**
 * Projection published after the matching journal append or replay.
 * The run may contain several independently bound Sessions.
 * @mode emit
 * @param snapshot - Committed detached projection.
 * @param durableTail - Tail returned by storage.
 * @param previousRevision - Tail before this append; absent for initial replay publication.
 */
'simulation/committed'(snapshot: SimulationSnapshot, durableTail: number, previousRevision?: number): void
```

Source: [`packages/simulation/simulation-local/src/index.ts`](../../packages/simulation/simulation-local/src/index.ts)
<!-- END GENERATED cordis-surface -->
