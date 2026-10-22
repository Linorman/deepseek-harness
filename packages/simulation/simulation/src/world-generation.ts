import { simulationGenerationJobIdSchema, simulationPlannerAssignmentIdSchema } from './generation-identities.ts'
export * from './generation-identities.ts'
/** Bounded generation requests retain actual disclosed bytes independently of director history. */
import { z } from 'zod'
import { simulationEntityIdSchema } from './entity.ts'
import { simulationEntityBindingSchema } from './writer.ts'
import { simTimeSchema } from './time.ts'
import { simulationWorldPersonaSchema, worldRequestIdSchema } from './world.ts'
import { simulationWorldReadSetSchema } from './world-domain.ts'
import { simulationTokenUsageSchema, simulationTokenCount } from './tokens.ts'

const key = z.string().min(1).max(256)
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const budget = z.strictObject({ maxTokens: count.positive(), maxOutputBytes: count.positive().max(1048576), maxAttempts: z.literal(1) })
/** Registered finite plan capability; nesting consumes the original parent's bounds. */
export const simulationPlannerAssignmentSchema = z.strictObject({
  id: simulationPlannerAssignmentIdSchema, jobId: simulationGenerationJobIdSchema,
  requestId: worldRequestIdSchema, domain: key, scope: key, effects: z.array(key).min(1).max(32),
  deadline: simTimeSchema, maxAttempts: z.literal(1), maxDepth: z.number().int().min(0).max(4),
  maxChildren: z.number().int().min(0).max(16), maxTokens: count.positive(), parentId: simulationPlannerAssignmentIdSchema.optional(),
})
/** Declarative limits; acceptance still requires installed domain and live authority checks. */
export type SimulationPlannerAssignment = z.infer<typeof simulationPlannerAssignmentSchema>
/** Fixed input disclosure; its source and audience must be authorized by the caller's live policy before acceptance. */
export const simulationGenerationJobSchema = z.strictObject({
  id: simulationGenerationJobIdSchema, purpose: z.enum(['persona', 'dialogue', 'explanation', 'domain-plan']),
  assistantEntityId: simulationEntityIdSchema, scope: key, audience: z.array(key).min(1).max(64),
  inputs: z.array(z.strictObject({ source: key, content: z.string().max(65536), audience: z.array(key).min(1).max(64) })).max(64),
  outputSchema: z.enum(['persona/1', 'text/1', 'domain-plan/1']),
  model: z.strictObject({ provider: key, name: key, version: key }), promptVersion: key, policyVersion: key,
  budget, deadline: simTimeSchema, supersedes: simulationGenerationJobIdSchema.optional(),
  planner: simulationPlannerAssignmentSchema.optional(),
}).superRefine((job, context) => {
  if ((job.purpose === 'domain-plan') !== (job.planner !== undefined))
    context.addIssue({ code: 'custom', message: 'Only domain-plan jobs require a bounded planner assignment' })
  if (job.planner !== undefined && (job.planner.jobId !== job.id || job.planner.scope !== job.scope
    || BigInt(job.deadline) > BigInt(job.planner.deadline) || job.budget.maxTokens > job.planner.maxTokens))
    context.addIssue({ code: 'custom', message: 'Generation must remain inside its original planner assignment' })
  if (job.outputSchema !== (job.purpose === 'persona' ? 'persona/1' : job.purpose === 'domain-plan' ? 'domain-plan/1' : 'text/1'))
    context.addIssue({ code: 'custom', message: 'Generation purpose requires its fixed output schema' })
  if (new Set(job.audience).size !== job.audience.length
    || job.inputs.some(input => job.audience.some(value => !input.audience.includes(value))))
    context.addIssue({ code: 'custom', message: 'Generation output audience must be authorized for every actual input' })
  if (new TextEncoder().encode(JSON.stringify(job)).byteLength > 1048576)
    context.addIssue({ code: 'custom', message: 'Complete generation request exceeds one MiB' })
})
/** Immutable request admitted by the trusted host; models cannot create jobs or select source materials. */
export type SimulationGenerationJob = z.infer<typeof simulationGenerationJobSchema>
/** Raw output is retained before parsing; original input and output references survive invalid schema and revocation. */
export const simulationGenerationTransitionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('accept'), job: simulationGenerationJobSchema }),
  z.strictObject({ kind: z.literal('start'), id: simulationGenerationJobIdSchema, sessionSequence: count }),
  z.strictObject({ kind: z.literal('output'), id: simulationGenerationJobIdSchema, content: z.string().max(1048576), usage: simulationTokenUsageSchema.optional() }),
  z.strictObject({ kind: z.literal('validate'), id: simulationGenerationJobIdSchema }),
  z.strictObject({ kind: z.literal('incorporate'), id: simulationGenerationJobIdSchema, reference: key }),
  z.strictObject({ kind: z.literal('cancel'), id: simulationGenerationJobIdSchema, reason: key }),
  z.strictObject({ kind: z.literal('unknown'), id: simulationGenerationJobIdSchema, reason: key, observedUsage: simulationTokenUsageSchema.optional() }),
])
/** Host transitions are serialized with the Native journal; none executes a model. */
export type SimulationGenerationTransition = z.infer<typeof simulationGenerationTransitionSchema>
/** Generation responsibility including unknown or late provider results. */
export interface SimulationGenerationRecord {
  readonly job: SimulationGenerationJob
  readonly binding: import('./binding-types.ts').SimulationEntityBinding
  readonly acceptedSequence: number
  readonly planningReads?: import('./world-types.ts').SimulationWorldReadSet
  readonly interval: import('./time-types.ts').SimTime
  readonly status: 'accepted' | 'generating' | 'output-retained' | 'validated' | 'incorporated' | 'rejected' | 'cancelled' | 'unknown'
  readonly sessionSequence?: number
  readonly content?: string
  readonly usage?: z.infer<typeof simulationTokenUsageSchema>
  readonly observedUsage?: z.infer<typeof simulationTokenUsageSchema>
  readonly cancellation?: string
  readonly reason?: string
  readonly incorporatedReference?: string
  readonly incorporatedRevision?: number
  readonly incorporatedBodyHash?: string
}
/**
 * Read a user-authored job key without consulting JavaScript object-prototype properties.
 * @param state - Trusted current Native projection; this lookup grants no disclosure authority.
 * @param id - Exact original job key, including names such as constructor or toString.
 * @returns the retained own record, or undefined without allocating or inferring anything.
 */
export function generationRecordAt(state: Pick<import('./types.ts').SimulationSnapshot, 'generationJobs'>,
  id: string): SimulationGenerationRecord | undefined {
  const jobs = state.generationJobs
  return jobs !== undefined && Object.hasOwn(jobs, id) ? jobs[id] : undefined
}

/**
 * Validate the complete bounded delegation ancestry against the current durable prefix.
 * @param state - Original jobs and current simulation time; no ambient owner state is consulted.
 * @param assignment - Proposed or already accepted child assignment.
 * @returns original immediate-parent-first ancestry; cancellation, expiry, missing links,
 * cycles or subtree budget overruns reject new work.
 */
export function activePlannerAncestors(state: Pick<import('./types.ts').SimulationSnapshot, 'generationJobs' | 'time'>,
  assignment: SimulationPlannerAssignment): readonly SimulationGenerationRecord[] {
  const current = Object.values(state.generationJobs ?? {}).find(record => record.job.planner?.id === assignment.id)
  if (current?.job.planner !== undefined && plannerReservedTokens(state, current) > BigInt(current.job.planner.maxTokens))
    throw new Error('Planner allocation or observed usage exceeds its budget')
  const seen = new Set([assignment.id]), parents: SimulationGenerationRecord[] = []
  let parentId = assignment.parentId
  while (parentId !== undefined) {
    if (seen.has(parentId) || parents.length >= 4) throw new Error('Planner ancestry exceeds its finite acyclic depth')
    seen.add(parentId)
    const parent = Object.values(state.generationJobs ?? {}).find(record => record.job.planner?.id === parentId)
    if (parent?.job.planner === undefined || parent.cancellation !== undefined
      || ['rejected', 'cancelled', 'incorporated'].includes(parent.status)
      || BigInt(parent.job.planner.deadline) <= BigInt(state.time) || BigInt(parent.job.deadline) <= BigInt(state.time))
      throw new Error('Planner parent or ancestor no longer admits delegation')
    if (plannerReservedTokens(state, parent) > BigInt(parent.job.planner.maxTokens))
      throw new Error('Planner ancestor allocation or observed usage exceeds its budget')
    parents.push(parent)
    parentId = parent.job.planner.parentId
  }
  return parents
}

/**
 * Charge a parent's own attempt and each child's complete original allocation, including observed overruns.
 * @param state - Original durable jobs; descendants cannot create a separate accounting pool.
 * @param parent - Exact accepted parent job.
 * @returns conservative bounded-tree token allocation as an exact integer.
 */
export function plannerReservedTokens(state: Pick<import('./types.ts').SimulationSnapshot, 'generationJobs'>,
  parent: SimulationGenerationRecord): bigint {
  const walk = (record: SimulationGenerationRecord, seen: ReadonlySet<string>): bigint => {
    const assignment = record.job.planner
    if (assignment === undefined || seen.has(assignment.id) || seen.size > 4) throw new Error('Planner budget ancestry is invalid')
    const next = new Set([...seen, assignment.id])
    const consumption = record.usage ?? record.observedUsage
    const charge = BigInt(Math.max(record.job.budget.maxTokens, consumption === undefined ? 0 : simulationTokenCount(consumption)))
    return Object.values(state.generationJobs ?? {}).filter(value => value.job.planner?.parentId === assignment.id)
      .reduce((total, child) => {
        const childAssignment = child.job.planner
        if (childAssignment === undefined) throw new Error('Planner child allocation lost its original assignment')
        const actual = walk(child, next), allocated = BigInt(childAssignment.maxTokens)
        return total + (actual > allocated ? actual : allocated)
      }, charge)
  }
  return walk(parent, new Set())
}

/** Immutable proposal envelope; only the actual director may select it into a Native plan. */
export const simulationGeneratedPlanSchema = z.strictObject({ requestId: worldRequestIdSchema, domain: key, scope: key,
  effects: z.array(z.strictObject({ kind: key, payload: z.json() })).length(1), readSet: simulationWorldReadSetSchema.max(128) })
/**
 * Materialize the exact reviewed helper output for a director's Session context.
 * @param record - Validated original helper output; no ambient history is read.
 * @returns the exact text checked when a director selects this generation into its plan.
 */
export function generationPlanInput(record: SimulationGenerationRecord): string {
  return JSON.stringify({ kind: 'generation-plan', jobId: record.job.id, content: record.content,
    sessionId: record.binding.sessionId, sessionSequence: record.sessionSequence })
}
/**
 * Resolve the fixed response contract without provider access.
 * @param job - Accepted purpose and schema version.
 * @returns concrete JSON schema for structured output, or an explicit bounded text instruction.
 */
export function generationOutputContract(job: SimulationGenerationJob): object {
  return job.outputSchema === 'text/1' ? { type: 'string', minLength: 1, maxUtf8Bytes: job.budget.maxOutputBytes }
    : z.toJSONSchema(job.outputSchema === 'persona/1' ? simulationWorldPersonaSchema : simulationGeneratedPlanSchema, { io: 'input' })
}
/**
 * Validate retained output without inference; a successful parse grants no world mutation authority.
 * @param job - Original purpose, response schema and byte allowance.
 * @param content - Already retained raw provider output.
 * @returns whether the entire output matches its fixed schema and effect allowlist.
 */
export function validateGenerationOutput(job: SimulationGenerationJob, content: string): boolean {
  if (new TextEncoder().encode(content).byteLength > job.budget.maxOutputBytes) return false
  if (job.outputSchema === 'text/1') return content.length > 0
  let value: unknown
  try { value = JSON.parse(content) }
  catch { return false /* Invalid provider JSON is retained as a rejected output, never retried implicitly. */ }
  if (job.outputSchema === 'persona/1') return simulationWorldPersonaSchema.safeParse(value).success
  const parsed = simulationGeneratedPlanSchema.safeParse(value)
  const planner = job.planner
  return parsed.success && planner !== undefined && parsed.data.domain === planner.domain
    && parsed.data.scope === planner.scope && parsed.data.effects.every(effect => planner.effects.includes(effect.kind))
}

/** Complete retained generation DTO; transport readers reject unknown fields and malformed original identities. */
export const simulationGenerationRecordSchema = z.strictObject({ job: simulationGenerationJobSchema,
  binding: simulationEntityBindingSchema.refine(value =>
    [value.teamId, value.participantId, value.sessionId].every(id => id.length <= 256), 'Generation canonical identities exceed their wire bound'),
  acceptedSequence: count.positive(), interval: simTimeSchema,
  planningReads: simulationWorldReadSetSchema.optional(),
  status: z.enum(['accepted', 'generating', 'output-retained', 'validated', 'incorporated', 'rejected', 'cancelled', 'unknown']),
  sessionSequence: count.optional(), content: z.string().max(1048576).optional(), usage: simulationTokenUsageSchema.optional(),
  observedUsage: simulationTokenUsageSchema.optional(),
  cancellation: key.optional(), reason: key.optional(), incorporatedReference: key.optional(),
  incorporatedRevision: count.positive().optional(),
  incorporatedBodyHash: z.string().regex(/^sha256:[a-f0-9]{64}$/).optional(),
})
