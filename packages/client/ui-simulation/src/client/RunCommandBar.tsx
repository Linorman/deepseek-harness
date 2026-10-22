/** Run header: an identity row that scrolls away above one sticky command band of status, controls and module navigation. */
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { IconButton, IconChevronLeftOutline14, IconRefreshOutline16, Tooltip } from '@clocky/clocky-client-ui-primitives'
import { transitionName, useAmbientMotion } from '@clocky/clocky-client-ui-viz'
import type { Key } from './locales.ts'
import css from './Workspace.module.css'

type Translate = (key: Key) => string

/**
 * Short simulated-world marker for World run headers; the complete statement stays in its tooltip and accessible text.
 * @param props.t - Translator.
 * @returns a focusable note.
 */
export function SimulatedChip({ t }: { t: Translate }) {
  return <Tooltip label={t('world.ext.notice')} side="bottom" delayMs={300} maxWidth={320}>
    {/* A focusable note so keyboard users reach the tooltip; it has no action. */}
    <span className={css.simulatedChip} role="note" tabIndex={0} data-world-simulated-only>
      <span aria-hidden="true">◎</span><span aria-hidden="true">{t('world.simulatedChip')}</span>
      <span className={css.visuallyHidden}>{t('world.ext.notice')}</span>
    </span>
  </Tooltip>
}

/**
 * Pause or resume the ambient field's slow drift and observation rings (WCAG 2.2.2). The choice is kept in this
 * browser only; reduced motion keeps the field still regardless.
 * @param props.t - Translator.
 * @returns toggle icon button.
 */
export function AmbientToggle({ t }: { t: Translate }) {
  const [motion, setMotion] = useAmbientMotion()
  const on = motion === 'on'
  return <IconButton label={t(on ? 'ambient.pause' : 'ambient.resume')} aria-pressed={on} className={css.ambientToggle}
    data-on={on || undefined} onClick={() => { setMotion(on ? 'off' : 'on') }}
    icon={<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.2">
      <path d="M8 3.2c2.9 0 5 1.9 5 4.4s-2.3 5.2-5.2 5.2S3 10.6 3 8.1 5.1 3.2 8 3.2Z" />
      <path d="M8 5.6c1.5 0 2.6 1 2.6 2.3S9.4 10.5 7.9 10.5 5.4 9.4 5.4 8.1 6.5 5.6 8 5.6Z" />
      {!on && <path d="M2.5 13.5 13.5 2.5" strokeLinecap="round" />}
    </svg>} />
}

/**
 * Whether the observed element has scrolled above its scroll root, so the band below it is stuck.
 * @param target - The identity row that scrolls away.
 * @param root - Scroll container that owns the sticky band.
 * @returns true once the target has left the top of the root.
 */
export function useScrolledPast(target: RefObject<Element | null>, root: RefObject<Element | null>): boolean {
  const [past, setPast] = useState(false)
  useEffect(() => {
    const element = target.current
    if (element === null || typeof IntersectionObserver === 'undefined') return
    // One observer at threshold 0 toggles once per crossing; scroll position never drives per-frame styles.
    const observer = new IntersectionObserver(([entry]) => {
      if (entry === undefined) return
      setPast(!entry.isIntersecting && entry.boundingClientRect.bottom <= (entry.rootBounds?.top ?? 0))
    }, { root: root.current, threshold: 0 })
    observer.observe(element)
    return () => { observer.disconnect() }
  }, [target, root])
  return past
}

/**
 * Publish the sticky band's height on the scroll root as `--run-band-block`, so docks stick just below it.
 * @param band - The sticky command band.
 * @param root - Scroll container whose descendants read the property.
 */
function useBandBlock(band: RefObject<HTMLElement>, root: RefObject<Element | null>): void {
  useEffect(() => {
    const element = band.current, owner = root.current
    if (element === null || !(owner instanceof HTMLElement) || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      // A static band (narrow layouts) occupies no sticky space.
      const sticky = getComputedStyle(element).position === 'sticky'
      owner.style.setProperty('--run-band-block', `${String(sticky ? Math.ceil(element.getBoundingClientRect().height) : 0)}px`)
    })
    observer.observe(element)
    return () => { observer.disconnect(); owner.style.removeProperty('--run-band-block') }
  }, [band, root])
}

/**
 * Compose the run header: identity (back, name, simulated marker, refresh) and the sticky command band.
 * @param props.runId - Run identity for the directory-card view transition.
 * @param props.name - Displayed run name.
 * @param props.world - Whether the run is a World run (adds the simulated marker).
 * @param props.back - Return to the run directory.
 * @param props.refresh - Reread the run without animating background reads.
 * @param props.root - Scroll container in which the band sticks.
 * @param props.identity - Ref of the identity row, observed for the condensed state.
 * @param props.children - Band content: status capsule with controls, then module navigation.
 * @returns header and band.
 */
export function RunCommandBar({ runId, name, world, back, refresh, refreshDisabled, refreshOutcome, root, identity, children, t }: {
  runId: string
  /** Live announcement of the latest explicit refresh. */
  refreshOutcome?: ReactNode
  name: string
  world: boolean
  back: () => void
  refresh: () => void
  refreshDisabled: boolean
  root: RefObject<Element | null>
  identity: RefObject<HTMLElement>
  children: ReactNode
  t: Translate
}) {
  const condensed = useScrolledPast(identity, root)
  const band = useRef<HTMLDivElement>(null)
  useBandBlock(band, root)
  return <>
    <header ref={identity} className={css.runHeader}>
      <IconButton label={t('back')} icon={<IconChevronLeftOutline14 />} onClick={back} />
      <h1 style={{ viewTransitionName: transitionName('clocky-run', runId) }}>{name}</h1>
      {world && <SimulatedChip t={t} />}
      <span className={css.runHeaderEnd}>{refreshOutcome}<AmbientToggle t={t} /><IconButton label={t('refresh')} icon={<IconRefreshOutline16 />}
        disabled={refreshDisabled} onClick={refresh} /></span>
    </header>
    <div ref={band} className={css.commandBand} data-condensed={condensed || undefined} data-motion-tier="L2">
      {/* The name repeats only while the identity row is out of view; the heading above stays the accessible title. */}
      <span className={css.bandName} aria-hidden="true">{name}</span>
      {children}
    </div>
  </>
}
