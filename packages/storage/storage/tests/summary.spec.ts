import { describe, expect, it } from 'vitest'
import { parseLogSummary } from '../src/summary.ts'

const descriptor = { name: 'team/summary', version: 1 }
const header = { ...descriptor, tailSequence: 0, summary: { phase: 'active' } }

describe('durable log summary metadata', () => {
  it('distinguishes an omitted projection from an explicitly null projection', () => {
    expect(parseLogSummary(header, descriptor)).toEqual({ sequence: 0, value: { phase: 'active' } })
    expect(parseLogSummary({ ...descriptor, tailSequence: -1 }, descriptor)).toBeUndefined()
    expect(parseLogSummary({ ...header, summary: null }, descriptor)).toEqual({ sequence: 0, value: null })
  })

  it.each([null, [], false, {}, { ...header, name: 'foreign' }, { ...header, version: '1' },
    { ...header, version: -1 }, { ...header, version: 1.5 }, { ...header, tailSequence: '0' },
    { ...header, tailSequence: -2 }, { ...header, tailSequence: 1.5 }])('rejects malformed metadata %j', (value) => {
    expect(() => parseLogSummary(value, descriptor)).toThrow(expect.objectContaining({ code: 'malformed-medium' }))
  })

  it('rejects an incompatible durable format', () => {
    expect(() => parseLogSummary({ ...header, version: 2 }, descriptor))
      .toThrow(expect.objectContaining({ code: 'version-mismatch' }))
  })
})
