/** View-only selection, committed URL filters and scroll positions; business data lives in runtime. */
import { defineStore } from '@clocky/clocky-client-runtime/client'
import type { EngineStoreHandle, SimulationCommandKey, SimulationProductRunId } from '@clocky/clocky-client-runtime/client'
import { normalize } from './selection.ts'
import { draftBytes } from './world-draft.ts'
import type { WorldAuthorDraft } from './world-draft.ts'
import type { WorldActionKind } from './world-domain.ts'

/** Simulation modules supported by the read-only product page. */
export type Module = 'overview' | 'entities' | 'decisions' | 'operations' | 'checkpoints' | 'records' | 'requests' | 'cases'
  | 'organization' | 'governance' | 'external'
/** Modules in the primary row of a World run; History (`records`) is first-level because it is the main audit entry. */
export const WORLD_MODULES = ['overview', 'cases', 'organization', 'governance', 'external', 'records'] as const satisfies readonly Module[]
/** Engine modules collected under the Diagnostics menu of a World run; route IDs are unchanged. */
export const ENGINE_MODULES = ['entities', 'decisions', 'operations', 'checkpoints', 'requests'] as const satisfies readonly Module[]
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
  caseSection?: 'request' | 'plans' | 'execution' | 'notification' | 'evidence' | 'source' | undefined
  /** World module lens (`structure`/`timeline`/`people`, `proposals`/`norms`/`history`). */
  lens?: string | undefined
  /** Committed decimal viewing time for organization and governance; absent means latest. */
  at?: string | undefined
  /** Opaque authoring slot; the draft body stays in memory only. */
  author?: string | undefined
  /** Installed domain filter for World matters. */
  domain?: string | undefined
  /** Matters filter: only cases needing action. */
  needsAction?: true | undefined
  /** World inspector section (person or external identity). */
  worldSection?: string | undefined
  section?: 'attempts' | 'relationships' | 'context' | 'knowledge' | undefined
  /** Collection modules: `visual` shows the world, timeline, effects, or checkpoint view instead of the table. */
  display?: 'visual' | undefined
  sourceIndex?: number | undefined
  knowledgeId?: string | undefined
  knowledgeRevision?: number | undefined
}
const modules: Module[] = ['overview', 'entities', 'decisions', 'operations', 'checkpoints', 'records', 'requests', 'cases',
  'organization', 'governance', 'external']
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
    caseSection: query.get('simulationCaseSection') as Route['caseSection'],
    section: query.get('simulationSection') as Route['section'],
    sourceIndex: query.get('simulationSource')?.match(/^(0|[1-9][0-9]*)$/) ? Number(query.get('simulationSource')) : undefined, knowledgeId: query.get('simulationKnowledge') ?? undefined,
    knowledgeRevision: query.get('simulationKnowledgeRevision')?.match(/^[1-9][0-9]*$/) ? Number(query.get('simulationKnowledgeRevision')) : undefined,
    display: query.get('simulationDisplay') === 'visual' ? 'visual' : undefined,
    lens: query.get('simulationLens') ?? undefined, at: query.get('simulationAt') ?? undefined,
    author: query.get('simulationAuthor') ?? undefined, domain: query.get('simulationDomain') ?? undefined,
    needsAction: query.get('simulationNeedsAction') === '1' ? true : undefined,
    worldSection: query.get('simulationWorldSection') ?? undefined })
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
    ['simulationCaseSection', next.caseSection], ['simulationSource', next.sourceIndex?.toString()], ['simulationSection', next.section], ['simulationKnowledge', next.knowledgeId],
    ['simulationKnowledgeRevision', next.knowledgeRevision?.toString()], ['simulationDisplay', next.display],
    ['simulationLens', next.lens], ['simulationAt', next.at], ['simulationAuthor', next.author], ['simulationDomain', next.domain],
    ['simulationNeedsAction', next.needsAction === true ? '1' : undefined], ['simulationWorldSection', next.worldSection]] as const) {
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
/** Raw portable JSON and its immutable submitted original; execution facts remain in runtime. */
export interface SimulationWorldCreationDraft {
  readonly fileName?: string | undefined
  readonly name: string
  readonly json: string
  readonly commandKey?: SimulationCommandKey | undefined
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
/** Retained management-flow input for one World action; the original command, once retained, lives in runtime. */
export interface SimulationWorldActionDraft {
  readonly runId: SimulationProductRunId
  readonly action: WorldActionKind
  readonly targetId: string
  readonly target: string
  readonly expectedRevision: number
  readonly values: Readonly<Record<string, string>>
  /** Closing hides the flow but keeps its input; an explicit resume reopens it. */
  readonly open: boolean
  readonly commandKey?: SimulationCommandKey | undefined
}
/** View-only administrative dialog selection. */
export interface SimulationMaintenanceTarget { readonly runId: SimulationProductRunId; readonly kind: 'checkpoint' | 'restore' | 'prepare' | 'ingress'; readonly commandKey?: SimulationCommandKey | undefined }
type State = Route & {
  authorizationVersion: number
  creation?: SimulationCreationDraft | undefined
  creating: boolean
  creatingWorld: boolean
  worldCreation?: SimulationWorldCreationDraft | undefined
  maintenance?: SimulationMaintenanceTarget | undefined
  inputDrafts: Record<string, SimulationInputDraft>
  reviewDrafts: Record<string, SimulationReviewDraft>
  reviewTarget?: SimulationReviewTarget | undefined
  operationRetryDrafts: Record<string, SimulationOperationRetryDraft>
  operationRetryTarget?: SimulationOperationRetryTarget | undefined
  cancelDrafts: Record<string, SimulationTaskCancelDraft>
  cancelTarget?: Pick<SimulationTaskCancelDraft, 'runId' | 'operationId'> | undefined
  draftCapacity: boolean
  /** In-memory World authoring slots in creation order; cleared on authorization replacement. */
  worldDrafts: Record<string, WorldAuthorDraft>
  choosingWorld: boolean
  authorInspectorWidth: number
  /** Wide-screen World module inspector width chosen by dragging; absent keeps the responsive default. */
  moduleInspectorWidth?: number | undefined
  worldAction?: SimulationWorldActionDraft | undefined
  active: boolean
  draftSearch: string
  directoryScroll: number
  collectionScroll: number
}
/** Complete view-store snapshot read by page components. */
export type SimulationViewState = State
type Actions = {
  cancel: (draft: State, key: string, value?: SimulationTaskCancelDraft) => void
  cancelTarget: (draft: State, target?: Pick<SimulationTaskCancelDraft, 'runId' | 'operationId'>) => void
  authorization: (draft: State, version: number) => void
  creating: (draft: State, open: boolean) => void
  creatingWorld: (draft: State, open: boolean) => void
  worldCreation: (draft: State, value?: SimulationWorldCreationDraft) => void
  maintenance: (draft: State, target?: SimulationMaintenanceTarget) => void
  operationRetry: (draft: State, key: string, value?: SimulationOperationRetryDraft) => void
  operationRetryTarget: (draft: State, target?: SimulationOperationRetryTarget) => void
  review: (draft: State, key: string, value?: SimulationReviewDraft) => void
  reviewTarget: (draft: State, target?: SimulationReviewTarget) => void
  input: (draft: State, runId: SimulationProductRunId, value?: SimulationInputDraft) => void
  creation: (draft: State, value?: SimulationCreationDraft) => void
  worldDraft: (draft: State, slot: string, value?: WorldAuthorDraft) => void
  choosingWorld: (draft: State, open: boolean) => void
  authorInspector: (draft: State, width: number) => void
  moduleInspector: (draft: State, width: number) => void
  worldAction: (draft: State, value?: SimulationWorldActionDraft) => void

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
 * @param world - In-memory World authoring allowance: complete UTF-8 bytes per slot and concurrent slots.
 * @returns one per-apply store shared by navigation and workspace, without business responses.
 */
export function createSimulationStore(maxDraftBytes: number, maxInputDrafts: number,
  world: { maxBytes: number; maxDrafts: number } = { maxBytes: 262144, maxDrafts: 4 }): EngineStoreHandle<State, Actions> {
  return defineStore({ init: () => ({ ...route(), authorizationVersion: -1, creating: false, creatingWorld: false,
    inputDrafts: {}, reviewDrafts: {},
    operationRetryDrafts: {}, cancelDrafts: {},
    draftCapacity: false, worldDrafts: {}, choosingWorld: false, authorInspectorWidth: 320,
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
        || new TextEncoder().encode(JSON.stringify({ worldCreation: d.worldCreation, creation: d.creation,
          inputDrafts: d.inputDrafts,
          reviewDrafts: d.reviewDrafts, operationRetryDrafts: d.operationRetryDrafts, cancelDrafts: next })).byteLength > maxDraftBytes) {
        throw new Error('Simulation retained draft capacity is occupied')
      }
      d.cancelDrafts = next
    },
    authorization: (d, version: number) => {
      if (d.authorizationVersion === version) return
      d.authorizationVersion = version; d.creation = undefined; d.creating = false; d.worldCreation = undefined; d.creatingWorld = false
      d.operationRetryDrafts = {}; d.operationRetryTarget = undefined; d.cancelDrafts = {}; d.cancelTarget = undefined
      d.maintenance = undefined; d.inputDrafts = {}; d.reviewDrafts = {}; d.reviewTarget = undefined; d.draftCapacity = false
      d.worldDrafts = {}; d.choosingWorld = false; d.worldAction = undefined
    },
    worldDraft: (d, slot: string, value?: WorldAuthorDraft) => {
      if (value === undefined) { const { [slot]: _removed, ...retained } = d.worldDrafts; d.worldDrafts = retained; return }
      if (d.worldDrafts[slot] === undefined && Object.keys(d.worldDrafts).length >= world.maxDrafts) {
        throw new Error('Simulation World draft slots are occupied')
      }
      if (draftBytes(value) > world.maxBytes) {
        throw new Error('Simulation World draft allowance is exceeded')
      }
      d.worldDrafts = { ...d.worldDrafts, [slot]: value }
    },
    choosingWorld: (d, open: boolean) => { d.choosingWorld = open },
    authorInspector: (d, width: number) => { d.authorInspectorWidth = Math.min(440, Math.max(280, Math.round(width))) },
    moduleInspector: (d, width: number) => { d.moduleInspectorWidth = Math.max(360, Math.round(width)) },
    worldAction: (d, value?: SimulationWorldActionDraft) => {
      if (value !== undefined && (d.worldAction === undefined && Object.keys(d.inputDrafts).length + Object.keys(d.reviewDrafts).length
        + Object.keys(d.operationRetryDrafts).length + Object.keys(d.cancelDrafts).length + 1 > maxInputDrafts
        || new TextEncoder().encode(JSON.stringify(value)).byteLength > maxDraftBytes)) {
        throw new Error('Simulation retained draft capacity is occupied')
      }
      d.worldAction = value
    },
    operationRetryTarget: (d, target?: SimulationOperationRetryTarget) => {
      d.operationRetryTarget = target === undefined ? undefined : { runId: target.runId, operationId: target.operationId }
    },
    operationRetry: (d, key: string, value?: SimulationOperationRetryDraft) => {
      const { [key]: _old, ...retained } = d.operationRetryDrafts
      const next = value === undefined ? retained : { ...retained, [key]: value }
      if (Object.keys(next).length + Object.keys(d.inputDrafts).length + Object.keys(d.reviewDrafts).length
        + Object.keys(d.cancelDrafts).length > maxInputDrafts
        || new TextEncoder().encode(JSON.stringify({ worldCreation: d.worldCreation, creation: d.creation,
          inputDrafts: d.inputDrafts,
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
        || new TextEncoder().encode(JSON.stringify({ worldCreation: d.worldCreation, creation: d.creation,
          inputDrafts: d.inputDrafts, reviewDrafts: next,
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
        || new TextEncoder().encode(JSON.stringify({ worldCreation: d.worldCreation, creation: d.creation,
          inputDrafts: next, reviewDrafts: d.reviewDrafts,
          operationRetryDrafts: d.operationRetryDrafts, cancelDrafts: d.cancelDrafts })).byteLength
          > maxDraftBytes) {
        throw new Error('Simulation retained draft capacity is occupied')
      }
      d.inputDrafts = next; d.draftCapacity = false
    },
    creating: (d, open: boolean) => { d.creating = open; if (open) d.creatingWorld = false },
    creatingWorld: (d, open: boolean) => { d.creatingWorld = open; if (open) d.creating = false },
    worldCreation: (d, value?: SimulationWorldCreationDraft) => {
      if (value !== undefined && new TextEncoder().encode(JSON.stringify({ worldCreation: value, creation: d.creation,
        inputDrafts: d.inputDrafts, reviewDrafts: d.reviewDrafts, operationRetryDrafts: d.operationRetryDrafts,
        cancelDrafts: d.cancelDrafts })).byteLength > maxDraftBytes) throw new Error('Simulation retained draft capacity is occupied')
      d.worldCreation = value; d.draftCapacity = false
    },
    creation: (d, value?: SimulationCreationDraft) => {
      if (value !== undefined && new TextEncoder().encode(JSON.stringify({ worldCreation: d.worldCreation, creation: value,
        inputDrafts: d.inputDrafts,
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
      d.decisionId = next.decisionId; d.caseSection = next.caseSection; d.section = next.section
      d.sourceIndex = next.sourceIndex
      d.knowledgeId = next.knowledgeId; d.knowledgeRevision = next.knowledgeRevision
      d.display = next.display; d.lens = next.lens; d.at = next.at; d.author = next.author; d.domain = next.domain
      d.needsAction = next.needsAction; d.worldSection = next.worldSection
    },
    searchDraft: (d, value: string) => { d.draftSearch = value },
    search: (d, value: string) => { d.search = value; d.draftSearch = value; d.directoryScroll = 0 },
    open: (d, runId?: string) => { d.runId = runId; d.module = 'overview'; d.objectId = undefined
      d.status = undefined; d.cognition = undefined; d.entityId = undefined; d.decisionId = undefined
      d.section = undefined; d.caseSection = undefined; d.lens = undefined; d.at = undefined; d.author = undefined
      d.domain = undefined; d.needsAction = undefined; d.worldSection = undefined },
    module: (d, module: Module) => { d.module = module; d.objectId = undefined; d.collectionScroll = 0
      d.status = undefined; d.cognition = undefined; d.entityId = undefined; d.decisionId = undefined
      d.section = undefined; d.caseSection = undefined; d.lens = undefined; d.at = undefined
      d.domain = undefined; d.needsAction = undefined; d.worldSection = undefined },
    object: (d, objectId?: string) => { d.objectId = objectId; d.section = undefined
      d.caseSection = undefined; d.worldSection = undefined },
    scroll: (d, target: 'directory' | 'collection', value: number) => {
      if (target === 'directory') d.directoryScroll = value
      else d.collectionScroll = value
    },
  } })
}
