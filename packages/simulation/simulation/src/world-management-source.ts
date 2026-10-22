/** Pure authenticated-user provenance; credentials and runtime authority never enter these durable records. */
import { z } from 'zod'
import type { Branded } from '@clocky/clocky-brand'
import type { ProductPrincipalId } from '@clocky/clocky-product-principal'
import { simulationEntityIdSchema } from './entity.ts'
import { simTimeSchema } from './time.ts'
/** Run-local original user command identity, independent of model operation IDs. */
export type WorldManagementCommandId = Branded<'SimulationWorldManagementCommandId'>
/** Strict management identity at persisted and wire boundaries. */
export const worldManagementCommandIdSchema = z.string().min(1).max(256).transform(value => value as WorldManagementCommandId)
const text = z.string().min(1).max(1024)
/** Explicit installed delegation to an actual Native funding controller; never a replacement requester. */
export const simulationWorldManagementFundingAuthoritySchema = z.strictObject({ kind: z.literal('native-controller'),
  entityId: simulationEntityIdSchema, policyRef: text, policyGeneration: text })
/** Durable non-secret authorization facts recorded at the original acceptance point. */
export const simulationWorldAuthenticatedUserSourceSchema = z.strictObject({ kind: z.literal('authenticated-user'),
  commandId: worldManagementCommandIdSchema, principalId: text.transform(value => value as ProductPrincipalId),
  credentialGeneration: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), policyRef: text, policyGeneration: text,
  time: simTimeSchema })
/** Actual retained user source, never model-selectable provenance. */
export type SimulationWorldAuthenticatedUserSource = z.infer<typeof simulationWorldAuthenticatedUserSourceSchema>
/** Real Native controller explicitly selected by the authenticated management policy. */
export type SimulationWorldManagementFundingAuthority = z.infer<typeof simulationWorldManagementFundingAuthoritySchema>
