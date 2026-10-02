/** Administrative metadata projections from one validated native observation; no execution or private-body serialization. */
import type { SimulationSnapshot, SimulationEntity, SimulationDecision, SimulationOperation, SimulationCheckpointOperation,
  SimulationContextPreparation } from '@clocky/clocky-simulation'
import { simulationOutboxRetryCapability } from '@clocky/clocky-simulation'
import type { SimulationProductBrowseInput, SimulationProductObjectInput, SimulationProductObjectDetail,
  SimulationProductEntitySummary, SimulationProductDecisionSummary, SimulationProductOperationSummary,
  SimulationProductCheckpointSummary, SimulationProductCheckpointReference, SimulationProductContextSummary,
  SimulationProductCollectionPage } from './collections-types.ts'
import type { SimulationProductText, SimulationProductCursor } from './types.ts'
import { contextRows, frozenContext } from './context-details.ts'
import type { SimulationProductReadVersion } from './watch-types.ts'
import { knowledgeDetail } from './knowledge-details.ts'

type Text = (value: string) => SimulationProductText
/**
 * Internal page builder accounts for the final section wrapper before accepting rows.
 * @param rows - Section's safe metadata rows.
 * @param wrap - Complete detail wrapper assembled around the accepted page.
 * @returns detail whose page and wrapper fit the deployment allowance.
 */
export type DetailPageBuilder = <T, R extends SimulationProductObjectDetail>(rows: readonly T[], wrap: (page: {
  items: readonly T[]
  total: number
  nextCursor?: SimulationProductCursor | undefined
}) => R) => R

/**
 * Project the selected filtered collection in stable native order.
 * @param input - Wire-validated collection and its exact filters.
 * @param state - One detached validated native world observation.
 * @param text - Deployment-bounded public label projection.
 * @returns safe rows and collection discriminator; the read owner applies complete-response pagination.
 */
export function collectionRows(input: SimulationProductBrowseInput, state: SimulationSnapshot, text: Text):
  Pick<SimulationProductCollectionPage, 'collection'> & { items: readonly SimulationProductCollectionPage['items'][number][] } {
  switch (input.collection) {
    case 'entities': return { collection: 'entities', items: Object.values(state.entities)
      .filter(value => (input.phase === undefined || value.phase === input.phase)
        && (input.cognition === undefined || value.cognition === input.cognition))
      .sort(compareId).map(value => entitySummary(value, text)) }
    case 'decisions': return { collection: 'decisions', items: Object.values(state.decisions)
      .filter(value => (input.status === undefined || value.status === input.status)
        && (input.entityId === undefined || value.entityId === input.entityId))
      .sort((left, right) => compareDecimal(left.slot, right.slot)).map(decisionSummary) }
    case 'operations': return { collection: 'operations', items: Object.values(state.operations)
      .filter(value => (input.status === undefined || value.status === input.status)
        && (input.entityId === undefined || value.entityId === input.entityId)
        && (input.decisionId === undefined || value.decisionId === input.decisionId))
      .map((operation) => {
        const parent = state.decisions[operation.decisionId]
        if (parent === undefined) throw new Error('Simulation operation has no retained parent decision')
        return { operation, slot: parent.slot }
      }).sort((left, right) => compareDecimal(left.slot, right.slot) || left.operation.index - right.operation.index)
      .map(value => operationSummary(value.operation, text)) }
    case 'checkpoints': return { collection: 'checkpoints', items: Object.values(state.checkpoints ?? {})
      .filter(value => input.status === undefined || value.status === input.status)
      .sort((left, right) => left.startedSequence - right.startedSequence)
      .map(value => checkpointSummary(value, state)) }
    /* v8 ignore next -- The actor-free request parser admits only this closed collection union. */
    default: return assertNever(input)
  }
}

/**
 * Project one exact object section; unknown and other-run identities share absence.
 * @param input - Wire-validated object selector and requested section.
 * @param state - One detached validated native observation.
 * @param text - Deployment-bounded label projection.
 * @param page - Owner's bounded detail pagination and complete-wrapper accounting.
 * @param context - Current body-read permission and deployment-owned Unicode part allowance.
 * @returns safe section metadata, or undefined without probing other runs.
 */
export function objectDetail(input: SimulationProductObjectInput, state: SimulationSnapshot, text: Text,
  page: DetailPageBuilder, context: {
    allowed: boolean
    knowledge: boolean
    sources: boolean
    maxPartBytes: number
    readVersion: SimulationProductReadVersion }): SimulationProductObjectDetail | undefined {
  if (input.section === 'knowledge') return knowledgeDetail(input, state, text, page,
    { ...context, allowed: context.knowledge })
  switch (input.collection) {
    case 'entities': {
      const value = state.entities[input.id]
      if (value === undefined) return undefined
      if (input.section === 'relationships') {
        const rows = Object.values(state.relations)
          .filter(value => value.subject === input.id || value.object === input.id || value.scope === input.id)
          .sort(compareId).map(value => ({ id: value.id, subject: value.subject, object: value.object, relation: text(value.relation),
            ...value.scope === undefined ? {} : { scope: value.scope }, revision: value.revision,
            validFrom: value.validFrom, validUntil: value.validUntil, active: compareDecimal(value.validFrom, state.time) <= 0
              && (value.validUntil === null || compareDecimal(state.time, value.validUntil) < 0) }))
        return page(rows, relationships => ({ collection: 'entities', section: 'relationships', id: value.id, time: state.time, relationships }))
      }
      return { collection: 'entities', section: 'identity', id: value.id, summary: entitySummary(value, text),
        revision: value.revision, profileRevision: value.profileRevision,
        ...value.writer === undefined ? {} : { writerEpoch: value.writer.epoch },
        ...value.binding === undefined ? {} : { binding: { teamId: value.binding.teamId,
          participantId: value.binding.participantId, sessionId: value.binding.sessionId } } }
    }
    case 'decisions': {
      const value = state.decisions[input.id]
      if (value === undefined) return undefined
      if (input.section === 'context') {
        const rows = contextRows(value.context, text, context.allowed, context.maxPartBytes)
        return page(rows, items => ({ collection: 'decisions', section: 'context', id: value.id,
          readVersion: context.readVersion,
          accounting: contextSummary(value.context), bodyAccess: context.allowed ? 'allowed' : 'withheld',
          ...value.context?.status === 'prepared' ? { frozen: frozenContext(value.context, text) } : {}, items }))
      }
      return { collection: 'decisions', section: 'execution', id: value.id, summary: decisionSummary(value),
        context: contextSummary(value.context), ...value.inference === undefined ? {} : { inference: { startedAt: value.inference.startedAt,
          deadline: value.inference.deadline, ...value.inference.finishedAt === undefined ? {} : { finishedAt: value.inference.finishedAt },
          ...value.inference.expiredAt === undefined ? {} : { expiredAt: value.inference.expiredAt } } },
        ...value.closedAt === undefined ? {} : { closedAt: value.closedAt },
        ...value.cancellation === undefined ? {} : { cancellation: value.cancellation } }
    }
    case 'operations': {
      const value = state.operations[input.id]
      if (value === undefined) return undefined
      if (input.section === 'attempts') {
        const attempts = (value.outbox?.attempts ?? []).map(attempt => ({ number: attempt.number, startedAt: attempt.startedAt,
          outcome: attempt.outcome, ...attempt.finishedAt === undefined ? {} : { finishedAt: attempt.finishedAt } }))
        return page(attempts, attempts => ({ collection: 'operations', section: 'attempts', id: value.id, attempts }))
      }
      const nativeRetry = simulationOutboxRetryCapability(state, value.id)
      return { collection: 'operations', section: 'execution', id: value.id, summary: operationSummary(value, text),
        retry: nativeRetry.allowed ? { ...nativeRetry, allowed: false, reason: 'recovery-required' } : nativeRetry,
        dependencies: [...value.dependencies], ...value.result === undefined ? {} : { result: { status: value.result.status,
          time: value.result.time, sequence: value.result.sequence, code: text(value.result.code) } },
        ...value.outbox === undefined ? {} : { outbox: { ready: value.outbox.ready, attemptCount: value.outbox.attempts.length,
          ...value.outbox.nextAttemptAt === undefined ? {} : { nextAttemptAt: value.outbox.nextAttemptAt } } },
        ...value.outbox?.taskReceipt === undefined ? {} : { taskReference: { teamId: value.outbox.taskReceipt.teamId,
          taskId: value.outbox.taskReceipt.taskId } } }
    }
    case 'checkpoints': {
      const value = state.checkpoints?.[input.id]
      if (value === undefined) return undefined
      const references: SimulationProductCheckpointReference[] = []
      if (value.status === 'completed') {
        const manifest = value.manifest
        references.push({ kind: 'run', cursor: manifest.run.cursor },
          { kind: 'team', id: manifest.team.owner.teamId, cursor: manifest.team.cursor })
        const channels = [...manifest.channels]
          .sort((left, right) => compareId({ id: left.owner.channelId }, { id: right.owner.channelId }))
        for (const channel of channels) {
          references.push({ kind: 'channel', id: channel.owner.channelId, cursor: channel.cursor })
        }
        for (const session of [...manifest.sessions].sort((left, right) => compareId({ id: left.sessionId }, { id: right.sessionId }))) {
          references.push({ kind: 'session', id: session.sessionId, teamId: session.teamId, participantId: session.participantId,
            ...session.kind === 'unmaterialized' ? { materialization: 'unmaterialized' } : { materialization: 'materialized', sequence: session.sequence } })
        }
      }
      return page(references, references => ({ collection: 'checkpoints', section: 'references', id: value.request.id,
        summary: checkpointSummary(value, state), references, ...value.status === 'failed' ? { failure: 'details-withheld',
          ...value.diagnostic === undefined ? {} : { diagnostic: value.diagnostic } } : {} }))
    }
    /* v8 ignore next -- The actor-free request parser admits only this closed object union. */
    default: return assertNever(input)
  }
}

/** Public labels select only the explicit name field; arbitrary profile data remains private. */
function entitySummary(value: SimulationEntity, text: Text): SimulationProductEntitySummary {
  const name = value.participantReservation?.participant.displayName ?? value.profile['name']
  return { id: value.id, ...typeof name === 'string' ? { name: text(name) } : {}, kind: text(value.kind),
    phase: value.phase, cognition: value.cognition, writer: value.writer?.phase ?? 'none' }
}
/** Submission and acceptance do not assert business effects. */
function decisionSummary(value: SimulationDecision): SimulationProductDecisionSummary {
  return { id: value.id, entityId: value.entityId, slot: value.slot, time: value.time, snapshotRevision: value.snapshotRevision,
    status: value.status, operationCount: value.operationIds.length }
}
/** Keep publication, Session persistence, recipient receipt and task creation independently observable. */
function operationSummary(value: SimulationOperation, text: Text): SimulationProductOperationSummary {
  const communication = value.action.kind === 'communication/post'
  return { id: value.id, entityId: value.entityId, decisionId: value.decisionId, index: value.index,
    kind: text(value.action.kind), status: value.status,
    publication: !communication ? 'not-applicable' : value.outbox?.receipt === undefined ? 'pending' : 'published',
    delivery: !communication ? 'not-applicable' : value.delivery?.receipt !== undefined ? 'receipted'
      : value.delivery !== undefined || value.deliveryFailure?.resolution?.kind === 'retained-input' ? 'input-persisted' : 'pending',
    ...value.deliveryFailure === undefined ? {} : { deliveryFailure: value.deliveryFailure.resolution?.kind ?? 'unresolved' },
    task: value.action.kind !== 'task/create' ? 'not-applicable' : value.outbox?.taskReceipt === undefined ? 'pending' : 'created' }
}
/** Retained completion is separate from validating current cross-owner sources. */
function checkpointSummary(value: SimulationCheckpointOperation, state: SimulationSnapshot): SimulationProductCheckpointSummary {
  return { id: value.request.id, status: value.status, startedSequence: value.startedSequence,
    ...value.status === 'in-progress' ? {} : { finishedSequence: value.finishedSequence },
    ...value.status !== 'completed' ? {} : { time: value.manifest.state.time, publishedAt: value.publishedAt },
    latestSuccessful: value.request.id === state.latestCheckpointId, sourceValidation: 'not-performed' }
}
/** Context metadata is never labeled or returned as the full model-visible request. */
function contextSummary(value: SimulationContextPreparation | undefined): SimulationProductContextSummary {
  if (value === undefined) return { status: 'absent' }
  if (value.status === 'overflow') return { status: 'overflow', requiredBytes: value.requiredBytes, maxBytes: value.maxBytes }
  return { status: 'prepared', retainedBytes: value.retainedBytes, maxBytes: value.maxBytes, knowledgeCount: value.knowledge?.length ?? 0,
    sourceCount: value.view.sources.length, sectionCount: value.view.content.length, content: 'withheld' }
}
/** Stable ordinal identity ordering independent of locale. */
function compareId(left: { id: string }, right: { id: string }): number {
  /* v8 ignore next -- Native IDs are unique; equality serves a sort implementation comparing an item with itself. */
  if (left.id === right.id) return 0
  return left.id < right.id ? -1 : 1
}
/** Exact canonical decimal ordering does not pass through Number. */
function compareDecimal(left: string, right: string): number {
  return BigInt(left) < BigInt(right) ? -1 : BigInt(left) > BigInt(right) ? 1 : 0
}
/* v8 ignore next -- Both callers terminate wire-validated closed unions whose parsers reject other discriminants. */
function assertNever(value: never): never { throw new Error(`Unknown Simulation product collection: ${String(value)}`) }
