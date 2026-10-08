import { MemberReadiness } from './MemberReadiness.tsx'
/** Present the runtime-owned member page; React retains only clipboard feedback. */
import { useEffect, useState } from 'react'
import { Button, Modal, writeClipboard } from '@clocky/clocky-client-ui-primitives'
import type { ITeamTasks, ParticipantId, TeamId, TeamMemberDetailState } from '@clocky/clocky-client-runtime/client'
import css from './TeamBrowser.module.css'
import type { TeamKey } from './locales.ts'
type Read = NonNullable<ITeamTasks['readMemberDetail']>
// This class is a fixed local export of the imported TeamBrowser stylesheet.
const memberDetailClass = css.memberDetail as string

/** Display exact member metadata and replace capability pages only after successful reads.
 * @param props - Exact selection, runtime reader, localized labels and close action.
 * @returns an inspection dialog with explicit refresh and continuation.
 */
export function MemberDetail({ teamId, participantId, read, closeDetail, detail, readiness,
  readinessStale = false, translate: t, onClose }: {
  readiness?: import('@clocky/clocky-client-runtime/client').TeamMemberReadinessRecord | undefined
  readinessStale?: boolean
  teamId: TeamId
  participantId: ParticipantId
  read: Read
  closeDetail: () => void
  detail?: TeamMemberDetailState | undefined
  translate: (key: TeamKey, vars?: Record<string, unknown>) => string
  onClose: () => void
}) {
  const current = detail?.teamId === teamId && detail.participantId === participantId ? detail : undefined
  const value = current?.value
  const loading = current?.loading ?? false
  const error = current?.error
  const unavailable = loading || current?.disconnected === true
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState<string>()
  useEffect(() => {
    void read(teamId, participantId, 'first')
    return closeDetail
  }, [teamId, participantId, read, closeDetail])
  return <Modal open title={t('memberDetail.title')} closeLabel={t('cancel')} onClose={onClose} bodyClassName={memberDetailClass}
    footer={<div className={css.memberPages}>
      <Button disabled={unavailable} onClick={() => { void read(teamId, participantId, 'refresh') }}>{t('memberDetail.refresh')}</Button>
      {value !== undefined && value.startCursor >= 0 && <Button disabled={unavailable} onClick={() => { void read(teamId, participantId, 'first') }}>{t('detail.firstPage')}</Button>}
      {value?.nextCursor !== undefined && <Button disabled={unavailable || error !== undefined || current?.hasNewer === true} onClick={() => { void read(teamId, participantId, 'next') }}>{t('memberDetail.next')}</Button>}
    </div>}>
    {loading && <p role="status">{t('memberDetail.loading')}</p>}
    {current?.disconnected === true && <p role="status">{t('attention.disconnected')}</p>}
    {current?.hasNewer === true && !current.disconnected && <p role="status">{t('memberDetail.stale')}</p>}
    {error !== undefined && <p role="alert">{error}</p>}
    {value !== undefined && <>
      <h3>{value.record.displayName}</h3><p>{value.record.role} · {t(`detail.participant.phase.${readiness?.participation ?? value.record.phase}`)}</p>
      <dl><div><dt>{t('memberDetail.id')}</dt><dd><code>{participantId}</code></dd></div></dl>
      <Button onClick={() => {
        setCopyError(undefined); setCopied(false)
        void writeClipboard(participantId).then((success) => {
          setCopied(success)
          if (!success) setCopyError(t('memberDetail.copyFailed'))
        }, () => { setCopyError(t('memberDetail.copyFailed')) })
      }}>{t('memberDetail.copyId')}</Button>
      {copied && <p role="status">{t('memberDetail.copiedId')}</p>}
      {copyError !== undefined && <p role="alert">{copyError}</p>}
      <MemberReadiness value={readiness} stale={readinessStale} details translate={t} />
      <dl>{(['provider', 'preset', 'model', 'authScheme'] as const).map(field => value.record[field] === undefined ? null
        : <div key={field}><dt>{t(`memberDetail.${field}`)}</dt><dd>{value.record[field]}</dd></div>)}</dl>
      <h4>{t('memberDetail.capabilities')} · {value.total}</h4>
      <ul>{value.items.map((capability, index) => <li key={value.startCursor + index + 1}>{capability}</li>)}</ul>
    </>}
  </Modal>
}
