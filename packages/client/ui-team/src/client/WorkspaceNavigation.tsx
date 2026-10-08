/** Product navigation changes the visible domain without discarding the retained Team view. */
import type { PropsLocale, PropsRuntime } from '@clocky/clocky-client-ui-slots'
import { Button, IconGoalOutline16 } from '@clocky/clocky-client-ui-primitives'
import { navigateWithTransition } from '@clocky/clocky-client-ui-viz'

type Props = PropsRuntime<'sidebar.workspaceNavigation'> & PropsLocale<'team'> & { open: () => void }
/** @param props - Shared sidebar geometry/domain and the existing layout action. @returns a localized workspace entry. */
export function WorkspaceNavigation({ wide, workspace, expandSidebar, open, t }: Props) {
  return <Button onClick={() => { if (workspace !== 'team') navigateWithTransition(open, 'page'); else open(); if (!wide) expandSidebar() }} aria-label={t('workspace.entry')} aria-current={workspace === 'team' ? 'page' : undefined}
    icon={<IconGoalOutline16 />}>{wide ? t('workspace.entry') : null}</Button>
}
