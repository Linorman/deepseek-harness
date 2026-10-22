import { expect, it } from 'vitest'
import { sampleEnvironment, environmentStateSchema, environmentRequestSchema, simTimeSchema, personExperienceSchema, WORLD_ENVIRONMENT_DEFINITION, WORLD_EXPERIENCE_DEFINITION, WORLD_REPRESENTATION_DEFINITION } from '@clocky/clocky-simulation'
import { runEnvironmentFlow } from './world-environment-flow.ts'

const initial = { model: 'supply-fixed/1', generation: 1, inventory: 10, committed: 4,
  capacity: 20, sourceLimit: 3, sinkLimit: 5, step: 1, lastTime: null }
const input = environmentRequestSchema.parse({ scopeEntityId: 'fee-org', targetEntityId: 'supply', demand: 8 })
it('bounds source and sink, preserves obligations, and requires elapsed steps', () => {
  const state = environmentStateSchema.parse(initial)
  const sample = sampleEnvironment(state, input, simTimeSchema.parse('1'))
  expect(sample).toMatchObject({ production: 3, consumed: 5, inventory: 8, simulated: true })
  expect(() => sampleEnvironment({ ...state, lastTime: simTimeSchema.parse('1') }, input, simTimeSchema.parse('1'))).toThrow(/elapsed/)
  expect(sampleEnvironment({ ...state, model: 'supply-seasonal/1' }, input, simTimeSchema.parse('1')).production).toBe(1)
  expect(() => environmentStateSchema.parse({ ...initial, committed: 11 })).toThrow()
  expect(() => personExperienceSchema.parse({ ...input, personId: 'buyer', field: 'skill', key: 'x', previous: 0,
    next: 6, sourceIntentId: 'x', effectiveAt: '1', validUntil: '2' })).toThrow()
})
it.each([['json', 'supply-fixed/1'], ['sqlite', 'supply-fixed/1'], ['json', 'supply-seasonal/1'], ['sqlite', 'supply-seasonal/1']] as const)('commits and restores %s %s through original registries', async (backend, model) => {
  expect(await runEnvironmentFlow(backend, model)).toMatchObject({ restored: true, originalPersonUnchanged: true,
    originalContextUnchanged: true })
}, 60000)

it('non-committed domain outcomes accept only an empty body and never accept an empty mutation', () => {
  for (const definition of [WORLD_ENVIRONMENT_DEFINITION, WORLD_EXPERIENCE_DEFINITION, WORLD_REPRESENTATION_DEFINITION]) {
    expect(definition.schemas.result.parse({})).toEqual({})
    expect(definition.schemas.mutation.safeParse({}).success).toBe(false)
    expect(definition.schemas.result.safeParse({ injected: true }).success).toBe(false)
  }
})
