/** Dedicated channel navigation, readable messages, inline input, and on-demand diagnostics. */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Button, Input, Menu, IconCloseOutline16, IconEllipsisOutline16 } from '@clocky/clocky-client-ui-primitives'
import type { MenuEntry } from '@clocky/clocky-client-ui-primitives'
import type { ChannelId } from '@clocky/clocky-client-runtime/client'
import type { TeamPageProps, TeamLoadedContext } from './TeamPage.tsx'
import type { ChannelComposerDraft } from './channel-draft.ts'
import type { TeamViewState } from './workspace-store.ts'
import { ChannelEnvelope } from './ChannelEnvelope.tsx'
import { ChannelSummaryDialog } from './ChannelSummaryDialog.tsx'
import { TeamManagementDialog, type TeamManagementTarget } from './TeamManagementDialog.tsx'
import css from './ChannelHub.module.css'

type ChannelHubProps = Pick<TeamPageProps, 'maxDraftBytes' | 'translate' | 'channelState' | 'channelListState' | 'readChannels'
  | 'readChannel' | 'manage' | 'readChannelAttachment' | 'renderSlot' | 'channelCatalog' | 'readChannelCatalog'
  | 'acknowledgeChannel' | 'closeChannelView'> & {
    state: TeamLoadedContext
    viewState: TeamViewState
    updateView: (patch: Partial<TeamViewState>) => void
    onDraftDiscard?: ((channelId: ChannelId) => void) | undefined
    onDraftChange?: (channelId: ChannelId, draft: ChannelComposerDraft) => void
  }

/**
 * Render the current channel from runtime-owned projections; browsing never accepts an invitation.
 * @param props - authoritative channel state and existing authenticated read/write operations.
 * @returns the channel workspace, including protocol-aware inline input.
 */
export function ChannelHub({ maxDraftBytes, state, translate: t, channelState, channelListState, readChannels, readChannel, manage,
  readChannelAttachment,
  renderSlot,
  channelCatalog,
  readChannelCatalog,
  acknowledgeChannel,
  closeChannelView,
  viewState,
  updateView,
  onDraftChange, onDraftDiscard }: ChannelHubProps) {

  const { channelSearch: search, channelDetails: detailsOpen, channelDrafts: drafts } = viewState
  const setSearch = (value: string) => { updateView({ channelSearch: value }) }
  const setDetailsOpen = (value: boolean) => { updateView({ channelDetails: value }) }
  const [menuOpen, setMenuOpen] = useState(false)
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [managementTarget, setManagementTarget] = useState<TeamManagementTarget>()
  const [error, setError] = useState<string>()
  const [mobileList, setMobileList] = useState(false)
  const request = useRef<AbortController>()
  const messageScroll = useRef<HTMLDivElement>(null)
  const pinnedToLatest = useRef(true)
  const scrollChannel = useRef<ChannelId>()
  const scrollStart = useRef<number>()
  const { team, participants } = state
  const list = channelListState?.teamId === team.id ? channelListState : undefined
  const selectedId = channelState?.channelId
  const page = channelState?.page
  const channel = page?.channel
  const admission = channelState?.admission
  const invitation = channelState?.invitation
  const protocol = admission?.protocolStatus
  const next = admission?.expectedNext
  const loading = channelState?.loading === true
  const authorityPending = loading ||
     channelState?.disconnected === true ||
     channelState?.error !== undefined ||
     channelState?.invitationError !== undefined
  const canManage = manage !== undefined && !['completed', 'failed', 'cancelled'].includes(team.phase)
  const basic = channel?.manifest.adapter.version === 1 && ['consult', 'discussion'].includes(channel.manifest.adapter.type)
  const direct = channel?.manifest.adapter.type === 'direct' && [3, 4].includes(channel.manifest.adapter.version)
  const canSpeak = next?.kind !== 'participant' || next.participantId === invitation?.invitation.participantId
  const sendBlocked = authorityPending || invitation?.invitation.status !== 'acknowledged'
    || basic && (admission === undefined || channelState?.admissionError !== undefined || !canSpeak
      || protocol?.kind === 'consult' && (protocol.phase === 'complete' || protocol.request?.review === true))
  const capabilities = channelCatalog?.value?.summary
  const policy = channel?.manifest.viewPolicy
  const summaryCapabilities = capabilities !== undefined && policy !== undefined && !channelCatalog?.loading
    &&
       !channelCatalog?.disconnected &&
       channelCatalog?.error === undefined &&
       capabilities.allowedPolicies.includes(policy.type) ? capabilities : undefined
  const summaries = [...new Map([
    ...(page?.records.flatMap(record => record.type === 'channel/summary' ? [record] : []) ?? []),
    ...(channelState?.lastSummary === undefined ? [] : [channelState.lastSummary]),
  ].map(summary => [summary.sequence, summary])).values()]
  const report = (reason: unknown) => { setError(reason instanceof Error ? reason.message : String(reason)) }
  const load = async (channelId: ChannelId, afterCursor = -1) => {
    if (readChannel === undefined) return
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setError(undefined)
    setMobileList(false)
    try { await readChannel(channelId, afterCursor, controller.signal) }
    catch (reason: unknown) { if (!controller.signal.aborted) report(reason) }
  }
  const refresh = async () => { if (selectedId !== undefined) await load(selectedId) }
  useEffect(() => {
    if (readChannels !== undefined) void readChannels(team.id).catch(report)
    if (readChannelCatalog !== undefined) void readChannelCatalog().catch(report)
  }, [team.id, readChannels, readChannelCatalog])
  useEffect(() => () => { request.current?.abort(); closeChannelView?.() }, [closeChannelView])
  useEffect(() => {
    if (selectedId === undefined || readChannel === undefined || request.current !== undefined) return
    const controller = new AbortController()
    request.current = controller
    void readChannel(selectedId, -1, controller.signal).catch((reason: unknown) => {
      if (!controller.signal.aborted) report(reason)
    })
  }, [selectedId, readChannel])
  useLayoutEffect(() => {
    const element = messageScroll.current
    if (element === null) return
    if (scrollChannel.current !== selectedId) {
      scrollChannel.current = selectedId
      pinnedToLatest.current = true
    }
    if (scrollStart.current !== channelState?.startCursor) {
      scrollStart.current = channelState?.startCursor
      if (channelState?.startCursor !== undefined && channelState.startCursor >= 0) {
        pinnedToLatest.current = false
        element.scrollTop = 0
      }
    }
    if (pinnedToLatest.current) element.scrollTop = element.scrollHeight
  }, [selectedId, page?.records.length, channelState?.startCursor])
  const name = (id: string) => participants.find(participant => participant.id === id)?.displayName ?? t('channel.unknownParticipant')
  const title = channel === undefined ? t('channelHub.select') : channel.manifest.participants.map(endpoint => name(endpoint.id)).join(' · ')
  const menu: MenuEntry[] = [{ id: 'refresh', label: t('detail.refresh'), disabled: loading }]
  if (canManage && summaryCapabilities !== undefined && page?.records.some(record => record.type === 'channel/envelope')) {
    menu.push({ id: 'summary', label: t('channel.summarize'), disabled: loading || channelState?.disconnected === true })
  }
  if (canManage && channel !== undefined && ['pending', 'active'].includes(channel.phase)) {
    menu.push({ id: 'close', label: t(channel.phase === 'pending' ? 'channel.cancelOpening' : 'manage.channelClose'), danger: true, disabled: channelState?.disconnected === true })
  }
  return <section className={css.hub} data-channel-hub data-details={detailsOpen || undefined}
    data-mobile-list={mobileList || selectedId === undefined || undefined} aria-label={t('detail.channels')}>
    <aside className={css.channelList} aria-label={t('channelHub.list')}>
      <div className={css.listHeader}><h2>{t('workspace.channels')}</h2>
        {canManage && <Button size="sm" onClick={() => { setManagementTarget({ kind: 'channelOpen' }) }}>{t('manage.channelOpen')}</Button>}</div>
      <Input aria-label={t('channelHub.search')} placeholder={t('channelHub.search')} value={search} onChange={(event) => { setSearch(event.target.value) }} />
      {list?.loading && <p role="status">{t('channel.listLoading')}</p>}
      {list?.error !== undefined && <p className={css.error} role="alert">{list.error}</p>}
      {list?.hasNewer && <p className={css.notice} role="status">{t('channel.listNewer')}</p>}
      <ul>{(list?.items ?? []).map((item, index) => {
        const current = channel?.manifest.id === item.manifest.id && channel.cursor >= item.cursor ? channel : item
        return { item: current, index, label: current.manifest.participants.map(endpoint => name(endpoint.id)).join(' · ') }
      })
        .filter(({ label, item }) => `${label} ${item.manifest.adapter.type}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
        .map(({ item, index, label }) => <li key={item.manifest.id}>
          <button type="button" aria-pressed={selectedId === item.manifest.id} aria-label={`${t('detail.channel')} ${index + 1}`}
            data-channel-id={item.manifest.id} disabled={readChannel === undefined} onClick={() => { void load(item.manifest.id) }}>
            <strong>{label}</strong><span>{item.manifest.adapter.type} · {t(`channel.phase.${item.phase}`)}</span>
          </button>
        </li>)}</ul>
      {list?.items.length === 0 && !list.loading && <p>{t('detail.channelEmpty')}</p>}
      {list?.startCursor !== undefined && readChannels !== undefined && <Button disabled={list.loading || list.loadingMore}
        onClick={() => { void readChannels(team.id, 'first').catch(report) }}>{t('detail.firstPage')}</Button>}
      {list?.nextCursor !== undefined && readChannels !== undefined && <Button disabled={list.loading || list.loadingMore}
        onClick={() => { void readChannels(team.id, 'next').catch(report) }}>{t('channel.loadMoreChannels')}</Button>}
      {readChannels !== undefined && <Button size="sm" disabled={list?.loading || list?.loadingMore}
        onClick={() => { void readChannels(team.id).catch(report) }}>{t('channel.refreshList')}</Button>}
    </aside>
    <div className={css.conversation}>
      <div className={css.threadHeader}>
        <Button className={css.backToChannels} size="sm" onClick={() => { setMobileList(true) }}>{t('channelHub.back')}</Button>
        <div><h2>{title}</h2>{channel !== undefined && <p>{t(`channel.phase.${channel.phase}`)} · {channel.manifest.adapter.type}</p>}</div>
        {selectedId !== undefined && <div className={css.headerActions}>
          <Button size="sm" aria-expanded={detailsOpen} onClick={() => { setDetailsOpen(!detailsOpen) }}>{t('channelHub.details')}</Button>
          <Menu open={menuOpen} portal align="end" items={menu} onClose={() => { setMenuOpen(false) }}
            anchor={<Button size="sm" aria-label={t('channelHub.actions')} onClick={() => { setMenuOpen(value => !value) }}><IconEllipsisOutline16 /></Button>}
            onSelect={(id) => {
              setMenuOpen(false)
              if (id === 'refresh') void refresh()
              if (id === 'summary') setSummaryOpen(true)
              if (id === 'close') setManagementTarget({ kind: 'channelClose', channelId: selectedId })
            }} />
        </div>}
      </div>
      <div className={css.channelNotices}>
        {loading && <p role="status">{t('detail.channelLoading')}</p>}
        {(channelState?.error ?? error) !== undefined && <p className={css.error} role="alert">{channelState?.error ?? error}</p>}
        {channelState?.disconnected && <p role="status">{t('channel.disconnected')}</p>}
        {channelState?.invitationError !== undefined && <p>{t('channel.invitationUnavailable')}</p>}
        {channelState?.acknowledgementError !== undefined && <p className={css.error} role="alert">{channelState.acknowledgementError}</p>}
        {channelState?.admissionError !== undefined && <p className={css.error} role="alert">{channelState.admissionError}</p>}
        {invitation?.invitation.status === 'pending' && <div className={css.invitation}>
          <p>{t('channel.invitationPending')}</p>
          <p>{invitation.channel.manifest.participants.map(endpoint => name(endpoint.id)).join(' · ')}</p>
          {acknowledgeChannel !== undefined && selectedId !== undefined && <Button variant="outline"
            disabled={channelState?.acknowledging || authorityPending} aria-busy={channelState?.acknowledging}
            onClick={() => { void acknowledgeChannel(selectedId).catch(report) }}>{t('channel.acceptInvitation')}</Button>}
        </div>}
        {channelState?.hasNewer && <Button size="sm" onClick={() => { void refresh() }}>{t('channel.newer')}</Button>}
      </div>
      <div className={css.messages} ref={messageScroll} aria-label={t('detail.readChannel')} onScroll={(event) => {
        const element = event.currentTarget
        pinnedToLatest.current = element.scrollHeight - element.scrollTop - element.clientHeight < 40
      }}>
        {summaries.map(summary => <details key={summary.sequence} className={css.summary} role="region" aria-label={t('channel.savedSummary')}>
          <summary>{t('channel.savedSummary')} · {t('channel.sourceRange', summary.coveredSequenceRange)}</summary>
          <p>{summary.text}</p>
        </details>)}
        {page?.records.filter(record => record.type === 'channel/envelope').map(record => <ChannelEnvelope key={record.envelope.id}
          record={record} sender={name(record.envelope.senderId)} richContent={direct} renderSlot={renderSlot}
          readAttachment={readChannelAttachment} translate={t} />)}
        {page !== undefined && page.records.length === 0 && <p className={css.empty}>{t('detail.channelEmpty')}</p>}
        {selectedId === undefined && <p className={css.empty}>{t('channelHub.select')}</p>}
        {channelState?.startCursor !== undefined && channelState.startCursor >= 0 && selectedId !== undefined && <Button disabled={loading}
          onClick={() => { void load(selectedId, -1) }}>{t('detail.firstPage')}</Button>}
        {page?.nextCursor !== undefined && selectedId !== undefined && <Button disabled={loading}
          onClick={() => { void load(selectedId, page.nextCursor) }}>{t('detail.loadMore')}</Button>}
      </div>
      {basic && !canSpeak && <p className={css.composerNotice}>{t('channel.waitForSpeaker')}</p>}
      {protocol?.kind === 'consult' && protocol.request?.review && <p className={css.composerNotice}>{t('channel.reviewSeparate')}</p>}
      {channel !== undefined && channel.phase === 'active' && (direct || basic) && manage !== undefined && canManage && <TeamManagementDialog maxDraftBytes={maxDraftBytes}
        key={`compose-${channel.manifest.id}`} target={{ kind: 'channelPost', channelId: channel.manifest.id }} inline
        draft={drafts[channel.manifest.id]}
        onDraftDiscard={onDraftDiscard === undefined ? undefined : () => { onDraftDiscard(channel.manifest.id) }}

        {...onDraftChange === undefined ? {} : { onDraftChange: (draft: ChannelComposerDraft) => {
          onDraftChange(channel.manifest.id,
            draft)
        } }}
        state={state} channel={channel} senderId={invitation?.invitation.participantId} channelPending={sendBlocked}
        admission={admission} translate={t} manage={manage} refreshChannel={refresh} onClose={() => { setManagementTarget(undefined) }} />}
    </div>
    {detailsOpen && <aside className={css.details} aria-label={t('channelHub.details')}>
      <div className={css.listHeader}><h2>{t('channelHub.details')}</h2><Button size="sm" aria-label={t('channelHub.closeDetails')}
        onClick={() => { setDetailsOpen(false) }}><IconCloseOutline16 /></Button></div>
      {admission !== undefined && <section aria-label={t('channel.endpointStatus')}>
        <h3>{t('channel.endpointStatus')}</h3>
        <p>{t('channel.lifecycle')}: {t(`channel.phase.${admission.channel.phase}`)}</p>
        <p>{t('channel.nextSpeaker')}: {next?.kind === 'participant' ? name(next.participantId) : t('channel.noDesignatedSpeaker')}</p>
        {protocol?.kind === 'consult' && <p>{t(`channel.consultPhase.${protocol.phase}`)}</p>}
        {protocol?.kind === 'discussion' && <p>{t('channel.discussionProgress', { count: protocol.turnCount, maximum: protocol.maxTurns })} · {t(`channel.speaker.${protocol.speakerPolicy}`)}</p>}
        <ul>{admission.invitations.map(item => <li key={item.participantId}>
          <strong>{name(item.participantId)}</strong><p>{item.role} · {t(item.required ? 'channel.required' : 'channel.optional')} · {t(`channel.invitation.${item.status}`)}</p>
          <small>{t('channel.deadline')} <time dateTime={new Date(item.deadline).toISOString()}>
            {new Intl.DateTimeFormat(t('channel.dateLocale'), { dateStyle: 'short', timeStyle: 'short' }).format(item.deadline)}</time></small>
        </li>)}</ul>
      </section>}
      {channel !== undefined && <section><h3>{t('channel.protocol')}</h3><p>{channel.manifest.adapter.type} v{channel.manifest.adapter.version}</p>
        <h3>{t('channel.immutableView')}</h3><p>{policy === undefined ? t('channel.noView') : `${policy.type} v${policy.version}`}</p></section>}
      <details className={css.diagnostics}><summary>{t('channelHub.diagnostics')}</summary>
        {channelCatalog?.error !== undefined && <p className={css.error} role="alert">{channelCatalog.error}</p>}
        {readChannelCatalog !== undefined && <Button size="sm" disabled={channelCatalog?.loading} onClick={() => { void readChannelCatalog().catch(report) }}>{t('channel.refreshCatalog')}</Button>}
        {page?.view !== undefined && <details><summary>{t('channel.pageView')}</summary><pre>{JSON.stringify(page.view, null, 2)}</pre></details>}
        <details><summary>{t('channel.rawRecords')}</summary>{page?.records.map(record => <details key={`${record.type}:${'sequence' in record ? record.sequence : record.envelope.id}`} data-channel-record={record.type === 'channel/envelope' ? record.envelope.sequence : record.sequence}>
          <summary>{record.type}</summary><pre>{JSON.stringify(record.type === 'channel/envelope' ? record.envelope.payload : record, null, 2)}</pre>
        </details>)}</details>
      </details>
    </aside>}
    {managementTarget !== undefined && manage !== undefined && <TeamManagementDialog maxDraftBytes={maxDraftBytes}
      target={managementTarget} state={state}
      channel={channel} senderId={invitation?.invitation.participantId} channelPending={authorityPending}
      catalog={channelCatalog} readCatalog={readChannelCatalog} admission={admission} translate={t} manage={manage}
      refreshChannel={refresh} onClose={() => { setManagementTarget(undefined) }} />}
    {summaryOpen && page !== undefined && manage !== undefined && <ChannelSummaryDialog page={page} capabilities={summaryCapabilities}
      readCatalog={readChannelCatalog} translate={t} manage={manage} onClose={() => { setSummaryOpen(false) }} />}
  </section>
}
