/** Team identity, lifecycle controls, and module navigation share one stable header. */
import { useId, useRef, useState } from 'react'
import {
  Button, IconButton, Menu, Modal, Popover, StatusBadge, writeClipboard,
  IconChevronDownOutline14, IconEllipsisOutline16, IconWarningOutline16,
} from '@clocky/clocky-client-ui-primitives'
import type { TeamPageProps } from './TeamPage.tsx'
import type { TeamWorkspaceView } from './workspace-store.ts'
import { teamPhaseKey } from './locales.ts'
import { deriveShortTitle, teamStatus } from './team-row.ts'
import { MissionBanner } from './MissionBanner.tsx'
import { navigateWithTransition, transitionDirection, useSlidingIndicator } from '@clocky/clocky-client-ui-viz'
import vizCss from './TeamViz.module.css'
import css from './TeamWorkspace.module.css'

/** Modules shown inline; the rest live under More. */
const PRIMARY_VIEWS = ['overview', 'tasks', 'channels', 'members', 'artifacts'] as const
const MORE_VIEWS = ['attention', 'workflows', 'audit'] as const

/** Header inputs: the page's Team state and actions plus the selected module. */
type TeamHeaderProps = Pick<TeamPageProps, 'state' | 'translate' | 'onCancel' | 'onResume' | 'openCoordinator' | 'onViewChange'> & {
  view: TeamWorkspaceView
  /** Visible artifacts on the loaded page, for the Artifacts count. */
  artifactCount?: number | undefined
}

/**
 * Render the Team header: where the Team works, what it is doing, its one
 * primary next step, and module navigation. Session inspection gains no
 * execution authority from anything here.
 * @param props - current Team, localized labels, module selection, and existing lifecycle actions.
 * @returns the Team header and its explicit cancellation confirmation.
 */
export function TeamHeader(props: TeamHeaderProps) {
  const { state, view, onViewChange, translate: t, onCancel, onResume, openCoordinator, artifactCount } = props
  const [teamMenu, setTeamMenu] = useState(false)
  const [viewMenu, setViewMenu] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [diagnosisOpen, setDiagnosisOpen] = useState(false)
  const [objectiveOpen, setObjectiveOpen] = useState(false)
  const diagnosisRef = useRef<HTMLButtonElement>(null)
  // The module underline glides to the selected tab (L2 control motion).
  const navigationRef = useRef<HTMLElement>(null)
  const tabIndicator = useSlidingIndicator(navigationRef, 'button[aria-current="page"]', view)
  // Modules slide in tab order: moving right enters from the right.
  const go = (next: TeamWorkspaceView) => {
    if (onViewChange === undefined || next === view) return
    navigateWithTransition(() => { onViewChange(next) }, transitionDirection([...PRIMARY_VIEWS, ...MORE_VIEWS], view, next))
  }
  const objectiveId = useId()
  const { team } = state
  const objective = state.metadata?.kind === 'available' ? state.metadata.goal.objective : state.goal.objective.text
  const shortTitle = deriveShortTitle(objective)
  const coordinatorBinding = state.coordinator.kind === 'bound' ? state.coordinator.binding : undefined
  const terminal = ['completed', 'failed', 'cancelled'].includes(team.phase)
  const simulationManaged = state.executionManagement === 'simulation-managed'
  const canResume = !simulationManaged && onResume !== undefined && !terminal && (team.phase === 'stalled' || coordinatorBinding?.activation.status === 'offline')
  const canCancel = !simulationManaged && onCancel !== undefined && state.cancellation === undefined && ['active', 'quiescing', 'stalled'].includes(team.phase)
  const counts = state.counts.tasks
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0) - counts.deleted
  const viewCount = (item: TeamWorkspaceView): number | undefined =>
    item === 'tasks' ? total : item === 'members' ? state.counts.participants : item === 'artifacts' ? artifactCount : undefined
  const run = async (operation: () => Promise<void>) => {
    setBusy(true)
    setError(undefined)
    try { await operation(); setConfirmCancel(false) }
    catch (reason: unknown) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }
  const coordinatorLabel = t(state.readAccess === 'member' && !simulationManaged && !terminal ? 'workspace.openCoordinator' : 'workspace.inspectCoordinator')
  const folder = team.workspacePath?.split(/[\\/]/u).filter(Boolean).at(-1)
  const stall = state.stallReason
  return <>
    <header className={css.header} style={{ viewTransitionName: 'clocky-mode-team' }}>
      <span className={vizCss.eyebrow}>{t('mode.team.eyebrow')}</span>
      <nav className={css.breadcrumb} aria-label={t('header.breadcrumb')}>
        {folder !== undefined && <><span title={team.workspacePath}>{folder}</span><span aria-hidden="true">›</span></>}
        <span aria-current="page">{shortTitle}</span>
      </nav>
      <div className={css.headerRow}>
        <div className={css.heading}>
          <h1 title={objective}>{shortTitle}</h1>
          <StatusBadge status={teamStatus(team.phase)} title={team.phase}>{t(teamPhaseKey[team.phase])}</StatusBadge>
          {stall !== undefined && <>
            <button ref={diagnosisRef} type="button" className={css.diagnosisTrigger} aria-expanded={diagnosisOpen}
              onClick={() => { setDiagnosisOpen(open => !open) }}>
              <IconWarningOutline16 size={14} />{t('header.whyStalled')}
            </button>
            <Popover open={diagnosisOpen} anchorRef={diagnosisRef} label={t('header.diagnosis')} onClose={() => { setDiagnosisOpen(false) }}>
              <p className={css.diagnosisSummary}>{t('header.stalledSummary')}</p>
              <p className={css.diagnosisDetail}>{stall.message.text}</p>
              <div className={css.diagnosisActions}>
                <Button size="sm" variant="secondary" onClick={() => { void writeClipboard(`${stall.code}\n${stall.message.text}`) }}>
                  {t('header.copyDetails')}
                </Button>
              </div>
            </Popover>
          </>}
        </div>
        <div className={css.headerActions}>
          {canResume
            ? <Button variant="primary" disabled={busy} onClick={() => { void run(onResume) }}>{t('resume')}</Button>
            : openCoordinator !== undefined && <Button variant={terminal ? 'secondary' : 'primary'} disabled={busy}
              onClick={() => { void run(openCoordinator) }}>{coordinatorLabel}</Button>}
          {canResume && openCoordinator !== undefined && <Button variant="secondary" disabled={busy}
            onClick={() => { void run(openCoordinator) }}>{coordinatorLabel}</Button>}
          {canCancel && <Menu open={teamMenu} portal align="end" onClose={() => { setTeamMenu(false) }}
            anchor={<IconButton label={t('workspace.teamActions')} aria-expanded={teamMenu} icon={<IconEllipsisOutline16 />}
              onClick={() => { setTeamMenu(value => !value) }} />}
            items={[{ id: 'cancel', label: t('workspace.stopTeam'), danger: true }]}
            onSelect={() => { setTeamMenu(false); setError(undefined); setConfirmCancel(true) }} />}
        </div>
      </div>
      <MissionBanner state={state} translate={t} />
      {shortTitle !== objective && <div className={css.fullObjective}>
        <button type="button" aria-expanded={objectiveOpen} aria-controls={objectiveId}
          onClick={() => { setObjectiveOpen(open => !open) }}>
          {t(objectiveOpen ? 'overview.collapse' : 'workspace.fullObjective')}
        </button>
        <p id={objectiveId} hidden={!objectiveOpen}>{objective}</p>
      </div>}
      {state.metadata?.kind === 'unavailable' && <p role="status">{t('workspace.metadataUnavailable')}</p>}
      {simulationManaged && <p className={css.headerNote} role="status">{t('workspace.simulationManaged')}</p>}
      {state.cancellation !== undefined && <p className={css.headerNote} role="status">{state.cancellation.reason.text}</p>}
      {error !== undefined && !confirmCancel && <p className={css.headerError} role="alert">{error}</p>}
      <Modal open={confirmCancel} title={t('workspace.stopTeam')} description={t('workspace.stopDescription', { objective: objective })}
        closeLabel={t('detail.task.stopCancel')} onClose={() => { if (!busy) setConfirmCancel(false) }}
        footer={<><Button variant="secondary" disabled={busy} onClick={() => { setConfirmCancel(false) }}>{t('detail.task.stopCancel')}</Button>
          <Button variant="danger" disabled={busy || !canCancel} onClick={() => {
          /* v8 ignore next -- Confirmation is disabled when the cancel owner is absent. */
            if (onCancel !== undefined) void run(onCancel)
          }}>{t('workspace.stopTeam')}</Button></>}>
        {busy && <p role="status">{t('detail.task.stopLoading')}</p>}
        {error !== undefined && <p className={css.headerError} role="alert">{error}</p>}
      </Modal>
    </header>
    {onViewChange !== undefined && <nav ref={navigationRef} className={css.navigation} aria-label={t('workspace.navigation')}>
      <span className={vizCss.tabIndicator} data-ready={tabIndicator.ready || undefined} style={tabIndicator.style} aria-hidden="true" />
      {PRIMARY_VIEWS.map((item) => {
        const count = viewCount(item)
        return <button type="button" key={item} aria-current={view === item ? 'page' : undefined}
          onClick={() => { go(item) }}>
          {t(`workspace.${item}`)}
          {count !== undefined && <span className={css.navCount} data-zero={count === 0 || undefined} aria-hidden="true">{count}</span>}
        </button>
      })}
      <Menu open={viewMenu} portal items={MORE_VIEWS.map(id => ({ id, label: t(`workspace.${id}`) }))}
        onClose={() => { setViewMenu(false) }}
        anchor={<button type="button" aria-expanded={viewMenu} aria-current={(MORE_VIEWS as readonly string[]).includes(view) ? 'page' : undefined}
          onClick={() => { setViewMenu(value => !value) }}>{(MORE_VIEWS as readonly string[]).includes(view) ? t(`workspace.${view}`) : t('workspace.more')}<IconChevronDownOutline14 /></button>}
        onSelect={(id) => { setViewMenu(false)
          /* v8 ignore next -- Menu emits only the three IDs from MORE_VIEWS. */
          if (id === 'workflows' || id === 'audit' || id === 'attention') go(id) }} />
    </nav>}
  </>
}
