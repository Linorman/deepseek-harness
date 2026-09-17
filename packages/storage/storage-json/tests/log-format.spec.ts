import { describe, expect, it } from 'vitest'
import { parseLog, parseLogInfo, serializeLog } from '../src/log-format.ts'

const descriptor = { name: 'team/format', version: 2 }

describe('JSON log format', () => {
  it('round-trips an empty stream and a checkpointed contiguous stream', () => {
    const empty = serializeLog(descriptor, { version: 2, entries: [] })
    expect(parseLog(empty, descriptor)).toEqual({ version: 2, entries: [] })
    expect(parseLogInfo(empty)).toEqual({ name: 'team/format', version: 2, tailSequence: -1 })

    const populated = serializeLog(descriptor, {
      version: 2,
      entries: [{ sequence: 0, value: { accepted: true } }],
      checkpoint: { sequence: 0, value: { folded: true } },
    })
    expect(parseLog(populated, descriptor)).toEqual({
      version: 2,
      entries: [{ sequence: 0, value: { accepted: true } }],
      checkpoint: { sequence: 0, value: { folded: true } },
    })
    expect(parseLogInfo(populated)).toEqual({
      name: 'team/format',
      version: 2,
      tailSequence: 0,
      checkpointSequence: 0,
    })

    const compacted = serializeLog(descriptor, {
      version: 2,
      firstSequence: 2,
      entries: [{ sequence: 2, value: { retained: true } }],
      checkpoint: { sequence: 2, value: { folded: true } },
    })
    expect(parseLog(compacted, descriptor)).toEqual({
      version: 2,
      firstSequence: 2,
      entries: [{ sequence: 2, value: { retained: true } }],
      checkpoint: { sequence: 2, value: { folded: true } },
    })
    expect(parseLogInfo(compacted)).toEqual({
      name: 'team/format',
      version: 2,
      tailSequence: 2,
      checkpointSequence: 2,
    })
  })

  it.each([
    ['foreign name', { stream: { name: 'other', version: 2 }, entries: [] }, descriptor],
    ['foreign version', { stream: { name: 'team/format', version: 3 }, entries: [] }, descriptor],
  ])('rejects %s', (_label, document, expected) => {
    expect(() => parseLog(JSON.stringify(document), expected)).toThrow()
  })

  it.each([
    ['invalid JSON', 'not JSON'],
    ['a scalar document', '"not an object"'],
    ['a missing stream header', JSON.stringify({ entries: [] })],
    ['non-array entries', JSON.stringify({ stream: descriptor, entries: {} })],
    ['a noncontiguous entry', JSON.stringify({ stream: descriptor, entries: [{ sequence: 1, value: true }] })],
    ['an invalid checkpoint', JSON.stringify({ stream: descriptor, entries: [], checkpoint: { sequence: -1 } })],
    ['a checkpoint beyond the tail', JSON.stringify({ stream: descriptor, entries: [], checkpoint: { sequence: 0, value: {} } })],
    ['a checkpoint before the retained prefix', JSON.stringify({ stream: { ...descriptor, firstSequence: 2 }, entries: [{ sequence: 2, value: true }], checkpoint: { sequence: 1, value: {} } })],
    ['a mismatched header tail', JSON.stringify({ stream: { ...descriptor, tailSequence: 8 }, entries: [] })],
    ['a non-zero empty retained prefix', JSON.stringify({ stream: { ...descriptor, firstSequence: 2 }, entries: [] })],
  ])('rejects %s as malformed durable data', (_label, source) => {
    expect(() => parseLog(source, descriptor)).toThrow(/log stream/)
  })

  it.each([
    ['an empty header name', { stream: { name: '', version: 2 }, entries: [] }],
    ['a negative header version', { stream: { name: 'team/format', version: -1 }, entries: [] }],
    ['a fractional header version', { stream: { name: 'team/format', version: 1.5 }, entries: [] }],
    ['a negative first sequence', { stream: { ...descriptor, firstSequence: -1 }, entries: [] }],
    ['a fractional first sequence', { stream: { ...descriptor, firstSequence: 1.5 }, entries: [] }],
    ['an entry without a value', { stream: descriptor, entries: [{ sequence: 0 }] }],
    ['a negative entry sequence', { stream: descriptor, entries: [{ sequence: -2, value: true }] }],
    ['a non-record checkpoint', { stream: descriptor, entries: [], checkpoint: [] }],
  ])('classifies %s as malformed-medium', (_label, document) => {
    expect(() => parseLog(JSON.stringify(document), descriptor)).toThrow(
      expect.objectContaining({ code: 'malformed-medium' }),
    )
  })
})
