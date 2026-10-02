/** Bounded automatic task execution over retained Simulation sources and canonical Team attempts. */
import { z } from 'zod'
import { isDeepStrictEqual } from 'node:util'
import { deepFreeze } from '@clocky/clocky-llm'
import { taskAttemptIdSchema } from '@clocky/clocky-team'
import type { TeamTaskSnapshot } from '@clocky/clocky-team'
import { simulationEntityIdSchema, simulationInteractionIdSchema, simulationPolicyRefSchema,
  simulationDecisionIdSchema, simulationOperationIdSchema } from '@clocky/clocky-simulation'
import type { SimulationRun, SimulationSnapshot, SimulationTaskExecution, SimulationOperation,
  SimulationContextRequest, SimulationEntityId } from '@clocky/clocky-simulation'
import type { SimulationTeamConnection, SimulationResidencyChoice, SimulationTeamDriveResult } from '@clocky/clocky-simulation-team'

/** Trusted source routing and policy generations; neither task text nor a browser selects execution authority. */
export const simulationTaskExecutorSchema = z.strictObject({
  version: z.literal('1'), maxControlSteps: z.number().int().positive(), leaseDurationMs: z.number().int().positive(),
  maxDecisionsPerAttempt: z.number().int().positive().default(1),
  retry: z.enum(['never', 'before-effects', 'scene']).default('never'),
  routes: z.array(z.strictObject({ sourceEntityId: simulationEntityIdSchema, entityId: simulationEntityIdSchema,
    operationId: simulationOperationIdSchema.optional(),
    cognition: simulationPolicyRefSchema.optional(), completion: simulationPolicyRefSchema,
    interactionId: simulationInteractionIdSchema.optional(), reason: z.string().trim().min(1),
  })).min(1),
}).refine(value => value.routes.every((route, index) => value.routes.every((other, otherIndex) =>
  index === otherIndex || route.sourceEntityId !== other.sourceEntityId
    || route.operationId !== undefined && other.operationId !== undefined && route.operationId !== other.operationId)),
'Routes for the same task source require distinct exact operation identities')
/** Immutable deployment routing; omitted cognition uses the existing model decision path. */
export type SimulationTaskExecutorConfig = z.infer<typeof simulationTaskExecutorSchema>
type Route = SimulationTaskExecutorConfig['routes'][number]
/** Scenario-owned IO and authorized context selection; these callbacks never bypass native or Hub checks. */
export interface SimulationTaskExecutorOptions {
  /** Canonical task reader; source identity and task lifecycle are rechecked before assignment. */
  readonly readTask: (request: { teamId: import('@clocky/clocky-team').TeamId
    taskId: import('@clocky/clocky-team').TeamTaskId }) => Promise<TeamTaskSnapshot>
  /** Deployment placement policy for execution and operation recipients. */
  readonly residency: (entityId: SimulationEntityId) => SimulationResidencyChoice
  /** Authorized scenario material; exact task instructions are added by the native task decision owner. */
  readonly context: (state: SimulationSnapshot, execution: SimulationTaskExecution, task: TeamTaskSnapshot) =>
  Omit<SimulationContextRequest, 'maxBytes' | 'teamCursor'>
  /** Owner retirement cancels future admission; the owner still drains accepted work before closing its connection. */
  readonly lifetime: AbortSignal
  /** Pure scene decision after retired attempts' accepted operations have been driven; retry continues recorded business responsibility. */
  readonly recover?: (state: SimulationSnapshot, attempts: readonly SimulationTaskExecution[]) => 'retry' | 'waiting' | 'blocked'
  /** Exact persisted report selected after physical retirement; Native independently validates the source and acknowledgement. */
  readonly reportContinuation?: (state: SimulationSnapshot, execution: SimulationTaskExecution) =>
  import('@clocky/clocky-simulation').SimulationTaskReportContinuation | undefined
  /** Pure scene choice after an accepted decision lacks completion evidence; waiting never implies more cognition. */
  readonly nextDecision?: (state: SimulationSnapshot, execution: SimulationTaskExecution) =>
  { readonly kind: 'waiting' } | { readonly kind: 'blocked' }
    | { readonly kind: 'decision'; readonly reason: string; readonly policy?: import('@clocky/clocky-simulation').SimulationPolicyRef }
}
/** Stop facts from one bounded batch, separate from phase and actual task completion. */
export interface SimulationTaskExecutorResult {
  readonly reason: SimulationTeamDriveResult['reason'] | 'idle' | 'task-waiting' | 'task-blocked' | 'recovery-required'
  readonly controlSteps: number
  readonly revision: number
  readonly attemptId?: import('@clocky/clocky-team').TaskAttemptId
  readonly operationId?: import('@clocky/clocky-simulation').SimulationOperationId
  readonly nextAttemptAt?: number
}
type Retry = { readonly kind: 'never' | 'before-effects' }
  | { readonly kind: 'scene'; readonly recover: NonNullable<SimulationTaskExecutorOptions['recover']> }

/** Serial scenario consumer; reads/construction do not activate actors, and paused advance admits no task work. */
export class SimulationTaskExecutor {
  private readonly config: Omit<SimulationTaskExecutorConfig, 'retry'> & { readonly retry: Retry }
  private pending: Promise<SimulationTaskExecutorResult> | undefined

  /**
   * @param run - Exclusive prepared run; opening/restoration/checkpoint ownership stays with the caller.
   * @param connection - Same run's canonical connection and scoped task proof owner.
   * @param config - Explicit versioned source routing, lease duration and batch bound.
   * @param options - Trusted scenario reader, placement, context and owner lifetime.
   */
  constructor(private readonly run: SimulationRun, private readonly connection: SimulationTeamConnection,
    config: SimulationTaskExecutorConfig, private readonly options: SimulationTaskExecutorOptions) {
    const selected = simulationTaskExecutorSchema.parse(config)
    if (selected.retry === 'scene') {
      const recover = options.recover
      if (recover === undefined) throw new Error('Scene task recovery requires its trusted recovery policy')
      this.config = { ...selected, retry: { kind: 'scene', recover } }
    } else this.config = { ...selected, retry: { kind: selected.retry } }
  }

  /**
   * Select accepted task creations, resume their exact attempt, apply effects and evaluate the pinned completion policy.
   * @returns shared bounded batch; errors retain original native identities for explicit retry.
   */
  advance(): Promise<SimulationTaskExecutorResult> {
    if (this.pending !== undefined) return this.pending
    let selected: import('@clocky/clocky-simulation').SimulationOperationId | undefined
    const work = this.pump((id) => { selected = id }).catch((cause: unknown) => {
      if (selected !== undefined && this.run.snapshot().taskCancellations?.[selected] !== undefined) {
        return this.result('task-blocked', 0, { operationId: selected })
      }
      throw cause
    }).finally(() => { this.pending = undefined })
    this.pending = work
    return work
  }

  /** Await admitted execution; an aborted lifetime alone does not prove quiescence. */
  async drain(): Promise<void> { await Promise.allSettled(this.pending === undefined ? [] : [this.pending]) }

  private result(reason: SimulationTaskExecutorResult['reason'], controlSteps: number,
    facts: Pick<SimulationTaskExecutorResult, 'attemptId' | 'operationId' | 'nextAttemptAt'> = {}): SimulationTaskExecutorResult {
    return { reason, controlSteps, revision: this.run.snapshot().revision, ...facts }
  }
  private stopped(controlSteps: number,
    facts: Pick<SimulationTaskExecutorResult, 'attemptId' | 'operationId' | 'nextAttemptAt'> = {}): SimulationTaskExecutorResult | undefined {
    this.options.lifetime.throwIfAborted()
    const phase = this.run.snapshot().phase
    return phase === 'running' ? undefined : this.result(phase, controlSteps, facts)
  }
  private async pump(select: (id: import('@clocky/clocky-simulation').SimulationOperationId) => void): Promise<SimulationTaskExecutorResult> {
    for (let step = 0; step < this.config.maxControlSteps; step++) {
      let stop = this.stopped(step)
      if (stop !== undefined) return stop
      let state = this.run.snapshot()
      if (state.activeWindowId !== undefined) {
        const window = state.windows?.[state.activeWindowId], slot = window?.request.decisions[0]
        const owner = slot === undefined ? undefined : state.taskDecisionOwners?.[slot.id]
        const execution = owner === undefined ? undefined : state.taskExecutions?.[owner.attemptId]
        const operation = execution === undefined ? undefined : state.operations[execution.request.operationId]
        const route = operation === undefined ? undefined : this.config.routes.find(value => value.sourceEntityId === operation.entityId
          && (value.operationId === undefined || value.operationId === operation.id) && value.entityId === slot?.entityId)
        if (window?.request.decisions.length !== 1 || slot === undefined || execution === undefined || route === undefined) {
          return this.result('task-waiting', step)
        }
        select(execution.request.operationId)
        const decision = state.decisions[slot.id]
        if (decision?.status === 'open') {
          const association = execution.decisions?.[owner?.index ?? 0]
          if (association === undefined) throw new Error('Task window has no recorded task association')
          const task = await this.options.readTask({ teamId: execution.request.teamId, taskId: execution.request.taskId })
          await this.connection.executeTaskDecision({ attemptId: execution.request.attemptId, decisionId: slot.id,
            predecessor: association.request.predecessor, reason: association.request.reason,
            ...association.request.policy === undefined ? {} : { policy: association.request.policy },
            context: this.options.context(state, execution, task) })
        } else await this.run.commitWindow(window.id)
        state = this.run.snapshot()
        if (state.phase !== 'running') return this.result(state.phase, step + 1)
      }
      const choice = await this.select(state)
      stop = this.stopped(step)
      if (stop !== undefined) return stop
      if (choice === undefined) return this.result('idle', step)
      const { operation, route, task } = choice
      select(operation.id)
      let prior = choice.prior
      let reportContinuation: import('@clocky/clocky-simulation').SimulationTaskReportContinuation | undefined
      const facts = { operationId: operation.id, ...prior === undefined ? {} : { attemptId: prior.request.attemptId } }
      if (task.cancellation !== undefined || task.phase === 'cancelled' || task.phase === 'deleted') {
        return this.result('task-blocked', step + 1, facts)
      }
      // A canonical reviewer explicitly requests a new attempt; the old completion remains immutable.
      if (prior !== undefined && isRework(task, prior)) prior = undefined
      if (prior?.result !== undefined && prior.retired === undefined || prior?.task?.executor?.outcome === 'completed') {
        const completed = await this.connection.completeTask({ attemptId: prior.request.attemptId, policy: route.completion })
        const reason = settlementStop(completed)
        if (reason !== undefined) return this.result(reason, step + 1, facts)
        continue
      }
      // A retired attempt may already own accepted world effects; a fresh decision cannot safely repeat them.
      if (prior?.retired !== undefined || prior?.task?.executor?.outcome !== undefined) {
        if (this.config.retry.kind === 'never' || prior.retired === undefined) {
          return this.result('recovery-required', step + 1, facts)
        }
        const attempts = choice.attempts
        const responsibilities = this.options.reportContinuation === undefined ? attempts : [prior]
        const acceptedEffects = prior.request.reportContinuation !== undefined || responsibilities
          .some(value => value.decisions?.some(decision => (state.decisions[decision.request.decisionId]?.operationIds.length ?? 0) > 0))
        if (acceptedEffects) {
          const driven = await this.connection.driveResident({ until: state.time }, Date.now, this.options.residency)
          stop = this.stopped(step + 1, facts)
          if (stop !== undefined) return stop
          if (driven.reason !== 'until' && driven.reason !== 'decision-required') {
            return this.result(driven.reason, step + 1, { ...facts,
              ...driven.nextAttemptAt === undefined ? {} : { nextAttemptAt: driven.nextAttemptAt } })
          }
          reportContinuation = this.options.reportContinuation?.(deepFreeze(this.run.snapshot()), deepFreeze(prior))
          if (this.config.retry.kind === 'before-effects' && reportContinuation === undefined) {
            return this.result('task-blocked', step + 1, facts)
          }
        }
        if (this.config.retry.kind === 'scene') {
          const recovery = this.config.retry.recover
          const selected = recovery(deepFreeze(this.run.snapshot()), deepFreeze(attempts))
          if (selected !== 'retry') return this.result(selected === 'waiting' ? 'task-waiting' : 'task-blocked', step + 1, facts)
        }
        prior = undefined
      }
      if (prior === undefined && (task.phase !== 'pending'
        || task.attemptCount >= task.maxAttempts)) return this.result('task-blocked', step + 1, facts)
      if (prior === undefined) {
        for (const taskId of task.blockedBy) {
          const dependency = await this.options.readTask({ teamId: task.teamId, taskId })
          stop = this.stopped(step + 1, facts)
          if (stop !== undefined) return stop
          if (dependency.phase !== 'completed') return this.result('task-blocked', step + 1, facts)
        }
        const resident = await this.connection.ensureResident(route.entityId, this.options.residency(route.entityId))
        stop = this.stopped(step + 1, facts)
        if (stop !== undefined) return stop
        if (resident.status !== 'resident') return this.result(resident.status === 'capacity' ? 'resident-capacity' : 'recovery-required', step + 1, facts)
      } else {
        const writer = this.run.snapshot().entities[prior.request.entityId]?.writer
        if (writer?.phase !== 'active' || writer.epoch !== prior.request.epoch) return this.result('recovery-required', step + 1, facts)
      }
      const currentWriter = this.run.snapshot().entities[route.entityId]?.writer
      if (currentWriter?.phase !== 'active') return this.result('recovery-required', step + 1, facts)
      const replacement = choice.prior?.retired === undefined ? '' : `/epoch/${currentWriter.epoch}`
      const attemptId = prior?.request.attemptId
        ?? taskAttemptIdSchema.parse(`task-executor/1/${operation.id}/${task.attemptCount + 1}${replacement}`)
      const execution = await this.connection.assignTask({ attemptId, operationId: operation.id, entityId: route.entityId,
        leaseDurationMs: this.config.leaseDurationMs,
        ...reportContinuation === undefined ? {} : { reportContinuation },
        ...route.interactionId === undefined ? {} : { interactionId: route.interactionId } })
      stop = this.stopped(step + 1, { ...facts, attemptId })
      if (stop !== undefined) return stop
      const retained = execution.decisions?.at(-1)?.request
      let decisionId = retained?.decisionId ?? simulationDecisionIdSchema.parse(`${attemptId}/decision`)
      let predecessor = retained?.predecessor ?? null
      let decisionReason = retained?.reason ?? route.reason
      let policy = retained?.policy ?? (retained === undefined ? route.cognition : undefined)
      if (retained !== undefined && this.run.snapshot().decisions[retained.decisionId]?.status === 'accepted') {
        const driven = await this.connection.driveResident({ until: this.run.snapshot().time }, Date.now, this.options.residency)
        stop = this.stopped(step + 1, { ...facts, attemptId })
        if (stop !== undefined) return stop
        if (driven.reason !== 'until' && driven.reason !== 'decision-required') {
          return this.result(driven.reason, step + 1, { ...facts, attemptId,
            ...driven.nextAttemptAt === undefined ? {} : { nextAttemptAt: driven.nextAttemptAt } })
        }
        const completed = await this.connection.completeTask({ attemptId, policy: route.completion })
        stop = this.stopped(step + 1, { ...facts, attemptId })
        if (stop !== undefined) return stop
        const settled = settlementStop(completed)
        if (settled === undefined) continue
        if (completed.status !== 'waiting' || completed.execution.task?.phase !== 'running'
          || completed.execution.result !== undefined) return this.result(settled, step + 1, { ...facts, attemptId })
        if (effectsPending(this.run.snapshot(), retained.decisionId)) return this.result('task-waiting', step + 1, { ...facts, attemptId })
        const selected = this.options.nextDecision?.(deepFreeze(this.run.snapshot()), deepFreeze(completed.execution))
        if (selected === undefined || selected.kind === 'waiting') return this.result('task-waiting', step + 1, { ...facts, attemptId })
        if (selected.kind === 'blocked' || (execution.decisions?.length ?? 0) >= this.config.maxDecisionsPerAttempt) {
          return this.result('task-blocked', step + 1, { ...facts, attemptId })
        }
        decisionId = simulationDecisionIdSchema.parse(`${attemptId}/decision/${(execution.decisions?.length ?? 0) + 1}`)
        predecessor = retained.decisionId
        decisionReason = selected.reason
        policy = selected.policy
      }
      const decision = this.run.snapshot().decisions[decisionId]
      if (decision?.status === 'cancelled') return this.result('recovery-required', step + 1, { ...facts, attemptId })
      if (decision?.status !== 'accepted') {
        await this.connection.executeTaskDecision({ attemptId, decisionId, predecessor, reason: decisionReason,
          ...policy === undefined ? {} : { policy },
          context: this.options.context(this.run.snapshot(), execution, task) })
        stop = this.stopped(step + 1, { ...facts, attemptId })
        if (stop !== undefined) return stop
      }
      const driven = await this.connection.driveResident({ until: this.run.snapshot().time }, Date.now, this.options.residency)
      stop = this.stopped(step + 1, { ...facts, attemptId })
      if (stop !== undefined) return stop
      if (driven.reason !== 'until' && driven.reason !== 'decision-required') {
        return this.result(driven.reason, step + 1, { ...facts, attemptId,
          ...driven.nextAttemptAt === undefined ? {} : { nextAttemptAt: driven.nextAttemptAt } })
      }
      const completed = await this.connection.completeTask({ attemptId, policy: route.completion })
      const reason = settlementStop(completed)
      if (reason !== undefined) {
        if (completed.status === 'waiting' && completed.execution.task?.phase === 'running'
          && completed.execution.result === undefined && this.options.nextDecision !== undefined
          && !effectsPending(this.run.snapshot(), decisionId)) continue
        return this.result(reason, step + 1, { ...facts, attemptId })
      }
    }
    return this.result('work-limit', this.config.maxControlSteps)
  }

  private async select(state: SimulationSnapshot): Promise<{ operation: SimulationOperation
    route: Route
    task: TeamTaskSnapshot
    attempts: readonly SimulationTaskExecution[]
    prior?: SimulationTaskExecution } | undefined> {
    for (const operation of Object.values(state.operations)) {
      const receipt = operation.outbox?.taskReceipt
      const route = this.config.routes.find(value => value.sourceEntityId === operation.entityId
        && (value.operationId === undefined || value.operationId === operation.id))
      if (operation.action.kind !== 'task/create' || operation.result?.status !== 'applied' || receipt === undefined || route === undefined) continue
      const task = await this.options.readTask({ teamId: receipt.teamId, taskId: receipt.taskId })
      if (task.teamId !== receipt.teamId || task.id !== receipt.taskId) throw new Error('Task executor reader returned another task')
      const attempts = Object.values(state.taskExecutions ?? {}).filter(value => value.request.operationId === operation.id)
        .sort((a, b) => b.reservedSequence - a.reservedSequence)
      const prior = attempts[0]
      if (prior !== undefined && (prior.request.entityId !== route.entityId || prior.request.leaseDurationMs !== this.config.leaseDurationMs
        || prior.request.interaction?.interactionId !== route.interactionId)) throw new Error('Task executor route differs from its retained assignment')
      const decision = prior?.decisions?.[0]?.request
      if (decision !== undefined && (decision.reason !== route.reason || !isDeepStrictEqual(decision.policy, route.cognition))) {
        throw new Error('Task executor cognition differs from its retained decision')
      }
      if (prior?.completionPolicy !== undefined && !isDeepStrictEqual(prior.completionPolicy, route.completion)) {
        throw new Error('Task executor completion differs from its retained policy')
      }
      const association = prior?.request.interaction
      const interaction = association === undefined ? undefined : state.interactions[association.interactionId]
      const commitment = interaction?.commitmentId === undefined ? undefined : state.commitments[interaction.commitmentId]
      if (task.phase === 'completed' && prior?.task?.phase === 'completed'
        && (association === undefined || commitment !== undefined && commitment.phase !== 'open'
          || interaction?.task?.revision === task.revision)) continue
      if (prior === undefined && (task.phase === 'completed' || task.phase === 'cancelled' || task.phase === 'deleted')) continue
      return { operation, route, task, attempts, ...prior === undefined ? {} : { prior } }
    }
    return undefined
  }
}

/** Pending effects or unpersisted recipient delivery need reconciliation, not another cognition with a new operation identity. */
function effectsPending(state: SimulationSnapshot, decisionId: import('@clocky/clocky-simulation').SimulationDecisionId): boolean {
  return state.decisions[decisionId]?.operationIds.some((id) => {
    const operation = state.operations[id]
    return operation?.result === undefined || operation.action.kind === 'communication/post'
      && operation.result.status === 'applied' && operation.delivery?.receipt === undefined
  }) ?? false
}

/** Rework authority is the exact canonical review of the latest completed attempt, never its result alone. */
function isRework(task: TeamTaskSnapshot, execution: SimulationTaskExecution): boolean {
  const attempt = task.attemptHistory.at(-1), review = task.reviewHistory.at(-1)
  return task.phase === 'pending' && task.cancellation === undefined && attempt?.id === execution.request.attemptId
    && attempt.outcome.kind === 'completed' && task.attemptCount === execution.request.ordinal
    && review?.attemptId === attempt.id && review.nextPhase === 'pending'
}

/** A settled failed attempt or pending review cannot authorize another automatic decision. */
function settlementStop(result: import('@clocky/clocky-simulation-team').SimulationTaskCompletionResult):
  'task-waiting' | 'task-blocked' | undefined {
  if (result.status === 'waiting' || result.execution.task?.phase === 'review') return 'task-waiting'
  if (result.status === 'interrupted' || result.execution.task?.phase !== 'completed') return 'task-blocked'
  return undefined
}
