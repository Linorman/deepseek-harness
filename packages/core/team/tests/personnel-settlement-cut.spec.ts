/** Personnel cuts extend only the closed runtime maintenance scope, with an exact complete cursor vector. */
import { expect, it } from 'vitest'
import { simulationPersonnelSettlementCutScopeSchema, teamSystemMaintenanceScopeSchema } from '../src/index.ts'

const scope = { kind: 'simulation-personnel-cut', teamId: 'team', runId: 'run', lifecycleOwner: 'simulation/owner',
  personnelIntentId: 'intent', expectedTeamCursor: 3, channels: [{ channelId: 'a', cursor: 2 }, { channelId: 'b', cursor: 5 }] }

it('accepts one exact personnel scope through the shared closed maintenance parser', () => {
  expect(teamSystemMaintenanceScopeSchema.parse(scope)).toEqual(scope)
  expect(simulationPersonnelSettlementCutScopeSchema.parse({ ...scope, channels: [] }).channels).toEqual([])
})

it.each([
  { ...scope, kind: 'personnel-anything' }, { ...scope, teamId: '' }, { ...scope, runId: '' },
  { ...scope, lifecycleOwner: ' simulation/owner' }, { ...scope, personnelIntentId: '' },
  { ...scope, expectedTeamCursor: -1 }, { ...scope, expectedTeamCursor: 1.5 },
  { ...scope, channels: [{ channelId: 'a', cursor: -1 }] },
  { ...scope, channels: [{ channelId: 'a', cursor: 1 }, { channelId: 'a', cursor: 1 }] },
  { ...scope, channels: [{ channelId: 'a', cursor: 1, actor: 'spoof' }] },
  { ...scope, callbackAuthority: 'arbitrary' },
])('rejects unknown authority and malformed or duplicate source identities %#', (input) => {
  expect(() => teamSystemMaintenanceScopeSchema.parse(input)).toThrow()
})
