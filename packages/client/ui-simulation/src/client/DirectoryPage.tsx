/** Run directory page: launch header, bounded run list and directory-level retained originals. */
import type { ReactNode } from 'react'
import { Button } from '@clocky/clocky-client-ui-primitives'
import type { SimulationCommandState, SimulationRuntimeState } from '@clocky/clocky-client-runtime/client'
import { RunDirectory } from './RunDirectory.tsx'
import { Feedback, RefreshFeedback } from './Feedback.tsx'
import { observedClock } from './RunStateChip.tsx'
import { useRefreshOutcome } from './useRefreshOutcome.ts'
import { AmbientToggle } from './RunCommandBar.tsx'
import type { Props } from './Workspace.tsx'
import type { Route, SimulationViewState } from './store.ts'
import type { RunReads } from './useRunReads.ts'
import css from './Workspace.module.css'

/**
 * @param props - Workspace reads, current snapshots and view-only navigation.
 * @returns directory header, run list and retained originals without dialogs.
 */
export function DirectoryPage({ workspace, view, data, reads, authorized, retained, navigate, renderOriginal, date, locale }: {
  workspace: Props
  view: SimulationViewState
  data: SimulationRuntimeState
  reads: RunReads
  authorized: boolean
  retained: readonly (readonly [string, SimulationCommandState])[]
  navigate: (next: Route) => void
  renderOriginal: (record: SimulationCommandState) => ReactNode
  date: (value: number) => string
  locale: string
}) {
  const t = workspace.t
  const current = data.directory
  // Procurement creation is offered only when the Host installs procurement templates; World authoring is always available.
  const procurementTemplates = data.catalog.value === undefined || data.catalog.value.items.length > 0
  const refreshed = useRefreshOutcome({ ...current, error: current.error ?? reads.statuses.error }, data.connected,
    workspace.staleAfterMs, 'directory')
  return <>
    {/* The directory header continues the launch tile. */}
    <header className={css.header} style={{ viewTransitionName: 'clocky-mode-simulation' }}>
      <div><span className={css.eyebrow}>{t('mode.eyebrow')}</span>
        <h1>{t('title')}</h1>
        <p className={css.muted}>{t('readOnly')}</p></div>
      <div className={css.actions}><Button variant={procurementTemplates ? 'secondary' : 'primary'}
        disabled={!data.connected || !authorized}
        onClick={() => { workspace.actions.choosingWorld(true) }}>{t('world.new')}</Button><Button variant="secondary" disabled={!data.connected || !authorized}
        onClick={() => { workspace.actions.creatingWorld(true) }}>{t('world.import')}</Button>{procurementTemplates
        && <Button variant="primary" disabled={!data.connected || !authorized}
          onClick={() => { workspace.actions.creating(true) }}>{t('createTitle')}</Button>}
      <RefreshFeedback value={refreshed.outcome} time={at => observedClock(at, locale)} t={t} />
      <Button variant="secondary" disabled={!data.connected || current.loading} onClick={() => { refreshed.start(reads.refresh()) }}
        aria-busy={current.loading}>{t('refresh')}</Button>
      <AmbientToggle t={t} /></div>
    </header>
    {!data.connected && <p className={css.notice} role="status">{t('connection')}</p>}
    <Feedback value={current} t={t} />
    <RunDirectory directory={data.directory} statuses={reads.statuses} directoryIds={reads.directoryIds}
      catalog={data.catalog} create={() => { workspace.actions.creating(true) }} newWorld={() => { workspace.actions.choosingWorld(true) }}
      connected={data.connected} search={view.search} draftSearch={view.draftSearch} searchDraft={workspace.actions.searchDraft}
      navigate={navigate} refresh={() => { void reads.refresh() }} readDirectory={workspace.directory} runStatuses={workspace.runStatuses}
      t={t} date={date}
      invalidatedRuns={data.invalidatedRuns} refreshMs={workspace.controlRefreshMs} staleAfterMs={workspace.staleAfterMs} locale={locale} />
    {retained.length > 0 && <details className={css.operations}>
      <summary>{t('operationsRetained')} · {retained.length}</summary>
      <div>{retained.map(([, record]) => renderOriginal(record))}</div>
    </details>}
  </>
}
