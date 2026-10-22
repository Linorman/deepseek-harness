import { simTimeSchema } from './time.ts'
/** Strict simulated representative requests and immutable canonical preparation; no real adapters or sender overrides. */
import { z } from 'zod'
import { simulationExternalAdjudicationSchema } from './world-external-mediated.ts'
import { simulationEntityIdSchema, simulationRelationIdSchema } from './entity.ts'
import { simulationWorldDomainPinSchema, worldIntentIdSchema, worldExternalIdentityIdSchema } from './world-domain.ts'
import { channelIdSchema } from '@clocky/clocky-team/schema'
import { simulationChannelKeySchema } from './schema.ts'
import { simulationMaintenanceRequestSchema } from './maintenance.ts'
import { worldRequestIdSchema, worldPlanIdSchema } from './world.ts'
import { simulationWorldFinitePersonaSelectionSchema } from './world-domains.ts'
import { simulationWorldHireReserveRequestSchema, simulationWorldHireIdentitiesSchema,
  simulationWorldIdentityCleanupEvidenceSchema, simulationWorldIdentityChannelCleanupSchema } from './world-hire.ts'

/** Actor contact is a new exact schema/version; original deterministic v1 requests never change interpretation. */
export const WORLD_EXTERNAL_ACTOR_PIN = Object.freeze(simulationWorldDomainPinSchema.parse({ domain: 'external', operation: 'interact',
  version: '2', schemaRef: 'clocky.external.interact-actor/schema/2',
  implementationRef: 'clocky.external.interact-actor/native/4', generation: 1 }))
/** Scoped simulated-only contact without credentials, role, requester, writer or sender fields. */
export const simulationExternalActorRequestSchema = z.strictObject({ scope: simulationEntityIdSchema,
  externalKey: z.string().min(1).max(256).regex(/^[\p{L}\p{N}._-]+$/u), subjectRef: simulationEntityIdSchema,
  sourceKind: z.literal('simulated-actor'), policyRef: z.literal('clocky.external.representative/1'),
  input: z.strictObject({ kind: z.literal('contact'), unit: z.string().min(1).max(256) }),
})
/** Original accepted finite Persona for creation, or explicit reuse of a retained identity/generation; preparation never regenerates it. */
export const simulationExternalActorPlanSchema = z.union([simulationWorldFinitePersonaSelectionSchema,
  z.strictObject({ kind: z.literal('reuse'), identityId: worldExternalIdentityIdSchema, generation: z.literal(1) }),
])
/** Safe actor outcome contains canonical references and requested unit; private planning prose stays private. */
export const simulationExternalActorResultSchema = z.union([z.strictObject({ identityId: worldExternalIdentityIdSchema,
  subjectRef: simulationEntityIdSchema, generation: z.literal(1), entityId: simulationEntityIdSchema,
  relationId: simulationRelationIdSchema, channelId: channelIdSchema, requesterEntityId: simulationEntityIdSchema,
  sourceKind: z.literal('simulated-actor'), unit: z.string().min(1).max(256) }), z.strictObject({})])
/** One persistent original identity responsibility retained before all Team/Session/Channel IO. */
export const simulationExternalRepresentativeReservationSchema = z.strictObject({ id: worldIntentIdSchema,
  identityId: worldExternalIdentityIdSchema, generation: z.literal(1), requestId: worldRequestIdSchema,
  request: simulationWorldHireReserveRequestSchema, identities: simulationWorldHireIdentitiesSchema,
  adjudication: simulationExternalAdjudicationSchema.optional(),
  reservedAt: simTimeSchema,
  prepared: z.strictObject({ time: simTimeSchema, sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).optional(),
  status: z.enum(['reserved', 'preparing', 'committed', 'cancel-requested', 'abandoned']),
  sequence: z.number().int().positive(), updatedSequence: z.number().int().positive(),
  cleanup: z.strictObject({ sequence: z.number().int().positive(), evidence: simulationWorldIdentityCleanupEvidenceSchema }).optional(),
}).superRefine((value, ctx) => {
  if (value.status === 'reserved' && value.prepared !== undefined
    || ['preparing', 'committed', 'cancel-requested'].includes(value.status) && value.prepared === undefined)
    ctx.addIssue({ code: 'custom', path: ['prepared'], message: 'Preparation evidence must match reservation status' })
  if (value.prepared !== undefined && (BigInt(value.prepared.time) < BigInt(value.reservedAt)
    || value.prepared.sequence <= value.sequence || value.prepared.sequence > value.updatedSequence))
    ctx.addIssue({ code: 'custom', path: ['prepared'], message: 'Preparation must follow reservation and precede settlement' })
  if (value.cleanup !== undefined && value.prepared === undefined)
    ctx.addIssue({ code: 'custom', path: ['cleanup'], message: 'Cleanup requires original preparation evidence' })
  if (value.cleanup === undefined) return
  const { sequence, evidence } = value.cleanup
  if (value.status !== 'abandoned' || sequence !== value.updatedSequence || sequence <= value.sequence)
    ctx.addIssue({ code: 'custom', path: ['cleanup'], message: 'Cleanup requires the original terminal abandonment sequence' })
  for (const key of ['teamId', 'participantId', 'sessionId'] as const) {
    if (evidence.binding[key] !== value.identities.binding[key])
      ctx.addIssue({ code: 'custom', path: ['cleanup', 'evidence', 'binding', key], message: 'Cleanup changed its original binding' })
  }
  for (const [index, channel] of evidence.channels.entries()) {
    if (channel.channelId !== value.identities.channels[index]?.channelId)
      ctx.addIssue({ code: 'custom', path: ['cleanup', 'evidence', 'channels', index],
        message: 'Cleanup changed original Channel order or identity' })
  }
})
/** Original actor contact registration; a generic mutation cannot manufacture canonical preparation. */
export const WORLD_EXTERNAL_ACTOR_DEFINITION = Object.freeze({ domain: 'external', operation: 'interact', version: '2',
  schemaRef: WORLD_EXTERNAL_ACTOR_PIN.schemaRef, schemas: Object.freeze({ request: simulationExternalActorRequestSchema,
    plan: simulationExternalActorPlanSchema, result: simulationExternalActorResultSchema,
    mutation: z.strictObject({ kind: z.literal('representation-owned') }) }) })

/** Exact retained channel observation; unknown reads or closing state never release a contact responsibility. */
export const simulationExternalContactChannelObservationSchema = z.discriminatedUnion('phase', [
  z.strictObject({ phase: z.literal('absent'), channelId: channelIdSchema }),
  z.strictObject({ phase: z.enum(['pending', 'active']), channelId: channelIdSchema,
    cursor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }),
])
/** Canonical contact cleanup preserves another original lease or proves sole-channel terminal ownership. */
export const simulationExternalContactCleanupEvidenceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('terminal'), teamCursor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    channel: simulationWorldIdentityChannelCleanupSchema }),
  z.strictObject({ kind: z.literal('retained'), teamCursor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    keeper: z.strictObject({ id: worldIntentIdSchema, sequence: z.number().int().positive(), status: z.enum(['reserved', 'committed']) }),
    channel: simulationExternalContactChannelObservationSchema }),
])
/** Original case-to-representative conversation reservation; caller changes never grant access to another buyer's Channel. */
export const simulationExternalContactSchema = z.strictObject({ id: worldIntentIdSchema,
  identityId: worldExternalIdentityIdSchema, representativeIntentId: worldIntentIdSchema, generation: z.literal(1),
  requestId: worldRequestIdSchema, planId: worldPlanIdSchema, requesterEntityId: simulationEntityIdSchema,
  channel: z.strictObject({ key: simulationChannelKeySchema, channelId: channelIdSchema }),
  status: z.enum(['reserved', 'committed', 'cancel-requested', 'cancelled']),
  sequence: z.number().int().positive(), updatedSequence: z.number().int().positive(),
  cancellation: z.strictObject({ maintenance: simulationMaintenanceRequestSchema, sequence: z.number().int().positive() }).optional(),
  cleanup: z.strictObject({ sequence: z.number().int().positive(), evidence: simulationExternalContactCleanupEvidenceSchema }).optional(),
}).superRefine((value, ctx) => {
  if (value.status === 'cancel-requested' || value.status === 'cancelled') {
    if (value.cancellation === undefined || value.cancellation.sequence <= value.sequence
      || value.cancellation.sequence > value.updatedSequence)
      ctx.addIssue({ code: 'custom', path: ['cancellation'], message: 'Contact withdrawal requires its original maintenance and sequence' })
  } else if (value.cancellation !== undefined) {
    ctx.addIssue({ code: 'custom', path: ['cancellation'], message: 'Executable contact cannot claim withdrawn cleanup ownership' })
  }
  if (value.cleanup === undefined) return
  if (value.status !== 'cancelled' || value.cleanup.sequence !== value.updatedSequence
    || value.cancellation === undefined || value.cleanup.sequence <= value.cancellation.sequence
    || value.cleanup.evidence.channel.channelId !== value.channel.channelId)
    ctx.addIssue({ code: 'custom', path: ['cleanup'], message: 'Contact cleanup lost its original terminal sequence or Channel' })
})
