/** Private product authoring documents; ownership is supplied by authenticated transport, never by JSON. */
import { z } from 'zod'
import type { Branded } from '@clocky/clocky-brand'
/** Opaque identity of a private product authoring document. */
export type ScenarioDraftId = Branded<'ScenarioDraftId'>
/** Opaque identity of one immutable save intent. */
export type ScenarioDraftSaveId = Branded<'ScenarioDraftSaveId'>
import { scenarioTemplateManifestSchema, worldScenarioV1Schema } from '@clocky/clocky-simulation-scenario'

const id = z.string().min(1).max(128)
const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
/** Presentation coordinates are separately persisted; they are never compiler input or runtime facts. */
export const scenarioDraftLayoutSchema = z.array(z.strictObject({ id,
  x: z.number().min(-100000).max(100000), y: z.number().min(-100000).max(100000) }))
  .max(10000).refine(nodes => new Set(nodes.map(node => node.id)).size === nodes.length, 'Layout node IDs must be unique')
/** Save one original revision; retry preserves saveId and every field. */
export const scenarioDraftSaveSchema = z.strictObject({
  draftId: id.transform(value => value as ScenarioDraftId), saveId: id.transform(value => value as ScenarioDraftSaveId),
  parentRevision: revision.nullable(),
  layout: scenarioDraftLayoutSchema.optional(), templateManifest: scenarioTemplateManifestSchema.optional(),
  name: z.string().trim().min(1).max(256), definition: worldScenarioV1Schema })
/** Read an exact revision, or the current head; there is no cross-principal discovery. */
export const scenarioDraftReadSchema = z.strictObject({
  draftId: id.transform(value => value as ScenarioDraftId), revision: revision.optional() })
/** Immutable saved authoring state, separate from all Native run facts. */
export const scenarioDraftRevisionSchema = scenarioDraftSaveSchema.extend({
  revision, author: z.string().min(1), savedAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) })
  .refine(value => value.revision === (value.parentRevision === null ? 0 : value.parentRevision + 1), 'Draft revision must follow its original parent')
/** Conflict returns the caller's attempted document and current head for explicit comparison. */
export const scenarioDraftSaveResultSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('saved'), value: scenarioDraftRevisionSchema }),
  z.strictObject({ status: z.literal('conflict'), current: scenarioDraftRevisionSchema.nullable(), attempted: scenarioDraftSaveSchema }),
])
/** Missing and foreign draft IDs have the same response. */
export const scenarioDraftReadResultSchema = z.strictObject({ value: scenarioDraftRevisionSchema.nullable() })
/** Original CAS save request. */
export type ScenarioDraftSave = z.input<typeof scenarioDraftSaveSchema>
/** Exact or head lookup. */
export type ScenarioDraftRead = z.input<typeof scenarioDraftReadSchema>
/** Persisted immutable author revision. */
export type ScenarioDraftRevision = z.infer<typeof scenarioDraftRevisionSchema>
/** Saved or explicit stale conflict. */
export type ScenarioDraftSaveResult = z.infer<typeof scenarioDraftSaveResultSchema>
/** Authorized read result. */
export type ScenarioDraftReadResult = z.infer<typeof scenarioDraftReadResultSchema>
