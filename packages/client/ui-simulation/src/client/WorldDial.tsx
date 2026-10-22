/**
 * World dial: the overview's hero. Simulated time is the largest figure on the page; a finite event axis with the
 * next event sits beside it only while events are scheduled. Time moves only when a new observation arrives — the digits
 * roll and the "now" marker springs along
 * the axis on a live advance, and the ambient field answers with one ring. Nothing moves between observations.
 */
import { useEffect, useRef } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { Odometer, pulseAmbient, useLiveTransition } from '@clocky/clocky-client-ui-viz'
import type { WorldOverviewView } from './world-domain.ts'
import { compareTime } from './world-domain.ts'
import { Count, InfoHint, groupTime } from './WorldFacts.tsx'
import type { WorldT } from './WorldFacts.tsx'
import css from './World.module.css'

/** Events drawn on the axis; the Host page is already finite and the list below repeats them as text. */
const AXIS_EVENTS = 5

/**
 * Share of the way from `from` to `to` at which `value` sits, in percent with one decimal.
 * @param value - Point on the axis.
 * @param from - Axis start.
 * @param to - Axis end, greater than `from`.
 * @returns clamped percentage.
 */
function share(value: string, from: string, to: string): number {
  const span = BigInt(to) - BigInt(from)
  if (span <= 0n) return 0
  const raw = Number((BigInt(value) - BigInt(from)) * 1000n / span) / 10
  return Math.min(100, Math.max(0, raw))
}

/**
 * Hero dial with simulated time, revision, an optional tool slot and the finite event axis.
 * @param props.identity - Run identity; a new run settles instead of animating.
 * @param props.value - Overview projection; absent renders the unavailable fact.
 * @param props.tools - Controls placed at the dial's end (export menu).
 * @returns section.
 */
export function WorldDial({ identity, value, tools, t }: {
  identity: string
  value: WorldOverviewView | undefined
  tools?: ReactNode
  t: WorldT
}) {
  const clock = useRef<HTMLDivElement>(null)
  // The axis starts where this page first saw the world, so "now" visibly travels as new observations arrive.
  const origin = useRef<{ identity: string; at: string } | undefined>()
  const anchored = origin.current
  if (value !== undefined && (anchored === undefined || anchored.identity !== identity || compareTime(value.now, anchored.at) < 0)) {
    origin.current = { identity, at: value.now }
  }
  const time = useLiveTransition(identity, value?.revision, value?.now)
  const advanced = time.live && time.previous !== undefined && value !== undefined && compareTime(value.now, time.previous) > 0
  useEffect(() => { if (advanced) pulseAmbient(clock.current) }, [advanced, time.generation])
  const events = value === undefined ? [] : [...value.upcoming].filter(event => compareTime(event.at, value.now) > 0)
    .sort((a, b) => compareTime(a.at, b.at)).slice(0, AXIS_EVENTS)
  const start = origin.current?.at ?? value?.now ?? '0'
  const end = events.at(-1)?.at
  // Without scheduled events the axis would be an empty calendar; the hero then keeps only the clock.
  return <section className={css.dial} aria-labelledby="world-dial" data-live={advanced || undefined}
    data-compact={value !== undefined && end === undefined || undefined}>
    <div ref={clock} className={css.dialClock}>
      <h2 id="world-dial" className={css.dialEyebrow}>{t('world.dial.title')}</h2>
      {value === undefined ? <Count value={undefined} t={t} /> : <p className={css.dialNow}>
        <Odometer className={css.dialDigits} text={groupTime(value.now)} live={advanced}
          label={`${t('world.org.now')} ${groupTime(value.now)} ${value.tickUnit}`} />
        <span className={css.dialUnit} aria-hidden="true">{value.tickUnit}</span>
      </p>}
      {value !== undefined && <p className={css.dialMeta}>{t('world.dial.revision', { revision: value.revision })}
        <InfoHint label={t('world.hint')} text={t('world.dial.meta', { revision: value.revision })} /></p>}
    </div>
    {value !== undefined && end !== undefined && <div className={css.dialAxis}>
      <p className={css.dialNext}>{t('world.dial.next', { at: groupTime(events[0]?.at ?? end), label: events[0]?.label.text ?? '' })}</p>
      <div className={css.axisTrack} role="img" aria-label={t('world.dial.axis', { count: events.length, next: groupTime(events[0]?.at ?? end) })}>
        <span className={css.axisRail} />
        <span className={css.axisElapsed} style={{ '--at': String(share(value.now, start, end)) } as CSSProperties} />
        {events.map((event, index) => <span key={`${event.at}:${String(index)}`} className={css.axisEvent}
          style={{ '--at': String(share(event.at, start, end)) } as CSSProperties} title={`${groupTime(event.at)} · ${event.label.text}`}>
          <span className={css.axisIndex}>{index + 1}</span></span>)}
        <span className={css.axisNowMark} style={{ '--at': String(share(value.now, start, end)) } as CSSProperties}><span /></span>
      </div>
      <ol className={css.dialEvents}>{events.map((event, index) => <li key={`${event.at}:${String(index)}`}>
        <span className={css.axisIndex} aria-hidden="true">{index + 1}</span>
        <span className={css.time}>{groupTime(event.at)}</span>
        <span className={css.dialEventLabel}>{event.label.text}{event.scope !== undefined
          && <span className={css.muted}> · {event.scope.text}</span>}</span>
      </li>)}</ol>
    </div>}
    {tools !== undefined && <div className={css.dialTools}>{tools}</div>}
  </section>
}
