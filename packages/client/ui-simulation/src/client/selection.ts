/** Safe URL selectors map to existing bounded Host queries; no private input is retained here. */
import type { SimulationProductBrowseInput, SimulationProductObjectInput, SimulationProductRunId } from '@clocky/clocky-client-runtime/client'
import type { Module, Route } from './store.ts'
type Collection = SimulationProductBrowseInput['collection']
type PageOf<C extends Collection> = Extract<SimulationProductBrowseInput, { collection: C }>
type ObjectOf<C extends Collection> = Extract<SimulationProductObjectInput, { collection: C }>

/** Host-supported metadata status filters, used only for viewing. Writes still require Host capabilities. */
export const statuses = {
  cases: ['open', 'cancel-requested', 'cancelled', 'rejected', 'committed'], records: [], requests: [], overview: [], entities: ['active', 'inactive', 'terminated'], decisions: ['open', 'submitted', 'accepted', 'cancelled'],
  operations: ['pending', 'applied', 'rejected', 'blocked-authority', 'blocked-dependency', 'outcome-unknown'],
  checkpoints: ['in-progress', 'failed', 'completed'],
  organization: ['handoff-required', 'retirement-unconfirmed'], governance: [], external: [],
} as const
const LENSES: Partial<Record<Module, readonly string[]>> = {
  organization: ['structure', 'timeline', 'people'], governance: ['proposals', 'norms', 'history'],
}
const WORLD_SECTIONS: Partial<Record<Module, readonly string[]>> = {
  organization: ['identity', 'tenure', 'obligations', 'actions'], governance: ['record', 'electorate', 'votes', 'impact'], external: ['identity', 'facts', 'representative', 'interactions'],
}

/**
 * Drop unsupported or cross-module URL selectors before issuing a query.
 * @param view - Untrusted viewing identifiers parsed from a URL or supplied by navigation.
 * @returns only selectors meaningful to the selected module.
 */
export function normalize(view: Route): Route {
  const allowed: readonly string[] = statuses[view.module]
  // Each numeric assertion below follows Number.isSafeInteger: undefined and
  // non-numbers are rejected before the comparison, including zero ordinals.
  const collectionModule = view.module === 'entities' || view.module === 'decisions' || view.module === 'operations' || view.module === 'checkpoints'
  const lenses = LENSES[view.module], worldSections = WORLD_SECTIONS[view.module]
  return { caseSection: view.module === 'cases' && view.objectId !== undefined
    ? (['request', 'plans', 'execution', 'notification', 'evidence', 'source'].includes(view.caseSection ?? '') ? view.caseSection : 'request') : undefined,
  lens: lenses === undefined ? undefined : lenses.includes(view.lens ?? '') ? view.lens : lenses[0],
  at: (view.module === 'organization' || view.module === 'governance') && /^(0|[1-9][0-9]*)$/.test(view.at ?? '') ? view.at : undefined,
  author: view.runId === undefined && /^[A-Za-z0-9-]{1,64}$/.test(view.author ?? '') ? view.author : undefined,
  domain: view.module === 'cases' && view.domain !== undefined && view.domain.length > 0 && view.domain.length <= 128 ? view.domain : undefined,
  needsAction: view.module === 'cases' && view.needsAction === true ? true : undefined,
  worldSection: worldSections !== undefined && view.objectId !== undefined && worldSections.includes(view.worldSection ?? '') ? view.worldSection : undefined, display: collectionModule && view.display === 'visual' ? 'visual' : undefined, runId: view.runId, module: view.module, search: view.search, objectId: view.module === 'records' || view.module === 'requests' ? undefined : view.objectId,
  recordKind: view.module === 'records' && view.recordKind !== undefined && view.recordKind.length <= 128 ? view.recordKind || undefined : undefined,
  recordSequence: view.module === 'records' && Number.isSafeInteger(view.recordSequence) && (view.recordSequence as number) >= 0 ? view.recordSequence : undefined,
  status: view.status !== undefined && allowed.includes(view.status) ? view.status : undefined,
  cognition: view.module === 'entities' && (view.cognition === 'none' || view.cognition === 'agent') ? view.cognition : undefined,
  entityId: view.module === 'decisions' || view.module === 'operations' ? view.entityId : undefined,
  decisionId: view.module === 'operations' ? view.decisionId : undefined,
  sourceIndex: view.module === 'decisions' && view.section === 'context' && view.objectId !== undefined
      && Number.isSafeInteger(view.sourceIndex) && (view.sourceIndex as number) >= 0 ? view.sourceIndex : undefined,
  knowledgeId: view.module === 'decisions' && view.section === 'knowledge' && Number.isSafeInteger(view.knowledgeRevision)
      && (view.knowledgeRevision as number) > 0 ? view.knowledgeId : undefined,
  knowledgeRevision: view.module === 'decisions' && view.section === 'knowledge' && view.knowledgeId !== undefined
      && Number.isSafeInteger(view.knowledgeRevision) && (view.knowledgeRevision as number) > 0 ? view.knowledgeRevision : undefined,
  section: view.objectId === undefined ? undefined
    : (view.module === 'entities' || view.module === 'decisions') && view.section === 'knowledge' ? 'knowledge'
      : view.module === 'operations' && view.section === 'attempts' ? 'attempts'
        : view.module === 'entities' && view.section === 'relationships' ? 'relationships'
          : view.module === 'decisions' && view.section === 'context' ? 'context' : undefined }
}

/**
 * Build one bounded collection query, preserving committed filters on next-page reads.
 * @param view - Viewing state with an exact run and collection.
 * @param limit - Deployment-owned page allowance.
 * @returns the existing collection DTO; overview is not a collection.
 */
export function collectionInput(view: Route & { runId: string; module: Exclude<Module, 'overview' | 'records' | 'requests' | 'cases' | 'organization' | 'governance' | 'external'> }, limit: number): SimulationProductBrowseInput {
  const selected = normalize(view)
  const base = { runId: view.runId as SimulationProductRunId, limit }
  switch (view.module) {
    case 'entities': return { ...base, collection: 'entities',
      phase: selected.status as PageOf<'entities'>['phase'], cognition: selected.cognition }
    case 'decisions': return { ...base, collection: 'decisions',
      status: selected.status as PageOf<'decisions'>['status'],
      entityId: selected.entityId as PageOf<'decisions'>['entityId'] }
    case 'operations': return { ...base, collection: 'operations',
      status: selected.status as PageOf<'operations'>['status'],
      entityId: selected.entityId as PageOf<'decisions'>['entityId'],
      decisionId: selected.decisionId as PageOf<'operations'>['decisionId'] }
    case 'checkpoints': return { ...base, collection: 'checkpoints', status: selected.status as PageOf<'checkpoints'>['status'] }
    default: return assertNever(view.module)
  }
}

/**
 * Build the exact section selected by a deep link, independent of the current list page.
 * @param view - Viewing state with an exact run, object and collection.
 * @param limit - Page allowance for attempts and checkpoint references.
 * @returns one metadata section; only collection-bearing sections receive a limit.
 */
export function objectInput(view: Route & { runId: string; objectId: string; module: Exclude<Module, 'overview' | 'records' | 'requests' | 'cases' | 'organization' | 'governance' | 'external'> }, limit: number): SimulationProductObjectInput {
  const base = { runId: view.runId as SimulationProductRunId }
  switch (view.module) {
    case 'entities': return view.section === 'knowledge'
      ? { ...base, collection: 'entities', id: view.objectId as ObjectOf<'entities'>['id'], section: 'knowledge', limit }
      : view.section === 'relationships'
        ? { ...base, collection: 'entities', id: view.objectId as ObjectOf<'entities'>['id'], section: 'relationships', limit }
        : { ...base, collection: 'entities', id: view.objectId as ObjectOf<'entities'>['id'], section: 'identity' }
    case 'decisions': return view.section === 'knowledge'
      ? { ...base, collection: 'decisions', id: view.objectId as ObjectOf<'decisions'>['id'], section: 'knowledge', limit,
        ...view.knowledgeId !== undefined && view.knowledgeRevision !== undefined ? { reference: {
          id: view.knowledgeId as import('@clocky/clocky-client-runtime/client').SimulationProductKnowledgeRef['id'], revision: view.knowledgeRevision } } : {} }
      : view.section === 'context'
        ? { ...base, collection: 'decisions', id: view.objectId as ObjectOf<'decisions'>['id'], section: 'context', limit }
        : { ...base, collection: 'decisions', id: view.objectId as ObjectOf<'decisions'>['id'], section: 'execution' }
    case 'operations': return view.section === 'attempts' ? { ...base, collection: 'operations', id: view.objectId as ObjectOf<'operations'>['id'], section: 'attempts', limit }
      : { ...base, collection: 'operations', id: view.objectId as ObjectOf<'operations'>['id'], section: 'execution' }
    case 'checkpoints': return { ...base, collection: 'checkpoints',
      id: view.objectId as ObjectOf<'checkpoints'>['id'], section: 'references', limit }
    default: return assertNever(view.module)
  }
}

function assertNever(value: never): never { throw new Error(`Unhandled Simulation collection: ${String(value)}`) }
