/** Installed-template creation preserves raw input and its original command across uncertain results. */
import { useEffect, useId, useRef, useState } from 'react'
import { Button, Input, Modal } from '@clocky/clocky-client-ui-primitives'
import type { PropsRenderSlots } from '@clocky/clocky-client-ui-slots'
import type {} from '@clocky/clocky-client-ui-settings/client'
import type { SimulationReadState, SimulationProductCatalog, SimulationCommandState, SimulationCommandKey, SimulationCommand,
  SimulationProductRunId } from '@clocky/clocky-client-runtime/client'
import type { SimulationProductLimits, SimulationProductPreflightInput, SimulationProductPreflightResult } from '@clocky/clocky-client-runtime/client'
import { simulationCommandKey } from '@clocky/clocky-client-runtime/client'
import type { SimulationCreationDraft } from './store.ts'
import { EMPTY_CREATION } from './store.ts'
import type { Key } from './locales.ts'
import { CommandRecord } from './CommandRecord.tsx'
import css from './Workspace.module.css'

type Limit = keyof SimulationProductLimits
type Field = 'templateId' | 'name' | 'buyerName' | 'supplierName' | 'initialStock' | `limits.${Limit}`
const limits: readonly Limit[] = ['maxEntities', 'maxResidentActors', 'tokensPerModelRequest', 'maxTokensPerInterval', 'maxTime']
/**
 * Render the installed company-template form; no executable configuration or provider strings are authored.
 * @param props - Raw retained input, runtime catalog/original result and explicit command callbacks.
 * @returns create dialog or an explicit input-discard confirmation.
 */
export function CreationDialog({ draft: value, catalog, validation, preflight, closePreflight,
  connected, authorizationVersion, maxDraftBytes,
  command, change, close, openRun, refreshCatalog, retain, release, submit, query, t, renderSlot, returnFromModelSetup }: {
    draft?: SimulationCreationDraft | undefined
    catalog: SimulationReadState<SimulationProductCatalog>
    validation: SimulationReadState<SimulationProductPreflightResult>
    preflight: (input: SimulationProductPreflightInput) => Promise<SimulationReadState<SimulationProductPreflightResult> | undefined>
    closePreflight: () => void
    connected: boolean
    authorizationVersion: number
    maxDraftBytes: number
    command?: SimulationCommandState | undefined
    change: (draft?: SimulationCreationDraft) => void
    close: () => void
    openRun: (runId: SimulationProductRunId) => void
    refreshCatalog: () => Promise<void>
    retain: (command: SimulationCommand, authorizationVersion: number) => SimulationCommandKey
    release: (key: SimulationCommandKey) => boolean
    returnFromModelSetup: () => void
    submit: (key: SimulationCommandKey) => Promise<SimulationCommandState | undefined>
    query: (key: SimulationCommandKey) => Promise<SimulationCommandState | undefined>
    t: (key: Key) => string
  } & PropsRenderSlots<'settings.model-setup'>) {
  const draft = value ?? EMPTY_CREATION
  const commandKey = draft.commandKey
  const id = useId()
  const inputRef = useRef(draft)
  inputRef.current = draft
  const busy = useRef(false)
  const composing = useRef(false)
  const form = useRef<HTMLFormElement>(null)
  const [discard, setDiscard] = useState(false)
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({})
  const [error, setError] = useState<string>()
  const recheck = useRef<() => Promise<void>>()
  const retire = useRef(closePreflight)
  retire.current = closePreflight
  useEffect(() => () => { retire.current() }, [])
  const template = catalog.value?.items.find(item => item.id === draft.templateId)
  const canCreate = connected && !catalog.loading && !catalog.stale && catalog.error === undefined
    && catalog.value !== undefined && catalog.value.items.length > 0
    && draft.commandKey === undefined && !command?.pending && !validation.loading
  const canSubmit = canCreate && (template === undefined || template.readiness.status === 'ready')
  const remember = (next: SimulationCreationDraft): boolean => {
    if (new TextEncoder().encode(JSON.stringify({ creation: next })).byteLength > maxDraftBytes) {
      setError(t('draftCapacity')); return false
    }
    try { change(next); inputRef.current = next; return true }
    catch { setError(t('draftCapacity')); return false }
  }
  const field = (name: Field, text: string) => {
    closePreflight(); setError(undefined)
    setErrors(current => ({ ...current, [name]: undefined })); remember({ ...inputRef.current, [name]: text })
  }
  const limitField = (name: Limit, text: string) => {
    closePreflight(); setError(undefined); setErrors(current => ({ ...current, [`limits.${name}`]: undefined }))
    remember({ ...inputRef.current, limits: { ...inputRef.current.limits, [name]: text } })
  }
  const focusInvalid = (name: string) => {
    const input = form.current?.querySelector<HTMLElement>(`[name="${name}"]`)
    const disclosure = input?.closest('details')
    if (disclosure !== null && disclosure !== undefined) disclosure.open = true
    input?.focus()
  }
  const onSubmit = async (create = true) => {
    if (busy.current || !canCreate || create && !canSubmit) return
    const raw = inputRef.current
    const selected = catalog.value.items.find(item => item.id === raw.templateId)
    const invalid: Partial<Record<Field, string>> = {}
    if (selected === undefined) invalid.templateId = t('templateRequired')
    for (const name of ['name', 'buyerName', 'supplierName'] as const) if (raw[name].trim() === '') invalid[name] = t('required')
    if (!/^[1-9][0-9]*$/.test(raw.initialStock.trim())
      || selected !== undefined && BigInt(raw.initialStock.trim()) > BigInt(selected.maxStock)) {
      invalid.initialStock = t('stockInvalid')
    }
    const overrides: { -readonly [K in Limit]?: SimulationProductLimits[K] } = {}
    for (const name of limits) {
      const text = raw.limits?.[name]?.trim() ?? ''
      if (text === '') continue
      if (selected?.configuration?.editable.includes(name) !== true) invalid[`limits.${name}`] = t('limitNotEditable')
      else if (!(name === 'maxTokensPerInterval' ? /^(0|[1-9][0-9]*)$/ : /^[1-9][0-9]*$/).test(text)
        || name !== 'maxTime' && !Number.isSafeInteger(Number(text))) invalid[`limits.${name}`] = t('limitInvalid')
      else if (name === 'maxTime') overrides.maxTime = text
      else overrides[name] = Number(text)
    }
    setErrors(invalid)
    if (Object.keys(invalid).length > 0) {
      const first = Object.keys(invalid)[0]
      /* v8 ignore next -- A nonempty invalid-field map always has a first key. */
      if (first !== undefined) focusInvalid(first)
      return
    }
    /* v8 ignore next -- Missing template selection was added to invalid and returned above. */
    if (selected === undefined) return
    const input: SimulationProductPreflightInput = {
      templateId: selected.id, templateVersion: selected.version, name: raw.name.trim(),
      parameters: { buyerName: raw.buyerName.trim(), supplierName: raw.supplierName.trim(), initialStock: raw.initialStock.trim() },
      ...Object.keys(overrides).length === 0 ? {} : { limits: overrides } }
    busy.current = true
    try {
      const checked = await preflight(input)
      if (inputRef.current !== raw || checked === undefined) return
      if (checked.error !== undefined || checked.stale || checked.value === undefined) {
        setError(t(checked.error ?? 'stale')); return
      }
      if (checked.value.status === 'invalid') {
        const fields: Partial<Record<Field, string>> = {}
        for (const issue of checked.value.issues) fields[issue.field.replace(/^parameters\./, '') as Field] = issue.message.text
        setErrors(fields)
        const first = Object.keys(fields)[0]
        /* v8 ignore next -- Parsed invalid preflight results require at least one issue. */
        if (first !== undefined) focusInvalid(first)
        setError(checked.value.issues.map(issue => issue.message.text).join(' · ')); return
      }
      if (selected.readiness.status !== 'ready' || selected.readiness.model.provider !== checked.value.readiness.model.provider
        || selected.readiness.model.name !== checked.value.readiness.model.name) {
        setError(t('model-changed'))
        await refreshCatalog()
        return
      }
      if (!create) return
      const original: SimulationCommand = { kind: 'create', input: { ...input, expectedModel: checked.value.readiness.model,
        commandId: crypto.randomUUID() as never } }
      const key = simulationCommandKey(original)
      // The original selector is retained only after validation; failed reads cannot allocate a replacement command.
      if (!remember({ ...raw, commandKey: key })) return
      retain(original, authorizationVersion)
      await submit(key)
    } catch {
      remember({ ...inputRef.current, commandKey: undefined }); setError(t('commandCapacity'))
    } finally { busy.current = false }
  }
  const knownRun = command?.receipt?.kind === 'request' ? command.receipt.value.runId : undefined
  recheck.current = () => onSubmit(false)
  useEffect(() => {
    if (!draft.recheckAfterModelSetup || !canCreate) return
    remember({ ...inputRef.current, recheckAfterModelSetup: undefined })
    void recheck.current?.()
  }, [draft.recheckAfterModelSetup, canCreate, catalog.value])
  const original = command?.command.kind === 'create' ? command.command.input : undefined
  const sameOriginal = original !== undefined && draft.name.trim() === original.name && draft.templateId === original.templateId
    && draft.buyerName.trim() === original.parameters.buyerName && draft.supplierName.trim() === original.parameters.supplierName
    && draft.initialStock.trim() === original.parameters.initialStock
    && limits.every(name => (draft.limits?.[name]?.trim() ?? '') === (original.limits?.[name]?.toString() ?? ''))
  const readyValidation = validation.value?.status === 'ready' && !validation.stale && !validation.loading
    && validation.error === undefined ? validation.value : undefined
  return <>
    <Modal open size="form" title={t('createTitle')} closeLabel={t('closeKeepDraft')} onClose={close}
      footer={<>
        <Button onClick={() => { setDiscard(true) }}>{t('discardDraft')}</Button>
        <Button onClick={close}>{t('closeKeepDraft')}</Button>
        <Button variant="secondary" disabled={!canCreate} onClick={() => { void onSubmit(false) }}>{t('preflight')}</Button>
        {knownRun !== undefined ? <Button variant="primary" onClick={() => {
          const raw = inputRef.current
          change(sameOriginal ? undefined : { ...raw, commandKey: undefined }); openRun(knownRun)
        }}>{t('openCreatedRun')}</Button>
          : <Button variant="primary" type="submit" form={`${id}-form`} disabled={!canSubmit}>{t('createPaused')}</Button>}
      </>}>
      <p className={css.formIntro}>{t('creationNoInference')}</p>
      {template?.readiness.status === 'needs-model' && <section role="status">
        <p>{t('readiness.needs-model')}</p>
        {renderSlot('settings.model-setup', { beforeOpen: close, afterClose: returnFromModelSetup })}
      </section>}
      {template?.readiness.status === 'unavailable' && <section role="status">
        <p>{t(`readiness.${template.readiness.reason}`)}</p>
        {renderSlot('settings.model-setup', { beforeOpen: close, afterClose: returnFromModelSetup })}
      </section>}
      {command?.notAccepted && commandKey !== undefined && <Button variant="secondary" onClick={() => {
        if (!release(commandKey)) return
        remember({ ...inputRef.current, commandKey: undefined })
        closePreflight(); void refreshCatalog()
      }}>{t('reconfirmModel')}</Button>}
      {catalog.loading && <p role="status">{t('loading')}</p>}
      {catalog.error !== undefined && <p role="alert">{t(catalog.error === 'unavailable' ? 'noManagement' : catalog.error)}</p>}
      {catalog.value?.items.length === 0 && !catalog.loading && <p role="status">{t('noTemplates')}</p>}
      <Button variant="secondary" disabled={!connected || catalog.loading} onClick={() => { void refreshCatalog() }}>{t('refreshTemplates')}</Button>
      <form ref={form} id={`${id}-form`} className={css.form} noValidate onCompositionStart={() => { composing.current = true }} onCompositionEnd={() => { composing.current = false }}
        onSubmit={(event) => { event.preventDefault(); if (!composing.current) void onSubmit() }}>
        <fieldset disabled={command?.pending} aria-describedby={errors.templateId === undefined ? undefined : `${id}-template-error`}>
          <legend>{t('template')}</legend>
          {catalog.value?.items.map(item => <label key={item.id} className={css.radio}>
            <input name="templateId" type="radio" checked={draft.templateId === item.id} onChange={() => { field('templateId', item.id) }}
              aria-invalid={errors.templateId !== undefined} />{item.name.text} · {item.version}
          </label>)}
          {errors.templateId !== undefined && <p id={`${id}-template-error`} role="alert">{errors.templateId}</p>}
        </fieldset>
        {template !== undefined && <p className={css.muted}>{t(template.execution === 'automatic-tasks' ? 'automaticTasks' : 'cognitionOnly')}</p>}
        <div className={css.formFields}>
          {(['name', 'buyerName', 'supplierName', 'initialStock'] as const).map(name => <div key={name} className={css.field}>
            <label htmlFor={`${id}-${name}`}>{t(name)}</label>
            <Input id={`${id}-${name}`} name={name} value={draft[name]} disabled={command?.pending}
              inputMode={name === 'initialStock' ? 'numeric' : 'text'} aria-invalid={errors[name] !== undefined}
              aria-describedby={errors[name] === undefined ? undefined : `${id}-${name}-error`}
              onChange={(event) => { field(name, event.target.value) }} />
            {errors[name] !== undefined && <p id={`${id}-${name}-error`} role="alert">{errors[name]}</p>}
          </div>)}
        </div>
        {template !== undefined && <details className={css.formDisclosure}><summary>{t('installedConfiguration')}</summary><dl><dt>{t('model')}</dt><dd>{template.readiness.status === 'ready'
          ? `${template.readiness.model.provider}/${template.readiness.model.name}` : t('unavailable')}</dd>
        {template.cognition !== undefined && <><dt>{t('cognitionStrategy')}</dt><dd>{t(template.cognition === 'deterministic' ? 'deterministicStrategy' : 'modelStrategy')}</dd></>}
        <dt>{t('timeUnit')}</dt><dd>{template.tickUnit.text}</dd><dt>{t('stockMaximum')}</dt><dd>{template.maxStock}</dd>
        <dt>{t('reviewMode')}</dt><dd>{t(template.review === 'buyer' ? 'reviewBuyer' : template.review === 'participant' ? 'reviewParticipant' : 'reviewNone')}</dd></dl></details>}
        {template?.configuration !== undefined && <p className={css.muted}>{t('tokensPerInterval')}: {template.configuration.limits.maxTokensPerInterval} · {t('residentActors')}: {template.configuration.limits.maxResidentActors}</p>}
        {template?.configuration !== undefined && <details className={css.formDisclosure}><summary>{t('adjustLimits')}</summary><fieldset>
          <legend>{t('runLimits')}</legend><p>{t('limitsNotice')}</p>
          <dl><dt>{t('sharedModelLimit')}</dt><dd>{template.configuration.sharedModelLimit}</dd>
            <dt>{t('budgetInterval')}</dt><dd>{template.configuration.budgetInterval} · {template.configuration.tickUnit.text}</dd>
            <dt>{t('status.rules')}</dt><dd>{template.configuration.rulesVersion.text}</dd>
            <dt>{t('status.policy')}</dt><dd>{template.configuration.policyVersion.text}</dd></dl>
          {limits.map(name => <div key={name} className={css.field}>
            <label htmlFor={`${id}-limits-${name}`}>{t(`limit.${name}`)}</label>
            {template.configuration?.editable.includes(name) === true ? <Input id={`${id}-limits-${name}`} name={`limits.${name}`}
              inputMode="numeric" value={draft.limits?.[name] ?? ''} placeholder={String(template.configuration.limits[name])}
              disabled={command?.pending} aria-invalid={errors[`limits.${name}`] !== undefined}
              aria-describedby={`${id}-limits-${name}-hint${errors[`limits.${name}`] === undefined ? '' : ` ${id}-limits-${name}-error`}`}
              onChange={(event) => { limitField(name, event.target.value) }} /> : <p>{template.configuration?.limits[name]}</p>}
            <p id={`${id}-limits-${name}-hint`} className={css.muted}>{t('installedMaximum')}: {template.configuration?.limits[name]}</p>
            {(draft.limits?.[name]?.trim() ?? '') !== '' && <Button variant="secondary" disabled={command?.pending}
              aria-label={`${t('useInstalledDefault')} · ${t(`limit.${name}`)}`} onClick={() => { limitField(name, '') }}>{t('useInstalledDefault')}</Button>}
            {errors[`limits.${name}`] !== undefined && <p id={`${id}-limits-${name}-error`} role="alert">{errors[`limits.${name}`]}</p>}
          </div>)}
        </fieldset></details>}
        <p className={css.muted}>{t('draftRetention')}</p>
        {error !== undefined && <p role="alert">{error}</p>}
      </form>
      {validation.loading && <p role="status">{t('preflightLoading')}</p>}
      {readyValidation !== undefined && <section aria-label={t('preflight')}>
        <p role="status">{t('preflightReady')}</p>
        <details><summary>{t('runLimits')}</summary><dl>{limits.map(name => <div key={name}><dt>{t(`limit.${name}`)}</dt><dd>
          {readyValidation.configuration.limits[name]}</dd></div>)}</dl></details>
      </section>}
      {command !== undefined && commandKey !== undefined && <CommandRecord value={command} connected={connected} t={t}
        query={() => query(commandKey)} retry={() => submit(commandKey)} />}
      {commandKey !== undefined && original !== undefined && !sameOriginal && <section>
        <p>{t('changedCreationNotice')}</p>
        <Button disabled={!connected || command?.pending || validation.loading} onClick={() => {
          closePreflight(); setErrors({}); setError(undefined)
          remember({ ...inputRef.current, commandKey: undefined })
        }}>{t('useChangedCreation')}</Button>
      </section>}
    </Modal>
    {discard && <Modal open title={t('discardDraft')} closeLabel={t('keepEditing')} onClose={() => { setDiscard(false) }}
      footer={<><Button onClick={() => { setDiscard(false) }}>{t('keepEditing')}</Button>
        <Button onClick={() => { change(command?.unknown && draft.commandKey !== undefined ? { ...EMPTY_CREATION, commandKey: draft.commandKey } : undefined); setDiscard(false); close() }}>{t('discardDraft')}</Button></>}>
      <p>{t('discardDraftNotice')}</p>
    </Modal>}
  </>
}
