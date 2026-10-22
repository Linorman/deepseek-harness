/** Portable director budgets are strict source data; admission of the installed capability stays with the Host. */
import { readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import { simulationWorldPreflightParamsSchema, simulationWorldCreateParamsSchema } from '../src/simulation.ts'

const definition: unknown = JSON.parse(await readFile(new URL('./fixtures/world-director-event-definition.json', import.meta.url), 'utf8'))
const original = simulationWorldPreflightParamsSchema.parse({ definition }).definition
if (original.apiVersion !== 'clocky.world/v1') throw new Error('Director event fixture requires v1')

it('keeps the complete declaration and its separate request bound in a new-world original', () => {
  const request = { definition: original, commandId: 'original', name: 'Finite event',
    preflight: { hash: `sha256:${'a'.repeat(64)}`, catalogGeneration: 'installed' } }
  expect(simulationWorldCreateParamsSchema.parse(request).definition).toEqual(original)
  expect(original.behavior.directorEvents[0]?.maxRequests).toBe(1)
  expect(original.limits.world.maxRequests).toBeUndefined()
})

it.each([undefined, null, true, false, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1'])(
  'refuses malformed or missing director request limits: %j', (maxRequests) => {
    const first = original.behavior.directorEvents[0]!
    const { maxRequests: _limit, ...withoutLimit } = first
    const changed = { ...original, behavior: { ...original.behavior,
      directorEvents: [{ ...withoutLimit, ...maxRequests === undefined ? {} : { maxRequests } }] } }
    expect(simulationWorldPreflightParamsSchema.safeParse({ definition: changed }).success).toBe(false)
  },
)

it('rejects caller-injected trigger authority and private catalog capabilities in portable declarations', () => {
  for (const fields of [{ trigger: { eventId: 'forged' } }, { directorEvents: true }, { requesterEntityId: 'forged' }]) {
    const changed = { ...original, behavior: { ...original.behavior,
      directorEvents: [{ ...original.behavior.directorEvents[0], ...fields }] } }
    expect(simulationWorldPreflightParamsSchema.safeParse({ definition: changed }).success).toBe(false)
  }
})
