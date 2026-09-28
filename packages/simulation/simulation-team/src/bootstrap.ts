/** Durable root-Team creation owned by the run coordinator. @module @clocky/clocky-simulation-team/bootstrap */
import { isDeepStrictEqual } from 'node:util'
import type { Context } from '@clocky/cordis'
import { teamRootCreateInputSchema } from '@clocky/clocky-team'
import type { SimulationRootCreationScope, TeamRootCreateInput, TeamStateSnapshot, TeamSystemRootCreationProof } from '@clocky/clocky-team'
import type { SimulationRun } from '@clocky/clocky-simulation'

/** Runtime proof source; accepted target IO drains before the run releases its coordinator lock. */
export class SimulationBootstrapAuthority {
  private readonly proofs = new WeakMap<TeamSystemRootCreationProof, () => SimulationRootCreationScope | undefined>()
  private readonly pending = new Map<SimulationRun, { input: TeamRootCreateInput; work: Promise<TeamStateSnapshot> }>()

  constructor(private readonly ctx: Context, private readonly accepting: () => boolean) {
    ctx.teams.registerSystemRootCreationProofSource({ name: 'simulation-team', resolveRootCreationProof: proof => this.proofs.get(proof)?.() })
  }

  /**
   * Reserve and create one exact root Team, or reconcile its original identity after response loss.
   * @param run - Open run without an attached lifecycle owner.
   * @param creation - Explicit goal, budgets and optional authority grant.
   * @param owner - Exact immutable lifecycle owner name.
   * @returns the confirmed canonical Team; concurrent equal requests share their target operation.
   */
  ensure(run: SimulationRun, creation: Omit<TeamRootCreateInput, 'rules'>, owner: string): Promise<TeamStateSnapshot> {
    if (!this.accepting()) return Promise.reject(new Error('Simulation bootstrap is closed'))
    if (owner.length === 0 || owner.trim() !== owner) return Promise.reject(new Error('Simulation lifecycle owner must be a nonempty trimmed name'))
    const parsed = teamRootCreateInputSchema.parse({ ...creation,
      rules: { simulationRunId: run.snapshot().spec.runId, activationLifecycleOwner: owner } })
    const input = { ...parsed, goal: { ...parsed.goal, objective: parsed.goal.objective.trim() } }
    if (input.authorityGrant === undefined) delete input.authorityGrant
    if (input.goal.objective.length === 0) return Promise.reject(new Error('Simulation Team objective must not be empty'))
    const existing = this.pending.get(run)
    if (existing !== undefined) {
      if (!isDeepStrictEqual(existing.input, input)) return Promise.reject(new Error('Simulation bootstrap already has another creation payload in flight'))
      return existing.work
    }
    const remove = run.onClose(async () => { await Promise.allSettled([work]) })
    const work = this.create(run, input, owner).finally(() => { this.pending.delete(run); remove() })
    this.pending.set(run, { input, work })
    return work
  }

  /** Drain accepted root creation before this authority is unloaded. */
  async drain(): Promise<void> { await Promise.allSettled([...this.pending.values()].map(value => value.work)) }

  private async create(run: SimulationRun, input: TeamRootCreateInput, owner: string): Promise<TeamStateSnapshot> {
    const reserved = (await run.reserveTeam(input, run.snapshot().revision)).teamReservation
    if (reserved === undefined) throw new Error('Simulation run omitted its reserved Team identity')
    if (!this.accepting()) throw new Error('Simulation bootstrap retired before Team creation')
    if (reserved.confirmed) return await this.ctx.teams.getTeam({ teamId: reserved.teamId })
    const scope: SimulationRootCreationScope = { ...reserved.creation, kind: 'simulation-root-create',
      runId: run.snapshot().spec.runId, lifecycleOwner: owner, teamId: reserved.teamId }
    const token: object = {}
    Object.defineProperty(token, 'toJSON', { enumerable: true, value: (): never => { throw new TypeError('Simulation bootstrap proof is runtime-only') } })
    const proof = Object.freeze(token) as TeamSystemRootCreationProof
    this.proofs.set(proof, () => {
      const current = run.snapshot().teamReservation
      return this.accepting() && current?.teamId === scope.teamId && isDeepStrictEqual(current.creation, input) ? scope : undefined
    })
    try {
      const team = await this.ctx.teams.createTeam({ actor: proof, ...input })
      if (team.team.id !== reserved.teamId) throw new Error('Simulation target returned another Team identity')
      await run.confirmTeam(team.team.id, run.snapshot().revision)
      return team
    } finally { this.proofs.delete(proof) }
  }
}
