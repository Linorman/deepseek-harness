import { mkdir, mkdtemp } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { expect, it } from 'vitest'
import Ownership from '../src/federation-ownership.ts'
import { createContext } from '../../simulation-team/tests/harness.ts'
import { registration, call } from './fixtures.ts'

it.each(['json', 'sqlite'] as const)('fences old %s partition generations and preserves unknown resource transfers across coordinator recovery', async (backend) => {
  const parent = resolve('.tmp/world-post-mvp/e2'); await mkdir(parent, { recursive: true })
  const root = await mkdtemp(join(parent, `${backend}-`)), a = await createContext(join(root, 'a'), backend)
  const b = await createContext(join(root, 'b'), backend), authority = await createContext(join(root, 'coordinator'), backend)
  const ar = registration('a'), br = registration('b')
  const source = await a.ctx.simulations.open(a.ctx.simulations.resolve({ provider: 'local', spec: ar.spec, mode: 'create' }))
  const target = await b.ctx.simulations.open(b.ctx.simulations.resolve({ provider: 'local', spec: br.spec, mode: 'create' }))
  const config = { stream: 'ownership', coordinatorPrincipalId: 'coordinator',
    partitions: [{ runId: String(ar.spec.runId), principalId: 'a' }, { runId: String(br.spec.runId), principalId: 'b' }],
    maxEntries: 100, maxEntryBytes: 65536, pageSize: 4 }
  let fiber = authority.ctx.plugin(Ownership, config); await fiber
  try {
    const registry = () => authority.ctx.federationOwnership
    await registry().register({ objectId: 'federated-credit', home: String(ar.spec.runId), quantity: '10' }, call(undefined, 'coordinator'))
    await expect(registry().register({ objectId: 'forbidden', home: String(ar.spec.runId), quantity: '10' }, call(undefined, 'a')))
      .rejects.toThrow(/authorization/)
    const spend = { operationId: 'source-spend', objectId: 'federated-credit', home: String(ar.spec.runId), generation: 0, amount: '2' }
    expect(await registry().spend(spend, call(undefined, 'a'))).toBe('8')
    expect(await registry().spend(spend, call(undefined, 'a'))).toBe('8')
    const input = { transferId: 'handoff', objectId: 'federated-credit', source: String(ar.spec.runId), target: String(br.spec.runId), generation: 0 }
    expect(await registry().reserve(input, call(undefined, 'a'))).toMatchObject({ quantity: '8', status: 'reserved' })
    await expect(registry().spend({ ...spend, operationId: 'unknown-source-spend' }, call(undefined, 'a'))).rejects.toThrow(/reserved/)
    await expect(registry().spend({ ...spend, operationId: 'unknown-target-spend', home: String(br.spec.runId) }, call(undefined, 'b')))
      .rejects.toThrow(/generation fenced/)
    await expect(registry().settle('handoff', call(undefined, 'coordinator'))).rejects.toThrow(/confirmation/)
    await fiber.dispose(); fiber = authority.ctx.plugin(Ownership, config); await fiber
    expect(await registry().reserve(input, call(undefined, 'a'))).toMatchObject({ status: 'reserved' })
    expect(await registry().confirm('handoff', call(undefined, 'b'))).toMatchObject({ status: 'confirmed' })
    await fiber.dispose(); fiber = authority.ctx.plugin(Ownership, config); await fiber
    await expect(registry().spend({ ...spend, operationId: 'confirmed-source-spend' }, call(undefined, 'a'))).rejects.toThrow(/reserved/)
    expect(await registry().settle('handoff', call(undefined, 'coordinator'))).toMatchObject({ status: 'settled' })
    expect(await registry().settle('handoff', call(undefined, 'coordinator'))).toMatchObject({ status: 'settled' })
    await expect(registry().spend({ ...spend, operationId: 'retired-source-spend' }, call(undefined, 'a'))).rejects.toThrow(/generation fenced/)
    await expect(registry().spend({ ...spend, operationId: 'old-target-spend', home: String(br.spec.runId) }, call(undefined, 'b')))
      .rejects.toThrow(/generation fenced/)
    expect(await registry().spend({ ...spend, operationId: 'current-target-spend', home: String(br.spec.runId), generation: 1, amount: '3' },
      call(undefined, 'b'))).toBe('5')
    expect(await registry().inspect(call(undefined, 'coordinator'))).toMatchObject({ resources: [{ home: br.spec.runId, generation: 1, quantity: '5' }] })
    expect(await registry().spend(spend, call(undefined, 'a'))).toBe('8')
    await fiber.dispose(); fiber = authority.ctx.plugin(Ownership, config); await fiber
    expect(await registry().spend(spend, call(undefined, 'a'))).toBe('8')
    const journal = authority.ctx.storageLog.get(config.stream)!, append = journal.append.bind(journal)
    journal.append = async (...args) => { await append(...args); throw new Error('Injected response lost after durable spend') }
    const lost = { ...spend, operationId: 'target-lost-reply', home: String(br.spec.runId), generation: 1, amount: '1' }
    await expect(registry().spend(lost, call(undefined, 'b'))).rejects.toThrow(/response lost/)
    await expect(registry().spend({ ...lost, operationId: 'unsafe-retry' }, call(undefined, 'b'))).rejects.toThrow(/authorization/)
    await fiber.dispose(); fiber = authority.ctx.plugin(Ownership, config); await fiber
    expect(await registry().spend(lost, call(undefined, 'b'))).toBe('4')
    expect((await registry().inspect(call(undefined, 'coordinator'))).resources[0]!.quantity).toBe('4')
    expect(source.snapshot().spec.runId).toBe(ar.spec.runId)
    expect(target.snapshot().spec.runId).toBe(br.spec.runId)
  } finally { await fiber.dispose(); await source.close(); await target.close()
    await Promise.all([a.ctx.fiber.dispose(), b.ctx.fiber.dispose(), authority.ctx.fiber.dispose()]) }
})
