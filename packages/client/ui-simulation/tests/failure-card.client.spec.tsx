// @vitest-environment jsdom
/** Failures answer which stage failed, whether work still runs, what is kept and the next step, from safe facts only. */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { simulationControlFixture } from './simulation-fixtures.client.ts'
import { FailureCard, failureNextStep, failureStage } from '../src/client/FailureCard.tsx'
import { RunDirectory } from '../src/client/RunDirectory.tsx'
import { runState } from '../src/client/run-state.ts'
import type { RunFailure } from '../src/client/run-state.ts'
import { en, zh } from '../src/client/locales.ts'
import type { Key } from '../src/client/locales.ts'

afterEach(cleanup)
const translate = (locale: Record<Key, string>) => (key: Key, vars?: Record<string, string>) =>
  locale[key].replace(/\{(\w+)\}/g, (_m, name: string) => vars?.[name] ?? '')
const failure = (value: Partial<RunFailure>): RunFailure => ({ failureId: '00000000-0000-4000-8000-0000000000aa',
  ownerId: '00000000-0000-4000-8000-0000000000bb', batchId: '00000000-0000-4000-8000-0000000000cc', occurredAt: 5, revision: 41,
  category: 'unknown', retryDisposition: 'unknown', actionCode: 'inspect-failure', ...value })
const state = (value: RunFailure, inFlight = false) => runState({ control: simulationControlFixture({ phase: 'running',
  driver: 'failed', inFlight, failure: value, actions: { start: { allowed: false, reason: 'driver-failed' },
    pause: { allowed: true, reason: 'ready' } } }),
nativeFailed: false, connected: true, now: 1, refreshMs: 2000, staleAfterMs: 30000 })

it.each([
  ['HTTP 402', failure({ category: 'payment-required', retryDisposition: 'account-action', actionCode: 'check-account' }), 'provider', 'account', false],
  ['HTTP 429', failure({ category: 'rate-limited', retryDisposition: 'explicit-resume', actionCode: 'resume-explicitly', providerRetryAfterMs: 30000 }), 'provider', 'resume', true],
  ['network', failure({ category: 'network', retryDisposition: 'explicit-resume', actionCode: 'resume-explicitly' }), 'provider', 'resume', true],
  ['context', failure({ category: 'context-limit', retryDisposition: 'repair-required', actionCode: 'review-context' }), 'admission', 'context', false],
  ['unknown exception', failure({}), 'unknown', 'details', false],
  ['save failure', failure({ category: 'storage', retryDisposition: 'repair-required', actionCode: 'repair-storage' }), 'history', 'storage', false],
] as const)('%s answers the four questions and offers Continue only when explicitly resumable', (_name, value, stage, next, retry) => {
  for (const locale of [en, zh]) {
    const t = translate(locale), resume = vi.fn(), details = vi.fn()
    expect(failureStage(value.category)).toBe(stage)
    expect(failureNextStep(value)).toBe(next)
    const ui = render(<FailureCard failure={value} state={state(value)} resume={resume} details={details} time={() => '12:00'} t={t} />)
    expect(ui.getByText(locale[`failure.category.${value.category}` as Key], { exact: false })).toBeDefined()
    expect(ui.getByText(locale[`failure.stage.${stage}` as Key])).toBeDefined()
    expect(ui.getByText(locale['failure.executing.no'])).toBeDefined()
    expect(ui.getByText(locale['failure.kept.value'])).toBeDefined()
    expect(ui.getByText(locale[`failure.next.${next}` as Key], { exact: false })).toBeDefined()
    const continueButton = ui.queryByRole('button', { name: locale['failure.resume'] })
    expect(continueButton !== null).toBe(retry)
    if (continueButton !== null) { fireEvent.click(continueButton); expect(resume).toHaveBeenCalledOnce() }
    else expect(ui.getByText(locale['failure.noRetry'])).toBeDefined()
    fireEvent.click(ui.getByRole('button', { name: locale['failure.details'] }))
    expect(details).toHaveBeenCalledOnce()
    ui.unmount()
  }
})

it('states the provider wait and still-running accepted work', () => {
  const value = failure({ category: 'rate-limited', retryDisposition: 'explicit-resume', actionCode: 'resume-explicitly', providerRetryAfterMs: 1500 })
  const ui = render(<FailureCard failure={value} state={state(value, true)} details={() => {}} time={() => '12:00'} t={translate(en)} />)
  expect(ui.getByText(translate(en)('failure.retryAfter', { seconds: '2' }), { exact: false })).toBeDefined()
  expect(ui.getByText(en['failure.executing.yes'])).toBeDefined()
})

it('falls back to details for an action code this client does not know', () => {
  expect(failureNextStep({ actionCode: 'newer-host-action' as never, retryDisposition: 'explicit-resume' })).toBe('details')
  expect(failureNextStep({ actionCode: 'resume-explicitly', retryDisposition: 'unknown' })).toBe('details')
})

it('never renders provider messages, tokens, paths or private bodies smuggled beside the safe fields', () => {
  const smuggled = { ...failure({ category: 'insufficient-balance', retryDisposition: 'account-action', actionCode: 'check-account' }),
    message: 'Bearer sk-live-SECRET', path: '/Users/alice/.clocky/keys.json', body: 'private negotiation body' } as RunFailure
  const ui = render(<FailureCard failure={smuggled} state={state(smuggled)} details={() => {}} time={() => '12:00'} t={translate(en)} />)
  for (const text of ['sk-live-SECRET', '/Users/alice', 'private negotiation body']) expect(ui.container.textContent).not.toContain(text)
})

it('clears an old batch failure once a newer status batch succeeds', () => {
  const run = { id: 'run' as never, name: { text: 'Harbor', truncated: false }, registeredAt: 1, observation: 'not-observed' as const }
  const props = { catalog: { loading: false, stale: false }, create: vi.fn(),
    directory: { loading: false, stale: false, value: { items: [run] } },
    directoryIds: [run.id], connected: true, search: '', draftSearch: '', searchDraft: vi.fn(), navigate: vi.fn(), refresh: vi.fn(),
    readDirectory: vi.fn(async () => {}), runStatuses: vi.fn(async () => {}), t: translate(en), date: String, now: () => 1 }
  const items = [{ run, status: 'missing' as const }]
  const ui = render(<RunDirectory {...props} statuses={{ loading: false, stale: true, error: 'network', value: { items } }} />)
  expect(ui.getByText(en['directory.statusFailed'])).toBeDefined()
  ui.rerender(<RunDirectory {...props} statuses={{ loading: false, stale: false, value: { items } }} />)
  expect(ui.queryByText(en['directory.statusFailed'])).toBeNull()
  expect(ui.queryByRole('alert')).toBeNull()
})

it('maps every category to its stage and every known action code to its next step', () => {
  expect(failureStage('protocol-unavailable')).toBe('protocol')
  for (const category of ['history-limit', 'storage', 'integrity'] as const) expect(failureStage(category)).toBe('history')
  for (const category of ['request-budget', 'token-overrun'] as const) expect(failureStage(category)).toBe('admission')
  // The Host schema closes the category union; anything else is a contract violation.
  expect(() => failureStage('newer-host-category' as never)).toThrow('Unknown failure category')
  for (const [actionCode, next] of [['review-budget', 'budget'], ['repair-protocol', 'protocol'], ['raise-read-limit', 'read-limit'],
    ['inspect-integrity', 'integrity']] as const) {
    expect(failureNextStep({ actionCode, retryDisposition: 'repair-required' })).toBe(next)
  }
})

it('opens history for an integrity failure and copies only the failure identity', async () => {
  const clipboard = vi.fn(async () => {})
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: clipboard } })
  const value = failure({ category: 'integrity', retryDisposition: 'repair-required', actionCode: 'inspect-integrity' })
  const history = vi.fn()
  const ui = render(<FailureCard failure={value} state={state(value)} details={() => {}} history={history} time={() => '12:00'}
    t={translate(en)} />)
  fireEvent.click(ui.getByRole('button', { name: en['failure.openHistory'] }))
  expect(history).toHaveBeenCalledOnce()
  fireEvent.click(ui.getByRole('button', { name: en['failure.copyId'] }))
  await vi.waitFor(() => { expect(clipboard).toHaveBeenCalledWith(value.failureId) })
  ui.rerender(<FailureCard failure={value} state={state(value)} details={() => {}} time={() => '12:00'} t={translate(en)} />)
  expect(ui.queryByRole('button', { name: en['failure.openHistory'] })).toBeNull()
})
