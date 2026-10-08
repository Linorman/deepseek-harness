/** Read motion tokens at animation start so WAAPI timing follows the theme and reduced motion. */

/**
 * Resolve a duration token on an element to milliseconds.
 * @param element - Element whose computed style carries the token.
 * @param name - Token name such as `--clocky-duration-flow`.
 * @param fallback - Milliseconds used when the token is absent (tests, detached nodes).
 * @returns the duration in milliseconds.
 */
export function tokenDuration(element: Element, name: string, fallback: number): number {
  const raw = getComputedStyle(element).getPropertyValue(name).trim()
  const value = Number.parseFloat(raw)
  if (!Number.isFinite(value)) return fallback
  return raw.endsWith('ms') ? value : value * 1000
}
