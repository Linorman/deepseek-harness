/** Portable JSON creation uses an inert Host preview and one retained original command. */
import { PreflightCapabilities } from './WorldPreview.tsx'
import { useEffect, useId, useRef, useState } from 'react'
import { Button, Input, Modal } from '@clocky/clocky-client-ui-primitives'
import { simulationProductWorldPreflightInputSchema } from '@clocky/clocky-simulation-product/world-schema'
import type { SimulationReadState, SimulationProductWorldPreflightInput, SimulationProductWorldPreflightResult,
  SimulationProductRunId, SimulationCommandState, SimulationCommandKey, SimulationCommand } from '@clocky/clocky-client-runtime/client'
import { simulationCommandKey } from '@clocky/clocky-client-runtime/client'
import type { SimulationWorldCreationDraft } from './store.ts'
import type { Key } from './locales.ts'
import { CommandRecord } from './CommandRecord.tsx'
import { Feedback } from './Feedback.tsx'
import { commandUnresolved } from './command-props.ts'
import css from './Workspace.module.css'

interface Props {
  draft?: SimulationWorldCreationDraft | undefined
  validation: SimulationReadState<SimulationProductWorldPreflightResult>
  command?: SimulationCommandState | undefined
  connected: boolean
  authorizationVersion: number
  maxDraftBytes: number
  preflight: (input: SimulationProductWorldPreflightInput) =>
  Promise<SimulationReadState<SimulationProductWorldPreflightResult> | undefined>
  closePreflight: () => void
  change: (value?: SimulationWorldCreationDraft) => void
  close: () => void
  openRun: (id: SimulationProductRunId) => void
  retain: (command: SimulationCommand, version: number) => SimulationCommandKey
  submit: (key: SimulationCommandKey) => Promise<SimulationCommandState | undefined>
  query: (key: SimulationCommandKey) => Promise<SimulationCommandState | undefined>
  t: (key: Key) => string
}
/**
 * Import a bounded JSON definition, inspect exact permissions/allowances, then create its original paused run.
 * @param props - Retained raw draft, authorized preview and original-command operations.
 * @returns canonical dialog and explicit raw-input discard confirmation.
 */
export function WorldCreationDialog(props: Props) {
  const { t } = props, id = useId(), draft = props.draft ?? { name: '', json: '' }
  const latest = useRef(props); latest.current = props
  const busy = useRef(false), fileGeneration = useRef(0), composing = useRef(false)
  const [error, setError] = useState<string>(), [discard, setDiscard] = useState(false)
  const [filePending, setFilePending] = useState(false)
  const retire = useRef(props.closePreflight); retire.current = props.closePreflight
  useEffect(() => () => { fileGeneration.current++; retire.current() }, [])
  const locked = draft.commandKey !== undefined
  const remember = (value: SimulationWorldCreationDraft) => {
    try { props.change(value); setError(undefined); return true }
    catch { setError(t('draftCapacity')); return false }
  }
  const edit = (value: SimulationWorldCreationDraft) => {
    fileGeneration.current++; setFilePending(false); props.closePreflight(); remember(value)
  }
  const validate = async () => {
    if (busy.current || locked || !props.connected || filePending) return
    let input: SimulationProductWorldPreflightInput
    try { input = simulationProductWorldPreflightInputSchema.parse({ definition: JSON.parse(draft.json) as unknown }) }
    catch { setError(t('world.invalidJson')); return }
    busy.current = true; setError(undefined)
    try { await props.preflight(input) } finally { busy.current = false }
  }
  let previewInput: SimulationProductWorldPreflightInput | undefined
  if (props.validation.value?.status === 'ready') {
    try { previewInput = simulationProductWorldPreflightInputSchema.parse({ definition: JSON.parse(draft.json) as unknown }) }
    catch { /* Editing invalidates the preview; malformed input cannot select a creation. */ }
  }
  const ready = previewInput !== undefined && props.validation.scope === JSON.stringify(['worldPreflight', previewInput])
    && props.validation.value?.status === 'ready' && !props.validation.loading && !props.validation.stale
    && props.validation.error === undefined ? props.validation.value : undefined
  const create = () => {
    if (busy.current || locked || !props.connected || ready === undefined || draft.name.trim() === '' || filePending) return
    busy.current = true
    try {
      const input = simulationProductWorldPreflightInputSchema.parse({ definition: JSON.parse(draft.json) as unknown })
      const command: SimulationCommand = { kind: 'world-create', input: { ...input, name: draft.name.trim(),
        commandId: crypto.randomUUID() as import('@clocky/clocky-client-runtime/client').SimulationProductCommandId,
        preflight: { hash: ready.preview.hash, catalogGeneration: ready.preview.catalogGeneration } } }
      const key = simulationCommandKey(command)
      // Check complete draft capacity before retaining the original, so an unsent command cannot be orphaned.
      props.change({ ...draft, commandKey: key })
      try { props.retain(command, props.authorizationVersion) }
      catch (cause: unknown) { props.change(draft); throw cause }
      void props.submit(key)
    } catch { setError(t('draftCapacity')) }
    finally { busy.current = false }
  }
  const importFile = async (file: File | undefined) => {
    if (file === undefined || locked) return
    const generation = ++fileGeneration.current, version = props.authorizationVersion
    if (!file.name.toLowerCase().endsWith('.json')) { setError(t('world.jsonOnly')); return }
    if (file.size > props.maxDraftBytes) { setError(t('draftCapacity')); return }
    setFilePending(true); props.closePreflight()
    try {
      const json = await file.text(), current = latest.current
      if (generation !== fileGeneration.current || current.authorizationVersion !== version
        || current.draft?.commandKey !== undefined) return
      try { current.change({ ...(current.draft ?? { name: '', json: '' }), json, fileName: file.name }); setError(undefined) }
      catch { setError(t('draftCapacity')) }
    } catch { if (generation === fileGeneration.current) setError(t('world.fileFailed')) }
    finally { if (generation === fileGeneration.current) setFilePending(false) }
  }
  const close = () => {
    if (locked || draft.name === '' && draft.json === '') props.close()
    else setDiscard(true)
  }
  return <>
    <Modal open size="form" title={t('world.import')} closeLabel={t('close')} onClose={close} footer={<>
      <Button variant="secondary" disabled={!props.connected || locked || props.validation.loading || filePending}
        onClick={() => { void validate() }}>{t('preflight')}</Button>
      <Button variant="primary" disabled={!props.connected || locked || ready === undefined || draft.name.trim() === '' || filePending}
        onClick={create}>{t('createPaused')}</Button>
    </>}>
      <p className={css.notice}>{t('world.scope')}</p>
      <form className={css.form} noValidate onSubmit={(event) => { event.preventDefault(); if (!composing.current) void validate() }}>
        <label htmlFor={`${id}-name`}>{t('name')}</label>
        <Input id={`${id}-name`} value={draft.name} disabled={locked}
          onChange={(event) => { edit({ ...draft, name: event.target.value }) }} />
        <label htmlFor={`${id}-file`}>{t('world.file')}</label>
        <input id={`${id}-file`} type="file" accept=".json,application/json" disabled={locked || filePending}
          aria-describedby={`${id}-retention`} onChange={(event) => { void importFile(event.target.files?.[0]); event.target.value = '' }} />
        {draft.fileName !== undefined && <p role="status">{t('world.fileRead')}: {draft.fileName}</p>}
        <label htmlFor={`${id}-json`}>{t('world.definition')}</label>
        <textarea id={`${id}-json`} rows={9} className={`${css.textarea} clocky-resize-none`} value={draft.json} disabled={locked || filePending}
          onCompositionStart={() => { composing.current = true }} onCompositionEnd={() => { composing.current = false }}
          onChange={(event) => { edit({ ...draft, json: event.target.value, fileName: undefined }) }} aria-describedby={`${id}-retention`} />
        <p id={`${id}-retention`} className={css.muted}>{t('draftRetention')}</p>
        {filePending && <p role="status">{t('loading')}</p>}
        {error !== undefined && <p role="alert">{error}</p>}
      </form>
      <Feedback value={props.validation} t={t} />
      {props.validation.value?.status === 'invalid' && <ul>{props.validation.value.diagnostics.map((issue, index) =>
        <li key={index}>{issue.path.join('.')}: {issue.code} · {issue.message}</li>)}</ul>}
      {ready !== undefined && <section aria-label={t('world.preview')}>
        <h3>{ready.organization.name}</h3><p>{ready.organization.description}</p>
        <PreflightCapabilities value={ready} t={t} />
        <h4>{t('world.actors')}</h4><ul>{ready.actors.map(actor => <li key={actor.entityId}>
          {actor.name} · {t(actor.role === 'director' ? 'world.director' : 'world.member')} · {actor.model.provider}/{actor.model.name}
          <small> · {actor.model.version}</small></li>)}</ul>
        <p>{t('world.directorAuthority')}</p>
        <h4>{t('world.permissions')}</h4><ul>{ready.authorizations.map(grant => <li key={`${grant.requesterEntityId}/${grant.positionEntityId}`}>
          {grant.requesterEntityId} → {grant.positionEntityId}</li>)}</ul>
        <h4>{t('world.positions')}</h4><ul>{ready.positions.map(position => <li key={position.entityId}>
          {position.name} · {position.occupied}/{position.capacity}</li>)}</ul>
        <h4>{t('world.allowances')}</h4><dl >{(['maxEntities', 'maxResidentActors', 'tokensPerModelRequest',
          'maxTokensPerInterval'] as const).map(key => <div key={key}><dt>{t(`limit.${key}`)}</dt><dd>{ready.limits.native[key]}</dd></div>)}</dl>
        <p>{t('limit.maxTime')}: {ready.maxTime} · {ready.tickUnit}</p>
        <p>{t('budgetInterval')}: {ready.budgetInterval} · {ready.tickUnit}</p>
        <details><summary>{t('world.allAllowances')}</summary>
          <pre className={css.contextText}>{JSON.stringify(ready.limits, null, 2)}</pre></details>
        <p>{t('world.previewNotice')}</p>
      </section>}
      {props.command !== undefined && draft.commandKey !== undefined && <CommandRecord value={props.command}
        connected={props.connected} t={t}
        query={() => props.query(draft.commandKey as SimulationCommandKey)}
        retry={() => props.submit(draft.commandKey as SimulationCommandKey)} />}
      {props.command?.receipt?.kind === 'request' && <Button onClick={() => {
        if (props.command?.receipt?.kind === 'request') props.openRun(props.command.receipt.value.runId)
      }}>{t('openCreatedRun')}</Button>}
      {locked && !commandUnresolved(props.command) && <Button variant="secondary" onClick={() => {
        props.closePreflight(); props.change({ name: draft.name, json: draft.json })
      }}>{t('world.newIntent')}</Button>}
    </Modal>
    {discard && <Modal open title={t('discardDraft')} closeLabel={t('keepEditing')} onClose={() => { setDiscard(false) }} footer={<>
      <Button variant="secondary" onClick={() => { setDiscard(false) }}>{t('keepEditing')}</Button>
      <Button onClick={() => { props.change(undefined); props.closePreflight(); props.close() }}>{t('discardDraft')}</Button>
    </>}><p>{t('discardDraftNotice')}</p></Modal>}
  </>
}
