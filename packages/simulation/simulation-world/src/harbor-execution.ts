/** Serialized case IO, private observations and decision opportunities over the existing Native driver. */
import { isDeepStrictEqual } from 'node:util'
import { simulationChangeSchema, simulationWakeRequestSchema, SimulationStopBoundaryError } from '@clocky/clocky-simulation'
import type { SimulationEntityId, SimulationWorldPlan, WorldPlanId } from '@clocky/clocky-simulation'
import type { WorldExecutionBinding } from './providers.ts'
import type { WorldExecutionHandler } from './execution.ts'
import { HarborCase, harborHash } from './harbor-case.ts'
import { harborObservation, ownedHarborActors, harborOutcomes } from './harbor-domain.ts'
import { HARBOR_ACTORS, HARBOR_CURRENT, harborRequestSchema } from './harbor-protocol.ts'
import type { HarborCommand, HarborResult, HarborContract } from './harbor-protocol.ts'

/** Only the synchronous guard immediately before dispatch proves that this callback issued no judge command. */
class DispatchBlocked extends Error {}

/** Case execution has no business-policy loop: every action comes from a real actor's accepted request. */
export class HarborExecution implements WorldExecutionHandler {
  readonly definition
  readonly ref
  readonly generation
  private readonly judge: HarborCase

  /** @param binding - Canonical Native/Team owner.
   * @param source - Original case files.
   * @param root - Private per-run storage.
   * @param contract - Original immutable protocol of the accepted operation. */
  constructor(private readonly binding: WorldExecutionBinding, source: string, root: string,
    private readonly contract: HarborContract = HARBOR_CURRENT) {
    this.definition = contract.definition
    this.ref = contract.pin.implementationRef
    this.generation = contract.pin.generation
    const state = binding.run.snapshot()
    this.judge = new HarborCase(source, root, state.spec.runId, binding.lifetime, harborObservation(state) !== undefined)
  }

  reconciliationPlans(): readonly WorldPlanId[] {
    return Object.values(this.binding.run.snapshot().world?.executions ?? {}).filter(value => value.pin.domain === 'harbor'
      && (value.phase === 'armed' || value.phase === 'outcome-unknown')).map(value => value.planId)
  }

  retainsResponsibility(plan: SimulationWorldPlan): boolean {
    const world = this.binding.run.snapshot().world
    const phase = world?.executions[plan.id]?.phase
    return (phase === 'armed' || phase === 'outcome-unknown')
      && !Object.values(world?.results ?? {}).some(value => value.requestId === plan.requestId)
  }

  private recipients(command: HarborCommand, actor: string, receipt: HarborResult, day: number): string[] {
    if (!receipt.ok) return command.kind === 'act' ? [actor] : []
    if (command.kind === 'wake') return [...new Set(command.actors)]
    if (command.kind !== 'act') return []
    return [...new Set(command.actions.flatMap((action) => {
      if (action.kind === 'message') return receipt.day + action.delayDays <= day ? action.to : []
      return 'to' in action ? [action.to] : []
    }).filter(id => (HARBOR_ACTORS as readonly string[]).includes(id) && id !== actor))]
  }

  private wakeId(planId: string, actor: string): string { return `harbor-reply:${harborHash(planId)}:${actor}` }

  async execute(plan: SimulationWorldPlan): Promise<'paused' | undefined> {
    try { await this.settle(plan, false) }
    catch (cause: unknown) {
      if (cause instanceof DispatchBlocked) return 'paused'
      throw cause
    }
    return undefined
  }

  private async settle(plan: SimulationWorldPlan, reconciliation: boolean): Promise<void> {
    const { run, lifetime } = this.binding
    lifetime.throwIfAborted()
    const request = run.snapshot().world?.requests[plan.requestId]
    if (request?.source.kind !== 'decision' || request.requesterEntityId === null || plan.proposal.resolution.kind !== 'apply')
      throw new Error('Harbor executes only an original actor decision')
    this.definition.schemas.plan.parse(plan.proposal.resolution.payload)
    const input = harborRequestSchema.parse(this.definition.schemas.request.parse(request.proposal.payload))
    if (this.contract.planMode === 'copy-original' && !isDeepStrictEqual(plan.proposal.resolution.payload, input)) throw new Error('Harbor execution changed its accepted input')
    const binding = request.source.binding
    const actor = input.command.kind === 'act' ? input.command.actor ?? request.requesterEntityId : request.requesterEntityId
    const teamIdentity = `${binding.teamId}/${binding.sessionId}`
    const receipt = reconciliation
      ? await this.judge.recordedResult(request.intentId, actor, teamIdentity, input.command)
      : await this.judge.execute(request.intentId, actor, teamIdentity, input.command, () => {
        try { run.checkStopBoundary(request.proposal, { requestId: request.id }) }
        catch (cause: unknown) {
          if (cause instanceof SimulationStopBoundaryError) throw new DispatchBlocked('Stop target refused dispatch', { cause })
          throw cause
        }
      })
    if (receipt === undefined) throw new Error('Harbor outcome remains unknown: no original receipt proves execution; reconciliation will not dispatch it')
    await run.commitWorldMutation({ planId: plan.id, payload: receipt })
    if (!reconciliation && run.controlObservation().phase === 'paused') {
      // A reached target prevents another running boundary; record the final public view before saving it.
      const publicState = await this.judge.overview()
      const overview = await this.judge.publicOverview(), docs = await this.judge.instructions(), current = run.snapshot()
      const target = current.entities['harbor-environment' as SimulationEntityId]
      if (target === undefined || target.cognition !== 'none') throw new Error('Harbor observation target is unavailable')
      await run.change(simulationChangeSchema.parse({ kind: 'entity/profile', id: target.id, entityRevision: target.revision,
        profile: { ...target.profile, harbor: { ...publicState, overview, ...docs, publishedAtNativeSequence: current.revision + 1 } } }),
      current.revision)
    }
  }

  async reconcile(plan: SimulationWorldPlan): Promise<void> { await this.settle(plan, true) }

  /** Publish one recorded observation or one wake at a quiescent boundary; no actor policy or future event is generated. */
  async settleBoundary(): Promise<boolean> {
    const { run, lifetime } = this.binding
    lifetime.throwIfAborted()
    const state = run.snapshot()
    if (state.phase !== 'running' || state.activeWindowId !== undefined) return false
    const publicState = await this.judge.overview(), prior = harborObservation(state)
    if (prior !== undefined && (publicState.revision < prior.revision || publicState.day < prior.day))
      throw new Error('The original Harbor journal regressed behind its recorded Native observation')
    const latestReceipt = Object.values(state.world?.results ?? {}).reduce((latest, result) =>
      state.world?.intents[result.intentId]?.pin.domain === 'harbor' ? Math.max(latest, result.sequence) : latest, 0)
    if (prior?.revision !== publicState.revision || prior.publishedAtNativeSequence === undefined
      || prior.publishedAtNativeSequence < latestReceipt) {
      const overview = await this.judge.publicOverview(), docs = await this.judge.instructions()
      const current = run.snapshot(), target = current.entities['harbor-environment' as SimulationEntityId]
      if (target === undefined || target.cognition !== 'none') throw new Error('Harbor observation target is unavailable')
      await run.change(simulationChangeSchema.parse({ kind: 'entity/profile', id: target.id, entityRevision: target.revision,
        profile: { ...target.profile, harbor: { ...publicState, overview, ...docs, publishedAtNativeSequence: current.revision + 1 } } }),
      current.revision)
      return true
    }
    // A frozen drain may reconcile accepted effects, but never creates another autonomous business opportunity.
    const control = state.runControl?.current
    if (control !== undefined && (control.activation === 'pending' || control.state === 'draining' || control.state === 'paused')) return false
    const pendingActors = new Set([
      ...Object.values(state.scheduledEvents).flatMap(event => event.status === 'pending' && event.action.kind === 'wake'
        ? [event.action.entityId] : []),
      ...Object.values(state.wakes).filter(wake => wake.status === 'pending').map(wake => wake.entityId),
    ])
    for (const actor of HARBOR_ACTORS) {
      if (!pendingActors.has(actor as SimulationEntityId)) continue
      const target = state.entities[`harbor-view-${actor}` as SimulationEntityId]
      if (target === undefined) throw new Error('Harbor private observation target is unavailable')
      if (target.profile.caseRevision === publicState.revision) continue
      const views: Record<string, import('@clocky/clocky-simulation').SimulationWorldJsonValue> = {}
      for (const represented of ownedHarborActors(state, actor)) views[represented] = await this.judge.view(represented)
      await run.change(simulationChangeSchema.parse({ kind: 'entity/profile', id: target.id, entityRevision: target.revision,
        profile: { ...target.profile, caseRevision: publicState.revision, views } }), state.revision)
      return true
    }
    if (Object.values(state.scheduledEvents).some(event => event.status === 'pending')
      || Object.values(state.wakes).some(wake => wake.status === 'pending' || wake.status === 'claimed')
      || Object.values(state.operations).some(operation => operation.result === undefined)
      || Object.values(state.world?.requests ?? {}).some(request => request.status === 'open')) return false
    // A decision opportunity is not an action: a role can submit no effects, and only the coordinator chooses date advancement.
    for (const actor of HARBOR_ACTORS) {
      const id = `harbor-initial:${actor}`
      if (state.scheduledEvents[id as never] !== undefined) continue
      await run.scheduleWake(simulationWakeRequestSchema.parse({ id, entityId: actor, time: String(publicState.day),
        reason: JSON.stringify({ kind: 'world-goal', version: 1,
          goal: 'Review the current day and your own case view. Independently decide whether a business or organizational action is useful. Do not invent future history.' }) }), state.revision)
      return true
    }
    const completed = harborOutcomes(state)
    const goals = Object.values(state.decisions).filter(decision => decision.status === 'accepted'
      && decision.context?.status === 'prepared' && decision.context.world?.kind === 'goal')
      .sort((a, b) => BigInt(a.slot) < BigInt(b.slot) ? -1 : BigInt(a.slot) > BigInt(b.slot) ? 1 : 0)
    const latestActor = goals.findLast(decision => decision.entityId !== 'coordinator')
    const latestGoal = goals.at(-1)
    const results = completed.map(value => value.receipt)
    if (results.some(result => result.command === 'finish' && result.ok)) return false
    const coordinatorId = `harbor-coordinate:${publicState.day}:${Object.keys(state.world?.requests ?? {}).length}:${latestActor?.slot ?? 'none'}`
    // Explicit actor batches settle before returning to the initiator; unsolicited reactions alternate with it.
    for (const kind of ['wake', 'act'] as const) {
      if (kind === 'act' && latestGoal?.entityId !== 'coordinator' && state.scheduledEvents[coordinatorId as never] === undefined) continue
      for (const { result, request, command, receipt } of completed) {
        if (command.kind !== kind) continue
        if (result.source.kind !== 'plan') throw new Error('Harbor receipt has no original committed plan')
        if (request.requesterEntityId === null) continue
        for (const actor of this.recipients(command, request.requesterEntityId, receipt, publicState.day)) {
          const id = this.wakeId(result.source.planId, actor)
          if (state.scheduledEvents[id as never] !== undefined) continue
          if (command.kind === 'act' && goals.some(decision => decision.entityId === actor
            && decision.snapshotRevision >= result.sequence)) continue
          await run.scheduleWake(simulationWakeRequestSchema.parse({ id, entityId: actor,
            time: BigInt(state.time) > BigInt(publicState.day) ? state.time : String(publicState.day),
            reason: JSON.stringify({ kind: 'world-goal', version: 1,
              goal: command.kind === 'wake' ? command.reason : receipt.ok
                ? 'There is a new case-world interaction relevant to you. Read your updated private view and decide independently.'
                : 'The original case judge rejected your last action without committing it. Read the refreshed view and choose a valid response; do not repeat a stale request.' }) }), state.revision)
          return true
        }
      }
    }
    if (state.scheduledEvents[coordinatorId as never] !== undefined) return false
    const id = coordinatorId
    await run.scheduleWake(simulationWakeRequestSchema.parse({ id, entityId: 'coordinator', time: String(publicState.day),
      reason: JSON.stringify({ kind: 'world-goal', version: 1,
        goal: 'The currently admitted actor work has settled. Continue the original 365-day experiment: choose useful follow-up, checkpoints, recovery verification or the next date. '
          + 'Plan the remaining year in bounded multi-day stages. Prefer a longer permitted advance when current evidence supports it, and choose roles with concrete follow-up instead of default daily polling of every role. '
          + 'At day 365 audit and produce the factual final report. Do not replace actor decisions with scripted policies.' }) }), state.revision)
    return true
  }
}
