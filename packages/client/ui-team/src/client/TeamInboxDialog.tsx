/** Principal-wide inbox display and explicit acknowledgements of loaded delivery prefixes. */

import { useEffect, useRef, useState } from 'react'
import { Button, MarkdownText, Modal } from '@clocky/clocky-client-ui-primitives'
import type { ITeamTasks, TeamActionResponseInput, TeamActionResponseResult, TeamInboxState, TeamTaskListState } from '@clocky/clocky-client-runtime/client'
import type { TeamKey } from './locales.ts'
import { HumanActionCard } from './HumanActionCard.tsx'
import css from './TeamBrowser.module.css'

/** Plain callbacks used by the global inbox and by current Team action cards. */
export interface TeamInboxControls {
  readonly refreshInbox: NonNullable<ITeamTasks['refreshInbox']>
  readonly loadMoreInbox: NonNullable<ITeamTasks['loadMoreInbox']>
  readonly watchInbox: NonNullable<ITeamTasks['watchInbox']>
  readonly acknowledgeInbox: NonNullable<ITeamTasks['acknowledgeInbox']>
  readonly readAction: NonNullable<ITeamTasks['readAction']>
  readonly respondAction: NonNullable<ITeamTasks['respondAction']>
  readonly openActionContext: (action: TeamActionResponseResult['action']) => Promise<void>
}

/**
 * Display all Teams in one principal inbox so display acknowledgement cannot skip a hidden Team's message.
 * @param props - bounded runtime projection, authenticated owners, locale, and navigation.
 * @returns the application inbox dialog and an unsent-answer discard confirmation when needed.
 */
export function TeamInboxDialog({ state, teams, translate: t, onClose, openTeam, ...controls }: TeamInboxControls & {
  readonly state: TeamInboxState
  readonly teams: TeamTaskListState['items']
  readonly translate: (key: TeamKey, vars?: Record<string, unknown>) => string
  readonly onClose: () => void
  readonly openTeam: (teamId: TeamActionResponseInput['teamId']) => Promise<unknown>
}) {
  const readRequest = useRef<AbortController | undefined>()
  const [watchError, setWatchError] = useState<string | undefined>()
  const [operationError, setOperationError] = useState<string | undefined>()
  const [dirty, setDirty] = useState<ReadonlySet<string>>(new Set())
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set())
  const [discard, setDiscard] = useState(false)
  const [draftGeneration, setDraftGeneration] = useState(0)
  const pendingOperation = useRef<(() => void | Promise<unknown>) | undefined>()
  const { refreshInbox, watchInbox, loadMoreInbox, acknowledgeInbox, readAction, respondAction, openActionContext } = controls
  const entries = [...new Map(state.items.map(item => [item.kind === 'action'
    ? `action:${item.teamId}:${item.action.id}` : `delivery:${item.sequence}`, item])).values()]
  const unreadLoaded = state.items.filter(item => item.sequence > state.displayCursor).length
  const error = operationError ?? watchError ?? state.error?.message

  useEffect(() => {
    readRequest.current?.abort()
    const controller = new AbortController()
    readRequest.current = controller
    setDirty(new Set()); setBusy(new Set())
    void refreshInbox(false, controller.signal)
    return () => { readRequest.current?.abort() }
  }, [refreshInbox, state.connectionGeneration])

  useEffect(() => {
    if (state.phase !== 'ready' || state.nextCursor !== undefined || state.hasNewer) return
    const controller = new AbortController()
    setWatchError(undefined)
    const listen = async (): Promise<void> => {
      try {
        while (!controller.signal.aborted) {
          const page = await watchInbox(controller.signal)
          if (page.items.length > 0 || page.nextCursor !== undefined) return
        }
      } catch (cause: unknown) { if (!controller.signal.aborted) setWatchError(cause instanceof Error ? cause.message : String(cause)) }
    }
    void listen()
    return () => { controller.abort() }
  }, [watchInbox, state.phase, state.nextCursor, state.hasNewer, state.connectionGeneration])

  const execute = async (operation: () => void | Promise<unknown>): Promise<void> => {
    setOperationError(undefined)
    try { await operation() } catch (cause: unknown) { setOperationError(cause instanceof Error ? cause.message : String(cause)) }
  }
  const requestOperation = (operation: () => void | Promise<unknown>): void => {
    if (busy.size > 0) return
    if (dirty.size > 0) { pendingOperation.current = operation; setDiscard(true) }
    else void execute(operation)
  }
  const read = (history: boolean): Promise<void> => {
    readRequest.current?.abort()
    setWatchError(undefined)
    const controller = new AbortController()
    readRequest.current = controller
    return refreshInbox(history, controller.signal)
  }
  const respond = async (input: TeamActionResponseInput, signal?: AbortSignal): Promise<TeamActionResponseResult> => {
    const { teamId, ...answer } = input
    return await respondAction(teamId, answer, signal)
  }
  return <>
    <Modal open title={t('inbox.title')} closeLabel={t('cancel')} onClose={() => { requestOperation(onClose) }}
      bodyClassName={css.managementContent ?? ''} footer={<>
        <Button disabled={busy.size > 0} onClick={() => { requestOperation(onClose) }}>{t('inbox.close')}</Button>
        <Button disabled={unreadLoaded === 0 || state.acknowledging} onClick={() => { void acknowledgeInbox(readRequest.current?.signal) }}>{t('inbox.markLoaded')}</Button>
      </>}>
      <div className={css.actions}>
        <Button disabled={state.phase === 'loading' || busy.size > 0} onClick={() => { requestOperation(async () => { await read(false) }) }}>{t('inbox.refresh')}</Button>
        <Button disabled={state.phase === 'loading' || busy.size > 0} onClick={() => { requestOperation(async () => { await read(true) }) }}>{t('inbox.history')}</Button>
      </div>
      {state.phase === 'loading' && <p role="status" className={css.muted}>{t('inbox.loading')}</p>}
      {error !== undefined && <p role="alert" className={css.error}>{error}</p>}
      {entries.length === 0 && state.phase !== 'loading' && <p className={css.muted}>{t('inbox.empty')}</p>}
      {entries.map((item) => {
        const team = teams.find(candidate => candidate.id === item.teamId)
        const key = item.kind === 'action' ? `${item.teamId}:${item.action.id}` : String(item.sequence)
        return <section key={`${state.connectionGeneration}:${draftGeneration}:${key}`} className={css.inboxEntry}>
          <div className={css.sectionHeader}>
            <strong>{t(item.kind === 'final' ? 'inbox.final' : item.kind === 'action' ? 'inbox.action' : 'inbox.message')}</strong>
            <small>{t(item.sequence > state.displayCursor ? 'inbox.unread' : 'inbox.read')}</small>
          </div>
          <Button onClick={() => { requestOperation(async () => { await openTeam(item.teamId); onClose() }) }}>{team?.goal.objective ?? t('inbox.openTeam')}</Button>
          {item.kind === 'action' ? <HumanActionCard action={item.action} translate={t} respond={respond}
            confirm={async (action, signal) => await readAction(action.teamId, action.id, signal)}
            openContext={(action) => { requestOperation(async () => { await openActionContext(action); onClose() }) }}
            onDirtyChange={(value) => { setDirty(previous => toggleMember(previous, key, value)) }}
            onBusyChange={(value) => { setBusy(previous => toggleMember(previous, key, value)) }}
          /> : item.text.length > 0 ? <MarkdownText text={item.text} /> : <p className={css.notice}>{t('inbox.nonText')}</p>}
        </section>
      })}
      {(state.nextCursor !== undefined || state.hasNewer) && <div className={css.actions}>
        <Button disabled={state.loadingMore || state.phase === 'loading'} onClick={() => { void loadMoreInbox(readRequest.current?.signal) }}>{t(state.hasNewer ? 'inbox.newMessages' : 'detail.loadMore')}</Button>
        {state.loadingMore && <p role="status" className={css.muted}>{t('inbox.loading')}</p>}
      </div>}
      {state.acknowledging && <p role="status" className={css.muted}>{t('inbox.acknowledging')}</p>}
    </Modal>
    <Modal open={discard} title={t('inbox.discardTitle')} closeLabel={t('cancel')} onClose={() => { setDiscard(false) }}
      description={t('inbox.discardDescription')} footer={<>
        <Button onClick={() => { setDiscard(false) }}>{t('inbox.keepDraft')}</Button>
        <Button onClick={() => {
          const operation = pendingOperation.current
          pendingOperation.current = undefined
          setDiscard(false); setDirty(new Set()); setDraftGeneration(previous => previous + 1)
          if (operation !== undefined) void execute(operation)
        }}>{t('inbox.discard')}</Button>
      </>} />
  </>
}

/** Track interaction state independently for each visible durable request. */
function toggleMember(previous: ReadonlySet<string>, key: string, present: boolean): ReadonlySet<string> {
  const next = new Set(previous)
  if (present) next.add(key)
  else next.delete(key)
  return next
}
