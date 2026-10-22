// @vitest-environment jsdom
/** The run header keeps identity, the simulated-only statement and the sticky band's condensed state honest. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { RunCommandBar } from '../src/client/RunCommandBar.tsx'
import { useDismissibleDisclosure } from '../src/client/disclosure.ts'
import { en } from '../src/client/locales.ts'
import type { Key } from '../src/client/locales.ts'

const t = (key: Key) => en[key]
let observed: { callback: IntersectionObserverCallback; root: Element | null; target?: Element; disconnected: boolean }[] = []

beforeEach(() => {
  observed = []
  vi.stubGlobal('IntersectionObserver', class {
    record: (typeof observed)[number]
    constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
      this.record = { callback, root: (options?.root ?? null) as Element | null, disconnected: false }
      observed.push(this.record)
    }
    observe(target: Element) { this.record.target = target }
    disconnect() { this.record.disconnected = true }
  })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function Harness({ world = true, back = () => {}, refresh = () => {} }: { world?: boolean; back?: () => void; refresh?: () => void }) {
  const root = useRef<HTMLDivElement>(null)
  const identity = useRef<HTMLElement>(null)
  return <div ref={root}><RunCommandBar runId="run" name="Lab world" world={world} back={back} refresh={refresh}
    refreshDisabled={false} root={root} identity={identity} t={t}><span>band content</span></RunCommandBar></div>
}

function cross(intersecting: boolean, bottom: number) {
  const record = observed.at(-1)!
  act(() => {
    record.callback([{ isIntersecting: intersecting, boundingClientRect: { bottom } as DOMRectReadOnly,
      rootBounds: { top: 0 } as DOMRectReadOnly } as IntersectionObserverEntry], {} as IntersectionObserver)
  })
}

it('names the run once as a heading and keeps back and refresh labeled for assistive technology', () => {
  const back = vi.fn(), refresh = vi.fn()
  render(<Harness back={back} refresh={refresh} />)
  expect(screen.getAllByRole('heading', { name: 'Lab world' })).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: en.back }))
  fireEvent.click(screen.getByRole('button', { name: en.refresh }))
  expect(back).toHaveBeenCalledOnce(); expect(refresh).toHaveBeenCalledOnce()
})

it('states the complete simulated-only boundary in a focusable note for World runs only', () => {
  const world = render(<Harness />)
  const note = screen.getByRole('note')
  expect(note.textContent).toContain(en['world.ext.notice'])
  expect(note.getAttribute('tabindex')).toBe('0')
  world.unmount()
  render(<Harness world={false} />)
  expect(screen.queryByRole('note')).toBeNull()
})

it('condenses the band only after the identity row has left the top of the scroll root, then expands again', () => {
  const view = render(<Harness />)
  const band = view.container.querySelector('[data-motion-tier="L2"]')!
  expect(observed.at(-1)!.root).toBe(view.container.firstElementChild)
  expect(observed.at(-1)!.target?.tagName).toBe('HEADER')
  expect(band.hasAttribute('data-condensed')).toBe(false)
  cross(false, 600)
  expect(band.hasAttribute('data-condensed')).toBe(false)
  cross(false, -4)
  expect(band.hasAttribute('data-condensed')).toBe(true)
  expect(band.querySelector('[aria-hidden="true"]')?.textContent).toBe('Lab world')
  cross(true, 40)
  expect(band.hasAttribute('data-condensed')).toBe(false)
  view.unmount()
  expect(observed.at(-1)!.disconnected).toBe(true)
})

function Popover() {
  const ref = useRef<HTMLDetailsElement>(null)
  useDismissibleDisclosure(ref)
  return <><details ref={ref} open><summary>More</summary><button type="button">Inside</button></details><button type="button">Outside</button></>
}

it('closes an anchored disclosure on an outside press or Escape and returns focus to its summary', () => {
  const view = render(<Popover />)
  const details = view.container.querySelector('details')!
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Inside' }))
  expect(details.open).toBe(true)
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside' }))
  expect(details.open).toBe(false)
  details.open = true
  fireEvent.keyDown(screen.getByRole('button', { name: 'Inside' }), { key: 'Escape' })
  expect(details.open).toBe(false)
  expect(document.activeElement?.tagName).toBe('SUMMARY')
})

it('publishes the sticky band height on the scroll root and removes it on unmount', () => {
  const resized: ResizeObserverCallback[] = []
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { resized.push(callback) }
    observe() {}
    disconnect() {}
  })
  const view = render(<Harness />)
  const root = view.container.firstElementChild as HTMLElement
  const band = view.container.querySelector('[data-motion-tier="L2"]') as HTMLElement
  band.style.position = 'sticky'
  band.getBoundingClientRect = () => ({ height: 95.2 }) as DOMRect
  act(() => { resized.at(-1)!([], {} as ResizeObserver) })
  expect(root.style.getPropertyValue('--run-band-block')).toBe('96px')
  band.style.position = 'static'
  act(() => { resized.at(-1)!([], {} as ResizeObserver) })
  expect(root.style.getPropertyValue('--run-band-block')).toBe('0px')
  view.unmount()
  expect(root.style.getPropertyValue('--run-band-block')).toBe('')
})
