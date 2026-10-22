/** Directory and run-page read orchestration: polling, revision-bound rereads and explicit refresh share one owner. */
import { useCallback, useEffect, useRef } from 'react'
import type { SimulationProductRunId, SimulationReadState, SimulationRuntimeState,
  SimulationProductRunStatusesPage, SimulationProductTaskReviewListInput } from '@clocky/clocky-client-runtime/client'
import { observationVersion, useObservedRefresh } from './useObservedRefresh.ts'
import { collectionInput, objectInput } from './selection.ts'
import type { SimulationViewState } from './store.ts'
import type { OrganizationRoute } from './WorldOrganization.tsx'
import type { GovernanceRoute } from './WorldGovernance.tsx'
import type { WorldDomainState } from './world-domain.ts'
import type { Props } from './Workspace.tsx'

/** Collection modules whose windows use bounded Host browse reads. */
export type CollectionModule = 'entities' | 'decisions' | 'operations' | 'checkpoints'

/**
 * Own every automatic read for the selected directory or run, and the explicit refresh of the visible module.
 * @param props - Workspace props carrying bounded runtime reads.
 * @param view - Current view-store selection.
 * @param data - Current runtime snapshot.
 * @param world - Current World domain windows.
 * @returns derived selection facts and read callbacks that the pages render from.
 */
export function useRunReads(props: Props, view: SimulationViewState, data: SimulationRuntimeState, world: WorldDomainState): RunReads {
  const runId = view.runId as SimulationProductRunId | undefined
  const liveVersion = props.visible ? observationVersion(data, runId) : undefined
  const liveControl = data.control.value?.runId === runId ? data.control.value : undefined
  const liveStatusVersion = liveVersion === undefined ? undefined : JSON.stringify([liveVersion, liveControl?.revision,
    liveControl?.owner, liveControl?.phase, liveControl?.driver, liveControl?.inFlight, liveControl?.stop])
  const collectionModule: CollectionModule | undefined = view.module === 'entities' || view.module === 'decisions'
    || view.module === 'operations' || view.module === 'checkpoints' ? view.module : undefined
  const collection = runId === undefined || collectionModule === undefined ? undefined
    : collectionInput({ ...view, runId, module: collectionModule }, props.pageSize)
  const selection = runId === undefined || collectionModule === undefined || view.objectId === undefined ? undefined
    : objectInput({ ...view, runId, module: collectionModule, objectId: view.objectId }, props.pageSize)
  const contextVersion = selection?.section === 'context' ? data.observation.value?.readVersion
    : selection?.section === 'knowledge' ? `${data.observation.value?.readVersion}:${data.observation.value?.world.status === 'observed'
      ? data.observation.value.world.revision : 'unavailable'}` : undefined
  const collectionQuery = collection === undefined ? undefined : JSON.stringify(Object.entries(collection)
    .filter(([key]) => key !== 'limit').sort(([a], [b]) => a.localeCompare(b)))
  const directoryIds = data.directory.value?.items.map(item => item.id) ?? []
  const directoryStatusScope = JSON.stringify(['statuses', directoryIds])
  const statuses: SimulationReadState<SimulationProductRunStatusesPage> = data.statuses.scope === directoryStatusScope
    ? data.statuses : { loading: false, stale: false }
  useEffect(() => {
    if (!props.visible || !data.connected || runId !== undefined || directoryIds.length === 0) return
    const timer = window.setInterval(() => { void props.runStatuses({ runIds: directoryIds }) }, props.controlRefreshMs)
    return () => { window.clearInterval(timer) }
  }, [props.visible, data.connected, data.authorizationVersion, runId, directoryStatusScope, props.runStatuses, props.controlRefreshMs])
  const unknownCount = data.run.value !== undefined && data.run.value.run.id === runId
    ? data.run.value.world?.metrics?.unknownOperationCount : undefined
  useEffect(() => {
    if (props.visible && data.connected && runId !== undefined && unknownCount !== undefined && unknownCount > 0
      && data.run.scope === JSON.stringify(['run', runId])) void props.unknownOperations(runId, props.pageSize)
  }, [props.visible, data.connected, data.authorizationVersion, data.generation, runId, unknownCount, data.run.scope,
    props.unknownOperations, props.pageSize])
  useEffect(() => {
    if (!props.visible || !data.connected || runId === undefined) return
    void props.control(runId)
    const timer = window.setInterval(() => { void props.control(runId) }, props.controlRefreshMs)
    return () => { window.clearInterval(timer) }
  }, [props.visible, data.connected, data.authorizationVersion, runId, props.control, props.controlRefreshMs])
  useEffect(() => {
    if (props.visible && data.connected && runId !== undefined && (view.module === 'overview' || view.module === 'requests')
      && data.run.scope === JSON.stringify(['run', runId])) void props.listRequests({ runId, limit: props.pageSize })
  }, [props.visible, data.connected, data.authorizationVersion, data.generation, runId, view.module, data.run.scope,
    props.listRequests, props.pageSize])
  useEffect(() => {
    if (props.visible && (view.creating || runId === undefined) && data.connected) void props.catalog()
  }, [props.visible, view.creating, runId, data.connected, data.authorizationVersion, props.catalog])
  useEffect(() => {
    if (!props.visible || !data.connected || runId === undefined) return
    return props.observe(runId)
  }, [props.visible, data.connected, data.generation, runId, props.observe])
  useEffect(() => {
    if (!props.visible || !data.connected) return
    if (runId === undefined) void props.directory(view.search)
    else {
      void props.inspect(runId)
      if (collection !== undefined) void props.browse(collection)
    }
  }, [props.visible, data.connected, data.generation, runId, view.module, view.search, view.status, view.cognition,
    view.entityId, view.decisionId, props.pageSize,
    props.directory, props.inspect, props.browse])
  useEffect(() => {
    if (!props.visible || !data.connected || runId === undefined || view.objectId === undefined || collectionModule === undefined) {
      props.closeObject(); return
    }
    /* v8 ignore next -- Normalized object routes in a collection module always produce a selection. */
    if (selection === undefined) return
    if ((selection.section === 'context' || selection.section === 'knowledge') && data.observation.value?.runId !== runId) return
    void props.inspectObject(selection)
  }, [props.visible, data.connected, data.generation, contextVersion, runId, view.objectId,
    view.module, view.section, view.knowledgeId, view.knowledgeRevision, props.pageSize,
    props.inspectObject, props.closeObject])
  // Cold read-only registrations use Native initialization metadata; retained templates also identify a world still preparing.
  const controlValue = runId === undefined || data.control.scope !== JSON.stringify(['control', runId]) ? undefined : data.control.value
  const runValue = runId === undefined ? undefined : data.run.value
  const scenario = (controlValue !== undefined && controlValue.runId === runId ? controlValue.versions?.scenario : undefined)
    ?? (runValue !== undefined && runValue.run.id === runId ? runValue.operational?.scenario : undefined)
  const worldRun = runValue?.run.id === runId && runValue?.world?.worldInitialized === true
    || scenario?.status === 'observed' && ['clocky.world/v0/', 'clocky.world/v1/']
      .some(prefix => scenario.templateId.text.startsWith(prefix))
  const worldPreparing = controlValue?.actions.start.reason === 'preparation-in-progress'
  // Collection continuations and inspector sections have independent lifetimes.
  const personSection = view.worldSection === 'tenure' ? 'tenures' : view.worldSection === 'obligations' ? 'obligations' : 'identity'
  const proposalSection = view.worldSection === 'electorate' || view.worldSection === 'votes' || view.worldSection === 'impact' ? view.worldSection : 'record'
  const identitySection = view.worldSection === 'facts' ? 'facts' : view.worldSection === 'interactions' ? 'interactions'
    : view.worldSection === 'representative' ? 'representatives' : 'record'
  const readPerson = (cursor?: string) => {
    if (runId !== undefined && view.objectId !== undefined) void props.worldReads.person({ runId, personId: view.objectId,
      section: personSection, cursor, at: view.at })
  }
  const readGovernanceDetail = (cursor?: string) => {
    if (runId === undefined || view.objectId === undefined) return
    if (view.lens === 'norms' || view.lens === 'history') void props.worldReads.norm({ runId, versionId: view.objectId, cursor, at: view.at })
    else void props.worldReads.proposal({ runId, proposalId: view.objectId, section: proposalSection, cursor, at: view.at })
  }
  const readIdentity = (cursor?: string) => {
    if (runId !== undefined && view.objectId !== undefined) void props.worldReads.identity({ runId, key: view.objectId,
      section: identitySection, cursor, at: view.at })
  }
  const readWorldCollection = () => {
    if (runId === undefined || !worldRun || worldPreparing) return
    if (view.module === 'overview') void props.worldReads.overview({ runId })
    else if (view.module === 'organization') void props.worldReads.organization({ runId, lens: (view.lens ?? 'structure') as OrganizationRoute['lens'], at: view.at })
    else if (view.module === 'governance') void props.worldReads.governance({ runId, at: view.at, lens: (view.lens ?? 'proposals') as GovernanceRoute['lens'] })
    else if (view.module === 'external') void props.worldReads.external({ runId })
  }
  const readWorldDetail = () => {
    if (runId === undefined || !worldRun || worldPreparing) return
    if (view.module === 'organization' && view.lens === 'people') readPerson()
    else if (view.module === 'governance') readGovernanceDetail()
    else if (view.module === 'external') readIdentity()
  }
  const readWorld = () => { readWorldCollection(); readWorldDetail() }
  /** Reread the visible module; settles once every read it started has settled. */
  const refresh = async (): Promise<void> => {
    const reads: Promise<unknown>[] = []
    const read = (value: Promise<unknown> | undefined) => { if (value !== undefined) reads.push(value) }
    if (runId === undefined) read(props.directory(view.search))
    else if (view.module === 'overview') { read(props.inspect(runId)); read(props.control(runId)); if (worldRun) read(props.worldReads.overview({ runId })) }
    else if (view.module === 'cases') {
      read(props.listWorldCases({ runId, limit: props.pageSize,
        status: view.status as import('@clocky/clocky-client-runtime/client').SimulationProductWorldCasesInput['status'] }))
      if (view.objectId !== undefined) read(props.inspectWorldCase({ runId,
        requestId: view.objectId as import('@clocky/clocky-client-runtime/client').SimulationProductWorldCaseInput['requestId'],
        section: view.caseSection === 'evidence' || view.caseSection === 'source' ? 'request' : view.caseSection ?? 'request', limit: props.pageSize }))
    }
    else if (view.module === 'requests') read(props.listRequests({ runId, limit: props.pageSize }))
    else if (view.module === 'organization' || view.module === 'governance' || view.module === 'external') readWorld()
    else if (view.module === 'records') read(props.readRecords({ runId, mode: 'metadata', kind: view.recordKind, limit: props.pageSize }))
    else {
      /* v8 ignore next -- Every remaining module is one of the four collection modules. */
      if (collection === undefined) return
      read(props.browse(collection))
    }
    await Promise.allSettled(reads)
  }
  // Revision-bound continuations cannot cross a commit. Reread the current filtered
  // window from its beginning while keeping selection, scroll and authored drafts.
  useObservedRefresh(liveStatusVersion, data.run.loading, () => {
    if (runId !== undefined) void props.inspect(runId)
  }, data.run.stale)
  useObservedRefresh(liveVersion, data.collection.loading, () => {
    if (collection !== undefined) void props.browse(collection)
  }, data.collection.stale)
  useObservedRefresh(liveVersion, data.object.loading, () => {
    if (selection !== undefined && selection.section !== 'context' && selection.section !== 'knowledge') void props.inspectObject(selection)
  }, data.object.stale)
  useObservedRefresh(liveVersion, data.unknownOperations.loading, () => {
    if (runId !== undefined && unknownCount !== undefined && unknownCount > 0) void props.unknownOperations(runId, props.pageSize)
  })
  // The review window a reviewer paged into; observed rereads always restart at the first page.
  const reviewCursor = useRef<string | undefined>()
  const readTaskReviews = useCallback(async (input: SimulationProductTaskReviewListInput) => {
    reviewCursor.current = input.cursor
    await props.listTaskReviews(input)
  }, [props.listTaskReviews])
  useObservedRefresh(liveStatusVersion, data.reviews.loading, () => {
    // A failed review read stays on screen with its retained rows until the reviewer refreshes it explicitly; an open
    // review dialog owns its fenced window and refreshes only on request, so focus and fence state never churn under it.
    // A continuation page also stays until an explicit refresh instead of snapping back to the first page.
    if (data.reviews.error !== undefined || view.reviewTarget !== undefined || reviewCursor.current !== undefined) return
    if (runId !== undefined && view.module === 'overview' && (scenario?.status !== 'observed' || scenario.execution === 'automatic-tasks')) {
      void readTaskReviews({ runId, limit: props.pageSize })
    }
  })
  useObservedRefresh(liveStatusVersion, data.tasks.loading, () => {
    // An open cancellation dialog owns its fenced window and refreshes only on request.
    if (view.cancelTarget !== undefined) return
    if (runId !== undefined && view.module === 'overview' && (scenario?.status !== 'observed' || scenario.execution === 'automatic-tasks')) {
      void props.listTasks({ runId, limit: props.pageSize })
    }
  })
  useObservedRefresh(liveStatusVersion, data.persistentRequests.loading, () => {
    if (runId !== undefined && (view.module === 'overview' || view.module === 'requests')) void props.listRequests({ runId, limit: props.pageSize })
  })
  const worldCollection = view.module === 'organization' ? world.organization : view.module === 'governance'
    ? world.governance : view.module === 'external' ? world.external : world.overview
  const worldDetail = view.module === 'organization' ? world.person : view.module === 'governance'
    ? view.lens === 'norms' || view.lens === 'history' ? world.norm : world.proposal : world.identity
  useObservedRefresh(liveVersion, worldCollection.status === 'loading', readWorldCollection,
    worldCollection.status === 'ready' && worldCollection.stale)
  useObservedRefresh(liveVersion, worldDetail.status === 'loading', readWorldDetail,
    worldDetail.status === 'ready' && worldDetail.stale)
  useEffect(() => {
    if (props.visible && data.connected && runId !== undefined && worldRun) readWorldCollection()
  }, [props.visible, data.connected, data.authorizationVersion, data.generation, runId, worldRun, worldPreparing, view.module,
    view.lens, view.at,
    data.observation.value?.readVersion, props.worldReads])
  useEffect(() => {
    if (!props.visible || !data.connected || runId === undefined || !worldRun) return
    readWorldDetail()
    return () => { props.worldReads.closeDetails() }
  }, [props.visible, data.connected, data.authorizationVersion, data.generation, runId, worldRun, worldPreparing, view.module,
    view.lens, view.at,
    view.objectId, view.worldSection, data.observation.value?.readVersion, props.worldReads])
  // The World overview's business card reads the first bounded case page; Cases owns its own filtered window.
  const worldCaseVersion = data.observation.value?.runId === runId ? data.observation.value?.readVersion : undefined
  useEffect(() => {
    if (props.visible && data.connected && runId !== undefined && worldRun && !worldPreparing && view.module === 'overview') {
      void props.listWorldCases({ runId, limit: props.pageSize })
    }
  }, [props.visible, data.connected, data.authorizationVersion, runId, worldRun, worldPreparing, view.module, worldCaseVersion,
    props.listWorldCases, props.pageSize])
  useEffect(() => {
    if (props.visible && data.connected && view.author === undefined && view.choosingWorld) void props.worldReads.templates()
  }, [props.visible, data.connected, view.choosingWorld, view.author, props.worldReads])
  return { runId, collectionModule, collection, selection, collectionQuery, directoryIds, statuses, unknownCount,
    scenario, worldRun, worldPreparing, refresh, readPerson, readGovernanceDetail, readIdentity, readWorld, readTaskReviews }
}

/** Derived selection facts and read callbacks shared by the directory and run pages. */
export interface RunReads {
  readonly runId: SimulationProductRunId | undefined
  readonly collectionModule: CollectionModule | undefined
  readonly collection: ReturnType<typeof collectionInput> | undefined
  readonly selection: ReturnType<typeof objectInput> | undefined
  readonly collectionQuery: string | undefined
  readonly directoryIds: SimulationProductRunId[]
  readonly statuses: SimulationReadState<SimulationProductRunStatusesPage>
  readonly unknownCount: number | undefined
  readonly scenario: NonNullable<NonNullable<SimulationRuntimeState['control']['value']>['versions']>['scenario'] | undefined
  readonly worldRun: boolean
  readonly worldPreparing: boolean
  readonly refresh: () => Promise<void>
  readonly readPerson: (cursor?: string) => void
  readonly readGovernanceDetail: (cursor?: string) => void
  readonly readIdentity: (cursor?: string) => void
  readonly readWorld: () => void
  /** Read a review window and remember whether it is a continuation page, which observed rereads leave in place. */
  readonly readTaskReviews: (input: SimulationProductTaskReviewListInput) => Promise<void>
}
