/** Vote tally, frozen electorate and obligation inventory; all rules and closure wording come from the Host. */
import { useMemo } from 'react'
import type { CSSProperties } from 'react'
import { Button } from '@clocky/clocky-client-ui-primitives'
import { Odometer, useLiveChanges } from '@clocky/clocky-client-ui-viz'
import type { Ballot, ElectorateMember, EngineRef, Obligation, ObligationDisposition, ObligationKind, SimTime, TallyView } from './world-domain.ts'
import { groupTime } from './WorldFacts.tsx'
import type { WorldT } from './WorldFacts.tsx'
import { EngineRefLink, refText } from './WorldRefs.tsx'
import css from './World.module.css'

/**
 * For / against / abstain / not-voted segments with quorum and pass-line marks plus text.
 * @param props.value - Host tally including thresholds and closure statement.
 * @param props.live - Whether the latest change was observed live (segments spring, digits roll).
 * @param props.compact - Table form: bar only, the sentence moves to the accessible name.
 * @returns tally figure with an equivalent sentence.
 */
export function VoteTally({ value, live = false, compact = false, t }: { value: TallyView; live?: boolean; compact?: boolean; t: WorldT }) {
  const total = Math.max(value.electorate, 1)
  const invalid = value.threshold > value.electorate
  const summary = t('world.vote.summary', { for: value.for, against: value.against, abstain: value.abstain,
    pending: value.pending, threshold: value.threshold })
  const segments = [['for', value.for], ['against', value.against], ['abstain', value.abstain], ['pending', value.pending]] as const
  const bar = <span className={css.tallyBar} role="img" aria-label={summary} data-live={live || undefined}>
    {segments.map(([id, count]) => <span key={id} data-vote={id} style={{ '--share': count / total } as CSSProperties} />)}
    {!compact && <>
      <span className={css.tallyMark} data-mark="quorum" style={{ '--at': Math.min(value.quorum / total, 1) } as CSSProperties} aria-hidden="true" />
      <span className={css.tallyMark} data-mark="threshold" style={{ '--at': Math.min(value.threshold / total, 1) } as CSSProperties} aria-hidden="true" />
    </>}
  </span>
  if (compact) return <span className={css.tallyCompact}>{bar}</span>
  return <div className={css.tally}>
    <p className={css.tallyRule}>{value.rule === 'unanimous'
      ? t('world.vote.rule.unanimous', { quorum: value.quorum, electorate: value.electorate })
      : t('world.vote.rule.absolute', { threshold: value.threshold, quorum: value.quorum, electorate: value.electorate })}</p>
    {/* Quorum labels sit above the bar and the pass line below, each anchored inward at the edges so neither leaves the bar. */}
    {value.quorum !== value.threshold && <TallyMark at={value.quorum / total} label={t('world.vote.quorum')} above />}
    {bar}
    <TallyMark at={value.threshold / total} label={value.quorum === value.threshold
      ? `${t('world.vote.quorum')} · ${t('world.vote.threshold')}` : t('world.vote.threshold')} />
    <ul className={css.tallyLegend} aria-label={summary}>{segments.map(([id, count]) => <li key={id} data-vote={id}>
      <span className={css.swatch} aria-hidden="true" />{t(`world.vote.${id}`)} <Odometer text={String(count)} live={live} /></li>)}</ul>
    {invalid && <p className={css.error} role="alert">{t('world.vote.invalidRule')}</p>}
    <p className={css.closure} data-closure={value.closure}>{t(`world.vote.closure.${value.closure}`)}</p>
  </div>
}

/**
 * One threshold label on its own track. Labels near an end anchor inward instead of centring on the mark.
 * @param props.at - Mark position as a share of the electorate.
 * @param props.label - Visible label.
 * @param props.above - Place the track above the bar (quorum) instead of below.
 * @returns decorative label row; the rule sentence above carries the same facts.
 */
function TallyMark({ at, label, above = false }: { at: number; label: string; above?: boolean }) {
  const share = Math.min(Math.max(at, 0), 1)
  const anchor = share > 0.75 ? 'end' : share < 0.25 ? 'start' : 'middle'
  return <div className={css.tallyMarks} data-above={above || undefined} aria-hidden="true">
    <span data-anchor={anchor} style={{ '--at': share } as CSSProperties}>{above ? '▼' : '▲'} {label}</span>
  </div>
}

function BallotMark({ ballot }: { ballot: Ballot }) {
  switch (ballot) {
    case 'for': return <span aria-hidden="true" className={css.ballot} data-vote="for">✓</span>
    case 'against': return <span aria-hidden="true" className={css.ballot} data-vote="against">✗</span>
    case 'abstain': return <span aria-hidden="true" className={css.ballot} data-vote="abstain">○</span>
    case 'none': return <span aria-hidden="true" className={css.ballot} data-vote="pending">…</span>
    default: { const unreachable: never = ballot; throw new Error(`Unknown ballot ${String(unreachable)}`) }
  }
}

/**
 * Frozen electorate seats with each ballot and its decision link; ballot reasons stay private.
 * @param props.members - Frozen seats.
 * @param props.frozenAt - Simulated time the electorate froze.
 * @param props.openRef - Navigate to an exact engine object.
 * @returns grid of seats.
 */
export function ElectorateGrid({ members, frozenAt, openRef, t }: {
  members: readonly ElectorateMember[]
  frozenAt: SimTime
  openRef: (ref: EngineRef) => void
  t: WorldT
}) {
  return <section className={css.electorate} aria-label={t('world.electorate', { at: groupTime(frozenAt) })}>
    <h4>{t('world.electorate', { at: groupTime(frozenAt) })}</h4>
    <ElectorateArc members={members} identity={frozenAt} t={t} />
    <ul>{members.map(member => <li key={member.personId} data-vote={member.ballot === 'none' ? 'pending' : member.ballot}>
      <span className={css.seatHead}><BallotMark ballot={member.ballot} /><strong>{member.name.text}</strong>
        <span>{t(`world.vote.${member.ballot === 'none' ? 'pending' : member.ballot}`)}</span></span>
      {member.decision !== undefined && <EngineRefLink value={member.decision} open={openRef} t={t}>
        {t('world.electorate.decision', { id: refText(member.decision) })}</EngineRefLink>}
      {member.proxy !== undefined && <span className={css.seatNote}>{t('world.gov.proxy', {
        delegate: member.proxy.delegateId, grant: member.proxy.delegationId })}</span>}
      {member.leftCommittee && <span className={css.seatNote}>{t('world.electorate.left')}</span>}
    </li>)}</ul>
  </section>
}

/** Seats drawn as an arc between these sizes; outside it the list below stands alone. */
const ARC_MIN = 2, ARC_MAX = 40

/**
 * Parliament-style arc of the frozen electorate. Seat shape encodes the ballot (filled circle for, square against,
 * diamond abstain, hollow circle not yet voted); colour only reinforces it. A seat whose ballot arrives live pops in.
 * The list beside it is the equivalent, interactive form.
 * @param props.members - Frozen seats in Host order.
 * @param props.identity - Electorate identity; a new one settles without motion.
 * @returns decorative figure with a text summary, or nothing outside the drawable range.
 */
export function ElectorateArc({ members, identity, t }: { members: readonly ElectorateMember[]; identity: string; t: WorldT }) {
  const ballots = useMemo(() => new Map(members.map(member => [member.personId, member.ballot])), [members])
  const changed = useLiveChanges(`electorate:${identity}`, ballots)
  if (members.length < ARC_MIN || members.length > ARC_MAX) return null
  const count = (ballot: Ballot) => members.filter(member => member.ballot === ballot).length
  const summary = t('world.electorate.arc', { seats: members.length, for: count('for'), against: count('against'),
    abstain: count('abstain'), pending: count('none') })
  const rows = members.length <= 9 ? 1 : members.length <= 24 ? 2 : 3
  const radii = Array.from({ length: rows }, (_, row) => 92 - row * 22)
  const weight = radii.reduce((sum, radius) => sum + radius, 0)
  let assigned = 0
  const perRow = radii.map((radius, row) => {
    const share = row === rows - 1 ? members.length - assigned : Math.round(members.length * radius / weight)
    assigned += share
    return share
  })
  const seats: { x: number; y: number; member: ElectorateMember }[] = []
  // Fill each arc from left to right, outer rows first, then order all seats by angle so neighbours read as one sweep.
  const placed: { angle: number; x: number; y: number }[] = []
  radii.forEach((radius, row) => {
    const n = perRow[row] ?? 0
    for (let index = 0; index < n; index++) {
      // Half-step offsets keep small electorates off the arc's ends.
      const angle = Math.PI * (1 - (index + 0.5) / n)
      placed.push({ angle, x: 110 + radius * Math.cos(angle), y: 104 - radius * Math.sin(angle) })
    }
  })
  placed.sort((a, b) => b.angle - a.angle).forEach((seat, index) => {
    const member = members[index]
    if (member !== undefined) seats.push({ x: seat.x, y: seat.y, member })
  })
  const size = members.length > 24 ? 6 : members.length > 9 ? 8 : members.length > 4 ? 11 : 14
  return <figure className={css.arc}>
    <svg viewBox="0 0 220 112" role="img" aria-label={summary}>
      {seats.map(({ x, y, member }) => <g key={member.personId} className={css.seat} data-vote={member.ballot === 'none' ? 'pending' : member.ballot}
        data-live={changed.has(member.personId) || undefined} style={{ transformOrigin: `${String(x)}px ${String(y)}px` }}>
        <title>{`${member.name.text} · ${t(`world.vote.${member.ballot === 'none' ? 'pending' : member.ballot}`)}`}</title>
        <SeatShape ballot={member.ballot} x={x} y={y} size={size} /></g>)}
      <text x="110" y="92" textAnchor="middle" className={css.arcFigure}>{count('for')}<tspan className={css.arcDivider}> : </tspan>{count('against')}</text>
      <text x="110" y="106" textAnchor="middle" className={css.arcCaption}>{t('world.electorate.arcCaption')}</text>
    </svg>
  </figure>
}

function SeatShape({ ballot, x, y, size }: { ballot: Ballot; x: number; y: number; size: number }) {
  const r = size / 2
  switch (ballot) {
    case 'for': return <circle cx={x} cy={y} r={r} />
    case 'against': return <rect x={x - r * 0.9} y={y - r * 0.9} width={r * 1.8} height={r * 1.8} rx={1} />
    case 'abstain': return <rect x={x - r * 0.8} y={y - r * 0.8} width={r * 1.6} height={r * 1.6} transform={`rotate(45 ${String(x)} ${String(y)})`} />
    case 'none': return <circle cx={x} cy={y} r={r - 0.75} data-hollow />
    default: { const unreachable: never = ballot; throw new Error(`Unknown ballot ${String(unreachable)}`) }
  }
}

const KIND_ORDER: readonly ObligationKind[] = ['decision', 'operation', 'task-attempt', 'commitment', 'resource', 'wake', 'message', 'subordinate', 'owner-duty']

/**
 * Obligations grouped by kind with owner, revision and only Host-declared dispositions as buttons.
 * @param props.items - Obligation inventory.
 * @param props.dispose - Opens the management flow for one disposition; absent disables actions.
 * @param props.openRef - Navigate to the exact object behind an obligation.
 * @returns grouped list or an explicit empty sentence.
 */
export function ObligationList({ items, dispose, openRef, disabledReason, complete = false, t }: {
  items: readonly Obligation[]
  dispose?: ((obligation: Obligation, disposition: ObligationDisposition) => void) | undefined
  openRef: (ref: EngineRef) => void
  disabledReason?: string | undefined
  complete?: boolean | undefined
  t: WorldT
}) {
  if (items.length === 0) return <p className={css.muted}>{t(complete ? 'world.obligations.completeEmpty' : 'world.obligations.none')}</p>
  return <div className={css.obligations}>{KIND_ORDER.map((kind) => {
    const group = items.filter(item => item.kind === kind)
    if (group.length === 0) return null
    return <section key={kind} aria-label={t(`world.obligation.kind.${kind}`)}>
      <h5>{t(`world.obligation.kind.${kind}`)} <span className={css.figure}>{group.length}</span></h5>
      <ul>{group.map(item => <li key={item.id} data-state={item.state}>
        <div className={css.obligationHead}>
          <strong>{item.label.text}</strong>
          <span className={css.stateTag} data-state={item.state}>{t(`world.obligation.state.${item.state}`)}</span>
          {item.certainty !== undefined && item.certainty !== 'recorded' && <span className={css.stateTag} data-state="unknown">
            {t(`world.obligation.certainty.${item.certainty}`)}</span>}
        </div>
        {item.original !== undefined && <details className={css.bodyDisclosure}>
          <summary>{t('world.obligation.source')}</summary>
          <dl className={css.keyValue}>
            <div><dt>{t('world.obligation.source.cursor')}</dt><dd>{item.original.cursor}</dd></div>
            {item.ownerState !== undefined && <div><dt>{t('world.obligation.source.state')}</dt><dd><code>{item.ownerState}</code></dd></div>}
          </dl>
          <pre className={css.prose}>{JSON.stringify({ owner: item.original.owner, reference: item.original.ref }, null, 2)}</pre>
        </details>}
        <div className={css.obligationMeta}>
          <span>{t('world.obligation.owner', { owner: item.owner.text })}</span><span>r{item.revision}</span>
          {item.ref !== undefined && <EngineRefLink value={item.ref} open={openRef} t={t} />}
        </div>
        {item.dispositions.length > 0 && (dispose !== undefined || disabledReason !== undefined) && <div className={css.inlineActions}>
          {item.dispositions.map(disposition => disposition === 'wait' ? <span key={disposition} className={css.muted}>
            {t('world.obligation.disposition.wait')}</span> : <Button key={disposition}
            size="sm" variant="secondary" disabled={dispose === undefined} title={dispose === undefined ? disabledReason : undefined}
            onClick={() => { dispose?.(item, disposition) }}>{t(`world.obligation.disposition.${disposition}`)}</Button>)}</div>}
      </li>)}</ul>
    </section>
  })}</div>
}
