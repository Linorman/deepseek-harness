import { WORLD_CALENDAR_TZDB_VERSION } from '@clocky/clocky-simulation/world-authoring'
/** Finite simulated scheduling edits retain one runtime-owned preview and original submission. */
import { useId, useState } from 'react'
import { Button, Input } from '@clocky/clocky-client-ui-primitives'
import { simulationProductCalendarInputSchema } from '@clocky/clocky-simulation-product/schema'
import type { SimulationCalendarState, SimulationProductCalendarInput } from '@clocky/clocky-client-runtime/client'
import type { WorldOverviewView } from './world-domain.ts'
import type { WorldT } from './WorldFacts.tsx'
import css from './World.module.css'

type Rule = NonNullable<WorldOverviewView['calendars']>[number]
type Edit = {
  rule: Rule
  clock: 'simulation' | 'civil'
  priority: string
  timeZone: string
  origin: string
  tickMilliseconds: string
  from: string
  until: string
  weekdays: string
  civilShifts: string
  exceptDates: string
  civilAdditions: string
  disambiguation: 'reject' | 'earlier' | 'later'
  startsAt: string
  endsAt: string
  period: string
  count: string
  shifts: string
  exceptions: string
  additions: string
}
/** Render finite schedule edits and exact retry controls.
 * @param props - Current authorized rules and runtime command owner.
 * @returns bounded rule forms and explicit original-result recovery. */
export function CalendarEditor({ view, state, connected, preview, submit, close, recover, cancel, t }: {
  view: WorldOverviewView
  state: SimulationCalendarState
  connected: boolean
  preview: (input: SimulationProductCalendarInput) => Promise<void>
  submit: () => Promise<void>
  close: () => boolean
  recover?: ((runId: string) => Promise<void>) | undefined
  cancel?: (() => Promise<void>) | undefined
  t: WorldT
}) {
  const id = useId(), [edit, setEdit] = useState<Edit>(), [invalid, setInvalid] = useState(false)
  const original = state.input === undefined || state.input.runId === view.runId ? state : { status: 'idle' as const }
  const locked = ['previewing', 'submitting', 'unknown', 'recovering', 'cancelling'].includes(original.status)
  const readable = (rule: Rule) => rule.body.state === 'allowed' && !rule.body.value.truncated
  const current = view.calendars?.find(rule => rule.id === edit?.rule.id)
  const showEdit = edit !== undefined && current !== undefined && readable(current)
  const open = (rule: Rule) => {
    if (!readable(rule) || !close()) return
    setInvalid(false); setEdit({ rule, clock: rule.civil === undefined ? 'simulation' : 'civil', priority: String(rule.priority ?? 0),
      timeZone: rule.civil?.timeZone ?? 'UTC', origin: rule.civil?.origin ?? '', tickMilliseconds: rule.civil === undefined ? '' : String(rule.civil.tickMilliseconds),
      from: rule.civil?.from ?? '', until: rule.civil?.until ?? '', weekdays: rule.civil?.weekdays.join(',') ?? '1,2,3,4,5',
      civilShifts: rule.civil?.shifts.join(',') ?? '09:00:00', exceptDates: rule.civil?.exceptDates.join(',') ?? '',
      civilAdditions: rule.civil?.additions.join(',') ?? '', disambiguation: rule.civil?.disambiguation ?? 'reject', startsAt: rule.startsAt, endsAt: rule.endsAt ?? '', period: rule.period,
      count: String(rule.maxOccurrences), shifts: rule.recurrence?.shifts.join(',') ?? '0',
      exceptions: rule.recurrence?.exceptions.join(',') ?? '', additions: rule.recurrence?.additions.join(',') ?? '' })
  }
  const check = async () => {
    if (!showEdit || edit.rule.body.state !== 'allowed') return
    const list = (text: string) => text.split(',').map(value => value.trim()).filter(Boolean)
    const parsed = simulationProductCalendarInputSchema.safeParse({ runId: view.runId, request: {
      commandId: crypto.randomUUID(), expectedRuleRevision: edit.rule.ruleRevision,
      calendar: { id: edit.rule.id, target: edit.rule.target, body: edit.rule.body.value.text,
        startsAt: edit.startsAt, endsAt: edit.endsAt === '' ? null : edit.endsAt, period: edit.period, maxOccurrences: Number(edit.count),
        priority: Number(edit.priority),
        ...edit.clock === 'civil' ? { civil: { version: 1, timeZone: edit.timeZone, tzdbVersion: WORLD_CALENDAR_TZDB_VERSION,
          origin: edit.origin, tickMilliseconds: Number(edit.tickMilliseconds), from: edit.from, until: edit.until,
          weekdays: list(edit.weekdays).map(Number), shifts: list(edit.civilShifts), exceptDates: list(edit.exceptDates),
          additions: list(edit.civilAdditions), disambiguation: edit.disambiguation } }
          : { recurrence: { version: 1, clock: 'simulation', shifts: list(edit.shifts), exceptions: list(edit.exceptions), additions: list(edit.additions) } } } } })
    if (!parsed.success) { setInvalid(true); return }
    setInvalid(false)
    try { await preview(parsed.data) } catch { setInvalid(true) }
  }
  return <section className={css.authorSection} aria-label={t('world.calendar.edit')}>
    <h3>{t('world.calendar.edit')}</h3><p className={css.notice}>{t('world.calendar.notice')}</p>
    <ul>{view.calendars?.map(rule => <li key={rule.id}>
      <Button variant="secondary" disabled={!connected || locked || !readable(rule)} onClick={() => { open(rule) }}>
        {rule.id} · {rule.ruleRevision}</Button>
      {!readable(rule) && <span>{t('world.withheld')}</span>}
    </li>)}</ul>
    {showEdit && <fieldset disabled={!connected || locked} className={css.fieldGrid}>
      <legend>{edit.rule.id}</legend>
      {(['startsAt', 'endsAt', 'period', 'count', 'priority'] as const).map(field => <div className={css.field} key={field}>
        <label htmlFor={`${id}-${field}`}>{t(`world.calendar.${field}`)}</label>
        <Input id={`${id}-${field}`} value={edit[field]} onChange={(event) => {
          if (!close()) return
          setEdit({ ...edit, [field]: event.target.value }); setInvalid(false)
        }} /></div>)}
      <div role="group" aria-label={t('world.calendar.clock')}>
        {(['simulation', 'civil'] as const).map(clock => <Button variant="secondary" key={clock} aria-pressed={edit.clock === clock}
          onClick={() => { if (close()) setEdit({ ...edit, clock }) }}>{t(`world.calendar.clock.${clock}`)}</Button>)}
      </div>
      {(edit.clock === 'civil'
        ? ['timeZone', 'origin', 'tickMilliseconds', 'from', 'until', 'weekdays', 'civilShifts', 'exceptDates', 'civilAdditions'] as const
        : ['shifts', 'exceptions', 'additions'] as const).map(field => <div className={css.field} key={field}>
        <label htmlFor={`${id}-${field}`}>{t(`world.calendar.${field}`)}</label>
        <Input id={`${id}-${field}`} value={edit[field]} onChange={(event) => {
          if (close()) { setEdit({ ...edit, [field]: event.target.value }); setInvalid(false) }
        }} /></div>)}
      {edit.clock === 'civil' && <div role="group" aria-label={t('world.calendar.disambiguation')}>
        <p>{t('world.calendar.tzdb', { version: WORLD_CALENDAR_TZDB_VERSION })}</p>
        {(['reject', 'earlier', 'later'] as const).map(value => <Button key={value} variant="secondary"
          aria-pressed={edit.disambiguation === value} onClick={() => { if (close()) setEdit({ ...edit, disambiguation: value }) }}>
          {t(`world.calendar.disambiguation.${value}`)}</Button>)}
      </div>}
      <Button variant="secondary" onClick={() => { void check() }}>{t('world.calendar.preview')}</Button>
    </fieldset>}
    {recover !== undefined && <Button variant="ghost" disabled={!connected || ['submitting', 'recovering', 'cancelling'].includes(original.status)}
      onClick={() => { void recover(view.runId) }}>{t('world.calendar.recover')}</Button>}
    {original.status === 'unknown' && 'input' in original && original.input !== undefined && cancel !== undefined && <Button variant="secondary" disabled={!connected}
      onClick={() => { void cancel() }}>{t('world.calendar.cancelRetained')}</Button>}
    {state.input !== undefined && state.input.runId !== view.runId && state.status === 'unknown'
      && <p role="status">{t('world.calendar.otherRun', { runId: state.input.runId })}</p>}
    {invalid && <p role="alert">{t('world.calendar.invalid')}</p>}
    {original.status !== 'idle' && <p role="status">{t(`world.calendar.status.${original.status}`)}</p>}
    {'preview' in original && original.preview !== undefined && <>
      <p>{t('world.calendar.impact', { cancelled: original.preview.cancelled.length, queued: original.preview.queued.length })}</p>
      <ul>{original.preview.queued.map(event =>
        <li key={event.id} title={event.id}>{original.preview?.input.request.calendar.id} · {event.time}</li>)}</ul>
      <Button variant="primary" disabled={!connected || !['ready', 'unknown'].includes(original.status)} onClick={() => { void submit() }}>
        {t(original.status === 'unknown' ? 'world.calendar.retry' : 'world.calendar.submit')}</Button>
    </>}
    {original.status === 'completed' && 'receipt' in original && original.receipt !== undefined && <p>
      {t('world.calendar.completed', { revision: original.receipt.ruleRevision })}</p>}
  </section>
}
