import type { WorldEvidenceChallengeId, WorldEvidenceRevisionId, WorldEvidenceFieldCode } from '@clocky/clocky-simulation'
import { simulationWorldHireCommittedResultPayloadSchema, WORLD_GENERATE_AND_HIRE_PIN } from '@clocky/clocky-simulation/world-domains'
import type { WorldIntentId } from '@clocky/clocky-simulation/world-domain-types'
/** Strict browser-safe World case selectors and disclosure DTOs. */
import { z } from 'zod'
import { simulationWorldBusinessSummarySchema } from '@clocky/clocky-simulation/world-summary'
import { simulationProductWorldCaseCancelPreviewSchema } from './case-cancel-schema.ts'
import { worldExecutionReasonSchema } from '@clocky/clocky-simulation/world-execution'
import { simulationProductWorldManagementCommandIdSchema, simulationProductRunIdSchema, simulationProductCursorSchema, simulationProductTextSchema } from './schema-common.ts'
import type { SimulationProductWorldCasesInput, SimulationProductWorldCasesPage, SimulationProductWorldCaseInput,
  SimulationProductWorldCaseInspection } from './case-types.ts'
import type { WorldRequestId, WorldPlanId, WorldResultId, WorldCancelId } from '@clocky/clocky-simulation/world-types'
import type { SimulationEntityId, SimulationOperationId, SimulationRelationId, SimulationDecisionId,
  SimulationEventId } from '@clocky/clocky-simulation/identities'
import type { ChannelId, EnvelopeId } from '@clocky/clocky-team/types'
import type { SimTime } from '@clocky/clocky-simulation/time-types'
import type { SimulationProductReadVersion } from './watch-types.ts'

const id = z.string().min(1), integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const worldEvidenceChallengeIdSchema = id.transform(value => value as WorldEvidenceChallengeId)
const worldEvidenceRevisionIdSchema = id.transform(value => value as WorldEvidenceRevisionId)
const worldEvidenceFieldCodeSchema = id.transform(value => value as WorldEvidenceFieldCode)
const sequence = integer.positive(), status = z.enum(['open', 'awaiting-evidence', 'cancel-requested', 'cancelled', 'rejected', 'committed'])
const requestId = id.transform(value => value as WorldRequestId), intentId = id.transform(value => value as WorldIntentId)
const planId = id.transform(value => value as WorldPlanId), resultId = id.transform(value => value as WorldResultId)
const entityId = id.transform(value => value as SimulationEntityId), operationId = id.transform(value => value as SimulationOperationId)
const relationId = id.transform(value => value as SimulationRelationId), channelId = id.transform(value => value as ChannelId)
const readVersion = id.transform(value => value as SimulationProductReadVersion)
const section = z.enum(['request', 'plans', 'execution', 'notification'])
const observationFields = { planId, mode: z.enum(['execute', 'reconcile']), sequence, updates: sequence,
  time: z.string().regex(/^(0|[1-9][0-9]*)$/).transform(value => value as SimTime) }
/** Safe cancellation hints never establish permission to submit a command. */
export const simulationProductWorldCaseCancelCapabilitySchema = z.strictObject({ allowed: z.boolean(),
  reason: z.enum(['ready', 'terminal', 'recovery-required', 'retiring', 'capacity', 'in-progress', 'stale']),
  preview: simulationProductWorldCaseCancelPreviewSchema.optional() })
  .refine(value => value.allowed === (value.reason === 'ready') && value.allowed === (value.preview !== undefined)
    && (value.preview === undefined || value.preview.impact.requestStatus === 'open' || value.preview.impact.requestStatus === 'awaiting-evidence'),
  'Allowed cancellation requires a ready hint and the exact Native preview')
const body = z.discriminatedUnion('status', [z.strictObject({ status: z.literal('withheld') }),
  z.strictObject({ status: z.literal('allowed'), text: simulationProductTextSchema })])
const persona = z.discriminatedUnion('status', [z.strictObject({ status: z.enum(['withheld', 'not-applicable']) }),
  z.strictObject({ status: z.literal('allowed'), templateId: simulationProductTextSchema, templateVersion: simulationProductTextSchema,
    name: simulationProductTextSchema, skills: z.array(simulationProductTextSchema), traits: z.array(simulationProductTextSchema),
    goals: z.array(simulationProductTextSchema) })])
const plan = z.strictObject({ id: planId, operationId: operationId.nullable(), sequence, hash: id, predecessor: planId.nullable(),
  status: z.enum(['accepted', 'stale']), resolution: z.enum(['apply', 'reject', 'awaiting-evidence']),
  stale: z.strictObject({ phase: z.enum(['acceptance', 'execution']), reason: z.enum(['read-set-changed', 'authority-unavailable']),
    sequence }).optional(), rationale: body, persona })
  .refine(value => (value.status === 'stale') === (value.stale !== undefined), 'Stale plans retain an original invalidation')
  .refine(value => value.stale === undefined || value.stale.sequence >= value.sequence,
    'Invalidation cannot precede its original plan')
  .refine(value => value.resolution === 'apply' || value.persona.status === 'not-applicable',
    'Only apply plans may describe a generated Persona')
const result = z.strictObject({ id: resultId, sequence,
  time: z.string().regex(/^(0|[1-9][0-9]*)$/).transform(value => value as SimTime),
  source: z.discriminatedUnion('kind', [z.strictObject({ kind: z.literal('plan'), planId }),
    z.strictObject({ kind: z.literal('evidence-deadline'), challengeId: worldEvidenceChallengeIdSchema,
      eventId: id.transform(value => value as SimulationEventId) }),
    z.strictObject({ kind: z.literal('evidence-exhausted'), challengeId: worldEvidenceChallengeIdSchema,
      decisionId: id.transform(value => value as SimulationDecisionId) }),
    z.strictObject({ kind: z.literal('cancel'), commandId: id.transform(value => value as WorldCancelId) })]),
  payload: z.json(),
  outcome: z.discriminatedUnion('kind', [z.strictObject({ kind: z.literal('committed') }),
    z.strictObject({ kind: z.literal('rejected'), reason: z.enum(['insufficient-information', 'unauthorized', 'capacity-full', 'unsupported', 'policy']) }),
    z.strictObject({ kind: z.literal('cancelled') })]) })
  .refine(value => (value.outcome.kind === 'cancelled') === (value.source.kind === 'cancel'),
    'Cancelled outcomes require their original cancellation source')
  .refine(value => !['evidence-deadline', 'evidence-exhausted'].includes(value.source.kind)
    || value.outcome.kind === 'rejected' && value.outcome.reason === 'insufficient-information',
  'Evidence terminal results require an insufficient-information rejection')
const post = z.strictObject({ operationId,
  status: z.enum(['pending', 'applied', 'rejected', 'blocked-authority', 'blocked-dependency', 'outcome-unknown']),
  publication: z.enum(['unpublished', 'in-flight', 'unknown', 'published']), delivery: z.enum(['not-received', 'received']), channelId,
  envelopeId: id.transform(value => value as EnvelopeId).optional() })
  .refine(value => (value.publication === 'published') === (value.envelopeId !== undefined)
    && (value.delivery !== 'received' || value.publication === 'published'), 'Delivery needs the original publication receipt')
const wake = z.strictObject({ id: id.transform(value => value as SimulationEventId),
  status: z.enum(['scheduled', 'pending', 'claimed', 'completed', 'cancelled', 'absent']),
  decisionId: id.transform(value => value as SimulationDecisionId).optional() })
const observation = z.discriminatedUnion('status', [
  z.strictObject({ ...observationFields, status: z.literal('settled'), reason: z.null() }),
  z.strictObject({ ...observationFields, status: z.enum(['blocked', 'outcome-unknown']), reason: worldExecutionReasonSchema }),
])
const notificationFields = { request: post.nullable(),
  result: z.strictObject({ resultId, wake, post: post.optional() }).optional(),
  firstAction: z.strictObject({ wake, post: post.optional() }).optional() }
/** Required independent lifecycle tracks from the same authoritative Native prefix. */
export const simulationProductWorldCaseLifecycleSchema = z.strictObject({
  request: z.strictObject({ status }),
  plan: z.discriminatedUnion('status', [z.strictObject({ status: z.literal('none') }),
    z.strictObject({ id: planId, status: z.enum(['accepted', 'stale']), resolution: z.enum(['apply', 'reject', 'awaiting-evidence']) })]),
  execution: z.strictObject({ callback: z.union([z.strictObject({ status: z.literal('none') }), observation]),
    business: z.discriminatedUnion('status', [z.strictObject({ status: z.literal('none') }),
      z.strictObject({ status: z.enum(['committed', 'rejected', 'cancelled']), resultId })]) }),
  notification: z.strictObject(notificationFields),
})
/** Exact-version business facts or an explicit unsupported/withheld/unknown disclosure result. */
export const simulationProductWorldBusinessSummarySchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.enum(['unsupported', 'withheld', 'unknown']) }),
  z.strictObject({ status: z.literal('allowed'), value: simulationWorldBusinessSummarySchema }),
])
const summary = z.strictObject({ apiVersion: z.literal('clocky.world-case/v4'),
  businessSummary: simulationProductWorldBusinessSummarySchema, domain: id, operation: id, version: id,
  requestId, intentId, status, requesterEntityId: entityId.nullable(), organizationEntityId: entityId,
  origin: z.discriminatedUnion('kind', [z.strictObject({ kind: z.literal('decision') }),
    z.strictObject({ kind: z.literal('authenticated-user'), commandId: simulationProductWorldManagementCommandIdSchema })]),
  targetEntityId: entityId, cancel: simulationProductWorldCaseCancelCapabilitySchema,
  lifecycle: simulationProductWorldCaseLifecycleSchema })
  .refine(value => (value.origin.kind === 'authenticated-user') === (value.requesterEntityId === null),
    'Authenticated user cases cannot claim a simulated requester')
  .refine(value => value.origin.kind !== 'authenticated-user'
    || value.lifecycle.notification.request === null && value.lifecycle.notification.result === undefined,
  'User commands have no simulated request publication or requester-result wake')
  .refine(value => value.cancel.preview === undefined || value.cancel.preview.impact.requestStatus === value.status,
    'Cancellation quote must retain its original request status')
  .refine(value => value.status === value.lifecycle.request.status, 'Request track must match its original case filter status')
  .refine(value => value.lifecycle.execution.business.status === 'none'
    ? !['committed', 'rejected', 'cancelled'].includes(value.status)
    : value.lifecycle.execution.business.status === value.status, 'Business track requires the original terminal result')
const hiring = (value: z.infer<typeof summary>) => value.domain === WORLD_GENERATE_AND_HIRE_PIN.domain
  && value.operation === WORLD_GENERATE_AND_HIRE_PIN.operation && value.version === WORLD_GENERATE_AND_HIRE_PIN.version
const evidence = z.strictObject({
  inputRevision: integer,
  latestChallenge: z.strictObject({ id: worldEvidenceChallengeIdSchema,
    status: z.enum(['awaiting', 'answered', 'expired', 'exhausted', 'cancelled']), round: sequence,
    fields: z.array(z.strictObject({ code: worldEvidenceFieldCodeSchema, description: simulationProductTextSchema })).min(1)
      .refine(values => new Set(values.map(value => value.code)).size === values.length, 'Evidence fields must be distinct'),
    responders: z.array(entityId).min(1).refine(values => new Set(values).size === values.length, 'Responders must be distinct'),
    deadline: z.string().regex(/^(0|[1-9][0-9]*)$/).transform(value => value as SimTime),
    maxAttempts: sequence, attemptsUsed: integer,
  }).refine(value => value.attemptsUsed <= value.maxAttempts, 'Evidence attempts exceed the original challenge bound').optional(),
  latestRevision: z.strictObject({ id: worldEvidenceRevisionIdSchema, revision: sequence, sequence, actorId: entityId,
    answers: z.discriminatedUnion('status', [z.strictObject({ status: z.literal('withheld') }),
      z.strictObject({ status: z.literal('allowed'), items: z.array(z.strictObject({ field: worldEvidenceFieldCodeSchema,
        text: simulationProductTextSchema })).min(1)
        .refine(values => new Set(values.map(value => value.field)).size === values.length, 'Answer fields must be distinct') })]),
  }).optional(),
}).refine(value => value.inputRevision === (value.latestRevision?.revision ?? 0), 'Input revision must name the latest retained answer')
const detail = z.discriminatedUnion('section', [
  z.strictObject({ section: z.literal('request'), summary, source: z.discriminatedUnion('kind', [z.strictObject({ kind: z.literal('decision'), operationId, sequence, payloadHash: id }),
    z.strictObject({ kind: z.literal('authenticated-user'), commandId: simulationProductWorldManagementCommandIdSchema, sequence, payloadHash: id })]), description: body, evidence: evidence.optional() })
    .refine(value => value.source.kind === value.summary.origin.kind && (value.source.kind !== 'authenticated-user'
      || value.summary.origin.kind === 'authenticated-user' && value.source.commandId === value.summary.origin.commandId),
    'Request provenance must match its original summary'),
  z.strictObject({ section: z.literal('plans'), summary, total: integer, items: z.array(plan), nextCursor: simulationProductCursorSchema.optional() })
    .refine(value => value.items.every(item => (item.operationId === null) === (value.summary.origin.kind === 'authenticated-user')),
      'User plans have no fabricated model operation')
    .refine(value => (value.total === 0) === (value.summary.lifecycle.plan.status === 'none'),
      { path: ['summary', 'lifecycle', 'plan'], message: 'Only an empty original plan history has no current plan' })
    .refine(value => value.nextCursor !== undefined || value.total === 0 || (() => {
      const latest = value.items.at(-1), current = value.summary.lifecycle.plan
      return latest !== undefined && current.status !== 'none' && latest.id === current.id
        && latest.status === current.status && latest.resolution === current.resolution
    })(), { path: ['items'], message: 'The final plan page must end at its original current plan' })
    .refine(value => value.total >= value.items.length, { path: ['total'], message: 'Plan total cannot omit returned plans' })
    .refine(value => new Set(value.items.map(item => item.id)).size === value.items.length,
      { path: ['items'], message: 'Returned original plan identities must be distinct' })
    .refine(value => value.items.every(item => (hiring(value.summary) && item.resolution === 'apply')
      === (item.persona.status !== 'not-applicable')), { path: ['items'], message: 'Only an exact hiring apply plan owns a Persona' }),
  z.strictObject({ section: z.literal('execution'), summary, result: result.optional(),
    observation: observation.optional(),
    responsibilities: z.array(z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('personnel'), id: intentId, planId, sequence, updatedSequence: sequence,
        status: z.enum(['reserved', 'fenced', 'ready', 'blocked', 'cancel-requested', 'cancelled', 'committed']) }),
      z.strictObject({ kind: z.literal('representative'), id: intentId, planId, sequence, updatedSequence: sequence,
        status: z.enum(['reserved', 'preparing', 'committed', 'cancel-requested', 'abandoned']) }),
      z.strictObject({ kind: z.literal('contact'), id: intentId, planId, sequence, updatedSequence: sequence,
        status: z.enum(['reserved', 'committed', 'cancel-requested', 'cancelled']) }),
    ])).min(1).max(2).optional(),
    reservation: z.strictObject({ id: intentId, planId, status: z.enum(['reserved', 'preparing', 'candidate', 'cancel-requested', 'committed', 'abandoned']),
      sequence, updatedSequence: sequence,
      newborn: z.strictObject({ entityId, readiness: z.enum(['absent', 'preparing', 'ready', 'abandoned']),
        phase: z.enum(['absent', 'active', 'inactive', 'terminated']) }),
      assignment: z.strictObject({ relationId, status: z.enum(['absent', 'retained']) }),
      cleanup: z.strictObject({ sequence, participant: z.enum(['absent', 'left', 'failed']) }).optional() }).optional() })
    .superRefine((value, ctx) => {
      const { reservation, result } = value
      if (JSON.stringify(value.observation ?? { status: 'none' }) !== JSON.stringify(value.summary.lifecycle.execution.callback))
        ctx.addIssue({ code: 'custom', path: ['observation'], message: 'Callback detail differs from its same-prefix lifecycle track' })
      const business = result === undefined ? { status: 'none' } : { status: result.outcome.kind, resultId: result.id }
      if (JSON.stringify(business) !== JSON.stringify(value.summary.lifecycle.execution.business))
        ctx.addIssue({ code: 'custom', path: ['result'], message: 'Business detail differs from its same-prefix lifecycle track' })
      const duties = value.responsibilities ?? []
      if (new Set(duties.map(duty => duty.kind)).size !== duties.length || duties.some((duty) => {
        const ownerMatches = duty.kind === 'representative' || duty.id === value.summary.intentId
        const selectorMatches = duty.kind === 'personnel'
          ? value.summary.domain === 'organization' && ['transfer', 'depart'].includes(value.summary.operation) && value.summary.version === '1'
          : value.summary.domain === 'external' && value.summary.operation === 'interact' && ['2', '3'].includes(value.summary.version)
        const settled = duty.kind === 'representative' || (duty.status === 'committed') === (result?.outcome.kind === 'committed')
          && (duty.status === 'cancelled') === (result?.outcome.kind === 'cancelled')
        return !ownerMatches || !selectorMatches || !settled || duty.updatedSequence < duty.sequence
      })) ctx.addIssue({ code: 'custom', path: ['responsibilities'], message: 'Responsibilities must retain distinct kinds, original owner, selector and sequence order' })
      if (result !== undefined && value.summary.status !== result.outcome.kind) {
        ctx.addIssue({ code: 'custom', path: ['result'], message: 'Terminal result differs from its original case status' })
      }
      if (reservation === undefined) {
        if (hiring(value.summary) && result?.outcome.kind === 'committed') ctx.addIssue({ code: 'custom', path: ['reservation'],
          message: 'A committed hiring case retains its actual hiring reservation' })
        return
      }
      if (!hiring(value.summary)) ctx.addIssue({ code: 'custom', path: ['reservation'],
        message: 'Only an exact hiring case owns a hiring reservation' })
      if (reservation.id !== value.summary.intentId) {
        ctx.addIssue({ code: 'custom', path: ['reservation', 'id'], message: 'Reservation belongs to another original business application' })
      }
      if (reservation.updatedSequence < reservation.sequence) {
        ctx.addIssue({ code: 'custom', path: ['reservation', 'updatedSequence'], message: 'Reservation transitions retain their original order' })
      }
      if (reservation.cleanup !== undefined && (reservation.status !== 'abandoned'
        || reservation.cleanup.sequence !== reservation.updatedSequence || reservation.cleanup.sequence <= reservation.sequence
        || reservation.newborn.phase !== 'terminated' || reservation.newborn.readiness !== 'abandoned'
        || reservation.assignment.status !== 'absent')) {
        ctx.addIssue({ code: 'custom', path: ['reservation', 'cleanup'], message: 'Cleanup belongs only to its original abandonment transition' })
      }
      if ((reservation.status === 'committed') !== (result?.outcome.kind === 'committed')) {
        ctx.addIssue({ code: 'custom', path: ['result'], message: 'Committed reservation and business outcome must settle together' })
      }
      if (result?.outcome.kind === 'committed') {
        const parsed = simulationWorldHireCommittedResultPayloadSchema.safeParse(result.payload)
        if (!parsed.success || parsed.data.entityId !== reservation.newborn.entityId
          || parsed.data.relationId !== reservation.assignment.relationId || result.source.kind !== 'plan' || result.source.planId !== reservation.planId
          || result.sequence !== reservation.updatedSequence || reservation.newborn.readiness !== 'ready'
          || reservation.newborn.phase === 'absent' || reservation.assignment.status !== 'retained')
          ctx.addIssue({ code: 'custom', path: ['result'], message: 'Committed result lost its original plan, newborn or assignment' })
      }
    }),
  z.strictObject({ section: z.literal('notification'), summary, ...notificationFields })
    .refine((value) => {
      const { section: _section, summary: _summary, ...notification } = value
      return JSON.stringify(notification) === JSON.stringify(value.summary.lifecycle.notification)
    }, { path: ['summary', 'lifecycle', 'notification'], message: 'Notification detail differs from its same-prefix lifecycle track' }),
])
const envelope = { runId: simulationProductRunIdSchema, snapshotRevision: integer, readVersion, observedAt: integer }
/** Exact registered run and finite filter; continuations carry neither private bodies nor plain scan offsets. */
export const simulationProductWorldCasesInputSchema = z.strictObject({ runId: simulationProductRunIdSchema,
  status: status.optional(), expectedRevision: integer.optional(), cursor: simulationProductCursorSchema.optional(),
  limit: integer.positive().optional() }) satisfies z.ZodType<SimulationProductWorldCasesInput>
/** Complete metadata page, without provider configuration or prose. */
export const simulationProductWorldCasesPageSchema = z.strictObject({ ...envelope, total: integer, items: z.array(summary),
  nextCursor: simulationProductCursorSchema.optional() }).refine(value => value.total >= value.items.length,
  { path: ['total'], message: 'Case total cannot omit returned cases' })
  .refine(value => value.items.every(item => item.cancel.preview === undefined
    || item.cancel.preview.snapshotRevision === value.snapshotRevision && item.cancel.preview.impact.requestStatus === item.status),
  'Cancellation previews must retain their same-prefix request status and revision')
  .refine(value => value.items.every(item => item.businessSummary.status !== 'allowed'
    || item.businessSummary.value.nativeRevision === value.snapshotRevision),
  'Business summaries must retain the same Native revision as their page')
  .refine(value => new Set(value.items.map(item => item.requestId)).size === value.items.length,
    { path: ['items'], message: 'Returned original case identities must be distinct' }) satisfies z.ZodType<SimulationProductWorldCasesPage>
/** Case identity, finite section and explicit revision/policy fences. */
export const simulationProductWorldCaseInputSchema = z.strictObject({ runId: simulationProductRunIdSchema, requestId, section,
  expectedRevision: integer.optional(), readVersion: readVersion.optional(), cursor: simulationProductCursorSchema.optional(),
  limit: integer.positive().optional() }).refine(value => value.section === 'plans' || value.cursor === undefined,
  'Only plans admit a case-detail continuation') satisfies z.ZodType<SimulationProductWorldCaseInput>
/** Authoritative absence and detail are mutually exclusive and must match the original case/section. */
export const simulationProductWorldCaseInspectionSchema = z.strictObject({ ...envelope, requestId, section,
  status: z.enum(['found', 'missing']), value: detail.optional() }).refine(value =>
  (value.status === 'found') === (value.value !== undefined)
  && (value.value === undefined || value.value.section === value.section && value.value.summary.requestId === value.requestId
    && (value.value.summary.businessSummary.status !== 'allowed'
      || value.value.summary.businessSummary.value.nativeRevision === value.snapshotRevision)
    && (value.value.summary.cancel.preview === undefined || value.value.summary.cancel.preview.snapshotRevision === value.snapshotRevision
      && value.value.summary.cancel.preview.impact.requestStatus === value.value.summary.status)),
'Case detail must belong to its selected original case and section') satisfies z.ZodType<SimulationProductWorldCaseInspection>
