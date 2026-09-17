/** Team identity, lifecycle controls, and module navigation share one stable header. */
import { useLayoutEffect, useRef, useState } from 'react'
import { Button, Menu, Modal, IconEllipsisOutline16, IconChevronDownOutline14 } from '@clocky/clocky-client-ui-primitives'
import type { TeamPageProps } from './TeamPage.tsx'
import type { TeamWorkspaceView } from './workspace-store.ts'
import { teamPhaseKey } from './locales.ts'
import css from './TeamWorkspace.module.css'

/**
 * Render Team navigation without granting Session inspection any execution authority.
 * @param props - current Team, localized labels, module selection, and existing lifecycle actions.
 * @returns the Team header and its explicit cancellation confirmation.
 */
export function TeamHeader({ state, view, onViewChange, translate: t, onCancel, onResume, openCoordinator }: Pick<TeamPageProps,
  'state' | 'translate' | 'onCancel' | 'onResume' | 'openCoordinator' | 'onViewChange'> & { view: TeamWorkspaceView }) {
  const [teamMenu, setTeamMenu] = useState(false)
  const [viewMenu, setViewMenu] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const { team } = state
  const objective = state.metadata?.kind === 'available' ? state.metadata.goal.objective : state.goal.objective.text
  const titleRef = useRef<HTMLHeadingElement>(null)
  const [expandedGoal, setExpandedGoal] = useState(false)
  const [clippedGoal, setClippedGoal] = useState(false)
  useLayoutEffect(() => {
    const element = titleRef.current
    if (element === null) return
    const measure = () => { setClippedGoal(element.scrollHeight > element.clientHeight + 1) }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure)
    observer?.observe(element)
    window.addEventListener('resize', measure)
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure) }
  }, [objective, expandedGoal])
  const coordinatorBinding = state.coordinator.kind === 'bound' ? state.coordinator.binding : undefined
  const terminal = ['completed', 'failed', 'cancelled'].includes(team.phase)
  const canResume = onResume !== undefined && !terminal && (team.phase === 'stalled' || coordinatorBinding?.activation.status === 'offline')
  const canCancel = onCancel !== undefined && state.cancellation === undefined && ['active', 'quiescing', 'stalled'].includes(team.phase)
  const run = async (operation: () => Promise<void>) => {
    setBusy(true)
    setError(undefined)
    try { await operation(); setConfirmCancel(false) }
    catch (reason: unknown) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }
  return <header className={css.header}>
    {team.workspacePath !== undefined &&
       <p
         className={css.breadcrumb}
         title={team.workspacePath}>{team.workspacePath.split(/[\\/]/u).filter(Boolean).at(-1)}</p>}
    <div className={css.headerRow}>
      <div className={css.heading}>
        <div className={css.objective}>
          <h1 ref={titleRef} data-expanded={expandedGoal || undefined}>{objective}</h1>
          {(clippedGoal || expandedGoal) && <Button size="sm" aria-expanded={expandedGoal}
            onClick={() => { setExpandedGoal(value => !value) }}>
            {t(expandedGoal ? 'overview.collapse' : 'workspace.fullObjective')}
          </Button>}
        </div>
        {state.metadata?.kind === 'unavailable' && <p role="status">{t('workspace.metadataUnavailable')}</p>}
        <span
          className={css.teamPhase}
          data-team-phase
          data-phase={team.phase}>{t(teamPhaseKey[team.phase])}</span></div>
      <div className={css.headerActions}>
        {canResume && <Button variant="outline" disabled={busy} onClick={() => { void run(onResume) }}>{t('resume')}</Button>}
        {openCoordinator !== undefined && <Button variant="outline" disabled={busy} onClick={() => { void run(openCoordinator) }}>{t('workspace.openCoordinator')}</Button>}
        {canCancel && <Menu open={teamMenu} portal align="end" onClose={() => { setTeamMenu(false) }}
          anchor={<Button aria-label={t('workspace.teamActions')} aria-expanded={teamMenu} onClick={() => { setTeamMenu(value => !value) }}><IconEllipsisOutline16 /></Button>}
          items={[{ id: 'cancel', label: t('workspace.stopTeam'), danger: true }]}
          onSelect={() => { setTeamMenu(false); setError(undefined); setConfirmCancel(true) }} />}
      </div>
    </div>
    {state.stallReason !== undefined && <p className={css.headerError} role="alert">{state.stallReason.message.text}</p>}
    {state.cancellation !== undefined && <p className={css.breadcrumb} role="status">{state.cancellation.reason.text}</p>}
    {error !== undefined && !confirmCancel && <p className={css.headerError} role="alert">{error}</p>}
    {onViewChange !== undefined && <nav className={css.navigation} aria-label={t('workspace.navigation')}>
      {(['overview', 'tasks', 'channels', 'members', 'artifacts'] as const).map(item => <button type="button" key={item}
        aria-current={view === item ? 'page' : undefined} onClick={() => { onViewChange(item) }}>{t(`workspace.${item}`)}</button>)}
      <Menu open={viewMenu} portal items={[
        { id: 'workflows', label: t('workspace.workflows') }, { id: 'audit', label: t('workspace.audit') },
      ]} onClose={() => { setViewMenu(false) }}
      anchor={<button type="button" aria-expanded={viewMenu} aria-current={view === 'workflows' || view === 'audit' ? 'page' : undefined}
        onClick={() => { setViewMenu(value => !value) }}>{view === 'workflows' || view === 'audit' ? t(`workspace.${view}`) : t('workspace.more')}<IconChevronDownOutline14 /></button>}
      onSelect={(id) => { setViewMenu(false); if (id === 'workflows' || id === 'audit') onViewChange(id) }} />
    </nav>}
    <Modal open={confirmCancel} title={t('workspace.stopTeam')} description={t('workspace.stopDescription', { objective: objective })}
      closeLabel={t('detail.task.stopCancel')} onClose={() => { if (!busy) setConfirmCancel(false) }}
      footer={<><Button variant="outline" disabled={busy} onClick={() => { setConfirmCancel(false) }}>{t('detail.task.stopCancel')}</Button>
        <Button variant="outline" disabled={busy || !canCancel} onClick={() => { if (onCancel !== undefined) void run(onCancel) }}>{t('workspace.stopTeam')}</Button></>}>
      {busy && <p role="status">{t('detail.task.stopLoading')}</p>}
      {error !== undefined && <p className={css.headerError} role="alert">{error}</p>}
    </Modal>
  </header>
}
