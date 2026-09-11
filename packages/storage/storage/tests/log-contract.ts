/**
 * Shared append-only-log conformance suite. JSON and SQLite backends run this
 * against the same durable operations so a Team Hub can rely on one recovery
 * and compare-and-set vocabulary.
 * @module
 */

import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { EMPTY_LOG_SEQUENCE } from '../src/log.ts'
import type { StorageBackend } from '../src/backend.ts'

const DESCRIPTOR = { name: 'contract_stream', version: 3 }

/** One conformance run over a fresh medium and a reopen factory. */
export interface LogBackendContractHarness {
  /** Fresh backend over an empty medium. */
  readonly backend: StorageBackend
  /** New backend over the same medium, simulating process restart. */
  reopen(): Promise<StorageBackend>
  /** Damage the persisted tail after every live handle has closed. */
  tearTail(): Promise<void>
}

/**
 * Run the common log-facet contract against one backend.
 * @param label - Backend label for Vitest output.
 * @param create - Fresh-medium factory.
 */
export function runLogBackendContract(label: string, create: () => Promise<LogBackendContractHarness>) {
  describe(`log backend contract: ${label}`, () => {
    it('serves an empty stream without materializing entries', async () => {
      const { backend } = await create()
      const stream = await backend.log!.open(DESCRIPTOR)
      expect(stream.firstSequence).toBe(0)
      expect(await stream.read(-1, 10)).toEqual([])
      await expect(stream.readCheckpoint()).resolves.toBeUndefined()
      await stream.close()
      await backend.close()
    })

    it('atomically appends a batch and rejects a stale expected tail', async () => {
      const { backend } = await create()
      const stream = await backend.log!.open(DESCRIPTOR)
      await expect(stream.append(-1, [{ first: true }, { second: true }])).resolves.toEqual({ tailSequence: 1 })
      await expect(stream.append(-1, [{ stale: true }])).rejects.toMatchObject({
        name: 'StorageError',
        code: 'sequence-conflict',
      })
      expect(await stream.read(-1, 10)).toEqual([
        { sequence: 0, value: { first: true } },
        { sequence: 1, value: { second: true } },
      ])
      await stream.close()
      await backend.close()
    })

    it('serializes competing compare-and-set appends at the durable tail', async () => {
      const { backend } = await create()
      const stream = await backend.log!.open(DESCRIPTOR)
      const attempts = await Promise.allSettled([
        stream.append(-1, [{ winner: 'a' }]),
        stream.append(-1, [{ winner: 'b' }]),
      ])
      expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1)
      expect(attempts.filter(result => result.status === 'rejected')).toHaveLength(1)
      expect(await stream.read(-1, 10)).toHaveLength(1)
      await stream.close()
      await backend.close()
    })

    it('persists entries and monotonic checkpoints across restart', async () => {
      const harness = await create()
      const stream = await harness.backend.log!.open(DESCRIPTOR)
      await stream.append(-1, [{ first: true }, { second: true }])
      await stream.writeCheckpoint({ sequence: 1, value: { projection: 'v1' } })
      await stream.close()
      await harness.backend.close()

      const reopened = await harness.reopen()
      const resumed = await reopened.log!.open(DESCRIPTOR)
      expect(await resumed.read(-1, 10)).toEqual([
        { sequence: 0, value: { first: true } },
        { sequence: 1, value: { second: true } },
      ])
      expect(await resumed.readCheckpoint()).toEqual({ sequence: 1, value: { projection: 'v1' } })
      await resumed.append(1, [{ third: true }])
      await expect(resumed.writeCheckpoint({ sequence: 0, value: { projection: 'stale' } })).rejects.toMatchObject({
        name: 'StorageError',
        code: 'checkpoint-conflict',
      })
      await expect(resumed.writeCheckpoint({ sequence: 3, value: { projection: 'ahead' } })).rejects.toMatchObject({
        name: 'StorageError',
        code: 'checkpoint-conflict',
      })
      await resumed.close()
      await reopened.close()
    })

    it('compacts only behind an exact checkpoint and preserves the suffix across restart', async () => {
      const harness = await create()
      const stream = await harness.backend.log!.open(DESCRIPTOR)
      await stream.append(-1, ['zero', 'one', 'two', 'three'])
      await expect(stream.compact({ throughSequence: 0, expectedCheckpointSequence: 3 })).rejects.toMatchObject({
        name: 'StorageError',
        code: 'checkpoint-conflict',
      })
      await stream.writeCheckpoint({ sequence: 3, value: { projection: 'tail' } })
      await expect(stream.compact({ throughSequence: 3, expectedCheckpointSequence: 3 })).rejects.toMatchObject({
        name: 'StorageError',
        code: 'checkpoint-conflict',
      })
      await stream.compact({ throughSequence: 0, expectedCheckpointSequence: 3 })
      await stream.compact({ throughSequence: 0, expectedCheckpointSequence: 3 })
      expect(stream.firstSequence).toBe(1)
      await expect(stream.read(-1, 10)).rejects.toMatchObject({ code: 'compacted' })
      expect(await stream.read(0, 10)).toEqual([
        { sequence: 1, value: 'one' },
        { sequence: 2, value: 'two' },
        { sequence: 3, value: 'three' },
      ])
      expect(await stream.readCheckpoint()).toEqual({ sequence: 3, value: { projection: 'tail' } })
      await stream.append(3, ['four'])
      await stream.close()
      await harness.backend.close()

      const reopened = await harness.reopen()
      const resumed = await reopened.log!.open(DESCRIPTOR)
      await expect(resumed.read(-1, 10)).rejects.toMatchObject({ code: 'compacted' })
      expect(await resumed.read(3, 10)).toEqual([{ sequence: 4, value: 'four' }])
      await resumed.close()
      await reopened.close()
    })

    it('preserves generated append batches and retained cursors across compaction', async () => {
      await fc.assert(fc.asyncProperty(
        fc.array(fc.integer({ min: 1, max: 4 }), { minLength: 1, maxLength: 8 }),
        async (batchSizes) => {
          const harness = await create()
          const stream = await harness.backend.log!.open(DESCRIPTOR)
          try {
            let tail = EMPTY_LOG_SEQUENCE
            let nextValue = 0
            const values: Array<{ readonly index: number }> = []
            for (const size of batchSizes) {
              const batch = Array.from({ length: size }, () => ({ index: nextValue++ }))
              values.push(...batch)
              const result = await stream.append(tail, batch)
              tail = result.tailSequence
            }
            expect(await stream.read(-1, values.length + 1)).toEqual(values.map((value, index) => ({ sequence: index, value })))
            if (tail > 0) {
              await stream.writeCheckpoint({ sequence: tail, value: { tail } })
              await stream.compact({ throughSequence: tail - 1, expectedCheckpointSequence: tail })
              expect(stream.firstSequence).toBe(tail)
              await expect(stream.read(-1, 1)).rejects.toMatchObject({ code: 'compacted' })
              expect(await stream.read(tail - 1, 1)).toEqual([{ sequence: tail, value: values[tail] }])
            }
          } finally {
            await stream.close()
            await harness.backend.close()
          }
        },
      ), { numRuns: 20 })
    })

    it('pages entries and lists materialized streams in stable name order', async () => {
      const { backend } = await create()
      const first = await backend.log!.open(DESCRIPTOR)
      await first.append(-1, [0, 1, 2])
      expect(await first.read(-1, 2)).toEqual([
        { sequence: 0, value: 0 },
        { sequence: 1, value: 1 },
      ])
      expect(await first.read(1, 2)).toEqual([{ sequence: 2, value: 2 }])
      await first.close()

      const another = await backend.log!.open({ name: 'another_stream', version: 1 })
      await another.append(-1, ['entry'])
      await another.close()
      expect(await backend.log!.list()).toEqual([
        { name: 'another_stream', version: 1, tailSequence: 0 },
        { name: 'contract_stream', version: 3, tailSequence: 2 },
      ])
      await backend.close()
    })

    it('rejects invalid caller bounds, empty batches, and double-open', async () => {
      const { backend } = await create()
      const stream = await backend.log!.open(DESCRIPTOR)
      await expect(stream.append(-1, [])).rejects.toThrow(/non-empty/)
      await expect(stream.read(-2, 1)).rejects.toThrow(/afterSequence/)
      await expect(stream.read(-1, 0)).rejects.toThrow(/limit/)
      await expect(backend.log!.open(DESCRIPTOR)).rejects.toThrow(/already open/)
      await stream.close()
      await backend.close()
    })

    it('rejects a torn tail rather than silently truncating durable history', async () => {
      const harness = await create()
      const stream = await harness.backend.log!.open(DESCRIPTOR)
      await stream.append(-1, [{ committed: true }])
      await stream.close()
      await harness.backend.close()
      await harness.tearTail()

      const reopened = await harness.reopen()
      await expect(reopened.log!.open(DESCRIPTOR)).rejects.toMatchObject({
        name: 'StorageError',
        code: 'malformed-medium',
      })
      await reopened.close()
    })

    it('drains accepted work, releases the stream name, and rejects operations after close', async () => {
      const { backend } = await create()
      const stream = await backend.log!.open(DESCRIPTOR)
      const append = stream.append(-1, [{ accepted: true }])
      await stream.close()
      await expect(append).resolves.toEqual({ tailSequence: 0 })
      await expect(stream.read(-1, 1)).rejects.toMatchObject({ code: 'closed' })
      const reopened = await backend.log!.open(DESCRIPTOR)
      await reopened.close()
      await backend.close()
    })
  })
}
