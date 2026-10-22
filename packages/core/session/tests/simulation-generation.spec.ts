import { readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import { adoptSessionEvent } from '../src/index.ts'
import type { SessionEvent } from '../src/types.ts'
import { isSimulationGenerationEvent } from '../src/simulation-generation.ts'

const cases = JSON.parse(await readFile(new URL('../../../sdk/protocol/tests/fixtures/simulation-generation-cases.json', import.meta.url), 'utf8')) as {
  name: string
  valid: boolean
  event: unknown
}[]

it.each(cases)('validates required durable helper event: $name', ({ valid, event }) => {
  expect(isSimulationGenerationEvent(event)).toBe(valid)
  if (valid) expect(adoptSessionEvent(event as SessionEvent)).toEqual(event)
  else expect(() => adoptSessionEvent(event as SessionEvent)).toThrow(/generation/)
})
