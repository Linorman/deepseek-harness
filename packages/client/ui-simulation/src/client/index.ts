/** Opt-in Simulation navigation and read-only workspace registration; runtime owns all business responses. */
import type { ClientContext, SimulationCommandKey, SimulationCommandState, SimulationProductCursor, SimulationProductRunId } from '@clocky/clocky-client-runtime/client'
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
import { serializeScenarioDefinition } from '@clocky/clocky-simulation-scenario'
import { createWorldDomainSource } from './world-domain-source.ts'
import { defaultStaleAfterMs } from './run-state.ts'
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
  const simulationRuns = ctx.simulationRuns
  let retired = false
  const isRetired = () => retired
  const options = Config.parse(config)
  const store = createSimulationStore(options.maxDraftBytes, options.maxInputDrafts,
    { maxBytes: options.maxWorldDraftBytes, maxDrafts: options.maxWorldDrafts })
  const calendar = simulationRuns.worldCalendar(ctx, { maxBytes: options.maxCommandBytes, timeoutMs: options.commandTimeoutMs })
  const runControl = simulationRuns.runControl(ctx, { timeoutMs: options.commandTimeoutMs })
  // A confirmed stop-target receipt supersedes the run's retained control and directory row.
  const updateRunControl = async (runId: SimulationProductRunId, target: Parameters<typeof runControl.update>[0]['target']) => {
    await runControl.update({ runId, target })
    if (runControl.state.getSnapshot().status === 'confirmed') simulationRuns.invalidateRun(runId)
  }
  const retryRunControl = async () => {
    await runControl.retry()
    const state = runControl.state.getSnapshot()
    if (state.status === 'confirmed' && state.input !== undefined) simulationRuns.invalidateRun(state.input.runId)
  }
  const domainReader = simulationRuns.worldDomainReader(ctx)
  const managementReader = simulationRuns.worldManagementReader(ctx)
  const worldDomain = createWorldDomainSource(domainReader, options.pageSize, managementReader)
  const downloadText = (name: string, text: string, type: string) => {
    const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }))
    const link = document.createElement('a')
    try { link.href = url; link.download = name; document.body.append(link); link.click() }
    finally { link.remove(); window.setTimeout(() => { URL.revokeObjectURL(url) }, 0) }
  }
  const administration = simulationRuns.administration(ctx,
    { maxCommands: options.maxRetainedCommands, maxBytes: options.maxCommandBytes })
  // A terminal scheduling, checkpoint or recovery receipt supersedes the run's retained directory row and control.
  const settled = (state: SimulationCommandState | undefined) => {
    const command = state?.command, receipt = state?.receipt
    if (command === undefined || receipt === undefined || receipt.kind === 'ingress') return state
    if (command.kind !== 'manage' && command.kind !== 'checkpoint' && command.kind !== 'restore' && command.kind !== 'prepare') return state
    if (receipt.value.status === 'completed' || receipt.value.status === 'failed') simulationRuns.invalidateRun(command.input.runId)
    return state
  }
  const exporter = simulationRuns.recordExporter(ctx,
    { maxBytes: options.maxExportBytes, maxPages: options.maxExportPages, pageSize: options.pageSize })
  const exportRecords = (input: Parameters<typeof exporter.start>[0]) => exporter.start(input, (file) => {
    const url = URL.createObjectURL(new Blob([file.text], { type: 'application/json;charset=utf-8' }))
    const link = document.createElement('a')
    try { link.href = url; link.download = file.name; document.body.append(link); link.click() }
    finally { link.remove(); window.setTimeout(() => { URL.revokeObjectURL(url) }, 0) }
  })
  const exportWorldDefinition = async (input: { runId: import('@clocky/clocky-client-runtime/client').SimulationProductRunId
    format: 'json' | 'yaml'
    name: string }) => {
    if (retired) return
    const version = simulationRuns.state.getSnapshot().authorizationVersion
    await simulationRuns.exportWorldDefinition({ runId: input.runId })
    const current = simulationRuns.state.getSnapshot(), value = current.worldExport
    if (isRetired() || !current.connected || current.authorizationVersion !== version || value.error !== undefined
      || value.stale || value.value?.runId !== input.runId) return
    const base = input.name.trim().replace(/[\\/:*?"<>|]/g, '-') || 'clocky-world'
    downloadText(`${base}.world.${input.format}`, serializeScenarioDefinition(value.value.definition, input.format),
      input.format === 'json' ? 'application/json' : 'application/yaml')
  }
  const directory = async (search: string, cursor?: SimulationProductCursor) => {
    await simulationRuns.directory({ search, limit: options.pageSize, ...cursor === undefined ? {} : { cursor } })
  }
  const pause = () => {
    if (retired) return
    exporter.cancel(); domainReader.close(); managementReader.close(); simulationRuns.pause()
  }
  ctx.effect(() => ctx.locale.register('simulation', { en, zh }), 'simulation UI: localized feedback')
  ctx.effect(() => () => { pause(); retired = true }, 'simulation UI: view lifetime')
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
      ...(simulationRuns.state.getSnapshot().directory.value?.items ?? []).map(item => ({
        id: item.id, label: item.name.text, keywords: [item.id], run: () => { openRoute(item.id) },
      })),
    ],
  }), 'simulation UI: palette runs')
  ctx.slots.inject('sidebar.workspaceNavigation', () => ctx.slots.register({ name: 'sidebar.workspaceNavigation', id: 'simulation',
    locale: 'simulation', store, inject: () => ({ open: () => { ctx.sessions.clear(); ctx.layout.showWorkspace('simulation') } }),
  }, Navigation))
  ctx.slots.inject('conversation.hero.modes', () => ctx.slots.register({ name: 'conversation.hero.modes', id: 'simulation',
    locale: 'simulation', inject: () => ({ open: (runId?: string) => { openRoute(runId) }, readDirectory: async () => { await directory('') },
      hooks: { simulation: simulationRuns.state } }),
  }, ModeCard))
  ctx.slots.inject('simulation.workspace', () => ctx.slots.register({ name: 'simulation.workspace', locale: 'simulation', store,
    children: { 'settings.model-setup': { kind: 'single', scope: 'root' } },
    inject: () => ({
      unknownOperations: simulationRuns.unknownOperations.bind(simulationRuns),
      runStatuses: simulationRuns.runStatuses.bind(simulationRuns),
      listTaskReviews: simulationRuns.listTaskReviews.bind(simulationRuns),
      listRequests: simulationRuns.listRequests.bind(simulationRuns),
      listTasks: simulationRuns.listTasks.bind(simulationRuns),
      navigateApplication: (href: string) => { ctx.layout.navigate(href) },
      watchSource: (input: Parameters<typeof simulationRuns.watchSource>[0]) =>
        simulationRuns.watchSource(input, options.sourceRefreshMs),
      inspectSource: simulationRuns.inspectSource.bind(simulationRuns),
      refreshSource: simulationRuns.refreshSource.bind(simulationRuns),
      exportRecords, cancelExport: () => { exporter.cancel() },
      readRecords: simulationRuns.readRecords.bind(simulationRuns),
      closeRecords: simulationRuns.closeRecords.bind(simulationRuns),
      pageSize: options.pageSize, maxDraftBytes: options.maxDraftBytes,
      controlRefreshMs: options.controlRefreshMs, staleAfterMs: options.staleAfterMs ?? defaultStaleAfterMs(options.controlRefreshMs),
      directory, pause,
      observe: (runId: Parameters<typeof simulationRuns.observe>[0]) =>
        simulationRuns.observe(runId, { waitMs: options.watchWaitMs, retryMs: options.watchRetryMs }),
      readRecovery: simulationRuns.inspectRecovery.bind(simulationRuns),
      closeRecovery: () => { simulationRuns.closeRecovery() },
      catalog: simulationRuns.catalog.bind(simulationRuns), control: simulationRuns.control.bind(simulationRuns),
      listWorldCases: simulationRuns.listWorldCases.bind(simulationRuns),
      inspectWorldCase: simulationRuns.inspectWorldCase.bind(simulationRuns),
      closeWorldCase: () => { simulationRuns.closeWorldCase() },
      exportWorldDefinition, downloadText, worldReads: worldDomain.reads,
      maxWorldDraftBytes: options.maxWorldDraftBytes, maxWorldDrafts: options.maxWorldDrafts, undoDepth: options.draftUndoDepth,
      inspectorMaxWidth: options.inspectorMaxWidth,
      updateRunControl, retryRunControl, dismissRunControl: () => runControl.dismiss(),
      stopDrain: { maxSteps: options.stopDrainMaxSteps, maxTokens: options.stopDrainMaxTokens,
        maxWallTimeMs: options.stopDrainMaxWallTimeMs },
      previewCalendar: calendar.preview.bind(calendar), submitCalendar: calendar.submit.bind(calendar),
      closeCalendar: calendar.close.bind(calendar),
      recoverCalendar: calendar.recover.bind(calendar), cancelCalendar: calendar.cancel.bind(calendar),
      saveScenarioDraft: simulationRuns.saveScenarioDraft.bind(simulationRuns),
      readScenarioDraft: simulationRuns.readScenarioDraft.bind(simulationRuns),
      preflightWorld: simulationRuns.preflightWorld.bind(simulationRuns),
      closeWorldPreflight: () => { simulationRuns.closeWorldPreflight() },
      preflight: simulationRuns.preflight.bind(simulationRuns), closePreflight: () => { simulationRuns.closePreflight() },
      retain: administration.retain.bind(administration),
      submit: async (key: SimulationCommandKey) => settled(await administration.submit(key)),
      query: async (key: SimulationCommandKey) => settled(await administration.query(key)),
      release: administration.release.bind(administration),
      inspect: async (runId: Parameters<typeof simulationRuns.inspect>[0]['runId']) => {
        await simulationRuns.inspect({ runId })
      },
      browse: simulationRuns.browse.bind(simulationRuns), inspectObject: simulationRuns.inspectObject.bind(simulationRuns),
      closeObject: () => { simulationRuns.closeObject() },
      hooks: { calendar: calendar.state, runControl: runControl.state, recordsExport: exporter.state, simulation: simulationRuns.state,
        administration: administration.state,
        formatLocale: ctx.locale, worldDomain: worldDomain.state } }),
  }, Workspace))
}
