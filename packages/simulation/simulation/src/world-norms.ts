import { currentWorldAssignments } from './world-membership.ts'
/** Browser-safe institutions: strict policy mapping, immutable versions and pure known/effective projections. */
import { z } from 'zod'
import { simulationEntityIdSchema, simulationRelationIdSchema } from './entity.ts'
import { simulationGovernanceRuleSchema, simulationReviewRouteSchema } from './world-governance.ts'
import { simTimeSchema } from './time.ts'
import { worldNormIdSchema, worldProposalIdSchema, worldResolutionIdSchema, worldMutationIdSchema } from './world-domain.ts'
import { simulationWorldFactAudienceSchema, simulationWorldFactSourceReferenceSchema } from './world-facts.ts'
import type { WorldPlanId, WorldRequestId } from './world-types.ts'
import type { WorldSchemaRef, WorldNormId } from './world-domain-types.ts'
import type { SimulationSnapshot } from './types.ts'
import type { TeamTaskId, TeamId } from '@clocky/clocky-team/types'
import type { SimulationCommitmentId } from './business-types.ts'
import type { SimulationEntityId } from './identities.ts'
import type { SimTime } from './time-types.ts'
import type { WorldNormVersion, WorldNormClosureId, WorldNormAnnouncementId, SimulationNormState,
  SimulationNormVersion, SimulationNormQuery, SimulationNormProjection, SimulationNormObligationReference } from './world-norms-types.ts'

const text = z.string().min(1)
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const positive = count.positive()
const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/)
/** Only installed validated hiring policy; unowned monetary parameters have no accepted representation. */
export const WORLD_NORM_HIRING_APPROVAL_POLICY = 'clocky.organization.hiring-approval/1' as const
/** Exact installed institution schema; unknown versions reject rather than falling back. */
export const WORLD_NORM_SCHEMA_REF = 'clocky.world-norm/1' as WorldSchemaRef
/** Canonical positive decimal institution version. */
export const worldNormVersionSchema = z.string().regex(/^[1-9][0-9]*$/).transform(value => value as WorldNormVersion)
/** Original closure identity. */
export const worldNormClosureIdSchema = text.transform(value => value as WorldNormClosureId)
/** Original audience-frozen announcement identity. */
export const worldNormAnnouncementIdSchema = text.transform(value => value as WorldNormAnnouncementId)
/** Exact institution version reference. */
export const simulationNormReferenceSchema = z.strictObject({ id: worldNormIdSchema, version: worldNormVersionSchema })
/** Installed hiring approval parameters; every current rule applies its position allowlist and per-approval limit. */
export const simulationNormHiringApprovalParamsSchema = z.strictObject({ committeeId: simulationEntityIdSchema,
  positionIds: z.array(simulationEntityIdSchema).min(1)
    .refine(values => new Set(values).size === values.length, 'Allowed hiring positions must be distinct'), maxHires: positive })
/** Advisory text has no actuation; validated text must explicitly select a strictly parsed installed primitive. */
export const simulationNormEnforcementSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('advisory') }),
  z.strictObject({ kind: z.literal('validated'), policyRef: z.literal(WORLD_NORM_HIRING_APPROVAL_POLICY),
    params: simulationNormHiringApprovalParamsSchema }),
])
/** Explicit scenario institution input; bootstrap derives version and provenance without inventing governance. */
export const simulationInitialNormSchema = z.strictObject({ id: worldNormIdSchema, scopeId: simulationEntityIdSchema,
  body: text, effectiveFrom: simTimeSchema, effectiveUntil: simTimeSchema.nullable(), availableAt: simTimeSchema,
  audience: simulationWorldFactAudienceSchema, enforcement: simulationNormEnforcementSchema })
  .refine(value => value.effectiveUntil === null || BigInt(value.effectiveUntil) > BigInt(value.effectiveFrom),
    'Initial Norm intervals must be nonempty and half-open')
/** Original committee scope, membership and voting policy retained by Native scenario bootstrap. */
export const simulationFrozenCommitteePolicySchema = z.strictObject({ id: simulationEntityIdSchema, name: text, description: text,
  scopeId: simulationEntityIdSchema, members: z.array(z.strictObject({ id: simulationRelationIdSchema, personId: simulationEntityIdSchema,
    validFrom: simTimeSchema, validUntil: simTimeSchema.nullable() }).refine(value => value.validUntil === null
      || BigInt(value.validUntil) > BigInt(value.validFrom), 'Committee membership intervals must be nonempty and half-open')).min(1),
  rule: simulationGovernanceRuleSchema, quorum: positive })
  .refine(value => new Set(value.members.map(member => member.id)).size === value.members.length,
    'Frozen committee membership identities must be distinct')
  .refine(value => value.members.every((member, index) => value.members.slice(index + 1).every(other =>
    member.personId !== other.personId || member.validUntil !== null && BigInt(member.validUntil) <= BigInt(other.validFrom)
      || other.validUntil !== null && BigInt(other.validUntil) <= BigInt(member.validFrom))),
  'One person cannot hold overlapping committee memberships')
  .refine((value) => {
    const peak = Math.max(...value.members.map(at => value.members.filter(member => BigInt(member.validFrom) <= BigInt(at.validFrom)
      && (member.validUntil === null || BigInt(at.validFrom) < BigInt(member.validUntil))).length))
    return value.quorum <= peak && (value.rule.kind !== 'absolute-threshold' || value.rule.yes <= peak)
  }, 'Frozen committee quorum and threshold must be simultaneously attainable')
/** Actual prior Native bootstrap record; scenario versions cannot substitute governance or mutation identities. */
export const simulationNormBootstrapSourceSchema = z.strictObject({ definitionHash: hash, bootstrapSequence: positive })
/** Original exact governance document reference, independent of a director's description. */
export const simulationNormProposalReferenceSchema = z.strictObject({ id: worldProposalIdSchema, revision: positive, bodyHash: hash })
/** Original exact passed resolution reference. */
export const simulationNormResolutionReferenceSchema = z.strictObject({ id: worldResolutionIdSchema, hash })
/** Native original source; a model cannot select recording metadata or substitute another mutation. */
export const simulationNormMutationSourceSchema = z.strictObject({
  requestId: text.transform(value => value as WorldRequestId), planId: text.transform(value => value as WorldPlanId),
  mutationId: worldMutationIdSchema,
})
const requestFields = {
  reviewRoute: simulationReviewRouteSchema.optional(),
  norm: simulationNormReferenceSchema,
  prior: simulationNormReferenceSchema.nullable(),
  proposal: simulationNormProposalReferenceSchema,
  resolution: simulationNormResolutionReferenceSchema,
  scope: simulationEntityIdSchema,
  body: text,
  effectiveFrom: simTimeSchema,
  effectiveUntil: simTimeSchema.nullable(),
  availableAt: simTimeSchema,
  audience: simulationWorldFactAudienceSchema,
  impact: z.enum(['future-admissions', 'migrate-existing']),
}
const interval = (value: { effectiveFrom: string; effectiveUntil: string | null }): boolean =>
  value.effectiveUntil === null || BigInt(value.effectiveUntil) > BigInt(value.effectiveFrom)
/** Strict complete enact input; a passed resolution alone does not enact or authorize arbitrary policy code. */
export const simulationNormEnactRequestSchema = z.strictObject({ ...requestFields, enforcement: simulationNormEnforcementSchema })
  .refine(interval, 'Norm intervals must be nonempty and half-open')
/** Strict complete repeal input; its new approved version closes the exact predecessor at an explicit time. */
export const simulationNormRevokeRequestSchema = z.strictObject(requestFields)
  .refine(value => value.prior !== null && value.effectiveUntil === null,
    'Revocation requires the exact previous version and no new enforcement interval')
/** Closed institution effects derived from accepted operation payloads; Snapshot patches reject. */
export const simulationNormEffectSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('norm/enact'), request: simulationNormEnactRequestSchema }),
  z.strictObject({ kind: z.literal('norm/revoke'), request: simulationNormRevokeRequestSchema }),
])
/** Complete immutable original institution version. */
const versionFields = {
  ...simulationNormReferenceSchema.shape,
  schemaRef: z.literal('clocky.world-norm/1').transform(value => value as WorldSchemaRef),
  subject: simulationEntityIdSchema, scope: simulationEntityIdSchema, body: text, bodyHash: hash,
  status: z.enum(['enacted', 'revoked']), enforcement: simulationNormEnforcementSchema,
  supersedes: simulationNormReferenceSchema.nullable(),
  effectiveFrom: simTimeSchema, effectiveUntil: simTimeSchema.nullable(), availableAt: simTimeSchema,
  audience: simulationWorldFactAudienceSchema,
  recordedAt: count, sequence: positive,
}
/** Complete immutable institution version with its actual governance or scenario provenance. */
export const simulationNormVersionSchema = z.discriminatedUnion('origin', [
  z.strictObject({ ...versionFields, origin: z.literal('governance'), reviewRoute: simulationReviewRouteSchema.optional(), proposal: simulationNormProposalReferenceSchema,
    resolution: simulationNormResolutionReferenceSchema, source: z.strictObject({ ...simulationNormMutationSourceSchema.shape,
      references: z.array(simulationWorldFactSourceReferenceSchema) }) }),
  z.strictObject({ ...versionFields, origin: z.literal('scenario'), source: simulationNormBootstrapSourceSchema.extend({
    references: z.array(simulationWorldFactSourceReferenceSchema) }) }),
]).refine(interval, 'Norm intervals must be nonempty and half-open')
/** Separate immutable closure; its source and successor prove why the previous interval ended. */
export const simulationNormClosureSchema = z.strictObject({ id: worldNormClosureIdSchema, norm: simulationNormReferenceSchema,
  supersededBy: simulationNormReferenceSchema, at: simTimeSchema, source: simulationNormMutationSourceSchema,
  recordedAt: count, sequence: positive })
/** Trusted publication material contains only the original approved document and structured policy. */
const announcementMaterialFields = { kind: z.literal('norm-announcement'),
  norm: simulationNormReferenceSchema, status: z.enum(['enacted', 'revoked']), scope: simulationEntityIdSchema,
  body: text, bodyHash: hash, enforcement: simulationNormEnforcementSchema,
  effectiveFrom: simTimeSchema, effectiveUntil: simTimeSchema.nullable(), availableAt: simTimeSchema }
/** Trusted document publication retaining its actual approval or prior scenario source. */
export const simulationNormAnnouncementMaterialSchema = z.discriminatedUnion('origin', [
  z.strictObject({ ...announcementMaterialFields, origin: z.literal('governance'), reviewRoute: simulationReviewRouteSchema.optional(),
    proposal: simulationNormProposalReferenceSchema, resolution: simulationNormResolutionReferenceSchema }),
  z.strictObject({ ...announcementMaterialFields, origin: z.literal('scenario'), source: simulationNormBootstrapSourceSchema }),
])
/** Stable Native responsibility with actual authorized recipients frozen at mutation acceptance. */
const announcementFields = { id: worldNormAnnouncementIdSchema,
  norm: simulationNormReferenceSchema, scope: simulationEntityIdSchema,
  availableAt: simTimeSchema, effectiveFrom: simTimeSchema, bodyHash: hash,
  recipients: z.array(simulationEntityIdSchema).refine(values => new Set(values).size === values.length,
    'Announcement recipients must be distinct'), material: simulationNormAnnouncementMaterialSchema, sequence: positive }
/** Stable announcement responsibility retaining the original source and authorized recipients. */
export const simulationNormAnnouncementSchema = z.discriminatedUnion('origin', [
  z.strictObject({ ...announcementFields, origin: z.literal('governance'), mutationId: worldMutationIdSchema }),
  z.strictObject({ ...announcementFields, origin: z.literal('scenario'), source: simulationNormBootstrapSourceSchema }),
]).refine(value => value.origin === value.material.origin, 'Norm announcement must retain its original provenance kind')
/** Complete durable institution state; no second mutable institution database exists. */
export const simulationNormStateSchema = z.strictObject({
  versions: z.record(worldNormIdSchema, z.array(simulationNormVersionSchema).min(1)),
  closures: z.array(simulationNormClosureSchema),
  announcements: z.record(worldNormAnnouncementIdSchema, simulationNormAnnouncementSchema),
})
/** Original responsibility references returned only to a trusted owner for unsupported migration handling. */
export const simulationNormObligationReferenceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('world-case'), id: text.transform(value => value as WorldRequestId), sequence: positive }),
  z.strictObject({ kind: z.literal('task'), id: text.transform(value => value as TeamTaskId),
    teamId: text.transform(value => value as TeamId), revision: positive }),
  z.strictObject({ kind: z.literal('commitment'), id: text.transform(value => value as SimulationCommitmentId), revision: positive }),
  z.strictObject({ kind: z.literal('resource-hold'), id: text, revision: positive }),
  z.strictObject({ kind: z.literal('operation'), id: text, decisionId: text, fingerprint: text }),
  z.strictObject({ kind: z.literal('wake'), id: text, sequence: positive }),
])
/** Complete available reader selection; future cursors/times and overflow do not silently yield empty material. */
export const simulationNormQuerySchema = z.strictObject({ viewer: simulationEntityIdSchema, cursor: count, time: simTimeSchema,
  limit: positive, ids: z.array(worldNormIdSchema).refine(values => new Set(values).size === values.length,
    'Requested Norm identities must be distinct').optional() })

/** Stable institution failures; private document text is never a public failure reason. */
export class SimulationNormError extends Error {
  /**
   * @param code - Violated exact governance, version, scope, policy, time, source or capacity rule.
   * @param message - Trusted diagnostic, independent of approved public material.
   * @param obligations - Original typed responsibilities blocking unsupported migration, for trusted-owner projection.
   */
  constructor(readonly code: 'SIM_NORM_SOURCE' | 'SIM_NORM_GOVERNANCE' | 'SIM_NORM_VERSION' | 'SIM_NORM_SCOPE'
    | 'SIM_NORM_POLICY' | 'SIM_NORM_TIME' | 'SIM_NORM_LIMIT' | 'SIM_NORM_INTEGRITY' | 'SIM_NORM_EXISTING_OBLIGATIONS',
  message: string, readonly obligations?: readonly SimulationNormObligationReference[]) {
    super(message)
    this.name = 'SimulationNormError'
  }
}

/**
 * Read strictly installed durable institution state; missing state cannot masquerade as no constraints.
 * @param state - Authoritative Native projection.
 * @returns the validated institution tables; a partial or uninstalled projection rejects.
 */
export function normState(state: SimulationSnapshot): SimulationNormState {
  if (state.world === undefined || !('norms' in state.world)) throw new SimulationNormError('SIM_NORM_INTEGRITY', 'World omitted Norm state')
  return simulationNormStateSchema.parse(state.world.norms)
}

function audienceAllows(state: SimulationSnapshot, norm: SimulationNormVersion, viewer: SimulationEntityId): boolean {
  switch (norm.audience.kind) {
    case 'public': return true
    case 'actors': return norm.audience.entityIds.includes(viewer)
    case 'scope-members': return currentWorldAssignments(state, viewer, norm.scope).length !== 0
    default: return assertNever(norm.audience)
  }
}

function phase(norm: SimulationNormVersion, owned: SimulationNormState, time: SimTime, cursor: number):
SimulationNormProjection['items'][number]['effective'] {
  let until = norm.effectiveUntil === null ? undefined : BigInt(norm.effectiveUntil)
  for (const closure of owned.closures) if (closure.norm.id === norm.id && closure.norm.version === norm.version
    && closure.sequence <= cursor && (until === undefined || BigInt(closure.at) < until)) until = BigInt(closure.at)
  if (until !== undefined && (until <= BigInt(norm.effectiveFrom) || BigInt(time) >= until)) return 'historical'
  if (BigInt(time) < BigInt(norm.effectiveFrom)) return 'scheduled'
  return norm.status === 'revoked' ? 'revoked' : 'effective'
}

/**
 * Read every actual effective institution in a scope without hiding unannounced or private enforcement.
 * @param state - Complete authoritative history, including original closure records.
 * @param scope - Exact institution scope to enforce.
 * @param time - Available canonical simulation time.
 * @param cursor - Original Native publication fence; closure filtering preserves earlier accepted conditions.
 * @returns all enacted effective versions; caller must enforce every applicable validated rule.
 */
export function effectiveNorms(state: SimulationSnapshot, scope: SimulationEntityId, time: SimTime,
  cursor: number): readonly SimulationNormVersion[] {
  if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > state.revision || BigInt(time) > BigInt(state.time)) {
    throw new SimulationNormError('SIM_NORM_TIME', 'Effective Norm inspection cannot select a future cursor or time')
  }
  const owned = normState(state)
  return Object.values(owned.versions).flat().filter(value => value.scope === scope && value.sequence <= cursor
    && phase(value, owned, time, cursor) === 'effective')
}

/**
 * Select permitted known originals with exact body and independent effective state.
 * @param state - Complete Native history; Session/context-view stores the resulting material before inference.
 * @param input - Reader and as-of content bounds; current scope membership is independent of the requested historical time.
 * @returns complete visible originals and unknown requested identities; no receipt or understanding is implied.
 */
export function projectNorms(state: SimulationSnapshot, input: SimulationNormQuery): SimulationNormProjection {
  const query = simulationNormQuerySchema.parse(input), owned = normState(state)
  if (!Object.hasOwn(state.entities, query.viewer)) throw new SimulationNormError('SIM_NORM_SCOPE', 'Norm query requires an existing reader')
  if (query.cursor > state.revision || BigInt(query.time) > BigInt(state.time)) {
    throw new SimulationNormError('SIM_NORM_TIME', 'Norm query cannot select a future Native cursor or time')
  }
  if (query.limit > state.spec.maxKnowledgePerQuery || (query.ids?.length ?? 0) > query.limit) {
    throw new SimulationNormError('SIM_NORM_LIMIT', 'Complete Norm query exceeds the frozen selection allowance')
  }
  const items: SimulationNormProjection['items'][number][] = [], unknown: WorldNormId[] = []
  const ids = query.ids ?? Object.keys(owned.versions).sort().map(value => value as WorldNormId)
  for (const id of ids) {
    const history = Object.hasOwn(owned.versions, id) ? owned.versions[id] : undefined
    const visible = history?.filter(value => value.sequence <= query.cursor && BigInt(value.availableAt) <= BigInt(query.time)
      && audienceAllows(state, value, query.viewer)) ?? []
    if (!visible.length && query.ids !== undefined) unknown.push(id)
    for (const norm of visible) items.push({ norm, effective: phase(norm, owned, query.time, query.cursor) })
  }
  if (items.length + unknown.length > query.limit) throw new SimulationNormError('SIM_NORM_LIMIT', 'Complete Norm output exceeds query limit')
  return { viewer: query.viewer, cursor: query.cursor, time: query.time, items, unknown }
}

function assertNever(value: never): never { throw new Error(`Unknown Norm audience: ${String(value)}`) }
