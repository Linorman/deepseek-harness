import { requiredWorldContext } from './required-context.ts'
import { generationPlanInput, simulationGeneratedPlanSchema } from '@clocky/clocky-simulation'
import { STARTUP_NOTICE_POLICY } from './startup-notice.ts'
/** Wake-driven cognition and structural maintenance over public Native/Team capabilities. */
import { isDeepStrictEqual } from 'node:util'
import type { Context } from '@clocky/cordis'
import { activeSimulationMaintenance, simulationDecisionIdSchema,
  simulationWindowIdSchema, parseSimTime,
  simulationWorldGoalSchema, personnelRetired, SimulationRevisionConflictError } from '@clocky/clocky-simulation'
import type { SimulationRun, SimulationSnapshot, SimulationEntityId, SimulationContextRequest, SimulationDecisionId,
  SimulationEventId, SimulationWorldContextRequest, SimTime } from '@clocky/clocky-simulation'
import type { ResolvedWorldScenario, ResolvedWorldScenarioV1 } from '@clocky/clocky-simulation-scenario'
import type { SimulationTeamConnection, SimulationResidencyChoice } from '@clocky/clocky-simulation-team'
import type { SimulationWorldDriverAnchor, SimulationWorldDriveResult } from './types.ts'
import { WorldExecutionDispatcher } from './execution.ts'
import type { WorldExecutionHandler } from './execution.ts'

/** One caller-owned pump; construction/reading never opens a run, attaches an owner or requests inference. */
export class SimulationWorldDriver {
  private pending: Promise<SimulationWorldDriveResult> | undefined
  private pendingUntil: SimTime | undefined
  private readonly executions: WorldExecutionDispatcher

  /**
   * @param run - Exclusive original Native run, already prepared or explicitly restored.
   * @param connection - Canonical connection for this run's immutable lifecycle owner.
   * @param resolved - Original accepted compilation; retries never reread current deployment templates.
   * @param anchor - Original completed or restored checkpoint and bounded collection policy.
   * @param lifetime - Owner lifetime, independent of any HTTP waiter; caller must drain before retirement.
   * @param handlers - Explicit installed domain execution adapters; there is no built-in provider fallback.
   * @param executionScope - Plugin effect owner; unload closes admission, drains callbacks and reports retained unknown duty.
   */
  constructor(private readonly run: SimulationRun, private readonly connection: SimulationTeamConnection,
    private readonly resolved: ResolvedWorldScenario | ResolvedWorldScenarioV1, private readonly anchor: SimulationWorldDriverAnchor,
    private readonly lifetime: AbortSignal, executionScope: Pick<Context, 'effect'>, handlers: readonly WorldExecutionHandler[]) {
    const state = run.snapshot(), { runId: _runId, ...native } = state.spec
    if (!isDeepStrictEqual(native, resolved.native)
      || !isDeepStrictEqual(state.world?.definition, resolved.world)
      || state.teamReservation?.creation.rules['activationLifecycleOwner'] !== anchor.ownerName
      || !Number.isSafeInteger(anchor.maxDrainRounds) || anchor.maxDrainRounds < 1
      || !Number.isSafeInteger(anchor.maxAttempts) || anchor.maxAttempts < 1) {
      throw new Error('World driver requires its original compiled definition, owner and bounded checkpoint policy')
    }
    this.executions = new WorldExecutionDispatcher(run)
    for (const handler of handlers) executionScope.effect(() => this.executions.register(handler))
    this.executions.validateProviders()
  }

  /**
   * Run one finite Native-budgeted batch; paused/read-only entry never activates or infers.
   * @param until - Optional canonical simulated horizon; due work runs but future events beyond it remain queued.
   * @returns shared admitted batch with its current durable revision and exact stop reason.
   */
  advance(until?: SimTime): Promise<SimulationWorldDriveResult> {
    if (this.pending !== undefined) {
      if (until !== this.pendingUntil) return Promise.reject(new Error('A running World batch retains its original simulated horizon'))
      return this.pending
    }
    if (until !== undefined) {
      const state = this.run.snapshot()
      parseSimTime(until, state.spec.maxTime)
      if (BigInt(until) < BigInt(state.time)) return Promise.reject(new Error('A World batch cannot rewind its simulated horizon'))
    }
    let steps = 0
    const work = this.pump((step) => { steps = step }, until).catch((error: unknown) => {
      const state = this.run.snapshot()
      if (error instanceof SimulationRevisionConflictError) {
        if (state.phase !== 'running') return this.result(state.phase === 'stalled' ? this.stallReason(state) : state.phase, steps)
        return this.result('coordination-limit', steps)
      }
      if (state.phase === 'stalled') return this.result(this.stallReason(state), steps)
      throw error
    }).finally(() => { this.pending = undefined; this.pendingUntil = undefined })
    this.pending = work
    this.pendingUntil = until
    return work
  }

  /**
   * Execute or reconcile only an already accepted authenticated-user plan while paused.
   * @param planId - Exact retained direct plan; this cannot create a case, infer or pump unrelated scheduled work.
   * @returns its actual readiness/callback disposition; terminal original business results are only observed.
   */
  executeManagement(planId: import('@clocky/clocky-simulation').WorldPlanId): Promise<SimulationWorldDriveResult> {
    if (this.pending !== undefined) return Promise.reject(new Error('World owner must drain its current batch before targeted management'))
    const work = (async () => {
      this.lifetime.throwIfAborted()
      const state = this.run.snapshot(), plan = state.world?.plans[planId]
      if (plan?.operationId !== null || state.world?.requests[plan.requestId]?.operationId !== null)
        throw new Error('Targeted management requires its actual original authenticated-user direct plan')
      if (state.phase !== 'paused') return this.result(state.phase === 'stalled' ? this.stallReason(state) : 'maintenance-blocked', 0)
      const observation = state.world.executions[plan.id]
      if (observation?.phase === 'armed' || observation?.phase === 'outcome-unknown') {
        await this.executions.reconcile(plan)
        return this.result('paused', 1)
      }
      if (Object.values(state.world.results).some(value => value.requestId === plan.requestId)) return this.result('paused', 0)
      const reason = this.executions.readiness(plan)
      if (reason !== undefined) { await this.executions.blocked(plan, reason); return this.result(reason, 0) }
      const stopped = await this.executions.execute(plan)
      return this.result(stopped ?? 'paused', 1)
    })().finally(() => { this.pending = undefined; this.pendingUntil = undefined })
    this.pending = work
    return work
  }

  /** Await accepted work; cancellation does not imply that external owners have stopped. */
  async drain(): Promise<void> { await Promise.allSettled(this.pending === undefined ? [] : [this.pending]) }

  /**
   * Reconcile only already-retained preparation or cancellation responsibility while paused, without inference or resume.
   * @returns blocker or completion; an explicit scheduling owner may start only after this responsibility settles.
   */
  async reconcile(): Promise<SimulationWorldDriveResult> {
    this.lifetime.throwIfAborted()
    const state = this.run.snapshot(), maintenance = activeSimulationMaintenance(state)
    if (state.phase !== 'paused') return this.result(maintenance === undefined ? 'idle' : 'maintenance-blocked', 0)
    const settled = await this.executions.reconcilePending()
    if (!settled && maintenance !== undefined) throw new Error('World maintenance has no available original domain execution handler')
    return this.result(settled ? 'paused' : 'idle', settled ? 1 : 0)
  }

  private result(reason: SimulationWorldDriveResult['reason'], controlSteps: number,
    facts: Pick<SimulationWorldDriveResult, 'entityId' | 'nextAttemptAt'> = {}): SimulationWorldDriveResult {
    const state = this.run.snapshot()
    return { reason, controlSteps, revision: state.revision, time: state.time,
      ...facts.entityId === undefined ? {} : { entityId: facts.entityId },
      ...facts.nextAttemptAt === undefined ? {} : { nextAttemptAt: facts.nextAttemptAt } }
  }

  private runtime(id: SimulationEntityId): ResolvedWorldScenario['generatedActorRuntime'] {
    const initial = this.resolved.actors.find(actor => actor.entityId === id)
    if (initial !== undefined) return initial.runtime
    const generated = Object.values(this.run.snapshot().world?.reservations ?? {}).find(value =>
      value.identities.entityId === id && (value.status === 'committed' || value.candidate !== undefined))
    const representative = Object.values(this.run.snapshot().world?.external.representatives ?? {}).find(value =>
      value.identities.entityId === id && value.status === 'committed')
    if (generated === undefined && representative === undefined) throw new Error('World actor has no original runtime configuration')
    return this.resolved.generatedActorRuntime
  }

  private residency(id: SimulationEntityId): SimulationResidencyChoice {
    const state = this.run.snapshot(), entity = state.entities[id], runtime = this.runtime(id)
    return { activation: { provider: runtime.provider, seed: { kind: entity?.writer === undefined
      && !(state.experiment !== undefined && id.startsWith(`branch-${state.experiment.namespace}-`)) ? 'fresh' : 'resume' },
    agent: { preset: runtime.preset, options: { provider: runtime.model.provider, model: runtime.model.name } }, signal: this.lifetime },
    evict: Object.values(state.entities).filter(value => value.id !== id && value.cognition === 'agent' && value.readiness === 'ready')
      .map(value => value.id) }
  }

  private selector(state: SimulationSnapshot, id: SimulationEntityId, wakeId?: SimulationEventId):
  SimulationWorldContextRequest | undefined {
    const world = state.world
    if (world === undefined) throw new Error('World driver lost its frozen world')
    if (wakeId !== undefined) {
      const intent = Object.values(world.intents).find(value => wakeId === `world-initial:${value.id}`)
      if (intent !== undefined) return { kind: 'request', intentId: intent.id }
      const result = Object.values(world.results).find(value => wakeId === `simulation-world-result:${value.id}`)
      if (result !== undefined && world.requests[result.requestId]?.source.kind === 'decision')
        return { kind: world.requests[result.requestId]?.notificationOperationId === null
          ? 'scenario-result' : 'result', resultId: result.id }
      const adjudication = Object.values(world.external.events).find(value => value.status === 'consumed'
        && wakeId === `simulation-external-adjudication-result:${value.original.eventId}`)
      if (adjudication !== undefined && world.requests[adjudication.original.requestId]?.source.kind === 'decision')
        return { kind: world.requests[adjudication.original.requestId]?.notificationOperationId === null
          ? 'scenario-result' : 'result', resultId: adjudication.original.initialResultId,
        externalEventId: adjudication.original.eventId }
      const first = Object.values(world.results).find(value => wakeId === `simulation-world-first:${value.intentId}`)
      if (first !== undefined) return { kind: 'first-action', resultId: first.id }
      const challenge = Object.values(world.evidence.challenges).find(value =>
        wakeId === `simulation-delivery:${value.notificationOperationId}`)
      if (challenge !== undefined) return challenge.status === 'awaiting' && challenge.responders.includes(id)
        && world.requests[challenge.requestId]?.status === 'awaiting-evidence'
        ? { kind: 'evidence', challengeId: challenge.id } : undefined
      const revision = Object.values(world.evidence.revisions).find(value =>
        wakeId === `simulation-delivery:${value.notificationOperationId}`)
      if (revision !== undefined) return id === world.definition.directorEntityId
        && world.requests[revision.requestId]?.status === 'open'
        && !Object.values(world.evidence.revisions).some(value =>
          value.requestId === revision.requestId && value.revision > revision.revision)
        ? { kind: 'resolve', requestId: revision.requestId } : undefined
      const request = Object.values(world.requests).find(value => value.source.kind === 'decision'
        && wakeId === `simulation-delivery:${value.notificationOperationId}`)
      if (request !== undefined) return id === world.definition.directorEntityId && request.status === 'open'
        && !Object.values(world.evidence.challenges).some(value => value.requestId === request.id)
        ? { kind: 'resolve', requestId: request.id } : undefined
      const event = state.scheduledEvents[wakeId]
      if (wakeId.startsWith('simulation-world-director-event:')) return { kind: 'director-event' }
      const scenario = Object.values(world.requests).find(value => value.source.kind === 'decision' && value.notificationOperationId === null
        && wakeId === `simulation-world-scenario-resolve:${value.id}` && value.status === 'open')
      if (scenario !== undefined) return { kind: 'scenario-resolve', requestId: scenario.id }
      if (event?.sourceOperationId === undefined && event?.action.kind === 'wake') {
        let reason: unknown
        try { reason = JSON.parse(event.action.reason) }
        catch { /* Ordinary trusted wake text has no structured World goal semantics. */ }
        if (simulationWorldGoalSchema.safeParse(reason).success) return { kind: 'goal' }
      }
    }
    if (id === world.definition.directorEntityId) {
      const request = Object.values(world.requests).find((value) => {
        const last = value.plans.at(-1)
        return value.source.kind === 'decision' && value.status === 'open' && last !== undefined && world.plans[last]?.status === 'stale'
          && world.plans[last].proposal.resolution.kind !== 'awaiting-evidence'
      })
      if (request !== undefined) return { kind: request.notificationOperationId === null ? 'scenario-resolve' : 'resolve', requestId: request.id }
    }
    return undefined
  }

  private context(state: SimulationSnapshot, id: SimulationEntityId, wakeId?: SimulationEventId):
  Omit<SimulationContextRequest, 'maxBytes' | 'teamCursor'> {
    const actor = state.entities[id], runtime = this.runtime(id), selector = this.selector(state, id, wakeId)
    const representative = Object.values(state.world?.external.representatives ?? {}).find(value => value.identities.entityId === id && value.status === 'committed')
    const subjectRef = representative === undefined ? this.resolved.world.organizationEntityId
      : state.world?.external.identities[representative.identityId]?.subjectRef
    const organization = subjectRef === undefined ? undefined : state.entities[subjectRef]
    if (actor === undefined || organization === undefined) throw new Error('World context lost its original actor or organization')
    const assignments = Object.values(state.relations).filter(value => value.subject === id && value.relation === 'assignment'
      && value.scope === organization.id && BigInt(value.validFrom) <= BigInt(state.time)
      && (value.validUntil === null || BigInt(value.validUntil) > BigInt(state.time)))
    const delivery = wakeId === undefined ? undefined : Object.values(state.operations).find(value =>
      wakeId === `simulation-delivery:${value.id}` && value.action.kind === 'communication/post'
      && value.action.recipient === id && value.delivery?.sessionId === actor.binding?.sessionId
      && value.delivery?.receipt !== undefined)
    const sender = delivery === undefined ? undefined : state.entities[delivery.entityId]
    const rejected = wakeId === undefined ? undefined : Object.values(state.decisions).filter(value =>
      value.wakeId === wakeId && value.messageRejection !== undefined).sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0))[0]
    const reply = selector !== undefined || state.world?.definition.modelProtocol !== 'bounded-v1' || delivery === undefined
      || sender?.binding === undefined || delivery.action.kind !== 'communication/post' ? [] : [{ type: 'text' as const,
        text: JSON.stringify({ kind: 'world-message-route',
          ...rejected === undefined ? {} : { rejectedSubmission: { decisionId: rejected.id, ...rejected.messageRejection } },
          replyTarget: {
            entityId: sender.id, participantId: sender.binding.participantId, channelId: delivery.action.channelId,
            sourceOperationId: delivery.id,
          }, instruction: 'To reply, use replyTarget.entityId as communication/post.recipient and replyTarget.channelId. '
          + 'The Participant ID identifies the Team envelope sender and is not a simulation recipient. '
          + 'A rejected submission produced no message effects; correct its addressing or time before resubmitting.' }) }]
    const text = (value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }]
    const request = selector?.kind === 'resolve' || selector?.kind === 'scenario-resolve'
      ? state.world?.requests[selector.requestId] : undefined
    const schema = request === undefined ? [] : text({ kind: 'world-resolution-schema', operation: request.pin,
      planSchema: this.executions.planSchema(request.pin),
      instruction: 'For an apply resolution, resolution.payload must satisfy planSchema.' })
    const generationPlans = id !== state.world?.definition.directorEntityId || selector === undefined
      || selector.kind !== 'resolve' && selector.kind !== 'scenario-resolve' ? [] : Object.values(state.generationJobs ?? {})
        .filter(record => record.status === 'validated' && record.job.purpose === 'domain-plan' && record.cancellation === undefined
        && record.job.audience.includes(id) && BigInt(record.job.deadline) > BigInt(state.time)
        && record.content !== undefined && simulationGeneratedPlanSchema.parse(JSON.parse(record.content)).requestId === selector.requestId)
        .sort((a, b) => a.acceptedSequence - b.acceptedSequence)
    const required = requiredWorldContext({ entityId: id, profile: actor.profile, organization: organization.profile,
      assignments: assignments.map(value => ({ positionId: value.object, position: state.entities[value.object]?.profile })) })
    return { personaVersion: 'world/1', modelVersion: runtime.model.version, sources: [],
      ...selector === undefined ? {} : { world: selector }, sections: [
        required.identity, required.authority,
        { kind: 'input', required: true, blocks: [...reply, ...schema, ...generationPlans.map(record => ({ type: 'text' as const, text: generationPlanInput(record) })), ...text({ wakeId: wakeId ?? null,
          reason: wakeId === undefined ? 'Reconsider the retained stale plan.' : state.wakes[wakeId]?.reason })] },
        { kind: 'goals', required: true, blocks: text({ kind: 'world-driver', entityId: id, contextKey: wakeId ?? `slot:${state.nextDecisionSlot}`,
          purpose: selector?.kind ?? 'message', instruction: 'Use simulation_observe, simulation_stage and simulation_submit. '
          + 'Submit only actions allowed by the recorded context. An ordinary message may conclude with no further effects.' }) },
        required.commitments,
      ] }
  }

  private async execute(id: SimulationDecisionId, entityId: SimulationEntityId, wakeId?: SimulationEventId): Promise<void> {
    const state = this.run.snapshot()
    const retained = state.decisions[id]
    if (retained !== undefined && retained.status !== 'open') {
      if (state.phase === 'running' && state.activeWindowId !== undefined) await this.run.commitWindow(state.activeWindowId)
      return
    }
    const initialNotice = state.world?.definition.modelProtocol === 'bounded-v1' && state.time === '0'
      && Object.values(state.world.norms.announcements).some(value => value.origin === 'scenario'
        && value.availableAt === '0' && value.recipients.includes(entityId)
        && wakeId === `simulation-norm-announcement:${value.id}:${entityId}`)
    if (initialNotice) await this.connection.executeDeterministicDecision(entityId, id,
      this.context(state, entityId, wakeId), STARTUP_NOTICE_POLICY, wakeId)
    else await this.connection.executeDecision(entityId, id, this.context(state, entityId, wakeId), wakeId)
    const current = this.run.snapshot()
    if (current.phase === 'running' && current.activeWindowId !== undefined) await this.run.commitWindow(current.activeWindowId)
  }

  private planningBudgetExhausted(state: SimulationSnapshot, requestId: string): boolean {
    const limit = state.world?.definition.limits.maxPlansPerRequest
    if (limit === undefined) return false
    // Native counts prepared attempts, including attempts without an accepted plan; retries must use the same bound.
    return Object.values(state.decisions).filter(value => value.context?.status === 'prepared'
      && (value.context.world?.kind === 'resolve' || value.context.world?.kind === 'scenario-resolve')
      && value.context.world.requestId === requestId).length >= limit
  }

  private stallReason(state: SimulationSnapshot): SimulationWorldDriveResult['reason'] {
    switch (state.stall?.code) {
      case 'SIM_MESSAGE_SUBMISSION_BLOCKED': return 'message-rejected'
      case 'SIM_CONTEXT_INTEGRITY': return 'context-integrity'
      case 'SIM_DECISION_TIMEOUT': return 'decision-timeout'
      case 'SIM_TOKEN_RESERVATION_EXCEEDED': return 'token-overrun'
      case 'SIM_REQUEST_BUDGET_EXCEEDED': return 'request-budget'
      case 'SIM_WORLD_SUBMISSION_BLOCKED': {
        const failure = state.decisions[state.stall.decisionId]?.worldSubmissionBlock?.failure
        if (failure?.code === 'SIM_WORLD_AUTHORITY') return 'authority-missing'
        if (failure?.code === 'SIM_WORLD_LIMIT') {
          switch (failure.limit) {
            case 'bytes': return 'world-byte-limit'
            case 'requests': return 'world-request-limit'
            case 'plans': return 'plan-budget'
          }
        }
        return 'recovery-required'
      }
      case 'SIM_ACTIVATION_HISTORY_LIMIT': return state.entities[state.stall.entityId]?.writer?.phase === 'released'
        ? 'activation-history-limit' : 'recovery-required'
      case 'SIM_OUTBOX_OUTCOME_UNKNOWN': return 'outcome-unknown'
      case 'SIM_MODEL_POOL_CAPACITY': return 'model-pool-capacity'
      case 'SIM_COMPACTION_MODEL_POOL_CAPACITY': return 'model-pool-capacity'
      case 'SIM_BUDGET_LIMIT': return 'budget-limit'
      case 'SIM_CONTEXT_REQUIRED_ITEM_OVERFLOW': return 'context-limit'
      case 'SIM_MICROSTEP_LIMIT': return 'microstep-limit'
      // Remaining Native stalls retain their existing explicit diagnostics and administrative recovery requirements.
      default: return 'stalled'
    }
  }

  private async pump(reportStep: (step: number) => void, until?: SimTime): Promise<SimulationWorldDriveResult> {
    for (let step = 0; step < this.run.snapshot().spec.maxDriveSteps; step++) {
      reportStep(step + 1)
      this.lifetime.throwIfAborted()
      let state = this.run.snapshot()
      if (state.phase !== 'running') return this.result(state.phase === 'stalled' ? this.stallReason(state) : state.phase, step)
      if (Object.values(state.operations).some(value => value.result?.code === 'SIM_ENVELOPE_BYTE_LIMIT')) {
        return this.result('message-byte-limit', step)
      }
      const checkpoint = state.checkpoints?.[this.anchor.checkpointId]
      if (checkpoint?.status !== 'completed' || checkpoint.manifest.implementationVersion !== 'world/1') return this.result('recovery-required', step)
      if (activeSimulationMaintenance(state) !== undefined) return this.result('maintenance-blocked', step)
      if (state.activeWindowId !== undefined) {
        const slot = state.windows?.[state.activeWindowId]?.request.decisions[0]
        if (slot === undefined || !slot.id.startsWith('world/1/')) return this.result('recovery-required', step)
        await this.execute(slot.id, slot.entityId, slot.wakeId)
        continue
      }
      if (await this.executions.settleBoundary()) continue
      state = this.run.snapshot()
      if (state.phase !== 'running') return this.result(state.phase === 'stalled' ? this.stallReason(state) : state.phase, step + 1)
      if (activeSimulationMaintenance(state) !== undefined) return this.result('maintenance-blocked', step + 1)
      const candidates = Object.values(state.world?.plans ?? {}).filter(value => value.status === 'accepted' && value.operationId !== null
        && value.proposal.resolution.kind === 'apply' && state.world?.requests[value.requestId]?.status === 'open'
        && state.world.requests[value.requestId]?.plans.at(-1) === value.id).sort((a, b) => a.sequence - b.sequence)
      let waiting: SimulationWorldDriveResult['reason'] | undefined
      let plan: (typeof candidates)[number] | undefined
      for (const candidate of candidates) {
        const reason = this.executions.readiness(candidate)
        waiting ??= reason
        if (reason === undefined) { plan = candidate; break }
        await this.executions.blocked(candidate, reason)
      }
      if (plan !== undefined) {
        const stopped = await this.executions.execute(plan)
        if (stopped !== undefined) return this.result(stopped, step + 1)
        continue
      }
      const driven = await this.connection.driveResident({ until: state.time }, Date.now, id => this.residency(id))
      if (Object.values(this.run.snapshot().operations).some(value => value.result?.code === 'SIM_ENVELOPE_BYTE_LIMIT')) {
        return this.result('message-byte-limit', step + 1)
      }
      if (driven.reason !== 'until' && driven.reason !== 'decision-required') {
        return this.result(driven.reason === 'stalled' ? this.stallReason(this.run.snapshot()) : driven.reason, step + 1, driven)
      }
      state = this.run.snapshot()
      if (state.phase !== 'running') return this.result(state.phase === 'stalled' ? this.stallReason(state) : state.phase, step + 1)
      const queued = Object.values(state.decisionDispatch?.tickets ?? {}).filter(value => value.status === 'queued' || value.status === 'reserved')
      for (const wake of Object.values(state.wakes).filter(value => value.status === 'pending' && !personnelRetired(state, value.entityId))) {
        if (queued.some(value => value.candidate.wakeId === wake.eventId)) continue
        const id = simulationDecisionIdSchema.parse(`world/1/decision/${this.run.snapshot().decisionDispatch?.nextOrdinal ?? '0'}`)
        await this.run.queueDecision({ id, entityId: wake.entityId, priority: 0, wakeId: wake.eventId })
      }
      state = this.run.snapshot()
      if (state.phase !== 'running') return this.result(state.phase === 'stalled' ? this.stallReason(state) : state.phase, step + 1)
      const replan = Object.values(state.world?.requests ?? {}).find((value) => {
        const last = value.plans.at(-1)
        return value.status === 'open' && last !== undefined && state.world?.plans[last]?.status === 'stale'
          && state.world.plans[last].proposal.resolution.kind !== 'awaiting-evidence'
      })
      if (replan !== undefined && this.planningBudgetExhausted(state, replan.id)) return this.result('plan-budget', step + 1)
      if (replan !== undefined && !Object.values(state.decisionDispatch?.tickets ?? {}).some(value =>
        (value.status === 'queued' || value.status === 'reserved') && value.candidate.entityId === state.world?.definition.directorEntityId)) {
        const id = simulationDecisionIdSchema.parse(`world/1/decision/${state.decisionDispatch?.nextOrdinal ?? '0'}`)
        await this.run.queueDecision({ id, entityId: this.resolved.world.directorEntityId, priority: 0 })
      }
      state = this.run.snapshot()
      if (state.phase !== 'running') return this.result(state.phase === 'stalled' ? this.stallReason(state) : state.phase, step + 1)
      const windowId = state.decisionDispatch?.active
        ?? simulationWindowIdSchema.parse(`world/1/window/${state.nextDecisionSlot}`)
      const selection = state.decisionDispatch?.active === undefined
        ? await this.run.reserveDecisionWindow({ id: windowId, limit: 1 }, state.revision)
        : state.decisionDispatch.selections[windowId]
      const id = selection?.decisions[0]
      if (id === undefined) {
        const next = Object.values(state.scheduledEvents).filter(value => value.status === 'pending')
          .sort((a, b) => BigInt(a.key.time) < BigInt(b.key.time) ? -1 : BigInt(a.key.time) > BigInt(b.key.time) ? 1 : 0)[0]
        if (next === undefined) return this.result(waiting ?? 'idle', step + 1)
        if (until !== undefined && BigInt(next.key.time) > BigInt(until)) return this.result('until', step + 1)
        const future = await this.connection.driveResident({ until: next.key.time }, Date.now, id => this.residency(id))
        if (Object.values(this.run.snapshot().operations).some(value => value.result?.code === 'SIM_ENVELOPE_BYTE_LIMIT')) {
          return this.result('message-byte-limit', step + 1)
        }
        if (future.reason !== 'until' && future.reason !== 'decision-required') {
          return this.result(future.reason === 'stalled' ? this.stallReason(this.run.snapshot()) : future.reason, step + 1, future)
        }
        continue
      }
      const ticket = this.run.snapshot().decisionDispatch?.tickets[id]
      if (ticket === undefined) throw new Error('World driver lost its reserved fair queue ticket')
      const selector = this.selector(this.run.snapshot(), ticket.candidate.entityId, ticket.candidate.wakeId)
      if ((selector?.kind === 'resolve' || selector?.kind === 'scenario-resolve')
        && this.planningBudgetExhausted(this.run.snapshot(), selector.requestId)) {
        return this.result('plan-budget', step + 1)
      }
      const resident = await this.connection.ensureResident(ticket.candidate.entityId, this.residency(ticket.candidate.entityId))
      if (resident.status !== 'resident') return this.result(resident.status === 'capacity' ? 'resident-capacity' : 'recovery-required', step + 1,
        { entityId: ticket.candidate.entityId })
      state = this.run.snapshot()
      if (state.phase !== 'running') return this.result(state.phase, step + 1)
      await this.connection.openWindow({ id: windowId, decisions: [{ id, entityId: ticket.candidate.entityId,
        ...ticket.candidate.wakeId === undefined ? {} : { wakeId: ticket.candidate.wakeId },
        context: this.context(state, ticket.candidate.entityId, ticket.candidate.wakeId) }] })
      await this.execute(id, ticket.candidate.entityId, ticket.candidate.wakeId)
    }
    return this.result('work-limit', this.run.snapshot().spec.maxDriveSteps)
  }


}
