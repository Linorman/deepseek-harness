/** Metadata navigation never substitutes for the destination's Team and Session authorization. */
import { teamInspectionUrl } from '@clocky/clocky-client-ui-layout/client'
import type { TeamInspectionTarget } from '@clocky/clocky-client-ui-layout/client'
import type { Key } from './locales.ts'
import css from './Workspace.module.css'

/**
 * @param props - Exact reference and same-document navigation, with native new-tab behavior.
 * @returns a shareable read link; no run owner or automatic execution is requested.
 */
export function TeamReference({ target, id, navigateApplication, t }: {
  target: TeamInspectionTarget
  id: string
  navigateApplication?: ((href: string) => void) | undefined
  t: (key: Key) => string
}) {
  const href = teamInspectionUrl(window.location.href, target)
  return <a className={css.reference} href={href} aria-label={`${t(target.kind === 'team' ? 'inspectTeam' : target.kind === 'task'
    ? 'inspectTeamTask' : target.kind === 'channel' ? 'inspectTeamChannel' : 'inspectTeamSession')}: ${id}`}
  onClick={(event) => {
    if (navigateApplication === undefined || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    navigateApplication(href)
  }}>{id}</a>
}
