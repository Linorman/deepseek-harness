import { PersonaEditor } from './WorldPersonaEditor.tsx'
import { parsePersonaManagementCommand } from '@clocky/clocky-simulation-product/world-management-schema'
/** Unified management flow: fill Host-declared fields, inspect an inert impact preview, then retain one original command. */
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Button, Input, Modal } from '@clocky/clocky-client-ui-primitives'
import type { ActionField, ActionPreview, EngineRef, WorldActionKind, WorldWindow } from './world-domain.ts'
import { SIM_TIME, windowValue } from './world-domain.ts'
import type { Key } from './locales.ts'
import { CopyId, WindowStatus } from './WorldFacts.tsx'
import type { WorldT } from './WorldFacts.tsx'
import { ObligationList } from './WorldVotes.tsx'
import css from './World.module.css'

/** Step of the flow; the original step replaces the form once a command is retained. */
export type ActionStep = 'fill' | 'preview' | 'original'
const STEPS: readonly ActionStep[] = ['fill', 'preview', 'original']
const FIELD_LABELS: Readonly<Record<string, Key>> = {
  position: 'world.action.field.position', effective: 'world.action.field.effective', at: 'world.action.field.at',
  reason: 'world.action.field.reason',
  assignmentId: 'world.action.field.assignment', retire: 'world.action.field.retire',
}

/** Props of the management flow; command ownership stays with the caller. */
export interface ActionFlowProps {
  action: WorldActionKind
  /** Read-only target summary, e.g. "Wang Qiang · R&D › Researcher · tenure #a12 r7". */
  target: string
  expectedRevision: number
  fields: WorldWindow<readonly ActionField[]>
  preview: WorldWindow<ActionPreview>
  values: Readonly<Record<string, string>>
  connected: boolean
  /** Store edits to the retained management draft; editing invalidates any preview. */
  change: (values: Readonly<Record<string, string>>) => void
  requestPreview: (values: Readonly<Record<string, string>>) => void
  /** Retain and submit the original command; absent while the Host accepts no such command. */
  submit?: ((preview: ActionPreview) => boolean | void) | undefined
  /** Original command presentation after retention (CommandRecord with query-first recovery). */
  original?: ReactNode
  openObligations?: (() => void) | undefined
  openRef: (ref: EngineRef) => void
  close: () => void
  t: WorldT
}

/**
 * Three-step management dialog. Returning to step one invalidates the preview; submission is busy from the first click.
 * @param props - Host-declared fields, preview window and caller-owned command callbacks.
 * @returns form-size modal.
 */
export function ActionFlow(props: ActionFlowProps) {
  const { t } = props, id = useId()
  const [step, setStep] = useState<ActionStep>(props.original === undefined ? 'fill' : 'original')
  const [previewed, setPreviewed] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [refused, setRefused] = useState(false)
  const [errors, setErrors] = useState<Readonly<Record<string, Key>>>({})
  const sent = useRef(false)
  const shown = props.original !== undefined ? 'original' : step
  const supported = props.action === 'hiring-market' || props.action === 'transfer' || props.action === 'depart' || props.action === 'hire-existing'
  const fields = windowValue(props.fields)?.value ?? []
  const persona = useMemo(() => {
    if (props.action !== 'hiring-market' || props.values['command'] === undefined) return undefined
    try { return parsePersonaManagementCommand(props.values['command']) }
    catch { return undefined /* Invalid raw drafts remain editable and Host preflight rejects them. */ }
  }, [props.action, props.values['command']])
  const preview = windowValue(props.preview)
  const blockers = preview?.value.blockers.map((blocker, index) => {
    const code = preview.value.original?.blockers[index]
    return { ...blocker, reason: code === undefined ? blocker.reason : t(`status.stop.${code}`) }
  }) ?? []
  // The effective-time field applies only to an explicit time; other timings never submit a leftover value.
  const timed = !fields.some(field => field.id === 'effective') || props.values['effective'] === 'at'
  const visible = fields.filter(field => (field.id !== 'at' || timed)
    && !(persona !== undefined && field.id === 'command' && field.kind !== 'persona'))
  const submitted: Readonly<Record<string, string>> = timed ? props.values
    : Object.fromEntries(Object.entries(props.values).filter(([key]) => key !== 'at'))
  // A required choice with exactly one Host option has no decision to make; select it once the fields arrive.
  const fieldsKey = JSON.stringify(fields.map(field => field.id))
  useEffect(() => {
    const defaults = Object.fromEntries(fields.flatMap(field => field.kind === 'choice' && field.required && field.options.length === 1
      && (props.values[field.id] ?? '') === '' ? [[field.id, field.options[0]?.id ?? '']] : []))
    if (Object.keys(defaults).length > 0) props.change({ ...props.values, ...defaults })
  }, [fieldsKey])
  const current = previewed === JSON.stringify(submitted)
  const revisionChanged = preview !== undefined && preview.value.revision !== props.expectedRevision
  const canSubmit = supported && props.connected && current && preview !== undefined && !preview.stale
    && preview.value.blockers.length === 0
    && !revisionChanged && props.submit !== undefined && !busy && props.preview.status === 'ready'
  const validate = () => {
    const next: Record<string, Key> = {}
    for (const field of visible) {
      const value = props.values[field.id] ?? ''
      if ((field.required || field.id === 'at' && props.values['effective'] === 'at') && value.trim() === '') next[field.id] = 'world.action.required'
      else if (field.kind === 'time' && value !== '' && !SIM_TIME.test(value)) next[field.id] = 'world.org.at.invalid'
      else if ((field.kind === 'text' || field.kind === 'persona') && new TextEncoder().encode(value).byteLength > field.maxBytes)
        next[field.id] = 'world.action.reasonTooLarge'
    }
    setErrors(next)
    if (Object.keys(next).length > 0) {
      document.getElementById(`${id}-${Object.keys(next)[0] ?? ''}`)?.focus()
      return false
    }
    return true
  }
  const toPreview = () => {
    if (!supported || !validate()) return
    setPreviewed(JSON.stringify(submitted)); props.requestPreview(submitted); setStep('preview')
  }
  const edit = (field: string, value: string) => { props.change({ ...props.values, [field]: value }) }
  const label = (field: ActionField): string => {
    const key = FIELD_LABELS[field.id]
    return key === undefined ? field.id : t(key)
  }
  const renderField = (field: ActionField) => {
    const value = props.values[field.id] ?? '', error = errors[field.id], fieldId = `${id}-${field.id}`
    const described = error === undefined ? undefined : `${fieldId}-error`
    switch (field.kind) {
      case 'choice': return <fieldset key={field.id} className={css.choiceGroup} aria-describedby={described}>
        <legend>{label(field)}{field.required && <span className={css.required} aria-hidden="true"> *</span>}</legend>
        {field.options.map((option, index) => <label key={option.id} className={css.choice}>
          <input id={index === 0 ? fieldId : undefined} type="radio" name={fieldId} value={option.id} checked={value === option.id}
            onChange={() => { edit(field.id, option.id) }} />{field.id === 'effective' && (option.id === 'boundary' || option.id === 'at')
            ? t(`world.action.effective.${option.id}`) : field.id === 'retire' && (option.id === 'yes' || option.id === 'no')
              ? t(`world.action.retire.${option.id}`) : option.label}</label>)}
        {field.id === 'effective' && value === 'at' && <p className={css.muted}>{t('world.action.effective.notice')}</p>}
        {error !== undefined && <p id={described} className={css.fieldError}>{t(error)}</p>}
      </fieldset>
      case 'time': return <div key={field.id} className={css.field}>
        <label htmlFor={fieldId}>{label(field)}{field.required && <span className={css.required} aria-hidden="true"> *</span>}</label>
        <Input id={fieldId} inputMode="numeric" value={value} aria-invalid={error !== undefined || undefined} aria-describedby={described}
          onChange={(event) => { edit(field.id, event.target.value) }} />
        {error !== undefined && <p id={described} className={css.fieldError}>{t(error)}</p>}
      </div>
      case 'persona': return <div key={field.id}><PersonaEditor field={field} value={value} id={fieldId}
        change={(next) => { edit(field.id, next) }} t={t} />
      {error !== undefined && <p role="alert" className={css.fieldError}>{t(error)}</p>}</div>
      case 'text': return <div key={field.id} className={css.field}>
        <label htmlFor={fieldId}>{label(field)}{field.required && <span className={css.required} aria-hidden="true"> *</span>}</label>
        <textarea id={fieldId} rows={3} className={`${css.textarea} ${css['resize-none']}`} value={value} aria-invalid={error !== undefined || undefined}
          aria-describedby={described} onChange={(event) => { edit(field.id, event.target.value) }} />
        {error !== undefined && <p id={described} className={css.fieldError}>{t(error)}</p>}
      </div>
      default: { const unreachable: never = field; throw new Error(`Unknown action field ${JSON.stringify(unreachable)}`) }
    }
  }
  const footer = shown === 'fill' ? <>
    <Button variant="secondary" onClick={props.close}>{t('world.close')}</Button>
    <Button variant="primary" disabled={!supported || !props.connected || props.fields.status !== 'ready'} onClick={toPreview}>{t('world.action.next')}</Button>
  </> : shown === 'preview' ? <>
    <Button variant="secondary" onClick={() => { setStep('fill') }}>{t('world.action.back')}</Button>
    <Button variant="primary" disabled={!canSubmit} loading={busy} onClick={(event) => {
      if (event.detail > 1 || !canSubmit || sent.current) return
      sent.current = true; setBusy(true)
      if (props.submit?.(preview.value) === false) { sent.current = false; setBusy(false); setRefused(true) }
    }}>{t('world.action.confirm')}</Button>
  </> : <Button variant="secondary" onClick={(event) => {
    // The first click submitted from this location; its second click must not dismiss the retained original.
    if (event.detail < 2) props.close()
  }}>{t('world.close')}</Button>
  return <Modal open size="form" title={t(`world.action.${props.action}`)} closeLabel={t('world.close')} onClose={props.close} footer={footer}>
    <ol className={css.stepper} aria-label={t(`world.action.${props.action}`)}>{STEPS.map((item, index) => <li key={item}
      data-state={STEPS.indexOf(shown) > index ? 'done' : shown === item ? 'current' : 'pending'}
      aria-current={shown === item ? 'step' : undefined}><span className={css.stepIndex}>{index + 1}</span>{t(`world.action.step.${item}`)}</li>)}</ol>
    <p className={css.targetSummary}><span>{t('world.action.target')}</span><strong>{props.target}</strong><span>r{props.expectedRevision}</span></p>
    <div key={shown} className={css.stepBody}>
      {shown === 'fill' && <>
        {!supported && <p className={css.notice}>{t('world.action.unsupported')}</p>}
        <WindowStatus window={props.fields} t={t} />
        {props.fields.status === 'ready' && fields.length === 0 && <p className={css.muted}>{t('world.action.noFields')}</p>}
        <form className={css.form} noValidate onSubmit={(event) => { event.preventDefault(); toPreview() }}>
          {persona !== undefined && <>
            <p>{persona.id} · {persona.kind === 'review' ? t(`world.market.${persona.decision === 'expired' ? 'rejected' : persona.decision}`) : t('world.market.persona')}</p>
            {persona.kind === 'review' ? <p>{t('world.market.reason')}: {persona.reason}</p>
              : <pre>{JSON.stringify(persona.body.persona, null, 2)}</pre>}
          </>}
          {visible.map(renderField)}</form>
      </>}
      {shown === 'preview' && <>
        {refused && <p className={css.warning} role="alert">{t('world.action.retainRefused')}</p>}
        {!current && <p className={css.warning} role="status">{t('world.action.previewInvalid')}</p>}
        <WindowStatus window={props.preview} retry={() => { props.requestPreview(submitted) }} t={t} />
        {preview !== undefined && <>
          {revisionChanged && <div className={css.warning} role="alert"><span>{t('world.action.revisionChanged',
            { from: props.expectedRevision, to: preview.value.revision })}</span>
          <Button size="sm" variant="secondary" onClick={() => { setPreviewed(JSON.stringify(submitted)); props.requestPreview(submitted) }}>
            {t('world.action.repreview')}</Button></div>}
          {preview.value.blockers.length > 0 && <div className={css.blockers} role="alert">
            <strong>{t('world.action.blocked')}</strong>
            <ul>{blockers.map((blocker, index) => {
              const reason = preview.value.original?.blockers.find(code => code === blocker.reason)
              return <li key={index}>{reason === undefined ? blocker.reason : t(`status.stop.${reason}`)}
                {(blocker.next !== undefined || reason !== undefined) && props.openObligations !== undefined
                  && <Button size="sm" variant="ghost" onClick={props.openObligations}>
                    {blocker.next?.label ?? t('world.action.viewObligations')} →</Button>}</li>
            })}</ul>
          </div>}
          <h4>{t('world.action.impacts')}</h4>
          {preview.value.original === undefined
            ? <ul className={css.impacts}>{preview.value.impacts.map((impact, index) => <li key={index}>{impact.text}</li>)}</ul>
            : <ManagementImpact quote={preview.value.original} openRef={props.openRef} openObligations={props.openObligations} t={t} />}
          {preview.value.obligations.length > 0 && <><h4>{t('world.obligations')}</h4>
            <ObligationList items={preview.value.obligations} openRef={props.openRef} t={t} /></>}
          {preview.value.allowance !== undefined && preview.value.allowance.length > 0 && <><h4>{t('world.action.allowance')}</h4>
            <dl className={css.keyValue}>{preview.value.allowance.map(item => <div key={item.key}><dt>{item.key}</dt>
              <dd><span className={css.figure}>{item.before}</span> → <span className={css.figure}>{item.after}</span></dd></div>)}</dl></>}
          <p className={css.hashLine}>{t('world.action.previewHash')} <CopyId value={preview.value.previewHash} t={t} /></p>
          {props.submit === undefined && <p className={css.notice}>{t('world.action.submitUnpublished')}</p>}
        </>}
      </>}
      {shown === 'original' && <><p className={css.muted}>{t('world.action.retained')}</p>{props.original}</>}
    </div>
  </Modal>
}

/** Render actual affected IDs, source revision and fee facts from the confirmed quote; no body or permission is inferred. */
function ManagementImpact({ quote, openRef, openObligations, t }: {
  quote: NonNullable<ActionPreview['original']>
  openRef: ActionFlowProps['openRef']
  openObligations: ActionFlowProps['openObligations']
  t: WorldT
}) {
  const impact = quote.impact
  const entity = (value: Extract<EngineRef, { kind: 'entity' }>['id']) =>
    <Button size="sm" variant="ghost" onClick={() => { openRef({ kind: 'entity', id: value }) }}>{value}</Button>
  return <>
    <p className={css.notice}>{t('world.action.userNotice')}</p>
    <dl className={css.keyValue}>
      <div><dt>{t('world.action.field.reason')}</dt><dd>{'reason' in quote.input.values ? quote.input.values.reason : t('world.action.hiring-market')}</dd></div>
      <div><dt>{t('world.action.nativeRevision')}</dt><dd>#{quote.snapshotRevision}</dd></div>
      {impact !== null && <>
        <div><dt>{t('world.action.target')}</dt><dd>{impact.kind === 'hiring-market' ? <CopyId value={impact.draftId} t={t} /> : entity(impact.personId)}</dd></div>
        {impact.kind !== 'hire-existing' && impact.kind !== 'hiring-market' && <>
          <div><dt>{t('world.action.field.assignment')}</dt><dd><CopyId value={impact.assignmentId} t={t} /> · r{impact.assignmentRevision}</dd></div>
          <div><dt>{t('world.action.previousPosition')}</dt><dd>{entity(impact.previousPositionId)}</dd></div>
          <div><dt>{t('world.action.field.effective')}</dt><dd>{impact.requestedEffectiveAt ?? t('world.action.effective.boundary')}</dd></div>
          <div><dt>{t('world.action.authorityRelations')}</dt><dd>{impact.authorityRelationIds.length}</dd></div>
        </>}
        {impact.kind !== 'depart' && <div><dt>{t('world.action.field.position')}</dt><dd>{entity(impact.targetPositionId)}</dd></div>}
        {impact.kind === 'depart' && <div><dt>{t('world.action.field.retire')}</dt><dd>{t(`world.action.retire.${impact.retire ? 'yes' : 'no'}`)}</dd></div>}
      </>}
      {quote.hiringFee !== null && <div><dt>{t('world.action.fee')}</dt><dd>{quote.hiringFee.quantity} {quote.hiringFee.unit}
        {' · '}{quote.hiringFee.from} → {quote.hiringFee.to}</dd></div>}
    </dl>
    {quote.settlementRequirements.length > 0 && <div className={css.notice}><strong>{t('world.action.settlement')}</strong>
      <ul>{quote.settlementRequirements.map(reason => <li key={reason}>{t(`status.stop.${reason}`)}</li>)}</ul>
      {openObligations !== undefined && <Button size="sm" variant="secondary" onClick={openObligations}>
        {t('world.action.viewObligations')}</Button>}</div>}
  </>
}
