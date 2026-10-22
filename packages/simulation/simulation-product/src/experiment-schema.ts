/** Browser-safe original experiment commands; private archive bodies and Host target factories never cross this wire. */
import { z } from 'zod'
import { simulationProductRunIdSchema, simulationProductCommandIdSchema } from './schema-common.ts'
const hash = z.string().regex(/^[a-f0-9]{64}$/)
/** Select one immutable completed retention cut under independent whole-record permission. */
export const simulationProductExperimentSourceSchema = z.strictObject({ runId: simulationProductRunIdSchema,
  archiveCommandId: simulationProductCommandIdSchema })
/** Explicit new writable simulation; identity comes from the original caller-retained UUID. */
export const simulationProductWorldBranchInputSchema = z.strictObject({ source: simulationProductExperimentSourceSchema,
  commandId: z.uuid(), name: z.string().trim().min(1).max(256), memoryPolicy: z.enum(['public-facts', 'authorized-memory']) })
/** Original command lookup; a refresh never creates another branch or resumes scheduling. */
export const simulationProductWorldBranchReadInputSchema = z.strictObject({ commandId: z.uuid() })
/** Durable command metadata contains no private inherited text or Host paths. */
export const simulationProductWorldBranchResultSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('not-found'), commandId: z.uuid() }),
  z.strictObject({ status: z.enum(['accepted', 'completed']), commandId: z.uuid(), runId: simulationProductRunIdSchema,
    source: simulationProductExperimentSourceSchema, sourceHash: hash, memoryPolicy: z.enum(['public-facts', 'authorized-memory']),
    phase: z.literal('paused'), realEffects: z.literal(false) }),
])
/** Finite causal references over actual Native originals, without private source prose. */
export const simulationProductWorldCausalInputSchema = z.strictObject({ source: simulationProductExperimentSourceSchema,
  root: z.string().min(1).max(256), maxDepth: z.number().int().min(0).max(32), maxNodes: z.number().int().min(1).max(1000),
  maxBytes: z.number().int().min(1).max(1048576) })
/** Missing and inaccessible causal roots are indistinguishable. */
export const simulationProductWorldCausalResultSchema = z.strictObject({ source: simulationProductExperimentSourceSchema, sourceHash: z.union([hash, z.literal('unavailable')]),
  nodes: z.array(z.strictObject({ key: z.string(), kind: z.enum(['event', 'decision', 'operation', 'effect', 'request', 'plan']),
    sequence: z.number().int().nonnegative(), recordHash: hash })), edges: z.array(z.strictObject({ from: z.string(), to: z.string(),
    relation: z.enum(['accepted-operation', 'actual-result', 'opened-request', 'resolved-request', 'accepted-plan',
      'scheduled-event', 'consumed-event', 'operation-dependency']) })), coverage: z.enum(['bounded', 'unknown']) })
/** Compare two separately authorized archived observations with the same recorded parent cut. */
export const simulationProductWorldCompareInputSchema = z.strictObject({ left: simulationProductExperimentSourceSchema,
  right: simulationProductExperimentSourceSchema })
const budget = z.strictObject({ maxTokens: z.number().int().positive(), maxTime: z.string().regex(/^(0|[1-9][0-9]*)$/) })
const stop = z.strictObject({ phase: z.string(), time: z.string(), stall: z.string().nullable() })
/** Observation differences never imply a causal conclusion, deterministic replay or invented quality/cost. */
export const simulationProductWorldCompareResultSchema = z.strictObject({ version: z.literal(1),
  observations: z.strictObject({ left: simulationProductExperimentSourceSchema, right: simulationProductExperimentSourceSchema }),
  parentCut: z.strictObject({ runId: z.string(), hash, revision: z.number().int().nonnegative() }),
  variables: z.strictObject({ left: z.record(z.string(), z.json()), right: z.record(z.string(), z.json()) }),
  memoryPolicy: z.strictObject({ left: z.string(), right: z.string() }), budget: z.strictObject({ left: budget, right: budget }),
  differences: z.array(z.strictObject({ category: z.string(),
    equal: z.boolean(), leftHash: hash, rightHash: hash })), quality: z.strictObject({ status: z.literal('unknown') }),
  cost: z.strictObject({ status: z.literal('unknown') }), stop: z.strictObject({ left: stop, right: stop }),
  nondeterminism: z.string(), causalConclusion: z.literal('not-established') })
