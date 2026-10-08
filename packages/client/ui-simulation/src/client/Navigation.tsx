/** Same-level product navigation consumes this feature's shared view store. */
import type { PropsRuntime, PropsStore, PropsLocale } from '@clocky/clocky-client-ui-slots'
import { Button, IconGlobeOutline14 } from '@clocky/clocky-client-ui-primitives'
import type { createSimulationStore } from './store.ts'
import { writeRoute } from './store.ts'
import { navigateWithTransition } from '@clocky/clocky-client-ui-viz'
type NavigationProps = PropsRuntime<'sidebar.workspaceNavigation'> & PropsStore<ReturnType<typeof createSimulationStore>>
  & PropsLocale<'simulation'> & { open: () => void }
/** @param props - Framework view store and navigation callback. @returns the product navigation button. */
export function Navigation({ wide, workspace, useStore, open, t }: NavigationProps) {
  const view = useStore(state => state)
  return <Button onClick={() => { const go = () => { writeRoute(view); open() }; if (workspace === 'simulation') go(); else navigateWithTransition(go, 'page') }} aria-label={t('title')} aria-current={workspace === 'simulation' ? 'page' : undefined}
    icon={<IconGlobeOutline14 size={16} />} style={{ width: '100%' }}>{wide ? t('title') : null}</Button>
}
