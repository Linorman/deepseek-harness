/** Durable Simulation context vocabulary, independent of live world services. @module @clocky/clocky-session/simulation-context */
import type { Branded } from '@clocky/clocky-brand'
import type { ContentBlock } from '@clocky/clocky-llm'

/** Context sections in decreasing admission priority; a stored view retains their exact content. */
export const SIMULATION_CONTEXT_SECTIONS = [
  'identity', 'authority', 'input', 'goals', 'commitments', 'evidence', 'observations', 'knowledge', 'history',
] as const
/** One ordered portion of a materialized context. */
export interface SimulationContextSection {
  readonly kind: typeof SIMULATION_CONTEXT_SECTIONS[number]
  readonly blocks: ContentBlock[]
}
/** Scoped evidence identifiers; references do not render their source messages a second time. */
export type SimulationContextReference =
  | { readonly kind: 'run-event'; readonly runId: Branded<'SimulationRunId'>; readonly sequence: number }
  | { readonly kind: 'team-envelope'; readonly teamId: Branded<'TeamId'>; readonly channelId: Branded<'ChannelId'>; readonly envelopeId: Branded<'EnvelopeId'> }
/** Required-on-read snapshot recorded before model admission; its presence alone does not prove input consumption. */
export interface SimulationContextViewEventData {
  readonly version: 1
  readonly runId: Branded<'SimulationRunId'>
  readonly entityId: Branded<'SimulationEntityId'>
  readonly windowId: Branded<'SimulationWindowId'>
  readonly slot: Branded<'SimulationDecisionSlot'>
  readonly epoch: Branded<'SimulationWriterEpoch'>
  readonly time: Branded<'SimTime'>
  readonly inputId: Branded<'SimulationInputId'>
  readonly projections: { readonly run: number; readonly entity: number; readonly team: number }
  readonly versions: { readonly rules: string; readonly policy: string; readonly persona: string; readonly model: string }
  readonly sources: SimulationContextReference[]
  readonly content: SimulationContextSection[]
}
/** Source metadata for the user message reconstructed from stored sections. */
export interface SimulationContextMessageSource extends Omit<SimulationContextViewEventData, 'content'> {
  readonly kind: 'simulation-context-view'
}

/**
 * Validate a materialized context at durable and wire read boundaries.
 * @param value - Untrusted JSON payload.
 * @returns whether all versioned fields and section ordering are valid.
 */
export function isSimulationContextView(value: unknown): value is SimulationContextViewEventData {
  if (!exact(value, ['version', 'runId', 'entityId', 'windowId', 'slot', 'epoch', 'time', 'inputId', 'projections', 'versions', 'sources', 'content'])
    || value['version'] !== 1 || !['runId', 'entityId', 'windowId', 'inputId'].every(key => text(value[key]))
    || !['slot', 'epoch', 'time'].every(key => decimal(value[key])) || value['epoch'] === '0') return false
  const projections = value['projections']
  const versions = value['versions']
  if (!exact(projections, ['run', 'entity', 'team']) || !Object.values(projections).every(counter)
    || !exact(versions, ['rules', 'policy', 'persona', 'model']) || !Object.values(versions).every(text)) return false
  const sources = value['sources']
  if (!Array.isArray(sources) || !sources.every(source => validReference(source, value['runId'], projections['run'] as number))) return false
  const keys = sources.map(source => JSON.stringify(source.kind === 'run-event'
    ? [source.kind, source.runId, source.sequence] : [source.kind, source.teamId, source.channelId, source.envelopeId]))
  if (new Set(keys).size !== keys.length) return false
  const content = value['content']
  if (!Array.isArray(content) || content.length === 0) return false
  let previous = -1
  return content.every((section) => {
    if (!exact(section, ['kind', 'blocks'])) return false
    const rank = SIMULATION_CONTEXT_SECTIONS.findIndex(kind => kind === section['kind'])
    if (rank <= previous || !Array.isArray(section['blocks']) || section['blocks'].length === 0
      || !section['blocks'].every(block => record(block) && text(block['type']))) return false
    previous = rank
    return true
  })
}
/**
 * Validate one context-view envelope without consulting live projections or prior events.
 * @param value - Untrusted event received over a wire.
 * @returns whether its payload, required marker and local provenance are valid.
 */
export function isSimulationContextViewEvent(value: unknown): boolean {
  if (!record(value) || value['type'] !== 'simulation/context-view' || !counter(value['seq']) || !counter(value['time'])
    || Object.keys(value).some(key => !['type', 'seq', 'time', 'data', 'surfaceOp', 'sourceEventSeqs'].includes(key))
    || !isSimulationContextView(value['data'])) return false
  const sources = value['sourceEventSeqs']
  if (sources !== undefined && (!Array.isArray(sources)
    || !sources.every(seq => counter(seq) && seq < (value['seq'] as number)) || new Set(sources).size !== sources.length)) return false
  const op = value['surfaceOp']
  if (op === 'append') return true
  return exact(op, ['op', 'start', 'end']) && op['op'] === 'replace' && counter(op['start'])
    && op['start'] === op['end'] && op['start'] < value['seq']
    && Array.isArray(sources) && sources.includes(op['start'])
}
function validReference(value: unknown, runId: unknown, revision: number): value is SimulationContextReference {
  if (!record(value)) return false
  switch (value['kind']) {
    case 'run-event': return exact(value, ['kind', 'runId', 'sequence']) && value['runId'] === runId
      && counter(value['sequence']) && value['sequence'] > 0 && value['sequence'] <= revision
    case 'team-envelope': return exact(value, ['kind', 'teamId', 'channelId', 'envelopeId'])
      && ['teamId', 'channelId', 'envelopeId'].every(key => text(value[key]))
    default: return false
  }
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return record(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
}
function text(value: unknown): value is string { return typeof value === 'string' && value.length > 0 }
function decimal(value: unknown): boolean { return typeof value === 'string' && /^(0|[1-9][0-9]*)$/.exec(value)?.[0] === value }
function counter(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 }
