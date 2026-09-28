/** Versioned attributed knowledge, distinct from authoritative world state. @module @clocky/clocky-simulation/knowledge */
import { z } from 'zod'
import { simulationPolicyRefSchema } from './deterministic.ts'
import type { SimulationPolicyRef } from './deterministic.ts'
import type { Branded } from '@clocky/clocky-brand'
import { simulationEntityIdSchema } from './entity.ts'
import { simulationDecisionIdSchema, simulationOperationIdSchema } from './business.ts'
import { simTimeSchema } from './time.ts'

/** Stable owner-local knowledge identity within a run. */
export const simulationKnowledgeIdSchema = z.string().min(1).transform(value => value as Branded<'SimulationKnowledgeId'>)
/** Exact retained premise version; later edits cannot rewrite an inference's inputs. */
export const simulationKnowledgeRefSchema = z.strictObject({ id: simulationKnowledgeIdSchema, revision: z.number().int().positive() })
/** Attributed origin; a report or belief never becomes an authoritative world fact. */
export const simulationKnowledgeSourceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('observation'), worldRevision: z.number().int().positive(), visibilityPolicy: z.string().min(1) }),
  z.strictObject({ kind: z.literal('report'), operationId: simulationOperationIdSchema }),
  z.strictObject({ kind: z.literal('inference'), decisionId: simulationDecisionIdSchema,
    premises: z.array(simulationKnowledgeRefSchema).min(1), confidence: z.number().min(0).max(1).optional() }),
  z.strictObject({ kind: z.literal('summary'), policy: simulationPolicyRefSchema, cursor: z.number().int().nonnegative(),
    premises: z.array(simulationKnowledgeRefSchema).min(1) }),
  z.strictObject({ kind: z.literal('belief'), profileRevision: z.number().int().positive(), policyVersion: z.string().min(1),
    confidence: z.number().min(0).max(1).optional() }),
])
/** Complete next version, including the explicit audience; ownership and kind are immutable. */
export const simulationKnowledgeRequestSchema = z.strictObject({
  id: simulationKnowledgeIdSchema, owner: simulationEntityIdSchema, expectedRevision: z.number().int().nonnegative(),
  statement: z.string().min(1), source: simulationKnowledgeSourceSchema,
  observedAt: simTimeSchema, availableAt: simTimeSchema,
  validFrom: simTimeSchema, validUntil: simTimeSchema.nullable(),
  readers: z.array(simulationEntityIdSchema).refine(ids => new Set(ids).size === ids.length, 'Knowledge readers must be distinct'),
})
/** Explicit inputs, audience and availability for a source-scoped pure summary. */
export const simulationSummaryRequestSchema = simulationKnowledgeRequestSchema.omit({ owner: true, statement: true,
  source: true, observedAt: true }).extend({ inputs: z.array(simulationKnowledgeIdSchema).min(1)
  .refine(ids => new Set(ids).size === ids.length, 'Summary inputs must be distinct') })
/** Administrative summary request; content is computed only from authorized versions. */
export type SimulationSummaryRequest = z.infer<typeof simulationSummaryRequestSchema>
/** Explicit bounded query; callers cannot inspect a future cursor or simulation time. */
export const simulationKnowledgeQuerySchema = z.strictObject({ viewer: simulationEntityIdSchema,
  cursor: z.number().int().nonnegative(), time: simTimeSchema, limit: z.number().int().positive(),
  ids: z.array(simulationKnowledgeIdSchema).optional() })
/** Knowledge identity. */
export type SimulationKnowledgeId = z.infer<typeof simulationKnowledgeIdSchema>
/** Exact premise identity. */
export type SimulationKnowledgeRef = z.infer<typeof simulationKnowledgeRefSchema>
/** Administrative version write. */
export type SimulationKnowledgeRequest = z.infer<typeof simulationKnowledgeRequestSchema>
/** Bounded as-of selection. */
export type SimulationKnowledgeQuery = z.infer<typeof simulationKnowledgeQuerySchema>
/** Historical versions remain available for provenance; current audience still governs new retrieval. */
export interface SimulationKnowledge extends Omit<SimulationKnowledgeRequest, 'expectedRevision'> {
  readonly revision: number
  readonly sequence: number
}

/** Trusted bounded, synchronous, IO-free summarization over explicitly selected material. */
export interface SimulationSummaryPolicy extends SimulationPolicyRef {
  /**
   * Condense selected statements without reading ambient Session/channel history or mutating the material.
   * @param items - Detached frozen knowledge versions, excluding audience metadata.
   * @returns summary text; the record byte budget still applies.
   */
  summarize(this: void, items: readonly Readonly<Omit<SimulationKnowledge, 'readers'>>[]): string
}
