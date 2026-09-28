/** Pure summarization over an explicit authorized knowledge subset. @module @clocky/clocky-simulation-team/summary */
import { deepFreeze } from '@clocky/clocky-llm'
import { isDeepStrictEqual } from 'node:util'
import { simulationSummaryRequestSchema } from '@clocky/clocky-simulation'
import type { SimulationEntityId, SimulationKnowledge, SimulationPolicyRef, SimulationRun,
  SimulationSummaryPolicy, SimulationSummaryRequest } from '@clocky/clocky-simulation'

/**
 * Compute from only selected knowledge, checking all target readers before invoking trusted policy code.
 * @param run - Authoritative versions and current permissions.
 * @param owner - Active knowledge owner, without requiring a resident Agent.
 * @param policy - Exact immutable policy generation.
 * @param request - Input identities and output placement.
 * @param resolve - Current pure implementation; no model or channel-wide summarizer is called.
 * @param check - Connection lifetime check.
 * @returns a durable summary with exact source versions and cursor; exact retries do not recompute.
 */
export async function summarizeKnowledge(run: SimulationRun, owner: SimulationEntityId, policy: SimulationPolicyRef,
  request: SimulationSummaryRequest, resolve: () => SimulationSummaryPolicy, check: () => void): Promise<SimulationKnowledge> {
  const { inputs, ...placement } = simulationSummaryRequestSchema.parse(request)
  check()
  const state = run.snapshot()
  const histories = state.knowledge ?? {}
  const prior = Object.hasOwn(histories, placement.id)
    ? (histories[placement.id] as readonly SimulationKnowledge[])[placement.expectedRevision] : undefined
  if (prior !== undefined) {
    if (prior.owner !== owner || prior.source.kind !== 'summary' || !isDeepStrictEqual(prior.source.policy, policy)
      || !isDeepStrictEqual(prior.source.premises.map(ref => ref.id).sort(), [...inputs].sort())
      || !isDeepStrictEqual(prior.readers, placement.readers) || prior.availableAt !== placement.availableAt
      || prior.validFrom !== placement.validFrom || prior.validUntil !== placement.validUntil) {
      throw new Error('Simulation summary retry changed its policy, sources or placement')
    }
    const visible = run.queryKnowledge({ viewer: owner, cursor: prior.source.cursor, time: prior.observedAt,
      limit: inputs.length, ids: inputs })
    if (!isDeepStrictEqual(visible.map(({ id, revision }) => ({ id, revision })), prior.source.premises)) throw new Error('Simulation retained summary is no longer retrievable')
    return prior
  }
  const items = run.queryKnowledge({ viewer: owner, cursor: state.revision, time: state.time, limit: inputs.length, ids: inputs })
  if (items.length !== inputs.length) throw new Error('Simulation summary has missing, future or unauthorized inputs')
  const references = items.map(({ id, revision }) => ({ id, revision }))
  for (const viewer of placement.readers) {
    const readable = run.queryKnowledge({ viewer, cursor: state.revision, time: state.time, limit: inputs.length, ids: inputs })
    if (!isDeepStrictEqual(readable.map(({ id, revision }) => ({ id, revision })), references)) {
      throw new Error('Simulation summary audience cannot retrieve its complete source subset')
    }
  }
  const implementation = resolve()
  const material = items.map(({ readers: _readers, ...item }) => item)
  const statement = implementation.summarize(deepFreeze(material))
  check()
  if (resolve() !== implementation) throw new Error('Simulation summary policy retired during computation')
  return await run.recordKnowledge({ ...placement, owner, statement, observedAt: state.time,
    source: { kind: 'summary', policy, cursor: state.revision, premises: references } })
}
