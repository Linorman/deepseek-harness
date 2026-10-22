/** Rebuildable comparison and causal references over exact authorized archived Native prefixes. */
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import { simulationExperimentInitSchema } from '@clocky/clocky-simulation'
import type { SimulationSnapshot } from '@clocky/clocky-simulation'
import type { LogArchiveLimits } from '@clocky/clocky-storage'
import { verifyWorldArchive } from './archive.ts'
import type { WorldArchiveBody } from './archive.ts'

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const nodeSchema = z.strictObject({ key: z.string(), kind: z.enum(['event', 'decision', 'operation', 'effect', 'request', 'plan']),
  sequence: z.number().int().nonnegative(), recordHash: z.string().regex(/^[a-f0-9]{64}$/) })
/** Strict finite causal expansion; tiny byte budgets reject the complete response. */
export const worldCausalQuerySchema = z.strictObject({ root: z.string().min(1), maxDepth: z.number().int().min(0).max(32),
  maxNodes: z.number().int().positive().max(1000), maxBytes: z.number().int().positive().max(1024 * 1024) })
/** No graph body carries private model text or authorization caches. */
export const worldCausalIndexSchema = z.strictObject({ version: z.literal(1), sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  journalVersion: z.number().int().positive(), cursor: z.number().int().nonnegative(),
  nodes: z.array(nodeSchema), edges: z.array(z.strictObject({ from: z.string(), to: z.string(),
    relation: z.enum(['accepted-operation', 'actual-result', 'opened-request', 'resolved-request', 'accepted-plan', 'scheduled-event', 'consumed-event', 'operation-dependency']) })) })
/** Rebuildable event references; source hash uses the B1 length-delimited complete-prefix algorithm. */
export type WorldCausalIndex = z.infer<typeof worldCausalIndexSchema>

/**
 * Rebuild solely from retained owner references; missing records become unknown, never invented edges.
 * @param body - Complete owner archive; current authority is enforced independently on query.
 * @param limits - Bounded source scan and byte limits.
 * @returns deterministic derived reference index, disposable without changing source history.
 */
export function buildWorldCausalIndex(body: WorldArchiveBody, limits: LogArchiveLimits): WorldCausalIndex {
  verifyWorldArchive(JSON.stringify(body), limits)
  const prefix = createHash('sha256')
  for (const entry of body.native.entries) {
    const bytes = JSON.stringify(entry); prefix.update(`${Buffer.byteLength(bytes)}:`).update(bytes)
  }
  const nodes: WorldCausalIndex['nodes'] = [], edges: WorldCausalIndex['edges'] = [], keys = new Set<string>()
  const add = (kind: z.infer<typeof nodeSchema>['kind'], id: string, sequence: number) => {
    if (keys.has(`${kind}:${id}`)) return
    const record = body.native.entries[sequence]
    if (record === undefined) return
    nodes.push(nodeSchema.parse({ key: `${kind}:${id}`, kind, sequence, recordHash: digest(record) }))
    keys.add(`${kind}:${id}`)
  }
  // Only original Native envelopes are sources. Snapshot projection fields cannot create references.
  for (const entry of body.native.entries) {
    const envelope = z.object({ kind: z.string(), change: z.unknown().optional() }).parse(entry.value)
    if (envelope.kind === 'run/scheduler') {
      const event = z.object({ kind: z.string(), id: z.string().optional(),
        sourceOperationId: z.string().optional() }).parse(envelope.change)
      if (event.kind === 'event/queued' && event.id !== undefined) {
        add('event', event.id, entry.sequence)
        if (event.sourceOperationId !== undefined) edges.push({ from: `operation:${event.sourceOperationId}`,
          to: `event:${event.id}`, relation: 'scheduled-event' })
      }
    }
    if (envelope.kind !== 'run/business') continue
    const change = z.object({ kind: z.string() }).parse(envelope.change)
    if (change.kind === 'decision/opened') {
      const value = z.object({ id: z.string(), wakeId: z.string().optional() }).parse(envelope.change)
      add('decision', value.id, entry.sequence)
      if (value.wakeId !== undefined) edges.push({ from: `event:${value.wakeId}`, to: `decision:${value.id}`, relation: 'consumed-event' })
    } else if (change.kind === 'operation/intent') {
      const value = z.object({ id: z.string(), decisionId: z.string(), dependencies: z.array(z.string()),
        action: z.object({ kind: z.string(),
          requestId: z.string().optional() }) }).parse(envelope.change)
      add('operation', value.id, entry.sequence)
      for (const predecessor of value.dependencies) edges.push({ from: `operation:${predecessor}`, to: `operation:${value.id}`,
        relation: 'operation-dependency' })
      edges.push({ from: `decision:${value.decisionId}`, to: `operation:${value.id}`, relation: 'accepted-operation' })
      if (value.action.kind === 'world/resolve' && value.action.requestId !== undefined) {
        // Native accepts the canonical world-plan identity in this original operation/intent fold.
        add('request', value.action.requestId, entry.sequence)
        add('plan', `world-plan:${value.id}`, entry.sequence)
        edges.push({ from: `request:${value.action.requestId}`, to: `plan:world-plan:${value.id}`, relation: 'accepted-plan' })
        edges.push({ from: `operation:${value.id}`, to: `plan:world-plan:${value.id}`, relation: 'resolved-request' })
      }
    } else if (change.kind === 'operation/settled') {
      const value = z.object({ id: z.string() }).parse(envelope.change)
      add('effect', value.id, entry.sequence)
      edges.push({ from: `operation:${value.id}`, to: `effect:${value.id}`, relation: 'actual-result' })
    }
  }
  return worldCausalIndexSchema.parse({ version: 1, sourceHash: prefix.digest('hex'), journalVersion: body.native.version,
    cursor: body.native.entries.length - 1, nodes,
    edges: edges.filter(edge => keys.has(edge.from) && keys.has(edge.to)) })
}

/**
 * Return authorized connected references in both directions. Authorization is recomputed for every source record on every read.
 * @param body - Exact original archive, never an unchecked projected index.
 * @param input - Strict complete-result and traversal bounds.
 * @param limits - Original archive scan budget.
 * @param canRead - Live independent source-record permission; denied and missing roots have identical output.
 * @returns bounded metadata and explicit unknown coverage; no model fills missing references.
 */
export function queryWorldCausalIndex(body: WorldArchiveBody, input: z.infer<typeof worldCausalQuerySchema>, limits: LogArchiveLimits,
  canRead: (sequence: number) => boolean): { sourceHash: string; nodes: WorldCausalIndex['nodes']; edges: WorldCausalIndex['edges']; coverage: 'bounded' | 'unknown' } {
  const request = worldCausalQuerySchema.parse(input), index = buildWorldCausalIndex(body, limits)
  const readable = new Map(index.nodes.filter(node => canRead(node.sequence)).map(node => [node.key, node]))
  const root = readable.get(request.root)
  const selected = new Set<string>(), discovered = new Set<string>()
  const adjacency = new Map<string, Set<string>>()
  for (const edge of index.edges) {
    if (!readable.has(edge.from) || !readable.has(edge.to)) continue
    for (const [from, to] of [[edge.from, edge.to], [edge.to, edge.from]] as const) {
      const adjacent = adjacency.get(from) ?? new Set<string>()
      adjacent.add(to); adjacency.set(from, adjacent)
    }
  }
  const queue = root === undefined ? [] : [{ key: root.key, depth: 0 }]
  if (root !== undefined) discovered.add(root.key)
  for (let offset = 0; offset < queue.length; offset++) {
    const item = queue[offset]
    if (item === undefined) break
    selected.add(item.key)
    if (item.depth >= request.maxDepth) continue
    for (const next of adjacency.get(item.key) ?? []) {
      if (discovered.has(next) || discovered.size >= request.maxNodes) continue
      discovered.add(next); queue.push({ key: next, depth: item.depth + 1 })
    }
  }
  const result = { sourceHash: root === undefined ? 'unavailable' : index.sourceHash, nodes: index.nodes.filter(node => selected.has(node.key)),
    edges: index.edges.filter(edge => selected.has(edge.from) && selected.has(edge.to)),
    coverage: root === undefined ? 'unknown' as const : 'bounded' as const }
  if (Buffer.byteLength(JSON.stringify(result)) > request.maxBytes) throw new Error('Complete causal response exceeds byte bound')
  if (result.nodes.some(node => !canRead(node.sequence))) throw new Error('Causal reader authorization changed')
  return result
}

/** Bounded comparison metadata, with cost and quality explicitly unavailable without evaluator evidence. */
export interface WorldExperimentComparison {
  readonly version: number
  readonly parentCut: { readonly runId: string; readonly hash: string; readonly revision: number }
  readonly variables: { readonly left: Record<string, unknown>; readonly right: Record<string, unknown> }
  readonly budget: {
    readonly left: { readonly maxTokens: number; readonly maxTime: string }
    readonly right: { readonly maxTokens: number; readonly maxTime: string }
  }
  readonly memoryPolicy: { readonly left: string; readonly right: string }
  readonly differences: readonly {
    readonly category: string
    readonly equal: boolean
    readonly leftHash: string
    readonly rightHash: string
  }[]
  readonly quality: { readonly status: string }
  readonly cost: { readonly status: string }
  readonly stop: { readonly left: { readonly phase: string; readonly time: string; readonly stall: string | null }
    readonly right: { readonly phase: string; readonly time: string; readonly stall: string | null } }
  readonly nondeterminism: string
  readonly causalConclusion: string
}

/** Compare actual source observations; unavailable quality and cost remain explicit unknowns.
 * @param left - First full authorized archive.
 * @param right - Second full authorized archive with the same parent cut.
 * @param limits - Source and complete report bounds.
 * @param authorize - Current whole-record grant checked before disclosure.
 * @returns bounded differences without a causal conclusion.
 */
export function compareWorldExperiments(left: WorldArchiveBody, right: WorldArchiveBody, limits: LogArchiveLimits,
  authorize: () => void): WorldExperimentComparison {
  authorize(); verifyWorldArchive(JSON.stringify(left), limits); verifyWorldArchive(JSON.stringify(right), limits)
  const a = left.snapshot as unknown as SimulationSnapshot, b = right.snapshot as unknown as SimulationSnapshot
  if (a.experiment === undefined || b.experiment === undefined || a.experiment.parentRunId !== b.experiment.parentRunId
    || a.experiment.sourceHash !== b.experiment.sourceHash || a.experiment.sourceRevision !== b.experiment.sourceRevision)
    throw new Error('Comparison requires the same recorded parent cut')
  for (const [body, snapshot] of [[left, a], [right, b]] as const) {
    const original = z.object({ kind: z.literal('run/branch-init'), request: simulationExperimentInitSchema })
      .parse(body.native.entries[1]?.value)
    if (!isDeepStrictEqual(original.request, snapshot.experiment)) throw new Error('Comparison provenance differs from its original Native event')
  }
  const leftExperiment = a.experiment, rightExperiment = b.experiment
  const identityFields = new Set(['id', 'owner', 'subject', 'object', 'scope', 'entityId', 'directorEntityId',
    'organizationEntityId', 'requesterEntityId', 'scopeEntityId', 'targetEntityId', 'positionEntityId', 'controllers'])
  const normalize = (value: unknown, namespace: string, field = ''): unknown => {
    const prefix = `branch-${namespace}-`
    if (typeof value === 'string') return identityFields.has(field) && value.startsWith(prefix) ? value.slice(prefix.length) : value
    if (Array.isArray(value)) return value.map((child: unknown) => normalize(child, namespace, field))
    if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !['binding', 'writer', 'participantReservation'].includes(key))
      .map(([key, child]) => [field === 'personnel' && key.startsWith(prefix) ? key.slice(prefix.length) : key,
        normalize(child, namespace, key)]))
    return value
  }
  const sections = { facts: [a.world?.facts ?? {}, b.world?.facts ?? {}], resources: [a.resources, b.resources],
    personnel: [a.entities, b.entities], policy: [a.world?.definition ?? {}, b.world?.definition ?? {}] }
  const differences = Object.entries(sections).map(([category, [first, second]]) => ({ category,
    equal: isDeepStrictEqual(normalize(first, leftExperiment.namespace, category), normalize(second, rightExperiment.namespace, category)),
    leftHash: digest(normalize(first, leftExperiment.namespace, category)),
    rightHash: digest(normalize(second, rightExperiment.namespace, category)) }))
  const result = { version: 1, parentCut: { runId: a.experiment.parentRunId, hash: a.experiment.sourceHash,
    revision: a.experiment.sourceRevision }, variables: { left: a.experiment.variables, right: b.experiment.variables },
  budget: { left: a.experiment.budget, right: b.experiment.budget },
  memoryPolicy: { left: a.experiment.memoryPolicy, right: b.experiment.memoryPolicy }, differences,
  quality: { status: 'unknown' }, cost: { status: 'unknown' },
  stop: { left: { phase: a.phase, time: a.time, stall: a.stall?.code ?? null },
    right: { phase: b.phase, time: b.time, stall: b.stall?.code ?? null } },
  nondeterminism: 'Model/provider outputs can differ; equal seeds do not guarantee equal behavior', causalConclusion: 'not-established' }
  if (Buffer.byteLength(JSON.stringify(result)) > limits.maxBytes) throw new Error('Complete comparison exceeds byte bound')
  authorize(); return result
}
