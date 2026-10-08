// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { makeTranslate } from '@clocky/clocky-client-test-runtime'
import type { TeamArtifactDetailState, TeamArtifactReference, TeamCollectionsState } from '@clocky/clocky-client-runtime/client'
import { ArtifactsWorkspace } from '../src/client/ArtifactsWorkspace.tsx'
import { en } from '../src/client/locales.ts'

afterEach(() => { cleanup(); vi.restoreAllMocks() })
const artifact: TeamArtifactReference = { id: 'report/one', provider: 'local', kind: 'report', uri: 'artifact://report', visibility: 'team' }
const t = makeTranslate(en)
function collections(patch: Partial<TeamCollectionsState['artifacts']> = {}): TeamCollectionsState {
  const empty = { items: [], loading: false, loadingMore: false, hasNewer: false }
  return { teamId: 'team' as never, members: empty, tasks: empty, workflowPlans: empty,
    artifacts: { ...empty, startCursor: 0, nextCursor: 1, ...patch } }
}

it('separates an empty window from loading and errors and delegates explicit collection paging', () => {
  const readCollections = vi.fn(async () => {})
  const view = render(<ArtifactsWorkspace artifacts={[]} t={t} />)
  expect(view.getByText(en['detail.artifactsEmpty'])).toBeTruthy()
  view.rerender(<ArtifactsWorkspace artifacts={[]} collections={collections()} readCollections={readCollections} t={t} />)
  fireEvent.click(view.getByRole('button', { name: en['detail.firstPage'] }))
  fireEvent.click(view.getByRole('button', { name: en['detail.loadArtifacts'] }))
  fireEvent.click(view.getByRole('button', { name: en['detail.refreshArtifacts'] }))
  expect(readCollections.mock.calls).toEqual([['artifacts', 'first'], ['artifacts', 'next'], ['artifacts']])
  view.rerender(<ArtifactsWorkspace artifacts={[]} collections={collections({ loading: true })} readCollections={readCollections} t={t} />)
  expect(view.getByText(en['detail.artifactsLoading'])).toBeTruthy()
  expect(view.queryByText(en['detail.artifactsEmpty'])).toBeNull()
  expect((view.getByRole('button', { name: en['detail.loadArtifacts'] }) as HTMLButtonElement).disabled).toBe(true)
  view.rerender(<ArtifactsWorkspace artifacts={[]} collections={collections({ error: 'Page unavailable', loadingMore: true })}
    readCollections={readCollections} t={t} />)
  expect(view.getByRole('alert').textContent).toBe('Page unavailable')
  expect(view.queryByText(en['detail.artifactsEmpty'])).toBeNull()
})

it('binds reads to provider-owned references and retains explicit stale or disconnected feedback', () => {
  const read = vi.fn(async () => {})
  const unavailable = { ...artifact, id: 'no-provider', provider: undefined }
  const view = render(<ArtifactsWorkspace artifacts={[artifact, unavailable]} t={t} />)
  expect(view.getAllByText(en['detail.artifactUnavailable'])).toHaveLength(2)
  view.rerender(<ArtifactsWorkspace artifacts={[artifact, unavailable]} read={read} t={t} />)
  fireEvent.click(view.getByRole('button', { name: en['detail.artifactRead'] }))
  expect(read).toHaveBeenCalledExactlyOnceWith(artifact.id)
  const detail: TeamArtifactDetailState = { teamId: 'team' as never, artifactId: artifact.id, value: undefined,
    loading: true, disconnected: false, stale: false }
  view.rerender(<ArtifactsWorkspace artifacts={[artifact]} read={read} detail={detail} t={t} />)
  expect(view.getAllByText(en['detail.artifactLoading']).length).toBeGreaterThan(0)
  view.rerender(<ArtifactsWorkspace artifacts={[artifact]} read={read}
    detail={{ ...detail, loading: false, disconnected: true, stale: true }} t={t} />)
  expect(view.getByText(en['detail.artifactDisconnected'])).toBeTruthy()
  expect(view.queryByText(en['detail.artifactStale'])).toBeNull()
  view.rerender(<ArtifactsWorkspace artifacts={[artifact]} read={read} detail={{ ...detail, loading: false, stale: true, error: 'Refresh failed' }} t={t} />)
  expect(view.getByText(en['detail.artifactStale'])).toBeTruthy()
  expect(view.getByRole('alert').textContent).toBe('Refresh failed')
})

it('caps approved text previews while downloading the full provider bytes under a safe filename', async () => {
  const text = 'x'.repeat(128 * 1024 + 1)
  const value = { artifact, bytes: text.length, data: btoa(text) }
  const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:approved-artifact')
  const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  let filename = ''
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { filename = this.download })
  const detail: TeamArtifactDetailState = { teamId: 'team' as never, artifactId: artifact.id, value,
    loading: false, disconnected: false, stale: false }
  const view = render(<ArtifactsWorkspace artifacts={[artifact]} detail={detail} t={t} />)
  expect(view.container.querySelector('pre')?.textContent).toBe('x'.repeat(128 * 1024) + '\n…')
  fireEvent.click(view.getByRole('button', { name: en['detail.artifactDownload'] }))
  expect(createObjectURL.mock.calls[0]?.[0]).toMatchObject({ size: text.length, type: 'application/octet-stream' })
  expect(filename).toBe('artifact-report-one')
  await waitFor(() => { expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:approved-artifact') })
  view.rerender(<ArtifactsWorkspace artifacts={[artifact]} detail={{ ...detail, value: { ...value, bytes: 1, data: 'eA==' } }} t={t} />)
  expect(view.container.querySelector('pre')?.textContent).toBe('x')
  for (const kind of ['file', 'screenshot'] as const) {
    view.rerender(<ArtifactsWorkspace artifacts={[artifact]}
      detail={{ ...detail, value: { ...value, artifact: { ...artifact, kind } } }} t={t} />)
    expect(view.getByText(en['detail.artifactBinary'])).toBeTruthy()
    expect(view.container.querySelector('pre')).toBeNull()
  }
})
