// @vitest-environment jsdom
/** World preflight shows each deployment-fit dimension, keeps unknowns explicit and announces context-window violations. */
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { makeTranslate } from '../../../test-support/client-runtime/src/translate.ts'
import { en, zh } from '../src/client/locales.ts'
import { PreflightCapabilities } from '../src/client/WorldPreview.tsx'
import type { ReadyPreview } from '../src/client/WorldPreview.tsx'

afterEach(cleanup)
const t = makeTranslate(en) as never
const capabilities = { backup: 'external-state-required', tokensPerRequest: 200000, initialContext: 'unknown', longRunUsage: 'unknown',
  clocks: { native: { unit: 'minute', maxTime: '600' }, domains: [{ domain: 'payroll', name: 'pay-period' }] },
  models: [{ provider: 'small', name: 'mini', contextWindow: 128000, maxOutputTokens: 8192 },
    { provider: 'private', name: 'opaque', contextWindow: null, maxOutputTokens: null }],
  violations: [{ dimension: 'context-window', model: 'small/mini', actual: 128000, required: 200000 }] } as const
// Only `capabilities` is read by this component; the rest of the preview is owned by the preview panel tests.
const preview = (value: unknown) => ({ capabilities: value }) as unknown as ReadyPreview

it('renders backup, clocks, allowance and per-model capacity, and alerts on a context window smaller than one request', () => {
  const ui = render(<PreflightCapabilities value={preview(capabilities)} t={t} />)
  const alert = ui.getByRole('alert')
  expect(alert.textContent).toBe(en['world.fit.violation.context-window'].replace('{model}', 'small/mini')
    .replace('{actual}', '128,000').replace('{required}', '200,000'))
  expect(ui.container.querySelector('[data-backup="external-state-required"]')?.textContent).toBe(en['world.fit.backup.external-state-required'])
  expect(ui.getByText('payroll/pay-period')).toBeDefined()
  expect(ui.getByText('200,000')).toBeDefined()
  expect(ui.getByText(/context 128,000 tokens · output cap 8,192/)).toBeDefined()
  expect(ui.getByText(en['world.fit.contextUnknown'])).toBeDefined()
  expect(ui.getByText(en['world.fit.initialContext.unknown'])).toBeDefined()
  expect(ui.getByText(en['world.fit.longRun.unknown'])).toBeDefined()
})

it('omits the alert when every disclosed window fits and states when the Host reports no fit at all', () => {
  const fits = render(<PreflightCapabilities value={preview({ ...capabilities, backup: 'complete', violations: [] })} t={makeTranslate(zh) as never} />)
  expect(fits.queryByRole('alert')).toBeNull()
  expect(fits.container.querySelector('[data-backup="complete"]')?.textContent).toBe(zh['world.fit.backup.complete'])
  cleanup()
  const missing = render(<PreflightCapabilities value={preview(undefined)} t={t} />)
  expect(missing.container.querySelector('[data-preflight-capabilities="unavailable"]')?.textContent).toBe(en['world.fit.unavailable'])
})
