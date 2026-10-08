import { expect, it } from 'vitest'
import { assertLogCompactionBounds, assertLogCompactionRequest } from '../src/compaction.ts'

it.each([-2, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
  'refuses an unrepresentable compaction prefix (%s) before backend work', (throughSequence) => {
    expect(() => { assertLogCompactionRequest({ throughSequence, expectedCheckpointSequence: 1 }) })
      .toThrow('throughSequence must be a safe integer at least -1')
  },
)

it.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
  'refuses an unrepresentable checkpoint watermark (%s) before backend work', (expectedCheckpointSequence) => {
    expect(() => { assertLogCompactionRequest({ throughSequence: 0, expectedCheckpointSequence }) })
      .toThrow('expectedCheckpointSequence must be a non-negative safe integer')
  },
)

it('retains the empty prefix and requires an exact later durable checkpoint', () => {
  expect(() => { assertLogCompactionRequest({ throughSequence: -1, expectedCheckpointSequence: 0 }) }).not.toThrow()
  expect(() => { assertLogCompactionBounds('journal', 2, 1, { throughSequence: 0, expectedCheckpointSequence: 1 }) }).not.toThrow()
  for (const checkpointSequence of [undefined, 0, 2]) {
    expect(() => { assertLogCompactionBounds('journal', 2, checkpointSequence,
      { throughSequence: 0, expectedCheckpointSequence: 1 }) }).toThrow(/checkpoint/)
  }
  for (const [tail, throughSequence, expectedCheckpointSequence] of [[1, 0, 2], [2, 1, 1], [2, 2, 2]] as const) {
    expect(() => { assertLogCompactionBounds('journal', tail, expectedCheckpointSequence,
      { throughSequence, expectedCheckpointSequence }) }).toThrow(/cannot compact/)
  }
})
