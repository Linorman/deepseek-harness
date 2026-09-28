# Simulation

English | [中文](simulation.zh.md)

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

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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
