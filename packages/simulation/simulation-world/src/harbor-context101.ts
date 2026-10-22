/** Frozen W0 Native-101 model-context projection. It never delegates to current presenters or opens case files. */
import { z } from 'zod'
import type { NativeWorldDomain, SimulationSnapshot, SimulationWorldIntent, SimulationEntityId,
  SimulationWorldJsonValue, SimulationWorldResult, SimulationWorldRequest } from '@clocky/clocky-simulation'
import { HARBOR_ACTORS, harborRequestSchema, harborResultSchema } from './harbor-protocol.ts'
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
function harborOutcomes(state: SimulationSnapshot): HarborOutcome[] {
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
function harborProgress(state: SimulationSnapshot): SimulationWorldJsonValue {
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
const harborObservationSchema = z.strictObject({
  revision: z.number().int().nonnegative(), day: z.number().int().min(0).max(365),
  overview: z.json(),
  prompt: z.string(), rules: z.string(), guide: z.string(),
})

/** Read a recorded original observation, without consulting mutable case files during replay.
 * @param state - Recorded Native snapshot.
 * @returns retained observation, or undefined before initial publication. */
function harborObservation(state: SimulationSnapshot): z.infer<typeof harborObservationSchema> | undefined {
  const value = state.entities['harbor-environment' as SimulationEntityId]?.profile.harbor
  return value === undefined ? undefined : harborObservationSchema.parse(value)
}

/** A newly founded case actor keeps its founder's representative until a separate representation feature is installed.
 * @param state - Original committed Native outcomes.
   * @param representative - Bound independent Session owner.
 * @returns only the original actor and actors actually created by its own accepted case decisions. */
function ownedHarborActors(state: SimulationSnapshot, representative: string): string[] {
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

/**
 * Retain exact pure context bytes from W0 commit 0e85170d1236cfe846ebc3b88a073d848903fb47.
 * @param contract - Original exact Harbor operation contract; no compatible-version substitution.
 * @returns retained model context methods used only inside a hash-verified migrated source prefix.
 */
export function harborContext101(contract: HarborContract): Pick<NativeWorldDomain, 'goalContext' | 'planningContext'> {
  return {
    /** @param actor - Original role selecting only its recorded authorized views. */
    goalContext(state: SimulationSnapshot, actor: SimulationEntityId): SimulationWorldJsonValue {
      const observation = harborObservation(state)
      if (observation === undefined) throw new Error('Harbor has no recorded environment observation')
      const common = { day: observation.day, rules: observation.rules, guide: observation.guide,
        requestEnvelope: { expectedTime: null, evidence: [] },
        operation: { domain: 'harbor', operation: 'execute', version: contract.definition.version,
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
        return { ...common, prompt: observation.prompt, overview: observation.overview, recentControlResults: results,
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
      return { ...common, view: own,
        additionalViews: Object.fromEntries(Object.entries(views).filter(([id]) => id !== actor)),
        instruction: 'Independently decide for the actor named in this view, according to its current information and interests. '
          + 'Use command {kind:"act", viewId, rationale, actions} for a real decision. '
          + 'For an actor you actually founded, select its own view and add actor to the command; each represented actor must retain its own interests. '
          + 'If there is no useful action, submit an empty Simulation proposal list. '
          + 'Environment messages and transactions must use the original case actions; ordinary Team chat does not change the case world. '
          + 'Do not manufacture decisions to satisfy coverage or claim unexecuted future actions.' }
    },

    /** @param _actor - Native-authorized technical director; no extra private view is disclosed. */
    planningContext(_state: SimulationSnapshot, intent: SimulationWorldIntent, _actor: SimulationEntityId): SimulationWorldJsonValue {
      if (contract.planMode === 'forward-original') return { input: intent.payload, requester: intent.requesterEntityId,
        instruction: 'Observe the current authorized request with simulation_observe({}). To send it unchanged to the independent case judge, '
          + 'stage world/resolve for the CURRENT requestId with resolution {kind:"apply", payload:{forwardOriginal:true}, rationale:<your reason>}. '
          + 'Do not copy or rewrite the original payload. Native binds this forwarding decision to that exact request; the judge checks it. '
          + 'The actor remains responsible for its business choice. Submit the final staged plan.' }
      return { input: intent.payload, requester: intent.requesterEntityId,
        instruction: 'The complete authorized request is already in your input; confirm it with simulation_observe({}). '
          + 'This is a request to the independent case judge. Apply its exact payload without inventing or rewriting '
          + 'the requester’s decision. The judge validates resources and stale observations. Do not infer private actor state or choose a business strategy.' }
    },
  }
}
