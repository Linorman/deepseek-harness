/** Institution previews use the existing authorized read owner; editing these fields never publishes a policy. */
import { DisclosedValue } from './DisclosedValue.tsx'
import { useId, useState } from 'react'
import { Button, Input } from '@clocky/clocky-client-ui-primitives'
import { simulationNormImpactInputSchema } from '@clocky/clocky-simulation/world-authoring'
import type { SimulationNormImpactInput } from '@clocky/clocky-simulation'
import type { ProposalDetailView } from './world-domain.ts'
import type { WorldT } from './WorldFacts.tsx'
import css from './World.module.css'

/** Render an explicit, inert policy-impact form and the exact corresponding Native report.
 * @param props - Authorized original proposal, read status and a read-only preview callback.
 * @returns retained-source impact fields, complete future schedule ranges and outstanding obligations.
 */
export function NormImpactPanel({ detail, connected, loading, preview, t }: {
  detail: ProposalDetailView
  connected: boolean
  loading: boolean
  preview?: ((input: SimulationNormImpactInput) => Promise<void>) | undefined
  t: WorldT
}) {
  if (detail.normImpactInput?.state !== 'allowed' || detail.normImpactChoices?.state !== 'allowed')
    return <DisclosedValue state="withheld" role="status" t={t} />
  return <ImpactForm key={detail.id} detail={detail} input={detail.normImpactInput.value}
    choices={detail.normImpactChoices.value} connected={connected} loading={loading} preview={preview} t={t} />
}
function ImpactForm({ detail, input, choices, connected, loading, preview, t }: {
  detail: ProposalDetailView
  input: SimulationNormImpactInput
  choices: { readonly committeeId: string; readonly positionIds: readonly string[] }
  connected: boolean
  loading: boolean
  preview?: ((input: SimulationNormImpactInput) => Promise<void>) | undefined
  t: WorldT
}) {
  const id = useId(), [from, setFrom] = useState<string>(input.effectiveFrom), [until, setUntil] = useState(input.effectiveUntil ?? '')
  const [impact, setImpact] = useState(input.impact), [policy, setPolicy] = useState(input.enforcement.kind)
  const [positions, setPositions] = useState(input.enforcement.kind === 'validated' ? input.enforcement.params.positionIds.join(',') : choices.positionIds.join(','))
  const [maxHires, setMaxHires] = useState(input.enforcement.kind === 'validated' ? String(input.enforcement.params.maxHires) : '1')
  const [error, setError] = useState(false)
  const report = detail.normImpact?.state === 'allowed' ? detail.normImpact.value : undefined
  const calculate = async () => {
    const parsed = simulationNormImpactInputSchema.safeParse({ ...input, effectiveFrom: from,
      effectiveUntil: until === '' ? null : until, impact, enforcement: policy === 'advisory' ? { kind: 'advisory' }
        : { kind: 'validated', policyRef: 'clocky.organization.hiring-approval/1', params: {
          committeeId: choices.committeeId, positionIds: positions.split(',').map(value => value.trim()).filter(Boolean), maxHires: Number(maxHires) } } })
    if (!parsed.success || preview === undefined) { setError(true); return }
    setError(false)
    try { await preview(parsed.data) } catch { setError(true) }
  }
  return <section className={css.authorSection} aria-label={t('world.gov.impact.open')}>
    <h4>{t('world.gov.impact.open')}</h4><p>{t('world.gov.impact.notice')}</p>
    <fieldset disabled={!connected || loading || preview === undefined} className={css.fieldGrid}>
      <legend>{t('world.gov.impact.fields')}</legend>
      <div className={css.field}><label htmlFor={`${id}-from`}>{t('world.gov.impact.from')}</label>
        <Input id={`${id}-from`} value={from} onChange={(event) => { setFrom(event.target.value) }} /></div>
      <div className={css.field}><label htmlFor={`${id}-until`}>{t('world.gov.impact.until')}</label>
        <Input id={`${id}-until`} value={until} onChange={(event) => { setUntil(event.target.value) }} /></div>
      <div role="group" aria-label={t('world.gov.impact.mode')}>
        {(['future-admissions', 'migrate-existing'] as const).map(value => <Button key={value} variant="secondary"
          aria-pressed={impact === value} onClick={() => { setImpact(value) }}>{t(`world.gov.impact.${value}`)}</Button>)}
      </div>
      <div role="group" aria-label={t('world.gov.impact.policy')}>
        {(['advisory', 'validated'] as const).map(value => <Button key={value} variant="secondary"
          aria-pressed={policy === value} onClick={() => { setPolicy(value) }}>{t(`world.gov.impact.${value}`)}</Button>)}
      </div>
      {policy === 'validated' && <>
        <div className={css.field}><label htmlFor={`${id}-positions`}>{t('world.gov.impact.positions')}</label>
          <Input id={`${id}-positions`} value={positions} onChange={(event) => { setPositions(event.target.value) }} /></div>
        <div className={css.field}><label htmlFor={`${id}-max`}>{t('world.gov.impact.max')}</label>
          <Input id={`${id}-max`} value={maxHires} onChange={(event) => { setMaxHires(event.target.value) }} /></div>
      </>}
      <Button variant="secondary" onClick={() => { void calculate() }}>{t('world.gov.impact.calculate')}</Button>
    </fieldset>
    {error && <p role="alert">{t('world.gov.impact.invalid')}</p>}
    {detail.normImpact?.state === 'withheld' && <DisclosedValue state="withheld" role="status" t={t} />}
    {report !== undefined && <>
      <p role="status">{t('world.gov.impact.basis', { revision: report.revision, time: input.effectiveFrom })}</p>
      {report.blocked !== null && <p role="alert">{t(`world.gov.impact.${report.blocked}`)}</p>}
      <h5>{t('world.gov.impact.operations')}</h5><ul>{report.newOperations.map(operation => <li key={operation}>{operation}</li>)}</ul>
      <h5>{t('world.gov.impact.calendar')}</h5><ul>{report.futureCalendar.map(calendar => <li key={`${calendar.calendarId}:${calendar.ruleRevision}`}>
        {calendar.calendarId} · {calendar.firstAt}–{calendar.lastAt} · {t('world.gov.impact.occurrences', { count: calendar.occurrences })}
      </li>)}</ul>
      <h5>{t('world.gov.impact.obligations')}</h5><ul>{report.existingObligations.map(obligation => <li key={JSON.stringify(obligation)}>
        {obligation.kind} · {obligation.id}
      </li>)}</ul>
      <p>{t('world.gov.impact.combination')}</p>
      <ul>{report.policyCombination.policies.map(policy => <li key={`${policy.id}:${policy.version}`}>{policy.id} · v{policy.version}</li>)}</ul>
    </>}
  </section>
}
