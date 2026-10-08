/**
 * Pointer light: a soft highlight that follows a fine pointer across a
 * surface, optionally with a slight 3D tilt. Per-frame work runs through
 * refs and requestAnimationFrame; React does not re-render. Only `transform`
 * and `opacity` change, and nothing runs for touch or reduced motion.
 */
import { useEffect, type RefObject } from 'react'
import { prefersReducedMotion } from './hooks.ts'

/** Options for {@link usePointerLight}. */
export interface PointerLightOptions {
  /** Maximum tilt in degrees; 0 disables tilt. */
  readonly tilt?: number
  /** Lift in pixels while hovered, applied with the tilt. */
  readonly lift?: number
}

/**
 * Attach the pointer light to a surface. The surface needs a child marked
 * `data-pointer-light`; the hook moves that child under the pointer and
 * sets `data-lit` on the surface while hovered.
 * @param ref - The surface element.
 * @param options - Tilt and lift.
 */
export function usePointerLight(ref: RefObject<HTMLElement>, options: PointerLightOptions = {}): void {
  const { tilt = 0, lift = 0 } = options
  useEffect(() => {
    const surface = ref.current
    if (surface === null || typeof window.matchMedia !== 'function') return
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return
    const light = surface.querySelector<HTMLElement>('[data-pointer-light]')
    let frame = 0
    let point = { x: 0, y: 0 }
    const paint = () => {
      frame = 0
      const box = surface.getBoundingClientRect()
      const x = point.x - box.left, y = point.y - box.top
      if (light !== null) light.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`
      if (tilt > 0) {
        const rx = (y / box.height - 0.5) * -2 * tilt
        const ry = (x / box.width - 0.5) * 2 * tilt
        surface.style.transform = `perspective(900px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) translateY(${String(-lift)}px)`
      }
    }
    const move = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' || prefersReducedMotion()) return
      point = { x: event.clientX, y: event.clientY }
      surface.dataset.lit = ''
      if (light !== null) light.style.opacity = '1'
      if (frame === 0) frame = requestAnimationFrame(paint)
    }
    const leave = () => {
      if (frame !== 0) cancelAnimationFrame(frame)
      frame = 0
      delete surface.dataset.lit
      if (light !== null) light.style.opacity = '0'
      if (tilt > 0) surface.style.transform = ''
    }
    surface.addEventListener('pointermove', move)
    surface.addEventListener('pointerleave', leave)
    return () => {
      leave()
      surface.removeEventListener('pointermove', move)
      surface.removeEventListener('pointerleave', leave)
    }
  }, [ref, tilt, lift])
}
