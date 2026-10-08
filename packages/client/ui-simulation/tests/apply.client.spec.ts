// @vitest-environment jsdom
/** Registrations bind configured reads and own their contribution and exporter disposal. */
import { Context } from '@clocky/cordis'
import { createSnapshotStore, SlotRegistry } from '@clocky/clocky-client-runtime/client'
import { LocaleRuntime } from '@clocky/clocky-client-locale/client'
import { afterEach, expect, it, vi } from 'vitest'
import { apply, inject } from '../src/client/index.ts'
import { apply as hostApply, inject as hostInject } from '../src/index.ts'
import type { Injected } from '../src/client/Workspace.tsx'
import { CommandRegistry } from '@clocky/clocky-client-ui-layout/src/client/commands.ts'
import type { SimulationRuntimeState, SimulationRecordDownload } from '@clocky/clocky-client-runtime/client'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

it('binds configured read limits, opens safe palette destinations and retires every contribution', async () => {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  const commands = new CommandRegistry()
  const clear = vi.fn(), navigate = vi.fn<(href: string) => void>(), showWorkspace = vi.fn()
  ctx.provide('sessions', { clear } as never)
  ctx.provide('layout', { navigate, showWorkspace, registerCommands: commands.registerProvider.bind(commands) } as never)
  const off = vi.fn()
  const state = createSnapshotStore<Pick<SimulationRuntimeState, 'directory'>>({ directory: { loading: false, stale: false,
    value: { items: [{ id: 'run' as never, name: { text: 'Registered run', truncated: false }, registeredAt: 1, observation: 'not-observed' }] } } })
  const administration = { state: createSnapshotStore({ commands: {} }),
    retain: vi.fn(), submit: vi.fn(), query: vi.fn(), release: vi.fn() }
  const exporter = { state: createSnapshotStore({}), start: vi.fn(async (_input: Parameters<Injected['exportRecords']>[0],
    download: (file: SimulationRecordDownload) => void) => { download({ text: '[]', name: 'records.json' }) }), cancel: vi.fn() }
  const runtime = {
    state, administration: vi.fn(() => administration), recordExporter: vi.fn(() => exporter),
    directory: vi.fn(async () => {}), pause: vi.fn(), watchSource: vi.fn(() => off), observe: vi.fn(() => off),
    inspect: vi.fn(async () => {}), unknownOperations: vi.fn(), runStatuses: vi.fn(), listTaskReviews: vi.fn(),
    listRequests: vi.fn(), listTasks: vi.fn(), inspectSource: vi.fn(), refreshSource: vi.fn(), readRecords: vi.fn(), closeRecords: vi.fn(),
    inspectRecovery: vi.fn(), closeRecovery: vi.fn(), catalog: vi.fn(), control: vi.fn(), preflight: vi.fn(), closePreflight: vi.fn(),
    browse: vi.fn(), inspectObject: vi.fn(), closeObject: vi.fn(),
  }
  ctx.provide('simulationRuns', runtime as never)
  const declaration = slots.register({ name: 'root', children: {
    'sidebar.workspaceNavigation': { kind: 'list', scope: 'root' }, 'simulation.workspace': { kind: 'single', scope: 'root' },
  } } as never, () => null)
  const fiber = ctx.plugin({ inject: [...inject], apply }, { pageSize: 2, sourceRefreshMs: 20, watchWaitMs: 30, watchRetryMs: 40 })
  try {
    await fiber.await()
    expect(runtime.administration).toHaveBeenCalledWith(expect.anything(), { maxCommands: 64, maxBytes: 262144 })
    const entry = slots.entries('simulation.workspace')[0]!
    const injected = (entry.inject as unknown as () => Injected)()
    await injected.directory('filter')
    await injected.directory('filter', 'next' as never)
    expect(runtime.directory.mock.calls).toEqual([[{ search: 'filter', limit: 2 }], [{ search: 'filter', limit: 2, cursor: 'next' }]])
    const source = { runId: 'run', decisionId: 'decision', sourceIndex: 0 } as Parameters<Injected['watchSource']>[0]
    injected.watchSource(source)
    expect(runtime.watchSource).toHaveBeenCalledWith(source, 20)
    injected.observe('run' as never)
    expect(runtime.observe).toHaveBeenCalledWith('run', { waitMs: 30, retryMs: 40 })
    injected.navigateApplication('http://localhost/?team=exact')
    expect(navigate).toHaveBeenCalledWith('http://localhost/?team=exact')
    await injected.inspect('run' as never)
    expect(runtime.inspect).toHaveBeenCalledWith({ runId: 'run' })
    injected.closeObject(); injected.closeRecovery(); injected.closePreflight(); injected.cancelExport(); injected.pause()
    expect(runtime.closeObject).toHaveBeenCalledOnce()
    expect(runtime.closeRecovery).toHaveBeenCalledOnce()
    expect(runtime.closePreflight).toHaveBeenCalledOnce()
    expect(exporter.cancel).toHaveBeenCalledTimes(2)
    vi.useFakeTimers()
    const create = vi.fn(() => 'blob:records'), revoke = vi.fn()
    vi.stubGlobal('URL', class extends URL {
      static override createObjectURL = create
      static override revokeObjectURL = revoke
    })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    await injected.exportRecords({ runId: 'run' as never, mode: 'metadata' })
    expect(create).toHaveBeenCalledOnce()
    expect(click).toHaveBeenCalledOnce()
    vi.runAllTimers()
    expect(revoke).toHaveBeenCalledWith('blob:records')
    const palette = commands.sections().find(section => section.id === 'simulation.runs')!
    expect(palette.label).toBe('Simulation runs')
    palette.items[0]!.run(); palette.items[1]!.run()
    expect(clear).toHaveBeenCalledTimes(2)
    expect(new URL(navigate.mock.calls.at(-1)![0]).searchParams.get('simulation')).toBe('run')
    const navigation = slots.entries('sidebar.workspaceNavigation')[0]!
    ;(navigation.inject as () => { open: () => void })().open()
    expect(showWorkspace).toHaveBeenCalledWith('simulation')
    state.set({ directory: { loading: false, stale: false } })
    expect(commands.sections()[0]?.items).toHaveLength(1)
  } finally {
    await fiber.dispose()
    expect(slots.entries('simulation.workspace')).toEqual([])
    expect(slots.entries('sidebar.workspaceNavigation')).toEqual([])
    expect(commands.sections()).toEqual([])
    expect(showWorkspace).toHaveBeenLastCalledWith('team')
    declaration()
    await ctx.fiber.dispose()
  }
})

it('advertises the Host module only with its declared product capability and performs no execution', () => {
  expect(hostInject).toEqual(['simulationProducts'])
  expect(() => { hostApply() }).not.toThrow()
})
