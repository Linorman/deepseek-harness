/** Model-visible hiring instructions and Native staging reject the same unsupported outer fields. */
import { expect, it } from 'vitest'
import { validateWorldHiringEnvelope, WORLD_HIRING_REQUEST_ENVELOPE } from '../src/world-domains.ts'

it('requires the next safe boundary and Native authorization without supplemental evidence', () => {
  expect(() => { validateWorldHiringEnvelope(WORLD_HIRING_REQUEST_ENVELOPE) }).not.toThrow()
  for (const request of [{ expectedTime: '1', evidence: [] }, { expectedTime: null, evidence: [{ kind: 'norm' }] }])
    expect(() => { validateWorldHiringEnvelope(request) }).toThrow(/expectedTime: null and evidence: \[\]/)
})
