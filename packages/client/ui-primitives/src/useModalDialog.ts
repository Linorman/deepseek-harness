import { useLayoutEffect, useRef } from 'react'
import type { RefObject } from 'react'

/**
 * Share the native modal lifetime and return focus to the connected opener on close.
 * @param open - Whether the owner's native dialog is mounted.
 * @param fallbackFocus - Stable owner control used if the original opener has disappeared.
 * @returns The dialog ref controlled by this lifetime.
 */
export function useModalDialog(open: boolean, fallbackFocus?: RefObject<HTMLElement>): RefObject<HTMLDialogElement> {
  const ref = useRef<HTMLDialogElement>(null)
  useLayoutEffect(() => {
    if (!open || ref.current === null) return
    const dialog = ref.current, previous = document.activeElement
    dialog.showModal()
    // Native inertness protects the page, but browsers can tab from the last
    // control into their own chrome. Keep the owner's documented focus cycle
    // inside the dialog without intercepting keys from nested native dialogs.
    const cycleFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || event.defaultPrevented) return
      if (event.target instanceof Element && event.target.closest('dialog[open]') !== dialog) return
      const controls = [...dialog.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]',
      )].filter(element => element.tabIndex >= 0 && !element.matches(':disabled')
        && element.getClientRects().length > 0 && element.closest('[inert]') === null)
      const first = controls[0], last = controls.at(-1)
      if (first === undefined || last === undefined) {
        event.preventDefault()
        dialog.focus()
      } else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) {
        event.preventDefault()
        first.focus()
      }
    }
    dialog.addEventListener('keydown', cycleFocus)
    return () => {
      dialog.removeEventListener('keydown', cycleFocus)
      dialog.close()
      if (previous instanceof HTMLElement && previous !== document.body && previous.isConnected) previous.focus()
      else fallbackFocus?.current?.focus()
    }
  }, [open, fallbackFocus])
  return ref
}
