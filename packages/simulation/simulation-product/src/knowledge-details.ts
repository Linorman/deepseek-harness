/** Exact version reads share native temporal/ancestry visibility; disclosure grants never turn a belief into a world fact. */
import { knowledgeVisible, selectKnowledge } from '@clocky/clocky-simulation'
import type { SimulationSnapshot, SimulationKnowledge, SimulationEntityId } from '@clocky/clocky-simulation'
import type { SimulationProductObjectInput } from './collections-types.ts'
import type { SimulationProductKnowledgeDetail, SimulationProductKnowledgeItem, SimulationProductKnowledgeSource } from './knowledge-types.ts'
import type { SimulationProductReadVersion } from './watch-types.ts'
import type { SimulationProductText } from './types.ts'
import { splitText } from './context-details.ts'
import type { DetailPageBuilder } from './collections.ts'

/**
 * Project current knowledge or a decision's exact selected versions, under current audience and premise visibility.
 * @param input - Exact entity/decision section and optional selected frozen reference.
 * @param state - Validated native observation; no execution handle is acquired.
 * @param text - Bounded metadata display projection.
 * @param page - Complete-envelope page owner.
 * @param policy - Independent knowledge/source disclosure and original policy identity.
 * @returns an authorized knowledge window, or absence for an unrelated decision reference; hidden knowledge is not probed.
 */
export function knowledgeDetail(input: Extract<SimulationProductObjectInput, { section: 'knowledge' }>, state: SimulationSnapshot,
  text: (value: string) => SimulationProductText, page: DetailPageBuilder,
  policy: { allowed: boolean; sources: boolean; maxPartBytes: number; readVersion: SimulationProductReadVersion }):
SimulationProductKnowledgeDetail | undefined {
  const decision = input.collection === 'decisions' ? state.decisions[input.id] : undefined
  const entityId = input.collection === 'entities' ? input.id : decision?.entityId
  if (entityId === undefined || state.entities[entityId] === undefined || input.collection === 'decisions' && decision === undefined) return undefined
  const selected = input.collection === 'decisions' ? input.reference : undefined
  const frozen = decision?.context?.status === 'prepared' ? decision.context.knowledge ?? [] : []
  if (selected !== undefined && !frozen.some(ref => ref.id === selected.id && ref.revision === selected.revision)) return undefined
  const time = decision?.time ?? state.time, cutoffRevision = decision?.snapshotRevision ?? state.revision
  const base = { collection: input.collection, section: 'knowledge' as const, id: input.id, entityId, time, cutoffRevision,
    readVersion: policy.readVersion, bodyAccess: policy.allowed ? 'allowed' as const : 'withheld' as const,
    ...selected === undefined ? {} : { selected } }
  const values: SimulationKnowledge[] = []
  if (policy.allowed && state.entities[entityId].phase === 'active') {
    const query = { viewer: entityId, cursor: cutoffRevision, time, limit: 1 }
    if (input.collection === 'decisions') {
      for (const ref of selected === undefined ? frozen : [selected]) {
        if (!knowledgeVisible(state, ref, query)) continue
        const value = state.knowledge?.[ref.id]?.[ref.revision - 1]
        if (value !== undefined) values.push(value)
      }
    } else {
      // Each native selection remains bounded; the Host scans its already-bounded observation to derive the filtered total.
      for (const id of Object.keys(state.knowledge ?? {}).sort()) {
        values.push(...selectKnowledge(state, { ...query, ids: [id as SimulationKnowledge['id']] }))
      }
    }
  }
  const rows: SimulationProductKnowledgeItem[] = values.flatMap((value) => {
    const parts = splitText(value.statement, policy.maxPartBytes)
    return parts.map((part, ordinal) => {
      const body = { status: 'text' as const, text: part, part: ordinal, parts: parts.length }
      return { reference: { id: value.id, revision: value.revision }, owner: value.owner,
        observedAt: value.observedAt, availableAt: value.availableAt, validFrom: value.validFrom, validUntil: value.validUntil,
        sequence: value.sequence, body, source: source(value, entityId, state, text, policy.sources, body),
        premises: value.source.kind === 'inference' || value.source.kind === 'summary' ? value.source.premises : [] }
    })
  })
  return page(rows, knowledge => ({ ...base, knowledge }))
}

function source(value: SimulationKnowledge, viewer: SimulationEntityId, state: SimulationSnapshot,
  text: (value: string) => SimulationProductText, allowed: boolean,
  body: Extract<SimulationProductKnowledgeItem['body'], { status: 'text' }>): SimulationProductKnowledgeSource {
  const origin = value.source
  switch (origin.kind) {
    case 'observation': return { kind: origin.kind, worldRevision: origin.worldRevision, visibilityPolicy: text(origin.visibilityPolicy) }
    case 'belief': return { kind: origin.kind, profileRevision: origin.profileRevision, policyVersion: text(origin.policyVersion),
      ...origin.confidence === undefined ? {} : { confidence: origin.confidence } }
    case 'inference': return { kind: origin.kind, decisionId: origin.decisionId,
      ...origin.confidence === undefined ? {} : { confidence: origin.confidence } }
    case 'summary': return { kind: origin.kind, cursor: origin.cursor, policy: text(origin.policy.id), policyVersion: text(origin.policy.version) }
    case 'report': {
      const operation = state.operations[origin.operationId]
      const retained = operation?.action.kind === 'communication/post' && operation.action.recipient === value.owner
        && operation.delivery?.receipt !== undefined && operation.action.text === value.statement
        && (value.owner === viewer || value.readers.includes(viewer))
      return { kind: origin.kind, operationId: origin.operationId,
        body: !allowed ? { status: 'withheld' } : !retained ? { status: 'unsupported' } : body }
    }
    default: return assertNever(origin)
  }
}
function assertNever(value: never): never { throw new Error(`Unhandled knowledge origin: ${String(value)}`) }
