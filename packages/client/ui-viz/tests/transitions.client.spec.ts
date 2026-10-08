// @vitest-environment jsdom
/** Page transitions degrade to immediate navigation and mark the direction while running. */
import { afterEach, expect, it, vi } from 'vitest'
import { navigateWithTransition, transitionDirection, transitionName } from '../src/index.ts'

afterEach(() => {
  delete (document as { startViewTransition?: unknown }).startViewTransition
  delete document.documentElement.dataset.clockyTransition
  vi.unstubAllGlobals()
})

it('navigates immediately where view transitions are unavailable', () => {
  const update = vi.fn()
  navigateWithTransition(update, 'forward')
  expect(update).toHaveBeenCalledOnce()
  expect(document.documentElement.dataset.clockyTransition).toBeUndefined()
})

/** A controllable visual lifetime; queued callbacks reproduce native skip behavior. */
function installTransitions() {
  const records: { update: () => void; finish: () => void; reject: () => void; skip: ReturnType<typeof vi.fn> }[] = []
  Object.assign(document, {
    startViewTransition: (update: () => void) => {
      let finish = () => {}, reject = () => {}
      const finished = new Promise<void>((resolve, rejectPromise) => {
        finish = resolve
        reject = () => { rejectPromise(new Error('visual failure')) }
      })
      const skip = vi.fn()
      records.push({ update, finish, reject, skip })
      return { finished, ready: finished, updateCallbackDone: finished, skipTransition: skip }
    },
  })
  return records
}

it('commits without an animation frame and cleans the direction after finishing', async () => {
  const records = installTransitions()
  const update = vi.fn()
  const frame = vi.fn()
  vi.stubGlobal('requestAnimationFrame', frame)
  navigateWithTransition(update, 'back')
  expect(update).toHaveBeenCalledOnce()
  records[0]!.update()
  expect(update).toHaveBeenCalledOnce()
  expect(frame).not.toHaveBeenCalled()
  expect(document.documentElement.dataset.clockyTransition).toBe('back')
  records[0]!.finish()
  await Promise.resolve()
  expect(document.documentElement.dataset.clockyTransition).toBeUndefined()
})

it('does not let a delayed native callback replace a newer browser history target', () => {
  const records = installTransitions()
  const original = window.location.href
  const update = vi.fn(() => { window.history.pushState(null, '', '?view=tasks') })
  try {
    navigateWithTransition(update, 'forward')
    expect(new URL(window.location.href).searchParams.get('view')).toBe('tasks')
    window.history.replaceState(null, '', '?view=attention')
    window.dispatchEvent(new PopStateEvent('popstate'))
    records[0]!.update()
    expect(new URL(window.location.href).searchParams.get('view')).toBe('attention')
    expect(update).toHaveBeenCalledOnce()
  } finally { window.history.replaceState(null, '', original) }
})

it('commits older pending navigation once before the latest and fences old cleanup', async () => {
  const records = installTransitions()
  const actions: string[] = []
  navigateWithTransition(() => { actions.push('old') }, 'forward')
  navigateWithTransition(() => { actions.push('new') }, 'back')
  expect(records[0]!.skip).toHaveBeenCalledOnce()
  records[1]!.update()
  records[0]!.update()
  records[0]!.finish()
  await Promise.resolve()
  expect(actions).toEqual(['old', 'new'])
  expect(document.documentElement.dataset.clockyTransition).toBe('back')
  records[1]!.finish()
  await Promise.resolve()
  expect(document.documentElement.dataset.clockyTransition).toBeUndefined()
})

it('contains visual rejection without replaying navigation', async () => {
  const records = installTransitions()
  const update = vi.fn()
  navigateWithTransition(update)
  records[0]!.update()
  records[0]!.reject()
  await Promise.resolve()
  expect(update).toHaveBeenCalledOnce()
  expect(document.documentElement.dataset.clockyTransition).toBeUndefined()
})

it.each(['pointermove', 'pointerdown', 'keydown'])('retires native capture on %s and ignores its later callback', (event) => {
  const records = installTransitions()
  const update = vi.fn()
  navigateWithTransition(update, 'forward')
  document.dispatchEvent(new Event(event))
  expect(update).toHaveBeenCalledOnce()
  expect(records[0]!.skip).toHaveBeenCalledOnce()
  expect(document.documentElement.dataset.clockyTransition).toBeUndefined()
  records[0]!.update()
  document.dispatchEvent(new Event(event))
  expect(update).toHaveBeenCalledOnce()
  expect(records[0]!.skip).toHaveBeenCalledOnce()
})

it('retires a pending capture when the document becomes hidden', () => {
  const records = installTransitions()
  const update = vi.fn()
  navigateWithTransition(update)
  document.dispatchEvent(new Event('visibilitychange'))
  expect(records[0]!.skip).not.toHaveBeenCalled()
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValueOnce('hidden')
  document.dispatchEvent(new Event('visibilitychange'))
  records[0]!.update()
  expect(records[0]!.skip).toHaveBeenCalledOnce()
  expect(update).toHaveBeenCalledOnce()
  expect(document.documentElement.dataset.clockyTransition).toBeUndefined()
})

it('falls back once when the browser rejects starting a capture', () => {
  Object.assign(document, { startViewTransition: () => { throw new Error('capture unavailable') } })
  const update = vi.fn()
  navigateWithTransition(update)
  expect(update).toHaveBeenCalledOnce()
  expect(document.documentElement.dataset.clockyTransition).toBeUndefined()
})

it('does not replay a failing update when capture invokes it synchronously', () => {
  Object.assign(document, { startViewTransition: (update: () => void) =>{  update() } })
  const update = vi.fn(() => { throw new Error('navigation failed') })
  expect(() =>{  navigateWithTransition(update) }).toThrow('navigation failed')
  expect(update).toHaveBeenCalledOnce()
})

it('uses immediate navigation for hidden documents and reduced motion', () => {
  const records = installTransitions()
  const update = vi.fn()
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValueOnce('hidden')
  navigateWithTransition(update)
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  navigateWithTransition(update)
  expect(update).toHaveBeenCalledTimes(2)
  expect(records).toEqual([])
})

it('derives direction from order and builds valid transition names', () => {
  expect(transitionDirection(['a', 'b', 'c'], 'a', 'c')).toBe('forward')
  expect(transitionDirection(['a', 'b', 'c'], 'c', 'b')).toBe('back')
  expect(transitionDirection(['a', 'b'], 'a', 'z')).toBe('none')
  expect(transitionName('clocky-run', 'run/1 中')).toMatch(/^clocky-run-[A-Za-z0-9_-]+$/)
  expect(transitionName('clocky-run', 'a')).not.toBe(transitionName('clocky-run', 'b'))
})
