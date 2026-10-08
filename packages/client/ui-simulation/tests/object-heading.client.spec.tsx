// @vitest-environment jsdom
/** Long authorized names expand deliberately and dispose their layout observer. */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ObjectHeading } from '../src/client/ObjectHeading.tsx'
import { en } from '../src/client/locales.ts'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('expands a clipped name, collapses it and retires the observer on each layout lifetime', () => {
  let measure: ResizeObserverCallback | undefined
  const disconnect = vi.fn(), close = vi.fn()
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { measure = callback }
    observe() {}
    disconnect = disconnect
  })
  let height = 100
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(() => height)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(20)
  const props = { name: 'Long authorized name', domain: 'Entity', close, t: (key: keyof typeof en) => en[key] }
  const ui = render(<ObjectHeading {...props} />)
  fireEvent.click(screen.getByRole('button', { name: en['object.expandName'] }))
  expect(screen.getByRole('heading').getAttribute('data-expanded')).toBe('true')
  fireEvent.click(screen.getByRole('button', { name: en['object.collapseName'] }))
  expect(screen.getByRole('heading').getAttribute('data-expanded')).toBeNull()
  height = 20
  act(() => { measure?.([], {} as ResizeObserver) })
  expect(screen.queryByRole('button', { name: en['object.expandName'] })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: en.close }))
  expect(close).toHaveBeenCalledOnce()
  ui.unmount()
  expect(disconnect).toHaveBeenCalledTimes(3)
})
