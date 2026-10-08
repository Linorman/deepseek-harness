/** View-only selection, committed URL filters and scroll positions; business data lives in runtime. */
import { defineStore } from '@clocky/clocky-client-runtime/client'
import type { EngineStoreHandle, SimulationCommandKey, SimulationProductRunId } from '@clocky/clocky-client-runtime/client'
import { normalize } from './selection.ts'

/** Simulation modules supported by the read-only product page. */
export type Module = 'overview' | 'entities' | 'decisions' | 'operations' | 'checkpoints' | 'records' | 'requests'
/** View-only deep-link state contains no credentials or body text. */
export interface Route {
  runId?: string | undefined
  module: Module
  search: string
  objectId?: string | undefined
  recordKind?: string | undefined
  recordSequence?: number | undefined
  status?: string | undefined
  cognition?: 'none' | 'agent' | undefined
  entityId?: string | undefined
  decisionId?: string | undefined
  section?: 'attempts' | 'relationships' | 'context' | 'knowledge' | undefined
  /** Collection modules: `visual` shows the world, timeline, effects, or checkpoint view instead of the table. */
  display?: 'visual' | undefined
  sourceIndex?: number | undefined
  knowledgeId?: string | undefined
  knowledgeRevision?: number | undefined
}
const modules: Module[] = ['overview', 'entities', 'decisions', 'operations', 'checkpoints', 'records', 'requests']
/** Parse view-only navigation from the current URL.
 * @returns current safe selection; unsupported module values select the overview.
 */
export function route(): Route {
  const query = new URLSearchParams(window.location.search)
  const module = query.get('simulationModule')
  return normalize({ runId: query.get('simulation') ?? undefined, module: modules.includes(module as Module) ? module as Module : 'overview',
    search: query.get('simulationSearch') ?? '', objectId: query.get('simulationObject') ?? undefined,
    recordKind: query.get('simulationRecordKind') ?? undefined,
    recordSequence: query.get('simulationSequence')?.match(/^(0|[1-9][0-9]*)$/) ? Number(query.get('simulationSequence')) : undefined,
    status: query.get('simulationStatus') ?? undefined, cognition: query.get('simulationCognition') as Route['cognition'],
    entityId: query.get('simulationEntity') ?? undefined, decisionId: query.get('simulationDecision') ?? undefined,
    section: query.get('simulationSection') as Route['section'],
    sourceIndex: query.get('simulationSource')?.match(/^(0|[1-9][0-9]*)$/) ? Number(query.get('simulationSource')) : undefined, knowledgeId: query.get('simulationKnowledge') ?? undefined,
    knowledgeRevision: query.get('simulationKnowledgeRevision')?.match(/^[1-9][0-9]*$/) ? Number(query.get('simulationKnowledgeRevision')) : undefined,
    display: query.get('simulationDisplay') === 'visual' ? 'visual' : undefined })
}
/** Write only safe viewing identifiers and committed search to browser history.
 * @param next - View selection without private input.
 * @param push - Whether this creates a browser-history entry.
 */
export function writeRoute(next: Route, push = true): void {
  const url = routeUrl(next)
  if (url.href === window.location.href) return
  if (push) window.history.pushState(null, '', url)
  else window.history.replaceState(null, '', url)
}
/** Build the same-document URL for a view selection, keeping unrelated parameters.
 * @param next - View selection without private input.
 * @returns the URL `writeRoute` would commit.
 */
export function routeUrl(next: Route): URL {
  next = normalize(next)
  const url = new URL(window.location.href)
  url.searchParams.set('workspace', 'simulation')
  for (const [key, value] of [['simulation', next.runId], ['simulationModule', next.module === 'overview' ? undefined : next.module],
    ['simulationSearch', next.search || undefined], ['simulationObject', next.objectId], ['simulationStatus', next.status],
    ['simulationCognition', next.cognition], ['simulationEntity', next.entityId], ['simulationDecision', next.decisionId],
    ['simulationRecordKind', next.recordKind], ['simulationSequence', next.recordSequence?.toString()],
    ['simulationSource', next.sourceIndex?.toString()], ['simulationSection', next.section], ['simulationKnowledge', next.knowledgeId],
    ['simulationKnowledgeRevision', next.knowledgeRevision?.toString()], ['simulationDisplay', next.display]] as const) {
    if (value === undefined) url.searchParams.delete(key)
    else url.searchParams.set(key, value)
  }
  return url
}
/** Raw create input and its selected original operation; business receipts live only in runtime. */
export interface SimulationCreationDraft {
  readonly templateId: string
  readonly name: string
  readonly buyerName: string
  readonly supplierName: string
  readonly initialStock: string
  /** Blank overrides select installed defaults; only Host-advertised limit keys are submitted. */
  readonly limits?: Partial<Record<keyof import('@clocky/clocky-client-runtime/client').SimulationProductLimits, string>> | undefined
  readonly commandKey?: SimulationCommandKey | undefined
  /** Re-run read-only validation after returning from model setup; never resubmit automatically. */
  readonly recheckAfterModelSetup?: true | undefined
}
/** Initial form contains no invented deployment configuration. */
export const EMPTY_CREATION: SimulationCreationDraft = { templateId: '', name: '', buyerName: '', supplierName: '', initialStock: '' }
/** Raw entity input remains separate from its immutable submitted command. */
export interface SimulationInputDraft {
  readonly entityId: string
  readonly text: string
  readonly availableAt: string
  readonly commandKey?: SimulationCommandKey | undefined
}
/** Initial input has no implicit recipient or broadcast. */
export const EMPTY_INPUT: SimulationInputDraft = { entityId: '', text: '', availableAt: '' }
/** Private review input remains tied to the original operation and attempt across navigation. */
export interface SimulationReviewDraft {
  readonly runId: SimulationProductRunId
  readonly operationId: string
  readonly attemptId: string
  readonly expectedRevision: number
  readonly reason: string
  readonly nextPhase: 'completed' | 'pending'
  readonly commandKey?: SimulationCommandKey | undefined
  /** Raw input captured before submission; normalized commands cannot identify later whitespace edits. */
  readonly submitted?: { readonly reason: string; readonly nextPhase: 'completed' | 'pending'; readonly expectedRevision: number } | undefined
}
/** Exact dialog target; no draft text enters navigation URLs. */
export type SimulationReviewTarget = Pick<SimulationReviewDraft, 'runId' | 'operationId' | 'attemptId'>
/** Derive a collision-free form slot without including private authored text.
 * @param target - Exact run, source operation and original attempt.
 * @returns the private-input-free viewing key.
 */
export function reviewDraftKey(target: SimulationReviewTarget): string {
  return JSON.stringify([target.runId, target.operationId, target.attemptId])
}
/** Raw external-operation retry intent; granting allowance never publishes the target effect. */
export interface SimulationOperationRetryDraft {
  readonly runId: SimulationProductRunId
  readonly operationId: string
  readonly expectedAttemptCount: number
  readonly reason: string
  readonly commandKey?: SimulationCommandKey | undefined
  readonly submitted?: { readonly reason: string; readonly expectedAttemptCount: number } | undefined
}
/** Exact private-form target; submitted text stays only in its bounded draft slot. */
export type SimulationOperationRetryTarget = Pick<SimulationOperationRetryDraft, 'runId' | 'operationId'>
/** Derive the original operation's private form slot without body text.
 * @param target - Exact registered run and operation.
 * @returns collision-free viewing identity.
 */
export function operationRetryDraftKey(target: SimulationOperationRetryTarget): string {
  return JSON.stringify([target.runId, target.operationId])
}
/** Raw cancellation reason and exact canonical selection; original outcomes stay in runtime. */
export interface SimulationTaskCancelDraft {
  readonly runId: SimulationProductRunId
  readonly operationId: string
  readonly expectedRevision: number
  readonly expectedAttemptId: import('@clocky/clocky-client-runtime/client').SimulationProductTaskCancelInput['expectedAttemptId']
  readonly reason: string
  readonly commandKey?: SimulationCommandKey | undefined
  readonly submitted?: {
    readonly reason: string
    readonly expectedRevision: number
    readonly expectedAttemptId: SimulationTaskCancelDraft['expectedAttemptId']
  } | undefined
}
/** Collision-free viewing selector omits private authored reason.
 * @param target - Exact run and accepted source operation.
 * @returns stable form slot without reason, revision or private task content.
 */
export function taskCancelDraftKey(target: Pick<SimulationTaskCancelDraft, 'runId' | 'operationId'>): string {
  return JSON.stringify([target.runId, target.operationId])
}
/** View-only administrative dialog selection. */
export interface SimulationMaintenanceTarget { readonly runId: SimulationProductRunId; readonly kind: 'checkpoint' | 'restore' | 'prepare' | 'ingress'; readonly commandKey?: SimulationCommandKey | undefined }
type State = Route & {
  authorizationVersion: number
  creation?: SimulationCreationDraft | undefined
  creating: boolean
  maintenance?: SimulationMaintenanceTarget | undefined
  inputDrafts: Record<string, SimulationInputDraft>
  reviewDrafts: Record<string, SimulationReviewDraft>
  reviewTarget?: SimulationReviewTarget | undefined
  operationRetryDrafts: Record<string, SimulationOperationRetryDraft>
  operationRetryTarget?: SimulationOperationRetryTarget | undefined
  cancelDrafts: Record<string, SimulationTaskCancelDraft>
  cancelTarget?: Pick<SimulationTaskCancelDraft, 'runId' | 'operationId'> | undefined
  draftCapacity: boolean
  active: boolean
  draftSearch: string
  directoryScroll: number
  collectionScroll: number
}
type Actions = {
  cancel: (draft: State, key: string, value?: SimulationTaskCancelDraft) => void
  cancelTarget: (draft: State, target?: Pick<SimulationTaskCancelDraft, 'runId' | 'operationId'>) => void
  authorization: (draft: State, version: number) => void
  creating: (draft: State, open: boolean) => void
  maintenance: (draft: State, target?: SimulationMaintenanceTarget) => void
  operationRetry: (draft: State, key: string, value?: SimulationOperationRetryDraft) => void
  operationRetryTarget: (draft: State, target?: SimulationOperationRetryTarget) => void
  review: (draft: State, key: string, value?: SimulationReviewDraft) => void
  reviewTarget: (draft: State, target?: SimulationReviewTarget) => void
  input: (draft: State, runId: SimulationProductRunId, value?: SimulationInputDraft) => void
  creation: (draft: State, value?: SimulationCreationDraft) => void

  active: (draft: State, active: boolean) => void
  restore: (draft: State, next: Route) => void
  searchDraft: (draft: State, value: string) => void
  search: (draft: State, value: string) => void
  open: (draft: State, runId?: string) => void
  module: (draft: State, module: Module) => void
  object: (draft: State, objectId?: string) => void
  scroll: (draft: State, target: 'directory' | 'collection', value: number) => void
}
/** Create an independent view store for this plugin's registered entries.
 * @param maxDraftBytes - Complete UTF-8 retained draft allowance.
 * @param maxInputDrafts - Maximum retained entity-input and exact-attempt review drafts, including submitted selectors.
 * @returns one per-apply store shared by navigation and workspace, without business responses.
 */
export function createSimulationStore(maxDraftBytes: number, maxInputDrafts: number): EngineStoreHandle<State, Actions> {
  return defineStore({ init: () => ({ ...route(), authorizationVersion: -1, creating: false, inputDrafts: {}, reviewDrafts: {},
    operationRetryDrafts: {}, cancelDrafts: {},
    draftCapacity: false,
    active: false, draftSearch: route().search, directoryScroll: 0, collectionScroll: 0 }),
  actions: {
    cancelTarget: (d, target?: Pick<SimulationTaskCancelDraft, 'runId' | 'operationId'>) => {
      d.cancelTarget = target === undefined ? undefined : { runId: target.runId, operationId: target.operationId }
    },
    cancel: (d, key: string, value?: SimulationTaskCancelDraft) => {
      const { [key]: _old, ...retained } = d.cancelDrafts
      const next = value === undefined ? retained : { ...retained, [key]: value }
      if (Object.keys(next).length + Object.keys(d.inputDrafts).length + Object.keys(d.reviewDrafts).length
        + Object.keys(d.operationRetryDrafts).length > maxInputDrafts
        || new TextEncoder().encode(JSON.stringify({ creation: d.creation, inputDrafts: d.inputDrafts,
          reviewDrafts: d.reviewDrafts, operationRetryDrafts: d.operationRetryDrafts, cancelDrafts: next })).byteLength > maxDraftBytes) {
        throw new Error('Simulation retained draft capacity is occupied')
      }
      d.cancelDrafts = next
    },
    authorization: (d, version: number) => {
      if (d.authorizationVersion === version) return
      d.authorizationVersion = version; d.creation = undefined; d.creating = false
      d.operationRetryDrafts = {}; d.operationRetryTarget = undefined; d.cancelDrafts = {}; d.cancelTarget = undefined
      d.maintenance = undefined; d.inputDrafts = {}; d.reviewDrafts = {}; d.reviewTarget = undefined; d.draftCapacity = false
    },
    operationRetryTarget: (d, target?: SimulationOperationRetryTarget) => {
      d.operationRetryTarget = target === undefined ? undefined : { runId: target.runId, operationId: target.operationId }
    },
    operationRetry: (d, key: string, value?: SimulationOperationRetryDraft) => {
      const { [key]: _old, ...retained } = d.operationRetryDrafts
      const next = value === undefined ? retained : { ...retained, [key]: value }
      if (Object.keys(next).length + Object.keys(d.inputDrafts).length + Object.keys(d.reviewDrafts).length
        + Object.keys(d.cancelDrafts).length > maxInputDrafts
        || new TextEncoder().encode(JSON.stringify({ creation: d.creation, inputDrafts: d.inputDrafts,
          reviewDrafts: d.reviewDrafts, operationRetryDrafts: next, cancelDrafts: d.cancelDrafts })).byteLength > maxDraftBytes) {
        throw new Error('Simulation retained draft capacity is occupied')
      }
      d.operationRetryDrafts = next
    },
    reviewTarget: (d, target?: SimulationReviewTarget) => {
      d.reviewTarget = target === undefined ? undefined
        : { runId: target.runId, operationId: target.operationId, attemptId: target.attemptId }
    },
    review: (d, key: string, value?: SimulationReviewDraft) => {
      const { [key]: _old, ...retained } = d.reviewDrafts
      const next = value === undefined ? retained : { ...retained, [key]: value }
      if (Object.keys(next).length + Object.keys(d.inputDrafts).length + Object.keys(d.operationRetryDrafts).length
        + Object.keys(d.cancelDrafts).length > maxInputDrafts
        || new TextEncoder().encode(JSON.stringify({ creation: d.creation, inputDrafts: d.inputDrafts, reviewDrafts: next,
          operationRetryDrafts: d.operationRetryDrafts, cancelDrafts: d.cancelDrafts })).byteLength
          > maxDraftBytes) throw new Error('Simulation retained draft capacity is occupied')
      d.reviewDrafts = next
    },
    maintenance: (d, target?: SimulationMaintenanceTarget) => { d.maintenance = target },
    input: (d, runId: SimulationProductRunId, value?: SimulationInputDraft) => {
      const { [runId]: _previous, ...retained } = d.inputDrafts
      const next = value === undefined ? retained : { ...retained, [runId]: value }
      if (Object.keys(next).length + Object.keys(d.reviewDrafts).length + Object.keys(d.operationRetryDrafts).length
        + Object.keys(d.cancelDrafts).length > maxInputDrafts
        || new TextEncoder().encode(JSON.stringify({ creation: d.creation, inputDrafts: next, reviewDrafts: d.reviewDrafts,
          operationRetryDrafts: d.operationRetryDrafts, cancelDrafts: d.cancelDrafts })).byteLength
          > maxDraftBytes) {
        throw new Error('Simulation retained draft capacity is occupied')
      }
      d.inputDrafts = next; d.draftCapacity = false
    },
    creating: (d, open: boolean) => { d.creating = open },
    creation: (d, value?: SimulationCreationDraft) => {
      if (value !== undefined && new TextEncoder().encode(JSON.stringify({ creation: value, inputDrafts: d.inputDrafts,
        reviewDrafts: d.reviewDrafts, operationRetryDrafts: d.operationRetryDrafts, cancelDrafts: d.cancelDrafts })).byteLength
        > maxDraftBytes) {
        throw new Error('Simulation retained draft capacity is occupied')
      }
      d.creation = value; d.draftCapacity = false
    },
    active: (d, active: boolean) => { d.active = active },
    restore: (d, next: Route) => {
      next = normalize(next)
      if (d.runId !== next.runId || d.module !== next.module || d.status !== next.status || d.cognition !== next.cognition
        || d.entityId !== next.entityId || d.decisionId !== next.decisionId) d.collectionScroll = 0
      if (d.search !== next.search) d.directoryScroll = 0
      d.recordKind = next.recordKind; d.recordSequence = next.recordSequence
      d.runId = next.runId; d.module = next.module; d.search = next.search
      d.objectId = next.objectId; d.draftSearch = next.search
      d.status = next.status; d.cognition = next.cognition; d.entityId = next.entityId
      d.decisionId = next.decisionId; d.section = next.section
      d.sourceIndex = next.sourceIndex
      d.knowledgeId = next.knowledgeId; d.knowledgeRevision = next.knowledgeRevision
      d.display = next.display
    },
    searchDraft: (d, value: string) => { d.draftSearch = value },
    search: (d, value: string) => { d.search = value; d.draftSearch = value; d.directoryScroll = 0 },
    open: (d, runId?: string) => { d.runId = runId; d.module = 'overview'; d.objectId = undefined
      d.status = undefined; d.cognition = undefined; d.entityId = undefined; d.decisionId = undefined; d.section = undefined },
    module: (d, module: Module) => { d.module = module; d.objectId = undefined; d.collectionScroll = 0
      d.status = undefined; d.cognition = undefined; d.entityId = undefined; d.decisionId = undefined; d.section = undefined },
    object: (d, objectId?: string) => { d.objectId = objectId; d.section = undefined },
    scroll: (d, target: 'directory' | 'collection', value: number) => {
      if (target === 'directory') d.directoryScroll = value
      else d.collectionScroll = value
    },
  } })
}
