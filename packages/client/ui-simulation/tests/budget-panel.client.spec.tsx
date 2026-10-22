// @vitest-environment jsdom
/** Limits, reserved, settled and unknown usage stay separate; unknown is never zero and no cost is estimated. */
import { afterEach, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { BudgetPanel } from '../src/client/BudgetPanel.tsx'
import type { TokenAttribution } from '../src/client/BudgetPanel.tsx'
import { en } from '../src/client/locales.ts'
import type { Key } from '../src/client/locales.ts'

afterEach(cleanup)
const t = (key: Key, vars?: Record<string, unknown>) => en[key].replace(/\{(\w+)\}/g, (_m, name: string) => String(vars?.[name]))
const bucket = (input: number, unknown = 0) => ({ attempts: 2 + unknown, statuses: { reserved: 0, unknown, settled: 2, 'not-dispatched': 0 },
  outstandingReservedTokens: unknown * 100, settled: { inputTokens: input, outputTokens: 10, cacheReadTokens: 5, cacheWriteTokens: 0 },
  unknownReported: { inputTokens: unknown * 7, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } })
const attribution = { total: bucket(600, 3), categories: { 'business-choice': bucket(300), adjudication: bucket(100), 'result-closeout': bucket(50),
  communication: bucket(50), compaction: bucket(60), unknown: bucket(40, 3) } } as unknown as TokenAttribution
const budget = { model: { provider: 'p', name: 'm' }, tokensPerRequest: 262144, tokensPerInterval: 100000000, interval: '7' as never,
  residentActors: 4, sharedModelLimit: 8 }

it('breaks usage down by category and token kind and keeps unknown usage out of the known totals', () => {
  const ui = render(<BudgetPanel budget={budget} attribution={attribution} unit="day" t={t} />)
  expect(ui.container.querySelector('[data-budget-group="limits"]')?.textContent).toContain('100,000,000 per 7 day')
  expect(ui.getByText(en['budget.limitsNotice'])).toBeDefined()
  const usage = ui.container.querySelector('[data-budget-group="usage"]')!
  expect(usage.textContent).toContain('300')
  expect(usage.textContent).toContain(t('budget.unknownValue', { attempts: '3', reported: '21' }))
  for (const category of ['business-choice', 'adjudication', 'result-closeout', 'communication', 'compaction', 'unknown', 'total']) {
    expect(ui.container.querySelector(`tr[data-category="${category}"]`)).not.toBeNull()
  }
  expect(ui.container.querySelector('tr[data-category="unknown"] th')?.textContent).toBe(en['budget.category.unknown'])
  // Tokens only: no currency anywhere.
  expect(ui.container.textContent).not.toMatch(/[$¥€]|cost:/i)
  expect(ui.container.querySelector('[data-budget-group="host"]')?.textContent).toContain(t('budget.hostShared', { limit: '8' }))
})

it('says usage is unavailable instead of showing zeros when the Host reports no attribution', () => {
  const ui = render(<BudgetPanel budget={budget} unit="day" t={t} />)
  expect(ui.container.querySelector('[data-budget-usage="unavailable"]')?.textContent).toBe(en['budget.usageUnavailable'])
  expect(ui.container.querySelector('table')).toBeNull()
})

it('marks categories without attempts as absent and adds nothing for cache buckets a provider does not report', () => {
  const sparse = { total: { ...bucket(100), settled: { inputTokens: 100, outputTokens: 10 } },
    categories: { 'business-choice': { ...bucket(100), settled: { inputTokens: 100, outputTokens: 10 } } } } as unknown as TokenAttribution
  const ui = render(<BudgetPanel budget={budget} attribution={sparse} unit="day" t={t} />)
  const row = ui.container.querySelector('tr[data-category="adjudication"]')!
  expect([...row.querySelectorAll('td')].every(cell => cell.textContent === '—')).toBe(true)
  expect(ui.container.querySelector('tr[data-category="business-choice"]')?.textContent).toContain('—')
  expect(ui.container.querySelector('[data-budget-group="usage"]')?.textContent).toContain('110')
})
