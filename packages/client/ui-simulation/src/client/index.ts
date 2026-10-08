/** Opt-in Simulation navigation and read-only workspace registration; runtime owns all business responses. */
import type { ClientContext, SimulationProductCursor } from '@clocky/clocky-client-runtime/client'
import type {} from '@clocky/clocky-client-ui-layout/client'
import type {} from '@clocky/clocky-client-ui-conversation/client'
import type {} from '@clocky/clocky-client-ui-settings/client'
import type {} from '@clocky/clocky-client-ui-sidebar/client'
import type {} from '@clocky/clocky-client-locale/client'
import { Navigation } from './Navigation.tsx'
import { ModeCard } from './ModeCard.tsx'
import { Config } from '../config.ts'
import { Workspace } from './Workspace.tsx'
import { createSimulationStore, routeUrl } from './store.ts'
import { en, zh } from './locales.ts'
import type { Key } from './locales.ts'
export { Config } from '../config.ts'
export { createSimulationStore } from './store.ts'

declare module '@clocky/clocky-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Simulation navigation and metadata inspection copy. */
    simulation: Key
  }
}

/** Required live data, view composition, connection and locale owners. */
export const inject = ['slots', 'simulationRuns', 'sessions', 'layout', 'locale']

/**
 * Register independent product navigation and one metadata workspace.
 * @param ctx - Client composition with the shared runtime and layout services.
 * @param config - Public deployment page allowance.
 * @returns nothing; subscriptions, store handles and entries retire with the plugin.
 */
export function apply(ctx: ClientContext, config: Config = {}): void {
  const options = Config.parse(config)
  const store = createSimulationStore(options.maxDraftBytes, options.maxInputDrafts)
  const administration = ctx.simulationRuns.administration(ctx,
    { maxCommands: options.maxRetainedCommands, maxBytes: options.maxCommandBytes })
  const exporter = ctx.simulationRuns.recordExporter(ctx,
    { maxBytes: options.maxExportBytes, maxPages: options.maxExportPages, pageSize: options.pageSize })
  const exportRecords = (input: Parameters<typeof exporter.start>[0]) => exporter.start(input, (file) => {
    const url = URL.createObjectURL(new Blob([file.text], { type: 'application/json;charset=utf-8' }))
    const link = document.createElement('a')
    try { link.href = url; link.download = file.name; document.body.append(link); link.click() }
    finally { link.remove(); window.setTimeout(() => { URL.revokeObjectURL(url) }, 0) }
  })
  const directory = async (search: string, cursor?: SimulationProductCursor) => {
    await ctx.simulationRuns.directory({ search, limit: options.pageSize, ...cursor === undefined ? {} : { cursor } })
  }
  const pause = () => { exporter.cancel(); ctx.simulationRuns.pause() }
  const teams = () => { ctx.layout.showWorkspace('team') }
  ctx.effect(() => ctx.locale.register('simulation', { en, zh }), 'simulation UI: localized feedback')
  ctx.effect(() => () => { pause(); teams() }, 'simulation UI: view lifetime')
  const ts = ctx.locale.bind('simulation')
  const openRoute = (runId?: string) => {
    ctx.sessions.clear()
    ctx.layout.navigate(routeUrl({ runId, module: 'overview', search: '' }).href)
  }
  ctx.effect(() => ctx.layout.registerCommands({
    id: 'simulation.runs',
    label: () => ts('palette.runs'),
    // Only the loaded directory page; opening a run reuses the deep-link owner.
    items: () => [
      { id: 'open', label: ts('palette.open'), run: () => { openRoute() } },
      ...(ctx.simulationRuns.state.getSnapshot().directory.value?.items ?? []).map(item => ({
        id: item.id, label: item.name.text, keywords: [item.id], run: () => { openRoute(item.id) },
      })),
    ],
  }), 'simulation UI: palette runs')
  ctx.slots.inject('sidebar.workspaceNavigation', () => ctx.slots.register({ name: 'sidebar.workspaceNavigation', id: 'simulation',
    locale: 'simulation', store, inject: () => ({ open: () => { ctx.sessions.clear(); ctx.layout.showWorkspace('simulation') } }),
  }, Navigation))
  ctx.slots.inject('conversation.hero.modes', () => ctx.slots.register({ name: 'conversation.hero.modes', id: 'simulation',
    locale: 'simulation', inject: () => ({ open: (runId?: string) => { openRoute(runId) }, readDirectory: async () => { await directory('') },
      hooks: { simulation: ctx.simulationRuns.state } }),
  }, ModeCard))
  ctx.slots.inject('simulation.workspace', () => ctx.slots.register({ name: 'simulation.workspace', locale: 'simulation', store,
    children: { 'settings.model-setup': { kind: 'single', scope: 'root' } },
    inject: () => ({
      unknownOperations: ctx.simulationRuns.unknownOperations.bind(ctx.simulationRuns),
      runStatuses: ctx.simulationRuns.runStatuses.bind(ctx.simulationRuns),
      listTaskReviews: ctx.simulationRuns.listTaskReviews.bind(ctx.simulationRuns),
      listRequests: ctx.simulationRuns.listRequests.bind(ctx.simulationRuns),
      listTasks: ctx.simulationRuns.listTasks.bind(ctx.simulationRuns),
      navigateApplication: (href: string) => { ctx.layout.navigate(href) },
      watchSource: (input: Parameters<typeof ctx.simulationRuns.watchSource>[0]) =>
        ctx.simulationRuns.watchSource(input, options.sourceRefreshMs),
      inspectSource: ctx.simulationRuns.inspectSource.bind(ctx.simulationRuns),
      refreshSource: ctx.simulationRuns.refreshSource.bind(ctx.simulationRuns),
      exportRecords, cancelExport: () => { exporter.cancel() },
      readRecords: ctx.simulationRuns.readRecords.bind(ctx.simulationRuns),
      closeRecords: ctx.simulationRuns.closeRecords.bind(ctx.simulationRuns),
      pageSize: options.pageSize, maxDraftBytes: options.maxDraftBytes,
      controlRefreshMs: options.controlRefreshMs, directory, pause,
      observe: (runId: Parameters<typeof ctx.simulationRuns.observe>[0]) =>
        ctx.simulationRuns.observe(runId, { waitMs: options.watchWaitMs, retryMs: options.watchRetryMs }),
      readRecovery: ctx.simulationRuns.inspectRecovery.bind(ctx.simulationRuns),
      closeRecovery: () => { ctx.simulationRuns.closeRecovery() },
      catalog: ctx.simulationRuns.catalog.bind(ctx.simulationRuns), control: ctx.simulationRuns.control.bind(ctx.simulationRuns),
      preflight: ctx.simulationRuns.preflight.bind(ctx.simulationRuns), closePreflight: () => { ctx.simulationRuns.closePreflight() },
      retain: administration.retain.bind(administration), submit: administration.submit.bind(administration),
      query: administration.query.bind(administration), release: administration.release.bind(administration),
      inspect: async (runId: Parameters<typeof ctx.simulationRuns.inspect>[0]['runId']) => {
        await ctx.simulationRuns.inspect({ runId })
      },
      browse: ctx.simulationRuns.browse.bind(ctx.simulationRuns), inspectObject: ctx.simulationRuns.inspectObject.bind(ctx.simulationRuns),
      closeObject: () => { ctx.simulationRuns.closeObject() },
      hooks: { recordsExport: exporter.state, simulation: ctx.simulationRuns.state, administration: administration.state,
        formatLocale: ctx.locale } }),
  }, Workspace))
}
