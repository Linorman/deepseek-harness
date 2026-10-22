import { businessContext, businessMaterial, assertBusinessContextProjection } from './business-context.ts'
import type { NativeWorldRuntime } from './world-runtime.ts'
import { worldContext } from './world.ts'
import { normContextMaterial } from './world-norms.ts'
import { projectWorldFacts, assertPreparedWorldScopeAccess } from '@clocky/clocky-simulation'
import { simulationContextBytes } from '@clocky/clocky-simulation/context-size'
import { taskDecision, taskDecisionBlock } from '@clocky/clocky-simulation'
/** Deterministic, journal-owned context selection before any Session delivery. @module @clocky/clocky-simulation-local/context */
import { selectKnowledge, knowledgeVisible } from '@clocky/clocky-simulation'
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { isSimulationContextView } from '@clocky/clocky-session/surface'
import type { SimulationContextSection } from '@clocky/clocky-session'
import type { SimulationContextPreparation, SimulationContextRequest, SimulationDecision, SimulationSnapshot } from '@clocky/clocky-simulation'
import { z } from 'zod'
import { simulationStopTargetSchema } from '@clocky/clocky-simulation'
import { businessFingerprint } from './business.ts'

const stoppingContextSchema = z.strictObject({ kind: z.literal('simulation-stopping'), version: z.literal(1),
  controlRevision: z.number().int().positive(), target: simulationStopTargetSchema.nullable(), instruction: z.string() })
function stoppingBlock(revision: number, target: z.infer<typeof simulationStopTargetSchema> | null) {
  return { type: 'text' as const, text: JSON.stringify({ kind: 'simulation-stopping', version: 1, controlRevision: revision, target,
    instruction: target === null ? 'The operator cleared the previous stop target. Current decision permissions still apply.'
      : 'Respect this operator stop target. Stage only actions that stay within its boundary; do not invent actions to reach it. '
        + 'Stopping does not complete the scene or remove unfinished responsibilities. Resuming requires an explicit operator change.' }) }
}
function stoppingMaterial(block: unknown): unknown {
  if (typeof block !== 'object' || block === null || !('text' in block) || typeof block.text !== 'string') return undefined
  let value: unknown
  try { value = JSON.parse(block.text) }
  catch { return undefined /* Ordinary text is not a structured Native stopping fact. */ }
  return typeof value === 'object' && value !== null && 'kind' in value && value.kind === 'simulation-stopping' ? value : undefined
}

const REQUIRED = ['identity', 'authority', 'input', 'goals', 'commitments'] as const
/**
 * Select whole optional sections in priority order after reserving all required content.
 * @param state - State owned by the decision queue.
 * @param decision - Current actor's fixed decision slot.
 * @param request - Validated source material and deployment policy.
 * @param runtime - Original explicit World parser/reducer catalog; absent only for base simulation operations.
 * @returns a reproducible preparation or an explicit required-content overflow.
 */
export function prepareContext(
  state: SimulationSnapshot, decision: SimulationDecision, request: SimulationContextRequest, runtime?: NativeWorldRuntime,
): SimulationContextPreparation {
  if (request.sections.some(section => section.blocks.some(block =>
    businessMaterial(block) !== undefined || stoppingMaterial(block) !== undefined)))
    throw new Error('Business context material is reserved to the original Native actor projection')
  for (const kind of REQUIRED) {
    if (!request.sections.some(section => section.kind === kind && section.required)) {
      throw new Error(`Simulation context requires the complete ${kind} section`)
    }
  }
  const task = taskDecision(state, decision.id)
  const taskInput = task === undefined ? undefined : taskDecisionBlock(task.execution, task.decision)
  const ingress = decision.ingressId === undefined ? undefined : state.ingresses?.[decision.ingressId]
  if (decision.ingressId !== undefined && (ingress?.request.entityId !== decision.entityId
    || ingress.eventId !== decision.wakeId || state.scheduledEvents[ingress.eventId]?.status !== 'consumed'
    || BigInt(ingress.key.time) > BigInt(decision.time))) throw new Error('Simulation ingress is not available to this decision')
  let sections = [...(ingress === undefined ? request.sections : request.sections.map(section => section.kind !== 'input' ? section : {
    ...section, blocks: [...section.blocks, ingressBlock(ingress)],
  }))]
  const sources = [...(ingress === undefined || request.sources.some(source => source.kind === 'run-event'
    && source.runId === state.spec.runId && source.sequence === ingress.sequence) ? request.sources : [
      ...request.sources, { kind: 'run-event' as const, runId: state.spec.runId, sequence: ingress.sequence },
    ])]
  const control = state.runControl?.current
  if (control !== undefined) {
    sections = sections.map(section => section.kind !== 'authority' ? section : { ...section,
      blocks: [...section.blocks, stoppingBlock(control.revision, control.target)] })
    const source = { kind: 'run-event' as const, runId: state.spec.runId, sequence: control.revision }
    if (!sources.some(value => isDeepStrictEqual(value, source))) sources.push(source)
  }
  const responsibilities = businessContext(state, decision)
  if (responsibilities !== undefined) {
    sections = sections.map(section => section.kind !== 'commitments' ? section : { ...section,
      blocks: [...section.blocks, { type: 'text' as const, text: JSON.stringify(responsibilities) }] })
    if (!sources.some(value => isDeepStrictEqual(value, responsibilities.source))) sources.push(responsibilities.source)
  }
  let worldScopeAccess: readonly import('@clocky/clocky-simulation').SimulationEntityId[] | undefined
  const world = request.world === undefined ? undefined : worldContext(state, decision, request.world, runtime)
  if (world !== undefined) {
    worldScopeAccess = world.worldScopeAccess
    sections = sections.map(section => section.kind === 'input' ? { ...section, blocks: [...section.blocks,
      { type: 'text' as const, text: world.text }] } : section)
    for (const source of world.sources) if (!sources.some(value => isDeepStrictEqual(value, source))) sources.push(source)
  } else if (state.world !== undefined) {
    const worldFacts = projectWorldFacts(state, { viewer: decision.entityId, cursor: decision.snapshotRevision,
      time: decision.time, limit: state.spec.maxKnowledgePerQuery })
    const norms = normContextMaterial(state, decision.entityId, decision.time, decision.snapshotRevision)
    worldScopeAccess = [...new Set([
      ...worldFacts.items.filter(value => value.fact.audience.kind === 'scope-members').map(value => value.fact.scope),
      ...norms.material.items.filter(value => value.norm.audience.kind === 'scope-members').map(value => value.norm.scope),
    ])]
    sections = sections.map(section => section.kind !== 'input' ? section : { ...section, blocks: [...section.blocks,
      { type: 'text' as const, text: JSON.stringify({ kind: 'world-background', worldFacts, norms: norms.material }) }] })
    for (const source of [...norms.sources, ...worldFacts.items.flatMap(({ fact }) => [
      { kind: 'run-event' as const, runId: state.spec.runId, sequence: fact.sequence }, ...fact.source.references,
    ])]) if (!sources.some(value => isDeepStrictEqual(value, source))) sources.push(source)
  }
  if (taskInput !== undefined && task !== undefined) {
    sections = sections.map(section => section.kind === 'input' ? { ...section, blocks: [...section.blocks, taskInput] } : section)
    const reservation = { kind: 'run-event' as const, runId: state.spec.runId, sequence: task.execution.reservedSequence }
    if (task.execution.request.interaction !== undefined && !sources.some(source => isDeepStrictEqual(source, reservation))) {
      sources.push(reservation)
    }
    if (!sources.some(source => source.kind === 'run-event' && source.runId === state.spec.runId && source.sequence === task.decision.sequence)) {
      sources.push({ kind: 'run-event', runId: state.spec.runId, sequence: task.decision.sequence })
    }
  }
  const knowledge = request.knowledge === undefined ? [] : selectKnowledge(state, { viewer: decision.entityId,
    cursor: decision.snapshotRevision, time: decision.time, limit: request.knowledge.ids.length, ids: request.knowledge.ids })
  if (request.knowledge !== undefined) {
    if (request.knowledge.visibleReports?.some(id => !knowledge.some(item => item.source.kind === 'report' && item.source.operationId === id))) {
      throw new Error('Simulation report references must belong to selected knowledge')
    }
    if (knowledge.length !== request.knowledge.ids.length) throw new Error('Simulation selected knowledge is missing, unavailable or unauthorized')
    if (sections.some(section => section.kind === 'knowledge')) throw new Error('Simulation automatic knowledge cannot share a manual section')
    const history = sections.findIndex(section => section.kind === 'history')
    sections.splice(history < 0 ? sections.length : history, 0, {
      kind: 'knowledge', required: request.knowledge.required, blocks: knowledge.map(item => knowledgeBlock(item, item.source.kind === 'report'
        && request.knowledge?.visibleReports?.includes(item.source.operationId) === true)),
    })
    for (const item of knowledge) if (!sources.some(source => source.kind === 'run-event' && source.runId === state.spec.runId && source.sequence === item.sequence)) {
      sources.push({ kind: 'run-event', runId: state.spec.runId, sequence: item.sequence })
    }
  }
  const key = createHash('sha256').update(JSON.stringify([state.spec.runId, decision.entityId, decision.id, decision.slot, decision.epoch])).digest('hex')
  const base = {
    version: 1, runId: state.spec.runId, entityId: decision.entityId, windowId: decision.windowId ?? `simulation-window:${decision.id}`,
    slot: decision.slot, epoch: decision.epoch, time: decision.time, inputId: `simulation-input:${key}`,
    projections: { run: decision.snapshotRevision, entity: decision.entityRevision, team: request.teamCursor },
    versions: { rules: state.spec.rulesVersion,
      policy: businessFingerprint({ version: state.spec.policyVersion, maxBytes: request.maxBytes }),
      persona: request.personaVersion, model: request.modelVersion }, sources,
    content: sections.map(({ kind, blocks }) => ({ kind, blocks })),
  }
  if (!isSimulationContextView(base)) throw new Error('Simulation context has invalid section order or scoped evidence')
  const fingerprint = businessFingerprint(request)
  const budget = budgetSections(sections, request.maxBytes)
  const requiredBytes = budget.requiredBytes
  if (budget.content === undefined) return { status: 'overflow', fingerprint, requiredBytes, teamCursor: request.teamCursor, maxBytes: request.maxBytes,
    ...request.knowledge?.visibleReports === undefined ? {} : { visibleReports: request.knowledge.visibleReports } }
  const content = budget.content
  const selected = new Set(content.map(section => section.kind))
  return { status: 'prepared', ...world === undefined ? {} : { world: world.authority },
    ...worldScopeAccess === undefined ? {} : { worldScopeAccess }, requiredSections: budget.requiredSections,
    ...request.knowledge?.visibleReports === undefined ? {} : { visibleReports: request.knowledge.visibleReports },
    ...request.knowledge === undefined || !selected.has('knowledge') ? {} : { knowledge: knowledge.map(({ id, revision }) => ({ id, revision })),
      ...request.knowledge.visibleReports === undefined ? {} : { referencedReports: request.knowledge.visibleReports } },
    fingerprint, teamCursor: request.teamCursor, view: { ...base, content }, maxBytes: request.maxBytes,
    retainedBytes: size(content), omitted: budget.omitted }
}
/**
 * Rebudget a new presentation of the same knowledge after compaction removes canonical report messages.
 * @param state - Current permissions and immutable source versions.
 * @param decision - Prepared decision whose input identity must remain unchanged.
 * @param reports - Referenced reports that now require inline bodies.
 * @returns a new authoritative presentation or required-content overflow.
 */
export function materializeReports(state: SimulationSnapshot, decision: SimulationDecision,
  reports: readonly import('@clocky/clocky-simulation').SimulationOperationId[]): SimulationContextPreparation {
  const context = decision.context
  if (context?.status !== 'prepared' || context.knowledge === undefined || context.referencedReports === undefined
    || reports.length === 0 || new Set(reports).size !== reports.length
    || reports.some(id => !context.referencedReports?.includes(id))) throw new Error('Simulation report materialization has no current references')
  assertKnowledgeAccess(state, decision)
  const replacements = new Map<string, { type: 'text'; text: string }>()
  for (const ref of context.knowledge) {
    const item = state.knowledge?.[ref.id]?.[ref.revision - 1] as import('@clocky/clocky-simulation').SimulationKnowledge
    if (item.source.kind === 'report' && reports.includes(item.source.operationId)) {
      replacements.set(knowledgeBlock(item, true).text, knowledgeBlock(item))
    }
  }
  const sections = context.view.content.map(section => ({ ...section, required: context.requiredSections.includes(section.kind),
    blocks: section.kind !== 'knowledge' ? section.blocks : section.blocks.map(block => replacements.get((block as { text: string }).text) ?? block) }))
  const budget = budgetSections(sections, context.maxBytes)
  if (budget.content === undefined) return { status: 'overflow', fingerprint: context.fingerprint,
    requiredBytes: budget.requiredBytes, maxBytes: context.maxBytes, teamCursor: context.teamCursor,
    ...context.visibleReports === undefined ? {} : { visibleReports: context.visibleReports } }
  const content = budget.content
  const selected = new Set(content.map(section => section.kind))
  const omitted = new Set([...context.omitted, ...budget.omitted])
  const next = { ...context, view: { ...context.view, content }, retainedBytes: size(content), omitted: [...omitted],
    previousPresentationHashes: [...context.previousPresentationHashes ?? [], businessFingerprint(context.view)] }
  if (selected.has('knowledge')) next.referencedReports = context.referencedReports.filter(id => !reports.includes(id))
  else { delete next.knowledge; delete next.referencedReports }
  return next
}
function budgetSections(sections: readonly (SimulationContextSection & { readonly required: boolean })[], maxBytes: number): {
  requiredBytes: number
  requiredSections: SimulationContextSection['kind'][]
  content?: SimulationContextSection[]
  omitted: SimulationContextSection['kind'][]
} {
  const required = sections.filter(section => section.required)
  const requiredBytes = size(required)
  const requiredSections = required.map(section => section.kind)
  if (requiredBytes > maxBytes) return { requiredBytes, requiredSections, omitted: [] }
  const selected = new Set(requiredSections)
  const omitted: SimulationContextSection['kind'][] = []
  for (const section of sections) {
    if (section.required) continue
    if (size(sections.filter(candidate => selected.has(candidate.kind) || candidate.kind === section.kind)) <= maxBytes) {
      selected.add(section.kind)
    } else omitted.push(section.kind)
  }
  return { requiredBytes, requiredSections, omitted,
    content: sections.filter(section => selected.has(section.kind)).map(({ kind, blocks }) => ({ kind, blocks })) }
}
function knowledgeBlock(item: import('@clocky/clocky-simulation').SimulationKnowledge, referenceOnly = false): { type: 'text'; text: string } {
  const { readers: _readers, sequence: _sequence, statement, ...identity } = item
  const content = referenceOnly ? identity : { ...identity, statement }
  return { type: 'text', text: JSON.stringify(content) }
}
/**
 * Recheck selected knowledge and World scope access before retrieval or inference without erasing Session history.
 * @param state - Current permissions and immutable knowledge versions.
 * @param decision - Current prepared decision.
 */
export function assertKnowledgeAccess(state: SimulationSnapshot, decision: SimulationDecision): void {
  if (decision.context?.status !== 'prepared') return
  assertPreparedWorldScopeAccess(state, decision)
  if (!decision.context.knowledge?.every(ref => knowledgeVisible(state, ref, {
    viewer: decision.entityId, cursor: decision.snapshotRevision, time: decision.time, limit: state.spec.maxKnowledgePerQuery,
  })) && decision.context.knowledge !== undefined) throw new Error('Simulation prepared knowledge is no longer authorized')
}
function size(sections: readonly SimulationContextSection[]): number {
  return simulationContextBytes(sections)
}
function ingressBlock(ingress: import('@clocky/clocky-simulation').SimulationIngress): { type: 'text'; text: string } {
  return { type: 'text', text: `External input ${JSON.stringify(ingress.request.id)} from ${JSON.stringify(ingress.request.source)}:\n${ingress.request.text}` }
}

/**
 * Check selected context against the decision and its retained budget accounting.
 * @param state - Authoritative published run projection.
 * @param decision - Decision whose context is being checked.
 */
export function assertContextProjection(state: SimulationSnapshot, decision: SimulationDecision): void {
  const context = decision.context
  if (context === undefined) return
  if (context.status === 'overflow') {
    if (context.requiredBytes <= context.maxBytes || decision.status === 'open' && state.phase === 'running') {
      throw new Error('Simulation overflowing context has inconsistent accounting or admission state')
    }
    return
  }
  assertBusinessContextProjection(state, decision)
  const view = context.view
  const stopping = view.content.flatMap(section => section.blocks.flatMap((block) => {
    const material = stoppingMaterial(block)
    return material === undefined ? [] : [{ kind: section.kind, block, material: stoppingContextSchema.parse(material) }]
  }))
  if (stopping.length > 1) throw new Error('Prepared context duplicates its Native stopping fact')
  for (const { kind, block, material } of stopping) {
    const owner = Object.values(state.runControl?.commands ?? {}).find(value => value.receipt.revision === material.controlRevision)
    if (kind !== 'authority' || owner === undefined || !isDeepStrictEqual(owner.command.target, material.target)
      || !isDeepStrictEqual(block, stoppingBlock(material.controlRevision, material.target))
      || !view.sources.some(source => source.kind === 'run-event' && source.runId === state.spec.runId
        && source.sequence === material.controlRevision)) throw new Error('Prepared stopping fact lost its original Native command')
  }
  if (context.requiredSections.some(kind => !view.content.some(section => section.kind === kind))) {
    throw new Error('Simulation context lost a required section')
  }
  for (const reference of context.knowledge ?? []) {
    const item = state.knowledge?.[reference.id]?.find(value => value.revision === reference.revision)
    if (item === undefined || item.sequence > decision.snapshotRevision
      || !view.sources.some(source => source.kind === 'run-event' && source.runId === state.spec.runId && source.sequence === item.sequence)
      || !view.content.some(section => section.kind === 'knowledge'
      && section.blocks.some(block => isDeepStrictEqual(block, knowledgeBlock(item, item.source.kind === 'report'
        && context.referencedReports?.includes(item.source.operationId) === true))))) {
      throw new Error('Simulation prepared knowledge lost its retained version or content')
    }
  }
  const task = taskDecision(state, decision.id)
  if (task !== undefined && (!view.sources.some(source => source.kind === 'run-event'
    && source.runId === state.spec.runId && source.sequence === task.decision.sequence)
    || task.execution.request.interaction !== undefined && !view.sources.some(source => source.kind === 'run-event'
      && source.runId === state.spec.runId && source.sequence === task.execution.reservedSequence)
    || !view.content.some(section => section.kind === 'input'
      && section.blocks.some(block => isDeepStrictEqual(block, taskDecisionBlock(task.execution, task.decision)))))) {
    throw new Error('Simulation task context lost its recorded source or instructions')
  }
  if (decision.ingressId !== undefined) {
    const ingress = state.ingresses?.[decision.ingressId]
    if (ingress === undefined || !view.content.some(section => section.kind === 'input'
      && section.blocks.some(block => isDeepStrictEqual(block, ingressBlock(ingress))))
      || !view.sources.some(source => source.kind === 'run-event' && source.runId === state.spec.runId && source.sequence === ingress.sequence)) {
      throw new Error('Simulation prepared context lost its ingress content or evidence')
    }
  }
  if (view.runId !== state.spec.runId || view.entityId !== decision.entityId || view.epoch !== decision.epoch
    || view.slot !== decision.slot || view.time !== decision.time || view.projections.run !== decision.snapshotRevision
    || view.projections.entity !== decision.entityRevision || view.projections.team !== context.teamCursor) {
    throw new Error('Simulation prepared context refers to another decision snapshot')
  }
  if (size(view.content) !== context.retainedBytes || context.retainedBytes > context.maxBytes
    || REQUIRED.some(kind => !view.content.some(section => section.kind === kind))
    || context.omitted.some(kind => view.content.some(section => section.kind === kind))) {
    throw new Error('Simulation prepared context has inconsistent retained content accounting')
  }
}
