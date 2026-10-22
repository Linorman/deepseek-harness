import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { representationScenario } from './world-representation-scenario.ts'

it.each(['json', 'sqlite'] as const)('preserves original representation identities and history on %s', async (backend) => {
  expect(await representationScenario(backend, resolve('examples/simulation-company/tests/fixtures/world-post-mvp/cordis.yml')))
    .toEqual({ generation: 3, from: 'simulated-rule', to: 'simulated-rule', transitions: 2, memory: 'none',
      originalIdentity: true, originalResources: true, replay: true, beforeSwitchMediatedDenied: true,
      afterSwitchMediatedCommitted: true, reverseRuleCommitted: true, pendingRequestDenied: true, pendingEventDenied: true,
      cancelledFenceReleased: true })
}, 60000)

it.each(['json', 'sqlite'] as const)('retains and reconciles an interrupted representation switch on %s', async (backend) => {
  expect(await representationScenario(backend, resolve('examples/simulation-company/tests/fixtures/world-post-mvp/cordis.yml'), true))
    .toEqual({ generation: 3, from: 'simulated-rule', to: 'simulated-rule', transitions: 2, memory: 'none',
      originalIdentity: true, originalResources: true, replay: true, beforeSwitchMediatedDenied: true,
      afterSwitchMediatedCommitted: true, reverseRuleCommitted: true, pendingRequestDenied: true, pendingEventDenied: true,
      cancelledFenceReleased: true })
}, 60000)
