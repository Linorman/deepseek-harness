// @vitest-environment jsdom
/** Operational labels distinguish native charges, physical admission and unavailable observations. */
import { afterEach, expect, it } from 'vitest'
import { cleanup, render, within } from '@testing-library/react'
import { RunOverview } from '../src/client/RunOverview.tsx'
import { driverStatus, factLabels, phaseStatus } from '../src/client/RunStatus.tsx'
import { RunDetails } from '../src/client/RunDetails.tsx'
import { RunStateChip, tickUnitLabel } from '../src/client/RunStateChip.tsx'
import { RunStateBanner } from '../src/client/RunStateBanner.tsx'
import { runState } from '../src/client/run-state.ts'
import { en, zh } from '../src/client/locales.ts'
import type { Key } from '../src/client/locales.ts'
import type { SimulationProductRunInspection, SimulationProductRunStatus, SimulationProductControl } from '@clocky/clocky-client-runtime/client'

import { emptyTokenAttribution } from './simulation-fixtures.client.ts'

afterEach(cleanup)

const translate = (locale: Record<Key, string>) => (key: Key, vars?: Record<string, unknown>) =>
  locale[key].replace(/\{(\w+)\}/g, (_match, name: string) => String(vars?.[name]))
/** Render the header's state layer: chip, banner and diagnostics, all from one synthesis. */
function header(value: SimulationProductRunStatus | undefined, control: SimulationProductControl | undefined,
  locale: Record<Key, string> = en, options: { connected?: boolean; controlFailed?: boolean } = {}) {
  const t = translate(locale), connected = options.connected ?? true
  const state = runState({ native: value, control, nativeFailed: false, controlFailed: options.controlFailed, connected,
    now: 2, refreshMs: 2000, staleAfterMs: 30000 })
  return render(<><RunStateChip state={state} locale="en-US" t={t} /><RunStateBanner state={state} t={t} />
    <RunDetails value={value} control={control} connected={connected} header locale="en-US" t={t} /></>)
}

it.each([en, zh].flatMap(locale => ['idle', 'maintenance-blocked', 'position-capacity', 'authority-missing',
  'approval-required', 'existing-obligations', 'plan-stale', 'plan-budget',
  'resource-capacity', 'resource-history-limit', 'resource-reservation-expired',
  'entity-capacity', 'identity-capacity', 'channel-capacity', 'world-byte-limit', 'world-request-limit', 'world-command-limit',
  'world-birth-limit', 'world-expansion-limit', 'world-mutation-limit',
  'budget-limit', 'context-limit', 'microstep-limit', 'model-pool-capacity', 'activation-history-limit', 'message-byte-limit',
  'resident-capacity', 'residency-recovery-required', 'recovery-required', 'outcome-unknown']
  .map(stop => ({ locale, stop }))))('renders an explicit localized World stop without presenting employment as delivery', ({ locale, stop }) => {
  const control = { runId: run.run.id, phase: 'paused', driver: 'waiting', inFlight: false, stop, observedAt: 2,
    actions: { start: { reason: 'ready' } }, administration: { actions: { checkpoint: { reason: 'ready' } } } } as SimulationProductControl
  const view = header(run, control, locale)
  expect(view.getAllByText(locale[`status.stop.${stop}` as Key]).length).toBeGreaterThan(0)
  expect(view.container.textContent).not.toContain('status.stop.')
  expect(view.getByText(locale.paused)).toBeDefined()
})
const run: SimulationProductRunInspection = { run: { id: 'run' as never, name: { text: 'Recorded', truncated: false },
  registeredAt: 1, observation: 'not-observed' }, status: 'observed', world: { revision: 2, phase: 'paused',
  time: '9007199254740993' as never, tickUnit: { text: 'minute', truncated: false }, owner: 'this-provider',
  entityCount: 2, decisionCount: 4, operationCount: 8, observedAt: 2,
  rulesVersion: { text: 'rules-v1', truncated: false }, policyVersion: { text: 'policy-v1', truncated: false },
  metrics: { tokenAttribution: emptyTokenAttribution(), budgets: { interval: '9007199254740993' as never, width: '100' as never,
    tokens: { charged: 55, limit: 100, unknownAttempts: 1 }, decisions: { used: 2, limit: 8 }, messages: { used: 3, limit: 16 } },
  residentSlots: { used: 2, limit: 3, recoveryRequired: 1 }, pendingDecisionCount: 3, pendingExternalOperationCount: 4,
  unknownOperationCount: 2 } } }

it('draws a zero-token interval without division and caps a large resident pool without hiding its remainder', () => {
  const world = run.world
  if (world?.metrics === undefined) throw new Error('The observed fixture has no metrics')
  const metrics = world.metrics
  const value = { ...run, world: { ...world, metrics: { ...metrics,
    budgets: { ...metrics.budgets, tokens: { charged: 0, limit: 0, unknownAttempts: 0 } },
    residentSlots: { used: 29, limit: 100, recoveryRequired: 0 } } } }
  const ui = render(<RunOverview value={value} t={key => en[key]} />)
  expect(ui.getByRole('meter').getAttribute('aria-valuetext')).toBe('0 / 0')
  expect(ui.getByRole('meter').firstElementChild?.getAttribute('style')).toContain('--budget-share: 0')
  expect(ui.getByRole('img', { name: en['seat.summary'] })
    .querySelectorAll('[data-seat]')).toHaveLength(64)
  expect(ui.getByText('+36')).toBeDefined()
})

it('keeps an unobserved run unavailable rather than synthesizing world progress', () => {
  const ui = render(<RunOverview value={{ run: run.run, status: 'missing' }} t={key => en[key]} />)
  expect(ui.queryByRole('meter')).toBeNull()
  expect(ui.getByText(en.entityCount).nextElementSibling?.textContent).toBe(en.unavailable)
})

it.each([en, zh])('shows exact ticks, actual charges and real shared-pool work without calling them known consumption', (locale) => {
  const t = translate(locale)
  const state = runState({ native: run, nativeFailed: false, connected: true, now: 2, refreshMs: 2000, staleAfterMs: 30000 })
  const view = render(<><RunStateChip state={state} locale="en-US" t={t} />
    <RunDetails value={run} connected header locale="en-US" t={t} />
    <RunOverview value={run} pool={{ status: 'observed', clock: 'real', observedAt: 2, active: 1, queued: 2, limit: 4,
      queueLimit: 8 }} t={t} /></>)
  // Exact ticks: grouped for reading, never converted through Number, exact in the tooltip; the unit is localized.
  const clock = view.getByRole('img', { name: `${locale.time} 9,007,199,254,740,993 ${locale['unit.minute']}` })
  expect(clock.getAttribute('title')).toBe('9007199254740993 minute')
  expect(view.getByText(locale['metrics.tokens']).nextElementSibling?.textContent).toBe('55 / 100')
  expect(view.getByText(locale['metrics.resident']).nextElementSibling?.textContent).toBe('2 / 3')
  expect(view.getByText(locale['metrics.poolActive']).nextElementSibling?.textContent).toBe('1 / 4')
  expect(view.getByText(locale['metrics.poolQueued']).nextElementSibling?.textContent).toBe('2 / 8')
  expect(view.getByText(locale['metrics.chargedNotice'])).toBeDefined()
  // The Host pool is its own Host-wide chip, separate from this run's simulated-time budget.
  const chip = view.container.querySelector('[data-host-pool="observed"]')
  expect(chip?.textContent).toBe(`${locale['metrics.hostScope']}${t('metrics.poolChip', { active: 1, limit: 4, queued: 2 })}`)
  expect(chip?.getAttribute('title')).toBe(locale['metrics.poolNotice'])
  expect(view.getByText(locale['status.scenario']).nextElementSibling?.querySelector('[data-fact="unavailable"]')).not.toBeNull()
})

it('reports missing metrics and scenario versions as unavailable instead of inventing zero or a template from the name', () => {
  const t = (key: Key) => en[key]
  const old = { ...run, world: run.world === undefined ? undefined : { ...run.world, metrics: undefined } }
  const view = render(<><RunDetails value={old} connected locale="en-US" t={t} /><RunOverview value={old} t={t} /></>)
  expect(view.container.querySelector('[data-host-pool="unavailable"]')?.textContent).toContain(en['metrics.poolChipUnavailable'])
  expect(view.getByText(en['metrics.tokens']).nextElementSibling?.textContent).toBe(en.unavailable)
  expect(view.getByText(en['metrics.pendingDecisions']).nextElementSibling?.textContent).toBe(en.unavailable)
  // Unobserved facts render as the unavailable state with a reason, never as zero.
  for (const label of [en['metrics.poolActive'], en['status.scenario']]) {
    const fact = view.getByText(label).nextElementSibling?.querySelector('[data-fact="unavailable"]')
    expect(fact?.textContent).toBe(`—${en.unavailable}：${en['status.notObserved']}`)
    expect(fact?.textContent).not.toMatch(/\d/)
  }
})

it('keeps scheduling pause, connection loss and still accepted work as independent header facts', () => {
  const control = { runId: run.run.id, phase: 'paused', driver: 'advancing', inFlight: true, stop: 'paused', observedAt: 2,
    actions: { start: { reason: 'recovery-required' } }, administration: { actions: { checkpoint: { reason: 'ready' } } },
    versions: { rulesVersion: run.world!.rulesVersion,
      policyVersion: run.world!.policyVersion, scenario: { status: 'observed', templateId: { text: 'company', truncated: false },
        version: '1', driverVersion: '1', execution: 'cognition-only' } } } as SimulationProductControl
  const view = header(run, control, en, { connected: false })
  // A lost connection never presents the last observation as current.
  const chip = view.container.querySelector('[data-run-state]')!
  expect(chip.getAttribute('data-freshness')).toBe('stale')
  expect(within(chip as HTMLElement).getByText(en['state.currentUnknown'])).toBeDefined()
  expect(view.getByText(en['state.banner.stale'])).toBeDefined()
  const details = within(view.container.querySelector('details[data-run-details]')!)
  expect(details.getByText(en['status.disconnected'])).toBeDefined()
  expect(details.getByText(en['status.workRemaining'])).toBeDefined()
  expect(details.getByText(en['controlReason.recovery-required'])).toBeDefined()
  expect(details.getByText(en['status.scenario']).nextElementSibling?.textContent).toContain('company · 1')
})

it.each([
  ['running', 'waiting'], ['stalled', 'blocked'], ['completed', 'done'], ['failed', 'failed'], ['idle', 'idle'],
] as const)('maps the saved %s phase without claiming active scheduling', (phase, status) => {
  expect(phaseStatus(phase)).toBe(status)
})

it.each([
  ['scheduled', 'running'], ['advancing', 'running'], ['checkpointing', 'running'],
  ['waiting', 'waiting'], ['retiring', 'waiting'], ['completed', 'done'],
  ['failed', 'failed'], ['idle', 'idle'],
] as const)('maps an observed %s driver to its exact agent state', (driver, status) => {
  expect(driverStatus(driver)).toBe(status)
})

it('separates unavailable world observations from operational-only observations', () => {
  const t = translate(en)
  expect(factLabels(t)).toEqual({ unavailable: en.unavailable, unknown: en.unavailable, stale: en['status.staleShort'],
    withheld: en.unavailable, truncated: en.truncate, expand: en['status.expand'] })
  const unavailable = { run: run.run, status: 'unavailable' as const, reason: 'history-limit' as const,
    errorSummary: { text: 'inspection refused', truncated: false } }
  const refused = header(unavailable, undefined)
  // The safe localized reason leads; the original English message stays in the details.
  expect(refused.getAllByText(en['state.unavailable.history-limit']).length).toBeGreaterThan(0)
  expect(refused.getByText(en['details.originalError']).nextElementSibling?.textContent).toBe('inspection refused')
  expect(refused.getByText(en['status.scenario']).nextElementSibling?.textContent).toContain(en['state.unavailable.history-limit'])
  refused.unmount()
  const operational: SimulationProductRunInspection = { ...run, world: undefined,
    operational: { status: 'observed', observedAt: 2, scenario: { status: 'unavailable' }, owner: 'held',
      stop: 'paused' as never, driver: 'retiring', inFlight: true } }
  const observed = header(operational, undefined)
  expect(observed.getAllByText(en['status.workRemaining']).length).toBeGreaterThan(0)
  expect(observed.getAllByText(en['driver.retiring']).length).toBeGreaterThan(0)
  expect(observed.getAllByText(en['status.stop.paused']).length).toBeGreaterThan(0)
  expect(observed.getAllByText(`Unavailable：${en['status.notObserved']}`).length).toBeGreaterThan(0)
  observed.unmount()
  const withoutStop: SimulationProductRunInspection = { ...operational,
    operational: { status: 'observed', observedAt: 2, scenario: { status: 'unavailable' }, owner: 'held',
      stop: undefined, driver: 'retiring', inFlight: true } }
  const withoutRecordedStop = render(<RunDetails value={withoutStop} connected locale="en-US" t={t} />)
  expect(withoutRecordedStop.getByText(en['status.noStop'])).toBeDefined()
  withoutRecordedStop.unmount()
  const missing = header({ run: run.run, status: 'missing' }, undefined)
  expect(missing.getByText(en['state.detail.missing'])).toBeDefined()
  missing.unmount()
  const native = { ...run, world: { ...run.world!, schedulerStop: { code: 'STOP', recovery: 'RESUME' } } }
  const recovery = render(<RunDetails value={native} connected locale="en-US" t={t} />)
  expect(recovery.getByText('STOP')).toBeDefined()
  expect(recovery.getByText('RESUME')).toBeDefined()
})

it('never shows a persisted running phase as active scheduling without an observed working driver', () => {
  const control = { runId: run.run.id, phase: 'running', driver: 'idle', inFlight: false, observedAt: 2,
    actions: { start: {} }, administration: { actions: { checkpoint: { reason: 'ready' } } } } as unknown as SimulationProductControl
  const native = { ...run, world: { ...run.world!, phase: 'running' as const } }
  const view = header(native, control)
  // Running requested with an idle driver says so in words; only an observed working driver is "running".
  expect(view.container.querySelector('[data-run-state]')?.getAttribute('data-run-state')).toBe('idle')
  expect(view.getByText(en['state.idle'])).toBeDefined()
  expect(view.getByText(en['state.detail.idle'])).toBeDefined()
  view.unmount()
  const working = header(native, { ...control, driver: 'advancing' })
  expect(working.container.querySelector('[data-run-state]')?.getAttribute('data-run-state')).toBe('running')
  expect(working.container.querySelector('[data-status="running"]')).not.toBeNull()
})

it('shows a stale observation as a quiet status rather than an error', () => {
  const view = header(run, undefined, en, { connected: false })
  const notice = view.getByText(en['state.currentUnknown']).closest('[role="status"]')
  expect(notice?.getAttribute('data-freshness')).toBe('stale')
  expect(view.queryByRole('alert')).toBeNull()
})

it.each([en, zh])('explains a settled idle driver using its recorded stop rather than claiming it never worked', (locale) => {
  const control = { runId: run.run.id, phase: 'running', driver: 'idle', inFlight: false, stop: 'idle', observedAt: 2,
    actions: { start: {} }, administration: { actions: { checkpoint: { reason: 'ready' } } } } as unknown as SimulationProductControl
  const view = header({ ...run, world: { ...run.world!, phase: 'running' } }, control, locale)
  expect(view.getByText(locale['state.detail.idle'])).toBeDefined()
  expect(within(view.container.querySelector('details[data-run-details]')!).getByText(locale['status.stop.idle'])).toBeDefined()
  expect(view.queryByText(locale['status.driverNotObserved'])).toBeNull()
})

it.each([en, zh])('surfaces exhausted planning as blocked without claiming that the persisted running phase is advancing', (locale) => {
  const value = { ...run, world: { ...run.world!, phase: 'running' as const }, operational: { status: 'observed' as const, observedAt: 2,
    scenario: { status: 'unavailable' as const }, owner: 'held' as const, driver: 'waiting' as const, inFlight: false, stop: 'plan-budget' as const } }
  const view = header(value, undefined, locale)
  expect(view.container.querySelector('[data-run-state]')?.getAttribute('data-run-state')).toBe('blocked')
  expect(view.getAllByText(locale['status.stop.plan-budget']).length).toBeGreaterThan(0)
  expect(view.container.querySelector('[data-status="running"]')).toBeNull()
})

it('draws the interval budget as a meter and resident slots as dots without inventing missing metrics', () => {
  const view = render(<RunOverview value={run} t={key => en[key]} />)
  const meter = view.getByRole('meter', { name: en['metrics.tokens'] })
  expect(meter.getAttribute('aria-valuenow')).toBe('55')
  expect(meter.getAttribute('aria-valuemax')).toBe('100')
  expect(view.getByText(`${en['metrics.unknownModel']} 1`)).toBeDefined()
  const slots = view.getByRole('img', { name: en['seat.summary'] })
  expect([...slots.querySelectorAll('[data-seat]')].map(seat => seat.getAttribute('data-seat'))).toEqual(['active', 'awaiting', 'free'])
  const old = { ...run, world: run.world === undefined ? undefined : { ...run.world, metrics: undefined } }
  view.rerender(<RunOverview value={old} t={key => en[key]} />)
  expect(view.queryByRole('meter')).toBeNull()
})

it('keeps a calm paused run to its state and time and states everything else in the run details', () => {
  const control = { runId: run.run.id, phase: 'paused', driver: 'idle', inFlight: false, observedAt: 2,
    actions: { start: { allowed: true, reason: 'ready' } }, administration: { actions: { checkpoint: { reason: 'ready' } } } } as SimulationProductControl
  const view = header(run, control)
  const chip = view.container.querySelector('[data-run-state]')!
  expect(chip.getAttribute('data-run-state')).toBe('paused')
  expect(chip.textContent).toContain(en['state.paused'])
  expect(chip.querySelector('[data-clock="simulated"]')).not.toBeNull()
  const details = within(view.container.querySelector('details[data-run-details]')!)
  expect(details.getByText(en['status.noWorkRemaining'])).toBeDefined()
  expect(details.getByText(en['status.connected'])).toBeDefined()
  expect(details.getByText(en['driver.idle'])).toBeDefined()
  expect(details.getByText(en['details.nativeSource'])).toBeDefined()
  expect(details.getByText(en['details.controlSource'])).toBeDefined()
  expect(view.container.querySelector('details[data-run-details] > summary')?.textContent).toBe(en['status.details'])
})

it.each([['day', '天'], ['Days', '天'], ['minute', '分钟'], ['harbor-day', 'harbor-day']])('localizes the %s tick unit', (unit, label) => {
  expect(tickUnitLabel(unit, key => zh[key])).toBe(label)
})

it('names the driver source, an unavailable read without a reason, and work still settling in the banner', () => {
  const t = translate(en)
  const unavailable = { run: run.run, status: 'unavailable', errorSummary: { text: 'native read failed', truncated: false } } as SimulationProductRunStatus
  const control = { runId: run.run.id, phase: 'paused', driver: 'advancing', inFlight: true, observedAt: 2,
    driverSource: { status: 'live', observedAt: 2 },
    actions: { start: { reason: 'ready' } }, administration: { actions: { checkpoint: { reason: 'ready' } } } } as SimulationProductControl
  const view = header(unavailable, control)
  expect(view.getByText(new RegExp(en['details.live']))).toBeDefined()
  expect(view.getByText('native read failed')).toBeDefined()
  expect(view.container.querySelector('[data-run-state]')?.getAttribute('data-run-state')).toBe('stopping')
  const banner = view.container.querySelector('div[role="status"][data-run-state]') as HTMLElement
  expect(within(banner).getByText(en['status.workRemaining'])).toBeDefined()
  view.unmount()
  const ownerLost = header(unavailable, { ...control, driverSource: { status: 'owner-unavailable', observedAt: 2 } })
  expect(ownerLost.getByText(new RegExp(en['details.ownerUnavailable']))).toBeDefined()
  ownerLost.unmount()
  const noReason = render(<RunDetails value={unavailable} connected locale="en-US" t={t} />)
  // Unavailable facts carry their reason as an accessible annotation rather than visible prose.
  expect(noReason.container.innerHTML).toContain(en['state.unavailable.unavailable'])
})

it('leads the banner with a stale observation', () => {
  const t = translate(en)
  const state = runState({ native: run, control: undefined, nativeFailed: false, connected: false, now: 2, refreshMs: 2000,
    staleAfterMs: 30000 })
  const ui = render(<RunStateBanner state={state} t={t} />)
  expect(ui.getByRole('status').firstElementChild?.textContent).toBe(en['state.banner.stale'])
})

it('explains a detail-limited view and lists the recorded failure identity in the details', () => {
  const t = translate(en)
  const failure = { failureId: '00000000-0000-4000-8000-0000000000aa', ownerId: '00000000-0000-4000-8000-0000000000bb',
    batchId: '00000000-0000-4000-8000-0000000000cc', occurredAt: 2, revision: 2, category: 'network', retryDisposition: 'explicit-resume',
    actionCode: 'resume-explicitly' }
  const control = { runId: run.run.id, phase: 'running', driver: 'failed', inFlight: false, observedAt: 2, failure,
    actions: { start: { reason: 'driver-failed' } }, administration: { actions: { checkpoint: { reason: 'ready' } } } } as SimulationProductControl
  const state = runState({ native: run, control, nativeFailed: true, connected: true, now: 2, refreshMs: 2000, staleAfterMs: 30000 })
  const ui = render(<><RunStateBanner state={state} t={t} /><RunDetails value={run} control={control} connected locale="en-US" t={t} /></>)
  expect(ui.getByText(en['state.banner.detailLimited'])).toBeDefined()
  expect(ui.getByText(failure.failureId)).toBeDefined()
})
