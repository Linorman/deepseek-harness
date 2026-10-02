/** Exact request inspection and bounded, independently retained human input. */
import { useEffect, useState } from 'react'
import { Button, Modal } from '@clocky/clocky-client-ui-primitives'
import type { ITeamTasks, TeamActionDetailState, TeamActionResponseInput, TeamActionResponseResult } from '@clocky/clocky-client-runtime/client'
import type { TeamKey } from './locales.ts'
import { HumanActionCard } from './HumanActionCard.tsx'
import { EMPTY_ACTION_DRAFT, type HumanActionDraft } from './action-draft.ts'
import css from './TeamBrowser.module.css'

/**
 * Inspect one current request while preserving input across view and connection changes.
 * @param props - runtime-owned inspection, retained draft, current Host callbacks and locale.
 * @returns the request dialog, or its explicit draft-discard confirmation.
 */
export function TeamActionDialog({ teamId, actionId, detail, draft, changeDraft, discardDraft, translate: t,
  inspect, closeDetail, respond, openContext, onClose }: {
  readonly teamId: TeamActionResponseInput['teamId']
  readonly actionId: TeamActionResponseInput['actionId']
  readonly detail?: TeamActionDetailState | undefined
  readonly draft?: HumanActionDraft | undefined
  readonly changeDraft: (draft: HumanActionDraft) => void
  readonly discardDraft: () => void
  readonly translate: (key: TeamKey, vars?: Record<string, unknown>) => string
  readonly inspect: NonNullable<ITeamTasks['inspectAction']>
  readonly closeDetail: () => void
  readonly respond?: ((input: TeamActionResponseInput, signal?: AbortSignal) => Promise<TeamActionResponseResult>) | undefined
  readonly openContext?: ((action: TeamActionResponseResult['action']) => Promise<void>) | undefined
  readonly onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [discard, setDiscard] = useState(false)
  const [draftGeneration, setDraftGeneration] = useState(0)
  const current = detail?.teamId === teamId && detail.actionId === actionId ? detail : undefined
  const value = current?.value
  useEffect(() => {
    if (current === undefined) void inspect(teamId, actionId)
    return closeDetail
  }, [teamId, actionId, inspect, closeDetail])
  const allowed = value?.handling.kind === 'actionable' && !current?.loading && !current?.disconnected
    && !current?.hasNewer && current?.error === undefined && respond !== undefined
  return <>
    <Modal open title={t('human.detail')} closeLabel={t('cancel')} onClose={() => { if (!busy) onClose() }}
      bodyClassName={css.managementContent ?? ''} footer={<>
        {draft !== undefined && <Button disabled={busy} onClick={() => { setDiscard(true) }}>{t('human.discardDraft')}</Button>}
        <Button disabled={busy} onClick={onClose}>{t('human.closeKeepDraft')}</Button>
      </>}>
      <p className={css.muted}>{t('human.draftRetention')}</p>
      {(current === undefined || current.loading) && <p role="status">{t('attention.loading')}</p>}
      {current?.disconnected && <p role="status">{t('attention.disconnected')}</p>}
      {current?.hasNewer && !current.disconnected && <p role="status">{t('human.changed')}</p>}
      {current?.error !== undefined && <p role="alert" className={css.error}>{current.error}</p>}
      {value?.handling.kind === 'waiting' && <p role="status">{t(`attention.wait.${value.handling.reason}`)}</p>}
      <Button disabled={busy || current?.loading || current?.disconnected}
        onClick={() => { void inspect(teamId, actionId) }}>{t('human.refresh')}</Button>
      {value !== undefined && <HumanActionCard key={`${actionId}:${draftGeneration}`} action={value.action} translate={t}
        disabled={!allowed} draft={draft ?? EMPTY_ACTION_DRAFT} onDraftChange={changeDraft} onAccepted={discardDraft}
        onBusyChange={setBusy}
        respond={async (input, signal) => {
          if (!allowed) throw new Error(t('human.changed'))
          return await respond(input, signal)
        }}
        confirm={async () => {
          const latest = await inspect(teamId, actionId)
          if (latest === undefined) throw new Error(t('human.readFailed'))
          if (latest.handling.kind === 'waiting') throw new Error(t(`attention.wait.${latest.handling.reason}`))
          return latest.action
        }}
        {...openContext === undefined ? {} : { openContext: async (action) => { await openContext(action); onClose() } }} />}
    </Modal>
    {discard && <Modal open title={t('human.discardDraft')} closeLabel={t('cancel')} onClose={() => { setDiscard(false) }}
      footer={<><Button onClick={() => { setDiscard(false) }}>{t('cancel')}</Button>
        <Button onClick={() => { discardDraft(); setDraftGeneration(value => value + 1); setDiscard(false) }}>{t('human.discardDraft')}</Button></>}>
      <p>{t('human.discardConfirm')}</p>
    </Modal>}
  </>
}
