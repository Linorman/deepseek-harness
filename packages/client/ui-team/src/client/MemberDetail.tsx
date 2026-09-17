/** On-demand member detail owns a single capability page and no background Team cache. */
import { useEffect, useRef, useState } from 'react'
import { Button, Modal } from '@clocky/clocky-client-ui-primitives'
import type { ITeamTasks, ParticipantId, TeamId } from '@clocky/clocky-client-runtime/client'
import css from './TeamBrowser.module.css'
import type { TeamKey } from './locales.ts'
type Inspect = NonNullable<ITeamTasks['inspectMember']>
type Detail = Awaited<ReturnType<Inspect>>

/** Display exact member metadata and replace capability pages only after successful reads.
 * @param props - Exact selection, runtime reader, localized labels and close action.
 * @returns an inspection dialog with explicit refresh and continuation.
 */
export function MemberDetail({ teamId, participantId, inspect, translate: t, onClose }: {
  teamId: TeamId
  participantId: ParticipantId
  inspect: Inspect
  translate: (key: TeamKey, vars?: Record<string, unknown>) => string
  onClose: () => void
}) {
  const [value, setValue] = useState<Detail>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const request = useRef<AbortController>()
  const read = async (mode: 'first' | 'next' | 'refresh') => {
    const previous = value
    const window = mode === 'first' ? { afterCursor: -1 } : mode === 'refresh' ? { afterCursor: previous?.startCursor ?? -1 }
      : previous?.nextCursor === undefined ? undefined : { afterCursor: previous.nextCursor, expectedTeamCursor: previous.teamCursor }
    if (window === undefined) return
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setLoading(true); setError(undefined)
    try {
      const result = await inspect({ teamId, participantId, ...window }, controller.signal)
      if (!controller.signal.aborted) setValue(result)
    } catch (cause: unknown) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { if (request.current === controller) { request.current = undefined; setLoading(false) } }
  }
  useEffect(() => {
    void read('first')
    return () => { request.current?.abort() }
  }, [])
  return <Modal open title={t('memberDetail.title')} closeLabel={t('cancel')} onClose={onClose} bodyClassName={css.memberDetail ?? ''}
    footer={<div className={css.memberPages}>
      <Button disabled={loading} onClick={() => { void read('refresh') }}>{t('memberDetail.refresh')}</Button>
      {value !== undefined && value.startCursor >= 0 && <Button disabled={loading} onClick={() => { void read('first') }}>{t('detail.firstPage')}</Button>}
      {value?.nextCursor !== undefined && <Button disabled={loading || error !== undefined} onClick={() => { void read('next') }}>{t('memberDetail.next')}</Button>}
    </div>}>
    {loading && <p role="status">{t('memberDetail.loading')}</p>}
    {error !== undefined && <p role="alert">{error}</p>}
    {value !== undefined && <>
      <h3>{value.record.displayName}</h3><p>{value.record.role} · {t(`detail.participant.phase.${value.record.phase}`)}</p>
      <dl>{(['provider', 'preset', 'model', 'authScheme'] as const).map(field => value.record[field] === undefined ? null
        : <div key={field}><dt>{t(`memberDetail.${field}`)}</dt><dd>{value.record[field]}</dd></div>)}</dl>
      <h4>{t('memberDetail.capabilities')} · {value.total}</h4>
      <ul>{value.items.map((capability, index) => <li key={value.startCursor + index + 1}>{capability}</li>)}</ul>
    </>}
  </Modal>
}
