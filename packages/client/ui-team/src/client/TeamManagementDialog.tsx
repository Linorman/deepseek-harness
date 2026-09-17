import { channelDraftFingerprint } from './channel-draft.ts'
import type { TeamLoadedContext } from './TeamPage.tsx'
/** Member and direct-channel forms backed by authenticated Team commands. */

import { useEffect, useId, useRef, useState } from 'react'
import type { SetStateAction } from 'react'
import { Button, Input, Modal } from '@clocky/clocky-client-ui-primitives'
import type {
  ChannelId,
  ChannelReadPageResult,
  ParticipantId,
  TeamManagementCommand,
  TeamChannelInput,
  TeamChannelCatalogState,
  TeamChannelAdmission,

} from '@clocky/clocky-client-runtime/client'
import { encodeChannelImages, type ChannelDraftPart, type ChannelComposerDraft } from './channel-draft.ts'
import { Config } from './workspace-store.ts'
import type { TeamKey } from './locales.ts'
import css from './TeamBrowser.module.css'
import hubCss from './ChannelHub.module.css'

/** Exact selected subject for one management dialog. */
export type TeamManagementTarget =
  | { readonly kind: 'memberInvite' | 'channelOpen' }
  | { readonly kind: 'memberActivate' | 'memberRemove' | 'memberInterrupt'; readonly participantId: ParticipantId }
  | { readonly kind: 'channelPost' | 'channelClose'; readonly channelId: ChannelId }

/**
 * Render one authenticated management form while retaining unsent fields after a rejected command.
 * @param props - exact target, authoritative Team/channel projections, and injected command/read owners.
 * @returns the shared application dialog for this operation.
 */
export function TeamManagementDialog({ target,
  state,
  channel,
  senderId,
  channelPending,
  catalog,
  readCatalog,
  admission,
  translate: t,
  manage,
  onClose,
  refreshChannel,
  inline = false,
  maxDraftBytes,
  draft,
  onDraftChange, onDraftDiscard }: {
  readonly maxDraftBytes?: number | undefined
  readonly target: TeamManagementTarget
  /** Present the same channel command form in its conversation instead of a dialog. */
  readonly inline?: boolean
  /** Controlled draft supplied by the workspace when this form is an inline composer. */
  readonly draft?: ChannelComposerDraft | undefined
  /** Retain the complete unsent draft without adding a second business subscription. */
  readonly onDraftDiscard?: (() => void) | undefined
  readonly onDraftChange?: ((draft: ChannelComposerDraft) => void) | undefined
  readonly state: TeamLoadedContext
  readonly channel: ChannelReadPageResult['channel'] | undefined
  readonly senderId?: ParticipantId | undefined
  readonly channelPending?: boolean | undefined
  readonly catalog?: TeamChannelCatalogState | undefined
  readonly readCatalog?: (() => Promise<void>) | undefined
  readonly admission?: TeamChannelAdmission | undefined
  readonly translate: (key: TeamKey, vars?: Record<string, unknown>) => string
  readonly manage: (command: TeamManagementCommand, signal?: AbortSignal) => Promise<void>
  readonly onClose: () => void
  readonly refreshChannel?: () => Promise<void>
}) {
  const limits = Config.parse({ maxDraftBytes })
  const id = useId()
  const [name, setName] = useState('')
  const [role, setRole] = useState('worker')
  const [kind, setKind] = useState<'local-agent' | 'remote-agent' | 'service'>('local-agent')
  const [capabilities, setCapabilities] = useState('')
  const [provider, setProvider] = useState('')
  const [preset, setPreset] = useState('')
  const [model, setModel] = useState('')
  const [adapterChoice, setAdapterChoice] = useState('')
  const [viewChoice, setViewChoice] = useState('')
  const [initiator, setInitiator] = useState<ParticipantId | undefined>()
  const [respondent, setRespondent] = useState<ParticipantId | undefined>()
  const [maxTurns, setMaxTurns] = useState('')
  const [speakerPolicy, setSpeakerPolicy] = useState<'' | 'round-robin' | 'free-form'>('')
  const [importing, setImporting] = useState(false)
  const imageInput = useRef<HTMLInputElement>(null)
  const imageImport = useRef<AbortController | undefined>()
  const [localDraft, setLocalDraft] = useState<ChannelComposerDraft>(() => ({
    text: '', content: [{ id: crypto.randomUUID(), content: { type: 'text', text: '' } }],
    audienceMode: 'selected', delivery: 'turn', retryKey: crypto.randomUUID(), retryFingerprint: undefined,
    selected: target.kind === 'channelOpen'
      ? state.participants.filter(participant => participant.phase === 'active').map(participant => participant.id)
      : channel?.manifest.participants.filter(participant => participant.id !== senderId
        && state.participants.some(member => member.id === participant.id && member.phase === 'active')).map(participant => participant.id) ?? [],
  }))
  const composerDraft = draft ?? localDraft
  const { text, content, audienceMode, delivery, selected } = composerDraft
  const draftRef = useRef(composerDraft)
  draftRef.current = composerDraft
  const updateDraft = (change: (current: ChannelComposerDraft) => ChannelComposerDraft): boolean => {
    const next = change(draftRef.current)
    try {
      if (onDraftChange === undefined) setLocalDraft(next)
      else onDraftChange(next)
      draftRef.current = next
      setError(undefined)
      return true
    } catch (cause: unknown) {
      setError(cause instanceof Error && cause.name === 'DraftCapacityError' ? t('channel.draftCapacity')
        : cause instanceof Error ? cause.message : String(cause))
      return false
    }
  }
  function updateField<Key extends keyof ChannelComposerDraft>(key: Key, change: SetStateAction<ChannelComposerDraft[Key]>): void {
    updateDraft(current => ({ ...current, [key]: typeof change === 'function' ? change(current[key]) : change }))
  }
  const setText = (value: SetStateAction<string>) => { updateField('text', value) }
  const setContent = (value: SetStateAction<readonly ChannelDraftPart[]>) => { updateField('content', value) }
  const setSelected = (value: SetStateAction<readonly ParticipantId[]>) => { updateField('selected', value) }
  const setAudienceMode = (value: ChannelComposerDraft['audienceMode']) => { updateField('audienceMode', value) }
  const setDelivery = (value: ChannelComposerDraft['delivery']) => { updateField('delivery', value) }
  const clearDraft = (): void => {
    const next: ChannelComposerDraft = { ...draftRef.current, text: '',
      content: [{ id: crypto.randomUUID(), content: { type: 'text', text: '' } }],
      retryKey: crypto.randomUUID(), retryFingerprint: undefined }
    if (onDraftDiscard !== undefined) {
      onDraftDiscard()
      setLocalDraft(next)
      draftRef.current = next
    } else updateDraft(() => next)
  }
  const [discardDraft, setDiscardDraft] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [invalidField, setInvalidField] = useState<string | undefined>()
  const request = useRef<AbortController | undefined>()
  const form = useRef<HTMLFormElement | null>(null)
  const cancellingOpening = target.kind === 'channelClose' && channel?.phase === 'pending'
  const title = t(cancellingOpening ? 'channel.cancelOpening' : `manage.${target.kind}`)
  const participant = 'participantId' in target ? state.participants.find(item => item.id === target.participantId) : undefined
  const options = target.kind === 'channelOpen'
    ? state.participants.filter(item => item.phase === 'active')
    : state.participants.filter(item => item.phase === 'active' && item.id !== senderId
      && channel?.manifest.participants.some(member => member.id === item.id))
  const broadcastAvailable = channel?.manifest.adapter.version === 4 && channel.manifest.participants.every(member => member.id === senderId
    || state.participants.some(participant => participant.id === member.id && participant.phase === 'active'))
  const adapters = catalog?.value?.adapters.filter(ref => ref.type === 'direct' && ref.version === 4
    || (ref.type === 'consult' || ref.type === 'discussion') && ref.version === 1) ?? []
  const adapter = adapters.find(ref => `${ref.type}@${ref.version}` === adapterChoice)
  const viewPolicy = catalog?.value?.viewPolicies.find(ref => `${ref.type}@${ref.version}` === viewChoice)
  const basic = channel?.manifest.adapter.version === 1 && (channel.manifest.adapter.type === 'consult' || channel.manifest.adapter.type === 'discussion')
  useEffect(() => { if (target.kind === 'channelOpen' && readCatalog !== undefined) void readCatalog() }, [target.kind, readCatalog])

  useEffect(() => {
    const previous = document.activeElement
    if (!inline) form.current?.closest('dialog')?.querySelector<HTMLButtonElement>('[data-management-cancel]')?.focus()
    return () => {
      request.current?.abort()
      imageImport.current?.abort()
      imageImport.current = undefined
      if (!inline && previous instanceof HTMLElement && previous.isConnected) previous.focus()
    }
  }, [inline])

  const close = (): void => { if (!busy) onClose() }
  const addImages = async (files: readonly File[]): Promise<void> => {
    imageImport.current?.abort()
    const controller = new AbortController()
    imageImport.current = controller
    setImporting(true)
    setError(undefined)
    try {
      const encoded = await encodeChannelImages(files, draftRef.current, limits.maxDraftBytes, controller.signal)
      if (!controller.signal.aborted) setContent(previous => [...previous, ...encoded])
    } catch (cause: unknown) {
      if (!controller.signal.aborted) { setError(cause instanceof RangeError ? t('channel.draftCapacity')
        : cause instanceof Error ? cause.message : String(cause)); controller.abort() }
    } finally {
      if (imageImport.current === controller) setImporting(false)
    }
  }
  const moveContent = (index: number, direction: -1 | 1): void => {
    setContent((previous) => {
      const next = [...previous]
      const selected = next.splice(index, 1)
      next.splice(index + direction, 0, ...selected)
      return next
    })
  }
  const failField = (field: string, message: string): void => {
    setInvalidField(field)
    setError(message)
    document.getElementById(`${id}-${field}`)?.focus()
  }
  const submit = async (): Promise<void> => {
    if (request.current !== undefined || importing) return
    if (target.kind === 'channelPost' && channelPending) return
    setError(undefined)
    setInvalidField(undefined)
    let command: TeamManagementCommand
    switch (target.kind) {
      case 'memberInvite': {
        if (!name.trim()) { failField('name', t('manage.nameRequired')); return }
        if (!role.trim()) { failField('role', t('manage.roleRequired')); return }
        command = { operation: 'memberInvite', input: {
          expectedCursor: state.team.cursor, kind, displayName: name.trim(), role: role.trim(),
          capabilities: [...new Set(capabilities.split(',').map(value => value.trim()).filter(Boolean))],
          ...provider.trim() ? { provider: provider.trim() } : {},
          ...preset.trim() ? { preset: preset.trim() } : {},
          ...model.trim() ? { model: model.trim() } : {},
        } }
        break
      }
      case 'memberActivate':
      case 'memberRemove':
      case 'memberInterrupt':
        command = { operation: target.kind, input: { participantId: target.participantId, expectedCursor: state.team.cursor } }
        break
      case 'channelOpen': {
        if (catalog?.loading || catalog?.disconnected || catalog?.error !== undefined || adapter === undefined) { failField('protocol', t('channel.protocolRequired')); return }
        if (viewPolicy === undefined) { failField('view', t('channel.viewRequired')); return }
        let members = selected.flatMap(id => options.filter(item => item.id === id)).map(item => ({ id: item.id, role: item.role }))
        if (adapter.type === 'consult') {
          if (initiator === undefined || respondent === undefined || initiator === respondent
            || !options.some(member => member.id === initiator) || !options.some(member => member.id === respondent)) {
            failField('consult', t('channel.consultMembersRequired')); return
          }
          members = [{ id: initiator, role: 'initiator' }, { id: respondent, role: 'respondent' }]
        }
        if (members.length < 2) {
          failField('members', t('manage.membersRequired')); return
        }
        const turns = Number(maxTurns)
        if (adapter.type === 'discussion' && (!maxTurns.trim() || !Number.isSafeInteger(turns) || turns < 1 || !speakerPolicy)) {
          failField('discussion', t('channel.discussionLimitsRequired')); return
        }
        command = { operation: 'channelOpen', input: {
          expectedCursor: state.team.cursor, adapter, viewPolicy,
          limits: adapter.type === 'discussion' ? { maxTurns: turns, speakerPolicy } : {}, participants: members,
        } }
        break
      }
      case 'channelPost': {
        if (channel === undefined || channel.manifest.id !== target.channelId) return
        if (senderId === undefined) { failField('audience', t('channel.senderUnavailable')); return }
        if (basic && (admission === undefined || admission.expectedNext.kind === 'participant' && admission.expectedNext.participantId !== senderId)) {
          failField('basic-text', t('channel.waitForSpeaker')); return
        }
        if (admission?.protocolStatus.kind === 'consult' && admission.protocolStatus.request?.review) {
          failField('basic-text', t('channel.reviewSeparate')); return
        }
        const ordered = basic ? (text.trim() ? [{ type: 'text' as const, text }] : [])
          : content.map(part => part.content).filter(part => part.type === 'image' || part.text.trim().length > 0)
        if (ordered.length === 0) { failField(basic ? 'basic-text' : 'content', t('channel.contentRequired')); return }
        if (!basic && audienceMode === 'broadcast' && !broadcastAvailable) { failField('audience', t('channel.broadcastUnavailable')); return }
        const audience = basic ? (channel.manifest.adapter.type === 'consult' ? options.map(item => item.id) : null)
          : audienceMode === 'broadcast' ? null : options.filter(item => selected.includes(item.id)).map(item => item.id)
        if (audience !== null && audience.length === 0) { failField('members', t('manage.audienceRequired')); return }
        if (channel.manifest.adapter.type === 'discussion' && delivery === 'steer') { failField('basic-text', t('channel.discussionNoSteer')); return }
        const selectedDelivery = channel.manifest.adapter.type === 'consult' ? 'turn' : delivery
        const fingerprint = channelDraftFingerprint({ content: ordered, audience, delivery: selectedDelivery })
        const previousDraft = draftRef.current
        const key = previousDraft.retryFingerprint !== undefined &&
           previousDraft.retryFingerprint !== fingerprint ? crypto.randomUUID() : previousDraft.retryKey
        if (!updateDraft(current => ({ ...current, retryKey: key, retryFingerprint: fingerprint }))) return
        command = { operation: 'channelInput', input: {
          channelId: target.channelId, expectedCursor: channel.cursor,
          audience, delivery: selectedDelivery, content: ordered,
          idempotencyKey: key as NonNullable<TeamChannelInput['idempotencyKey']>,
        } }
        break
      }
      case 'channelClose':
        if (channel === undefined || channel.manifest.id !== target.channelId) return
        command = { operation: 'channelClose', input: {
          channelId: target.channelId, expectedCursor: channel.cursor, ...text.trim() ? { reason: text.trim() } : {},
        } }
        break
      default: assertNever(target)
    }
    const controller = new AbortController()
    request.current = controller
    setBusy(true)
    let accepted = false
    let failure: { cause: unknown } | undefined
    try {
      try {
        await manage(command, controller.signal)
        accepted = true
        if (!controller.signal.aborted && inline) {
          clearDraft()
        }
      } catch (cause: unknown) { failure = { cause } }
      if (!controller.signal.aborted && 'channelId' in target && refreshChannel !== undefined) {
        try { await refreshChannel() }
        catch (cause: unknown) {
          if (failure === undefined) failure = { cause: new Error(t('channel.acceptedRefreshFailed', {
            message: cause instanceof Error ? cause.message : String(cause),
          })) }
        }
      }
      if (!controller.signal.aborted) {
        if (failure !== undefined) setError(failure.cause instanceof Error ? failure.cause.message : String(failure.cause))
        if (accepted && !inline) onClose()
      }
    } finally {
      if (request.current === controller) { request.current = undefined; setBusy(false) }
    }
  }

  const stopWaiting = (): void => {
    request.current?.abort()
    setError(t('manage.cancelledRead'))
  }
  const footer = <div className={css.actions}>
    {inline && <Button variant="outline" disabled={busy || importing} onClick={() => { setDiscardDraft(true) }}>{t('channel.discardDraft')}</Button>}
    {!inline && <Button data-management-cancel disabled={busy} onClick={close}>{t('cancel')}</Button>}
    {busy && <Button onClick={stopWaiting}>{t('detail.cancelRead')}</Button>}
    <Button form={`${id}-form`} type="submit" variant="primary" disabled={busy || importing || target.kind === 'channelPost' && channelPending}>{title}</Button>
  </div>
  const formContent = <form id={`${id}-form`} ref={form} noValidate className={inline ? hubCss.composerForm : css.managementForm} onKeyDown={(event) => {
    if (inline && (event.metaKey || event.ctrlKey) && event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); void submit() }
  }} onSubmit={(event) => { event.preventDefault(); void submit() }}>
    {participant !== undefined && <p><strong>{participant.displayName}</strong> · {participant.role}</p>}
    {(target.kind === 'memberRemove' || target.kind === 'memberActivate' || target.kind === 'memberInterrupt' || target.kind === 'channelClose')
        && <p className={css.notice}>{t(cancellingOpening ? 'channel.cancelOpeningDescription' : `manage.${target.kind}Description`)}</p>}
    {target.kind === 'memberInvite' && <>
      <label htmlFor={`${id}-name`}>{t('manage.name')}</label>
      <Input id={`${id}-name`} value={name} disabled={busy} onChange={(event) => { setName(event.target.value) }} aria-invalid={invalidField === 'name'} aria-describedby={invalidField === 'name' ? `${id}-error` : undefined} />
      <label htmlFor={`${id}-role`}>{t('manage.role')}</label>
      <Input id={`${id}-role`} value={role} disabled={busy} onChange={(event) => { setRole(event.target.value) }} aria-invalid={invalidField === 'role'} aria-describedby={invalidField === 'role' ? `${id}-error` : undefined} />
      <fieldset className={css.managementChoices} disabled={busy}><legend>{t('manage.kind')}</legend>
        {(['local-agent', 'remote-agent', 'service'] as const).map(value => <label key={value}>
          <input type="radio" name={`${id}-kind`} value={value} checked={kind === value} onChange={() => { setKind(value) }} />{t(`manage.kind.${value}`)}
        </label>)}
      </fieldset>
      <label htmlFor={`${id}-capabilities`}>{t('manage.capabilities')}</label>
      <Input id={`${id}-capabilities`} value={capabilities} disabled={busy} onChange={(event) => { setCapabilities(event.target.value) }} />
      <label htmlFor={`${id}-provider`}>{t('manage.provider')}</label>
      <Input id={`${id}-provider`} value={provider} disabled={busy} onChange={(event) => { setProvider(event.target.value) }} />
      <label htmlFor={`${id}-preset`}>{t('manage.preset')}</label>
      <Input id={`${id}-preset`} value={preset} disabled={busy} onChange={(event) => { setPreset(event.target.value) }} />
      <label htmlFor={`${id}-model`}>{t('manage.model')}</label>
      <Input id={`${id}-model`} value={model} disabled={busy} onChange={(event) => { setModel(event.target.value) }} />
    </>}
    {target.kind === 'channelOpen' && <>
      {catalog?.loading && <p role="status">{t('channel.catalogLoading')}</p>}
      {catalog?.error !== undefined && <p role="alert" className={css.error}>{catalog.error}</p>}
      {readCatalog !== undefined && <button type="button" disabled={busy || catalog?.loading} onClick={() => { void readCatalog() }}>{t('channel.refreshCatalog')}</button>}
      <fieldset id={`${id}-protocol`} tabIndex={-1} className={css.managementChoices} disabled={busy || catalog?.loading}>
        <legend>{t('channel.protocol')}</legend>
        {adapters.map(ref => <label key={`${ref.type}@${ref.version}`}><input type="radio" name={`${id}-protocol-choice`}
          checked={adapterChoice === `${ref.type}@${ref.version}`} onChange={() => { setAdapterChoice(`${ref.type}@${ref.version}`) }} />
        {t(`channel.protocol.${ref.type as 'direct' | 'consult' | 'discussion'}`)} v{ref.version}</label>)}
      </fieldset>
      <p>{t('channel.workflowSeparate')}</p>
      <fieldset id={`${id}-view`} tabIndex={-1} className={css.managementChoices} disabled={busy || catalog?.loading}>
        <legend>{t('channel.creationView')}</legend>
        {catalog?.value?.viewPolicies.map(ref => <label key={`${ref.type}@${ref.version}`}><input type="radio" name={`${id}-view-choice`}
          checked={viewChoice === `${ref.type}@${ref.version}`} onChange={() => { setViewChoice(`${ref.type}@${ref.version}`) }} />{ref.type} v{ref.version}</label>)}
      </fieldset>
      {adapter?.type === 'consult' && <div id={`${id}-consult`} tabIndex={-1}>
        <fieldset className={css.managementChoices} disabled={busy}><legend>{t('channel.initiator')}</legend>
          {options.map(member => <label key={member.id}><input type="radio" name={`${id}-initiator`} checked={initiator === member.id}

            onChange={() => {
              setInitiator(member.id)
              if (respondent === member.id) setRespondent(undefined)
            }} />{member.displayName}</label>)}
        </fieldset>
        <fieldset className={css.managementChoices} disabled={busy}><legend>{t('channel.respondent')}</legend>
          {options.map(member => <label key={member.id}><input type="radio" name={`${id}-respondent`} checked={respondent === member.id}

            onChange={() => {
              setRespondent(member.id)
              if (initiator === member.id) setInitiator(undefined)
            }} />{member.displayName}</label>)}
        </fieldset>
      </div>}
      {adapter?.type === 'discussion' && <fieldset id={`${id}-discussion`} tabIndex={-1} className={css.managementChoices} disabled={busy}>
        <legend>{t('channel.discussionLimits')}</legend>
        <label htmlFor={`${id}-max-turns`}>{t('channel.maxTurns')}</label>
        <Input id={`${id}-max-turns`} type="number" min={1} step={1} value={maxTurns} onChange={(event) => { setMaxTurns(event.target.value) }} />
        {(['round-robin', 'free-form'] as const).map(policy => <label key={policy}><input type="radio" name={`${id}-speaker-policy`} checked={speakerPolicy === policy}
          onChange={() => { setSpeakerPolicy(policy) }} />{t(`channel.speaker.${policy}`)}</label>)}
      </fieldset>}
    </>}
    <details className={inline ? hubCss.composerOptions : hubCss.expandedOptions} open={!inline}>
      <summary hidden={!inline}>{t('channelHub.deliveryOptions')}</summary>
      {target.kind === 'channelPost' && !basic && <fieldset id={`${id}-audience`} tabIndex={-1} className={css.managementChoices} disabled={busy || importing}>
        <legend>{t('channel.audienceMode')}</legend>
        <label><input type="radio" name={`${id}-audience-mode`} checked={audienceMode === 'selected'} onChange={() => { setAudienceMode('selected') }} />{t('channel.selectedAudience')}</label>
        {channel?.manifest.adapter.version === 4 && <label><input type="radio" name={`${id}-audience-mode`} checked={audienceMode === 'broadcast'}
          disabled={!broadcastAvailable} onChange={() => { setAudienceMode('broadcast') }} />{t('channel.broadcastAudience')}</label>}
        {!broadcastAvailable && channel?.manifest.adapter.version === 4 && <p>{t('channel.broadcastUnavailable')}</p>}
      </fieldset>}
      {(target.kind === 'channelOpen' && adapter?.type !== 'consult' || target.kind === 'channelPost' && !basic && audienceMode === 'selected') && <fieldset id={`${id}-members`} tabIndex={-1} className={css.managementChoices} disabled={busy || importing} aria-invalid={invalidField === 'members'} aria-describedby={invalidField === 'members' ? `${id}-error` : undefined}>
        <legend>{t(target.kind === 'channelOpen' ? 'manage.members' : 'manage.audience')}</legend>
        {options.map(item => <label key={item.id}>
          <input type="checkbox" checked={selected.includes(item.id)} onChange={(event) => {
            setSelected(previous => event.target.checked ? [...previous, item.id] : previous.filter(value => value !== item.id))
          }} />{item.displayName} · {item.role}
        </label>)}
        {target.kind === 'channelOpen' && adapter?.type === 'discussion' && <ol>{selected.map((memberId, index) => <li key={memberId}>
          {state.participants.find(member => member.id === memberId)?.displayName ?? t('channel.unknownParticipant')}
          <button type="button" disabled={index === 0} aria-label={t('channel.moveMemberUp', { index: index + 1 })} onClick={() => { setSelected((previous) => {
            const next = [...previous]; const moved = next.splice(index, 1); next.splice(index - 1, 0, ...moved); return next
          }) }}>{t('channel.moveUp')}</button>
          <button type="button" disabled={index === selected.length - 1} aria-label={t('channel.moveMemberDown', { index: index + 1 })} onClick={() => { setSelected((previous) => {
            const next = [...previous]; const moved = next.splice(index, 1); next.splice(index + 1, 0, ...moved); return next
          }) }}>{t('channel.moveDown')}</button>
        </li>)}</ol>}
      </fieldset>}
      {target.kind === 'channelPost' && channel?.manifest.adapter.type !== 'consult' && <fieldset className={css.managementChoices} disabled={busy}><legend>{t('manage.delivery')}</legend>
        {(basic ? ['turn', 'context'] as const : ['turn', 'context', 'steer'] as const).map(value => <label key={value}><input type="radio" name={`${id}-delivery`} checked={delivery === value} onChange={() => { setDelivery(value) }} />{t(`manage.delivery.${value}`)}</label>)}
      </fieldset>}
    </details>
    {target.kind === 'channelPost' && basic && <>
      <p>{t(channel.manifest.adapter.type === 'consult' ? 'channel.consultDelivery' : 'channel.discussionDelivery')}</p>
      <label htmlFor={`${id}-basic-text`}>{t('manage.text')}</label>
      <textarea id={`${id}-basic-text`} className={`${css.managementText} clocky-resize-none`} rows={inline ? 3 : 5} placeholder={inline ? t('channelHub.placeholder') : undefined} value={text} disabled={busy} onChange={(event) => { setText(event.target.value) }} />
    </>}
    {target.kind === 'channelClose' && <>
      <label htmlFor={`${id}-text`}>{t('manage.reason')}</label>
      <textarea id={`${id}-text`} className={`${css.managementText} clocky-resize-none`} value={text} disabled={busy} onChange={(event) => { setText(event.target.value) }} aria-invalid={invalidField === 'text'} aria-describedby={invalidField === 'text' ? `${id}-error` : undefined} rows={5} />
    </>}
    {target.kind === 'channelPost' && !basic && <fieldset id={`${id}-content`} tabIndex={-1} className={css.managementChoices}
      disabled={busy || importing} aria-invalid={invalidField === 'content'} aria-describedby={invalidField === 'content' ? `${id}-error` : undefined}>
      <legend>{t('channel.orderedContent')}</legend>
      {content.map((part, index) => <div key={part.id} className={css.channelDraftPart} role="group" aria-label={t('channel.contentItem', { index: index + 1 })}>
        {part.content.type === 'text' ? <>
          <label htmlFor={`${id}-content-${part.id}`}>{index === 0 ? t('manage.text') : t('channel.textPart', { index: index + 1 })}</label>
          <textarea id={`${id}-content-${part.id}`} rows={3} placeholder={inline ? t('channelHub.placeholder') : undefined} className={`${css.managementText} clocky-resize-none`} value={part.content.text}
            onChange={(event) => { const value = event.target.value; setContent(previous => previous.map(item => item.id === part.id ? { ...item, content: { type: 'text', text: value } } : item)) }} />
        </> : <img className={css.channelDraftImage} src={`data:${part.content.mediaType};base64,${part.content.data}`} alt={part.content.name ?? t('channel.image')} />}
        {(!inline || content.length > 1 || part.content.type === 'image') && <div className={css.actions}>
          <button type="button" disabled={index === 0} aria-label={t('channel.moveUpItem', { index: index + 1 })} onClick={() => { moveContent(index, -1) }}>{t('channel.moveUp')}</button>
          <button type="button" disabled={index === content.length - 1} aria-label={t('channel.moveDownItem', { index: index + 1 })} onClick={() => { moveContent(index, 1) }}>{t('channel.moveDown')}</button>
          <button type="button" aria-label={t('channel.removeItem', { index: index + 1 })} onClick={() => { setContent(previous => previous.filter(item => item.id !== part.id)) }}>{t('channel.remove')}</button>
        </div>}
      </div>)}
      <div className={css.actions}>
        <button type="button" onClick={() => { setContent(previous => [...previous, { id: crypto.randomUUID(), content: { type: 'text', text: '' } }]) }}>{t('channel.addText')}</button>
        <button type="button" onClick={() => { imageInput.current?.click() }}>{t('channel.addImages')}</button>
        <input ref={imageInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden aria-label={t('channel.addImages')}
          onChange={(event) => { const files = [...event.currentTarget.files ?? []]; event.currentTarget.value = ''; void addImages(files) }} />
      </div>
    </fieldset>}
    {error !== undefined && <p id={`${id}-error`} className={css.error} role="alert">{error}</p>}
    {busy && <p className={css.muted} role="status">{t('manage.pending')}</p>}
    {importing && <p className={css.muted} role="status">{t('channel.importingImages')}</p>}

  </form>
  return inline ? <><Modal open={discardDraft} title={t('channel.discardDraft')} closeLabel={t('cancel')}
    description={t('channel.discardDraftDescription')} onClose={() => { setDiscardDraft(false) }}
    footer={<><Button onClick={() => { setDiscardDraft(false) }}>{t('inbox.keepDraft')}</Button>
      <Button onClick={() => { clearDraft(); setError(undefined); setDiscardDraft(false) }}>{t('channel.discardDraft')}</Button></>} />
  <div className={hubCss.composer} data-channel-composer data-parts={content.length}>
    {formContent}
    <p className={hubCss.composerIdentity}>{t('channelHub.identity')}: {state.participants.find(member => member.id === senderId)?.displayName ?? t('channel.senderUnavailable')}
      {' · '}{audienceMode === 'broadcast' ? t('channel.broadcastAudience') : options.filter(member => selected.includes(member.id)).map(member => member.displayName).join(' · ')}
    </p>
    {footer}
  </div></>
    : <Modal open onClose={close} title={title} closeLabel={t('cancel')} footer={footer} bodyClassName={css.managementContent ?? ''}>{formContent}</Modal>
}

/** Keep management forms exhaustive when another operation is introduced. */
function assertNever(value: never): never {
  throw new Error(`Unsupported Team management target: ${String(value)}`)
}
