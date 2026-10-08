/** L3 moments: assemble, converge, ignite, seal, and stall. */
import { useEffect, useRef, type ReactNode } from 'react'
import { prefersReducedMotion } from './motion/hooks.ts'
import { tokenDuration } from './motion/tokens.ts'
import css from './Moment.module.css'

/** The five milestone moments; `seal-failed` is a seal whose checkpoint failed. */
export type MomentKind = 'assemble' | 'converge' | 'ignite' | 'seal' | 'seal-failed' | 'stall'

/**
 * Wrap content that performs a moment once per live transition. The owner
 * increments `generation` only for a transition it observed live, so
 * hydration, reload, replay, and navigation never replay a moment. Any
 * pointer or key input finishes the choreography at once.
 * @param props.kind - Which moment to perform.
 * @param props.generation - 0 for none; each increment plays once.
 * @param props.children - Content the moment decorates.
 * @returns the wrapped content.
 */
export function Moment({ kind, generation, className, children }: {
  kind: MomentKind
  generation: number
  className?: string | undefined
  children: ReactNode
}) {
  const root = useRef<HTMLDivElement>(null)
  const overlay = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const element = root.current, wash = overlay.current
    if (generation === 0 || element === null || wash === null || typeof wash.animate !== 'function') return
    const reduced = prefersReducedMotion()
    const duration = Math.min(1200, tokenDuration(element, '--clocky-duration-celebrate', 1200))
    const fade = tokenDuration(element, '--clocky-duration-fade', 140)
    const animations: Animation[] = []
    element.dataset.motionTier = 'L3'
    if (kind === 'ignite') {
      // The world warms from muted to full tone: a canvas wash fades out.
      animations.push(wash.animate([{ opacity: 0.55 }, { opacity: 0 }], { duration: reduced ? fade * 3 : duration, easing: 'cubic-bezier(0.05, 0.7, 0.1, 1)' }))
    } else {
      const frames = [{ opacity: 0 }, { opacity: 1, offset: 0.35 }, { opacity: 0 }]
      animations.push(wash.animate(frames, { duration: reduced ? fade * 3 : duration }))
    }
    if (!reduced && kind !== 'stall') {
      const frames = kind === 'converge' ? [{ transform: 'scale(1)' }, { transform: 'scale(0.985)' }, { transform: 'scale(1)' }]
        : kind === 'assemble' ? [{ transform: 'scale(0.97)', opacity: 0.4 }, { transform: 'scale(1)', opacity: 1 }]
          : kind === 'ignite' ? [{ transform: 'scale(0.99)' }, { transform: 'scale(1)' }]
            : [{ transform: 'translateY(-4px)' }, { transform: 'translateY(0)' }]
      animations.push(element.animate(frames, { duration: Math.min(duration, 600), easing: 'cubic-bezier(0.05, 0.7, 0.1, 1)' }))
    }
    const skip = () => { for (const animation of animations) animation.finish() }
    const view = element.ownerDocument.defaultView
    view?.addEventListener('pointerdown', skip, { once: true, capture: true })
    view?.addEventListener('keydown', skip, { once: true, capture: true })
    const done = Promise.all(animations.map(animation => animation.finished.catch(() => undefined)))
    void done.then(() => { delete element.dataset.motionTier })
    return () => {
      view?.removeEventListener('pointerdown', skip, { capture: true })
      view?.removeEventListener('keydown', skip, { capture: true })
      skip()
    }
  }, [generation])
  return <div ref={root} className={className === undefined ? css.moment : `${css.moment} ${className}`} data-kind={kind}>
    {children}
    <span ref={overlay} className={css.overlay} aria-hidden="true" />
  </div>
}
