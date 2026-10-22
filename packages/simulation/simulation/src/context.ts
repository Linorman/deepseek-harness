import { simulationWorldContextRequestSchema } from './world.ts'
/** Explicit materialization inputs supplied by the authorized cognition owner. @module @clocky/clocky-simulation/context */
import { z } from 'zod'
import { simulationOperationIdSchema } from './business.ts'
import { simulationKnowledgeIdSchema } from './knowledge.ts'
import { SIMULATION_CONTEXT_SECTIONS } from '@clocky/clocky-session/surface'
import type { SimulationContextSection, SimulationContextViewEventData } from '@clocky/clocky-session/types'
import { simulationContextReferenceSchema } from './context-reference.ts'

/** Ordered whole sections; additional required evidence cannot be discarded by the budget policy. */
export const simulationContextRequestSchema = z.strictObject({
  world: simulationWorldContextRequestSchema.optional(),
  knowledge: z.strictObject({ ids: z.array(simulationKnowledgeIdSchema).min(1)
    .refine(ids => new Set(ids).size === ids.length, 'Knowledge selection requires distinct identities'), required: z.boolean(), visibleReports: z.array(simulationOperationIdSchema).optional() }).optional(),
  maxBytes: z.number().int().positive(),
  teamCursor: z.number().int().nonnegative(),
  personaVersion: z.string().min(1),
  modelVersion: z.string().min(1),
  sources: z.array(simulationContextReferenceSchema),
  sections: z.array(z.strictObject({
    kind: z.enum(SIMULATION_CONTEXT_SECTIONS), required: z.boolean(),
    blocks: z.custom<SimulationContextSection['blocks']>(value => Array.isArray(value) && value.length > 0
      && value.every((block: unknown) => typeof block === 'object' && block !== null && !Array.isArray(block)
        && 'type' in block && typeof block.type === 'string' && block.type.length > 0)),
  })).min(1),
}).transform(value => structuredClone(value))
/** Deployment budget and already-authorized source material; never an unchecked model-tool payload. */
export type SimulationContextRequest = z.infer<typeof simulationContextRequestSchema>
/** Frozen outcome of deterministic, whole-section selection. */
export type SimulationContextPreparation = {
  readonly status: 'prepared'
  readonly world?: import('./world-types.ts').SimulationWorldContext
  /** Current scope memberships required by the selected WorldFact/Norm bodies; absent only before World configuration. */
  readonly worldScopeAccess?: readonly import('./identities.ts').SimulationEntityId[]
  readonly requiredSections: readonly SimulationContextSection['kind'][]
  readonly previousPresentationHashes?: readonly string[]
  readonly visibleReports?: readonly import('./business-types.ts').SimulationOperationId[]
  readonly referencedReports?: readonly import('./business-types.ts').SimulationOperationId[]
  readonly knowledge?: readonly import('./knowledge.ts').SimulationKnowledgeRef[]
  readonly fingerprint: string
  readonly view: SimulationContextViewEventData
  readonly teamCursor: number
  readonly maxBytes: number
  readonly retainedBytes: number
  readonly omitted: readonly SimulationContextSection['kind'][]
} | {
  readonly status: 'overflow'
  readonly visibleReports?: readonly import('./business-types.ts').SimulationOperationId[]
  readonly fingerprint: string
  readonly requiredBytes: number
  readonly teamCursor: number
  readonly maxBytes: number
}
