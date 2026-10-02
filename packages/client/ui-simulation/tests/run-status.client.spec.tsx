// @vitest-environment jsdom
/** Operational labels distinguish native charges, physical admission and unavailable observations. */
import { afterEach, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { RunOverview } from '../src/client/RunOverview.tsx'
import { RunStatus } from '../src/client/RunStatus.tsx'
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

it.each([en, zh])('shows exact ticks, actual charges and real shared-pool work without calling them known consumption', (locale) => {
  const t = (key: Key) => locale[key]
  const view = render(<><RunStatus value={run} connected stale={false} header t={t} />
    <RunOverview value={run} pool={{ status: 'observed', clock: 'real', observedAt: 2, active: 1, queued: 2, limit: 4,
      queueLimit: 8 }} t={t} /></>)
  expect(view.getByText('9007199254740993 minute')).toBeDefined()
  expect(view.getByText(locale['metrics.tokens']).nextElementSibling?.textContent).toBe('55 / 100')
  expect(view.getByText(locale['metrics.resident']).nextElementSibling?.textContent).toBe('2 / 3')
  expect(view.getByText(locale['metrics.poolActive']).nextElementSibling?.textContent).toBe('1 / 4')
  expect(view.getByText(locale['metrics.poolQueued']).nextElementSibling?.textContent).toBe('2 / 8')
  expect(view.getByText(locale['metrics.chargedNotice'])).toBeDefined()
  expect(view.getByText(locale['status.scenario']).nextElementSibling?.textContent).toBe(locale.unavailable)
})

it('reports missing metrics and scenario versions as unavailable instead of inventing zero or a template from the name', () => {
  const t = (key: Key) => en[key]
  const old = { ...run, world: run.world === undefined ? undefined : { ...run.world, metrics: undefined } }
  const view = render(<><RunStatus value={old} connected stale={false} t={t} /><RunOverview value={old} t={t} /></>)
  expect(view.getByText(en['metrics.tokens']).nextElementSibling?.textContent).toBe(en.unavailable)
  expect(view.getByText(en['metrics.pendingDecisions']).nextElementSibling?.textContent).toBe(en.unavailable)
  expect(view.getByText(en['metrics.poolActive']).nextElementSibling?.textContent).toBe(en.unavailable)
  expect(view.getByText(en['status.scenario']).nextElementSibling?.textContent).toBe(en.unavailable)
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
