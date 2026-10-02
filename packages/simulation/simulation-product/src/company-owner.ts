/** One product-held run serializes management while its bounded scenario driver owns independently drainable work. */
import { observeModelPool } from './model-pool.ts'
import { scenarioReviewSummary, scenarioHasReview, scenarioTaskStep } from './scenario-review.ts'
import type { SimulationProductTaskReviewResolveInput } from './review-types.ts'
import type { SimulationProductTaskCancelInput } from './task-control-types.ts'
import type { SimulationProductOperationRetryInput, SimulationProductOperationRetryCapability } from './operation-retry-types.ts'
import { simulationOutboxRetryRequestSchema, simulationOutboxRetryCapability } from '@clocky/clocky-simulation'
import { isDeepStrictEqual } from 'node:util'
import { simulationPhaseManagementRequestSchema } from '@clocky/clocky-simulation'
import type { SimulationRun, SimulationSnapshot, SimulationManagementOperation, SimulationCheckpointRequest, SimulationCheckpointOperation, SimulationIngressRequest, SimulationIngress } from '@clocky/clocky-simulation'
import type { SimulationTeamConnection, SimulationTeams } from '@clocky/clocky-simulation-team'
import { SimulationCompanyDriver } from './company-driver.ts'
import type { SimulationCompanyDriveResult } from './company-driver.ts'
import type { SimulationCompanyPreparation } from './company-preparation.ts'
import type { SimulationCompanyCreation } from './creation-types.ts'
import type { SimulationProductManageInput, SimulationProductControl, SimulationProductControlReason } from './control-types.ts'
import { managementAt } from './management-read.ts'
import { SimulationProductError } from './index.ts'
import type { SimulationTaskExecutorOptions } from './task-executor.ts'

interface Options {
  readonly intervalMs: number
  readonly retryMs: number
  readonly maxManagementRequests: number
  readonly maxIngressRequests: number
  readonly executionAvailable: () => boolean
  readonly sharedModelLimit: () => number
  readonly modelUsage?: (() => ReturnType<SimulationTeams['modelUsage']>) | undefined
  readonly readTask?: SimulationTaskExecutorOptions['readTask']
}

/** A single administration-owned scheduler; construction and observation never attach or infer. */
export class SimulationCompanyOwner {
  private readonly lifetime = new AbortController()
  private connection: SimulationTeamConnection | undefined
  private driver: SimulationCompanyDriver | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private pending: Promise<void> | undefined
  private managementTail: Promise<unknown> = Promise.resolve()
  private last: SimulationCompanyDriveResult | undefined
  private failed = false
  private maintenance = false
  private closing = false
  private closeWork: Promise<void> | undefined

  /**
   * @param run - Exclusively held prepared native run; ownership stays with the administration service.
   * @param teams - Canonical connection provider; attachment happens only for an authorized start.
   * @param creation - Original immutable company topology and route.
   * @param preparation - Exact completed preparation anchor; a later attempt retains its distinct checkpoint.
   * @param options - Validated cadence, retry delay and retained native management allowance.
   */
  constructor(private readonly run: SimulationRun, private readonly teams: Pick<SimulationTeams, 'attach'>,
    private readonly creation: SimulationCompanyCreation, private preparation: SimulationCompanyPreparation,
    private readonly options: Options) {}

  /**
   * Observe intent, in-flight work and actual prerequisites without allocating a connection.
   * @returns separate scheduling/driver observations and current action hints; hints are rechecked before writes.
   */
  observe(): Omit<SimulationProductControl, 'administration'> & { readonly unstarted: boolean } {
    const state = this.run.snapshot()
    const reason = this.startReason(state)
    return { modelPool: observeModelPool(this.options.modelUsage), unstarted: this.connection === undefined,
      runId: this.creation.record.id, budget: { model: this.creation.driver.model,
        tokensPerRequest: state.spec.tokensPerModelRequest, tokensPerInterval: state.spec.maxTokensPerInterval,
        interval: state.spec.budgetInterval, residentActors: state.spec.maxResidentActors, sharedModelLimit: this.options.sharedModelLimit() }, owner: 'held', phase: state.phase, revision: state.revision, observedAt: Date.now(),
      driver: this.closing ? 'retiring' : this.maintenance ? 'checkpointing' : this.failed ? 'failed' : this.pending !== undefined ? 'advancing'
        : this.timer !== undefined ? 'scheduled' : this.last?.reason === 'completed' ? 'completed'
          : this.last !== undefined && this.last.reason !== 'paused' ? 'waiting' : 'idle',
      inFlight: this.pending !== undefined || this.maintenance,
      ...this.last === undefined ? {} : { stop: this.last.reason },
      ...this.last?.nextAttemptAt === undefined ? {} : { nextAttemptAt: this.last.nextAttemptAt },
      actions: { start: { allowed: reason === 'ready', reason }, pause: { allowed: !this.closing && !this.maintenance,
        reason: this.closing ? 'retiring' : this.maintenance ? 'checkpoint-in-progress' : 'ready' } } }
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
      const input = simulationPhaseManagementRequestSchema.parse({ id: request.managementId, phase: request.phase })
      const state = this.run.snapshot()
      const prior = managementAt(state, input.id)
      if (prior !== undefined) {
        if (prior.request.phase !== input.phase) throw invalid('Simulation management identity has another original phase')
        if (prior.status !== 'in-progress') return prior
      } else {
        if (Object.keys(state.management ?? {}).length >= this.options.maxManagementRequests) {
          throw unavailable('Simulation retained management capacity is occupied')
        }
        if (request.phase === 'running') {
          const reason = this.startReason(state)
          if (reason !== 'ready') throw unavailable(`Simulation scheduling cannot start: ${reason}`)
        }
      }
      if (request.phase === 'running' && this.connection === undefined) await this.attach()
      authorize()
      try {
        const operation = await this.run.managePhase(input)
        if (operation.status === 'completed') {
          if (request.phase === 'running') this.last = undefined
          this.synchronize()
        }
        return operation
      } finally {
        // A committed running phase owns scheduling even when only its response or post-append housekeeping fails.
        if (managementAt(this.run.snapshot(), input.id)?.status === 'completed') this.synchronize()
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
  prepare(settings: SimulationCompanyPreparation, operation: () => Promise<unknown>): Promise<void> {
    const work = this.managementTail.then(async () => {
      if (this.closing || this.connection !== undefined) throw unavailable('Simulation preparation requires an unstarted owner')
      await operation()
      this.preparation = settings
    })
    this.managementTail = work.then(() => {}, () => {})
    return work
  }

  /**
   * Pause, retire supported work and publish one complete native checkpoint without automatically resuming.
   * @param request - Original Host-derived checkpoint identity and retained collector policy.
   * @returns original checkpoint result; failed collection preserves the previous successful anchor.
   */
  checkpoint(request: SimulationCheckpointRequest): Promise<SimulationCheckpointOperation> {
    const work = this.managementTail.then(async () => {
      if (this.closing) throw unavailable('Simulation scheduling owner is retiring')
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
        if (result.status === 'completed') {
          await connection.close()
          this.connection = undefined
          this.driver = undefined
          this.preparation = { ...this.preparation, checkpoint: { id: request.id,
            maxDrainRounds: request.maxDrainRounds, maxAttempts: request.maxAttempts } }
          this.failed = false
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
      if (this.last?.reason === 'completed') this.last = undefined
      this.synchronize()
      return result
    })
    this.managementTail = work.then(() => {}, () => {})
    return work
  }

  /**
   * Drain the current scenario batch and resolve one retained administrative review without changing phase.
   * @param request - Exact durable product intent; the scene derives the reviewer entity.
   * @param authorize - Current authentication and original run ownership, rechecked after every wait.
   * @param complete - Publish the original terminal product receipt before productive scheduling resumes.
   * @returns completion after canonical review and durable terminal publication; paused runs await explicit start.
   */
  review(request: SimulationProductTaskReviewResolveInput, authorize: () => void,
    complete: () => Promise<void>): Promise<void> {
    const work = this.managementTail.then(async () => {
      if (this.closing || this.maintenance) throw unavailable('Simulation review owner is retiring or collecting a checkpoint')
      authorize()
      this.maintenance = true
      this.clearTimer()
      try {
        await this.driver?.drain()
        await this.pending
        authorize()
        const state = this.run.snapshot()
        if (Object.values(state.checkpoints ?? {}).some(value => value.status === 'in-progress') || state.phase === 'stalled') {
          throw unavailable('Simulation review requires an available owner outside native maintenance')
        }
        const execution = state.taskExecutions?.[request.attemptId]
        if (execution?.request.operationId !== request.operationId) throw invalid('Simulation review target differs from its original attempt')
        if (!scenarioHasReview(this.creation.driver)) throw unavailable('This company scenario does not permit administrative review')
        const readTask = this.options.readTask
        if (readTask === undefined) throw unavailable('Simulation review has no canonical Team reader')
        let task
        try { task = await readTask({ teamId: execution.request.teamId, taskId: execution.request.taskId }) }
        catch { authorize(); throw unavailable('Simulation canonical task review metadata is unavailable') }
        authorize()
        const prior = task.reviewHistory.find(value => value.simulationCommand?.runId === state.spec.runId
          && value.simulationCommand.commandId === request.commandId)
        if (prior === undefined) {
          let summary
          try { summary = scenarioReviewSummary(this.run.snapshot(), execution, task, this.creation.driver) }
          catch { throw invalid('Simulation review target has another canonical creation source') }
          if (!summary.action.allowed || task.revision !== request.expectedRevision
            || request.nextPhase === 'pending' && task.attemptCount >= task.maxAttempts) {
            throw invalid('Simulation review target changed; refresh its canonical attempt and revision')
          }
        }
        if (this.connection === undefined) await this.attach()
        authorize()
        const connection = this.connection
        /* v8 ignore next -- successful attachment installs its canonical connection. */
        if (connection === undefined) throw unavailable('Simulation review has no canonical connection')
        try {
          await connection.reviewTask({ commandId: request.commandId, attemptId: request.attemptId,
            reviewerEntityId: this.creation.driver.scenario === undefined
              ? 'buyer' as import('@clocky/clocky-simulation').SimulationEntityId
              : scenarioTaskStep(this.run.snapshot(), request.operationId, this.creation.driver)?.reviewerEntityId
                ?? (() => { throw invalid('Task workflow has no installed reviewer route') })(),
            expectedRevision: request.expectedRevision, nextPhase: request.nextPhase, reason: request.reason }, authorize)
        } catch (cause: unknown) {
          // Native IO may have committed before lease retirement or response loss; the original intent remains accepted.
          throw new Error('Simulation canonical review outcome requires original-command reconciliation', { cause })
        }
        await complete()
        this.last = undefined
      } finally { this.maintenance = false; this.synchronize() }
    })
    this.managementTail = work.then(() => {}, () => {})
    return work
  }

  /**
   * Cancel an accepted run-owned task before draining its in-flight executor; native cancellation fences future work.
   * @param request - Exact original source, canonical revision and active-attempt or lease-free selection.
   * @param authorize - Current run owner, checked at queue admission and after each native wait.
   * @param complete - Original terminal publication after canonical intent and supported physical retirement settle.
   * @returns completion without resuming scheduling; unconfirmed cleanup leaves the original accepted request recoverable.
   */
  cancelTask(request: SimulationProductTaskCancelInput, authorize: () => void, complete: () => Promise<void>): Promise<void> {
    const work = this.managementTail.then(async () => {
      if (this.closing || this.maintenance) throw unavailable('Simulation cancellation owner is retiring or collecting a checkpoint')
      authorize()
      const state = this.run.snapshot()
      const operation = state.operations[request.operationId]
      if (operation?.action.kind !== 'task/create' || operation.outbox?.taskReceipt === undefined) {
        throw invalid('Simulation cancellation target is not an accepted run-owned task')
      }
      const readTask = this.options.readTask
      if (readTask === undefined) throw unavailable('Simulation cancellation has no canonical task reader')
      const task = await readTask({ teamId: operation.outbox.taskReceipt.teamId, taskId: operation.outbox.taskReceipt.taskId })
      authorize()
      if (task.cancellation === undefined && (task.revision !== request.expectedRevision
        || (task.lease?.attemptId ?? null) !== request.expectedAttemptId
        || ['completed', 'failed', 'cancelled', 'deleted'].includes(task.phase))) {
        throw invalid('Simulation cancellation target changed; confirm its current revision and attempt')
      }
      this.maintenance = true
      this.clearTimer()
      try {
        if (this.connection === undefined) await this.attach()
        authorize()
        const connection = this.connection
        if (connection === undefined) throw unavailable('Simulation cancellation has no canonical connection')
        try {
          await connection.cancelTask({ operationId: request.operationId, expectedRevision: request.expectedRevision,
            expectedAttemptId: request.expectedAttemptId, reason: request.reason }, authorize)
        } catch (cause: unknown) {
          throw new Error('Simulation task cancellation requires original-command reconciliation', { cause })
        }
        await this.driver?.drain()
        await this.pending
        authorize()
        await complete()
        this.last = undefined
      } finally { this.maintenance = false; this.synchronize() }
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
    this.driver = new SimulationCompanyDriver(this.run, connection, this.preparation, this.creation.driver, this.lifetime.signal,
      this.options.readTask === undefined ? undefined : { readTask: this.options.readTask })
  }
  private startReason(state: SimulationSnapshot): SimulationProductControlReason {
    if (this.closing) return 'retiring'
    if (this.maintenance) return 'checkpoint-in-progress'
    if (this.failed) return 'driver-failed'
    if (!this.options.executionAvailable()) return 'execution-unavailable'
    if (Object.values(state.checkpoints ?? {}).some(value => value.status === 'in-progress')) return 'checkpoint-in-progress'
    if (Object.values(state.management ?? {}).some(value => value.status === 'in-progress')) return 'management-in-progress'
    if (Object.values(state.operations).some(operation => operation.status === 'outcome-unknown')) return 'outcome-unknown'
    const stalledOperation = state.stall?.code === 'SIM_OUTBOX_OUTCOME_UNKNOWN' ? state.operations[state.stall.operationId] : undefined
    const retryAuthorized = stalledOperation?.status === 'pending' && Object.values(stalledOperation.outbox?.retryAuthorizations ?? {})
      .some(grant => grant.budgetStart === stalledOperation.outbox?.budgetStart)
    if (state.phase === 'stalled' && !retryAuthorized || this.last?.reason === 'stalled') return 'stalled'
    const initial = state.checkpoints?.[this.preparation.checkpoint.id]
    if (initial?.status !== 'completed' || initial.manifest.implementationVersion !== 'company/1'
      || initial.manifest.team.owner.teamId !== state.teamReservation?.teamId) return 'recovery-required'
    if (this.last?.reason === 'review-required') return 'review-required'
    if (this.last?.reason === 'completed') return 'scenario-completed'
    if (this.last?.reason === 'scenario-blocked') return 'scenario-blocked'
    if (this.last?.reason === 'outcome-unknown') return 'outcome-unknown'
    if (this.last?.reason === 'recovery-required' || this.last?.reason === 'residency-recovery-required') return 'recovery-required'
    return 'ready'
  }
  private clearTimer(): void { if (this.timer !== undefined) { clearTimeout(this.timer); this.timer = undefined } }
  private synchronize(): void {
    if (this.closing || this.maintenance || this.run.snapshot().phase !== 'running') { this.clearTimer(); return }
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
    if (this.closing || this.run.snapshot().phase !== 'running' || this.driver === undefined) return
    const driver = this.driver
    const work = driver.advance().then((result) => { this.last = result }, () => { this.failed = true }).finally(() => {
      this.pending = undefined
      this.synchronize()
    })
    this.pending = work
  }
}

function unavailable(message: string): SimulationProductError {
  return new SimulationProductError(message, 'SIMULATION_PRODUCT_UNAVAILABLE')
}
function invalid(message: string): SimulationProductError {
  return new SimulationProductError(message, 'SIMULATION_PRODUCT_INVALID')
}
