/** Explicit offline transition from the pinned pre-control Native runtime; ordinary backends still reject journal 101. */
import { z } from 'zod'
import { simulationWorldDomainPinSchema } from './world-domain.ts'

/** W0 source snapshot identifies the complete parser/presenter implementation used by the offline verifier. */
export const NATIVE_101_RUNTIME_COMMIT = '0e85170d1236cfe846ebc3b88a073d848903fb47'
/** Creation-only provenance; the original prefix is reconstructed and hashed before any projection is published. */
export const simulationNativeMigrationSchema = z.strictObject({
  format: z.literal('native101-to102/1'), sourceVersion: z.literal(101), targetVersion: z.literal(102),
  sourceRuntimeCommit: z.literal(NATIVE_101_RUNTIME_COMMIT),
  sourceRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  contexts: z.array(z.strictObject({ pin: simulationWorldDomainPinSchema,
    profile: z.string().min(1).max(128) })).max(64),
}).refine(value => new Set(value.contexts.map(context => JSON.stringify(context.pin))).size === value.contexts.length,
  'Migration context pins must be distinct')
/** Exact declared conversion, without source paths or executable configuration. */
export type SimulationNativeMigration = z.infer<typeof simulationNativeMigrationSchema>
