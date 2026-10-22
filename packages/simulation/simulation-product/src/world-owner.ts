import { StopCheckpointScheduler } from './stop-checkpoint.ts'
import { SimulationRevisionConflictError, SimulationStopBoundaryError } from '@clocky/clocky-simulation'
/** One World product-held run owns explicit scheduling intent and independently drainable structural work. */
import { randomUUID } from 'node:crypto'
import { simulationProductFailure } from './failure.ts'
import { tokenControlDiagnostics } from './token-diagnostics.ts'
import { simulationChangeSchema, simulationGenerationJobSchema, activePlannerAncestors, generationRecordAt } from '@clocky/clocky-simulation'
import { observeModelPool } from './model-pool.ts'
import type { Context } from '@clocky/cordis'
import type { SimulationProductOperationRetryInput, SimulationProductOperationRetryCapability } from './operation-retry-types.ts'
import { simulationOutboxRetryRequestSchema, simulationOutboxRetryCapability } from '@clocky/clocky-simulation'
import { isDeepStrictEqual } from 'node:util'
import { simulationPhaseManagementRequestSchema, activeSimulationMaintenance } from '@clocky/clocky-simulation'
import type { SimulationRun, SimulationSnapshot, SimulationManagementOperation, SimulationCheckpointRequest, SimulationCheckpointOperation, SimulationIngressRequest, SimulationIngress } from '@clocky/clocky-simulation'
import type { SimulationTeamConnection, SimulationTeams } from '@clocky/clocky-simulation-team'
import { SimulationWorldDriver } from '@clocky/clocky-simulation-world'
import type { SimulationWorldDriveResult } from '@clocky/clocky-simulation-world'
import type { SimulationWorldPreparation } from './world-preparation.ts'
import type { SimulationWorldCreation } from './world-creation.ts'
import type { SimulationProductManageInput, SimulationProductControl, SimulationProductControlReason } from './control-types.ts'
import { managementAt } from './management-read.ts'
import { SimulationProductError } from './index.ts'
import type { SimulationProductWorldCaseCancelInput } from './case-cancel-types.ts'
import type { SimulationWorldManagementSubmitRequest, SimulationWorldManagementAuthority,
  SimulationWorldManagementReceipt } from '@clocky/clocky-simulation/world-management-types'

interface Options {
  readonly executionScope: Pick<Context, 'effect' | 'get'>
  readonly intervalMs: number
  readonly retryMs: number
  readonly maxManagementRequests: number
  readonly maxIngressRequests: number
  readonly executionAvailable: (state: import('@clocky/clocky-simulation').SimulationControlObservation) => boolean
  readonly sharedModelLimit: () => number
  readonly modelUsage?: (() => ReturnType<SimulationTeams['modelUsage']>) | undefined
}

/** A single administration-owned scheduler; construction and observation never attach or infer. */
export class SimulationWorldOwner {
  private readonly lifetime = new AbortController()
  private readonly stopCheckpoint = new StopCheckpointScheduler()
  private connection: SimulationTeamConnection | undefined
  private driver: SimulationWorldDriver | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private pending: Promise<void> | undefined
  private recovery: Promise<void> | undefined
  private cancellation: { readonly admission: Promise<import('@clocky/clocky-simulation/world-types').SimulationWorldCancellation>
    readonly completion: Promise<void> } | undefined
  private targeted: Promise<void> | undefined
  private managementTail: Promise<unknown> = Promise.resolve()
  private last: SimulationWorldDriveResult | undefined
  private failed = false
  private readonly ownerId = randomUUID()
  private failure: import('./control-types.ts').SimulationProductFailure | undefined
  private maintenance = false
  private closing = false
  private closeWork: Promise<void> | undefined

  /**
   * @param run - Exclusively held prepared native run; ownership stays with the administration service.
   * @param teams - Canonical connection provider; attachment requires an authorized start, recovery or original targeted command.
   * @param creation - Original immutable World definition and per-actor runtime routes.
   * @param preparation - Exact completed preparation anchor; a later attempt retains its distinct checkpoint.
   * @param options - Validated cadence, retry delay and retained native management allowance.
   */
  constructor(private readonly run: SimulationRun, private readonly teams: Pick<SimulationTeams, 'attach'>,
    private readonly creation: Pick<SimulationWorldCreation, 'record' | 'preparation'>, private preparation: SimulationWorldPreparation,
    private readonly options: Options) {}

  /**
   * Capture an already checkpointed paused source without pausing, retiring or running a model.
   * @param limits - Host-resolved aggregate archive budgets.
   * @param authorize - Current human owner authority, rechecked around all awaited IO.
   * @returns complete immutable archive body from the original owner closure.
   */
  captureRetention(limits: { maxEntries: number; maxBytes: number; pageSize: number }, authorize: () => void):
  Promise<import('@clocky/clocky-simulation-team').WorldArchiveBody> {
    const work = this.managementTail.then(async () => {
      authorize()
      const state = this.run.snapshot()
      if (this.closing || this.pending !== undefined || this.targeted !== undefined || this.maintenance
        || state.phase !== 'paused' || state.latestCheckpointId === undefined || state.activeWindowId !== undefined
        || state.activeDecisionId !== undefined || Object.values(state.entities).some(entity => entity.writer !== undefined && entity.writer.phase !== 'released'))
        throw unavailable('Retention preview requires an explicitly checkpointed paused quiescent owner')
      if (this.connection === undefined) await this.attach()
      if (this.connection === undefined) throw unavailable('Retention preview lost its original connection')
      authorize()
      const collection = await this.connection.collectCheckpointCandidate(this.preparation.checkpoint.maxDrainRounds,
        this.preparation.checkpoint.maxAttempts, this.lifetime.signal, 'quiescent')
      try {
        const body = await collection.exportArchive(limits)
        authorize()
        if (this.run.snapshot().revision !== state.revision) throw unavailable('Retention preview source moved')
        return body
      } finally { collection.release() }
    })
    this.managementTail = work.then(() => {}, () => {})
    return work
  }

  /**
   * Prepare a dedicated helper under the frozen scenario runtime, then retain its original authorized input.
   * @param request - Host-stamped user-authored job, with fixed organization scope and audience.
   * @param authorize - Live human ownership/disclosure check, repeated before each canonical IO.
   * @returns original Native acceptance; identity preparation is retryable and never runs inference.
   */
  requestGeneration(request: import('@clocky/clocky-simulation').SimulationGenerationJob,
    authorize: (job: import('@clocky/clocky-simulation').SimulationGenerationJob) => void):
  Promise<import('@clocky/clocky-simulation').SimulationGenerationRecord> {
    const job = simulationGenerationJobSchema.parse(request)
    const work = this.managementTail.then(async () => {
      authorize(structuredClone(job))
      const original = generationRecordAt(this.run.snapshot(), job.id)
      if (original !== undefined) return await this.run.transitionGeneration({ kind: 'accept', job }, authorize)
      if (this.closing || this.pending !== undefined || this.targeted !== undefined || this.run.snapshot().phase !== 'paused')
        throw unavailable('Generation helper preparation requires a paused drained owner')
      if (job.planner !== undefined) activePlannerAncestors(this.run.snapshot(), job.planner)
      const usage = this.run.budgetUsage().tokens
      if (BigInt(job.deadline) <= BigInt(this.run.snapshot().time) || BigInt(job.deadline) > BigInt(this.run.snapshot().spec.maxTime)
        || job.budget.maxTokens > usage.limit - usage.used) throw unavailable('Generation deadline or shared budget is unavailable')
      const runtime = this.creation.preparation.resolved.generatedActorRuntime
      if (job.model.provider !== runtime.model.provider || job.model.name !== runtime.model.name
        || job.model.version !== runtime.model.version)
        throw unavailable('Generation requires the original scenario model runtime')
      if (this.creation.preparation.resolved.actors.some(actor => actor.entityId === job.assistantEntityId))
        throw unavailable('Generation cannot reuse a scenario actor or director')
      const profile = { generationAssistant: { scope: job.scope, audience: job.audience } }
      const existing = this.run.snapshot().entities[job.assistantEntityId]
      if (existing !== undefined && (existing.kind !== 'generation-assistant' || !isDeepStrictEqual(existing.profile, profile))) throw unavailable('Generation helper identity belongs to another purpose')
      if (existing === undefined) await this.run.change(simulationChangeSchema.parse({ kind: 'entity/create', id: job.assistantEntityId,
        entityKind: 'generation-assistant', cognition: 'agent', readiness: 'ready', profile }), this.run.snapshot().revision)
      authorize(structuredClone(job))
      if (this.connection === undefined) await this.attach()
      const connection = this.connection
      if (connection === undefined) throw unavailable('Generation lost its canonical connection')
      const binding = await connection.ensureParticipant(job.assistantEntityId, { displayName: 'Generation helper', role: 'member',
        capabilities: [], provider: runtime.provider, preset: runtime.preset, model: `${runtime.model.provider}/${runtime.model.name}` })
      authorize(structuredClone(job))
      await this.generationSession(binding)
      return await this.run.transitionGeneration({ kind: 'accept', job }, authorize)
    })
    this.managementTail = work.then(() => {}, () => {})
    return work
  }

  /**
   * Explicitly run or reconcile an accepted helper; reads and review transitions never call this method.
   * @param jobId - Original Native generation identity.
   * @param authorize - Live disclosure authority through admission and output validation.
   * @param signal - Authenticated request lifetime combined with owner shutdown.
   * @returns original output or retained unknown responsibility; no implicit regeneration.
   */
  async executeGeneration(jobId: string, authorize: (job: import('@clocky/clocky-simulation').SimulationGenerationJob) => void,
    signal: AbortSignal): Promise<import('@clocky/clocky-simulation').SimulationGenerationRecord> {
    if (this.closing) throw unavailable('Generation owner is retiring')
    const job = generationRecordAt(this.run.snapshot(), jobId)
    if (job === undefined) throw unavailable('Original generation job is unavailable')
    authorize(structuredClone(job.job))
    const prepared = this.managementTail.then(async () => {
      if (this.closing) throw unavailable('Generation owner is retiring')
      if (this.connection === undefined) await this.attach()
      const binding = this.run.snapshot().entities[job.job.assistantEntityId]?.binding
      if (binding === undefined) throw unavailable('Generation lost its original canonical identity')
      await this.generationSession(binding)
      authorize(structuredClone(job.job))
    })
    this.managementTail = prepared.then(() => {}, () => {})
    await prepared
    const connection = this.connection
    if (connection === undefined) throw unavailable('Generation lost its canonical connection')
    return await connection.generate(jobId, authorize, AbortSignal.any([signal, this.lifetime.signal]))
  }

  private async generationSession(binding: import('@clocky/clocky-simulation').SimulationEntityBinding): Promise<void> {
    const sessions = this.options.executionScope.get('sessions'), persistence = this.options.executionScope.get('sessionPersistence')
    if (sessions === undefined || persistence === undefined) throw unavailable('Generation Session persistence is unavailable')
    if (sessions.get(binding.sessionId) !== undefined) return
    if (await persistence.isUnmaterialized(binding.sessionId)) {
      const session = sessions.create(binding.sessionId, { meta: { teamId: binding.teamId, participantId: binding.participantId } })
      await persistence.materializeHeader(session)
    } else {
      const stored = await persistence.readFrom(binding.sessionId, 0)
      const session = sessions.prepare(binding.sessionId, { seed: structuredClone(stored.events), meta: structuredClone(stored.meta), seedSource: 'persistence' })
      this.options.executionScope.effect(() => sessions.enter(session))
      sessions.announce(session)
    }
  }

  /** Retain the exact authenticated command before its separate execution request.
   * @param request - Original Native replacement.
   * @param revision - Exact quoted Native prefix.
   * @param hash - Original quote commitment.
   * @param principalId - Authenticated command author.
   * @returns durable original intent, including after a lost retention acknowledgement.
   */
  retainCalendar(request: Parameters<SimulationRun['retainWorldCalendarCommand']>[0], revision: number, hash: string,
    principalId: string): ReturnType<SimulationRun['retainWorldCalendarCommand']> {
    return this.run.retainWorldCalendarCommand(request, revision, hash, principalId)
  }

  /** Cancel only a retained, unexecuted original without undoing an accepted calendar edit.
   * @param commandId - Original command identity.
   * @param principalId - Actual original author.
   * @returns authoritative Native outcome after cancellation or a raced application.
   */
  cancelCalendar(commandId: string, principalId: string): Promise<SimulationSnapshot> {
    return this.run.cancelWorldCalendarCommand(commandId, principalId)
  }

  /** Validate a paused calendar edit without acquiring a new execution owner or appending records.
   * @param request - Exact finite replacement and original command identity.
   * @returns inert Native affected-event quote.
   */
  previewCalendar(request: Parameters<SimulationRun['previewWorldCalendar']>[0]): ReturnType<SimulationRun['previewWorldCalendar']> {
    return this.run.previewWorldCalendar(request)
  }

  /** Commit the exact quoted calendar edit through the original serialized Native writer.
   * @param request - Complete original replacement command.
   * @param revision - Native prefix retained by the original quote.
   * @param principalId - Actual authenticated Host principal.
   * @returns authoritative snapshot after the original acceptance or exact retry.
   */
  reviseCalendar(request: Parameters<SimulationRun['reviseWorldCalendar']>[0], revision: number, principalId: string): Promise<SimulationSnapshot> {
    return this.run.reviseWorldCalendar(request, revision, principalId)
  }

  /**
   * Admit one real user command, durably pause scheduling, then execute only its retained direct plan.
   * @param request - Complete original Native command and confirmed preview; no replacement plan is generated.
   * @param authority - Live trusted caller and canonical source fence, rechecked in the Native admission queue.
   * @param authorize - Current product ownership and authentication at the short management admission boundary.
   * @param complete - Settle the original product receipt only after business outcome and callback responsibility are known.
   * @returns short Native admission acknowledgement and separately owned completion; provider IO outlives the caller.
   */
  manageWorld(request: SimulationWorldManagementSubmitRequest, authority: SimulationWorldManagementAuthority,
    authorize: () => void, complete: () => Promise<void>): {
    /** Current-call Native acceptance or refusal, before provider IO is awaited. */
    readonly admission: Promise<SimulationWorldManagementReceipt>
    /** Owned provider settlement independent of the carrier after Native acceptance. */
    readonly completion: Promise<void>
  } {
    if (this.targeted !== undefined) throw unavailable('World user management already has admitted work')
    const admission = this.managementTail.then(async () => {
      if (this.closing || this.maintenance) throw unavailable('World management owner is retiring or checkpointing')
      authorize()
      const pause = simulationPhaseManagementRequestSchema.parse({ id: JSON.stringify(['world-management-pause', request.commandId]),
        phase: 'paused' })
      const state = this.run.snapshot()
      if (state.phase !== 'paused' && managementAt(state, pause.id) === undefined
        && Object.keys(state.management ?? {}).length >= this.options.maxManagementRequests)
        throw unavailable('World retained management history cannot admit its required pause')
      const original = await this.run.submitWorldManagement(request, authority)
      this.clearTimer()
      if (this.run.snapshot().phase !== 'paused') await this.run.managePhase(pause)
      return original
    })
    // Newer pause requests can linearize while this command's original provider IO drains.
    this.managementTail = admission.then(() => {}, () => {})
    const work = admission.then(async (original) => {
      await this.driver?.drain()
      await this.pending
      if (this.closing) throw unavailable('World user management retains its original accepted request during retirement')
      if (this.connection === undefined) await this.attach()
      if (this.driver === undefined) throw unavailable('World user management has no original execution provider')
      this.last = await this.driver.executeManagement(original.planId)
      const observed = this.run.inspectWorldManagement(request.commandId, original.principalId)
      const uncertain = observed?.execution?.phase === 'armed' || observed?.execution?.phase === 'outcome-unknown'
      if (observed?.result !== undefined && !uncertain) await complete()
    }).finally(() => {
      if (this.targeted === work) this.targeted = undefined
      this.synchronize()
    })
    this.targeted = work
    return { admission, completion: work }
  }

  /**
   * Reconcile already-retained structural IO after explicit restore, without inference or scheduling.
   * @returns completion after original maintenance settles; pause remains available and retirement drains this operation.
   */
  recover(): Promise<void> {
    if (this.recovery !== undefined) return this.recovery
    const work = (async () => {
      if (this.closing) throw unavailable('World recovery owner is retiring')
      const state = this.run.snapshot()
      if (activeSimulationMaintenance(state) === undefined && !unconfirmedExecution(state)) return
      if (state.phase !== 'paused') throw unavailable('World execution recovery requires an explicitly paused run')
      if (this.connection === undefined) await this.attach()
      const result = await this.driver?.reconcile()
      if (result?.reason !== 'paused' && result?.reason !== 'idle') throw unavailable('World structural recovery remains blocked')
      if (unconfirmedExecution(this.run.snapshot())) throw unavailable('World callback confirmation remains unresolved')
    })().finally(() => { this.recovery = undefined })
    this.recovery = work
    return work
  }

  /**
   * Observe intent, in-flight work and actual prerequisites without allocating a connection.
   * @returns separate scheduling/driver observations and current action hints; hints are rechecked before writes.
   */
  observe(): Omit<SimulationProductControl, 'administration'> & { readonly unstarted: boolean } {
    const state = this.run.controlObservation(this.preparation.checkpoint.id)
    const reason = this.startReason(state)
    const submissionFailure = state.submissionFailure
    const submissionStop = submissionFailure?.code === 'SIM_WORLD_AUTHORITY' ? 'authority-missing'
      : submissionFailure?.code === 'SIM_WORLD_LIMIT' ? ({ bytes: 'world-byte-limit', requests: 'world-request-limit', plans: 'plan-budget' } as const)[
        submissionFailure.limit] : undefined
    const messageBytes = state.messageByteBlocked
    const unknownOutcome = state.unconfirmedWorldExecutions !== 0 || state.unknownOperations
    const diagnostics = tokenControlDiagnostics(state, true, this.pending !== undefined || this.targeted !== undefined || this.maintenance
      || this.recovery !== undefined || this.cancellation !== undefined || this.closing)
    const terminalStop = state.stall?.code === 'SIM_MESSAGE_SUBMISSION_BLOCKED' ? 'message-rejected'
      : state.stall?.code === 'SIM_CONTEXT_INTEGRITY' ? 'context-integrity'
        : state.stall?.code === 'SIM_DECISION_TIMEOUT' ? 'decision-timeout' : undefined
    const stop = terminalStop ?? (diagnostics.tokenRecovery === undefined ? undefined : 'token-overrun')
      ?? (diagnostics.requestBudget === undefined ? undefined : 'request-budget') ?? submissionStop ?? (messageBytes ? 'message-byte-limit' : undefined)
      ?? (unknownOutcome ? 'outcome-unknown' : undefined) ?? this.last?.reason ?? (state.stall?.code === 'SIM_ACTIVATION_HISTORY_LIMIT'
      ? state.activationHistory !== 'recovery-required' ? 'activation-history-limit' : 'recovery-required'
      : state.stall?.code === 'SIM_BUDGET_LIMIT' ? 'budget-limit'
        : state.stall?.code === 'SIM_CONTEXT_REQUIRED_ITEM_OVERFLOW' ? 'context-limit'
          : state.stall?.code === 'SIM_MICROSTEP_LIMIT' ? 'microstep-limit'
            : state.stall?.code === 'SIM_MODEL_POOL_CAPACITY' || state.stall?.code === 'SIM_COMPACTION_MODEL_POOL_CAPACITY'
              ? 'model-pool-capacity' : state.stall === undefined || state.stall.code === 'SIM_TOKEN_RESERVATION_EXCEEDED'
                && state.tokenStallAcknowledged ? undefined : 'stalled')
    return { ...diagnostics, modelPool: observeModelPool(this.options.modelUsage), unstarted: this.connection === undefined,
      runId: this.creation.record.id, budget: { model: this.model(),
        tokensPerRequest: state.budget.tokensPerModelRequest, tokensPerInterval: state.budget.maxTokensPerInterval,
        interval: state.budget.budgetInterval, residentActors: state.budget.maxResidentActors, sharedModelLimit: this.options.sharedModelLimit() }, owner: 'held', phase: state.phase, revision: state.revision, observedAt: Date.now(),
      driver: this.closing ? 'retiring' : this.maintenance ? 'checkpointing' : this.failed ? 'failed'
        : this.pending !== undefined || this.targeted !== undefined ? 'advancing'
          : this.timer !== undefined ? 'scheduled' : this.last?.reason === 'idle' ? 'idle'
            : this.last !== undefined && this.last.reason !== 'paused' ? 'waiting' : 'idle',
      ...state.stopTarget === undefined ? {} : { stopTarget: state.stopTarget },
      driverSource: { status: 'live', observedAt: state.driverObservation?.ownerId === this.ownerId
        ? state.driverObservation.observedAt : Date.now(),
      ...state.driverObservation?.ownerId !== this.ownerId ? {} : { revision: state.driverObservation.revision } },
      ...this.failure === undefined ? {} : { failure: this.failure },
      inFlight: this.pending !== undefined || this.targeted !== undefined || this.maintenance
        || this.recovery !== undefined || this.cancellation !== undefined,
      ...stop === undefined ? {} : { stop },
      ...this.last?.nextAttemptAt === undefined ? {} : { nextAttemptAt: this.last.nextAttemptAt },
      actions: { start: { allowed: reason === 'ready', reason }, pause: { allowed: !this.closing && !this.maintenance,
        reason: this.closing ? 'retiring' : this.maintenance ? 'checkpoint-in-progress' : 'ready' } } }
  }

  /**
   * Persist an authenticated stop update without waiting for an admitted model turn to drain.
   * @param request - Retained original identity and complete target, or explicit null clear.
   * @param authorize - Rechecked at the Native queue boundary; never inferred from an earlier observation.
   * @returns original durable receipt; pending activation does not claim external work has stopped.
   */
  updateRunControl(request: import('./control-types.ts').SimulationProductRunControlInput, authorize: () => void):
  Promise<import('@clocky/clocky-simulation').SimulationRunControlReceipt> {
    const work = this.managementTail.then(async () => {
      if (this.closing) throw unavailable('Simulation scheduling owner is retiring')
      authorize()
      const command = { commandId: request.commandId, target: request.target }
      const prior = this.run.runControlCommandObservation(request.commandId)
      if (prior !== undefined && !isDeepStrictEqual(prior.command, command))
        throw invalid('Stop control command identity has another original target')
      const maxRetries = this.run.controlObservation().budget.maxConflictRetries
      for (let attempt = 0; ; attempt++) {
        try {
          const receipt = await this.run.updateRunControl(command, this.run.controlObservation().revision, authorize)
          if (prior === undefined) this.synchronize()
          return receipt
        } catch (cause: unknown) {
          if (cause instanceof SimulationRevisionConflictError && attempt < maxRetries) continue
          if (cause instanceof SimulationStopBoundaryError) { this.synchronize(); throw invalid(cause.message) }
          throw cause
        }
      }
    })
    this.managementTail = work.then(() => {}, () => {})
    return work
  }

  /**
   * Serialize one scheduling intent independently of accepted inference, allowing pause during a model request.
   * @param request - Exact original scheduling identity and phase.
   * @param authorize - Current transport authentication and output allowance check at the queue position before native IO.
   * @returns original native result; terminal retries never schedule another batch or undo later phase changes.
   */
  manage(request: SimulationProductManageInput, authorize: () => void): Promise<SimulationManagementOperation> {
    const work = this.managementTail.then(async () => {
      if (this.closing) throw unavailable('Simulation scheduling owner is retiring')
      authorize()
      const input = simulationPhaseManagementRequestSchema.parse({ id: request.managementId, phase: request.phase,
        ...request.tokenRecovery === undefined ? {} : { tokenRecovery: request.tokenRecovery } })
      const state = this.run.controlObservation(this.preparation.checkpoint.id)
      const prior = this.run.managementObservation(input.id)
      if (prior !== undefined) {
        if (!isDeepStrictEqual(prior.request, input)) throw invalid('Simulation management identity has another original phase')
        if (prior.status !== 'in-progress') return prior
      } else {
        if (state.managementCount >= this.options.maxManagementRequests) {
          throw unavailable('Simulation retained management capacity is occupied')
        }
        if (request.phase === 'running') {
          const reason = this.startReason(this.run.controlObservation(this.preparation.checkpoint.id))
          if (reason !== 'ready') throw unavailable(`Simulation scheduling cannot start: ${reason}`)
        }
      }
      if (request.tokenRecovery !== undefined && (this.pending !== undefined || this.targeted !== undefined || this.maintenance
        || this.recovery !== undefined || this.cancellation !== undefined)) throw unavailable('Token recovery requires settled work')
      if (request.phase === 'running' && this.connection === undefined) await this.attach()
      authorize()
      try {
        const operation = await this.run.managePhase(input)
        if (operation.status === 'completed') {
          if (request.phase === 'running' || request.tokenRecovery !== undefined) { this.last = undefined; this.failed = false }
          this.synchronize()
        }
        return operation
      } finally {
        // A committed running phase owns scheduling even when only its response or post-append housekeeping fails.
        if (this.run.managementObservation(input.id)?.status === 'completed') this.synchronize()
      }
    })
    this.managementTail = work.then(() => {}, () => {})
    return work
  }

  /**
   * Serialize explicit unstarted preparation with management and update only its completed checkpoint anchor.
   * @param settings - Exact validated preparation checkpoint and immutable topology.
   * @param operation - Existing preparation owner; failure retains its original terminal checkpoint and anchor.
   * @returns completion after the temporary connection drains; an attached scheduling owner cannot be replaced.
   */
  prepare(settings: SimulationWorldPreparation, operation: () => Promise<unknown>): Promise<void> {
    const work = this.managementTail.then(async () => {
      if (this.closing || this.connection !== undefined) throw unavailable('Simulation preparation requires an unstarted owner')
      await operation()
      this.preparation = { ...settings, ownerName: this.preparation.ownerName }
    })
    this.managementTail = work.then(() => {}, () => {})
    return work
  }

  /**
   * Pause, retire supported work and publish one complete native checkpoint without automatically resuming.
   * @param request - Original Host-derived checkpoint identity and retained collector policy.
   * @param expectedStopCommand - Automatic saves recheck this original target at their queued admission.
   * @returns original checkpoint result; failed collection preserves the previous successful anchor.
   */
  checkpoint(request: SimulationCheckpointRequest, expectedStopCommand?: string): Promise<SimulationCheckpointOperation> {
    const work = this.managementTail.then(async () => {
      if (this.closing) throw unavailable('Simulation scheduling owner is retiring')
      if (this.targeted !== undefined) throw unavailable('World management must settle before checkpoint collection')
      if (expectedStopCommand !== undefined) {
        const stop = this.run.controlObservation().stopTarget
        if (stop?.commandId !== expectedStopCommand || stop.state !== 'paused' || stop.checkpoint !== 'pending')
          throw unavailable('Automatic stop checkpoint target changed before collection')
      }
      if (expectedStopCommand === undefined) {
        const stop = this.run.controlObservation().stopTarget
        if (stop?.state === 'paused' && stop.checkpoint === 'failed' && stop.checkpointId !== null
          && stop.checkpointId !== request.id) {
          await this.run.retryRunControlCheckpoint(stop.commandId, stop.checkpointId, request.id)
        }
      }
      this.maintenance = true
      this.clearTimer()
      try {
        if (this.connection === undefined) await this.attach()
        const connection = this.connection
        /* v8 ignore next -- successful attach installs the canonical connection before collection. */
        if (connection === undefined) throw unavailable('Simulation checkpoint has no canonical connection')
        const result = await connection.checkpoint(request)
        await this.driver?.drain()
        await this.pending
        const stop = this.run.snapshot().runControl?.current
        if (stop?.target?.checkpointPolicy === 'request' && stop.cut !== null && stop.state === 'paused'
          && (stop.checkpoint === 'pending' || stop.checkpointId === request.id)) {
          const status = result.status === 'completed'
            ? this.run.controlObservation().checkpointCoverage === 'native' ? 'completed' : 'external-state-required'
            : result.status === 'failed' ? 'failed' : undefined
          if (status !== undefined) await this.run.recordRunControlCheckpoint(stop.commandId, request.id, status)
        }
        if (result.status === 'completed') {
          await connection.close()
          this.connection = undefined
          this.driver = undefined
          this.preparation = { ...this.preparation, checkpoint: { id: request.id,
            maxDrainRounds: request.maxDrainRounds, maxAttempts: request.maxAttempts } }
          this.failed = false
          this.failure = undefined
          this.last = undefined
        }
        return result
      } finally { this.maintenance = false }
    })
    this.managementTail = work.then(() => {}, () => {})
    return work
  }

  /**
   * Persist attributed input in the same admission queue as management/checkpoint collection.
   * @param request - Authenticated Host attribution and exact original entity/text/time identity.
   * @param authorize - Current authentication, allowed target and complete native input allowance check.
   * @returns the original native receipt; terminal/input retries do not inject or wake again.
   */
  ingest(request: SimulationIngressRequest, authorize: () => void): Promise<SimulationIngress> {
    const work = this.managementTail.then(async () => {
      if (this.closing) throw unavailable('Simulation scheduling owner is retiring')
      authorize()
      const records = this.run.snapshot().ingresses ?? {}
      const prior = Object.hasOwn(records, request.id) ? records[request.id] : undefined
      if (prior !== undefined) {
        if (!isDeepStrictEqual(prior.request, request)) throw invalid('Simulation input identity has another original payload')
        return prior
      }
      if (Object.keys(records).length >= this.options.maxIngressRequests) throw unavailable('Simulation retained input capacity is occupied')
      const result = await this.run.ingest(request)
      this.last = undefined
      this.synchronize()
      return result
    })
    this.managementTail = work.then(() => {}, () => {})
    return work
  }

  /**
   * Observe current retry eligibility without acquiring a connection or changing native state.
   * @param operationId - Original accepted external intent.
   * @returns native count and allowance bound plus owner maintenance admission.
   */
  retryCapability(operationId: import('@clocky/clocky-simulation').SimulationOperationId): SimulationProductOperationRetryCapability {
    const native = simulationOutboxRetryCapability(this.run.snapshot(), operationId)
    return this.closing || this.maintenance ? { ...native, allowed: false, reason: 'maintenance-in-progress' } : native
  }

  /**
   * Grant one original bounded allowance after draining scene work, leaving resume explicit.
   * @param request - Immutable product retry intent.
   * @param acceptedAt - Original durable product acceptance time, reused by all retries.
   * @param authorize - Current caller lease rechecked before queued native IO and around waits.
   * @param complete - Durable original product result publication after native acceptance.
   * @returns completion after the original native grant and product receipt; this never publishes or infers.
   */
  retryOperation(request: SimulationProductOperationRetryInput, acceptedAt: number, authorize: () => void,
    complete: () => Promise<void>): Promise<void> {
    const work = this.managementTail.then(async () => {
      if (this.closing || this.maintenance) throw unavailable('Simulation retry owner is retiring or collecting a checkpoint')
      authorize()
      this.maintenance = true
      this.clearTimer()
      try {
        await this.driver?.drain()
        await this.pending
        authorize()
        const selected = simulationOutboxRetryRequestSchema.parse({
          id: JSON.stringify(['product-operation-retry', request.runId, request.commandId]), operationId: request.operationId,
          expectedAttemptCount: request.expectedAttemptCount, reason: request.reason, authorizedAt: acceptedAt,
        })
        const state = this.run.snapshot()
        const grants = state.operations[request.operationId]?.outbox?.retryAuthorizations ?? {}
        if (!Object.hasOwn(grants, selected.id)) {
          const capability = simulationOutboxRetryCapability(state, request.operationId)
          if (!capability.allowed || capability.expectedAttemptCount !== request.expectedAttemptCount) {
            throw invalid('Simulation retry target changed; refresh its original unknown attempt')
          }
        }
        try { await this.run.retryOutbox(selected, authorize) }
        catch (cause: unknown) {
          throw new Error('Simulation retry acceptance requires original-command reconciliation', { cause })
        }
        await complete()
        this.last = undefined
      } finally { this.maintenance = false; this.synchronize() }
    })
    this.managementTail = work.then(() => {}, () => {})
    return work
  }

  /**
   * Compete with hiring in the Native queue before waiting for identity IO, then settle exact retained cleanup.
   * @param request - Durable original product selector; its command deterministically identifies the Native cancellation.
   * @param authorize - Current caller checked before Native acceptance; accepted cleanup survives a retired transport.
   * @param complete - Publish the original product receipt only after Native has a terminal cancellation outcome.
   * @returns Native cancellation acknowledgement and separate cleanup completion; unknown IO retains its original responsibility.
   */
  cancelCase(request: SimulationProductWorldCaseCancelInput, authorize: () => void, complete: () => Promise<void>): {
    readonly admission: Promise<import('@clocky/clocky-simulation/world-types').SimulationWorldCancellation>
    readonly completion: Promise<void>
  } {
    if (this.cancellation !== undefined) return this.cancellation
    const selected = { id: JSON.stringify(['product-world-cancel', request.runId, request.commandId]) as
      import('@clocky/clocky-simulation/world-types').WorldCancelId, requestId: request.requestId }
    const admission = (async () => {
      if (this.closing || this.maintenance) throw unavailable('World cancellation owner is retiring or checkpointing')
      authorize()
      const state = this.run.snapshot()
      if (state.world?.requests[selected.requestId] === undefined) throw invalid('World cancellation has no original case')
      this.clearTimer()
      try { return await this.run.cancelWorldCase(selected, authorize) }
      catch (cause: unknown) {
        // Only a typed refusal with no original Native cancellation proves that this attempt was not admitted.
        if (cause instanceof SimulationProductError
          && !Object.hasOwn(this.run.snapshot().world?.cancellations ?? {}, selected.id)) throw cause
        throw new Error('World cancellation acceptance requires original-command reconciliation', { cause })
      }
    })()
    const work = admission.then(async (accepted) => {
      let receipt = accepted
      // Native cancellation linearizes first; even a terminal business result must not race the original provider's remaining IO.
      await this.driver?.drain()
      await this.pending
      await Promise.allSettled(this.targeted === undefined ? [] : [this.targeted])
      if (receipt.status === 'cancel-requested') {
        if (this.connection === undefined) await this.attach()
        const connection = this.connection
        if (connection === undefined) throw new Error('World cancellation lost its canonical connection')
        receipt = await connection.cancelWorldCase(selected)
      }
      const current = this.run.snapshot()
      if (activeSimulationMaintenance(current) !== undefined || unconfirmedExecution(current)) {
        if (this.connection === undefined) await this.attach()
        const result = await this.driver?.reconcile()
        if (result?.reason !== 'paused' && result?.reason !== 'idle') throw new Error('World cancellation retains structural maintenance')
      }
      if (receipt.status === 'cancel-requested') throw new Error('World cancellation retains unconfirmed external cleanup')
      await complete()
      this.last = undefined
    }).finally(() => { if (this.cancellation === handle) this.cancellation = undefined; this.synchronize() })
    const handle = { admission, completion: work }
    this.cancellation = handle
    return handle
  }

  /**
   * Stop timer/management admission, cancel supported connection work and await all accepted batches.
   * @returns confirmed connection retirement; failure retains the connection for another close attempt.
   */
  close(): Promise<void> {
    this.closing = true
    this.clearTimer()
    this.lifetime.abort(new Error('Simulation product owner is retiring'))
    this.closeWork ??= this.retire().catch((cause: unknown) => { this.closeWork = undefined; throw cause })
    return this.closeWork
  }

  private async retire(): Promise<void> {
    const connectionClose = this.connection?.close()
    const results = await Promise.allSettled([this.managementTail, ...connectionClose === undefined ? [] : [connectionClose]])
    await this.driver?.drain()
    await this.pending
    await Promise.allSettled(this.recovery === undefined ? [] : [this.recovery])
    await Promise.allSettled(this.cancellation === undefined ? [] : [this.cancellation.completion])
    await Promise.allSettled(this.targeted === undefined ? [] : [this.targeted])
    const failures = results.filter(value => value.status === 'rejected').map(value => value.reason as unknown)
    if (failures.length !== 0) throw new AggregateError(failures, 'Simulation scheduling connection retirement is unconfirmed')
  }
  private async attach(): Promise<void> {
    const team = this.run.snapshot().teamReservation
    /* v8 ignore next -- completed initial checkpoint and startReason require the canonical Team reservation. */
    if (team === undefined) throw unavailable('Simulation scheduling requires its canonical Team')
    const connection = await this.teams.attach(this.run, team.teamId, this.preparation.ownerName)
    this.connection = connection
    if (this.closing) { await connection.close(); throw unavailable('Simulation scheduling owner retired during attachment') }
    const anchor = { checkpointId: this.preparation.checkpoint.id, ownerName: this.preparation.ownerName,
      maxDrainRounds: this.preparation.checkpoint.maxDrainRounds, maxAttempts: this.preparation.checkpoint.maxAttempts }
    const providers = this.options.executionScope.get('simulationWorldExecutions')
    if (providers === undefined) throw unavailable('World execution providers are not installed')
    this.driver = new SimulationWorldDriver(this.run, connection, this.creation.preparation.resolved, anchor,
      this.lifetime.signal, this.options.executionScope, providers.handlers({ run: this.run, connection,
        resolved: this.creation.preparation.resolved, anchor, lifetime: this.lifetime.signal }))
  }
  private model(): { readonly provider: string; readonly name: string } {
    const resolved = this.creation.preparation.resolved
    const director = resolved.actors.find(actor => actor.entityId === resolved.world.directorEntityId)
    if (director === undefined) throw new Error('World scheduling has no original director runtime')
    return { provider: director.runtime.model.provider, name: director.runtime.model.name }
  }
  private startReason(state: import('@clocky/clocky-simulation').SimulationControlObservation): SimulationProductControlReason {
    if (this.closing) return 'retiring'
    const stop = state.stopTarget
    if (stop?.target != null && stop.activation !== 'effective') return 'stop-target-pending'
    if (stop?.target != null && stop.state !== 'armed') return 'stop-target-reached'
    if (this.targeted !== undefined) return 'management-in-progress'
    if (this.maintenance) return 'checkpoint-in-progress'
    if (this.failed) return 'driver-failed'
    if (this.recovery !== undefined || this.cancellation !== undefined || state.maintenanceInProgress) return 'recovery-required'
    if (!this.options.executionAvailable(state)) return 'execution-unavailable'
    if (state.checkpointInProgress) return 'checkpoint-in-progress'
    if (state.managementInProgress) return 'management-in-progress'
    if (state.unconfirmedWorldExecutions !== 0 || state.unknownOperations) return 'outcome-unknown'
    if (state.messageByteBlocked) return 'scenario-blocked'
    if (state.tokenOverrun
      || state.stall?.code === 'SIM_REQUEST_BUDGET_EXCEEDED') return 'scenario-blocked'
    if (state.stall?.code === 'SIM_MESSAGE_SUBMISSION_BLOCKED') return 'scenario-blocked'
    if (state.stall?.code === 'SIM_WORLD_SUBMISSION_BLOCKED') return 'scenario-blocked'
    if (state.activationHistory !== 'clear') return state.activationHistory === 'recovery-required' ? 'recovery-required' : 'scenario-blocked'
    const retryAuthorized = state.retryAuthorized, budgetRecovered = state.budgetRecovered
    if (state.stall?.code === 'SIM_BUDGET_LIMIT' && !budgetRecovered) return 'stalled'
    const poolStall = state.stall?.code === 'SIM_MODEL_POOL_CAPACITY' || state.stall?.code === 'SIM_COMPACTION_MODEL_POOL_CAPACITY'
    const pool = poolStall ? observeModelPool(this.options.modelUsage) : undefined
    const poolRecovered = pool?.status === 'observed' && (pool.active < pool.limit || pool.queued < pool.queueLimit)
    if (poolStall && !poolRecovered) return 'stalled'
    if (state.phase === 'stalled' && !retryAuthorized && !budgetRecovered && !poolRecovered
      || this.last !== undefined && ['stalled', 'context-limit', 'microstep-limit'].includes(this.last.reason)) return 'stalled'
    const initial = state.selectedCheckpoint
    if (initial?.status !== 'completed' || initial.implementationVersion !== 'world/1'
      || initial.teamId !== state.teamId) return 'recovery-required'
    if (this.last !== undefined && ['position-capacity', 'entity-capacity', 'identity-capacity', 'channel-capacity',
      'world-byte-limit', 'world-request-limit', 'world-command-limit',
      'world-birth-limit', 'world-expansion-limit', 'world-mutation-limit', 'authority-missing', 'plan-budget'].includes(this.last.reason)) {
      return 'scenario-blocked'
    }
    // A stale plan without active maintenance may use its remaining attempts after a new explicit start.
    if (this.last?.reason === 'outcome-unknown') return 'outcome-unknown'
    if (this.last?.reason === 'recovery-required' || this.last?.reason === 'residency-recovery-required') return 'recovery-required'
    return 'ready'
  }
  private clearTimer(): void { if (this.timer !== undefined) { clearTimeout(this.timer); this.timer = undefined } }
  private synchronize(): void {
    const state = this.run.controlObservation()
    if (!this.closing && !this.maintenance && this.pending === undefined && this.targeted === undefined
      && this.cancellation === undefined && this.recovery === undefined && state.phase === 'paused') {
      this.stopCheckpoint.schedule(state.stopTarget, { implementationVersion: 'world/1',
        maxDrainRounds: this.preparation.checkpoint.maxDrainRounds, maxAttempts: this.preparation.checkpoint.maxAttempts },
      (request, commandId) => this.checkpoint(request, commandId))
    }
    if (this.closing || this.maintenance || this.targeted !== undefined || this.cancellation !== undefined || state.phase !== 'running'
      || state.unconfirmedWorldExecutions !== 0) { this.clearTimer(); return }
    if (this.pending !== undefined || this.timer !== undefined || this.driver === undefined || this.failed) return
    const stopped = this.last?.reason
    if (stopped !== undefined && !['paused', 'work-limit', 'coordination-limit', 'retry', 'resident-capacity', 'recipient-busy'].includes(stopped)) return
    const delay = stopped === 'retry' || stopped === 'resident-capacity' || stopped === 'recipient-busy' ? this.options.retryMs : this.options.intervalMs
    const retryAt = this.last?.nextAttemptAt
    // Node's timer delay has a fixed signed-32-bit limit; native retry readiness is rechecked by every batch.
    const wait = Math.min(2147483647, Math.max(delay, retryAt === undefined ? 0 : retryAt - Date.now()))
    this.timer = setTimeout(() => { this.timer = undefined; this.advance() }, wait)
  }
  private advance(): void {
    const state = this.run.controlObservation()
    if (this.closing || this.cancellation !== undefined || state.phase !== 'running' || state.unconfirmedWorldExecutions !== 0
      || this.driver === undefined) return
    const driver = this.driver
    const batchId = randomUUID()
    const work = (async () => {
      let admitted = false
      try {
        await this.run.recordDriverObservation({ status: 'advancing', ownerId: this.ownerId, batchId, observedAt: Date.now() })
        admitted = true
        const result = await driver.advance()
        await this.run.recordDriverObservation({ status: 'settled', ownerId: this.ownerId, batchId, observedAt: Date.now() })
        this.last = result
        this.failure = undefined
      } catch (error: unknown) {
        this.failure = simulationProductFailure(error, { ownerId: this.ownerId, batchId, revision: this.run.controlObservation().revision })
        this.failed = true
        this.last = undefined
        if (admitted) {
          try {
            await this.run.recordDriverObservation({ status: 'failed', ownerId: this.ownerId, batchId,
              observedAt: this.failure.occurredAt, failure: this.failure })
          } catch { /* A failed journal write cannot confirm durable failure; driverSource retains the last confirmed revision. */ }
        }
      }
    })().finally(() => {
      this.pending = undefined
      this.synchronize()
    })
    this.pending = work
  }
}

function unconfirmedExecution(state: SimulationSnapshot): boolean {
  return Object.values(state.world?.executions ?? {}).some(value => value.phase === 'armed' || value.phase === 'outcome-unknown')
}
function unavailable(message: string): SimulationProductError {
  return new SimulationProductError(message, 'SIMULATION_PRODUCT_UNAVAILABLE')
}
function invalid(message: string): SimulationProductError {
  return new SimulationProductError(message, 'SIMULATION_PRODUCT_INVALID')
}
