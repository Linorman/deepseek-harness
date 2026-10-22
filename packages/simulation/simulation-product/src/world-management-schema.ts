import { simulationWorldTemplateSchema } from '@clocky/clocky-simulation/world'
import { simulationPersonaManagementCommandSchema } from '@clocky/clocky-simulation/world-management'
/** Human management wire validation; trusted principal, policy and Native controller proof never come from clients. */
import { z } from 'zod'
import { simulationWorldManagementPreviewSchema, simulationWorldManagementReceiptSchema } from '@clocky/clocky-simulation/world-management'
import type { SimulationWorldManagementAction } from '@clocky/clocky-simulation/world-management-types'
import { simulationProductWorldManagementCommandIdSchema, simulationProductRunIdSchema } from './schema-common.ts'
import { worldReadEntityIdSchema, worldReadRelationIdSchema, worldReadCoverageSchema,
  worldReadObligationSchema } from './world-read-schema.ts'

const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const time = z.string().regex(/^(0|[1-9][0-9]*)$/)
const text = z.strictObject({ text: z.string(), truncated: z.boolean() })
const reason = z.string().min(1).max(65536).refine(value => value.trim().length > 0, 'Management description cannot be blank')
const kind = z.enum(['transfer', 'depart', 'hire-existing', 'hiring-market'])
const base = { runId: simulationProductRunIdSchema, targetId: worldReadEntityIdSchema, expectedRevision: revision }
const assignment = { assignmentId: worldReadRelationIdSchema, effective: z.enum(['boundary', 'at']), at: time.optional(), reason }
/** Complete choices; arbitrary fields, actor IDs, copied profiles and implicit termination reject. */
export const simulationProductWorldManagementDraftSchema = z.discriminatedUnion('action', [
  z.strictObject({ ...base, action: z.literal('transfer'), values: z.strictObject({ ...assignment, position: worldReadEntityIdSchema }) }),
  z.strictObject({ ...base, action: z.literal('depart'), values: z.strictObject({ ...assignment, retire: z.enum(['yes', 'no']) }) }),
  z.strictObject({ ...base, action: z.literal('hire-existing'), values: z.strictObject({ position: worldReadEntityIdSchema, reason }) }),
  z.strictObject({ ...base, action: z.literal('hiring-market'), values: z.strictObject({ command: z.string().min(1).max(65536) }) }),
]).refine(value => value.action === 'hire-existing' || value.action === 'hiring-market' || value.values.effective !== 'at' || value.values.at !== undefined,
  'A precise effective time is required for the selected at-time choice')
/** Read only current form metadata for an exact person. */
export const simulationProductWorldManagementFieldsInputSchema = z.strictObject({ runId: simulationProductRunIdSchema,
  action: kind, targetId: worldReadEntityIdSchema })
const field = z.discriminatedUnion('kind', [
  z.strictObject({ id: z.string().min(1), kind: z.literal('choice'), required: z.boolean(),
    options: z.array(z.strictObject({ id: z.string().min(1), label: z.string() })) }),
  z.strictObject({ id: z.string().min(1), kind: z.literal('time'), required: z.boolean() }),
  z.strictObject({ id: z.string().min(1), kind: z.literal('text'), required: z.boolean(), maxBytes: revision.positive() }),
  z.strictObject({ id: z.literal('command'), kind: z.literal('persona'), required: z.literal(true), maxBytes: revision.positive(),
    organizationEntityId: worldReadEntityIdSchema, positionEntityId: worldReadEntityIdSchema, now: time, maxTime: time,
    maxRevisions: z.literal(16), templates: z.array(simulationWorldTemplateSchema).min(1) }),
])
/** Explicit availability and bounded current choices; missing capability never looks like an empty valid form. */
export const simulationProductWorldManagementFieldsSchema = z.strictObject({ apiVersion: z.literal('clocky.world-management/v1'),
  ...simulationProductWorldManagementFieldsInputSchema.shape, snapshotRevision: revision, targetRevision: revision,
  status: z.enum(['available', 'unavailable']), reason: z.string().min(1).optional(), fields: z.array(field) })
  .refine(value => (value.status === 'unavailable') === (value.reason !== undefined)
    && value.targetRevision <= value.snapshotRevision
    && new Set(value.fields.map(item => item.id)).size === value.fields.length
    && value.fields.every(item => item.kind !== 'choice' || new Set(item.options.map(option => option.id)).size === item.options.length)
    && (value.status !== 'available' || value.fields.every(item => item.kind !== 'choice' || !item.required || item.options.length > 0)),
  'Personnel fields must retain distinct choices, exact revisions and explicit unavailability')
  .refine((value) => {
    if (value.action === 'hiring-market') return value.fields.length === 1 && value.fields[0]?.id === 'command'
      && value.fields[0].kind === 'persona' && value.fields[0].required
    const expected = value.action === 'transfer' ? ['assignmentId', 'position', 'effective', 'at', 'reason']
      : value.action === 'depart' ? ['assignmentId', 'effective', 'at', 'retire', 'reason'] : ['position', 'reason']
    return value.fields.length === expected.length && value.fields.every(item => expected.includes(item.id)
      && item.required === (item.id !== 'at') && item.kind === (item.id === 'at' ? 'time' : item.id === 'reason' ? 'text' : 'choice'))
  }, 'Personnel field metadata must describe the complete installed form')
const native = simulationWorldManagementPreviewSchema.shape
/** Full inert quote; dependencies are committed by hash while private Native snapshots remain on the Host. */
export const simulationProductWorldManagementPreviewSchema = z.strictObject({ apiVersion: z.literal('clocky.world-management/v1'),
  input: simulationProductWorldManagementDraftSchema, runId: simulationProductRunIdSchema,
  revision, snapshotRevision: revision, previewHash: native.previewHash, sourceFingerprint: native.sourceFingerprint,
  admission: native.admission, blockers: native.blockers, settlementRequirements: native.settlementRequirements,
  impact: native.impact, hiringFee: native.hiringFee, impacts: z.array(text), obligations: z.array(worldReadObligationSchema),
  coverage: worldReadCoverageSchema,
}).refine(value => value.runId === value.input.runId && value.revision === value.input.expectedRevision
  && value.snapshotRevision === value.coverage.revision && value.coverage.loaded === value.obligations.length
  && (value.admission === 'allowed') === (value.blockers.length === 0),
'World management preview must retain its exact original target and coverage').refine((value) => {
  const impact = value.impact, input = value.input
  if (value.admission === 'allowed' && (!value.coverage.complete || impact === null)) return false
  if (impact === null) return true
  if (input.action === 'hiring-market') return impact.kind === 'hiring-market'
    && impact.targetPositionId === input.targetId && impact.draftId === parsePersonaManagementCommand(input.values.command).id
    && value.hiringFee === null
  if (impact.kind === 'hiring-market') return false
  if (impact.personId !== input.targetId || impact.kind !== input.action) return false
  switch (input.action) {
    case 'hire-existing': return impact.kind === 'hire-existing' && impact.targetPositionId === input.values.position
      && (value.hiringFee === null || value.hiringFee.operation === 'hire-existing'
        && value.hiringFee.positionEntityId === input.values.position)
    case 'transfer': return impact.kind === 'transfer' && impact.assignmentId === input.values.assignmentId
      && impact.targetPositionId === input.values.position
      && impact.requestedEffectiveAt === (input.values.effective === 'at' ? input.values.at : null) && value.hiringFee === null
    case 'depart': return impact.kind === 'depart' && impact.assignmentId === input.values.assignmentId
      && impact.retire === (input.values.retire === 'yes')
      && impact.requestedEffectiveAt === (input.values.effective === 'at' ? input.values.at : null) && value.hiringFee === null
    default: { const unreachable: never = input; throw new TypeError(`Unknown management preview: ${String(unreachable)}`) }
  }
}, 'Personnel impacts and fee must describe the exact original choices and complete admitted sources')
/** Immutable original form and confirmed Native prefix/hash; no replacement payload is allowed during retry. */
export const simulationProductWorldManagementSubmitInputSchema = z.strictObject({ runId: simulationProductRunIdSchema,
  commandId: simulationProductWorldManagementCommandIdSchema,
  draft: simulationProductWorldManagementDraftSchema, previewRevision: revision, previewHash: native.previewHash })
  .refine(value => value.runId === value.draft.runId, 'Original management selector must retain the same run')
const receipt = simulationWorldManagementReceiptSchema.shape
/** Public original IDs and independent callback/business metadata, with principal and private result payloads omitted. */
export const simulationProductWorldManagementOutcomeSchema = z.strictObject({ commandId: simulationProductWorldManagementCommandIdSchema,
  runId: simulationProductRunIdSchema, acceptedSequence: receipt.acceptedSequence, intentId: receipt.intentId,
  requestId: receipt.requestId, planId: receipt.planId, execution: receipt.execution,
  result: z.strictObject({ id: receipt.result.unwrap().shape.id, status: z.enum(['committed', 'rejected', 'cancelled']), time,
    sequence: revision.positive() }).optional() }).refine(value =>
  (value.execution === undefined || value.execution.planId === value.planId && value.execution.requestId === value.requestId
    && value.execution.intentId === value.intentId && value.execution.sequence >= value.acceptedSequence)
  && (value.result === undefined || value.result.sequence >= value.acceptedSequence),
'Personnel outcome and callback must retain their exact original Native case identities')

/**
 * Correlate a complete returned quote with the exact original choices, including inactive retained fields.
 * @param input - Caller-retained original draft, validated again at this comparison boundary.
 * @param result - Strict returned preview whose original form must be identical.
 * @returns whether both selections and every original choice agree; object key order is normalized by the parser.
 */
export function matchesWorldManagementPreview(input: unknown,
  result: z.infer<typeof simulationProductWorldManagementPreviewSchema>): boolean {
  const parsed = simulationProductWorldManagementDraftSchema.safeParse(input)
  return parsed.success && JSON.stringify(parsed.data) === JSON.stringify(result.input)
}

/**
 * Check the retained resolved Native input against every user-selected business choice at durable replay.
 * @param draft - Strict complete original form, independent of current mutable Native state.
 * @param action - Strict original Native resolution; its current assignment revision is committed by the preview hash.
 * @returns exact choice agreement, with the owning creation separately validating the primary organization scope.
 */
export function matchesWorldManagementAction(draft: z.infer<typeof simulationProductWorldManagementDraftSchema>,
  action: SimulationWorldManagementAction): boolean {
  if (draft.action === 'hiring-market' || action.kind === 'hiring-market') return draft.action === 'hiring-market'
    && action.kind === 'hiring-market' && draft.targetId === action.payload.positionEntityId && JSON.stringify(parsePersonaManagementCommand(draft.values.command)) === JSON.stringify(action.payload)
  if (draft.targetId !== action.payload.personId || draft.values.reason !== action.payload.description) return false
  switch (draft.action) {
    case 'hire-existing': return action.kind === 'hire-existing' && draft.values.position === action.payload.positionEntityId
    case 'depart': return action.kind === 'depart' && draft.values.assignmentId === action.payload.assignmentId
      && (draft.values.retire === 'yes') === action.payload.retire
      && (draft.values.effective === 'at' ? draft.values.at : null) === action.payload.requestedEffectiveAt
    case 'transfer': return action.kind === 'transfer' && draft.values.assignmentId === action.payload.assignmentId
      && draft.values.position === action.payload.targetPositionId
      && (draft.values.effective === 'at' ? draft.values.at : null) === action.payload.requestedEffectiveAt
    default: { const unreachable: never = draft; throw new TypeError(`Unknown management form: ${String(unreachable)}`) }
  }
}

/**
 * Parse the complete explicit finite review form; malformed JSON and candidate/offer commands reject.
 * @param command - Exact user-entered command text retained in the preview and submission.
 * @returns only a finite Persona draft or review command; no authority fields can be supplied.
 */
export function parsePersonaManagementCommand(command: string): z.infer<typeof simulationPersonaManagementCommandSchema> {
  return simulationPersonaManagementCommandSchema.parse(JSON.parse(command))
}
