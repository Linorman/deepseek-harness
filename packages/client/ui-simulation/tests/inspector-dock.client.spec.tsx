// @vitest-environment jsdom
/** The World stage and inspector dock order their motion around real navigation: exits close once, new selections win. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { InspectorDock, WorkspaceStage } from '../src/client/WorldInspector.tsx'
import { makeTranslate } from '../../../test-support/client-runtime/src/translate.ts'
import { en } from '../src/client/locales.ts'

const t = makeTranslate(en) as never
interface Recorded {
  element: Element
  keyframes: Keyframe[]
  animation: { onfinish: (() => void) | null; cancel: () => void; cancelled: boolean }
}
let animations: Recorded[] = []

beforeEach(() => {
  animations = []
  Object.defineProperty(Element.prototype, 'animate', { configurable: true, value: function (this: Element, keyframes: Keyframe[]) {
    const animation = { onfinish: null as (() => void) | null, cancelled: false, cancel() { this.cancelled = true } }
    animations.push({ element: this, keyframes, animation })
    return animation
  } })
})
afterEach(() => { cleanup(); delete (Element.prototype as { animate?: unknown }).animate; vi.unstubAllGlobals() })

const sections = (current: string, select = vi.fn()) => ({ current, select,
  items: [{ id: 'identity', label: 'Identity' }, { id: 'facts', label: 'Facts' }, { id: 'votes', label: 'Votes' }] })

it('keeps the stage undimmed while opening and closing the inspector', () => {
  const view = render(<WorkspaceStage detail><p>collection</p></WorkspaceStage>)
  const stage = view.container.querySelector('[data-stage]')!
  expect(stage.hasAttribute('data-detail')).toBe(true)
  expect(stage.hasAttribute('data-dim')).toBe(false)
  view.rerender(<WorkspaceStage detail={false}><p>collection</p></WorkspaceStage>)
  expect(stage.hasAttribute('data-detail')).toBe(false)
  expect(stage.hasAttribute('data-dim')).toBe(false)
})

it('commits a close only after the exit motion finishes, once, whether by button or Escape', () => {
  const close = vi.fn()
  render(<InspectorDock title="Lin" identity="lin" close={close} t={t}><p>body</p></InspectorDock>)
  fireEvent.click(screen.getByRole('button', { name: en['world.close'] }))
  fireEvent.keyDown(screen.getByRole('complementary'), { key: 'Escape' })
  expect(close).not.toHaveBeenCalled()
  const exit = animations.find(item => item.element.tagName === 'ASIDE')!
  expect(exit.keyframes.at(-1)).toMatchObject({ opacity: 0 })
  exit.animation.onfinish?.()
  expect(close).toHaveBeenCalledOnce()
})

it('cancels a pending exit when another object is selected so the new dock stays open', () => {
  const close = vi.fn()
  const view = render(<InspectorDock title="Lin" identity="lin" close={close} t={t}><p>body</p></InspectorDock>)
  fireEvent.click(screen.getByRole('button', { name: en['world.close'] }))
  const exit = animations.find(item => item.element.tagName === 'ASIDE')!
  view.rerender(<InspectorDock title="Observer" identity="observer" close={close} t={t}><p>body</p></InspectorDock>)
  expect(exit.animation.cancelled).toBe(true)
  exit.animation.onfinish?.()
  expect(close).not.toHaveBeenCalled()
})

it('closes at once under reduced motion', () => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce'), media: query,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }))
  const close = vi.fn()
  render(<InspectorDock title="Lin" identity="lin" close={close} t={t}><p>body</p></InspectorDock>)
  fireEvent.click(screen.getByRole('button', { name: en['world.close'] }))
  expect(close).toHaveBeenCalledOnce()
})

it('eases section changes in from the direction of travel but not on a new object', () => {
  const view = render(<InspectorDock title="Lin" identity="lin" close={vi.fn()} sections={sections('identity')} t={t}><p>body</p></InspectorDock>)
  const bodyMotion = () => animations.filter(item => item.element.tagName === 'DIV' && item.keyframes.length === 2
    && 'transform' in (item.keyframes[0] ?? {}))
  view.rerender(<InspectorDock title="Lin" identity="lin" close={vi.fn()} sections={sections('votes')} t={t}><p>body</p></InspectorDock>)
  expect(bodyMotion().at(-1)?.keyframes[0]).toMatchObject({ transform: 'translateY(4px)' })
  view.rerender(<InspectorDock title="Lin" identity="lin" close={vi.fn()} sections={sections('facts')} t={t}><p>body</p></InspectorDock>)
  expect(bodyMotion().at(-1)?.keyframes[0]).toMatchObject({ transform: 'translateY(-4px)' })
  const before = bodyMotion().length
  view.rerender(<InspectorDock title="Observer" identity="observer" close={vi.fn()} sections={sections('identity')} t={t}><p>body</p></InspectorDock>)
  expect(bodyMotion()).toHaveLength(before)
})
