/** Journal-owned authority for one exact idempotent Team task creation. @module @clocky/clocky-simulation-team/task-transport */
import { taskInteractionExecutable } from '@clocky/clocky-simulation'
import { isDeepStrictEqual } from 'node:util'
import type { Context } from '@clocky/cordis'
import { teamTaskCreateIdempotencyKeySchema, TeamError } from '@clocky/clocky-team'
import type { SimulationTaskCreateScope, SimulationTaskAssignScope, SimulationTaskStartScope, SimulationTaskSettleScope,
  SimulationTaskCancelScope, TeamSystemTaskControlProof, TeamId, TaskAttemptId, TeamTaskSnapshot } from '@clocky/clocky-team'
import type { SimulationRun, SimulationTaskTransport, SimulationOutboundTask } from '@clocky/clocky-simulation'

/** Resolves only transient task proofs derived from currently executing durable outbox attempts. */
export class SimulationTaskAuthority {
  private readonly proofs = new WeakMap<TeamSystemTaskControlProof,
    () => SimulationTaskCreateScope | SimulationTaskAssignScope | SimulationTaskStartScope | SimulationTaskSettleScope
      | SimulationTaskCancelScope | undefined>()

  constructor(private readonly ctx: Context) {
    ctx.teams.registerSystemTaskControlProofSource({ name: 'simulation-team', resolveTaskControlProof: proof => this.proofs.get(proof)?.() })
  }

  /**
   * Commit canonical cancellation before waiting on the affected task actor or executor.
   * @param run - Exact retained accepted task creation owner.
   * @param lifecycleOwner - Canonical Simulation lifecycle rule.
   * @param request - Current task revision, exact live attempt or null and optional immutable reason.
   * @param accepting - Current connection and caller admission lease, rechecked by the Hub around policy IO.
   * @returns canonical task cancellation/terminal fact; accepted intent is mirrored to Native before physical cleanup.
   */
  async cancel(run: SimulationRun, lifecycleOwner: string, request: {
    readonly operationId: import('@clocky/clocky-simulation').SimulationOperationId
    readonly expectedRevision: number
    readonly expectedAttemptId: TaskAttemptId | null
    readonly reason?: string | undefined
  }, accepting: () => boolean): Promise<TeamTaskSnapshot> {
    const selected = { ...request }
    const operation = run.snapshot().operations[selected.operationId], receipt = operation?.outbox?.taskReceipt
    if (operation?.action.kind !== 'task/create' || operation.result?.status !== 'applied' || receipt === undefined) {
      throw new Error('Simulation task cancellation requires its exact accepted creation')
    }
    const resolve = (): SimulationTaskCancelScope | undefined => {
      const state = run.snapshot(), source = state.operations[selected.operationId]
      /* v8 ignore next -- the accepted creation above is append-only; a later snapshot cannot lose that operation. */
      const creator = source === undefined ? undefined : state.entities[source.entityId]?.binding
      if (!accepting() || creator?.teamId !== receipt.teamId || source?.action.kind !== 'task/create'
        || source.result?.status !== 'applied' || source.outbox?.taskReceipt?.taskId !== receipt.taskId) return undefined
      if (selected.expectedAttemptId !== null) {
        const execution = state.taskExecutions?.[selected.expectedAttemptId]
        if (execution?.request.operationId !== selected.operationId || execution.request.teamId !== receipt.teamId
          || execution.request.taskId !== receipt.taskId) return undefined
      }
      return { kind: 'simulation-task-cancel', runId: state.spec.runId, operationId: selected.operationId,
        creatorId: creator.participantId, lifecycleOwner, input: { teamId: receipt.teamId, taskId: receipt.taskId,
          runId: state.spec.runId, operationId: selected.operationId, expectedRevision: selected.expectedRevision,
          expectedAttemptId: selected.expectedAttemptId, ...selected.reason === undefined ? {} : { reason: selected.reason } } }
    }
    const scope = resolve()
    if (scope === undefined) throw new Error('Simulation task cancellation admission is unavailable')
    const token: object = {}
    Object.defineProperty(token, 'toJSON', { value: (): never => { throw new TypeError('Simulation task proof is runtime-only') } })
    const proof = Object.freeze(token) as TeamSystemTaskControlProof
    this.proofs.set(proof, resolve)
    let task: TeamTaskSnapshot
    try { task = await this.ctx.teams.cancelRuntimeTask({ actor: proof, ...scope.input }) }
    finally { this.proofs.delete(proof) }
    if (task.cancellation !== undefined) {
      await run.recordTaskCancellation({ operationId: selected.operationId, teamId: receipt.teamId,
        taskId: receipt.taskId, cancellation: task.cancellation })
    }
    return task
  }

  /**
   * Assign only the task attempt already reserved by the source run.
   * @param run - Durable reservation and writer owner.
   * @param attemptId - Exact retained attempt identity.
   * @param lifecycleOwner - Canonical Team activation owner.
   * @param accepting - Connection admission predicate, rechecked by the proof resolver after IO.
   * @returns canonical assigned task; failed IO leaves its native reservation available for exact reconciliation.
   */
  async assign(run: SimulationRun, attemptId: TaskAttemptId, lifecycleOwner: string,
    accepting: () => boolean): Promise<TeamTaskSnapshot> {
    const resolve = (): SimulationTaskAssignScope | undefined => {
      const state = run.snapshot()
      const execution = Object.hasOwn(state.taskExecutions ?? {}, attemptId) ? state.taskExecutions?.[attemptId] : undefined
      if (execution === undefined || execution.retired !== undefined || !accepting() || state.phase !== 'running' || state.activeWindowId !== undefined) return undefined
      if (state.taskCancellations?.[execution.request.operationId] !== undefined) return undefined
      const request = execution.request
      if (!taskInteractionExecutable(state, request)) return undefined
      const operation = state.operations[request.operationId]
      const creatorId = operation === undefined ? undefined : state.entities[operation.entityId]?.binding?.participantId
      if (creatorId === undefined) return undefined
      const entity = state.entities[request.entityId]
      const writer = entity?.writer
      if (entity?.phase !== 'active' || writer?.phase !== 'active' || writer.epoch !== request.epoch) return undefined
      return { kind: 'simulation-task-assign', creatorId, ordinal: request.ordinal, runId: request.runId, operationId: request.operationId,
        entityId: request.entityId, epoch: request.epoch, lifecycleOwner, sessionId: request.sessionId,
        reservationId: request.reservationId, input: { teamId: request.teamId, taskId: request.taskId,
          expectedRevision: request.taskRevision, participantId: request.participantId, activationId: request.activationId,
          attemptId, leaseDurationMs: request.leaseDurationMs } }
    }
    const scope = resolve()
    if (scope === undefined) throw new Error('Simulation task assignment requires its current reserved writer')
    const token: object = {}
    Object.defineProperty(token, 'toJSON', { value: (): never => { throw new TypeError('Simulation task proof is runtime-only') } })
    const proof = Object.freeze(token) as TeamSystemTaskControlProof
    this.proofs.set(proof, resolve)
    try { return await this.ctx.teams.assignSimulationTask({ actor: proof, ...scope.input }) }
    finally { this.proofs.delete(proof) }
  }

  /**
   * Start only an assigned task whose exact decision input has been recorded after Session persistence.
   * @param run - Original task reservation and current writer owner.
   * @param attemptId - Exact retained task attempt.
   * @param decisionId - Associated prepared task decision.
   * @param lifecycleOwner - Canonical activation lifecycle rule.
   * @param accepting - Connection admission fence, rechecked throughout the Hub policy path.
   * @returns current running task, or a retained running attempt without another start append.
   */
  async start(run: SimulationRun, attemptId: TaskAttemptId,
    decisionId: import('@clocky/clocky-simulation').SimulationDecisionId, lifecycleOwner: string,
    accepting: () => boolean): Promise<TeamTaskSnapshot> {
    const execution = run.snapshot().taskExecutions?.[attemptId]
    if (execution === undefined) throw new Error('Simulation task start has no reserved attempt')
    const request = execution.request
    const task = await this.ctx.teams.getTask({ teamId: request.teamId, taskId: request.taskId })
    const resolve = (): SimulationTaskStartScope | undefined => {
      const state = run.snapshot()
      const current = state.taskExecutions?.[attemptId]
      const association = current?.decisions?.find(value => value.request.decisionId === decisionId)
      const decision = state.decisions[decisionId]
      if (state.taskCancellations?.[request.operationId] !== undefined) return undefined
      const entity = state.entities[request.entityId]
      const operation = state.operations[request.operationId]
      const creatorId = operation === undefined ? undefined : state.entities[operation.entityId]?.binding?.participantId
      if (!accepting() || current?.retired !== undefined || association?.input === undefined
        || creatorId === undefined || state.phase !== 'running' || entity?.writer?.phase !== 'active'
        || entity.writer.epoch !== request.epoch || decision?.status !== 'open' || decision.epoch !== request.epoch
        || decision.context?.status !== 'prepared' || decision.context.view.inputId !== association.input.id) return undefined
      return { kind: 'simulation-task-start', creatorId, ordinal: request.ordinal, runId: request.runId,
        operationId: request.operationId, entityId: request.entityId, epoch: request.epoch, lifecycleOwner,
        sessionId: request.sessionId, reservationId: request.reservationId, decisionId, inputId: association.input.id,
        input: { teamId: request.teamId, taskId: request.taskId, attemptId, expectedRevision: task.revision } }
    }
    const scope = resolve()
    if (scope === undefined) throw new Error('Simulation task start requires its durable input and current writer')
    if (task.lease?.attemptId === attemptId && task.phase === 'running') return task
    const token: object = {}
    Object.defineProperty(token, 'toJSON', { value: (): never => { throw new TypeError('Simulation task proof is runtime-only') } })
    const proof = Object.freeze(token) as TeamSystemTaskControlProof
    this.proofs.set(proof, resolve)
    try { return await this.ctx.teams.startSimulationTaskAttempt({ actor: proof, ...scope.input }) }
    finally { this.proofs.delete(proof) }
  }

  /**
   * Settle only the result retained by the task's original live writer.
   * @param run - Durable result and native writer owner.
   * @param attemptId - Exact task attempt whose result is retained.
   * @param lifecycleOwner - Canonical Team activation owner.
   * @param accepting - Current connection admission fence.
   * @returns canonical task receipt after ordinary result/review/budget checks.
   */
  async settle(run: SimulationRun, attemptId: TaskAttemptId, lifecycleOwner: string,
    accepting: () => boolean): Promise<TeamTaskSnapshot> {
    const execution = run.snapshot().taskExecutions?.[attemptId]
    if (execution?.result === undefined) throw new Error('Simulation task settlement has no retained result')
    const request = execution.request
    const task = await this.ctx.teams.getTask({ teamId: request.teamId, taskId: request.taskId })
    const resolve = (): SimulationTaskSettleScope | undefined => {
      const state = run.snapshot()
      const current = state.taskExecutions?.[attemptId]
      const entity = state.entities[request.entityId]
      if (state.taskCancellations?.[request.operationId] !== undefined && current?.result?.request.outcome.kind === 'completed') return undefined
      const operation = state.operations[request.operationId]
      const creatorId = operation === undefined ? undefined : state.entities[operation.entityId]?.binding?.participantId
      if (!accepting() || current?.retired !== undefined || current?.result === undefined || creatorId === undefined
        || entity?.writer?.phase !== 'active' || entity.writer.epoch !== request.epoch) return undefined
      return { kind: 'simulation-task-settle', creatorId, ordinal: request.ordinal, runId: request.runId,
        operationId: request.operationId, entityId: request.entityId, epoch: request.epoch, lifecycleOwner,
        sessionId: request.sessionId, reservationId: request.reservationId,
        input: { teamId: request.teamId, taskId: request.taskId, attemptId, expectedRevision: task.revision,
          outcome: current.result.request.outcome } }
    }
    const scope = resolve()
    if (scope === undefined) throw new Error('Simulation task settlement requires its current result writer')
    const token: object = {}
    Object.defineProperty(token, 'toJSON', { value: (): never => { throw new TypeError('Simulation task proof is runtime-only') } })
    const proof = Object.freeze(token) as TeamSystemTaskControlProof
    this.proofs.set(proof, resolve)
    try { return await this.ctx.teams.settleSimulationTaskAttempt({ actor: proof, ...scope.input }) }
    finally { this.proofs.delete(proof) }
  }

  /**
   * Bind task dispatch to a canonical run and its dedicated Team.
   * @param run - Durable source operation owner.
   * @param teamId - Exact target Team.
   * @param lifecycleOwner - Frozen Team lifecycle-owner rule.
   * @param accepting - Whether new target effects remain admitted.
   * @returns source-authorized task transport with idempotent target reconciliation.
   */
  transport(run: SimulationRun, teamId: TeamId, lifecycleOwner: string, accepting: () => boolean): SimulationTaskTransport {
    return { createTask: async (message) => {
      const resolve = () => taskScope(run, teamId, lifecycleOwner, message, accepting())
      const scope = resolve()
      if (scope === undefined) throw new Error('Simulation task transport has no exact accepted due intent')
      const token: object = {}
      Object.defineProperty(token, 'toJSON', { value: (): never => { throw new TypeError('Simulation task proof is runtime-only') } })
      const proof = Object.freeze(token) as TeamSystemTaskControlProof
      this.proofs.set(proof, resolve)
      try {
        const team = await this.ctx.teams.getTeam({ teamId })
        const task = await this.ctx.teams.createSimulationTask({ actor: proof, ...scope.input, expectedCursor: team.team.cursor })
        return { status: 'applied', taskReceipt: { operationId: message.operationId, fingerprint: message.fingerprint, teamId, taskId: task.id } }
      } catch (error: unknown) {
        if (error instanceof TeamError && (error.code === 'TEAM_POLICY_DENIED' || error.code === 'TEAM_GRANT_DENIED')) {
          return { status: 'blocked-authority', code: error.code }
        }
        if (error instanceof TeamError && error.code === 'TEAM_TASK_IDEMPOTENCY_CONFLICT') return { status: 'rejected', code: error.code }
        throw error
      } finally { this.proofs.delete(proof) }
    } }
  }
}

function taskScope(run: SimulationRun, teamId: TeamId, lifecycleOwner: string, message: SimulationOutboundTask,
  accepting: boolean): SimulationTaskCreateScope | undefined {
  const state = run.snapshot()
  const operation = state.operations[message.operationId]
  const decision = state.decisions[message.decisionId]
  const entity = state.entities[message.entityId]
  if (operation?.action.kind !== 'task/create' || operation.decisionId !== message.decisionId || operation.entityId !== message.entityId
    || operation.status !== 'pending' || operation.result !== undefined || !operation.outbox?.ready
    || operation.outbox.attempts.at(-1)?.outcome !== 'in-flight' || BigInt(state.time) < BigInt(operation.action.deliverAt)
    || decision?.status !== 'accepted' || decision.closedAt === undefined || state.spec.runId !== message.runId
    || operation.fingerprint !== message.fingerprint || !isDeepStrictEqual(operation.action.task, message.task)
    || entity?.binding?.teamId !== teamId || !isDeepStrictEqual(entity.binding, message.sender)
    || operation.dependencies.some(id => state.operations[id]?.result?.status !== 'applied')) return undefined
  return { kind: 'simulation-task-create', runId: message.runId, operationId: message.operationId,
    lifecycleOwner, participantId: entity.binding.participantId,
    publishAllowed: accepting && state.phase === 'running' && entity.phase === 'active' && message.publishAllowed,
    input: { teamId, createCommand: { idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse(JSON.stringify([
      'simulation-task', message.runId, message.operationId,
    ])) }, ...message.task, execution: { kind: 'participant' } } }
}
