/** L0 ambient backdrop behind a workspace, tinted by the active mode. */
import css from './Backdrop.module.css'

/**
 * Render a static mode-tinted backdrop without animation or visibility subscriptions.
 * @param props.mode - Active workspace; selects the identity ramp.
 * @returns a decorative layer that fills its positioned parent.
 */
export function AmbientBackdrop({ mode }: { mode: 'team' | 'simulation' }) {
  return <div className={css.backdrop} data-mode={mode}
    data-motion-tier="L0" aria-hidden="true">
    <span className={css.glow} />
    <span className={css.glow} />
  </div>
}
