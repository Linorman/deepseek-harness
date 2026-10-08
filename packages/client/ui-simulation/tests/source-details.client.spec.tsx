// @vitest-environment jsdom
/** Frozen source lookup keeps exact identity, Team permission and text continuation separate. */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { SourceDetails } from '../src/client/SourceDetails.tsx'
import { en } from '../src/client/locales.ts'
import { simulationSourceScope } from '@clocky/clocky-client-runtime/client'
import type { SimulationRuntimeState } from '@clocky/clocky-client-runtime/client'
import { simulationProductSourceInputSchema } from '@clocky/clocky-simulation-product/schema'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const input = simulationProductSourceInputSchema.parse({ runId: 'run', decisionId: 'decision', sourceIndex: 0, limit: 2 })
const baseData = { connected: true, generation: 1, authorizationVersion: 1,
  source: { scope: simulationSourceScope(input), loading: false, stale: false } } as SimulationRuntimeState

it('shows an authorized source’s exact Team references, inert text and continuation identity', () => {
  const watch = vi.fn(() => () => {})
  const read = vi.fn(async () => undefined)
  const data: SimulationRuntimeState = { ...baseData, source: { ...baseData.source, value: { runId: 'run' as never,
    decisionId: 'decision' as never, sourceIndex: 0, snapshotRevision: 1, readVersion: 'v1' as never, observedAt: 1,
    status: 'found', source: { kind: 'team-envelope', teamId: 'team' as never, channelId: 'channel' as never,
      envelopeId: 'envelope' as never }, envelope: { sequence: 7, kind: { text: 'Communication', truncated: false }, createdAt: 9 },
    items: [{ block: 1, body: { status: 'text', text: '<script>PRIVATE_SOURCE()</script>', part: 0, parts: 2 } }],
    nextCursor: 'next' as never } } }
  const view = render(<SourceDetails view={{ runId: 'run', module: 'decisions', search: '', objectId: 'decision', sourceIndex: 0 }}
    data={data} pageSize={2} watch={watch} read={read} refresh={vi.fn(async () => {})} navigate={vi.fn()}
    t={key => en[key]} date={String} />)
  expect(watch).toHaveBeenCalledWith(input)
  expect(view.getByRole('link', { name: `${en.inspectTeam}: team` })).toBeDefined()
  expect(view.getByRole('link', { name: `${en.inspectTeamChannel}: channel` })).toBeDefined()
  expect(view.getByText('<script>PRIVATE_SOURCE()</script>')).toBeDefined()
  expect(view.container.querySelector('script')).toBeNull()
  fireEvent.click(view.getByRole('button', { name: en.next }))
  expect(read).toHaveBeenCalledWith({ ...input, cursor: 'next', envelopeSequence: 7 })
})

it('distinguishes searching and unavailable permission states while retaining refresh and back routes', () => {
  const navigate = vi.fn()
  const refresh = vi.fn(async () => undefined)
  const data: SimulationRuntimeState = { ...baseData, source: { ...baseData.source, value: { runId: 'run' as never,
    decisionId: 'decision' as never, sourceIndex: 0, snapshotRevision: 1, readVersion: 'v1' as never, observedAt: 1,
    status: 'searching', source: { kind: 'team-envelope', teamId: 'team' as never, channelId: 'channel' as never,
      envelopeId: 'envelope' as never }, items: [], nextCursor: 'search-next' as never } } }
  const view = render(<SourceDetails view={{ runId: 'run', module: 'decisions', search: '', objectId: 'decision', sourceIndex: 0 }}
    data={data} pageSize={2} watch={() => () => {}} read={vi.fn(async () => undefined)} refresh={refresh} navigate={navigate}
    t={key => en[key]} date={String} />)
  expect(view.getByText(en.sourceSearching)).toBeDefined()
  fireEvent.click(view.getByRole('button', { name: en.sourceContinue }))
  fireEvent.click(view.getByRole('button', { name: en.refreshDetail }))
  expect(refresh).toHaveBeenCalledOnce()
  fireEvent.click(view.getByRole('button', { name: en.sourceBack }))
  expect(navigate).toHaveBeenCalledWith({ runId: 'run', module: 'decisions', search: '', objectId: 'decision', sourceIndex: undefined })
})

it('restores focus to the exact source row and falls back within a detached inspector', () => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(1); return 1 })
  const view = render(<div data-simulation-workspace-page><>
    <button type="button" data-source-index data-source-decision="decision" data-source-index-value="ignored">unused</button>
    <aside><SourceDetails view={{ runId: 'run', module: 'decisions', search: '', objectId: 'decision', sourceIndex: 2 }}
      data={baseData} pageSize={2} watch={() => () => {}} read={vi.fn(async () => undefined)} refresh={vi.fn(async () => {})}
      navigate={() => {}} t={key => en[key]} date={String} /></aside>
  </></div>)
  const exact = view.getByRole('button', { name: /^unused/ })
  exact.dataset.sourceDecision = 'decision'; exact.dataset.sourceIndex = '2'
  fireEvent.click(view.getByRole('button', { name: en.sourceBack }))
  expect(document.activeElement).toBe(exact)
  cleanup()
  const detached = render(<aside><SourceDetails view={{ runId: 'run', module: 'decisions', search: '', objectId: 'decision', sourceIndex: 3 }}
    data={baseData} pageSize={2} watch={() => () => {}} read={vi.fn(async () => undefined)} refresh={vi.fn(async () => {})}
    navigate={() => {}} t={key => en[key]} date={String} /></aside>)
  const heading = detached.getByRole('heading', { name: en.sourceTitle })
  expect(document.activeElement).toBe(heading)
  expect(heading).toBeDefined()
})

it('returns focus to the inspector Back control when the source row has left its page', () => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(1); return 1 })
  const view = render(<div data-simulation-workspace-page><aside><SourceDetails
    view={{ runId: 'run', module: 'decisions', search: '', objectId: 'decision', sourceIndex: 3 }}
    data={baseData} pageSize={2} watch={() => () => {}} read={vi.fn(async () => undefined)} refresh={vi.fn(async () => {})}
    navigate={vi.fn()} t={key => en[key]} date={String} /></aside></div>)
  const back = view.getByRole('button', { name: en.sourceBack })
  fireEvent.click(back)
  expect(document.activeElement).toBe(back)
})

it('shows a loading source, a stale result and an explicit read error distinctly', () => {
  const common = { view: { runId: 'run', module: 'decisions' as const, search: '', objectId: 'decision', sourceIndex: 0 },
    pageSize: 2, watch: () => () => {}, read: vi.fn(async () => undefined), refresh: vi.fn(async () => {}),
    navigate: vi.fn(), t: (key: keyof typeof en) => en[key], date: String }
  const view = render(<SourceDetails {...common} data={{ ...baseData, source: { ...baseData.source,
    loading: true, value: undefined } }} />)
  expect(view.getByText(en.loading)).toBeDefined()
  view.rerender(<SourceDetails {...common} data={{ ...baseData, source: { ...baseData.source,
    loading: false, stale: true, value: undefined } }} />)
  expect(view.getByText(en.stale)).toBeDefined()
  view.rerender(<SourceDetails {...common} data={{ ...baseData, source: { ...baseData.source,
    loading: false, stale: false, error: 'network' } }} />)
  expect(view.getByRole('alert').textContent).toBe(en.network)
})

it('renders explicit absent permission states and optional identity without borrowing an envelope', () => {
  const common = { runId: 'run' as never, decisionId: 'decision' as never, sourceIndex: 0, snapshotRevision: 1,
    readVersion: 'v1' as never, observedAt: 1, items: [] as never[], nextCursor: undefined }
  const absent: SimulationRuntimeState = { ...baseData, source: { ...baseData.source, value: { ...common, status: 'missing' } } }
  const first = render(<SourceDetails view={{ runId: 'run', module: 'decisions', search: '', objectId: 'decision', sourceIndex: 0 }}
    data={absent} pageSize={2} watch={() => () => {}} read={vi.fn(async () => undefined)} refresh={vi.fn(async () => {})}
    navigate={vi.fn()} t={key => en[key]} date={String} />)
  expect(first.getByText(en.sourceMissing)).toBeDefined()
  expect(first.queryByRole('link')).toBeNull()
  first.rerender(<SourceDetails view={{ runId: 'run', module: 'decisions', search: '', objectId: 'decision', sourceIndex: 0 }}
    data={{ ...baseData, source: { ...baseData.source, value: { ...common, status: 'withheld',
      items: [{ block: 0, body: { status: 'withheld' as const } }] } } }} pageSize={2}
    watch={() => () => {}} read={vi.fn(async () => undefined)} refresh={vi.fn(async () => {})} navigate={vi.fn()}
    t={key => en[key]} date={String} />)
  expect(first.getAllByText(en.sourceWithheld).length).toBeGreaterThan(1)
  first.rerender(<SourceDetails view={{ runId: 'run', module: 'decisions', search: '', objectId: 'decision', sourceIndex: 0 }}
    data={{ ...baseData, source: { ...baseData.source, value: { ...common, status: 'unavailable',
      items: [{ block: 0, body: { status: 'unsupported' as never } }] } } }} pageSize={2}
    watch={() => () => {}} read={vi.fn(async () => undefined)} refresh={vi.fn(async () => {})} navigate={vi.fn()}
    t={key => en[key]} date={String} />)
  expect(first.getByText(en.sourceUnavailable)).toBeDefined()
  expect(first.getByText(en.contextBodyUnsupported)).toBeDefined()
})
