/** Shared World fact presentation: time, intervals, coverage, disclosure, badges, copyable IDs and window states. */
import { DisclosedValue } from './DisclosedValue.tsx'
import { useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import clsx from 'clsx'
import { Button, FactValue, Tooltip, writeClipboard } from '@clocky/clocky-client-ui-primitives'
import type { Fact, FactLabels } from '@clocky/clocky-client-ui-primitives'
import type { Key } from './locales.ts'
import type { AnySourceKind, Coverage, Disclosure, Enforcement, SimTime, WorldWindow } from './world-domain.ts'
import css from './World.module.css'

/** Translate function bound to the simulation namespace. */
export type WorldT = (key: Key, vars?: Record<string, unknown>) => string

/**
 * Translate installed management availability codes without obscuring extension diagnostics.
 * @param reason - Host-supplied localizable code; absent means no published explanation.
 * @param t - Simulation namespace translator.
 * @returns known explanation with its next step, or the unchanged unknown Host code.
 */
export function actionHintReason(reason: string | undefined, t: WorldT): string | undefined {
  switch (reason) {
    case 'management-in-progress': return t('world.action.reason.management-in-progress')
    case 'recovery-required': return t('world.action.reason.recovery-required')
    case 'retiring': return t('world.action.reason.retiring')
    case 'stale': return t('world.action.reason.stale')
    case 'execution-unavailable': return t('controlReason.execution-unavailable')
    default: return reason // Extension availability codes stay visible until their UI vocabulary is installed.
  }
}

/**
 * Group the integer digits of an exact decimal string; malformed input stays visible unchanged.
 * @param value - Decimal simulated time.
 * @returns grouped digits without Number conversion.
 */
export function groupTime(value: SimTime): string {
  return /^(0|[1-9][0-9]*)$/.test(value) ? value.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : value
}

/**
 * Localized FactValue words.
 * @param t - Namespace translator.
 * @returns state words for the shared fact primitive.
 */
export function factLabels(t: WorldT): FactLabels {
  return { unavailable: t('world.unavailable'), unknown: t('world.unknown'), stale: t('world.stale'),
    withheld: t('world.withheld'), truncated: t('truncate'), expand: t('world.viewAll') }
}

/**
 * Exact simulated time with tabular digits; the raw value stays in the title.
 * @param props.value - Decimal simulated time.
 * @param props.unit - Source tick unit appended in the title only.
 * @returns inline time element.
 */
export function SimTimeText({ value, unit }: { value: SimTime; unit?: string | undefined }) {
  return <span className={css.time} title={unit === undefined ? value : `${value} ${unit}`}>{groupTime(value)}</span>
}

/**
 * Left-closed, right-open interval `[from, until)`; an open end reads "now" and fades.
 * @param props.from - Inclusive start.
 * @param props.until - Exclusive end; absent means still open.
 * @param props.t - Namespace translator.
 * @returns interval text with an accessible sentence.
 */
export function TimeInterval({ from, until, t, emphasis = false }: {
  from: SimTime
  until?: SimTime | undefined
  t: WorldT
  emphasis?: boolean
}) {
  const end = until === undefined ? t('world.untilNow') : groupTime(until)
  return <span className={clsx(css.interval, emphasis && css.intervalEmphasis)} data-open={until === undefined || undefined}
    aria-label={t('world.interval', { from: groupTime(from), until: end })}>
    <span aria-hidden="true">[</span><span aria-hidden="true">{groupTime(from)}</span><span aria-hidden="true">, </span>
    <span aria-hidden="true" className={until === undefined ? css.openEnd : undefined}>{end}</span><span aria-hidden="true">)</span>
  </span>
}

/**
 * Recorded / effective / knowable / notified times side by side; a missing time is unavailable, never omitted.
 * @param props.times - Each optional time.
 * @param props.t - Namespace translator.
 * @returns definition list with four rows.
 */
export function TemporalFacts({ times, t }: {
  times: { recorded?: SimTime | undefined
    effective?: SimTime | undefined
    knowable?: SimTime | undefined
    notified?: SimTime | undefined
    until?: SimTime | undefined }
  t: WorldT
}) {
  const rows = [['recorded', times.recorded], ['effective', times.effective], ['knowable', times.knowable],
    ['notified', times.notified], ['until', times.until]] as const
  return <dl className={css.temporal}>{rows.map(([id, value]) => <div key={id}>
    <dt>{t(`world.time.${id}`)}</dt>
    <dd>{value === undefined ? <FactValue labels={factLabels(t)} fact={{ state: 'unavailable', reason: t('world.unavailable') }} />
      : <SimTimeText value={value} />}</dd>
  </div>)}</dl>
}

/**
 * Advisory versus validated enforcement; validated without a policy is an error state.
 * @param props.value - Enforcement mode from the Host.
 * @param props.t - Namespace translator.
 * @returns badge with shape and words.
 */
export function EnforcementBadge({ value, t }: { value: Enforcement; t: WorldT }) {
  switch (value.mode) {
    case 'advisory': return <span className={clsx(css.badge, css.badgeOutline)} data-enforcement="advisory">{t('world.enforcement.advisory')}</span>
    case 'validated': return value.policyRef === undefined
      ? <span className={clsx(css.badge, css.badgeError)} data-enforcement="validated-missing">{t('world.enforcement.missingPolicy')}</span>
      : <span className={clsx(css.badge, css.badgeSolid)} data-enforcement="validated" title={value.policyRef}>
        {t('world.enforcement.validated')} · <code>{value.policyRef}</code></span>
    default: return assertNever(value)
  }
}

function SourceIcon({ kind }: { kind: AnySourceKind | 'unknown' }) {
  const common = { viewBox: '0 0 14 14', width: 14, height: 14, 'aria-hidden': true as const, className: css.badgeIcon }
  switch (kind) {
    case 'rule': return <svg {...common}><circle cx="7" cy="7" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M7 1.5v2M7 10.5v2M1.5 7h2M10.5 7h2M3.1 3.1l1.4 1.4M9.5 9.5l1.4 1.4M3.1 10.9l1.4-1.4M9.5 4.5l1.4-1.4"
        stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
    case 'director-ruling': return <svg {...common}><path d="M7 2v10M4 12h6M2.5 4h9M2.5 4 1 8h3zM11.5 4 10 8h3z"
      fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" /></svg>
    case 'simulated-actor':
    case 'authenticated-user': return <svg {...common}><circle cx="7" cy="4.5" r="2.3" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M2.5 12.5c.6-2.6 2.4-4 4.5-4s3.9 1.4 4.5 4" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
    case 'world-decision': return <svg {...common}><path d="M2 7h7M6.5 4 9.5 7l-3 3M11.5 3v8" fill="none" stroke="currentColor"
      strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
    case 'unknown': return <svg {...common}><circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2 2" /></svg>
    default: return assertNever(kind)
  }
}
const SOURCE_KINDS: readonly string[] = ['rule', 'director-ruling', 'simulated-actor', 'authenticated-user', 'world-decision']

/**
 * Neutral badge naming how a response was produced. Unknown future kinds render their raw value.
 * @param props.kind - Source kind; extensible, so unknown values take the documented default.
 * @param props.t - Namespace translator.
 * @returns icon plus words.
 */
export function SourceKindBadge({ kind, t }: { kind: string; t: WorldT }) {
  const known = SOURCE_KINDS.includes(kind) ? kind as AnySourceKind : undefined
  return <span className={clsx(css.badge, css.badgeTint)} data-source-kind={known ?? 'unknown'}>
    <SourceIcon kind={known ?? 'unknown'} />
    {known === undefined ? t('world.source.unknownKind', { kind }) : t(`world.source.${known}`)}
  </span>
}

/**
 * State what a list or graph covers: loaded versus total, revision and viewing time.
 * @param props.value - Host-declared coverage.
 * @param props.more - Optional explicit continuation.
 * @param props.stale - Whether the window is stale.
 * @returns one quiet sentence with an optional load-more control.
 */
export function CoverageNote({ value, more, stale = false, disabled = false, t }: {
  value: Coverage
  more?: (() => void) | undefined
  stale?: boolean | undefined
  disabled?: boolean
  t: WorldT
}) {
  const base = value.total === undefined ? t('world.coverage.open', { loaded: value.loaded, revision: value.revision })
    : value.complete ? t('world.coverage.complete', { loaded: value.loaded, revision: value.revision })
      : t('world.coverage.partial', { loaded: value.loaded, total: value.total, revision: value.revision })
  // The Host scope key repeats the lens the reader already chose, so it stays in the tooltip for diagnostics.
  return <p className={css.coverage} data-coverage={value.complete ? 'complete' : 'partial'}
    title={t('world.coverage.scope', { scope: value.scope })}>
    <span>{base}{value.at === undefined ? '' : t('world.coverage.at', { at: groupTime(value.at) })}</span>
    {!value.complete && value.reason !== undefined && <span>{t(`world.coverage.reason.${value.reason}`)}</span>}
    {more !== undefined && value.nextCursor !== undefined && <Button size="sm" variant="ghost" disabled={disabled || stale} onClick={more}>
      {t('world.coverage.more')}</Button>}
  </p>
}

/**
 * State exactly which inspector collection is loaded and offer only its own continuation.
 * @param props - Original domain window and its explicit paging callback.
 * @returns coverage even for an empty or incomplete source; no inferred completeness.
 */
export function WindowCoverage<T>({ window, more, disabled, t }: { window: WorldWindow<T>
  more?: (() => void) | undefined
  disabled?: boolean | undefined
  t: WorldT }) {
  return window.coverage === undefined ? null : <CoverageNote value={window.coverage} more={more}
    stale={window.status === 'ready' && window.stale} disabled={disabled || window.status !== 'ready'} t={t} />
}

/**
 * Independent disclosure wrapper: content renders only when allowed; revocation replaces it immediately.
 * @param props.value - Host disclosure state.
 * @param props.children - Renders the allowed value.
 * @returns content or an explicit placeholder.
 */
export function PrivacyGate<T>({ value, children, t }: { value: Disclosure<T>; children: (value: T) => ReactNode; t: WorldT }) {
  switch (value.state) {
    case 'allowed': return <>{children(value.value)}</>
    case 'withheld': case 'redacted': case 'not-applicable': return <DisclosedValue state={value.state} t={t} />
    default: return assertNever(value)
  }
}


/**
 * Copyable monospace ID chip: the icon becomes a check for 1.2s and a polite live region announces the copy.
 * @param props.value - Exact identifier.
 * @param props.compact - Show a shortened form; the full value stays in the title, copy and accessible name.
 * @param props.t - Namespace translator.
 * @returns button chip.
 */
export function CopyId({ value, compact = false, t }: { value: string; compact?: boolean; t: WorldT }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number>()
  useEffect(() => () => { window.clearTimeout(timer.current) }, [])
  return <button type="button" className={css.copyId} aria-label={t('world.copy', { value })} title={value} onClick={() => {
    void writeClipboard(value).then((ok) => {
      if (!ok) return
      setCopied(true); window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => { setCopied(false) }, 1200)
    })
  }}>
    <code>{compact ? shortId(value) : value}</code>
    <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" className={css.badgeIcon}>
      {copied ? <path d="M2.5 6.3 5 8.7l4.5-5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        : <><rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.1" />
          <path d="M2 8V2.5A.5.5 0 0 1 2.5 2H8" fill="none" stroke="currentColor" strokeWidth="1.1" /></>}
    </svg>
    <span className={css.srOnly} aria-live="polite">{copied ? t('world.copied') : ''}</span>
  </button>
}

/**
 * Initial loading, unavailable capability and failures; retained windows refresh without a status banner.
 * @param props.window - Any World window.
 * @param props.retry - Explicit retry for failures.
 * @param props.label - Accessible name of the owning area.
 * @returns nothing when the window is current and ready.
 */
export function WindowStatus<T>({ window, retry, t, compact = false }: {
  window: WorldWindow<T>
  retry?: (() => void) | undefined
  t: WorldT
  compact?: boolean
}) {
  switch (window.status) {
    case 'unpublished': return <div className={clsx(css.windowStatus, compact && css.windowCompact)} data-window="unpublished">
      <FactValue labels={factLabels(t)} fact={{ state: 'unavailable', reason: t('world.unpublishedShort') }} />
      <span>{compact ? t('world.unpublishedShort') : t('world.unpublished')}</span></div>
    case 'idle': return null
    case 'loading': return window.previous === undefined
      ? <div className={css.skeletonBlock} role="status" aria-label={t('world.loading')}><span /><span /><span /></div> : null
    case 'error': return <div className={css.windowStatus} data-window="error" role="alert">
      <span className={css.windowText}><strong>{t(window.previous === undefined ? 'world.loadFailed' : 'world.loadFailedKept')}</strong>
        <span className={css.windowReason}>{errorReason(window.message, t)}</span></span>
      {retry !== undefined && <Button size="sm" variant="secondary" onClick={retry}>{t('world.retry')}</Button>}</div>
    case 'ready': return null
    default: return assertNever(window)
  }
}

/**
 * Compact display of a long opaque identifier; callers keep the full value in a title or accessible name.
 * @param id - Exact identifier.
 * @returns head and tail joined by an ellipsis when longer than 24 characters.
 */
export function shortId(id: string): string {
  return id.length <= 24 ? id : `${id.slice(0, 14)}…${id.slice(-6)}`
}

/**
 * Human-facing text that falls back to a compact form when the Host supplies only an opaque identifier
 * (one long token without spaces) instead of a title.
 * @param text - Host display text.
 * @returns the text, or its compact form when it is an opaque identifier.
 */
export function displayText(text: string): string {
  return text.length > 32 && !/\s/.test(text) ? shortId(text) : text
}

/**
 * Proposal heading: the Host title, or "committee proposal · short id" when the Host supplied only an opaque identifier.
 * @param proposal - Proposal summary.
 * @param t - Namespace translator.
 * @returns readable title; the exact text stays in the caller's title attribute.
 */
export function proposalTitle(proposal: { readonly title: { readonly text: string }; readonly committee: { readonly text: string } },
  t: WorldT): string {
  const text = proposal.title.text
  if (text.length <= 32 || /\s/.test(text)) return text
  return t('world.gov.proposalFallback', { committee: proposal.committee.text, id: text.slice(-6) })
}

/**
 * Explanation on demand: a small "i" beside a heading reveals a scope or caveat sentence on hover or focus, so pages
 * stop repeating paragraphs. The sentence stays in the button's accessible name and in the DOM for assistive tech.
 * @param props.text - Complete explanation (the button's description).
 * @param props.label - Short accessible name, such as "About this".
 * @returns focusable hint button.
 */
export function InfoHint({ text, label }: { text: string; label: string }) {
  const id = useId()
  return <span className={css.infoHintWrap}><Tooltip label={text} side="top" delayMs={150} maxWidth={340}>
    <button type="button" className={css.infoHint} aria-label={label} aria-describedby={id}><span aria-hidden="true">i</span></button>
  </Tooltip><span id={id} className={css.srOnly}>{text}</span></span>
}

const READ_ERRORS: readonly string[] = ['forbidden', 'unavailable', 'stale', 'invalid', 'network', 'internal', 'model-changed',
  'preflight-changed', 'management-preview-changed']

/**
 * Localized reason for a read failure; unknown codes stay literal so new Host codes remain visible.
 * @param code - Runtime read error code.
 * @param t - Namespace translator.
 * @returns one sentence.
 */
export function errorReason(code: string, t: WorldT): string {
  return READ_ERRORS.includes(code) ? t(`world.error.${code as 'internal'}`) : code
}

/**
 * Number that distinguishes unavailable from zero.
 * @param props.value - Count or undefined when not observed.
 * @returns tabular figure or a FactValue placeholder.
 */
export function Count({ value, t }: { value: number | undefined; t: WorldT }) {
  const fact: Fact = value === undefined ? { state: 'unavailable', reason: t('world.unavailable') }
    : { state: 'observed', value: <span className={css.figure}>{value.toLocaleString()}</span> }
  return <FactValue labels={factLabels(t)} fact={fact} />
}

/**
 * Exhaustiveness guard for closed unions.
 * @param value - Unreachable value.
 * @returns never; throws with the unexpected value.
 */
export function assertNever(value: never): never { throw new Error(`Unexpected World value: ${JSON.stringify(value)}`) }
