import { simulationProductWorldManagementFieldsInputSchema, simulationProductWorldManagementDraftSchema } from '@clocky/clocky-simulation-product/world-management-schema'
/** Registration-layer projection of runtime-owned domain reads into the existing presentational windows. */
import type { SimulationWorldDomainReader, SimulationWorldManagementReader, SimulationReadState } from '@clocky/clocky-client-runtime/client'
import type { SimulationProductWorldDomainResult } from '@clocky/clocky-simulation-product/world-read-types'
import { simulationProductWorldDomainInputSchema } from '@clocky/clocky-simulation-product/world-read-schema'
import type { WorldDomainSource, WorldDomainState, WorldWindow } from './world-domain.ts'
import { UNPUBLISHED_WORLD_DOMAIN } from './world-domain.ts'

function project<T>(state: SimulationReadState<SimulationProductWorldDomainResult>,
  select: (result: SimulationProductWorldDomainResult) => T | undefined): WorldWindow<T> {
  const result = state.value, value = result === undefined ? undefined : select(result)
  const coverage = result?.coverage
  if (state.error !== undefined) return { status: 'error', message: state.error, previous: value, coverage }
  if (state.loading) return { status: 'loading', previous: value, coverage }
  if (value !== undefined) return { status: 'ready', value, stale: state.stale, coverage }
  if (result?.status === 'missing') return { status: 'error', message: 'unavailable', coverage }
  return { status: 'idle' }
}

/**
 * Adapt an existing runtime owner; no response is stored in a component or another business store.
 * @param reader - Per-plugin authenticated read lifetime.
 * @param pageSize - Explicit deployment allowance for all collection and detail pages.
 * @param management - Optional current personnel form/quote owner; absence publishes no management capability.
 * @returns stable observable projection and explicit read callbacks, with all response state retained by runtime owners.
 */
export function createWorldDomainSource(reader: SimulationWorldDomainReader, pageSize: number,
  management?: SimulationWorldManagementReader): WorldDomainSource {
  let previous: ReturnType<typeof reader.state.getSnapshot> | undefined
  let previousManagement: ReturnType<SimulationWorldManagementReader['state']['getSnapshot']> | undefined
  let selected: WorldDomainState = UNPUBLISHED_WORLD_DOMAIN
  const read = (raw: unknown) => {
    const input = simulationProductWorldDomainInputSchema.parse(raw)
    const current = reader.state.getSnapshot()[input.kind].value
    return reader.read({ ...input, limit: pageSize, ...input.cursor !== undefined && current !== undefined
      ? { expectedRevision: current.snapshotRevision, readVersion: current.readVersion } : {} })
  }
  const getSnapshot = (): WorldDomainState => {
    const state = reader.state.getSnapshot()
    const currentManagement = management?.state.getSnapshot()
    if (state === previous && currentManagement === previousManagement) return selected
    previous = state; previousManagement = currentManagement
    selected = { ...UNPUBLISHED_WORLD_DOMAIN,
      ...currentManagement === undefined ? {} : {
        actionFields: formWindow(currentManagement.fields), actionPreview: previewWindow(currentManagement.preview),
      },
      hiringMarket: project(state['hiring-market'], value => value.kind === 'hiring-market' ? value.value : undefined),
      overview: project(state.overview, value => value.kind === 'overview' ? value.value : undefined),
      organization: project(state.organization, value => value.kind === 'organization' ? value.value : undefined),
      person: project(state.person, value => value.kind === 'person' ? value.value : undefined),
      governance: project(state.governance, value => value.kind === 'governance' ? value.value : undefined),
      proposal: project(state.proposal, value => value.kind === 'proposal' ? value.value : undefined),
      norm: project(state.norm, value => value.kind === 'norm' ? value.value : undefined),
      external: project(state.external, value => value.kind === 'external' ? value.value : undefined),
      identity: project(state.identity, value => value.kind === 'identity' ? value.value : undefined),
      caseExtensions: project(state['case-extensions'], value => value.kind === 'case-extensions' ? value.value : undefined),
    }
    return selected
  }
  return { state: { getSnapshot, subscribe: (listener) => {
    const first = reader.state.subscribe(listener), second = management?.state.subscribe(listener)
    return () => { first(); second?.() }
  } }, reads: {
    ...UNPUBLISHED_READS,
    actionFields: (input) => {
      const parsed = simulationProductWorldManagementFieldsInputSchema.safeParse(input)
      if (!parsed.success) { management?.close(); return Promise.resolve() }
      return management?.fields(parsed.data) ?? Promise.resolve()
    },
    previewAction: (input) => {
      const parsed = simulationProductWorldManagementDraftSchema.safeParse(input)
      if (!parsed.success) return Promise.resolve()
      return management?.preview(parsed.data) ?? Promise.resolve()
    },
    closeActionPreview: () => { management?.close() },
    closeDetails: () => { for (const kind of ['person', 'proposal', 'norm', 'identity'] as const) reader.close(kind) },
    hiringMarket: input => read({ ...input, kind: 'hiring-market' }),
    overview: input => read({ ...input, kind: 'overview' }),
    organization: input => read({ ...input, kind: 'organization' }),
    person: input => read({ ...input, kind: 'person', section: input.section ?? 'identity' }),
    governance: input => read({ ...input, kind: 'governance', lens: input.lens ?? 'proposals' }),
    proposal: input => read({ ...input, kind: 'proposal', section: input.section ?? 'record' }),
    norm: input => read({ ...input, kind: 'norm' }),
    external: input => read({ ...input, kind: 'external' }),
    identity: input => read({ ...input, kind: 'identity', section: input.section ?? 'record' }),
    caseExtensions: input => input.requestIds.length === 0 ? Promise.resolve()
      : read({ ...input, kind: 'case-extensions', requestIds: [...input.requestIds] }),
  } }
}
const unavailable = async () => {}
const UNPUBLISHED_READS = { templates: unavailable, actionFields: unavailable, previewAction: unavailable, closeActionPreview: () => {} }

function formWindow(state: ReturnType<SimulationWorldManagementReader['state']['getSnapshot']>['fields']):
WorldDomainState['actionFields'] {
  if (state.error !== undefined) return { status: 'error', message: state.error }
  if (state.loading) return { status: 'loading' }
  if (state.value === undefined) return { status: 'idle' }
  if (state.value.status === 'unavailable') return { status: 'error', message: state.value.reason ?? 'unavailable' }
  return { status: 'ready', value: state.value.fields, stale: state.stale }
}
function previewWindow(state: ReturnType<SimulationWorldManagementReader['state']['getSnapshot']>['preview']):
WorldDomainState['actionPreview'] {
  const quote = state.value
  const value = quote === undefined ? undefined : { original: quote, previewHash: quote.previewHash, revision: quote.revision,
    impacts: quote.impacts, obligations: quote.obligations, blockers: quote.blockers.map(reason => ({ reason })) }
  if (state.error !== undefined) return { status: 'error', message: state.error, previous: value, coverage: quote?.coverage }
  if (state.loading) return { status: 'loading', previous: value, coverage: quote?.coverage }
  return value === undefined ? { status: 'idle' } : { status: 'ready', value, stale: state.stale, coverage: quote?.coverage }
}
