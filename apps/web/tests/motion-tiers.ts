/**
 * Browser-side motion probes for the visual layer's tier rules. Each probe is
 * self-contained so Playwright can pass it to `page.evaluate` unchanged.
 */

/** One running animation the rules forbid. */
export interface MotionViolation {
  /** Tier of the nearest `data-motion-tier` ancestor, or `none`. */
  readonly tier: string
  /** Animated element, as `tag.class` text for the failure message. */
  readonly target: string
  /** Animated CSS properties. */
  readonly properties: readonly string[]
}

/**
 * Running L2/L3 animations. After load, reload, replay, or navigation the
 * page must render settled, so this returns an empty list there.
 * @param doc - Document to inspect (the page's `document` under `page.evaluate`).
 * @returns animations inside an L2 or L3 element that are still running.
 */
export function runningTransitionAnimations(doc: Document): MotionViolation[] {
  return doc.getAnimations().flatMap((animation) => {
    const effect = animation.effect as KeyframeEffect | null
    const target = effect?.target ?? null
    const owner = target instanceof Element ? target.closest('[data-motion-tier]') : null
    const tier = owner?.getAttribute('data-motion-tier') ?? 'none'
    if (animation.playState !== 'running' || (tier !== 'L2' && tier !== 'L3')) return []
    const properties = [...new Set((effect?.getKeyframes() ?? []).flatMap(frame => Object.keys(frame)
      .filter(key => !['offset', 'computedOffset', 'easing', 'composite'].includes(key))))]
    return [{ tier, target: target instanceof Element ? `${target.tagName.toLowerCase()}.${String(target.getAttribute('class'))}` : 'pseudo', properties }]
  })
}

/**
 * Running animations that move anything but opacity. Under reduced motion
 * this returns an empty list.
 * @param doc - Document to inspect.
 * @returns running animations whose keyframes touch a property other than opacity.
 */
export function nonOpacityAnimations(doc: Document): MotionViolation[] {
  return doc.getAnimations().flatMap((animation) => {
    const effect = animation.effect as KeyframeEffect | null
    if (animation.playState !== 'running' || effect === null) return []
    const properties = [...new Set(effect.getKeyframes().flatMap(frame => Object.keys(frame)
      .filter(key => !['offset', 'computedOffset', 'easing', 'composite'].includes(key))))]
    if (properties.every(property => property === 'opacity')) return []
    const target = effect.target
    const owner = target instanceof Element ? target.closest('[data-motion-tier]') : null
    return [{ tier: owner?.getAttribute('data-motion-tier') ?? 'none',
      target: target instanceof Element ? `${target.tagName.toLowerCase()}.${String(target.getAttribute('class'))}` : 'pseudo', properties }]
  })
}
