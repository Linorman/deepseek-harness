/** Strict browser-safe collection and section parsers; no native runtime imports. */
import { z } from 'zod'
import { simulationProductOperationRetryCapabilitySchema } from './operation-retry-schema.ts'
import type { SimulationEntityId, SimulationDecisionId, SimulationDecisionSlot, SimulationOperationId,
  SimulationCheckpointId, SimulationWriterEpoch, SimulationRelationId } from '@clocky/clocky-simulation/identities'
import type { Branded } from '@clocky/clocky-brand'
import type { SimTime } from '@clocky/clocky-simulation/time-types'
import type { TeamId, ParticipantId, ChannelId, TeamTaskId, EnvelopeId } from '@clocky/clocky-team/types'
import type { SessionId } from '@clocky/clocky-session/types'
import type { SimulationProductBrowseInput, SimulationProductCollectionPage, SimulationProductObjectInput,
  SimulationProductObjectInspection } from './collections-types.ts'
import { simulationProductRunIdSchema, simulationProductCursorSchema, simulationProductTextSchema } from './schema-common.ts'
import { simulationProductReadVersionSchema } from './watch-schema.ts'

const entityId = z.string().min(1).transform(value => value as SimulationEntityId)
const decisionId = z.string().min(1).transform(value => value as SimulationDecisionId)
const operationId = z.string().min(1).transform(value => value as SimulationOperationId)
const checkpointId = z.string().min(1).transform(value => value as SimulationCheckpointId)
const teamId = z.string().min(1).transform(value => value as TeamId)
const participantId = z.string().min(1).transform(value => value as ParticipantId)
const channelId = z.string().min(1).transform(value => value as ChannelId)
const taskId = z.string().min(1).transform(value => value as TeamTaskId)
const sessionId = z.string().min(1).transform(value => value as SessionId)
const relationId = z.string().min(1).transform(value => value as SimulationRelationId)
const knowledgeId = z.string().min(1).transform(value => value as Branded<'SimulationKnowledgeId'>)
const envelopeId = z.string().min(1).transform(value => value as EnvelopeId)
const decimal = z.string().regex(/^(0|[1-9][0-9]*)$/)
const time = decimal.transform(value => value as SimTime)
const slot = decimal.transform(value => value as SimulationDecisionSlot)
const epoch = z.string().regex(/^[1-9][0-9]*$/).transform(value => value as SimulationWriterEpoch)
const integer = z.number().int().nonnegative()
const entityPhase = z.enum(['active', 'inactive', 'terminated'])
const cognition = z.enum(['none', 'agent'])
const decisionStatus = z.enum(['open', 'submitted', 'accepted', 'cancelled'])
const operationStatus = z.enum(['pending', 'applied', 'rejected', 'blocked-authority', 'blocked-dependency', 'outcome-unknown'])
const settledStatus = z.enum(['applied', 'rejected', 'blocked-authority', 'blocked-dependency'])
const checkpointStatus = z.enum(['in-progress', 'failed', 'completed'])
const pageInput = { runId: simulationProductRunIdSchema, limit: z.number().int().positive().optional(),
  cursor: simulationProductCursorSchema.optional() }

/** Reject cross-collection filter fields instead of silently ignoring them. */
export const simulationProductBrowseInputSchema = z.discriminatedUnion('collection', [
  z.strictObject({ ...pageInput, collection: z.literal('entities'), phase: entityPhase.optional(), cognition: cognition.optional() }),
  z.strictObject({ ...pageInput, collection: z.literal('decisions'), status: decisionStatus.optional(), entityId: entityId.optional() }),
  z.strictObject({ ...pageInput, collection: z.literal('operations'), status: operationStatus.optional(), entityId: entityId.optional(),
    decisionId: decisionId.optional() }),
  z.strictObject({ ...pageInput, collection: z.literal('checkpoints'), status: checkpointStatus.optional() }),
]) satisfies z.ZodType<SimulationProductBrowseInput>

const entity = z.strictObject({ id: entityId, name: simulationProductTextSchema.optional(), kind: simulationProductTextSchema,
  phase: entityPhase, cognition, writer: z.enum(['none', 'reserved', 'active', 'revoked', 'released']) })
const decision = z.strictObject({ id: decisionId, entityId, slot, time, snapshotRevision: integer,
  status: decisionStatus, operationCount: integer })
const operation = z.strictObject({ id: operationId, entityId, decisionId, index: integer,
  kind: simulationProductTextSchema, status: operationStatus,
  publication: z.enum(['not-applicable', 'pending', 'published']),
  delivery: z.enum(['not-applicable', 'pending', 'input-persisted', 'receipted']),
  deliveryFailure: z.enum(['unresolved', 'retained-input', 'absent-input', 'entity-terminated']).optional(),
  task: z.enum(['not-applicable', 'pending', 'created']) })
const checkpoint = z.strictObject({ id: checkpointId, status: checkpointStatus, startedSequence: integer,
  finishedSequence: integer.optional(), time: time.optional(), publishedAt: integer.optional(), latestSuccessful: z.boolean(), sourceValidation: z.literal('not-performed') }).refine(value => (value.status === 'completed') === (value.publishedAt !== undefined),
  'Only completed checkpoints carry their retained publication time')
const observation = { runId: simulationProductRunIdSchema, snapshotRevision: integer, observedAt: integer }
const page = { ...observation, total: integer, nextCursor: simulationProductCursorSchema.optional() }

/** One public page has one collection, revision and filtered total, with no private body fields. */
export const simulationProductCollectionPageSchema = z.discriminatedUnion('collection', [
  z.strictObject({ ...page, collection: z.literal('entities'), items: z.array(entity) }),
  z.strictObject({ ...page, collection: z.literal('decisions'), items: z.array(decision) }),
  z.strictObject({ ...page, collection: z.literal('operations'), items: z.array(operation) }),
  z.strictObject({ ...page, collection: z.literal('checkpoints'), items: z.array(checkpoint) }),
]).refine(value => value.total >= value.items.length, 'Filtered total cannot be smaller than the returned page') satisfies
  z.ZodType<SimulationProductCollectionPage>

const knowledgeRef = z.strictObject({ id: knowledgeId, revision: z.number().int().positive() })
const selector = z.discriminatedUnion('collection', [
  z.strictObject({ collection: z.literal('entities'), id: entityId, section: z.enum(['identity', 'relationships', 'knowledge']) }),
  z.strictObject({ collection: z.literal('decisions'), id: decisionId, section: z.enum(['execution', 'context', 'knowledge']),
    reference: knowledgeRef.optional() }).refine(value => value.section === 'knowledge' || value.reference === undefined),
  z.strictObject({ collection: z.literal('operations'), id: operationId, section: z.enum(['execution', 'attempts']) }),
  z.strictObject({ collection: z.literal('checkpoints'), id: checkpointId, section: z.literal('references') }),
])
const objectInput = { runId: simulationProductRunIdSchema, expectedRevision: integer.optional() }
const detailPageInput = { limit: pageInput.limit, cursor: pageInput.cursor }
/** Only paged detail sections accept page controls; all selectors remain actor-free. */
export const simulationProductObjectInputSchema = z.union([
  z.strictObject({ ...objectInput, ...detailPageInput, collection: z.literal('entities'), id: entityId, section: z.literal('knowledge') }),
  z.strictObject({ ...objectInput, ...detailPageInput, collection: z.literal('decisions'), id: decisionId, section: z.literal('knowledge'), reference: knowledgeRef.optional() }),
  z.strictObject({ ...objectInput, collection: z.literal('entities'), id: entityId, section: z.literal('identity') }),
  z.strictObject({ ...objectInput, collection: z.literal('decisions'), id: decisionId, section: z.literal('execution') }),
  z.strictObject({ ...objectInput, ...detailPageInput, collection: z.literal('entities'), id: entityId, section: z.literal('relationships') }),
  z.strictObject({ ...objectInput, ...detailPageInput, collection: z.literal('decisions'), id: decisionId, section: z.literal('context') }),
  z.strictObject({ ...objectInput, collection: z.literal('operations'), id: operationId, section: z.literal('execution') }),
  z.strictObject({ ...objectInput, ...detailPageInput, collection: z.literal('operations'), id: operationId, section: z.literal('attempts') }),
  z.strictObject({ ...objectInput, ...detailPageInput, collection: z.literal('checkpoints'), id: checkpointId, section: z.literal('references') }),
]) satisfies z.ZodType<SimulationProductObjectInput>

const inference = z.strictObject({ startedAt: integer, deadline: integer, finishedAt: integer.optional(), expiredAt: integer.optional() })
const context = z.discriminatedUnion('status', [z.strictObject({ status: z.literal('absent') }),
  z.strictObject({ status: z.literal('overflow'), requiredBytes: integer, maxBytes: integer }),
  z.strictObject({ status: z.literal('prepared'), retainedBytes: integer, maxBytes: integer, knowledgeCount: integer,
    sourceCount: integer, sectionCount: integer, content: z.literal('withheld') }),
])
const attempt = z.strictObject({ number: z.number().int().positive(), startedAt: integer, finishedAt: integer.optional(),
  outcome: z.enum(['in-flight', 'uncertain', 'applied', 'rejected', 'blocked-authority']) })
const reference = z.union([
  z.strictObject({ kind: z.literal('run'), cursor: integer }),
  z.strictObject({ kind: z.literal('team'), id: teamId, cursor: integer }),
  z.strictObject({ kind: z.literal('channel'), id: channelId, cursor: integer }),
  z.strictObject({ kind: z.literal('session'), id: sessionId, teamId, participantId, materialization: z.literal('materialized'),
    sequence: z.number().int().min(-1) }),
  z.strictObject({ kind: z.literal('session'), id: sessionId, teamId, participantId, materialization: z.literal('unmaterialized') }),
])
const nestedPage = { total: integer, nextCursor: simulationProductCursorSchema.optional() }
const relation = z.strictObject({ id: relationId, subject: entityId, object: entityId, relation: simulationProductTextSchema,
  scope: entityId.optional(), revision: integer, validFrom: time, validUntil: time.nullable(), active: z.boolean() })
const body = z.union([z.strictObject({ status: z.enum(['withheld', 'unsupported']) }),
  z.strictObject({ status: z.literal('text'), text: z.string(), part: integer, parts: z.number().int().positive() })
    .refine(value => value.part < value.parts, 'Context text part must belong to its retained block'),
])
const contextItem = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('section'), index: integer, block: integer, section: simulationProductTextSchema,
    required: z.boolean(), body }),
  z.strictObject({ kind: z.literal('knowledge'), id: knowledgeId, revision: z.number().int().positive() }),
  z.strictObject({ kind: z.literal('run-event'), sequence: z.number().int().positive() }),
  z.strictObject({ kind: z.literal('team-envelope'), sourceIndex: integer, teamId, channelId, envelopeId }),
])
const frozenContext = z.strictObject({ time, slot, entityId, epoch,
  projections: z.strictObject({ run: integer, entity: integer, team: integer }),
  versions: z.strictObject({ rules: simulationProductTextSchema, policy: simulationProductTextSchema,
    persona: simulationProductTextSchema, model: simulationProductTextSchema }) })
const knowledgeSource = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('observation'), worldRevision: integer, visibilityPolicy: simulationProductTextSchema }),
  z.strictObject({ kind: z.literal('report'), operationId, body }),
  z.strictObject({ kind: z.literal('inference'), decisionId, confidence: z.number().min(0).max(1).optional() }),
  z.strictObject({ kind: z.literal('summary'), cursor: integer, policy: simulationProductTextSchema, policyVersion: simulationProductTextSchema }),
  z.strictObject({ kind: z.literal('belief'), profileRevision: integer, policyVersion: simulationProductTextSchema, confidence: z.number().min(0).max(1).optional() }),
])
const knowledgeItem = z.strictObject({ reference: knowledgeRef, owner: entityId, observedAt: time, availableAt: time,
  validFrom: time, validUntil: time.nullable(), sequence: integer, body, source: knowledgeSource, premises: z.array(knowledgeRef) })
const detail = z.union([
  z.strictObject({ collection: z.enum(['entities', 'decisions']), section: z.literal('knowledge'), id: z.union([entityId, decisionId]),
    readVersion: simulationProductReadVersionSchema, bodyAccess: z.enum(['allowed', 'withheld']), entityId, time, cutoffRevision: integer,
    selected: knowledgeRef.optional(), knowledge: z.strictObject({ ...nestedPage, items: z.array(knowledgeItem) }) })
    .refine(value => value.knowledge.total >= value.knowledge.items.length
      && (value.bodyAccess === 'allowed' || value.knowledge.total === 0 && value.knowledge.items.length === 0)
      && (value.collection === 'decisions' || value.selected === undefined), 'Knowledge data must respect its permission and selection'),
  z.strictObject({ collection: z.literal('entities'), section: z.literal('relationships'), id: entityId, time,
    relationships: z.strictObject({ ...nestedPage, items: z.array(relation) }).refine(value => value.total >= value.items.length) }),
  z.strictObject({ collection: z.literal('decisions'), section: z.literal('context'), id: decisionId,
    readVersion: simulationProductReadVersionSchema,
    accounting: context, bodyAccess: z.enum(['allowed', 'withheld']), frozen: frozenContext.optional(),
    items: z.strictObject({ ...nestedPage, items: z.array(contextItem) }).refine(value => value.total >= value.items.length) })
    .refine(value => (value.accounting.status === 'prepared') === (value.frozen !== undefined)
      && (value.accounting.status === 'prepared' || value.items.total === 0)
      && (value.bodyAccess === 'allowed' || value.items.items.every(item => item.kind !== 'section' || item.body.status === 'withheld')),
    'Frozen context and bodies must match preparation and current read permission'),
  z.strictObject({ collection: z.literal('entities'), section: z.literal('identity'), id: entityId, summary: entity,
    revision: integer, profileRevision: integer, writerEpoch: epoch.optional(),
    binding: z.strictObject({ teamId, participantId, sessionId }).optional() }),
  z.strictObject({ collection: z.literal('decisions'), section: z.literal('execution'), id: decisionId, summary: decision, context,
    inference: inference.optional(), closedAt: integer.optional(),
    cancellation: z.enum(['requested', 'writer-revoked', 'scheduled-wake-cancelled', 'timeout']).optional() }),
  z.strictObject({ collection: z.literal('operations'), section: z.literal('execution'), id: operationId, summary: operation,
    dependencies: z.array(operationId), result: z.strictObject({ status: settledStatus, time, sequence: integer,
      code: simulationProductTextSchema }).optional(),
    outbox: z.strictObject({ ready: z.boolean(), attemptCount: integer, nextAttemptAt: integer.optional() }).optional(),
    taskReference: z.strictObject({ teamId, taskId }).optional(), retry: simulationProductOperationRetryCapabilitySchema.optional() }),
  z.strictObject({ collection: z.literal('operations'), section: z.literal('attempts'), id: operationId,
    attempts: z.strictObject({ ...nestedPage, items: z.array(attempt) }).refine(value => value.total >= value.items.length) }),
  z.strictObject({ collection: z.literal('checkpoints'), section: z.literal('references'), id: checkpointId, summary: checkpoint,
    references: z.strictObject({ ...nestedPage, items: z.array(reference) }).refine(value => value.total >= value.items.length),
    failure: z.literal('details-withheld').optional(), diagnostic: simulationCheckpointDiagnosticSchema.optional() })
    .refine(value => value.diagnostic === undefined || value.summary.status === 'failed', 'Only failed checkpoints carry diagnoses'),
])
/** Bind found data to the exact requested object and section; missing results carry no object data. */
export const simulationProductObjectInspectionSchema = z.strictObject({ ...observation, selection: selector,
  status: z.enum(['found', 'missing']), value: detail.optional() }).refine((value) => {
  if (value.status === 'missing') return value.value === undefined
  const detail = value.value
  if (detail === undefined || detail.id !== value.selection.id || detail.collection !== value.selection.collection
    || detail.section !== value.selection.section) return false
  if (detail.section === 'knowledge') {
    const selected = value.selection.collection === 'decisions' && value.selection.section === 'knowledge' ? value.selection.reference : undefined
    return detail.selected?.id === selected?.id && detail.selected?.revision === selected?.revision
      && (selected === undefined || detail.knowledge.items.every(item => item.reference.id === selected.id
        && item.reference.revision === selected.revision))
  }
  return !('summary' in detail) || detail.summary.id === detail.id
}, 'Object data must match its exact selector and presence status') satisfies z.ZodType<SimulationProductObjectInspection>
import { simulationCheckpointDiagnosticSchema } from '@clocky/clocky-simulation/checkpoint-diagnostics-schema'
