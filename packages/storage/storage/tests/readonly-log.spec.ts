/** Read-only observations validate durable continuity and complete output bounds. */
import { expect, it } from 'vitest'
import { assertLogReadRequest, boundedLogReadSnapshot } from '../src/readonly-log.ts'

it('rejects invalid configured allowances before IO and bounds UTF-8 metadata plus retained rows', () => {
  const descriptor = { name: 'stream', version: 1 }
  const limits = { maxEntries: 2, maxBytes: 1000 }
  expect(() =>{  assertLogReadRequest(descriptor, limits) }).not.toThrow()
  for (const patch of [{ maxEntries: 0 }, { maxBytes: -1 }, { maxEntries: 1.5 }, { maxBytes: Infinity }]) {
    expect(() =>{  assertLogReadRequest(descriptor, { ...limits, ...patch }) }).toThrow(/allowances/)
  }
  expect(() =>{  assertLogReadRequest({ ...descriptor, version: -1 }, limits) }).toThrow(/descriptor/)
  expect(() =>{  assertLogReadRequest({ ...descriptor, name: '' }, limits) }).toThrow(/descriptor/)
  const snapshot = { ...descriptor, firstSequence: 0, tailSequence: 1,
    entries: [{ sequence: 0, value: '甲' }, { sequence: 1, value: '😀' }], checkpoint: { sequence: 1, value: { complete: true } } }
  const bytes = Buffer.byteLength(JSON.stringify(snapshot))
  expect(boundedLogReadSnapshot(snapshot, { ...limits, maxBytes: bytes })).toBe(snapshot)
  expect(() => boundedLogReadSnapshot(snapshot, { ...limits, maxBytes: bytes - 1 })).toThrow(/allowance/)
  expect(() => boundedLogReadSnapshot(snapshot, { ...limits, maxEntries: 1 })).toThrow(/allowance/)
})

it('rejects corrupt medium sequence metadata while retaining a valid empty or compacted observation', () => {
  const empty = { name: 'stream', version: 1, firstSequence: 0, tailSequence: -1, entries: [] }
  const limits = { maxEntries: 8, maxBytes: 1000 }
  expect(boundedLogReadSnapshot(empty, limits)).toBe(empty)
  const retained = { ...empty, firstSequence: 2, tailSequence: 3,
    entries: [{ sequence: 2, value: {} }, { sequence: 3, value: {} }], checkpoint: { sequence: 3, value: {} } }
  expect(boundedLogReadSnapshot(retained, limits)).toBe(retained)
  for (const patch of [{ firstSequence: -1 }, { tailSequence: -2 }, { firstSequence: 1 },
    { entries: [{ sequence: 2, value: {} }, { sequence: 4, value: {} }] },
    { checkpoint: { sequence: -2, value: {} } }, { checkpoint: { sequence: 4, value: {} } },
    { checkpoint: { sequence: 1, value: {} } }]) {
    expect(() => boundedLogReadSnapshot({ ...retained, ...patch }, limits)).toThrow(/sequence metadata/)
  }
  expect(() => boundedLogReadSnapshot({ ...empty, firstSequence: 1 }, limits)).toThrow(/sequence metadata/)
  expect(() => boundedLogReadSnapshot({ ...empty, tailSequence: 1 }, limits)).toThrow(/sequence metadata/)
})
