/** Administrative forms retain exact original selectors; recovery verifies current facts without rolling back. */
import { useEffect, useId, useRef, useState } from 'react'
import { Button, Input, Modal } from '@clocky/clocky-client-ui-primitives'
import type { SimulationProductControl, SimulationReadState, SimulationCommand, SimulationCommandKey,
  SimulationCommandState, SimulationProductObjectInput, SimulationProductObjectInspection } from '@clocky/clocky-client-runtime/client'
import { simulationCommandKey } from '@clocky/clocky-client-runtime/client'
import type { SimulationMaintenanceTarget, SimulationInputDraft } from './store.ts'
import { EMPTY_INPUT } from './store.ts'
import { CommandRecord } from './CommandRecord.tsx'
import type { Key } from './locales.ts'
import css from './Workspace.module.css'

/**
 * Render checkpoint/recovery/preparation confirmations or one entity's retained private input.
 * @param props - Exact selected run, Host admission/anchor, raw input and original command owner callbacks.
 * @returns administrative dialog with explicit original-result recovery, or a draft-discard confirmation.
 */
export function MaintenanceDialog({ target, name, control, recovery, readRecovery, closeRecovery, pageSize, connected,
  authorizationVersion, draft: value, commands,
  input, close, retain, submit, query, t, date, navigate, navigateApplication }: {
  navigate?: ((next: import('./store.ts').Route) => void) | undefined
  navigateApplication?: ((href: string) => void) | undefined
  target: SimulationMaintenanceTarget
  name: string
  control: SimulationReadState<SimulationProductControl>
  recovery: SimulationReadState<SimulationProductObjectInspection>
  readRecovery: (input: Extract<SimulationProductObjectInput, { collection: 'checkpoints' }>) => Promise<void>
  closeRecovery: () => void
  pageSize: number
  connected: boolean
  authorizationVersion: number
  draft?: SimulationInputDraft | undefined
  commands: Readonly<Record<string, SimulationCommandState>>
  input: (draft?: SimulationInputDraft) => void
  close: () => void
  retain: (command: SimulationCommand, version: number) => SimulationCommandKey
  submit: (key: SimulationCommandKey) => Promise<SimulationCommandState | undefined>
  query: (key: SimulationCommandKey) => Promise<SimulationCommandState | undefined>
  t: (key: Key) => string
  date: (time: number) => string
}) {
  const draft = value ?? EMPTY_INPUT
  const raw = useRef(draft)
  raw.current = draft
  const composing = useRef(false)
  const admission = useRef(false)
  const form = useRef<HTMLFormElement>(null)
  const id = useId()
  const [selected, setSelected] = useState<SimulationCommandKey>()
  const [error, setError] = useState<string>()
  const [errors, setErrors] = useState<Partial<Record<'entityId' | 'text' | 'availableAt', string>>>({})
  const [discard, setDiscard] = useState(false)
  const hints = control.value?.runId === target.runId ? control.value.administration : undefined
  const anchor = hints?.recovery
  useEffect(() => {
    if (target.kind !== 'restore' || anchor === undefined || !connected) return
    void readRecovery({ runId: target.runId, collection: 'checkpoints', id: anchor.checkpointId, section: 'references', limit: pageSize })
    return closeRecovery
  }, [target.kind, target.runId, anchor?.checkpointId, connected, authorizationVersion, pageSize, readRecovery, closeRecovery])
  const detail = recovery.value?.value
  const sources = recovery.value?.runId === target.runId && recovery.value.selection.id === anchor?.checkpointId
    && recovery.value.status === 'found' && detail?.collection === 'checkpoints' ? detail : undefined
  const key = target.commandKey ?? (target.kind === 'ingress' ? draft.commandKey : selected)
  const current = key === undefined ? undefined : commands[key]
  const ongoing = Object.values(commands).find(record => record.command.kind === target.kind
    && record.command.input.runId === target.runId && (record.unknown || record.pending
      || record.receipt?.value.status === 'accepted'))
  const original = current ?? ongoing
  const originalKey = original === undefined ? undefined : simulationCommandKey(original.command)
  const canSubmit = connected && hints !== undefined && control.error === undefined && !control.stale
    && hints.actions[target.kind].allowed && key === undefined && ongoing === undefined
    && (target.kind !== 'restore' || sources?.summary.status === 'completed' && !recovery.stale && recovery.error === undefined && !recovery.loading)
  const remember = (next: SimulationInputDraft): boolean => {
    try { input(next); raw.current = next; setError(undefined); return true }
    catch { setError(t('draftCapacity')); return false }
  }
  const field = (field: 'entityId' | 'text' | 'availableAt', text: string) => {
    setErrors(previous => ({ ...previous, [field]: undefined })); remember({ ...raw.current, [field]: text })
  }
  const execute = async () => {
    if (admission.current || !canSubmit || composing.current) return
    const latest = raw.current
    if (target.kind === 'ingress') {
      const invalid: typeof errors = {}
      if (!hints.ingress.targets.some(entity => entity.id === latest.entityId)) invalid.entityId = t('inputTargetRequired')
      if (latest.text.trim() === '') invalid.text = t('required')
      if (!/^(0|[1-9][0-9]*)$/.test(latest.availableAt.trim())
        || BigInt(latest.availableAt.trim()) > BigInt(hints.ingress.maxTime)) invalid.availableAt = t('inputTimeInvalid')
      setErrors(invalid)
      if (Object.keys(invalid).length > 0) {
        form.current?.querySelector<HTMLElement>(`[name="${Object.keys(invalid)[0]}"]`)?.focus(); return
      }
    }
    let command: SimulationCommand
    switch (target.kind) {
      case 'ingress': command = { kind: 'ingress', input: { runId: target.runId, ingressId: crypto.randomUUID() as never,
        entityId: latest.entityId as never, text: latest.text, availableAt: latest.availableAt.trim() as never } }; break
      case 'checkpoint': case 'prepare': command = { kind: target.kind, input: { runId: target.runId, commandId: crypto.randomUUID() as never } }; break
      case 'restore':
        /* v8 ignore next -- Restore submit is disabled until a Host recovery anchor is present. */
        if (anchor === undefined) return
        command = { kind: 'restore', input: { runId: target.runId, commandId: crypto.randomUUID() as never, checkpointId: anchor.checkpointId } }; break
      /* v8 ignore next -- The maintenance target is a closed typed selection. */
      default: return assertNever(target.kind)
    }
    const originalSelector = simulationCommandKey(command)
    if (target.kind === 'ingress' && !remember({ ...latest, commandKey: originalSelector })) return
    admission.current = true
    try {
      retain(command, authorizationVersion); setSelected(originalSelector)
      await submit(originalSelector)
    } catch {
      if (target.kind === 'ingress') remember({ ...raw.current, commandKey: undefined })
      setSelected(undefined); setError(t('commandCapacity'))
    } finally { admission.current = false }
  }
  const received = current?.receipt?.kind === 'ingress' && !current.unknown && !current.pending
  const acknowledgeInput = () => {
    /* v8 ignore next -- A received ingress receipt belongs to its parsed ingress command. */
    const submitted = current?.command.kind === 'ingress' ? current.command.input : undefined
    const latest = raw.current
    const unchanged = submitted !== undefined && latest.entityId === submitted.entityId && latest.text === submitted.text
      && latest.availableAt.trim() === submitted.availableAt
    input(unchanged ? undefined : { ...latest, commandKey: undefined }); close()
  }
  /* v8 ignore next -- The bundled CSS module always has formBody; fallback satisfies optional typings. */
  const bodyClassName = css.formBody ?? ''
  const recoveryRevision = (): number | string => {
    /* v8 ignore next -- A published recovery anchor is carried only by a loaded control value. */
    return control.value?.revision ?? t('unavailable')
  }
  return <>
    <Modal open title={t(`maintenance.${target.kind}`)} closeLabel={t('closeKeepDraft')} onClose={close}
      bodyClassName={bodyClassName} footer={<>
        {target.kind === 'ingress' && value !== undefined && <Button onClick={() => { setDiscard(true) }}>{t('discardDraft')}</Button>}
        <Button onClick={close}>{t('closeKeepDraft')}</Button>
        {received ? <Button onClick={acknowledgeInput}>{t('inputReceivedClose')}</Button>
          : <Button form={`${id}-maintenance`} type="submit" disabled={!canSubmit}>{t(`maintenance.${target.kind}`)}</Button>}
      </>}>
      <p>{name}</p>
      <p>{t(`maintenanceNotice.${target.kind}`)}</p>
      {hints !== undefined && !hints.actions[target.kind].allowed && <p role="status">{t(`maintenanceReason.${hints.actions[target.kind].reason}`)}</p>}
      {control.error !== undefined && <p role="alert">{t(control.error === 'forbidden' ? 'noControlAccess' : control.error)}</p>}
      {target.kind === 'restore' && anchor !== undefined && <dl>
        <dt>{t('checkpointId')}</dt><dd><code>{anchor.checkpointId}</code></dd>
        <dt>{t('checkpointPublishedAt')}</dt><dd>{date(anchor.publishedAt)}</dd>
        <dt>{t('time')}</dt><dd>{anchor.time}</dd><dt>{t('checkpointRevision')}</dt><dd>{anchor.revision}</dd>
        <dt>{t('currentRevision')}</dt><dd>{recoveryRevision()}</dd>
        <dt>{t('restoreSources')}</dt><dd>Run {anchor.references.runs} · Team {anchor.references.teams}
          · Channel {anchor.references.channels} · Session {anchor.references.sessions}</dd>
      </dl>}
      {target.kind === 'restore' && anchor !== undefined && <section aria-label={t('restoreSources')}>
        {recovery.loading && <p role="status">{t('loading')}</p>}
        {recovery.error !== undefined && <p role="alert">{t(recovery.error)}</p>}
        {recovery.stale && <p role="status" className={css.stalePill}>{t('stale')}</p>}
        {sources?.references.items.map((reference, index) => <p key={index}>{reference.kind}: <code>
          {'id' in reference ? reference.id : reference.cursor}</code></p>)}
        <div className={css.actions}><Button disabled={!connected || recovery.loading}
          onClick={() => { void readRecovery({ runId: target.runId, collection: 'checkpoints', id: anchor.checkpointId,
            section: 'references', limit: pageSize }) }}>{t('first')}</Button>
        <Button disabled={!connected || recovery.loading || recovery.stale || recovery.error !== undefined
          || sources?.references.nextCursor === undefined}
        onClick={() => { void readRecovery({ runId: target.runId, collection: 'checkpoints', id: anchor.checkpointId,
          section: 'references', limit: pageSize, cursor: sources?.references.nextCursor }) }}>{t('next')}</Button></div>
      </section>}
      <form ref={form} id={`${id}-maintenance`} className={css.form} noValidate
        onCompositionStart={() => { composing.current = true }} onCompositionEnd={() => { composing.current = false }}
        onSubmit={(event) => { event.preventDefault(); void execute() }}>
        {target.kind === 'ingress' && <>
          <p className={css.muted}>{t('draftRetention')}</p>
          <fieldset><legend>{t('inputEntity')}</legend>
            {hints?.ingress.targets.map(entity => <label className={css.radio} key={entity.id}>
              <input type="radio" name="entityId" checked={draft.entityId === entity.id} disabled={current?.pending}
                aria-invalid={errors.entityId !== undefined} aria-describedby={errors.entityId === undefined ? undefined : `${id}-entity-error`}
                onChange={() => { field('entityId', entity.id) }} />{entity.name.text} · {entity.id}
            </label>)}
            {errors.entityId !== undefined && <p role="alert" id={`${id}-entity-error`}>{errors.entityId}</p>}
          </fieldset>
          <label htmlFor={`${id}-text`}>{t('inputText')}</label>
          <textarea id={`${id}-text`} name="text" rows={5} className={`${css.textarea} clocky-resize-none`} value={draft.text} disabled={current?.pending}
            aria-invalid={errors.text !== undefined} aria-describedby={errors.text === undefined ? undefined : `${id}-text-error`}
            onChange={(event) => { field('text', event.target.value) }} />
          {errors.text !== undefined && <p role="alert" id={`${id}-text-error`}>{errors.text}</p>}
          <label htmlFor={`${id}-availableAt`}>{t('inputAvailableAt')}</label>
          <Input id={`${id}-availableAt`} name="availableAt" inputMode="numeric" value={draft.availableAt} disabled={current?.pending}
            aria-invalid={errors.availableAt !== undefined} aria-describedby={`${id}-time-help ${id}-time-error`}
            onChange={(event) => { field('availableAt', event.target.value) }} />
          <p id={`${id}-time-help`}>{t('inputHorizon')}: {hints?.ingress.maxTime ?? t('unavailable')}</p>
          <p role={errors.availableAt === undefined ? undefined : 'alert'} id={`${id}-time-error`}>{errors.availableAt}</p>
        </>}
        {error !== undefined && <p role="alert">{error}</p>}
      </form>
      {original !== undefined && originalKey !== undefined && <CommandRecord value={original} connected={connected} t={t}
        query={() => query(originalKey)} retry={() => submit(originalKey)} navigate={navigate}
        navigateApplication={navigateApplication} />}
    </Modal>
    {discard && <Modal open title={t('discardDraft')} closeLabel={t('keepEditing')} onClose={() => { setDiscard(false) }}
      footer={<><Button onClick={() => { setDiscard(false) }}>{t('keepEditing')}</Button>
        <Button onClick={() => {
          input(current?.unknown && draft.commandKey !== undefined ? { ...EMPTY_INPUT, commandKey: draft.commandKey } : undefined)
          setDiscard(false); close()
        }}>{t('discardDraft')}</Button></>}><p>{t('discardDraftNotice')}</p></Modal>}
  </>
}
/* v8 ignore next -- administrative UI selection is a closed typed union. */
function assertNever(value: never): never { void value; throw new Error('Unknown Simulation maintenance selection') }
