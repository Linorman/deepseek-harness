// @vitest-environment jsdom
/** The motion probes report deliberately added animations and ignore allowed ones. */
import { afterEach, expect, it } from 'vitest'
import { nonOpacityAnimations, runningTransitionAnimations } from './motion-tiers.ts'

/** Minimal running animation over one element, as `getAnimations` would return it. */
function fake(target: Element, frames: Record<string, string | number>[], playState: AnimationPlayState = 'running'): Animation {
  return { playState, effect: { target, getKeyframes: () => frames } } as unknown as Animation
}

afterEach(() => { document.body.innerHTML = '' })

it('reports a running L2 entrance and ignores L0 ambient and finished animations', () => {
  document.body.innerHTML = '<div data-motion-tier="L2"><span id="card"></span></div><div data-motion-tier="L0"><span id="glow"></span></div>'
  const card = document.getElementById('card') as Element
  const glow = document.getElementById('glow') as Element
  document.getAnimations = () => [fake(card, [{ transform: 'translateY(6px)' }, { transform: 'none' }]),
    fake(glow, [{ transform: 'scale(1)' }]), fake(card, [{ opacity: 0 }], 'finished')]
  expect(runningTransitionAnimations(document)).toEqual([{ tier: 'L2', target: 'span.null', properties: ['transform'] }])
})

it('reports movement under reduced motion but accepts opacity-only fades', () => {
  document.body.innerHTML = '<span id="dot"></span><span id="fade"></span>'
  const dot = document.getElementById('dot') as Element
  const fade = document.getElementById('fade') as Element
  document.getAnimations = () => [fake(dot, [{ transform: 'translate(1px, 2px)', offset: 0 }]), fake(fade, [{ opacity: 0 }, { opacity: 1 }])]
  expect(nonOpacityAnimations(document).map(violation => violation.properties)).toEqual([['transform']])
})
