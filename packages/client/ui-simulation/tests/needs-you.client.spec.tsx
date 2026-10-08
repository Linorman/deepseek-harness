// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { NeedsYou } from '../src/client/NeedsYou.tsx'
import { en, zh } from '../src/client/locales.ts'
import type { Key } from '../src/client/locales.ts'

afterEach(cleanup)

const translate = (locale: typeof en) => (key: Key, vars?: Record<string, unknown>) =>
  locale[key].replace(/\{(\w+)\}/g, (_match, name: string) => String(vars?.[name]))

it.each([en, zh])('lists only pending items, totals them, and opens the surface that resolves each', (locale) => {
  const reviews = vi.fn(), unknown = vi.fn(), requests = vi.fn()
  const view = render(<NeedsYou t={translate(locale)} items={[
    { id: 'reviews', count: 2, open: reviews }, { id: 'unknown', count: 0, open: unknown }, { id: 'requests', count: 1, open: requests },
  ]} />)
  const strip = view.getByRole('region', { name: locale['needsYou.title'] })
  expect(strip.hasAttribute('data-pending')).toBe(true)
  expect(strip.querySelector('h2')?.textContent).toContain('3')
  expect(view.queryByRole('button', { name: translate(locale)('needsYou.unknown', { count: 0 }) })).toBeNull()
  fireEvent.click(view.getByRole('button', { name: translate(locale)('needsYou.reviews', { count: 2 }) }))
  fireEvent.click(view.getByRole('button', { name: translate(locale)('needsYou.requests', { count: 1 }) }))
  expect([reviews.mock.calls.length, requests.mock.calls.length, unknown.mock.calls.length]).toEqual([1, 1, 0])
})

it('stays one quiet line when nothing is pending', () => {
  const view = render(<NeedsYou t={translate(en)} items={[{ id: 'reviews', count: 0, open: vi.fn() }]} />)
  const strip = view.getByRole('region', { name: en['needsYou.title'] })
  expect(strip.hasAttribute('data-pending')).toBe(false)
  expect(strip.textContent).toContain(en['needsYou.none'])
  expect(view.queryByRole('button')).toBeNull()
})
