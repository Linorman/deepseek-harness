// Kbd: a keyboard shortcut as key caps.

import clsx from 'clsx'
import css from './Kbd.module.css'

/**
 * Render a shortcut. Each key is its own `kbd`, nested in an outer `kbd` as
 * HTML recommends for key combinations.
 * @param props.keys - key labels in press order, for example `['⌘', 'K']`.
 * @returns the shortcut element.
 */
export function Kbd({ keys, className }: { keys: readonly string[]; className?: string | undefined }) {
  return (
    <kbd className={clsx(css.combo, className)}>
      {keys.map((key, index) => <kbd key={`${key}-${String(index)}`} className={css.key}>{key}</kbd>)}
    </kbd>
  )
}
