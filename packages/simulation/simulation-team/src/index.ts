import { SimulationContextIntegrityError } from './integrity.ts'
import { activePlannerAncestors, generationRecordAt } from '@clocky/clocky-simulation'
import { executeGeneration } from './generation.ts'
import { PersonnelSettlementAuthority } from './personnel-settlement.ts'
import { collectPersonnelTeamSources } from './personnel-sources.ts'
import { projectPersonnelObligations } from './personnel-obligations.ts'
import { flushContextConsumption } from './context-consumption.ts'
import { cleanupWorldHire, cleanupExternalRepresentative, cleanupExternalContact } from './world-cleanup.ts'
import { PERSONNEL_OBLIGATION_MAX_ITEMS, personnelObligationQuerySchema,
  assertSimulationMaintenanceAdmission, simulationMaintenanceRequestSchema, activeSimulationMaintenance } from '@clocky/clocky-simulation'
import { completeTask } from './task-completion.ts'
import { SimulationTaskReviewAuthority } from './task-review.ts'
import { executeTaskDecision } from './task-decision.ts'
import { taskDecision, assertPreparedWorldScopeAccess } from '@clocky/clocky-simulation'
import { retireTaskExecutions } from './task-retirement.ts'
import { assignSimulationTask } from './task-assignment.ts'
import { projectTaskEvidence } from './task-evidence.ts'
import { addAbortListener } from 'node:events'
import { validateCheckpointOwners } from './restore.ts'
import { simulationCheckpointRestoreRequestSchema } from '@clocky/clocky-simulation'
import { retainWorldExecutionCatalog } from '@clocky/clocky-simulation'
import type { SimulationWorldDomainRegistry, SimulationSnapshot } from '@clocky/clocky-simulation'
import { simulationCheckpointRequestSchema, assertCanonicalTeam } from '@clocky/clocky-simulation'
import { collectCheckpoint } from './checkpoint.ts'
import { SimulationTaskAuthority } from './task-transport.ts'
import { checkpointRule, checkpointSource } from './checkpoint-failure.ts'
import { checkpointDiagnostic, SimulationCheckpointCleanupError, SimulationCheckpointError } from '@clocky/clocky-simulation'
import { compactionStream } from './compaction.ts'
import { compactionRequestReference } from '@clocky/clocky-compaction'
import { meteredStream } from './metered-stream.ts'
import { requestBudgetPolicySchema, requestOutputCap, requestBudgetBlock, requestCapacity } from './request-budget.ts'
import type { RequestCapacityInput, RequestCapacityResult } from './request-budget.ts'
import type { RequestBudgetPolicy } from './request-budget.ts'
import type {} from '@clocky/clocky-token-meter'
import { SimulationRequestBudgetError, SimulationTokenOverrunError, simulationTokenCount } from '@clocky/clocky-simulation'
import { summarizeKnowledge } from './summary.ts'
import { modelKnowledge, policyKnowledge, assertReportReferences, missingReportReferences } from './knowledge.ts'
import { executeDeterministic } from './deterministic.ts'
import { simulationPolicyRefSchema } from '@clocky/clocky-simulation'
import { SimulationBootstrapAuthority } from './bootstrap.ts'
import { ensureResident } from './residency.ts'
import { simulationResidencyPolicySchema } from './residency-policy.ts'
export { simulationResidencyPolicySchema, selectResidencyCandidates } from './residency-policy.ts'
export type { SimulationResidencyPolicy } from './residency-policy.ts'
import { SimulationModelCapacity, SimulationModelCapacityExceeded } from './model-capacity.ts'
import { activationHistoryLimitDetails } from '@clocky/clocky-team'
import { SimulationDeadlines } from './deadline.ts'
import { executeDecision } from './decision.ts'
import { settleDecisionPause } from './pause.ts'
import { SimulationChannelAuthority } from './channels.ts'
import { SimulationParticipantAuthority } from './participants.ts'
import { modelAccess, SIMULATION_MODEL_TOOLS } from './model.ts'
import type {} from '@clocky/clocky-tools'
import { SimulationInvitationAuthority } from './invitation.ts'
import { driveTeam } from './driver.ts'
import { SimulationDeliveryAuthority } from './delivery.ts'
import { SimulationPostAuthority } from './transport.ts'
import { decisionInput, inputState } from './input.ts'
import { callConfigEquals, type StreamChunk } from '@clocky/clocky-llm'
/** Local cognition integration enforced by the existing activation controller. @module @clocky/clocky-simulation-team */
import z from '@clocky/schemastery'
import { isDeepStrictEqual } from 'node:util'
import { randomUUID } from 'node:crypto'
import { Context, Service } from '@clocky/cordis'
import { SessionId } from '@clocky/clocky-session'
import { isInProcessAgentRuntimeProvider } from '@clocky/clocky-agent-runtime-in-process'
import type { Agent } from '@clocky/clocky-agent'
import type { AgentRuntimeProvider } from '@clocky/clocky-agent-runtime'
import type { ActivationBindingSnapshot, TeamId } from '@clocky/clocky-team'
import type { TeamActivationCoordinationLease, TeamActivationLifecycleOwner } from '@clocky/clocky-team-activation-controller'
import type { SimulationDecision, SimulationDecisionId, SimulationEntity, SimulationEntityId, SimulationRun, SimulationWriterActivation, SimulationWriterLease } from '@clocky/clocky-simulation'
import type { SimulationInputDispatch, SimulationTeamConnection, SimulationModelRequest, SimulationModelResult } from './types.ts'
export type * from './types.ts'
export { SIMULATION_MODEL_TOOLS } from './model.ts'

declare module '@clocky/cordis' {
  interface Context { simulationTeams: SimulationTeams }
}

/** Context budget and bounded recipient discovery for Simulation cognition. */
export interface Config {
  /** Full-envelope admission and bounded compaction; omitted preserves explicitly composed legacy deployments. */
  readonly requestPolicy?: RequestBudgetPolicy | null
  /** Optional automatic eviction policy shared by attached drivers; explicit choices may select their retained policy. */
  readonly residencyPolicy?: {
    /** Exact idle-selection policy version. */
    readonly version: '1'
    /** Minimum inactivity in canonical simulated ticks. */
    readonly idleFor: string
    /** Maximum eligible candidates retired by one residency request. */
    readonly maxCandidates: number
  } | null
  /** Maximum simultaneously reserved or executing Simulation model streams across this service. */
  readonly maxConcurrentModels: number
  /** Maximum model requests waiting for a permit; zero rejects when all permits are held. */
  readonly maxQueuedModels: number
  /** Positive bound on the JSON-encoded content-block array; the model route still owns its total token limit. */
  readonly maxContextBytes: number
  /** Maximum pending channel deliveries read per discovery page. */
  readonly deliveryPageSize: number
  /** Maximum local-drive/Team-IO rounds in one coordinator call. */
  readonly maxCoordinationRounds: number
}

/** Named run attachments using durable Team rules to prevent controller bypass. */
export class SimulationTeams extends Service {
  static inject = ['simulations', 'teams', 'teamActivations', 'agentRuntimes', 'agents', 'sessions', 'sessionPersistence', 'llm', 'tools']
  static Config: z<Config> = z.object({ maxContextBytes: z.number().min(1).step(1).required(),
    requestPolicy: z.union([z.const(null), z.object({
      maxOutputTokens: z.number().min(1).step(1).required(), safetyMarginTokens: z.number().min(0).step(1).required(),
      inputSafetyFactor: z.number().min(1).max(4).required(), compactionAttempts: z.number().min(0).max(2).step(1).required(),
    })]).default(null),
    residencyPolicy: z.union([z.const(null), z.object({ version: z.const('1').required(), idleFor: z.string().required(),
      maxCandidates: z.number().min(1).step(1).required() })]).default(null),
    maxConcurrentModels: z.number().min(1).step(1).required(), maxQueuedModels: z.number().min(0).step(1).required(),
    deliveryPageSize: z.number().min(1).step(1).required(), maxCoordinationRounds: z.number().min(1).step(1).required() })
  private personnelAuthority?: PersonnelSettlementAuthority
  private taskAuthority?: SimulationTaskAuthority
  private taskReviewAuthority?: SimulationTaskReviewAuthority
  private readonly taskCompletionPolicies = new Map<import('@clocky/clocky-simulation').SimulationPolicyId,
    import('@clocky/clocky-simulation').SimulationTaskCompletionPolicy>()
  private readonly summaryPolicies = new Map<import('@clocky/clocky-simulation').SimulationPolicyId, import('@clocky/clocky-simulation').SimulationSummaryPolicy>()
  private readonly externalArchiveProviders = new Map<string, import('./external-archive.ts').WorldExternalArchiveProvider>()
  private readonly deterministicPolicies = new Map<import('@clocky/clocky-simulation').SimulationPolicyId, import('@clocky/clocky-simulation').SimulationDeterministicPolicy>()
  private readonly bootstrap: SimulationBootstrapAuthority
  private readonly modelCapacity: SimulationModelCapacity
  private readonly residencyPolicy: import('./residency-policy.ts').SimulationResidencyPolicy | undefined
  private readonly participants: SimulationParticipantAuthority
  private readonly channels: SimulationChannelAuthority
  private readonly modelHandlers = new WeakMap<Agent, ReturnType<typeof modelAccess>>()
  private readonly invitationAuthority: SimulationInvitationAuthority
  private readonly deliveryAuthority: SimulationDeliveryAuthority
  private readonly postAuthority: SimulationPostAuthority
  private readonly restorations = new Set<Promise<import('./types.ts').SimulationCheckpointRestoration>>()
  private readonly personnelInspections = new Set<Promise<import('@clocky/clocky-simulation').SimulationPersonnelObligationObservation | undefined>>()
  private closing = false
  private readonly requestPolicy: RequestBudgetPolicy | undefined
  private worldExecutions: SimulationWorldDomainRegistry | undefined
  private readonly attached = new Map<SimulationRun, SimulationTeamConnection>()

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'simulationTeams')
    this.requestPolicy = config.requestPolicy == null ? undefined : requestBudgetPolicySchema.parse(config.requestPolicy)
    this.residencyPolicy = config.residencyPolicy == null ? undefined : simulationResidencyPolicySchema.parse(config.residencyPolicy)
    if (!Number.isSafeInteger(config.maxConcurrentModels) || config.maxConcurrentModels < 1
      || !Number.isSafeInteger(config.maxQueuedModels) || config.maxQueuedModels < 0) throw new Error('Simulation model capacity limits are invalid')
    this.modelCapacity = new SimulationModelCapacity(config.maxConcurrentModels, config.maxQueuedModels)
    this.bootstrap = new SimulationBootstrapAuthority(ctx, () => !this.closing)
    this.participants = new SimulationParticipantAuthority(ctx)
    this.invitationAuthority = new SimulationInvitationAuthority(ctx)
    this.channels = new SimulationChannelAuthority(ctx, this.invitationAuthority)
    this.postAuthority = new SimulationPostAuthority(ctx)
    this.deliveryAuthority = new SimulationDeliveryAuthority(ctx, config.deliveryPageSize)
    if (!Number.isSafeInteger(config.maxCoordinationRounds) || config.maxCoordinationRounds < 1) throw new Error('Simulation coordination limit must be a positive safe integer')
    if (!Number.isSafeInteger(config.deliveryPageSize) || config.deliveryPageSize < 1) throw new Error('Simulation delivery page size must be a positive safe integer')
    if (!Number.isSafeInteger(config.maxContextBytes) || config.maxContextBytes < 1) throw new Error('Simulation context byte budget must be a positive safe integer')
    ctx.effect(() => async () => {
      this.closing = true
      this.modelCapacity.close()
      const connections = Promise.allSettled([...this.attached.values()].map(connection => connection.close()))
      await this.bootstrap.drain()
      await Promise.allSettled([...this.restorations, ...this.personnelInspections])
      const results = await connections
      const failures = results.filter(result => result.status === 'rejected').map((result): unknown => result.reason)
      if (failures.length > 0) throw new AggregateError(failures, 'Simulation Team service retains unconfirmed activations')
    })
  }

  /**
   * Read cross-owner personnel duties without opening, attaching, restoring or claiming execution ownership.
   * @param selection - Original existing Native provider/spec, resolved by the authenticated consumer.
   * @param request - Exact person/assignment revisions plus complete bounded inventory limits.
   * @param signal - Optional caller cancellation; admitted owner reads drain and late results cannot publish.
   * @returns original paired Native prefix and canonical inventory, with explicit partial source coverage.
   */
  inspectPersonnelObligations(selection: import('@clocky/clocky-simulation').SimulationInspectionSelection,
    request: import('@clocky/clocky-simulation').PersonnelObligationQuery, signal?: AbortSignal):
  Promise<import('@clocky/clocky-simulation').SimulationPersonnelObligationObservation | undefined> {
    this.assertOpen()
    const query = personnelObligationQuerySchema.parse(request)
    const admitted = () => { this.assertOpen(); signal?.throwIfAborted() }
    const work = (async () => {
      admitted()
      const original = await this.ctx.simulations.inspectPersonnelObligations(selection, query)
      admitted()
      if (original === undefined) return undefined
      const binding = original.snapshot.entities[query.selector.personId]?.binding
      if (binding === undefined) return original
      const sources = await collectPersonnelTeamSources(this.ctx, binding, {
        maxChannels: PERSONNEL_OBLIGATION_MAX_ITEMS, maxPages: PERSONNEL_OBLIGATION_MAX_ITEMS,
        pageSize: this.config.deliveryPageSize, maxBytes: query.maxBytes }, admitted)
      admitted()
      const current = await this.ctx.simulations.inspectPersonnelObligations(selection, query)
      admitted()
      if (current === undefined || !isDeepStrictEqual(binding, current.snapshot.entities[query.selector.personId]?.binding))
        throw new Error('Personnel read lost its original Native person and canonical binding')
      const moved = current.snapshot.revision !== original.snapshot.revision
      const report = projectPersonnelObligations(current.snapshot, current.report,
        moved ? { ...sources, complete: false, incomplete: 'source-moved' } : sources, query)
      admitted()
      return { snapshot: current.snapshot, report }
    })()
    this.personnelInspections.add(work)
    void work.then(() => { this.personnelInspections.delete(work) }, () => { this.personnelInspections.delete(work) })
    return work
  }

  /**
   * Install the trusted execution-factory catalog used before World writable restore.
   * @param catalog - Provider-owned strict parser and exact generation registry; Native catalogs remain separate.
   * @returns synchronous admission-removal disposer; the installing Fiber owns its effect and registry drainage.
   */
  registerWorldExecutionCatalog(catalog: SimulationWorldDomainRegistry): () => void {
    this.assertOpen()
    if (this.worldExecutions !== undefined) throw new Error('World execution catalog is already installed')
    this.worldExecutions = catalog
    return () => { if (this.worldExecutions === catalog) this.worldExecutions = undefined }
  }

  /**
   * Open an existing run, verify a completed manifest and every retained owner suffix, then retire old writers.
   * @param selection - Exact existing run configuration; create mode rejects.
   * @param request - Completed checkpoint id, required implementation version and owner-movement retry bound.
   * @param signal - Optional cancellation; admitted controller cleanup is still drained.
   * @returns caller-owned run and connection, paused without model calls or outbox effects. Repeated restores
   * revalidate current retained suffixes; they never roll state back to the checkpoint. Retired decision windows
   * close only after every slot is accepted or cancelled; restoration never accepts a submitted proposal.
   */
  restore(selection: import('@clocky/clocky-simulation').SimulationRunSelection,
    request: import('@clocky/clocky-simulation').SimulationCheckpointRestoreRequest, signal?: AbortSignal):
  Promise<import('./types.ts').SimulationCheckpointRestoration> {
    this.assertOpen()
    const accepted = simulationCheckpointRestoreRequestSchema.parse(request)
    if (selection.mode !== 'open') return Promise.reject(new Error('Checkpoint restoration requires an existing run'))
    const check = (): void => { this.assertOpen(); signal?.throwIfAborted() }
    const work = (async () => {
      check()
      const observed = await checkpointSource('restore', { kind: 'run' }, () => this.ctx.simulations.inspect(
        this.ctx.simulations.resolveInspection({ provider: selection.provider, spec: selection.spec })))
      const catalog = this.worldExecutions
      const releases: Array<() => void> = []
      const retain = (state: Pick<import('@clocky/clocky-simulation').SimulationSnapshot, 'world'>): void => {
        releases.push(retainWorldExecutionCatalog(state, catalog,
          state.world === undefined ? undefined : this.ctx.simulations.domains(selection.provider)))
      }
      if (observed !== undefined) retain(observed.snapshot)
      let run: SimulationRun
      try { run = await checkpointSource('restore', { kind: 'run' }, () => this.ctx.simulations.open(selection)) }
      catch (error: unknown) { for (const release of releases) release(); throw error }
      try {
        check()
        retain(run.snapshot())
        const operation = run.snapshot().checkpoints?.[accepted.id]
        if (operation?.status !== 'completed') throw checkpointRule('Checkpoint restoration requires a completed manifest',
          'restore', 'manifest-mismatch', { kind: 'checkpoint', checkpointId: accepted.id })
        const manifest = operation.manifest
        if (manifest.implementationVersion !== accepted.implementationVersion) throw checkpointRule('Checkpoint implementation version differs',
          'restore', 'version-mismatch', { kind: 'checkpoint', checkpointId: accepted.id })
        const ownerName = await validateCheckpointOwners(this.ctx, run, manifest, accepted.maxAttempts, check, signal)
        check()
        if (run.snapshot().phase !== 'paused') await run.setPhase('paused', run.snapshot().revision)
        check()
        const teamSubject = { kind: 'team' as const, teamId: manifest.team.owner.teamId }
        const connection = await checkpointSource('restore', teamSubject, () => this.attach(run, manifest.team.owner.teamId, ownerName))
        const team = await checkpointSource('restore', teamSubject, () => this.ctx.teams.getTeam({ teamId: manifest.team.owner.teamId }))
        for (const entity of Object.values(run.snapshot().entities)) {
          check()
          if (entity.binding === undefined) continue
          const participant = team.participants.find(value => value.id === entity.binding?.participantId)
          const reserved = participant?.activationReservation
          if (entity.writer !== undefined && entity.writer.phase !== 'released'
            || reserved !== undefined && reserved.releasedAt === undefined
              && !team.activations.some(value => value.reservationId === reserved.id)
            || team.activations.some(value => value.activation.participantId === entity.binding?.participantId
              && value.quiescedAt === undefined)) {
            await checkpointSource('retire', { kind: 'entity', entityId: entity.id }, () => connection.recover(entity.id))
          }
        }
        check()
        const settled = run.snapshot()
        if (settled.activeWindowId !== undefined) {
          const window = settled.windows?.[settled.activeWindowId]
          if (window === undefined || window.request.decisions.some((slot) => {
            const status = settled.decisions[slot.id]?.status
            return status !== 'accepted' && status !== 'cancelled'
          })) throw checkpointRule('Checkpoint recovery retains an unsettled decision window', 'retire', 'owner-not-quiescent', { kind: 'run' })
          await checkpointSource('retire', { kind: 'run' }, () => run.commitWindow(window.id))
          check()
        }
        return { run, connection, manifest }
      } catch (error: unknown) {
        try { await run.close() }
        catch (cleanup: unknown) {
          const diagnostic = checkpointDiagnostic(error, { stage: 'restore', code: 'unavailable', subject: { kind: 'run' } })
          throw new SimulationCheckpointCleanupError([error, cleanup], diagnostic)
        }
        throw error
      } finally { for (const release of releases) release() }
    })()
    this.restorations.add(work)
    void work.then(() => this.restorations.delete(work), () => this.restorations.delete(work))
    return work
  }

  /**
   * Measure the known runtime-shared required context and refuse only a provable byte or admission-policy impossibility.
   * @param request - Frozen request allowance, optional model capacity and known runtime-shared required sections.
   * @returns exact known bytes and estimated input floor when supplied; complete envelope and future consumption remain unknown.
   */
  requestCapacity(request: RequestCapacityInput): RequestCapacityResult {
    return requestCapacity(this.requestPolicy, request, this.config.maxContextBytes)
  }

  /**
   * Inspect host-local Simulation model admission across all attached runs.
   * @returns reserved/executing permits, queued requests and their configured limits.
   */
  modelUsage(): { readonly active: number; readonly queued: number; readonly limit: number; readonly queueLimit: number } {
    return this.modelCapacity.snapshot()
  }

  /**
   * Create or reconcile the run's canonical execution Team before attaching its lifecycle owner.
   * @param run - Open, unattached run whose root identity is journal-owned.
   * @param creation - Explicit Team goal, budgets and optional authority grant.
   * @param ownerName - Immutable lifecycle owner used by the subsequent attachment.
   * @returns the confirmed Team; target response loss reuses the reserved identity.
   */
  ensureTeam(run: SimulationRun, creation: Omit<import('@clocky/clocky-team').TeamRootCreateInput, 'rules'>,
    ownerName: string): Promise<import('@clocky/clocky-team').TeamStateSnapshot> {
    this.assertOpen()
    if (this.attached.has(run)) return Promise.reject(new Error('Simulation bootstrap requires an unattached run'))
    return this.bootstrap.ensure(run, creation, ownerName)
  }

  /**
   * Register an exact provider-owned external archive contract for this deployment.
   * @param provider - Trusted plugin's pure verifier and bounded capture/restore capabilities.
   * @returns effect-scoped removal; disposal closes new capture/restore while prior packages remain read-only evidence.
   */
  registerWorldArchiveProvider(provider: import('./external-archive.ts').WorldExternalArchiveProvider): () => void {
    if (provider.id.length === 0 || provider.id.length > 128 || provider.pins.length === 0)
      throw new Error('External archive provider requires an identity and exact pins')
    // oxlint-disable-next-line typescript/no-misused-promises -- Cordis owns the asynchronous effect disposer.
    return this.ctx.effect(() => {
      if (this.externalArchiveProviders.has(provider.id)) throw new Error('External archive provider is already installed')
      for (const existing of this.externalArchiveProviders.values()) if (existing.pins.some(pin =>
        provider.pins.some(value => isDeepStrictEqual(pin, value))))
        throw new Error('External archive pin has more than one owner')
      this.externalArchiveProviders.set(provider.id, provider)
      return () => { this.externalArchiveProviders.delete(provider.id) }
    })
  }

  /** Read the installed exact external archive contracts.
   * @returns current trusted capabilities; this map grants no run or principal authority.
   */
  worldArchiveProviders(): import('./external-archive.ts').WorldExternalArchiveProviders { return new Map(this.externalArchiveProviders) }

  /**
   * Register one trusted bounded pure task completion rule; source disposal retires future evaluation.
   * @param policy - Exact policy generation and deterministic world-effect evaluator.
   * @returns HMR-safe disposer; accepted result retries use the recorded result without re-evaluation.
   */
  registerTaskCompletionPolicy(policy: import('@clocky/clocky-simulation').SimulationTaskCompletionPolicy): () => void {
    this.assertOpen()
    const selected = simulationPolicyRefSchema.parse({ id: policy.id, version: policy.version })
    const entry = { ...selected, evaluate: policy.evaluate }
    // oxlint-disable-next-line typescript/no-misused-promises -- Cordis effect preserves the registration disposer.
    return this.ctx.effect(() => {
      if (this.taskCompletionPolicies.has(selected.id)) throw new Error('Simulation task completion policy is already registered')
      this.taskCompletionPolicies.set(selected.id, entry)
      return () => {
        /* v8 ignore next -- Cordis runs each effect disposer once, so a retired registration cannot clear a later replacement. */
        if (this.taskCompletionPolicies.get(selected.id) === entry) this.taskCompletionPolicies.delete(selected.id)
      }
    })
  }

  /**
   * Register a versioned pure summary policy over explicitly selected authorized knowledge.
   * @param policy - Bounded synchronous, IO-free transformation; ambient histories must not be read.
   * @returns effect-scoped disposer; retained summaries do not depend on the implementation remaining loaded.
   */
  registerSummaryPolicy(policy: import('@clocky/clocky-simulation').SimulationSummaryPolicy): () => void {
    this.assertOpen()
    const ref = simulationPolicyRefSchema.parse({ id: policy.id, version: policy.version })
    const entry = { ...ref, summarize: policy.summarize }
    // oxlint-disable-next-line typescript/no-misused-promises -- Cordis effects return callable asynchronous disposers.
    return this.ctx.effect(() => {
      if (this.summaryPolicies.has(entry.id)) throw new Error('Simulation summary policy is already registered')
      this.summaryPolicies.set(entry.id, entry)
      return () => { this.summaryPolicies.delete(entry.id) }
    })
  }

  /**
   * Register an effect-scoped pure computation policy; duplicate ids reject even across versions.
   * @param policy - Explicit identity/version and bounded synchronous computation over a frozen authorized view.
   * @returns disposer stopping new computation; already recorded outputs remain durable.
   */
  registerDeterministicPolicy(policy: import('@clocky/clocky-simulation').SimulationDeterministicPolicy): () => void {
    this.assertOpen()
    const ref = simulationPolicyRefSchema.parse({ id: policy.id, version: policy.version })
    const entry = { ...ref, decide: policy.decide }
    // oxlint-disable-next-line typescript/no-misused-promises -- Cordis effects return callable asynchronous disposers.
    return this.ctx.effect(() => {
      if (this.deterministicPolicies.has(entry.id)) throw new Error('Simulation deterministic policy is already registered')
      this.deterministicPolicies.set(entry.id, entry)
      return () => { this.deterministicPolicies.delete(entry.id) }
    })
  }

  /**
   * Execute a model operation using its actual current Agent identity.
   * @param agent - Registry-owned local caller, supplied by tool execution.
   * @param request - Observation, replacement proposals or submission without caller-selected identities.
   * @param signal - Calling tool cancellation.
   * @returns authorized observations or proposal acknowledgement, never fabricated world results.
   */
  modelRequest(agent: Agent, request: SimulationModelRequest, signal: AbortSignal): Promise<SimulationModelResult> {
    const handler = this.modelHandlers.get(agent)
    if (handler === undefined || this.ctx.agents.get(agent.id) !== agent) return Promise.reject(new Error('Agent has no Simulation decision authority'))
    return handler(request, signal)
  }

  /**
   * Attach one run to a dedicated Team whose immutable activationLifecycleOwner rule names this owner.
   * @param run - Caller-owned open run.
   * @param teamId - Canonical Team selected by the deployment.
   * @param ownerName - Exact durable rule value, unique in this controller.
   * @returns a connection that derives entity identity and drains activation ownership on close.
   */
  async attach(run: SimulationRun, teamId: TeamId, ownerName: string): Promise<SimulationTeamConnection> {
    this.assertOpen()
    const checkIdentity = (): void => {
      const current = run.snapshot()
      assertCanonicalTeam(current, teamId)
      if (current.teamReservation !== undefined && !current.teamReservation.confirmed) {
        throw new Error('Simulation attachment requires its confirmed canonical Team')
      }
    }
    checkIdentity()
    const state = await this.ctx.teams.getTeam({ teamId })
    this.assertOpen()
    checkIdentity()
    if (state.rules['activationLifecycleOwner'] !== ownerName || ownerName.length === 0
      || state.rules['simulationRunId'] !== run.snapshot().spec.runId) {
      throw new Error('Simulation Team requires its exact durable activation lifecycle owner')
    }
    if (this.attached.has(run)) throw new Error('Simulation run is already attached to a Team')
    for (const entity of Object.values(run.snapshot().entities)) {
      if (entity.binding !== undefined && entity.binding.teamId !== teamId) throw new Error('Simulation run belongs to another canonical Team')
    }
    const entityFor = (participantId: string, sessionId: string): SimulationEntity => {
      const entity = Object.values(run.snapshot().entities).find(value => value.binding?.teamId === teamId
        && value.binding.participantId === participantId && value.binding.sessionId === sessionId)
      if (entity === undefined) throw new Error('Activation has no exact Simulation entity binding')
      return entity
    }
    const runtime = (name: string): AgentRuntimeProvider => {
      const provider = this.ctx.agentRuntimes.getProvider(name)
      if (provider === undefined || !isInProcessAgentRuntimeProvider(provider)) throw new Error('Simulation cognition requires the actual in-process runtime provider')
      return provider
    }
    const maintenanceWork = new Map<import('@clocky/clocky-simulation').SimulationMaintenanceId, {
      request: import('@clocky/clocky-simulation').SimulationMaintenanceRequest
      maxDrainRounds: number
      maxAttempts: number
      work: Promise<import('@clocky/clocky-simulation').SimulationMaintenanceOperation>
    }>()
    const worldCleanupWork = new Map<import('@clocky/clocky-simulation').WorldIntentId,
      Promise<import('@clocky/clocky-simulation').SimulationWorldIdentityCleanupEvidence>>()
    const externalCleanupWork = new Map<import('@clocky/clocky-simulation').WorldIntentId,
      Promise<import('@clocky/clocky-simulation').SimulationWorldIdentityCleanupEvidence>>()
    const contactCleanupWork = new Map<import('@clocky/clocky-simulation').WorldIntentId,
      Promise<import('@clocky/clocky-simulation').SimulationExternalContactCleanupEvidence>>()
    let removeWorldCleanup: (() => void) | undefined
    let removeExternalCleanup: (() => void) | undefined
    let removeContactCleanup: (() => void) | undefined
    let admitted = true
    const checkpointRequests = new Map<import('@clocky/clocky-simulation').SimulationCheckpointId, {
      request: import('@clocky/clocky-simulation').SimulationCheckpointRequest
      work: Promise<import('@clocky/clocky-simulation').SimulationCheckpointOperation>
    }>()
    let checkpointing: symbol | undefined
    let checkpointWork: Promise<import('./types.ts').SimulationCheckpointCollection> | undefined
    let checkpointRelease: (() => void) | undefined
    const assertAdmitted = (): void => {
      this.assertOpen()
      if (!admitted) throw new Error('Simulation Team connection is closed')
      if (checkpointing !== undefined) throw new Error('Simulation checkpoint collection blocks new admission')
    }
    const canPublish = (): boolean => admitted && checkpointing === undefined && !this.closing
    const admissionAbort = new AbortController()
    const generationRequests = new WeakMap<import('@clocky/clocky-llm').GenerateOptions, () => void>()
    const generations = new Map<string, Promise<import('@clocky/clocky-simulation').SimulationGenerationRecord>>()
    const modelCapacity = this.modelCapacity
    const sleeping = new Map<SimulationEntityId, { actor: Agent; activationId: import('@clocky/clocky-team').ActivationId; work?: Promise<void> }>()
    const assertActorAdmission = (id: SimulationEntityId): void => {
      this.assertOpen(); assertAdmitted()
      if (requireEntity(run, id).readiness !== 'ready') throw new Error('Simulation activation requires a ready entity')
      if (sleeping.has(id)) throw new Error('Simulation actor is closing admission for hibernation')
    }
    const writers = new Map<SimulationEntityId, SimulationWriterLease>()
    const auxiliaryStreams = new Set<{ writer: SimulationWriterLease; cancellation: AbortController; done: Promise<void> }>()
    const retireAuxiliary = async (writer: SimulationWriterLease): Promise<void> => {
      const pending = [...auxiliaryStreams].filter(stream => stream.writer === writer)
      for (const stream of pending) stream.cancellation.abort(new Error('Simulation auxiliary writer is retiring'))
      await Promise.all(pending.map(stream => stream.done))
    }
    const deadlines = new SimulationDeadlines((error) =>{  ctx.logger.warn('Simulation deadline persistence failed', error) })
    const owner: TeamActivationLifecycleOwner = {
      name: ownerName,
      reserve: async (request, reservation) => {
        assertSimulationMaintenanceAdmission(run.snapshot())
        if (request.teamId !== teamId) throw new Error('Simulation lifecycle owner cannot start another Team')
        if (request.seed.kind === 'fork') throw new Error('Simulation cognition does not admit forked Session history')
        const entity = entityFor(request.participantId, request.sessionId)
        assertActorAdmission(entity.id)
        const provider = runtime(request.provider)
        const writer = await run.reserveWriter(entity.id, request.provider, reservation.reservationId, run.snapshot().revision)
        let agent: Agent | undefined
        let actual: ActivationBindingSnapshot | undefined
        writer.bindDecisionAdmission(async () => {
          assertActorAdmission(entity.id)
          if (agent === undefined || actual === undefined || this.ctx.agents.get(agent.id) !== agent) {
            throw new Error('Simulation decision has no current local Agent')
          }
          const current = await this.ctx.teams.getTeam({ teamId })
          assertAdmitted()
          const member = current.participants.find(value => value.id === request.participantId)
          const epoch = current.activations.find(value => value.activation.id === actual?.activation.id)
          if (current.team.phase !== 'active' || member?.phase !== 'active'
            || epoch === undefined || epoch.quiescedAt !== undefined || epoch.fencedAt !== undefined
            || (epoch.activation.status !== 'idle' && epoch.activation.status !== 'running')) {
            throw new Error('Simulation decision authority is no longer active')
          }
          const selected = Object.values(run.snapshot().decisions).find(value => value.entityId === entity.id && value.status === 'open')
          const task = selected === undefined ? undefined : taskDecision(run.snapshot(), selected.id)
          if (task !== undefined) {
            const target = current.tasks.find(value => value.id === task.execution.request.taskId)
            if (target?.lease?.attemptId !== task.execution.request.attemptId || target.lease.activationId !== actual.activation.id
              || target.cancellation !== undefined || target.phase !== 'assigned' && target.phase !== 'running'
              || target.lease.expiresAt <= Date.now() || target.revision < task.decision.request.task.revision
              || target.subject !== task.decision.request.task.subject || target.description !== task.decision.request.task.description) throw new Error('Simulation task decision no longer owns its live attempt')
          }

        }, async (decision) => {
          const current = (): void => {
            assertActorAdmission(entity.id)
            if (agent === undefined || this.ctx.agents.get(agent.id) !== agent) throw new Error('Simulation consumption has no current Agent')
          }
          current()
          return await flushContextConsumption(ctx, agent as Agent, decision, current, () => run.snapshot(),
            view => writer.validateContextPresentation(decision.id, view))
        })
        writers.set(entity.id, writer)
        const scoped = coordination(writer, provider, () => retireTaskExecutions(ctx, run, teamId, entity.id))
        return { ...scoped,
          bind: async (binding, local) => {
            await scoped.bind(binding, local)
            // The coordination lease rejects missing or mismatched actors before returning.
            const actor = local as Agent
            agent = actor; actual = binding
            this.modelHandlers.set(actor, modelAccess(actor, run, writer, () => {
              assertAdmitted()
              if (ctx.agents.get(actor.id) !== actor) throw new Error('Simulation model Agent is no longer current')
            }, (id) => { deadlines.finish(id) }, run.snapshot().world === undefined ? undefined
              : { payloadSchema: (pin, kind) => run.worldPayloadSchema(pin, kind) }))
          },
          revoke: async () => {
            await scoped.revoke()
            if (writers.get(entity.id) === writer) writers.delete(entity.id)
            await retireAuxiliary(writer)
          },
          checkpoint: async () => {
            if (agent !== undefined && (checkpointing !== undefined || sleeping.has(entity.id))
              && !await ctx.sessions.flush(agent.session)) {
              throw new Error('Simulation hibernation requires durable Session storage')
            }
          },
          release: async () => {
            if (agent !== undefined) {
              await deadlines.retire(agent)
            }
            await scoped.release()
            if (agent !== undefined) this.modelHandlers.delete(agent)
          },
        }
      },
      recover: async (binding) => {
        if (binding.activation.teamId !== teamId || binding.recovery !== undefined) throw new Error('Simulation does not support external activation recovery')
        const entity = entityFor(binding.activation.participantId, binding.sessionId)
        runtime(binding.provider)
        const writer = await run.recoverWriter(entity.id, activationFacts(binding))
        return coordination(writer, undefined, () => retireTaskExecutions(ctx, run, teamId, entity.id))
      },
      recoverReservation: async (reservation) => {
        if (reservation.teamId !== teamId) throw new Error('Simulation lifecycle owner cannot recover another Team')
        const entity = entityFor(reservation.participantId, reservation.sessionId)
        runtime(reservation.provider)
        const writer = await run.recoverUnpublishedWriter(entity.id, {
          teamId, participantId: reservation.participantId, sessionId: reservation.sessionId,
          provider: reservation.provider, reservationId: reservation.reservationId,
        })
        if (writer !== undefined) return coordination(writer, undefined, () => retireTaskExecutions(ctx, run, teamId, entity.id))
        return {
          localTerminationConfirmed: true,
          // No writer reservation exists, so this startup never passed the controller's domain admission.
          /* v8 ignore next -- this retirement-only receipt is never passed to the controller's startup bind path. */
          bind: () => Promise.reject(new Error('Unadmitted startup cannot become an active writer')),
          revoke: async () => {}, release: async () => {},
        }
      },
    }
    const unregister = this.ctx.teamActivations.registerLifecycleOwner(owner)
    let closed: Promise<void> | undefined
    let removeRetirement: (() => void) | undefined
    const allowedTools = new Set<string>(SIMULATION_MODEL_TOOLS)
    const removeToolGuard = this.ctx.tools.guard(exec => exec.agent?.session.header.teamId === teamId && !allowedTools.has(exec.name)
      ? 'Simulation actors may only observe, stage and submit through Simulation tools' : undefined)
    const assertCurrentWorldScopeAccess = (id: SimulationDecisionId, state: SimulationSnapshot): void => {
      const decision = state.decisions[id]
      if (decision === undefined) throw new Error('Simulation context disclosure has no current decision')
      assertPreparedWorldScopeAccess(state, decision)
    }
    const removeRequestCap = this.ctx.on('agent/request', async ({ agent }, next) => {
      const proposed = await next()
      if (agent.session.header.teamId !== teamId || this.requestPolicy === undefined) return proposed
      assertAdmitted()
      return { ...proposed, maxTokens: requestOutputCap(this.requestPolicy, run.snapshot().spec.tokensPerModelRequest, proposed.maxTokens) }
    }, { prepend: true })
    const removePreStep = this.ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
      if (agent.session.header.teamId !== teamId) return await next()
      assertAdmitted()
      // Session validation requires participantId whenever teamId is present.
      const entity = entityFor(agent.session.header.participantId as string, agent.session.id)
      const writer = writers.get(entity.id)
      const id = Object.values(run.snapshot().decisions).find(decision => decision.entityId === entity.id && decision.status === 'open')?.id
      if (writer === undefined || id === undefined) throw new Error('Simulation model request has no current decision owner')
      if (run.snapshot().decisions[id]?.deterministic !== undefined || taskDecision(run.snapshot(), id)?.decision.request.policy !== undefined) throw new Error('Simulation deterministic decisions cannot request inference')
      try {
        let prepared = await writer.readPreparedContext(id)
        if (prepared.maxBytes !== this.config.maxContextBytes) throw new Error('Simulation context policy changed; cancel the decision before preparing another')
        const decision = await next()
        if (decision.kind === 'reject') return decision
        const missing = missingReportReferences(run.snapshot(), prepared.referencedReports ?? [],
          [...agent.session.deriveMessages(), ...decision.messages])
        if (missing.length > 0) {
          const rebased = await writer.materializeCompactedReports(id, missing)
          if (rebased.status !== 'prepared') throw new Error('Simulation compacted report context exceeds its required byte budget')
          prepared = rebased
        }
        const visible = agent.session.surface.nodes.map(seq => agent.session.events[seq])
          .filter(event => event?.type === 'simulation/context-view')
        if (visible.length > 1) throw new Error('Simulation Session has multiple active context views')
        const current = visible[0]
        if (current?.type === 'simulation/context-view' && current.data.inputId === prepared.view.inputId
          && !isDeepStrictEqual(current.data, prepared.view)) await writer.validateContextPresentation(id, current.data)
        if (current?.type !== 'simulation/context-view' || !isDeepStrictEqual(current.data, prepared.view)) {
          assertCurrentWorldScopeAccess(id, run.snapshot())
          agent.session.append('simulation/context-view', prepared.view, current === undefined ? { surfaceOp: 'append' } : {
            surfaceOp: { op: 'replace', start: current.seq, end: current.seq }, sourceEventSeqs: [current.seq],
          })
        }
        const policy = this.requestPolicy
        if (policy !== undefined) {
          const meter = this.ctx.get('tokenMeter')
          if (meter === undefined) throw new Error('Simulation request policy requires the shared token meter')
          const compactor = agent.ctx.get('compaction')
          for (let attempt = 0; attempt < policy.compactionAttempts; attempt++) {
            const header = agent.session.requestHeader()
            if (header === undefined || compactor === undefined) break
            const measured = meter.measure(agent.session).totalTokens * policy.inputSafetyFactor
            const cap = requestOutputCap(policy, run.snapshot().spec.tokensPerModelRequest, header.config.maxTokens)
            if (measured + cap + policy.safetyMarginTokens <= run.snapshot().spec.tokensPerModelRequest) break
            const compacted = await compactor.compactIfNeeded(agent, 'context-overflow', signal)
            assertCurrentWorldScopeAccess(id, run.snapshot())
            const missing = missingReportReferences(run.snapshot(), prepared.referencedReports ?? [],
              [...agent.session.deriveMessages(), ...decision.messages])
            if (missing.length > 0) {
              const rebased = await writer.materializeCompactedReports(id, missing)
              if (rebased.status !== 'prepared') throw new Error('Simulation compacted report context exceeds its required byte budget')
              prepared = rebased
            }
            const visible = agent.session.surface.nodes.map(seq => agent.session.events[seq])
              .filter(event => event?.type === 'simulation/context-view')
            if (visible.length > 1) throw new Error('Compaction retained multiple Simulation contexts')
            const current = visible[0]
            if (current?.type !== 'simulation/context-view' || !isDeepStrictEqual(current.data, prepared.view)) {
              agent.session.append('simulation/context-view', prepared.view, current === undefined ? { surfaceOp: 'append' } : {
                surfaceOp: { op: 'replace', start: current.seq, end: current.seq }, sourceEventSeqs: [current.seq],
              })
            }
            if (!await this.ctx.sessions.flush(agent.session)) throw new Error('Simulation compaction requires durable canonical context')
            if (compacted === null) break
          }
        }
        if (!await this.ctx.sessions.flush(agent.session)) throw new Error('Simulation model context requires durable Session storage')
        await writer.readPreparedContext(id)
        return decision
      } catch (error) {
        if (error instanceof SimulationContextIntegrityError) {
          try { await writer.failContextIntegrity(id) }
          finally { deadlines.finish(id); agent.cancel({ kind: 'hook', reason: error.code }, { keepInbox: true }) }
          throw error
        }
        if (!await settleDecisionPause(error, writer, id)) throw error
        deadlines.finish(id)
        return { kind: 'reject' }
      }
    }, { prepend: true })
    const ctx = this.ctx, requestPolicy = this.requestPolicy
    const removeStream = ctx.on('llm/stream', (options, next): AsyncIterable<StreamChunk> => {
      const compaction = compactionRequestReference(options)
      const session = compaction?.session
        ?? (options.sessionId === undefined ? undefined : ctx.sessions.get(options.sessionId))
      if (session?.header.teamId !== teamId) return next()
      const generationCheck = generationRequests.get(options)
      if (generationCheck !== undefined) return (async function* () {
        const release = await modelCapacity.acquire(options.signal)
        try { assertAdmitted(); generationCheck(); options.signal?.throwIfAborted(); yield* next() }
        finally { release() }
      })()
      if (Object.values(run.snapshot().generationJobs ?? {}).some(value => value.binding.sessionId === session.id))
        throw new Error('Generation Session only admits its exact isolated input request')
      return (async function* (): AsyncIterable<StreamChunk> {
        assertAdmitted()
        const entity = entityFor(session.header.participantId as string, session.id)
        const writer = writers.get(entity.id)
        const id = Object.values(run.snapshot().decisions).find(decision => decision.entityId === entity.id && decision.status === 'open')?.id
        const checkRequestBudget = async (): Promise<void> => {
          const policy = requestPolicy
          if (policy === undefined) return
          const meter = ctx.get('tokenMeter')
          if (meter === undefined) throw new Error('Simulation request policy requires the shared token meter')
          const metadata = await ctx.llm.resolveModelInfo(options.provider, options.model, options.signal)
          const block = requestBudgetBlock(options, session, meter, policy, run.snapshot().spec.tokensPerModelRequest,
            metadata.context?.contextWindow)
          if (block === undefined) return
          if (writer !== undefined && id !== undefined) {
            await writer.blockRequestBudget(id, block)
            deadlines.finish(id)
          }
          throw new SimulationRequestBudgetError(block)
        }
        const onOverrun = async (reservation: import('@clocky/clocky-simulation').SimulationTokenReservation): Promise<void> => {
          if (requestPolicy === undefined || reservation.overrunAcknowledged !== false) return
          if (writer !== undefined && id !== undefined && run.snapshot().decisions[id]?.status === 'open') {
            await writer.cancelDecision(id)
            deadlines.finish(id)
          }
          const usage = reservation.usage ?? reservation.observedUsage
          if (usage === undefined) throw new Error('Token overrun lost its reported usage')
          throw new SimulationTokenOverrunError(reservation.id, reservation.reserved, simulationTokenCount(usage))
        }
        if (options.purpose === 'compaction' || compaction !== undefined) {
          const actor = ctx.agents.get(session.id)
          if (writer === undefined || actor === undefined) throw new Error('Simulation compaction requires its current canonical actor')
          const cancel = new AbortController()
          const done = Promise.withResolvers<void>()
          const owned = { writer, cancellation: cancel, done: done.promise }
          const signal = AbortSignal.any([admissionAbort.signal, cancel.signal, ...options.signal === undefined ? [] : [options.signal]])
          auxiliaryStreams.add(owned)
          try {
            yield* compactionStream(actor, writer, options, next, modelCapacity, signal, () => {
              assertActorAdmission(entity.id)
              if (ctx.agents.get(actor.id) !== actor || writers.get(entity.id) !== writer) throw new Error('Simulation compaction actor retired')
            }, () => ctx.sessions.flush(session), checkRequestBudget, onOverrun)
          } finally { auxiliaryStreams.delete(owned); done.resolve() }
          return
        }
        if (writer === undefined || id === undefined || options.purpose !== undefined) {
          throw new Error('Simulation model dispatch requires its current conversation decision')
        }
        try {
          const prepared = await writer.readPreparedContext(id)
          const preparedInput = decisionInput(prepared.view)
          const actor = ctx.agents.get(session.id)
          if (actor === undefined || inputState(actor, preparedInput) !== 'consumed') {
            throw new Error('Simulation model dispatch has not consumed its exact prepared input')
          }
          const assertRecordedRequest = (): void => {
            // One synchronous check observes one detached revision; every check after an await takes a fresh snapshot.
            const state = run.snapshot()
            assertCurrentWorldScopeAccess(id, state)
            const turn = session.events.findLast(event => event.type === 'turn/start' || event.type === 'turn/end')
            if (actor.status !== 'running' || turn?.type !== 'turn/start'
              || !session.events.slice(turn.seq + 1).some(event => event.type === 'user/message' && event.surfaceOp === 'append'
                && event.data.id === preparedInput.id)) {
              throw new Error('Simulation model dispatch requires its prepared input in the active Agent turn')
            }
            const header = session.requestHeader()
            if (header === undefined || !callConfigEquals(options, header.config) || options.system !== header.system
              || !isDeepStrictEqual(options.tools ?? [], header.tools ?? [])) {
              throw new Error('Simulation model request differs from its recorded request header')
            }
            if (options.tools?.some(tool => !allowedTools.has(tool.name))) {
              throw new Error('Simulation model request advertises tools outside its decision authority')
            }
            const task = taskDecision(state, id)
            if (task !== undefined && (task.execution.retired !== undefined || task.execution.task?.phase !== 'running'
              || state.taskCancellations?.[task.execution.request.operationId] !== undefined
              || task.execution.task.executor?.attemptId !== task.execution.request.attemptId
              || task.decision.input?.id !== prepared.view.inputId)) {
              throw new Error('Simulation model request requires its started task and recorded input')
            }
            assertReportReferences(state, prepared.referencedReports ?? [], options.messages)
            const views = session.surface.nodes.map(seq => session.events[seq]).filter(event => event?.type === 'simulation/context-view')
            const view = views[0]
            if (views.length !== 1 || view?.type !== 'simulation/context-view' || !isDeepStrictEqual(view.data, prepared.view)
            || !isDeepStrictEqual(options.messages, session.deriveMessages())) {
              throw new Error('Simulation model request differs from its recorded decision context or conversation')
            }
          }
          assertRecordedRequest()
          if (!await ctx.sessions.flush(session)) throw new Error('Simulation model dispatch requires durable Session storage')
          await writer.readPreparedContext(id)
          options.signal?.throwIfAborted()
          await deadlines.start(writer, id, actor, prepared.view.inputId)
          const signal = options.signal === undefined ? admissionAbort.signal : AbortSignal.any([options.signal, admissionAbort.signal])
          let release: () => void
          try { release = await modelCapacity.acquire(signal) }
          catch (error) {
            if (error instanceof SimulationModelCapacityExceeded && ['running', 'paused'].includes(run.snapshot().phase)) {
              await writer.blockModelAdmission(id, { sessionSequence: session.events.length - 1, ...error.usage })
            }
            throw error
          }
          try {
            signal.throwIfAborted()
            assertAdmitted()
            await writer.readPreparedContext(id)
            assertRecordedRequest()
            await deadlines.start(writer, id, actor, prepared.view.inputId)
            signal.throwIfAborted()
            await checkRequestBudget()
            const reservation = await writer.reserveModelTokens(id, { sessionSequence: session.events.length - 1,
              provider: options.provider, model: options.model })
            yield* meteredStream(writer, reservation, next, async () => {
              signal.throwIfAborted()
              assertAdmitted()
              await writer.readPreparedContext(id)
              assertRecordedRequest()
            }, () => ctx.sessions.flush(session), signal, () => {
              assertAdmitted()
              assertRecordedRequest()
            }, onOverrun)
          } finally { release() }
        } catch (error) {
          if (error instanceof SimulationContextIntegrityError) {
            try { await writer.failContextIntegrity(id) }
            finally {
              deadlines.finish(id)
              ctx.agents.get(session.id)?.cancel({ kind: 'hook', reason: error.code }, { keepInbox: true })
            }
            throw error
          }
          if (!await settleDecisionPause(error, writer, id)) throw error
          deadlines.finish(id)
          yield { type: 'finish', reason: { kind: 'aborted', failure: {
            message: 'Simulation scheduling paused before the next model dispatch', code: 'ABORTED',
          } } }
        }
      })()
    }, { prepend: true })
    const taskCompletions = new Map<import('@clocky/clocky-team').TaskAttemptId,
      { policy: import('@clocky/clocky-simulation').SimulationPolicyRef; work: Promise<import('./types.ts').SimulationTaskCompletionResult> }>()
    const personnelReads = new Set<Promise<import('@clocky/clocky-simulation').PersonnelObligationReport>>()
    const taskDecisions = new Set<Promise<SimulationDecision>>()
    const taskAssignments = new Set<Promise<import('@clocky/clocky-simulation').SimulationTaskExecution>>()
    const taskReviews = new Set<Promise<import('@clocky/clocky-team').TeamTaskSnapshot>>()
    const taskCancellations = new Set<Promise<import('@clocky/clocky-team').TeamTaskSnapshot>>()
    const taskReconciliations = new Set<Promise<import('@clocky/clocky-simulation').SimulationInteraction>>()
    const modelDecisions = new Map<Promise<import('@clocky/clocky-simulation').SimulationDecision>, Agent>()
    const summaries = new Set<Promise<import('@clocky/clocky-simulation').SimulationKnowledge>>()
    const deterministicRuns = new Map<SimulationEntityId, { id: SimulationDecisionId; wakeId: import('@clocky/clocky-simulation').SimulationEventId | undefined; policy: import('@clocky/clocky-simulation').SimulationPolicyRef; work: Promise<import('@clocky/clocky-simulation').SimulationDecision> }>()
    const inputs = new Map<SimulationEntityId, { id: SimulationDecisionId; work: Promise<SimulationInputDispatch> }>()
    const startTaskInput = async (id: SimulationDecisionId,
      writer: SimulationWriterLease, check: () => void): Promise<void> => {
      const task = taskDecision(run.snapshot(), id)
      if (task === undefined) return
      const prepared = await writer.readPreparedContext(id)
      check()
      await run.recordTaskInput({ attemptId: task.execution.request.attemptId, decisionId: id, inputId: prepared.view.inputId })
      this.taskAuthority ??= new SimulationTaskAuthority(this.ctx)
      const started = await this.taskAuthority.start(run, task.execution.request.attemptId, id, ownerName, () => {
        try { check(); return true }
        catch { return false } // Task authority ends when actor or connection admission closes.
      })
      await run.observeTaskExecution({ attemptId: task.execution.request.attemptId,
        task: projectTaskEvidence(run.snapshot(), started) })
      await writer.readPreparedContext(id)
      check()
    }
    const dispatchInput = async (entityId: SimulationEntityId, id: SimulationDecisionId): Promise<SimulationInputDispatch> => {
      assertActorAdmission(entityId)
      const writer = writers.get(entityId)
      const binding = requireEntity(run, entityId).binding
      const agent = binding === undefined ? undefined : ctx.agents.get(binding.sessionId)
      if (agent === undefined) throw new Error('Simulation input has no current local actor')
      const recorded = run.snapshot().decisions[id]
      if (recorded?.deterministic !== undefined || taskDecision(run.snapshot(), id)?.decision.request.policy !== undefined) throw new Error('Simulation deterministic decisions cannot dispatch model input')
      if (recorded?.entityId !== entityId || recorded.context?.status !== 'prepared') throw new Error('Simulation input has no owned prepared decision')
      const input = decisionInput(recorded.context.view)
      if (inputState(agent, input) === 'consumed') {
        if (!await ctx.sessions.flush(agent.session)) throw new Error('Simulation consumed input requires durable Session storage')
        assertAdmitted()
        return { status: 'consumed', inputId: recorded.context.view.inputId }
      }
      if (writer === undefined) throw new Error('Simulation input has no current writer')
      const prepared = await writer.readPreparedContext(id)
      if (agent.status === 'running') return { status: 'in-flight', inputId: prepared.view.inputId }
      return await agent.runMaintenance(async (signal) => {
        await writer.readPreparedContext(id)
        for (const previous of Object.values(run.snapshot().decisions)) {
          if (previous.entityId !== entityId || previous.status === 'open' || previous.context?.status !== 'prepared') continue
          const obsolete = decisionInput(previous.context.view)
          if (inputState(agent, obsolete) === 'queued') agent.inbox.remove(obsolete.id)
        }
        if (inputState(agent, input) === 'absent') agent.send(input, 'next-turn', false)
        if (!await ctx.sessions.flush(agent.session)) throw new Error('Simulation queued input requires durable Session storage')
        await writer.readPreparedContext(id)
        signal.throwIfAborted()
        assertActorAdmission(entityId)
        await startTaskInput(id, writer, () => { signal.throwIfAborted(); assertActorAdmission(entityId) })
        if (!agent.wakePending(input.id)) throw new Error('Simulation queued input is no longer available to wake')
        return { status: 'queued', inputId: prepared.view.inputId }
      })
    }
    const transport = this.postAuthority.transport(run, teamId, ownerName, canPublish)
    const receiving = new Map<import('@clocky/clocky-simulation').SimulationOperationId, Promise<import('@clocky/clocky-simulation').SimulationEventId>>()
    const deliveryReconciliations = new Set<Promise<'retained-input' | 'absent-input' | 'entity-terminated'>>()
    const recoveries = new Set<Promise<void>>()
    const dispatches = new Set<Promise<import('@clocky/clocky-simulation').SimulationDispatchResult>>()
    let driving: { until: import('@clocky/clocky-simulation').SimTime; work: Promise<import('./types.ts').SimulationTeamDriveResult> } | undefined
    let residentDrive: Promise<import('./types.ts').SimulationTeamDriveResult> | undefined
    const placements = new Map<SimulationEntityId, Promise<import('./types.ts').SimulationResidencyResult>>()
    const activations = new Set<Promise<import('@clocky/clocky-team-activation-controller').TeamActivationLease>>()
    const runDrive = (request: import('@clocky/clocky-simulation').SimulationDriveRequest, clock: () => number,
      ensure?: (id: SimulationEntityId) => Promise<'resident' | 'capacity' | 'recovery-required'>) =>
      driveTeam(run, connection, request, clock, this.config.maxCoordinationRounds, (id) => {
        const entity = run.inspectEntity(id).entity
        const actor = entity?.binding === undefined ? undefined : ctx.agents.get(entity.binding.sessionId)
        if (sleeping.has(id) || entity?.phase !== 'active' || entity.writer?.phase !== 'active' || actor === undefined) return 'unavailable'
        return actor.status === 'running' ? 'busy' : 'ready'
      }, id => this.deliveryAuthority.observeFailure(run, id, teamId, canPublish), assertAdmitted, ensure)
    const recoverEntity = async (entityId: SimulationEntityId, check: () => void): Promise<void> => {
      check()
      const binding = requireEntity(run, entityId).binding
      if (binding === undefined) throw new Error('Simulation entity has no cognition binding')
      const latest = await this.ctx.teams.getTeam({ teamId })
      const reservation = latest.participants.find(value => value.id === binding.participantId)?.activationReservation
      const activation = latest.activations.filter(value => value.activation.participantId === binding.participantId).at(-1)
      check()
      if (reservation !== undefined && !latest.activations.some(value => value.reservationId === reservation.id)) {
        await this.ctx.teamActivations.recoverCoordinatedReservation({
          teamId, participantId: binding.participantId, reservationId: reservation.id,
        })
      } else {
        if (activation === undefined) throw new Error('Simulation entity has no durable activation to recover')
        await this.ctx.teamActivations.recoverCoordinatedLocal({
          teamId, participantId: binding.participantId, activationId: activation.activation.id,
        })
      }
    }
    this.personnelAuthority ??= new PersonnelSettlementAuthority(ctx)
    const personnelAuthority = this.personnelAuthority
    const removePersonnelAuthority = run.snapshot().teamReservation?.confirmed === true
      ? personnelAuthority.attach(run, ownerName) : undefined
    const personnelSettlements = new Set<Promise<import('@clocky/clocky-simulation').SimulationWorldResult>>()
    const connection: SimulationTeamConnection = {
      generate: (jobId, authorize, signal) => {
        assertAdmitted()
        const job = generationRecordAt(run.snapshot(), jobId)
        if (job === undefined) throw new Error('Generation job is not retained')
        authorize(structuredClone(job.job))
        const existing = generations.get(jobId)
        if (existing !== undefined) return existing.then((result) => { authorize(structuredClone(result.job)); return result })
        const session = ctx.sessions.get(job.binding.sessionId)
        if (session === undefined) throw new Error('Generation canonical Session must be materialized before execution')
        if (ctx.agents.get(session.id)?.status === 'running') throw new Error('Generation Session has an active conversation')
        const cancellation = AbortSignal.any([admissionAbort.signal, AbortSignal.timeout(run.snapshot().spec.decisionTimeoutMs),
          ...signal === undefined ? [] : [signal]])
        const work = executeGeneration(run, jobId, session, authorize, () => ctx.sessions.flush(session), (options) => {
          generationRequests.set(options, () => {
            authorize(structuredClone(job.job))
            const current = run.snapshot(), retained = generationRecordAt(current, jobId)
            const input = session.events.find(event => event.seq === retained?.sessionSequence)
            const entity = current.entities[job.job.assistantEntityId]
            if (input?.type !== 'simulation/generation-input' || input.data.jobId !== jobId
              || input.data.scope !== job.job.scope || !isDeepStrictEqual(input.data.audience, job.job.audience)
              || input.data.modelVersion !== job.job.model.version || input.data.promptVersion !== job.job.promptVersion
              || input.data.policyVersion !== job.job.policyVersion || options.provider !== input.data.provider
              || options.model !== input.data.model || options.provider !== job.job.model.provider || options.model !== job.job.model.name
              || options.sessionId !== session.id || options.maxTokens !== job.job.budget.maxTokens || options.signal !== cancellation
              || options.messages.length !== 1 || JSON.stringify(options.messages[0]) !== input.data.message
              || options.tools?.length !== 0 || Object.keys(options).some(key =>
              !['provider', 'model', 'messages', 'sessionId', 'signal', 'tools', 'maxTokens'].includes(key))
              || !Object.isFrozen(options) || !Object.isFrozen(options.messages) || !Object.isFrozen(options.tools)
              || entity?.phase !== 'active' || !isDeepStrictEqual(entity.binding, job.binding))
              throw new Error('Generation request differs from its original durable Session input')
            if (job.job.planner !== undefined) activePlannerAncestors(current, job.job.planner)
            if (current.phase !== 'running' || BigInt(current.time) >= BigInt(job.job.deadline))
              throw new Error('Generation deadline or run admission closed before dispatch')
            if (generationRecordAt(current, jobId)?.status !== 'generating'
              || generationRecordAt(current, jobId)?.cancellation !== undefined)
              throw new Error('Generation authorization was withdrawn before dispatch')
          })
          return ctx.llm.stream(options)
        }, cancellation)
        generations.set(jobId, work)
        void work.then(() => generations.delete(jobId), () => generations.delete(jobId))
        return work
      },
      commitPersonnel: (id) => {
        assertAdmitted()
        const work = personnelAuthority.commit(run, teamId, ownerName, id, assertAdmitted)
        personnelSettlements.add(work)
        void work.then(() => { personnelSettlements.delete(work) }, () => { personnelSettlements.delete(work) })
        return work
      },

      inspectPersonnelObligations: (request) => {
        assertAdmitted()
        const query = personnelObligationQuerySchema.parse(request)
        const work = (async () => {
          const native = run.inspectPersonnelObligations(query), selected = run.snapshot().entities[query.selector.personId]
          const binding = selected?.binding
          if (binding === undefined) return native
          const sources = await collectPersonnelTeamSources(ctx, binding, {
            maxChannels: PERSONNEL_OBLIGATION_MAX_ITEMS, maxPages: PERSONNEL_OBLIGATION_MAX_ITEMS,
            pageSize: this.config.deliveryPageSize, maxBytes: query.maxBytes }, assertAdmitted)
          assertAdmitted()
          const current = run.inspectPersonnelObligations(query), snapshot = run.snapshot()
          if (!isDeepStrictEqual(current.items, native.items) || current.time !== native.time
            || current.totalCount !== native.totalCount) {
            return projectPersonnelObligations(snapshot, current, { ...sources, complete: false, incomplete: 'source-moved' }, query)
          }
          return projectPersonnelObligations(snapshot, current, sources, query)
        })()
        personnelReads.add(work)
        void work.then(() => { personnelReads.delete(work) }, () => { personnelReads.delete(work) })
        return work
      },

      cancelWorldCase: async (request) => {
        this.assertOpen()
        if (!admitted) throw new Error('Simulation Team connection is closed')
        if (checkpointing !== undefined) {
          const state = run.snapshot(), original = state.world?.requests[request.requestId]
          const reservation = original === undefined ? undefined : state.world?.personnel.reservations[original.intentId]
          const maintenance = activeSimulationMaintenance(state)
          if (reservation === undefined || maintenance === undefined
            || !isDeepStrictEqual(reservation.request.maintenance, maintenance.request))
            throw new Error('Simulation checkpoint collection blocks new admission')
          // Only this original maintenance-owned cancellation may queue; Native still rejects a sealed checkpoint cut.
        }
        const receipt = await run.cancelWorldCase(request)
        if (receipt.status !== 'cancel-requested') return receipt
        const original = run.snapshot().world?.requests[receipt.request.requestId]
        if (original === undefined) throw new Error('World cancellation lost its original case')
        const personnel = run.snapshot().world?.personnel.reservations[original.intentId]
        if (personnel !== undefined) {
          const maintenance = run.snapshot().maintenance?.[personnel.request.maintenance.id]
          if (maintenance === undefined || maintenance.status === 'draining') return receipt
          await run.settlePersonnelCancellation(original.intentId)
          assertAdmitted()
          return await run.cancelWorldCase(receipt.request)
        }
        assertAdmitted()
        const state = run.snapshot(), representative = state.world?.external.representatives[original.intentId]
        if (representative !== undefined) {
          const maintenance = state.maintenance?.[representative.request.maintenance.id]
          if (maintenance?.status !== 'quiescent') return receipt
          await run.settleExternalRepresentativeCancellation(original.intentId)
        } else {
          const contact = state.world?.external.contacts[original.intentId]
          if (contact !== undefined) {
            const maintenance = contact.cancellation === undefined ? undefined : state.maintenance?.[contact.cancellation.maintenance.id]
            if (maintenance?.status !== 'quiescent') return receipt
            await run.settleExternalContactCancellation(original.intentId)
          } else await run.settleWorldHireCancellation(original.intentId)
        }
        assertAdmitted()
        return await run.cancelWorldCase(receipt.request)
      },
      quiesceForMaintenance: (request, maxDrainRounds, maxAttempts, signal) => {
        this.assertOpen(); signal?.throwIfAborted()
        const accepted = simulationMaintenanceRequestSchema.parse(request)
        if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || !Number.isSafeInteger(maxDrainRounds) || maxDrainRounds < 1) {
          return Promise.reject(new TypeError('Maintenance collection bounds must be positive safe integers'))
        }
        const existing = maintenanceWork.get(accepted.id)
        if (existing !== undefined) {
          if (!isDeepStrictEqual(existing.request, accepted) || existing.maxDrainRounds !== maxDrainRounds
            || existing.maxAttempts !== maxAttempts) {
            return Promise.reject(new Error('In-flight maintenance changed its original request or collection bounds'))
          }
          return existing.work
        }
        assertAdmitted()
        const work = (async () => {
          const operation = await run.beginMaintenance(accepted)
          if (operation.status !== 'draining') return operation
          for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const before = run.snapshot()
            let candidate: import('./types.ts').SimulationCheckpointCollection | undefined
            try {
              candidate = await connection.collectCheckpointCandidate(maxDrainRounds, 1, signal)
              await candidate.validate()
            } catch (error: unknown) {
              const state = run.snapshot()
              // Only a durable control change can replace this Native cut; missing or foreign owner evidence still fails.
              if (!(error instanceof SimulationCheckpointError) || error.diagnostic.code !== 'source-moved'
                || attempt + 1 === maxAttempts || error.diagnostic.subject.kind === 'run'
                  && isDeepStrictEqual(before.management, state.management)
                  && isDeepStrictEqual(before.world?.cancellations, state.world?.cancellations)) throw error
              continue
            } finally { candidate?.release() }
            assertAdmitted(); signal?.throwIfAborted()
            return await run.quiesceMaintenance(accepted)
          }
          throw new Error('Maintenance has no allowed collection attempt')
        })().finally(() => { maintenanceWork.delete(accepted.id) })
        maintenanceWork.set(accepted.id, { request: accepted, maxDrainRounds, maxAttempts, work })
        return work
      },
      ensureResident: (entityId, choice) => {
        assertActorAdmission(entityId)
        if (placements.has(entityId)) return Promise.reject(new Error('Simulation residency transition is already in progress'))
        const work = ensureResident(run, connection, entityId, choice.activation, choice.evict, (id) => {
          const binding = run.inspectEntity(id).entity?.binding
          return binding === undefined ? undefined : ctx.agents.get(binding.sessionId)
        }, () => { this.assertOpen(); assertAdmitted() }, choice.policy ?? this.residencyPolicy)
        placements.set(entityId, work)
        void work.then(() => { placements.delete(entityId) }, () => { placements.delete(entityId) })
        return work
      },
      driveResident: (request, clock, choose) => {
        this.assertOpen(); assertAdmitted()
        if (residentDrive !== undefined) return Promise.reject(new Error('Simulation resident drive is already in progress'))
        if (driving !== undefined) return Promise.reject(new Error('Simulation coordinator is already driving'))
        const work = runDrive(request, clock, async id => (await connection.ensureResident(id, choose(id))).status)
        residentDrive = work
        void work.then(() => { residentDrive = undefined }, () => { residentDrive = undefined })
        return work
      },
      checkpoint: (request, signal) => {
        this.assertOpen()
        const accepted = simulationCheckpointRequestSchema.parse(request)
        const existing = checkpointRequests.get(accepted.id)
        if (existing !== undefined) {
          if (!isDeepStrictEqual(existing.request, accepted)) return Promise.reject(new Error('Checkpoint id changed its request'))
          return existing.work
        }
        assertAdmitted()
        const work = (async () => {
          const operation = await run.beginCheckpoint(accepted)
          if (operation.status !== 'in-progress') return operation
          let candidate: import('./types.ts').SimulationCheckpointCollection | undefined
          try {
            candidate = await connection.collectCheckpointCandidate(accepted.maxDrainRounds, accepted.maxAttempts, signal)
            return await candidate.publish(accepted.id)
          } catch (error: unknown) {
            candidate?.release()
            const prior = run.snapshot().checkpoints?.[accepted.id]
            if (prior?.status === 'completed') return prior
            const diagnostic = checkpointDiagnostic(error, { stage: 'collect', code: signal?.aborted ? 'cancelled' : 'unavailable',
              subject: { kind: 'team', teamId } })
            return await run.failCheckpoint(accepted.id, error instanceof Error ? error.message : String(error), diagnostic)
          } finally { candidate?.release() }
        })()
        checkpointRequests.set(accepted.id, { request: accepted, work })
        void work.then(() => { checkpointRequests.delete(accepted.id) }, () => { checkpointRequests.delete(accepted.id) })
        return work
      },
      collectCheckpointCandidate: (maxDrainRounds, maxAttempts, signal, mode) => {
        this.assertOpen(); assertAdmitted(); signal?.throwIfAborted()
        if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || !Number.isSafeInteger(maxDrainRounds) || maxDrainRounds < 1) {
          return Promise.reject(new TypeError('Checkpoint collection bounds must be positive safe integers'))
        }
        const token = Symbol('checkpoint-collection')
        checkpointing = token
        let cut: import('@clocky/clocky-simulation').SimulationCheckpointCut | undefined
        let released = false
        const release = (): void => {
          released = true
          cut?.release()
          if (checkpointing === token) checkpointing = undefined
          if (checkpointRelease === release) checkpointRelease = undefined
        }
        const check = (): void => {
          this.assertOpen(); signal?.throwIfAborted()
          if (!admitted || released || checkpointing !== token) throw new Error('Checkpoint collection is no longer admitted')
        }
        const waitAccepted = async (work: Promise<unknown>): Promise<void> => {
          signal?.throwIfAborted()
          if (signal === undefined) { await work; return }
          const aborted = Promise.withResolvers<never>()
          const listener = addAbortListener(signal, () => { aborted.reject(signal.reason) })
          try { await Promise.race([work, aborted.promise]) }
          finally { listener[Symbol.dispose]() }
        }
        const work = (async () => {
          try {
            if (mode === 'quiescent') {
              const state = run.snapshot()
              if (generations.size > 0 || state.phase !== 'paused' || state.activeWindowId !== undefined || state.activeDecisionId !== undefined
                || Object.values(state.entities).some(entity => entity.writer !== undefined && entity.writer.phase !== 'released'))
                throw new Error('Read-only archive preview requires an already paused quiescent run')
              const team = await ctx.teams.getTeam({ teamId })
              if (team.activations.some(value => value.quiescedAt === undefined)
                || team.participants.some(value => value.activationReservation !== undefined
                  && value.activationReservation.releasedAt === undefined
                  && !team.activations.some(activation => activation.reservationId === value.activationReservation?.id)))
                throw new Error('Read-only archive preview requires previously retired Team writers')
              check()
              cut = await run.acquireCheckpointCut(maxDrainRounds, signal)
              const collection = await collectCheckpoint(ctx, run, cut, teamId, ownerName, maxAttempts, check, release, signal)
              checkpointRelease = release
              return collection
            }
            for (let attempt = 0; ; attempt += 1) {
              check()
              const revision = run.snapshot().revision
              try { await checkpointSource('retire', { kind: 'run' }, () => run.setPhase('paused', revision)); break }
              catch (error: unknown) { if (attempt + 1 >= maxAttempts || run.snapshot().revision === revision) throw error }
            }
            await waitAccepted(Promise.allSettled([...placements.values(), ...activations, ...recoveries]))
            check()
            for (const entity of Object.values(run.snapshot().entities)) {
              if (entity.binding !== undefined && entity.writer?.phase !== 'released') {
                ctx.agents.get(entity.binding.sessionId)?.cancel({ kind: 'hook', reason: 'Simulation checkpoint collection' })
              }
            }
            await waitAccepted(Promise.allSettled([...receiving.values(), ...[...inputs.values()].map(value => value.work), ...summaries,
              ...[...sleeping.values()].flatMap(value => value.work === undefined ? [] : [value.work]),
              ...[...taskCompletions.values()].map(value => value.work),
              ...taskDecisions, ...taskAssignments, ...taskReconciliations, ...taskReviews, ...taskCancellations,
              ...deliveryReconciliations, ...dispatches,
              ...generations.values(),
              ...modelDecisions.keys(),
              ...[...deterministicRuns.values()].map(value => value.work),
              ...residentDrive === undefined ? [] : [residentDrive], ...driving === undefined ? [] : [driving.work]]))
            check()
            const teamState = await checkpointSource('retire', { kind: 'team', teamId }, () => ctx.teams.getTeam({ teamId }))
            check()
            for (const entity of Object.values(run.snapshot().entities)) {
              const subject = { kind: 'entity' as const, entityId: entity.id }
              const reservation = teamState.participants.find(value => value.id === entity.binding?.participantId)?.activationReservation
              const unpublished = reservation !== undefined && reservation.releasedAt === undefined
                && !teamState.activations.some(value => value.reservationId === reservation.id)
              if (entity.writer === undefined || entity.writer.phase === 'released') {
                if (unpublished) { await checkpointSource('retire', subject, () => recoverEntity(entity.id, check)); check() }
                continue
              }
              const binding = entity.binding
              if (binding === undefined) throw checkpointRule('Checkpoint writer has no canonical binding', 'retire', 'binding-mismatch', subject)
              if (ctx.agents.get(binding.sessionId) === undefined) {
                await checkpointSource('retire', subject, () => recoverEntity(entity.id, check))
                check()
                if (run.inspectEntity(entity.id).entity?.writer?.phase !== 'released') {
                  throw checkpointRule('Checkpoint writer recovery has not confirmed release', 'retire', 'owner-not-quiescent', subject)
                }
                continue
              }
              const activationId = entity.writer.activationId
              if (activationId === undefined) throw checkpointRule('Checkpoint actor has no recorded activation', 'retire', 'binding-mismatch', subject)
              await checkpointSource('retire', subject, () => ctx.teamActivations.stopOwnedActivation({ teamId: binding.teamId,
                participantId: binding.participantId, activationId }))
              check()
            }
            await waitAccepted(Promise.all([this.participants.drain(run), this.channels.drain(run), this.invitationAuthority.drain(run)]))
            check()
            for (const entity of Object.values(run.snapshot().entities)) {
              if (entity.writer?.phase === 'released') sleeping.delete(entity.id)
            }
            const window = run.snapshot().activeWindowId
            if (window !== undefined) await checkpointSource('retire', { kind: 'run' }, () => run.commitWindow(window))
            cut = await checkpointSource('retire', { kind: 'run' }, () => run.acquireCheckpointCut(maxDrainRounds, signal))
            check()
            const collection = await collectCheckpoint(ctx, run, cut, teamId, ownerName, maxAttempts, check, release, signal)
            check()
            checkpointRelease = release
            return collection
          } catch (error: unknown) { release(); throw error }
        })()
        checkpointWork = work
        // Successful candidates cannot release admission before this handler runs; failures can admit an immediate retry.
        void work.then(() => { checkpointWork = undefined },
          () => { if (checkpointWork === work) checkpointWork = undefined })
        return work
      },
      hibernate: (entityId) => {
        this.assertOpen(); assertAdmitted()
        const entity = requireEntity(run, entityId)
        if (entity.writer?.phase === 'released') { sleeping.delete(entityId); return Promise.resolve() }
        let entry = sleeping.get(entityId)
        if (entry?.work !== undefined) return entry.work
        if (entry === undefined) {
          const actor = entity.binding === undefined ? undefined : ctx.agents.get(entity.binding.sessionId)
          if (actor === undefined || entity.writer?.activationId === undefined || entity.writer.phase !== 'active') {
            return Promise.reject(new Error('Simulation hibernation requires a current local activation'))
          }
          if (actor.status !== 'idle' || Object.values(run.snapshot().decisions).some(decision => decision.entityId === entityId
            && (decision.status === 'open' || decision.status === 'submitted'))) {
            return Promise.reject(new Error('Simulation hibernation requires an idle actor with settled decisions'))
          }
          entry = { actor, activationId: entity.writer.activationId }
          sleeping.set(entityId, entry)
        }
        const owned = entry
        const work = (async () => {
          const pending = [...receiving.entries()].filter(([id]) => {
            const operation = run.snapshot().operations[id]
            return operation?.action.kind === 'communication/post' && operation.action.recipient === entityId
          }).map(([, operation]) => operation)
          await Promise.all(pending)
          if (inputs.has(entityId)) await inputs.get(entityId)?.work
          if (requireEntity(run, entityId).writer?.phase === 'active') {
            await this.deliveryAuthority.restorePending(run, entityId, teamId, canPublish)
            await owned.actor.runMaintenance(async (signal) => {
              if (!await ctx.sessions.flush(owned.actor.session)) throw new Error('Simulation hibernation requires durable Session storage')
              signal.throwIfAborted()
            })
          }
          const binding = requireEntity(run, entityId).binding
          if (binding === undefined) throw new Error('Simulation hibernation lost its canonical binding')
          await ctx.teamActivations.stopOwnedActivation({ teamId, participantId: binding.participantId, activationId: owned.activationId })
          if (requireEntity(run, entityId).writer?.phase !== 'released') throw new Error('Simulation hibernation has no confirmed writer release')
          sleeping.delete(entityId)
        })().catch((error: unknown) => {
          delete owned.work
          if (requireEntity(run, entityId).writer?.phase === 'active') sleeping.delete(entityId)
          throw error
        })
        owned.work = work
        return work
      },
      resume: (entityId, request) => {
        assertActorAdmission(entityId)
        const entity = requireEntity(run, entityId)
        if (entity.writer?.phase !== 'released' || entity.writer.activationId === undefined) {
          return Promise.reject(new Error('Simulation resume requires a proven-stopped Session activation'))
        }
        return connection.activate(entityId, { ...request, seed: { kind: 'resume' } })
      },
      openWindow: async (request) => {
        this.assertOpen(); assertAdmitted()
        const state = run.snapshot()
        const existing = Object.hasOwn(state.windows ?? {}, request.id) ? state.windows?.[request.id] : undefined
        for (const decision of request.decisions) {
          assertActorAdmission(decision.entityId)
          if (existing === undefined && decision.policy !== undefined
            && this.deterministicPolicies.get(decision.policy.id)?.version !== decision.policy.version) {
            throw new Error('Simulation deterministic window policy version is not registered')
          }
          await this.deliveryAuthority.restorePending(run, decision.entityId, teamId, canPublish)
        }
        const team = await ctx.teams.getTeam({ teamId })
        this.assertOpen(); assertAdmitted()
        return await run.openWindow({ id: request.id, decisions: request.decisions.map((decision, index) => {
          const previous = existing?.request.decisions[index]?.context
          let context = decision.context
          if (decision.policy !== undefined) context = policyKnowledge(context)
          else if (previous === undefined && context.knowledge !== undefined) {
            const binding = requireEntity(run, decision.entityId).binding
            const actor = binding === undefined ? undefined : ctx.agents.get(binding.sessionId)
            if (actor === undefined) throw new Error('Simulation window requires its canonical actor')
            context = modelKnowledge(run, actor, decision.entityId, context, run.snapshot().revision)
          } else if (previous !== undefined && context.knowledge !== undefined && previous.knowledge?.visibleReports !== undefined) {
            context = { ...context, knowledge: { ...context.knowledge, visibleReports: [...previous.knowledge.visibleReports] } }
          }
          return { ...decision, context: { ...context, maxBytes: this.config.maxContextBytes,
            teamCursor: previous?.teamCursor ?? team.team.cursor } }
        }) }, run.snapshot().revision)
      },
      cancelDecision: (entityId, id) => {
        this.assertOpen(); assertAdmitted()
        const writer = writers.get(entityId)
        if (writer === undefined) return Promise.reject(new Error('Simulation decision has no current writer'))
        return writer.cancelDecision(id).then((decision) => { deadlines.finish(id); return decision })
      },
      executeDeterministicDecision: (entityId, id, context, policy, wakeId) => {
        assertActorAdmission(entityId)
        const selected = simulationPolicyRefSchema.parse(policy)
        const pending = deterministicRuns.get(entityId)
        if (pending !== undefined) {
          if (pending.id !== id || pending.wakeId !== wakeId || !isDeepStrictEqual(pending.policy, selected)) {
            return Promise.reject(new Error('Simulation actor already has another deterministic computation'))
          }
          return pending.work
        }
        const binding = requireEntity(run, entityId).binding
        const actor = binding === undefined ? undefined : ctx.agents.get(binding.sessionId)
        const writer = writers.get(entityId)
        if (actor === undefined || writer === undefined) return Promise.reject(new Error('Simulation deterministic decision requires its local writer'))
        const resolve = () => {
          const implementation = this.deterministicPolicies.get(selected.id)
          if (implementation?.version !== selected.version) throw new Error('Simulation deterministic policy version is not registered')
          return implementation
        }
        const work = executeDeterministic(run, connection, actor, writer, entityId, id, context, selected, resolve, () => {
          assertActorAdmission(entityId)
          if (ctx.agents.get(actor.id) !== actor || writers.get(entityId) !== writer) throw new Error('Simulation deterministic actor is no longer current')
        }, () => ctx.sessions.flush(actor.session), async (checkTask) => {
          if (taskDecision(run.snapshot(), id) === undefined) return
          const prepared = await writer.readPreparedContext(id)
          checkTask()
          const views = actor.session.surface.nodes.map(seq => actor.session.events[seq])
            .filter(event => event?.type === 'simulation/context-view')
          const current = views[0]
          if (current?.type !== 'simulation/context-view' || !isDeepStrictEqual(current.data, prepared.view)) {
            assertCurrentWorldScopeAccess(id, run.snapshot())
            actor.session.append('simulation/context-view', prepared.view, current === undefined ? { surfaceOp: 'append' } : {
              surfaceOp: { op: 'replace', start: current.seq, end: current.seq }, sourceEventSeqs: [current.seq],
            })
          }
          const input = decisionInput(prepared.view)
          if (inputState(actor, input) === 'absent') actor.session.append('user/message', input, { surfaceOp: 'append' })
          if (!await ctx.sessions.flush(actor.session)) throw new Error('Simulation deterministic task input requires durable Session storage')
          checkTask()
          await startTaskInput(id, writer, checkTask)
        }, wakeId).then(async (decision) => {
          if (decision.status === 'accepted') {
            await this.deliveryAuthority.restorePending(run, entityId, teamId, canPublish)
          }
          return decision
        })
        deterministicRuns.set(entityId, { id, wakeId, policy: selected, work })
        void work.then(() => { deterministicRuns.delete(entityId) }, () => { deterministicRuns.delete(entityId) })
        return work
      },
      assignTask: (request) => {
        this.assertOpen(); assertAdmitted()
        this.taskAuthority ??= new SimulationTaskAuthority(this.ctx)
        const work = assignSimulationTask(ctx, run, this.taskAuthority, ownerName, request,
          () => { this.assertOpen(); assertAdmitted() })
        taskAssignments.add(work)
        void work.then(() => { taskAssignments.delete(work) }, () => { taskAssignments.delete(work) })
        return work
      },
      cancelTask: (request, authorize) => {
        this.assertOpen(); assertAdmitted(); authorize?.()
        this.taskAuthority ??= new SimulationTaskAuthority(this.ctx)
        const authority = this.taskAuthority, selected = { ...request }
        const work = (async () => {
          const task = await authority.cancel(run, ownerName, selected, () => {
            try { this.assertOpen(); assertAdmitted(); authorize?.(); return true }
            catch { return false } // Already accepted canonical intent still owns cleanup after caller or admission retirement.
          })
          /* v8 ignore next -- Team exact-attempt cancellation retains evidence; terminal no-op requires null. */
          if (task.cancellation === undefined || selected.expectedAttemptId === null) return task
          const execution = run.snapshot().taskExecutions?.[selected.expectedAttemptId]
          /* v8 ignore next -- canonical cancellation retains its original attempt in append-only native history. */
          if (execution === undefined) throw new Error('Simulation task cancellation lost its original execution')
          const source = execution.request, entity = run.snapshot().entities[source.entityId]
          if (entity?.writer?.phase === 'active' && entity.writer.epoch === source.epoch
            && entity.writer.activationId === source.activationId && execution.retired === undefined) {
            ctx.agents.get(source.sessionId)?.cancel({ kind: 'hook', reason: 'Simulation task cancellation' })
            await ctx.teamActivations.stopOwnedActivation({ teamId: source.teamId, participantId: source.participantId,
              activationId: source.activationId })
          }
          const state = run.snapshot(), window = state.activeWindowId === undefined ? undefined : state.windows?.[state.activeWindowId]
          if (window !== undefined && window.request.decisions.every(value =>
            state.decisions[value.id]?.status === 'cancelled' || state.decisions[value.id]?.status === 'accepted')) {
            await run.commitWindow(window.id)
          }
          const current = await ctx.teams.getTask({ teamId: source.teamId, taskId: source.taskId })
          const evidence = projectTaskEvidence(run.snapshot(), current)
          await run.observeTaskExecution({ attemptId: source.attemptId, task: evidence })
          return current
        })()
        taskCancellations.add(work)
        void work.then(() => { taskCancellations.delete(work) }, () => { taskCancellations.delete(work) })
        return work
      },
      executeTaskDecision: (request) => {
        const work = executeTaskDecision(ctx, run, connection, request, () => { this.assertOpen(); assertAdmitted() })
        taskDecisions.add(work)
        void work.then(() => { taskDecisions.delete(work) }, () => { taskDecisions.delete(work) })
        return work
      },
      completeTask: (request) => {
        this.assertOpen(); assertAdmitted()
        this.taskAuthority ??= new SimulationTaskAuthority(this.ctx)
        const attemptId = request.attemptId
        const selected = simulationPolicyRefSchema.parse(request.policy)
        const pending = taskCompletions.get(attemptId)
        if (pending !== undefined) {
          if (!isDeepStrictEqual(pending.policy, selected)) return Promise.reject(new Error('Simulation task has another completion policy in flight'))
          return pending.work
        }
        const work = completeTask(ctx, run, this.taskAuthority, ownerName, { attemptId, policy: selected }, () => {
          const policy = this.taskCompletionPolicies.get(selected.id)
          if (policy?.version !== selected.version) throw new Error('Simulation task completion policy generation is not registered')
          return policy
        }, () => { this.assertOpen(); assertAdmitted() })
        taskCompletions.set(attemptId, { policy: selected, work })
        void work.then(() => { taskCompletions.delete(attemptId) }, () => { taskCompletions.delete(attemptId) })
        return work
      },
      reviewTask: (request, authorize) => {
        const check = (): void => { this.assertOpen(); assertAdmitted(); authorize?.() }
        check()
        this.taskReviewAuthority ??= new SimulationTaskReviewAuthority(this.ctx)
        const selected = { ...request }
        const authority = this.taskReviewAuthority
        const work = (async () => {
          const task = await authority.review(run, ownerName, selected, () => {
            try { check(); return true }
            catch { return false } // Connection or caller admission retirement withdraws the opaque proof.
          })
          check()
          const evidence = projectTaskEvidence(run.snapshot(), task)
          // A historical command retry must not attach a later attempt to its original execution.
          if (evidence.executor?.attemptId === selected.attemptId) {
            await run.observeTaskExecution({ attemptId: selected.attemptId, task: evidence })
            check()
          }
          return task
        })()
        taskReviews.add(work)
        void work.then(() => { taskReviews.delete(work) }, () => { taskReviews.delete(work) })
        return work
      },
      reconcileTask: (interactionId, expectedRevision, taskId) => {
        this.assertOpen(); assertAdmitted()
        const work = (async () => {
          const task = await ctx.teams.getTask({ teamId, taskId })
          this.assertOpen(); assertAdmitted()
          if (task.teamId !== teamId || task.id !== taskId) throw new Error('Simulation task owner returned another task')
          return await run.reconcileTask({ interactionId, expectedRevision,
            task: projectTaskEvidence(run.snapshot(), task) })
        })()
        taskReconciliations.add(work)
        void work.then(() => { taskReconciliations.delete(work) }, () => { taskReconciliations.delete(work) })
        return work
      },
      summarizeKnowledge: (entityId, policy, request) => {
        this.assertOpen(); assertAdmitted()
        const selected = simulationPolicyRefSchema.parse(policy)
        const work = summarizeKnowledge(run, entityId, selected, request, () => {
          const implementation = this.summaryPolicies.get(selected.id)
          if (implementation?.version !== selected.version) throw new Error('Simulation summary policy version is not registered')
          return implementation
        }, () => { this.assertOpen(); assertAdmitted() })
        summaries.add(work)
        void work.then(() => { summaries.delete(work) }, () => { summaries.delete(work) })
        return work
      },
      executeDecision: (entityId, id, context, wakeId) => {
        const binding = requireEntity(run, entityId).binding
        const agent = binding === undefined ? undefined : ctx.agents.get(binding.sessionId)
        if (agent === undefined) return Promise.reject(new Error('Simulation decision has no current local actor'))
        const work = executeDecision(run, connection, agent, entityId, id, context, () => ctx.sessions.flush(agent.session), () => {
          this.assertOpen(); assertAdmitted()
          if (ctx.agents.get(agent.id) !== agent) throw new Error('Simulation decision actor is no longer current')
        }, wakeId, async (error) => {
          const writer = writers.get(entityId)
          if (writer === undefined || !await settleDecisionPause(error, writer, id)) return false
          deadlines.finish(id)
          return true
        })
        modelDecisions.set(work, agent)
        void work.then(() => { modelDecisions.delete(work) }, () => { modelDecisions.delete(work) })
        return work
      },
      ensureChannel: request => this.channels.ensure(run, request, teamId, ownerName, () => { this.assertOpen(); assertAdmitted() }),
      ensureParticipant: (entityId, participant) => {
        this.assertOpen(); assertAdmitted()
        runtime(participant.provider)
        return this.participants.ensure(run, entityId, participant, teamId, ownerName, () => { this.assertOpen(); assertAdmitted() })
      },
      reconcileDeliveryFailure: (id) => {
        assertAdmitted()
        const work = this.deliveryAuthority.reconcileFailure(run, id, teamId, canPublish)
        deliveryReconciliations.add(work)
        void work.then(() => { deliveryReconciliations.delete(work) }, () => { deliveryReconciliations.delete(work) })
        return work
      },
      invitation: (entityId) => {
        assertAdmitted()
        const entity = requireEntity(run, entityId)
        if (entity.phase !== 'active' || entity.binding?.teamId !== teamId) throw new Error('Simulation invitation requires an active bound entity')
        return { participantId: entity.binding.participantId, required: true, sessionId: entity.binding.sessionId }
      },
      acknowledgeInvitation: (entityId, channelId) => {
        assertAdmitted()
        return this.invitationAuthority.acknowledge(run, entityId, channelId, teamId, ownerName, canPublish)
      },
      drive: (request, clock) => {
        assertAdmitted()
        if (residentDrive !== undefined) return Promise.reject(new Error('Simulation resident drive is already in progress'))
        if (driving !== undefined) {
          if (driving.until !== request.until) return Promise.reject(new Error('Simulation coordinator already has another horizon in flight'))
          return driving.work
        }
        const work = runDrive(request, clock)
        driving = { until: request.until, work }
        void work.then(() => { driving = undefined }, () => { driving = undefined })
        return work
      },
      receiveOperation: (id) => {
        assertAdmitted()
        const current = receiving.get(id)
        if (current !== undefined) return current
        const operation = run.snapshot().operations[id]
        if (operation?.action.kind === 'communication/post') assertActorAdmission(operation.action.recipient)
        const work = this.deliveryAuthority.receive(run, id, teamId, ownerName, canPublish)
        receiving.set(id, work)
        void work.then(() => { receiving.delete(id) }, () => { receiving.delete(id) })
        return work
      },
      dispatchOperation: (id, clock) => {
        assertAdmitted()
        const operation = run.snapshot().operations[id]
        const target = operation?.action.kind === 'task/create'
          ? (this.taskAuthority ??= new SimulationTaskAuthority(this.ctx)).transport(run, teamId, ownerName, canPublish)
          : transport
        const work = run.dispatchOperation(id, target, clock)
        dispatches.add(work)
        void work.then(() => { dispatches.delete(work) }, () => { dispatches.delete(work) })
        return work
      },
      dispatchDecision: (entityId, id) => {
        const pending = inputs.get(entityId)
        if (pending !== undefined) {
          if (pending.id !== id) return Promise.reject(new Error('Simulation actor already has another input admission in flight'))
          return pending.work
        }
        const work = dispatchInput(entityId, id)
        inputs.set(entityId, { id, work })
        void work.then(() => { inputs.delete(entityId) }, () => { inputs.delete(entityId) })
        return work
      },
      prepareContext: async (entityId, id, request) => {
        assertActorAdmission(entityId)
        const writer = writers.get(entityId)
        if (writer === undefined) throw new Error('Simulation entity has no live decision authority')
        const current = await this.ctx.teams.getTeam({ teamId })
        assertAdmitted()
        const existing = run.snapshot().decisions[id]?.context
        const teamCursor = existing === undefined ? current.team.cursor : existing.teamCursor
        const state = run.snapshot()
        const decision = state.decisions[id]
        const binding = requireEntity(run, entityId).binding
        const actor = binding === undefined ? undefined : ctx.agents.get(binding.sessionId)
        if (actor === undefined || decision === undefined) throw new Error('Simulation context has no canonical actor decision')
        const material = decision.deterministic !== undefined ? policyKnowledge(request) : existing === undefined
          ? modelKnowledge(run, actor, entityId, request, decision.snapshotRevision)
          : { ...request, ...request.knowledge === undefined ? {} : { knowledge: { ...request.knowledge,
            ...existing.visibleReports === undefined ? {} : { visibleReports: [...existing.visibleReports] },
          } } }
        return await writer.prepareContext(id, { ...material, teamCursor, maxBytes: this.config.maxContextBytes })
      },
      openDecision: async (entityId, id, wakeId) => {
        assertActorAdmission(entityId)
        const writer = writers.get(entityId)
        if (writer === undefined) throw new Error('Simulation entity has no live decision authority')
        if (!Object.hasOwn(run.snapshot().decisions, id)) {
          await this.deliveryAuthority.restorePending(run, entityId, teamId, canPublish)
        }
        return await writer.openDecision(id, run.snapshot().revision, wakeId)
      },
      submitDecision: async (entityId, id, proposals) => {
        assertActorAdmission(entityId)
        const writer = writers.get(entityId)
        if (writer === undefined) throw new Error('Simulation entity has no live decision authority')
        return await writer.submitDecision(id, proposals)
      },
      bind: async (entityId, participantId) => {
        assertAdmitted()
        const entity = requireEntity(run, entityId)
        if (entity.binding !== undefined) {
          if (entity.binding.teamId !== teamId || entity.binding.participantId !== participantId) throw new Error('Simulation entity binding is permanent')
          return structuredClone(entity.binding)
        }
        const latest = await this.ctx.teams.getTeam({ teamId })
        const participant = latest.participants.find(value => value.id === participantId)
        if (participant?.kind !== 'local-agent' || participant.phase !== 'active'
          || latest.activations.some(value => value.activation.participantId === participantId)) {
          throw new Error('Simulation binding requires a fresh active local participant')
        }
        assertAdmitted()
        const binding = entity.participantReservation?.binding ?? { teamId, participantId, sessionId: SessionId(randomUUID()) }
        if (binding.participantId !== participantId) throw new Error('Simulation participant differs from its reserved identity')
        await run.bindEntity(entityId, binding, run.snapshot().revision)
        return binding
      },
      activate: async (entityId, request) => {
        assertActorAdmission(entityId)
        if (run.snapshot().activationAdmissionBlocks?.some(value => value.entityId === entityId)) {
          throw new Error('Simulation Activation history requires original startup reconciliation and a new scenario')
        }
        const binding = requireEntity(run, entityId).binding
        if (binding === undefined) throw new Error('Simulation entity has no cognition binding')
        runtime(request.provider)
        const work = (async () => {
          const latest = await this.ctx.teams.getTeam({ teamId })
          assertAdmitted()
          try { return await this.ctx.teamActivations.activate({ ...request, ...binding, expectedCursor: latest.team.cursor }) }
          catch (error) {
            const details = activationHistoryLimitDetails(error)
            if (details !== undefined && details.cleanup !== 'pending') {
              const current = await this.ctx.teams.getTeam({ teamId })
              const participant = current.participants.find(value => value.id === binding.participantId)
              const reservation = participant?.activationReservation
              if (details.teamId !== binding.teamId || details.participantId !== binding.participantId
                || details.sessionId !== binding.sessionId || details.reservationId === undefined
                || current.activations.length < details.used
                || current.activations.some(value => value.activation.id === details.activationId)
                || reservation?.id !== details.reservationId || reservation.sessionId !== binding.sessionId
                || (details.cleanup === 'confirmed' ? reservation.releasedAt === undefined : reservation.releasedAt !== undefined)) {
                throw new Error('Simulation Activation refusal lost its exact Team startup/cleanup evidence', { cause: error })
              }
              await run.recordActivationAdmissionBlock({ entityId, details })
            }
            throw error
          }
        })()
        activations.add(work)
        void work.then(() => activations.delete(work), () => activations.delete(work))
        return await work
      },
      recover: (entityId) => {
        const work = recoverEntity(entityId, assertAdmitted)
        recoveries.add(work)
        void work.then(() => { recoveries.delete(work) }, () => { recoveries.delete(work) })
        return work
      },
      close: () => {
        admitted = false
        checkpointRelease?.()
        admissionAbort.abort(new Error('Simulation connection is closed'))
        // Cancel turns before waiting, but keep their Sessions live through the final persistence barrier.
        for (const actor of modelDecisions.values()) actor.cancel({ kind: 'hook', reason: 'Simulation connection is closed' })
        closed ??= Promise.all([Promise.allSettled(checkpointWork === undefined ? [] : [checkpointWork]),
          Promise.allSettled([...checkpointRequests.values()].map(value => value.work)),
          Promise.allSettled([...maintenanceWork.values()].map(value => value.work)),
          Promise.allSettled([...worldCleanupWork.values()]),
          Promise.allSettled([...externalCleanupWork.values()]),
          Promise.allSettled([...contactCleanupWork.values()]),
          this.participants.drain(run), this.channels.drain(run),
          this.invitationAuthority.drain(run), deadlines.close(),
          Promise.allSettled([...generations.values()]),
          Promise.allSettled([...summaries]),
          Promise.allSettled([...personnelReads]),
          Promise.allSettled([...personnelSettlements]),
          Promise.allSettled([...[...taskCompletions.values()].map(value => value.work),
            ...taskDecisions, ...taskAssignments, ...taskReconciliations, ...taskReviews, ...taskCancellations]),
          Promise.allSettled([...modelDecisions.keys()]),
          Promise.allSettled([...receiving.values(), ...deliveryReconciliations, ...recoveries]),
          Promise.allSettled([...sleeping.values()].flatMap(value => value.work === undefined ? [] : [value.work])),
          Promise.allSettled([...dispatches]),
          Promise.allSettled([...inputs.values()].map(value => value.work)),
          Promise.allSettled([...deterministicRuns.values()].map(value => value.work)),
          Promise.allSettled([...placements.values(), ...activations, ...residentDrive === undefined ? [] : [residentDrive],
            ...driving === undefined ? [] : [driving.work]])])
          .then(() => unregister()).then(() => {
            removePersonnelAuthority?.()
            removeRetirement?.()
            removeWorldCleanup?.()
            removeExternalCleanup?.()
            removeContactCleanup?.()
            removeToolGuard(); removePreStep(); removeRequestCap()
            removeStream()
            this.attached.delete(run)
          }).catch((error: unknown) => { closed = undefined; throw error })
        return closed
      },
    }
    try {
      if (run.snapshot().teamReservation?.confirmed === true) {
        removeWorldCleanup = run.onWorldHireCleanup(ownerName, (reservation) => {
          assertAdmitted()
          const existing = worldCleanupWork.get(reservation.id)
          if (existing !== undefined) return existing
          const work = cleanupWorldHire(this.ctx, run, reservation, teamId, ownerName,
            this.participants, this.channels, this.invitationAuthority, assertAdmitted)
          worldCleanupWork.set(reservation.id, work)
          void work.then(() => { worldCleanupWork.delete(reservation.id) }, () => { worldCleanupWork.delete(reservation.id) })
          return work
        })
        removeExternalCleanup = run.onExternalRepresentativeCleanup(ownerName, (reservation) => {
          assertAdmitted()
          const existing = externalCleanupWork.get(reservation.id)
          if (existing !== undefined) return existing
          const work = cleanupExternalRepresentative(this.ctx, run, reservation, teamId, ownerName,
            this.participants, this.channels, this.invitationAuthority, assertAdmitted)
          externalCleanupWork.set(reservation.id, work)
          void work.then(() => { externalCleanupWork.delete(reservation.id) }, () => { externalCleanupWork.delete(reservation.id) })
          return work
        })
        removeContactCleanup = run.onExternalContactCleanup(ownerName, (contact) => {
          assertAdmitted()
          const existing = contactCleanupWork.get(contact.id)
          if (existing !== undefined) return existing
          const work = cleanupExternalContact(this.ctx, run, contact, teamId, ownerName,
            this.channels, this.invitationAuthority, assertAdmitted)
          contactCleanupWork.set(contact.id, work)
          void work.then(() => { contactCleanupWork.delete(contact.id) }, () => { contactCleanupWork.delete(contact.id) })
          return work
        })
      }
      removeRetirement = run.onClose(() => connection.close())
    } catch (error) {
      removeWorldCleanup?.()
      removeExternalCleanup?.()
      removeContactCleanup?.()
      removeToolGuard(); removePreStep(); removeRequestCap(); removeStream(); await unregister(); throw error
    }
    this.attached.set(run, connection)
    this.ctx.effect(() => () => connection.close())
    return connection
  }
  private assertOpen(): void { if (this.closing) throw new Error('Simulation Team service is closed') }
}

function requireEntity(run: SimulationRun, id: SimulationEntityId): SimulationEntity {
  const entity = run.inspectEntity(id).entity
  if (entity === undefined) throw new Error('Simulation entity does not exist')
  return entity
}
function activationFacts(binding: ActivationBindingSnapshot): SimulationWriterActivation {
  if (binding.reservationId === undefined) throw new Error('Simulation activation has no durable startup reservation')
  return { teamId: binding.activation.teamId, participantId: binding.activation.participantId,
    sessionId: binding.sessionId, activationId: binding.activation.id,
    reservationId: binding.reservationId, provider: binding.provider }
}
function coordination(writer: SimulationWriterLease, provider?: AgentRuntimeProvider,
  afterRelease?: () => Promise<void>): TeamActivationCoordinationLease {
  return {
    ...provider === undefined ? {} : { runtimeProvider: provider },
    localTerminationConfirmed: writer.priorCoordinatorExited,
    bind: async (binding, agent) => {
      if (agent === undefined || agent.session.id !== binding.sessionId
        || agent.session.header.teamId !== binding.activation.teamId
        || agent.session.header.participantId !== binding.activation.participantId) {
        throw new Error('Simulation writer requires its exact controller-owned local Agent')
      }
      await writer.activate(activationFacts(binding))
    },
    revoke: () => writer.revoke(), release: async () => { await writer.release(); await afterRelease?.() },
  }
}
export default SimulationTeams

export { captureWorldArchive, verifyWorldArchive, publishWorldArchive, readWorldArchive, importArchiveLogs, importArchiveSessions, restoreWorldArchive, planWorldArchive } from './archive.ts'
export type { WorldArchiveBody, WorldArchiveRestoreTarget } from './archive.ts'

export { worldBackupManifestSchema, worldMigrationPlanSchema, createWorldBackup, verifyWorldBackup, publishWorldBackup, readWorldBackup, restoreWorldBackup, planWorldBackupMigration, migrateWorldBackup } from './backup.ts'
export type { WorldBackupManifest, WorldBackupBundle, WorldMigrationPlan } from './backup.ts'

export { worldExperimentBranchSchema, createWorldExperimentBranch, preflightWorldExperimentBranch, mergeWorldExperimentBranches } from './experiments.ts'
export type { WorldExperimentBranch } from './experiments.ts'
export { worldCausalQuerySchema, worldCausalIndexSchema, buildWorldCausalIndex, queryWorldCausalIndex, compareWorldExperiments } from './experiment-query.ts'
export type { WorldCausalIndex, WorldExperimentComparison } from './experiment-query.ts'

export type { WorldExternalArchiveSource, WorldExternalArchiveProvider, WorldExternalArchiveProviders } from './external-archive.ts'

export { migrateWorldNative101, publishWorldNative101 } from './native-migration.ts'
export type { WorldNativeMigrationValidators, WorldNativeMigrationResult } from './native-migration.ts'
