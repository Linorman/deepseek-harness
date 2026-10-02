/** The original request projection follows durable append, bounded complete replay and one serialized writer. */
import { expect, it, vi } from 'vitest'
import { SimulationCreationStore } from '../src/creation-store.ts'
import { fixture } from './fixtures.ts'
import { accepted } from './creation-fixture.ts'

const options = { recoveryPageSize: 1, maxCommands: 2, maxEntryBytes: 100000 }

async function journal() {
  const h = await fixture()
  const stream = await h.ctx.storageLog.open({ name: 'commands', version: 1 })
  const store = new SimulationCreationStore(stream, options)
  await store.load()
  return { ...h, stream, store }
}

it('publishes original acceptance and settlement after append and replays detached outcomes', async () => {
  const h = await journal()
  const original = accepted().command
  const first = await h.store.accept(() => ({ existing: false, command: original }))
  expect(first).toEqual(original)
  expect(await h.store.accept(state => ({ existing: true, command: state.commands.get(original.input.commandId)! }))).toEqual(first)
  expect(h.stream.tailSequence).toBe(0)
  const outcome = await h.store.finish(original.input.commandId)
  expect(outcome.status).toBe('completed')
  const recovered = new SimulationCreationStore(h.stream, options)
  await recovered.load()
  expect(recovered.snapshot().commands.get(original.input.commandId)?.receipt).toEqual(outcome)
  const detached = recovered.snapshot()
  const detachedReceipt = detached.commands.get(original.input.commandId)!.receipt
  Reflect.set(detachedReceipt, 'status', 'accepted')
  expect(recovered.snapshot().commands.get(original.input.commandId)?.receipt.status).toBe('completed')
  await expect(recovered.finish(original.input.commandId)).rejects.toThrow('no pending')
  await recovered.drain()
  await expect(recovered.accept(() => ({ existing: true, command: original }))).rejects.toThrow('closed')
})

it('keeps rejected durable writes unpublished and accepts the original retry after the failed writer', async () => {
  const h = await journal()
  const original = accepted().command
  vi.spyOn(h.stream, 'append').mockRejectedValueOnce(new Error('append-unavailable'))
  await expect(h.store.accept(() => ({ existing: false, command: original }))).rejects.toThrow('append-unavailable')
  expect(h.store.snapshot().commands.size).toBe(0)
  await h.store.accept(() => ({ existing: false, command: original }))
  vi.spyOn(h.stream, 'append').mockRejectedValueOnce(new Error('settlement-unavailable'))
  await expect(h.store.finish(original.input.commandId)).rejects.toThrow('settlement-unavailable')
  expect(h.store.snapshot().commands.get(original.input.commandId)?.receipt.status).toBe('accepted')
  expect(await h.store.finish(original.input.commandId, 'unavailable')).toMatchObject({ status: 'failed', failure: 'unavailable' })
})

it('rejects oversized and excess accepted history before append and while recovering', async () => {
  const h = await journal()
  const original = accepted().command
  const small = new SimulationCreationStore(h.stream, { ...options, maxEntryBytes: 1 })
  await small.load()
  await expect(small.accept(() => ({ existing: false, command: original }))).rejects.toThrow('durable allowance')
  expect(h.stream.tailSequence).toBe(-1)
  await h.store.accept(() => ({ existing: false, command: original }))
  const prepare = { kind: 'prepare' as const, input: { runId: original.receipt.runId, commandId: 'prepare' as never },
    ownerPrincipalId: original.ownerPrincipalId,
    receipt: { ...original.receipt, commandId: 'prepare' as never, kind: 'prepare' as const } }
  const one = new SimulationCreationStore(h.stream, { ...options, maxCommands: 1 })
  await one.load()
  await expect(one.accept(() => ({ existing: false, command: prepare }))).rejects.toThrow('capacity')
  expect(h.stream.tailSequence).toBe(0)
  await expect(small.load()).rejects.toThrow('durable allowance')
  await h.store.accept(() => ({ existing: false, command: prepare }))
  await expect(one.load()).rejects.toThrow('repeats')
  await expect(new SimulationCreationStore(h.stream, { ...options, maxCommands: 1 }).load()).rejects.toThrow('capacity')
})

it('refuses incomplete, noncontiguous and corrupt durable prefixes', async () => {
  const h = await journal()
  await h.stream.append(-1, [accepted()])
  const first = vi.spyOn(h.stream, 'firstSequence', 'get').mockReturnValue(1)
  await expect(new SimulationCreationStore(h.stream, options).load()).rejects.toThrow('complete prefix')
  first.mockRestore()
  const read = vi.spyOn(h.stream, 'read')
  read.mockResolvedValueOnce([])
  await expect(new SimulationCreationStore(h.stream, options).load()).rejects.toThrow('incomplete suffix')
  read.mockResolvedValueOnce([{ sequence: 3, value: accepted() }])
  await expect(new SimulationCreationStore(h.stream, options).load()).rejects.toThrow('contiguous')
  read.mockResolvedValueOnce([{ sequence: 0, value: { kind: 'alien' } }])
  await expect(new SimulationCreationStore(h.stream, options).load()).rejects.toThrow()
})
