/** Journal-owned authority for one exact idempotent Team task creation. @module @clocky/clocky-simulation-team/task-transport */
import { isDeepStrictEqual } from 'node:util'
import type { Context } from '@clocky/cordis'
import { teamTaskCreateIdempotencyKeySchema, TeamError } from '@clocky/clocky-team'
import type { SimulationTaskCreateScope, TeamSystemTaskControlProof, TeamId } from '@clocky/clocky-team'
import type { SimulationRun, SimulationTaskTransport, SimulationOutboundTask } from '@clocky/clocky-simulation'

/** Resolves only transient task proofs derived from currently executing durable outbox attempts. */
export class SimulationTaskAuthority {
  private readonly proofs = new WeakMap<TeamSystemTaskControlProof, () => SimulationTaskCreateScope | undefined>()

  constructor(private readonly ctx: Context) {
    ctx.teams.registerSystemTaskControlProofSource({ name: 'simulation-team', resolveTaskControlProof: proof => this.proofs.get(proof)?.() })
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
