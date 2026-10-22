/** Anchored `<details>` popovers in the run command band close like menus without losing native disclosure semantics. */
import { useEffect, type RefObject } from 'react'

/**
 * Close an open `<details>` popover on an outside pointer press or Escape; Escape returns focus to its summary.
 * @param ref - The `<details>` element whose content is positioned as a popover.
 */
export function useDismissibleDisclosure(ref: RefObject<HTMLDetailsElement | null>): void {
  useEffect(() => {
    const element = ref.current
    if (element === null) return
    const outside = (event: PointerEvent) => {
      if (element.open && event.target instanceof Node && !element.contains(event.target)) element.open = false
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !element.open) return
      event.stopPropagation()
      element.open = false
      element.querySelector('summary')?.focus()
    }
    document.addEventListener('pointerdown', outside)
    element.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', outside); element.removeEventListener('keydown', escape) }
  }, [ref])
}
