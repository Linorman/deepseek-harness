/** Only fixed failure categories and canonical retained identities are rendered; provider messages remain withheld. */
import { Button } from '@clocky/clocky-client-ui-primitives'
import type { SimulationProductRequestReceipt, SimulationProductRunId } from '@clocky/clocky-client-runtime/client'
import { TeamReference } from './TeamReference.tsx'
import type { Route } from './store.ts'
import type { Key } from './locales.ts'

type Diagnostic = NonNullable<SimulationProductRequestReceipt['diagnostic']>
/** Canonical subjects link to exact read-only destinations without granting their content. */
export function CheckpointDiagnostic({ value, runId, t, navigate, navigateApplication }: {
  value: Diagnostic
  runId: SimulationProductRunId
  t: (key: Key) => string
  navigate?: ((next: Route) => void) | undefined
  navigateApplication?: ((href: string) => void) | undefined
}) {
  const subject = value.subject
  const reference = () => {
    switch (subject.kind) {
      case 'team': return <TeamReference target={{ kind: 'team', teamId: subject.teamId }} id={subject.teamId}
        navigateApplication={navigateApplication} t={t} />
      case 'session': return <TeamReference target={{ kind: 'session', teamId: subject.teamId,
        participantId: subject.participantId, sessionId: subject.sessionId }} id={subject.sessionId}
      navigateApplication={navigateApplication} t={t} />
      case 'channel': return <TeamReference target={{ kind: 'channel', teamId: subject.teamId, channelId: subject.channelId }}
        id={subject.channelId} navigateApplication={navigateApplication} t={t} />
      case 'entity': return <><code>{subject.entityId}</code>{navigate !== undefined && <Button onClick={() => {
        navigate({ runId, module: 'entities', search: '', objectId: subject.entityId })
      }}>{t('diagnostic.locate')}</Button>}</>
      case 'checkpoint': return <><code>{subject.checkpointId}</code>{navigate !== undefined && <Button onClick={() => {
        navigate({ runId, module: 'checkpoints', search: '', objectId: subject.checkpointId })
      }}>{t('diagnostic.locate')}</Button>}</>
      case 'run': return <><code>{runId}</code>{navigate !== undefined && <Button onClick={() => {
        navigate({ runId, module: 'overview', search: '' })
      }}>{t('diagnostic.locate')}</Button>}</>
      /* v8 ignore next -- the public request schema's discriminated subject union is already closed. */
    }
  }
  return <section aria-label={t('diagnostic.title')}>
    <p>{t(`diagnostic.stage.${value.stage}`)} · {t(`diagnostic.code.${value.code}`)}</p>
    <p>{t(`diagnostic.subject.${subject.kind}`)}: {reference()}</p>
    {value.cleanup === 'unconfirmed' && <p role="status">{t('diagnostic.cleanup')}</p>}
  </section>
}
