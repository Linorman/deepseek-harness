/** Native result and entity bindings own administrative review authority. @module @clocky/clocky-simulation-team/task-review */
import { z } from 'zod'
import { isDeepStrictEqual } from 'node:util'
import type { Context } from '@clocky/cordis'
import { taskAttemptIdSchema } from '@clocky/clocky-team'
import type { SimulationTaskReviewScope, TeamSystemTaskReviewProof, TeamTaskSnapshot } from '@clocky/clocky-team'
import { simulationEntityIdSchema } from '@clocky/clocky-simulation'
import type { SimulationRun } from '@clocky/clocky-simulation'
import type { SimulationTaskReviewRequest } from './types.ts'

const canonicalText = z.string().min(1).refine(value => value === value.trim(), 'Review text must be nonempty and trimmed')
const requestSchema = z.strictObject({ commandId: canonicalText, attemptId: taskAttemptIdSchema,
  reviewerEntityId: simulationEntityIdSchema, expectedRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  nextPhase: z.enum(['completed', 'pending']), reason: canonicalText }) satisfies z.ZodType<SimulationTaskReviewRequest>

/** One effect-scoped proof owner; no serializable or model-facing reviewer capability is issued. */
export class SimulationTaskReviewAuthority {
  private readonly proofs = new WeakMap<TeamSystemTaskReviewProof, () => SimulationTaskReviewScope | undefined>()

  constructor(private readonly ctx: Context) {
    ctx.teams.registerSystemTaskReviewProofSource({ name: 'simulation-team', resolveTaskReviewProof: proof => this.proofs.get(proof)?.() })
  }

  /**
   * Resolve the original result and reviewer again whenever the Hub checks its proof.
   * @param run - Attached canonical native result owner.
   * @param lifecycleOwner - Immutable execution Team rule.
   * @param request - Exact retry payload; changed accepted payloads reject in the Hub.
   * @param accepting - Connection and optional caller lease admission, including service unload and checkpoint fences.
   * @returns canonical task after review or a historical identical acceptance; no writer residency is needed.
   */
  async review(run: SimulationRun, lifecycleOwner: string, request: SimulationTaskReviewRequest,
    accepting: () => boolean): Promise<TeamTaskSnapshot> {
    const selected = requestSchema.parse(request)
    const resolve = (): SimulationTaskReviewScope | undefined => {
      const state = run.snapshot()
      if (!accepting() || state.phase !== 'running' && state.phase !== 'paused') return undefined
      const execution = state.taskExecutions?.[selected.attemptId]
      if (execution?.result?.request.outcome.kind !== 'completed' || execution.retired !== undefined) return undefined
      const source = execution.request, operation = state.operations[source.operationId]
      const creator = operation === undefined ? undefined : state.entities[operation.entityId]?.binding
      const executor = state.entities[source.entityId]?.binding
      const reviewer = state.entities[selected.reviewerEntityId]
      const receipt = operation?.outbox?.taskReceipt
      const outcome = execution.result.request.outcome
      if (operation?.action.kind !== 'task/create' || operation.result?.status !== 'applied'
        || operation.id !== source.operationId || state.spec.runId !== source.runId
        || receipt?.operationId !== operation.id || receipt.teamId !== source.teamId || receipt.taskId !== source.taskId
        || operation.action.task.reviewPolicy.kind !== 'participant'
        || creator?.teamId !== source.teamId || executor?.teamId !== source.teamId
        || executor.participantId !== source.participantId || executor.sessionId !== source.sessionId
        || reviewer?.phase !== 'active' || reviewer.binding?.teamId !== source.teamId
        || reviewer.binding.participantId !== operation.action.task.reviewPolicy.reviewerId) return undefined
      return { kind: 'simulation-task-review', runId: source.runId, commandId: selected.commandId,
        operationId: source.operationId, teamId: source.teamId, taskId: source.taskId, lifecycleOwner,
        creatorId: creator.participantId, initiatorId: source.participantId, reviewerId: reviewer.binding.participantId,
        reviewerSessionId: reviewer.binding.sessionId, attemptId: selected.attemptId, expectedRevision: selected.expectedRevision,
        nextPhase: selected.nextPhase, reason: selected.reason, outcome }
    }
    const initial = resolve()
    if (initial === undefined) throw new Error('Simulation review requires its original completed result and exact active reviewer binding')
    const token = {}
    Object.defineProperty(token, 'toJSON', { value: (): never => { throw new TypeError('Simulation task review proof is runtime-only') } })
    const proof = Object.freeze(token) as TeamSystemTaskReviewProof
    this.proofs.set(proof, () => {
      const current = resolve()
      return isDeepStrictEqual(current, initial) ? current : undefined
    })
    try { return await this.ctx.teams.resolveSimulationTaskReview({ actor: proof }) }
    finally { this.proofs.delete(proof) }
  }
}
