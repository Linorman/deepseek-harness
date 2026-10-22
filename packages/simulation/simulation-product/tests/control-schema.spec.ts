/** Public World stops are observations, independent of scheduling permission and execution mode. */
import { expect, expectTypeOf, it } from 'vitest'
import { simulationProductControlSchema, simulationProductOperationalStatusSchema,
  simulationProductScenarioVersionSchema } from '../src/control-schema.ts'
import type { SimulationProductControl } from '../src/control-types.ts'

const stops = ['idle', 'maintenance-blocked', 'position-capacity', 'authority-missing', 'plan-stale', 'plan-budget',
  'entity-capacity', 'identity-capacity', 'channel-capacity', 'world-byte-limit', 'world-request-limit', 'world-command-limit',
  'world-birth-limit', 'world-expansion-limit', 'world-mutation-limit', 'budget-limit', 'context-limit', 'microstep-limit', 'model-pool-capacity', 'activation-history-limit', 'message-byte-limit'] as const
const ready = { allowed: true, reason: 'ready' }
const scenario = { status: 'observed', templateId: { text: 'world-company', truncated: false },
  version: '1', driverVersion: '1', execution: 'cognition-only' }
const control = { runId: 'world-run', administration: { actions: { checkpoint: ready, restore: ready, prepare: ready, ingress: ready },
  ingress: { maxTime: '1000', maxBytes: 65536, targets: [] } },
budget: { model: { provider: 'scripted', name: 'world' }, tokensPerRequest: 10000, tokensPerInterval: 1000000,
  interval: '100', residentActors: 2, sharedModelLimit: 1 }, owner: 'held', phase: 'paused', revision: 1,
driver: 'waiting', inFlight: false, observedAt: 1, actions: { start: { allowed: false, reason: 'scenario-blocked' }, pause: ready } }
const operational = { status: 'observed', observedAt: 1, scenario, owner: 'held', driver: 'waiting', inFlight: false }

it.each(stops)('preserves the exact %s World stop in control and independent operational metadata', (stop) => {
  expectTypeOf(stop).toExtend<SimulationProductControl['stop']>()
  expect(simulationProductControlSchema.parse({ ...control, stop }).stop).toBe(stop)
  expect(simulationProductOperationalStatusSchema.parse({ ...operational, stop })).toEqual({ ...operational, stop })
})

it.each(stops)('does not promote the %s observation to a new start-action reason', (stop) => {
  const parsed = simulationProductControlSchema.safeParse({ ...control, stop,
    actions: { ...control.actions, start: { allowed: false, reason: stop } } })
  expect(parsed.success).toBe(false)
  if (!parsed.success) expect(parsed.error.issues).toContainEqual(expect.objectContaining({ path: ['actions', 'start', 'reason'] }))
})

it.each(['unknown-world-stop', 'position-full', 'hire-required', 'world-director', '', 0])(
  'rejects unrecognized stop %j in both public observations without a fallback', (stop) => {
    for (const result of [simulationProductControlSchema.safeParse({ ...control, stop }),
      simulationProductOperationalStatusSchema.safeParse({ ...operational, stop })]) {
      expect(result.success).toBe(false)
      if (!result.success) expect(result.error.issues).toContainEqual(expect.objectContaining({ path: ['stop'] }))
    }
  })

it('retains existing start reasons and original scenario labels without adding a World execution mode', () => {
  for (const reason of ['ready', 'scenario-blocked', 'recovery-required', 'outcome-unknown']) {
    expect(simulationProductControlSchema.parse({ ...control, stop: 'authority-missing',
      actions: { ...control.actions, start: { allowed: reason === 'ready', reason } } }).actions.start.reason).toBe(reason)
  }
  expect(simulationProductScenarioVersionSchema.parse(scenario)).toEqual(scenario)
  for (const execution of ['cognition-only', 'automatic-tasks']) {
    expect(simulationProductScenarioVersionSchema.parse({ ...scenario, execution })).toEqual({ ...scenario, execution })
  }
  for (const execution of ['world-director', 'world', 'automatic-world']) {
    const parsed = simulationProductScenarioVersionSchema.safeParse({ ...scenario, execution })
    expect(parsed.success).toBe(false)
    if (!parsed.success) expect(parsed.error.issues).toContainEqual(expect.objectContaining({ path: ['execution'] }))
  }
})
