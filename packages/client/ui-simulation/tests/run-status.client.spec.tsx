// @vitest-environment jsdom
/** Operational labels distinguish native charges, physical admission and unavailable observations. */
import { afterEach, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { RunOverview } from '../src/client/RunOverview.tsx'
import { RunStatus, driverStatus, factLabels, phaseStatus } from '../src/client/RunStatus.tsx'
import { en, zh } from '../src/client/locales.ts'
import type { Key } from '../src/client/locales.ts'
import type { SimulationProductRunInspection, SimulationProductControl } from '@clocky/clocky-client-runtime/client'

afterEach(cleanup)
const run: SimulationProductRunInspection = { run: { id: 'run' as never, name: { text: 'Recorded', truncated: false },
  registeredAt: 1, observation: 'not-observed' }, status: 'observed', world: { revision: 2, phase: 'paused',
  time: '9007199254740993' as never, tickUnit: { text: 'minute', truncated: false }, owner: 'this-provider',
  entityCount: 2, decisionCount: 4, operationCount: 8, observedAt: 2,
  rulesVersion: { text: 'rules-v1', truncated: false }, policyVersion: { text: 'policy-v1', truncated: false },
  metrics: { budgets: { interval: '9007199254740993' as never, width: '100' as never,
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
  const t = (key: Key, vars?: Record<string, unknown>) => locale[key].replace(/\{(\w+)\}/g, (_match, name: string) => String(vars?.[name]))
  const view = render(<><RunStatus value={run} connected stale={false} header t={t} />
    <RunOverview value={run} pool={{ status: 'observed', clock: 'real', observedAt: 2, active: 1, queued: 2, limit: 4,
      queueLimit: 8 }} t={t} /></>)
  // Exact ticks: grouped for reading, never converted through Number, exact in the tooltip.
  const clock = view.getByRole('img', { name: `${locale.time} 9,007,199,254,740,993 minute` })
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
  const view = render(<><RunStatus value={old} connected stale={false} t={t} /><RunOverview value={old} t={t} /></>)
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
  const control = { runId: run.run.id, phase: 'paused', driver: 'advancing', inFlight: true, stop: 'paused',
    actions: { start: { reason: 'recovery-required' } }, versions: { rulesVersion: run.world!.rulesVersion,
      policyVersion: run.world!.policyVersion, scenario: { status: 'observed', templateId: { text: 'company', truncated: false },
        version: '1', driverVersion: '1', execution: 'cognition-only' } } } as SimulationProductControl
  const view = render(<RunStatus value={run} control={{ value: control, loading: false, stale: true }} connected={false}
    stale header t={key => en[key]} />)
  expect(view.getByText(en.paused)).toBeDefined()
  expect(view.getByText(en['status.disconnected'])).toBeDefined()
  expect(view.getByText(en['status.workRemaining'])).toBeDefined()
  expect(view.getByText(en['controlReason.recovery-required'])).toBeDefined()
  expect(view.getByText(en['status.scenario']).nextElementSibling?.textContent).toContain('company · 1')
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
  const t = (key: Key) => en[key]
  expect(factLabels(t)).toEqual({ unavailable: en.unavailable, unknown: en.unavailable, stale: en['status.staleShort'],
    withheld: en.unavailable, truncated: en.truncate, expand: en['status.expand'] })
  const unavailable = { run: run.run, status: 'unavailable' as const,
    errorSummary: { text: 'inspection refused', truncated: false } }
  const refused = render(<RunStatus value={unavailable} connected stale={false} header t={t} />)
  expect(refused.getByText('inspection refused')).toBeDefined()
  expect(refused.getByText(en['status.scenario']).nextElementSibling?.textContent).toContain('inspection refused')
  const operational: SimulationProductRunInspection = { ...run, world: undefined,
    operational: { status: 'observed', observedAt: 2, scenario: { status: 'unavailable' }, owner: 'held',
      stop: 'paused' as never, driver: 'retiring', inFlight: true } }
  const observed = render(<RunStatus value={operational} connected stale={false} header t={t} />)
  expect(observed.getByText(en['status.workRemaining'])).toBeDefined()
  expect(observed.getByText(en['driver.retiring'])).toBeDefined()
  expect(observed.getByText(en['status.stop.paused'])).toBeDefined()
  expect(observed.getAllByText(`Unavailable：${en['status.notObserved']}`).length).toBeGreaterThan(0)
  const withoutStop: SimulationProductRunInspection = { ...operational,
    operational: { status: 'observed', observedAt: 2, scenario: { status: 'unavailable' }, owner: 'held',
      stop: undefined, driver: 'retiring', inFlight: true } }
  const withoutRecordedStop = render(<RunStatus value={withoutStop} connected stale={false} t={t} />)
  expect(withoutRecordedStop.getByText(en['status.noStop'])).toBeDefined()
  const missing = render(<RunStatus value={{ run: run.run, status: 'missing' }} connected stale={false} t={t} />)
  expect(missing.getByText(en.missing)).toBeDefined()
  const native = { ...run, world: { ...run.world!, schedulerStop: { code: 'STOP', recovery: 'RESUME' } } }
  const recovery = render(<RunStatus value={native} connected stale={false} t={t} />)
  expect(recovery.getByText('STOP')).toBeDefined()
  expect(recovery.getByText('RESUME')).toBeDefined()
})

it('never shows a persisted running phase as active scheduling without an observed working driver', () => {
  const control = { runId: run.run.id, phase: 'running', driver: 'idle', inFlight: false,
    actions: { start: {} } } as unknown as SimulationProductControl
  const view = render(<RunStatus value={run} control={{ value: control, loading: false, stale: false }} connected
    stale={false} header t={key => en[key]} />)
  // The saved phase is a waiting badge, and the driver row says it has not been observed working.
  expect(view.container.querySelector('[data-status="waiting"]')?.textContent).toBe(en.running)
  expect(view.getByText(en['status.driverNotObserved'])).toBeDefined()
  expect(view.container.querySelector('[data-driver-observed]')).toBeNull()
  view.rerender(<RunStatus value={run} control={{ value: { ...control, driver: 'advancing' }, loading: false, stale: false }} connected
    stale={false} header t={key => en[key]} />)
  expect(view.container.querySelector('[data-driver-observed]')).not.toBeNull()
  expect(view.queryByText(en['status.driverNotObserved'])).toBeNull()
})

it('shows a revision change as a neutral notice rather than an error', () => {
  const view = render(<RunStatus value={run} connected stale t={key => en[key]} />)
  const notice = view.getByText(en['status.stale'])
  expect(notice.getAttribute('role')).toBe('status')
  expect(view.queryByRole('alert')).toBeNull()
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
