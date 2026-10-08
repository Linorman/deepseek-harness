/** Shared model-setup recovery uses the settings shell's external-open lifecycle. */
import type { InjectFace, PropsLocale, PropsRuntime } from '@clocky/clocky-client-ui-slots'
import { Button } from '@clocky/clocky-client-ui-primitives'
import type {} from '@clocky/clocky-client-ui-settings/client'

type Props = PropsRuntime<'settings.model-setup'> & PropsLocale<'settings'> & InjectFace<{
  open: (afterClose: () => void) => void
}>

/** @param props - Caller-owned suspension/resume and shell-owned model navigation. @returns one localized recovery action. */
export function ModelSetupAction({ beforeOpen, afterClose, open, t }: Props) {
  return <Button variant="primary" onClick={() => { beforeOpen(); open(afterClose) }}>{t('configureModels')}</Button>
}
