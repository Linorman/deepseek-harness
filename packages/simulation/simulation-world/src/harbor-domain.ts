/** Harbor request authority and actor-specific projection; the original case CLI remains the business judge. */
import { harborContext101 } from './harbor-context101.ts'
import { harborBusinessSummary } from './harbor-summary.ts'
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import type { NativeWorldDomain, SimulationSnapshot, SimulationWorldIntent, SimulationWorldPlan,
  SimulationWorldDomainRequest, SimulationEntityId, SimulationWorldBusinessResolution,
  SimulationWorldJsonValue, SimulationWorldResult, SimulationWorldRequest } from '@clocky/clocky-simulation'
import { simulationProposalSchema, simTimeSchema } from '@clocky/clocky-simulation'
import { HARBOR_ACTORS, HARBOR_CURRENT, harborRequestSchema, harborResultSchema } from './harbor-protocol.ts'
import type { HarborCommand, HarborResult, HarborContract } from './harbor-protocol.ts'

interface HarborOutcome {
  result: SimulationWorldResult
  request: SimulationWorldRequest
  command: HarborCommand
  receipt: HarborResult
}

/** Read only actual committed judge receipts, in their original Native order.
 * @param state - Recorded Native snapshot.
 * @returns original requests and typed committed receipts. */
export function harborOutcomes(state: SimulationSnapshot): HarborOutcome[] {
  return Object.values(state.world?.results ?? {}).filter(result => result.outcome.kind === 'committed'
    && state.world?.intents[result.intentId]?.pin.domain === 'harbor').sort((a, b) => a.sequence - b.sequence)
    .map((result) => {
      const request = state.world?.requests[result.requestId]
      if (request === undefined) throw new Error('Harbor result lost its original request')
      return { result, request, command: harborRequestSchema.parse(request.proposal.payload).command,
        receipt: harborResultSchema.parse(result.payload) }
    })
}

/** Actual receipt counts inform the initiating model; they never create actions or replace the original audit.
 * @param state - Recorded Native snapshot.
 * @returns observed coverage counts without extrapolating future decisions. */
export function harborProgress(state: SimulationSnapshot): SimulationWorldJsonValue {
  const outcomes = harborOutcomes(state)
  const decisions = outcomes.filter(value => value.command.kind === 'act' && value.receipt.ok)
  const material = decisions.filter(value => value.command.kind === 'act' && value.command.actions.some(action => action.kind !== 'message'))
  const checkpointDays = [...new Set(outcomes.filter(value => value.command.kind === 'checkpoint' && value.receipt.ok)
    .flatMap(value => value.receipt.receipt.checkpointDay === null ? [] : [value.receipt.receipt.checkpointDay]))].sort((a, b) => a - b)
  return { decisions: decisions.length, materialDecisions: material.length,
    activeWeeks: new Set(material.map(value => Math.floor(value.receipt.day / 7))).size,
    actors: new Set(material.map(value => value.command.kind === 'act' ? value.command.actor ?? value.request.requesterEntityId : null)).size,
    independentSessions: new Set(material.flatMap(value => value.request.source.kind === 'decision' ? [value.request.source.binding.sessionId] : [])).size,
    checkpointDays, recoveryVerified: outcomes.some(value => value.command.kind === 'restore-check' && value.receipt.ok
      && value.receipt.receipt.restored === true && (value.receipt.receipt.checkpointDay ?? -1) >= 180) }
}

/** Public case observation; private role views are stored under separate noncognitive identities. */
export const harborObservationSchema = z.strictObject({
  revision: z.number().int().nonnegative(), day: z.number().int().min(0).max(365),
  publishedAtNativeSequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  overview: z.json(),
  prompt: z.string(), rules: z.string(), guide: z.string(),
})

/** Read a recorded original observation, without consulting mutable case files during replay.
 * @param state - Recorded Native snapshot.
 * @returns retained observation, or undefined before initial publication. */
export function harborObservation(state: SimulationSnapshot): z.infer<typeof harborObservationSchema> | undefined {
  const value = state.entities['harbor-environment' as SimulationEntityId]?.profile.harbor
  return value === undefined ? undefined : harborObservationSchema.parse(value)
}

/** A newly founded case actor keeps its founder's representative until a separate representation feature is installed.
 * @param state - Original committed Native outcomes.
   * @param representative - Bound independent Session owner.
 * @returns only the original actor and actors actually created by its own accepted case decisions. */
export function ownedHarborActors(state: SimulationSnapshot, representative: string): string[] {
  const actors = new Set([representative])
  for (const result of Object.values(state.world?.results ?? {})) {
    const intent = state.world?.intents[result.intentId]
    if (intent?.pin.domain !== 'harbor' || intent.requesterEntityId !== representative || result.outcome.kind !== 'committed') continue
    const receipt = harborResultSchema.parse(result.payload)
    if (!receipt.ok || receipt.command !== 'act') continue
    const chosen = harborRequestSchema.parse(intent.payload).command
    if (chosen.kind === 'act') for (const action of chosen.actions) if (action.kind === 'create-actor') actors.add(action.id)
  }
  return [...actors]
}

/** Pure Native adapter; requesters cannot select a different actor, Session, script or filesystem location. */
export class HarborNativeDomain implements NativeWorldDomain {
  readonly definition
  readonly ref
  readonly generation
  /** Exact retained source presenter; later contexts always use the current protocol methods. */
  readonly contextProfiles: NonNullable<NativeWorldDomain['contextProfiles']>

  /** Native checkpoints cannot include this adapter's separate original-judge files. */
  readonly checkpointCoverage = 'external-state-required' as const
  /** Exact-version projection consumes only host-authorized evidence and never opens the case. */
  readonly summary: NonNullable<NativeWorldDomain['summary']> = evidence => harborBusinessSummary(this.contract, evidence)

  /** Interpret only recorded judge evidence; date protection never opens the case journal or private views. */
  readonly stopClock: NonNullable<NativeWorldDomain['stopClock']> = {
    name: 'harbor-day',
    nativeBoundary: (state, boundary) => state.spec.tickUnit === 'day' && state.spec.origin === '0'
      ? boundary : undefined,
    observe: (state) => {
      const observation = harborObservation(state)
      if (observation === undefined) return undefined
      let day = observation.day
      // External receipts may already be committed while the next public observation is still queued.
      for (const result of Object.values(state.world?.results ?? {})) {
        const intent = state.world?.intents[result.intentId]
        if (result.outcome.kind !== 'committed' || intent?.pin.domain !== this.definition.domain
          || intent.pin.operation !== this.definition.operation || intent.pin.version !== this.definition.version) continue
        const receipt = harborResultSchema.parse(this.definition.schemas.mutation.parse(result.payload))
        day = Math.max(day, receipt.day)
      }
      return { value: simTimeSchema.parse(String(day)), revision: state.revision }
    },
    effect: (state, request) => {
      if (request.domain !== this.definition.domain || request.operation !== this.definition.operation
        || request.version !== this.definition.version) return undefined
      const current = this.stopClock.observe(state)
      if (current === undefined) return undefined
      const { command } = harborRequestSchema.parse(this.definition.schemas.request.parse(request.payload))
      let maximum = BigInt(current.value)
      if (command.kind === 'advance') maximum = maximum > BigInt(command.day) ? maximum : BigInt(command.day)
      if (command.kind === 'act') for (const action of command.actions) {
        // Delayed delivery schedules new work. Financial due dates retain obligations without advancing time.
        if (action.kind === 'message') {
          const delivery = BigInt(current.value) + BigInt(action.delayDays)
          if (delivery > maximum) maximum = delivery
        }
      }
      return simTimeSchema.parse(String(maximum))
    },
  }

  /** @param contract - Original immutable protocol selected by this provider registration. */
  constructor(private readonly contract: HarborContract = HARBOR_CURRENT) {
    this.contextProfiles = { 'clocky.harbor.context/101': harborContext101(contract) }
    this.definition = contract.definition
    this.ref = contract.pin.implementationRef
    this.generation = contract.pin.generation
  }

  /** No additional Native personnel are employed or retired by case-local actions. */
  personnelSubjects(_intent: SimulationWorldIntent): readonly SimulationEntityId[] { return [] }

  /** @param actor - Canonical requester validated against the original role grants. */
  admitRequest(state: SimulationSnapshot, actor: SimulationEntityId, request: SimulationWorldDomainRequest) {
    const input = harborRequestSchema.parse(this.definition.schemas.request.parse(request.payload))
    if (request.expectedTime !== null || request.evidence.length !== 0)
      throw new Error('Harbor requests require expectedTime: null and evidence: []; advance uses command.day.')
    if (state.world?.definition.organizationEntityId !== input.scopeEntityId
      || state.entities[input.targetEntityId as SimulationEntityId]?.cognition !== 'none')
      throw new Error('Harbor requires its original environment and organization')
    if (input.command.kind === 'act') {
      if (!(HARBOR_ACTORS as readonly string[]).includes(actor)) throw new Error('Only the original Harbor actor may decide its actions')
      if (!ownedHarborActors(state, actor).includes(input.command.actor ?? actor))
        throw new Error('Harbor action names an actor represented by another Session')
    } else if (actor !== 'coordinator') throw new Error('Only the experiment coordinator may manage case time and checkpoints')
    if (input.command.kind === 'wake' && input.command.actors.some(id => !(HARBOR_ACTORS as readonly string[]).includes(id)))
      throw new Error('Harbor wake names an unbound actor')
    return { scopeEntityId: input.scopeEntityId as SimulationEntityId, targetEntityId: input.targetEntityId as SimulationEntityId,
      description: `Execute the original Harbor ${input.command.kind} request without replacing its decision.`, payload: z.json().parse(input) }
  }

  /** @param actor - Original role selecting only its recorded authorized views. */
  goalContext(state: SimulationSnapshot, actor: SimulationEntityId): SimulationWorldJsonValue {
    const observation = harborObservation(state)
    if (observation === undefined) throw new Error('Harbor has no recorded environment observation')
    const common = { day: observation.day, rules: observation.rules, guide: observation.guide,
      ...state.runControl?.current.target === null || state.runControl?.current.target === undefined ? {}
        : { stopping: { clock: state.runControl.current.target.clock, boundary: state.runControl.current.target.boundary,
          mode: state.runControl.current.target.mode, activation: state.runControl.current.activation,
          state: state.runControl.current.state,
          instruction: 'Respect this retained stopping boundary. Do not request a later date or future message delivery beyond it. '
            + 'Stopping preserves outstanding business duties and does not complete the annual experiment.' } },
      requestEnvelope: { expectedTime: null, evidence: [] },
      operation: { domain: 'harbor', operation: 'execute', version: this.definition.version,
        payload: { scopeEntityId: 'harbor', targetEntityId: 'harbor-environment' } },
      protocol: 'The original Node CLI is provided through harbor.execute. Submit a world/request with command in its payload. '
        + 'The Host supplies actor and real Team/Session identity. Do not write files or execute code. '
        + 'The current authorized case view is already in your input. Call simulation_observe with {} to confirm it; '
        + 'detail: full duplicates that view and is normally unnecessary. Use the recorded viewId. '
        + 'Commands commit only after the case judge accepts them. '
        + 'An observation contains only current information, never future environmental events.' }
    if (actor === 'coordinator') {
      const results = Object.values(state.world?.results ?? {}).filter((result) => {
        const intent = state.world?.intents[result.intentId]
        return intent?.pin.domain === 'harbor' && intent.requesterEntityId === actor
      }).slice(-20).map(result => ({ outcome: result.outcome, payload: result.payload }))
      return { ...common,
        ...this.contract.pin.version !== '3' ? {} : { stageExamples: this.requestExample({ kind: 'audit' }) },
        prompt: observation.prompt, overview: observation.overview, recentControlResults: results,
        progressFromRecordedReceipts: harborProgress(state),
        instruction: 'You initiate this experiment; other actors make their own business choices. '
          + 'Continue through day 365. Choose when to advance (at most seven days), wake actors for necessary follow-up, '
          + 'write substantive checkpoint memories regularly, verify recovery after day 180, audit, then finish with an evidence-based report. '
          + 'Commands: advance {day}, wake {actors, reason}, checkpoint {memory}, restore-check {checkpointId}, audit, finish {report}. '
          + 'Do not supply a business action for another actor. Preserve unknown information and unresolved responsibilities.' }
    }
    const views = z.record(z.string(), z.json()).parse(state.entities[`harbor-view-${actor}` as SimulationEntityId]?.profile.views)
    const represented = ownedHarborActors(state, actor)
    if (!(HARBOR_ACTORS as readonly string[]).includes(actor) || Object.keys(views).some(id => !represented.includes(id)))
      throw new Error('Harbor actor has no authorized view')
    for (const id of represented) z.object({ actor: z.literal(id), day: z.literal(observation.day),
      revision: z.literal(observation.revision), viewId: z.string().regex(/^view-[a-f0-9]{64}$/) }).parse(views[id])
    const own = views[actor]
    if (own === undefined) throw new Error('Harbor actor has no original private view')
    return { ...common,
      ...this.contract.pin.version !== '3' ? {} : { stageExamples: this.requestExample({ kind: 'act',
        viewId: z.object({ viewId: z.string() }).parse(own).viewId,
        rationale: 'Example only: choose an action justified by your actual current information.', actions: [{ kind: 'settle-costs' }] }) },
      view: own,
      additionalViews: Object.fromEntries(Object.entries(views).filter(([id]) => id !== actor)),
      instruction: 'Independently decide for the actor named in this view, according to its current information and interests. '
        + 'Use command {kind:"act", viewId, rationale, actions} for a real decision. '
        + 'For an actor you actually founded, select its own view and add actor to the command; each represented actor must retain its own interests. '
        + 'If there is no useful action, submit an empty Simulation proposal list. '
        + 'Environment messages and transactions must use the original case actions; ordinary Team chat does not change the case world. '
        + 'Do not manufacture decisions to satisfy coverage or claim unexecuted future actions.' }
  }

  /** @param _actor - Native-authorized technical director; no extra private view is disclosed. */
  planningContext(state: SimulationSnapshot, intent: SimulationWorldIntent, _actor: SimulationEntityId): SimulationWorldJsonValue {
    if (this.contract.planMode === 'forward-original') {
      const request = Object.values(state.world?.requests ?? {}).find(value => value.intentId === intent.id && value.status === 'open')
      const payload = z.json().parse(this.definition.schemas.plan.parse({ forwardOriginal: true }))
      const example = request === undefined ? [] : [simulationProposalSchema.parse({ after: [], action: {
        kind: 'world/resolve', requestId: request.id, supersedes: request.plans.at(-1) ?? null,
        resolution: { kind: 'apply', payload, rationale: 'Forward this original request to the independent case judge.' },
      } })]
      return { stageExamples: { purpose: 'Format example only; choose and justify your own decision.', proposals: z.json().parse(example) }, input: intent.payload, requester: intent.requesterEntityId,
        instruction: 'Observe the current authorized request with simulation_observe({}). To send it unchanged to the independent case judge, '
        + 'stage world/resolve for the CURRENT requestId with resolution {kind:"apply", payload:{forwardOriginal:true}, rationale:<your reason>}. '
        + 'Do not copy or rewrite the original payload. Native binds this forwarding decision to that exact request; the judge checks it. '
        + 'The actor remains responsible for its business choice. Submit the final staged plan.' }
    }
    return { input: intent.payload, requester: intent.requesterEntityId,
      instruction: 'The complete authorized request is already in your input; confirm it with simulation_observe({}). '
        + 'This is a request to the independent case judge. Apply its exact payload without inventing or rewriting '
        + 'the requester’s decision. The judge validates resources and stale observations. Do not infer private actor state or choose a business strategy.' }
  }

  private requestExample(command: HarborCommand): SimulationWorldJsonValue {
    const payload = z.json().parse(this.definition.schemas.request.parse({ scopeEntityId: 'harbor',
      targetEntityId: 'harbor-environment', command }))
    const proposal = simulationProposalSchema.parse({ after: [], action: { kind: 'world/request',
      domain: this.contract.pin.domain, operation: this.contract.pin.operation, version: this.contract.pin.version,
      businessKey: 'replace-with-your-unique-business-key', expectedTime: null, evidence: [], payload } })
    return { purpose: 'Format example only; choose and justify your own decision. Empty proposals remain valid when no action is needed.',
      proposals: z.json().parse([proposal]) }
  }

  validatePlan(_state: SimulationSnapshot, intent: SimulationWorldIntent, resolution: SimulationWorldBusinessResolution): void {
    if (resolution.kind !== 'apply') return
    this.definition.schemas.plan.parse(resolution.payload)
    if (this.contract.planMode === 'copy-original' && !isDeepStrictEqual(resolution.payload, intent.payload))
      throw new Error('Harbor plans must preserve the exact requester decision')
  }

  /** The case's original view identity is checked by the external judge; Native grants are checked separately. */
  executionReads(_state: SimulationSnapshot, _intent: SimulationWorldIntent) { return [] }

  reduceMutation(_state: SimulationSnapshot, intent: SimulationWorldIntent, plan: SimulationWorldPlan, payload: SimulationWorldJsonValue) {
    const request = harborRequestSchema.parse(intent.payload), result = harborResultSchema.parse(payload)
    if (plan.proposal.resolution.kind !== 'apply' || result.command !== request.command.kind) throw new Error('Harbor execution changed its original command')
    this.validatePlan(_state, intent, plan.proposal.resolution)
    return { changes: [], resultPayload: result }
  }
}
