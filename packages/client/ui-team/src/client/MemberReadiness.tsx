/** Shared execution-state presentation for member cards and exact member inspection. */
import type { TeamMemberReadinessRecord } from '@clocky/clocky-client-runtime/client'
import type { TeamKey } from './locales.ts'
import css from './TeamBrowser.module.css'

/** Display Host-owned execution facts independently of participation labels.
 * @param props - Current observation, staleness and localized labels.
 * @returns execution state and explicit deployment or recovery reasons.
 */
export function MemberReadiness({ value, stale = false, details = false, translate: t }: {
  readonly value?: TeamMemberReadinessRecord | undefined
  readonly stale?: boolean
  readonly details?: boolean
  readonly translate: (key: TeamKey, vars?: Record<string, unknown>) => string
}) {
  return <div className={css.memberReadiness} data-member-readiness>
    <span>{t('readiness.execution')}: {t(value === undefined ? 'readiness.unavailable' : `readiness.state.${value.state}`)}</span>
    {stale && <span> · {t('readiness.stale')}</span>}
    {value !== undefined && value.reasons.length > 0 && <p>{value.reasons.map(reason => t(`readiness.reason.${reason}`)).join(' · ')}</p>}
    {details && value !== undefined && <>
      {value.configuration !== undefined && <p>{t('readiness.configuration')}: <code>{value.configuration}</code></p>}
      <p>{t('readiness.observation')}: <code>{value.observationId}</code></p>
      <p>{t('readiness.advisory')}</p>
    </>}
  </div>
}
