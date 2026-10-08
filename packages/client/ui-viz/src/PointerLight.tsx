/** The light element moved by {@link usePointerLight}. */
import css from './PointerLight.module.css'

/**
 * Render the pointer light inside a positioned, clipping surface.
 * @returns a decorative element; the surface's `--pointer-light-tint` colors it.
 */
export function PointerLight() {
  return <span className={css.light} data-pointer-light aria-hidden="true" />
}
