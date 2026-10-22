// @vitest-environment jsdom
/** Real built browser plugins release hidden-tab HMR connections and reconcile missed rebuilds on return. */
import { act, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { installAssembledBootEnv, mountAssembledApp } from './assembled-boot.ts'

installAssembledBootEnv()

class Source extends EventTarget {
  static instances: Source[] = []
  closed = false
  constructor(readonly url: string) { super(); Source.instances.push(this) }
  close(): void { this.closed = true }
  send(frame: unknown): void { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(frame) })) }
}

it('releases hidden-tab streams and catches missed rebuilds without a self-reload loop', async () => {
  Source.instances = []
  vi.stubGlobal('EventSource', Source)
  let visibility: DocumentVisibilityState = 'visible'
  const visible = vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
  const graph = (rev: string) => ({ type: 'graph', graph: { rev, entries: [
    { id: '@clocky/clocky-client-hmr', rev, url: '/plugins/hmr/client.js' },
  ] } })
  const source = (index: number): Source => {
    const result = Source.instances[index]
    if (result === undefined) throw new Error(`HMR source ${index} is absent`)
    return result
  }
  try {
    mountAssembledApp()
    await screen.findByRole('region', { name: 'Team directory' }, { timeout: 10000 })
    await waitFor(() => { expect(Source.instances).toHaveLength(1) })
    act(() => { source(0).send(graph('initial')) })
    act(() => { visibility = 'hidden'; document.dispatchEvent(new Event('visibilitychange')) })
    expect(source(0).closed).toBe(true)
    act(() => { source(0).send({ type: 'rebuilt', id: '@clocky/clocky-client-hmr', rev: 'missed' }) })
    expect(Source.instances).toHaveLength(1)
    act(() => { visibility = 'visible'; document.dispatchEvent(new Event('visibilitychange')) })
    expect(Source.instances).toHaveLength(2)
    await act(async () => { source(1).send(graph('missed')) })
    await waitFor(() => { expect(Source.instances).toHaveLength(3) })
    expect(source(1).closed).toBe(true)
    // The replacement plugin establishes a current baseline, rather than repeatedly reloading itself.
    await act(async () => { source(2).send(graph('missed')) })
    expect(Source.instances).toHaveLength(3)
    act(() => { visibility = 'hidden'; document.dispatchEvent(new Event('visibilitychange')) })
    expect(source(2).closed).toBe(true)
    act(() => { visibility = 'visible'; document.dispatchEvent(new Event('visibilitychange')) })
    await act(async () => { source(3).send(graph('missed')) })
    expect(Source.instances.map(item => ({ url: item.url, closed: item.closed }))).toEqual([
      { url: '/plugins/events', closed: true }, { url: '/plugins/events', closed: true },
      { url: '/plugins/events', closed: true }, { url: '/plugins/events', closed: false },
    ])
    expect(screen.getByRole('region', { name: 'Team directory' })).toBeTruthy()
  } finally { visible.mockRestore() }
})

it.each([false, true])('restores the UI and preserves navigation after Connection rebuild (simulation=%s)', async (simulation) => {
  Source.instances = []
  vi.stubGlobal('EventSource', Source)
  const visible = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  try {
    mountAssembledApp(simulation ? '?fixture&workspace=simulation&simulation=retained-run' : '?fixture')
    const prior = await screen.findByRole('navigation', { name: 'Main navigation' }, { timeout: 10000 })
    await waitFor(() => { expect(Source.instances).toHaveLength(1) })
    const source = Source.instances[0]
    if (source === undefined) throw new Error('HMR source is absent')
    await act(async () => { source.send({ type: 'rebuilt', id: '@clocky/clocky-client-connection', rev: 'replacement' }) })
    await waitFor(() => {
      const next = screen.getByRole('navigation', { name: 'Main navigation' })
      expect(next).not.toBe(prior)
    }, { timeout: 10000 })
    if (simulation) {
      expect(new URLSearchParams(location.search).get('workspace')).toBe('simulation')
      expect(new URLSearchParams(location.search).get('simulation')).toBe('retained-run')
    }
  } finally { visible.mockRestore() }
})

it('retains the selected Simulation run when its workspace plugin is rebuilt', async () => {
  Source.instances = []
  vi.stubGlobal('EventSource', Source)
  const visible = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  try {
    mountAssembledApp('?fixture&workspace=simulation&simulation=retained-run', ['@clocky/clocky-client-ui-simulation'])
    await screen.findByRole('navigation', { name: 'Main navigation' }, { timeout: 10000 })
    await waitFor(() => { expect(Source.instances).toHaveLength(1) })
    const source = Source.instances[0]
    if (source === undefined) throw new Error('HMR source is absent')
    const prior = await waitFor(() => { const node = document.querySelector('[data-simulation-workspace-page]'); expect(node).not.toBeNull(); return node })
    await act(async () => { source.send({ type: 'rebuilt', id: '@clocky/clocky-client-ui-simulation', rev: 'replacement' }) })
    await waitFor(() => { const node = document.querySelector('[data-simulation-workspace-page]'); expect(node).not.toBeNull(); expect(node).not.toBe(prior) }, { timeout: 10000 })
    expect(new URLSearchParams(location.search).get('workspace')).toBe('simulation')
    expect(new URLSearchParams(location.search).get('simulation')).toBe('retained-run')
  } finally { visible.mockRestore() }
})
