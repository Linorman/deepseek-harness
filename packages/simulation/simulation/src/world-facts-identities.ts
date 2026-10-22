/** Independent Fact identity leaf; World domains can retain references without loading payload or claim schemas. */
import { z } from 'zod'
import type { WorldFactId, WorldFactVersion } from './world-facts-types.ts'
/** Stable authoritative fact identity, independent of a model's request or decision identity. */
export const worldFactIdSchema = z.string().min(1).transform(value => value as WorldFactId)
/** Canonical positive decimal publication version; retained versions are not limited to machine precision. */
export const worldFactVersionSchema = z.string().regex(/^[1-9][0-9]*$/).transform(value => value as WorldFactVersion)
/** Exact prior publication used for append-only corrections and World domain evidence. */
export const worldFactReferenceSchema = z.strictObject({ factId: worldFactIdSchema, version: worldFactVersionSchema })
