/** Overview task board: loaded task cards grouped by phase under authoritative counts. */
import { useLayoutEffect, useMemo, useRef } from 'react'
import { Avatar } from '@clocky/clocky-client-ui-primitives'
import { Odometer, prefersReducedMotion, tokenDuration, useLiveChanges, useLiveTransition } from '@clocky/clocky-client-ui-viz'
import type { TeamTaskId } from '@clocky/clocky-client-runtime/client'
import type { TeamPageProps } from './TeamPage.tsx'
import css from './TeamWorkspace.module.css'

type TaskSummary = NonNullable<TeamPageProps['collections']>['tasks']['items'][number]
type TaskPhase = TaskSummary['phase']
type Counts = TeamPageProps['state']['counts']['tasks']

/** Board columns in work order; each lists the phases it gathers. */
export const BOARD_COLUMNS = [
  { id: 'pending', phases: ['pending'] },
  { id: 'active', phases: ['assigned', 'running'] },
  { id: 'review', phases: ['review'] },
  { id: 'completed', phases: ['completed'] },
  { id: 'closed', phases: ['failed', 'cancelled'] },
] as const satisfies readonly { id: string; phases: readonly TaskPhase[] }[]

/** Cards shown per column before "view all"; the counts stay authoritative. */
const CARDS_PER_COLUMN = 4

/**
 * Render the board.
 * @param props.tasks - the loaded task page (bounded, may be a subset).
 * @param props.counts - authoritative per-phase counts for the whole Team.
 * @param props.ownerName - resolve a member's display name.
 * @param props.openTask - open one task's inspector.
 * @returns one labeled list per column.
 */
export function TaskBoard({ teamId, cursor, tasks, counts, ownerName, openTask, translate: t }: {
  /** Owner identity and cursor: card moves and count rolls animate only for live changes. */
  teamId?: string | undefined
  cursor?: number | undefined
  tasks: readonly TaskSummary[]
  counts: Counts
  ownerName: (id: TaskSummary['ownerId']) => string
  openTask: (id: TeamTaskId) => void
  translate: TeamPageProps['translate']
}) {
  const board = useRef<HTMLDivElement>(null)
  const rects = useRef(new Map<string, DOMRect>())
  const signatures = useMemo(() => new Map(tasks.map(task => [task.id as string, task.phase])), [tasks])
  const moved = useLiveChanges(teamId ?? '', signatures)
  const live = useLiveTransition(teamId ?? '', cursor, JSON.stringify(counts))
  // FLIP (L2): a card that changed column live slides from its old box; a
  // newer move interrupts the running one. Settled renders only record boxes.
  useLayoutEffect(() => {
    const root = board.current
    if (root === null) return
    const next = new Map<string, DOMRect>()
    for (const card of root.querySelectorAll<HTMLElement>('[data-task-card]')) {
      const id = card.dataset.taskCard ?? ''
      const box = card.getBoundingClientRect()
      next.set(id, box)
      const before = rects.current.get(id)
      if (!moved.has(id) || typeof card.animate !== 'function') continue
      for (const running of card.getAnimations()) running.cancel()
      const duration = tokenDuration(card, prefersReducedMotion() ? '--clocky-duration-fade' : '--clocky-duration-deliberate', 400)
      const tier = card.dataset.motionTier
      card.dataset.motionTier = 'L2'
      const animation = card.animate(before === undefined || prefersReducedMotion()
        ? [{ opacity: 0 }, { opacity: 1 }]
        : [{ transform: `translate(${String(before.left - box.left)}px, ${String(before.top - box.top)}px)` }, { transform: 'none' }],
      { duration, easing: 'cubic-bezier(0.2, 0, 0, 1)' })
      const restore = () => { if (tier === undefined) delete card.dataset.motionTier; else card.dataset.motionTier = tier }
      animation.onfinish = restore
      animation.oncancel = restore
    }
    rects.current = next
  })
  return <div ref={board} className={css.board}>
    {BOARD_COLUMNS.map((column) => {
      const phases: readonly TaskPhase[] = column.phases
      const total = phases.reduce((sum, phase) => sum + counts[phase], 0)
      const cards = tasks.filter(task => phases.includes(task.phase)).slice(0, CARDS_PER_COLUMN)
      const label = t(`board.${column.id}`)
      return <section key={column.id} className={css.boardColumn} data-column={column.id} aria-label={`${label} ${String(total)}`}>
        <h3><span>{label}</span><span className={css.boardCount}><Odometer text={String(total)} live={live.live} /></span></h3>
        {cards.length === 0
          ? <p className={css.boardEmpty}>{total === 0 ? '—' : t('board.notLoaded')}</p>
          : <ul>{cards.map((task) => {
            const owner = task.ownerId === undefined ? undefined : ownerName(task.ownerId)
            return <li key={task.id} className={css.boardCard} data-phase={task.phase} data-task-card={task.id}
              data-motion-tier={task.phase === 'running' || task.phase === 'assigned' ? 'L1' : undefined}>
              <button type="button" className={css.boardSubject} onClick={() => { openTask(task.id) }}>{task.subject.text}</button>
              <div className={css.boardMeta}>
                {owner === undefined
                  ? <span>{t('detail.task.unassigned')}</span>
                  : <><Avatar name={owner} size={20} decorative /><span>{owner}</span></>}
                {task.dependencyCount > 0 && <span className={css.boardBlocker}>{t('board.dependencies', { count: task.dependencyCount })}</span>}
                {task.cancellationRequested && <span className={css.boardBlocker}>{t('detail.task.phase.stopping')}</span>}
              </div>
            </li>
          })}</ul>}
      </section>
    })}
  </div>
}
