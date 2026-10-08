import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import css from './Toast.module.css'

/** Keyframes name of the stylesheet's exit fade; CSS modules may wrap it with a scope hash. */
const FADE_ANIMATION = 'clocky-toast-fade'

/**
 * Transient top-center banner: slides in, holds at full opacity for the
 * `--clocky-duration-dwell` token, fades out, then reports done so the owner
 * can unmount it. The fade's own `animationend` ends the lifetime, so the
 * stylesheet's timing is the only timing. Re-showing the same text
 * restarts the cycle when the owner remounts the component (key it by a
 * per-show sequence). Rendered through a body portal so an owner inside a
 * transformed or filtered ancestor cannot trap the fixed banner in that
 * ancestor's box.
 *
 * @param props.text - resolved banner copy; the owner passes localized text.
 * @param props.icon - optional leading glyph (e.g. a warning icon).
 * @param props.anchor - optional element whose horizontal center the banner
 * follows (e.g. the composer card, so the banner centers over the chat column
 * rather than the whole window); omitted, it centers on the viewport.
 * @param props.onDone - called once the fade completes; unmount the toast here.
 * @returns the floating banner.
 */
export function Toast({ text, icon, anchor, onDone }: {
  text: string
  icon?: ReactNode
  anchor?: HTMLElement | null
  onDone: () => void
}) {
  // A native listener: React resolves `onAnimationEnd` to a vendor-prefixed
  // name where `AnimationEvent` is missing, which would strand the toast.
  const toastRef = useRef<HTMLDivElement>(null)
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone
  useEffect(() => {
    // The toast is always portaled while mounted, before passive effects run.
    const element = toastRef.current as HTMLDivElement
    const onEnd = (event: Event) => {
      if ((event as AnimationEvent).animationName.includes(FADE_ANIMATION)) onDoneRef.current()
    }
    element.addEventListener('animationend', onEnd)
    return () => { element.removeEventListener('animationend', onEnd) }
  }, [])
  // Anchor-centered placement re-measures on window resizes; the banner lives
  // a few seconds, so sub-window layout drift within that span stays out of
  // scope.
  const [left, setLeft] = useState<number | null>(null)
  useLayoutEffect(() => {
    if (anchor == null) return
    const measure = (): void => {
      const rect = anchor.getBoundingClientRect()
      setLeft(rect.left + rect.width / 2)
    }
    measure()
    window.addEventListener('resize', measure)
    return () => { window.removeEventListener('resize', measure) }
  }, [anchor])
  return createPortal(
    <div ref={toastRef} className={css.toast} role="alert" style={left === null ? undefined : { left }}>
      {icon !== undefined && <span className={css.icon} aria-hidden>{icon}</span>}
      <span className={css.text}>{text}</span>
    </div>,
    document.body,
  )
}
