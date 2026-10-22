/** Real-source replacement and corruption cannot be hidden by a warm derived projection or an unchanged journal revision. */
import { createHash } from 'node:crypto'
import { readFile, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import { expect, it } from 'vitest'
import { simulationChangeSchema } from '@clocky/clocky-simulation'
import { LocalSimulationProvider } from '../src/index.ts'
import { createBusinessHarness } from './business-harness.ts'
import { fixture, registration, call } from '../../simulation-product/tests/fixtures.ts'

const change = z.object({ kind: z.literal('run/change'), command: z.object({ kind: z.literal('entity/create'),
  id: z.literal('one'), profile: z.record(z.string(), z.json()) }).loose() }).loose()
function replacement(value: unknown): unknown {
  const parsed = change.safeParse(value)
  return parsed.success ? { ...parsed.data, command: { ...parsed.data.command, profile: { ...parsed.data.command.profile, name: 'changed-source' } } } : undefined
}

it.each(['json', 'sqlite'] as const)('fences real same-revision replacement, missing source and corruption after a warm read (%s)', async (backend) => {
  const h = await createBusinessHarness(backend)
  const reader = new LocalSimulationProvider({ name: 'local', root: h.root, backend, replayPageSize: 1 }, () => {})
  const record = { ...registration(), spec: h.selection.spec }, product = await fixture(backend, { imports: [record] })
  product.unregister(); product.ctx.simulations.registerProvider(reader)
  const selection = { provider: 'local', spec: h.selection.spec }
  const directory = join(h.root, createHash('sha256').update(selection.spec.runId).digest('hex'))
  const path = backend === 'json' ? join(directory, 'journal/logs/c2ltdWxhdGlvbg.json') : join(directory, 'journal.sqlite')
  let originalJson: Buffer | undefined
  try {
    for (const id of ['one', 'two']) await h.run.change(simulationChangeSchema.parse({ kind: 'entity/create', id,
      entityKind: 'org', cognition: 'none', readiness: 'ready', profile: { name: 'original-source' } }), h.run.snapshot().revision)
    await h.run.close()
    const { products } = await product.mount(), input = { runId: record.id, collection: 'entities' as const, limit: 1 }
    const first = await products.browse(input, call()), before = await reader.inspect(selection)
    expect(first.nextCursor).toBeDefined()
    if (backend === 'json') {
      originalJson = await readFile(path)
      const document = z.object({ entries: z.array(z.object({ sequence: z.number().int(), value: z.unknown() }).loose()) })
        .loose().parse(JSON.parse(originalJson.toString('utf8')))
      document.entries = document.entries.map(entry => ({ ...entry, value: replacement(entry.value) ?? entry.value }))
      await writeFile(path, JSON.stringify(document))
    } else {
      const db = new DatabaseSync(path)
      try {
        const rows = z.array(z.object({ sequence: z.number().int(), value: z.string() })).parse(
          db.prepare('SELECT sequence, value FROM log_entries WHERE stream = ?').all('simulation'))
        for (const row of rows) {
          const changed = replacement(JSON.parse(row.value))
          if (changed !== undefined) db.prepare('UPDATE log_entries SET value = ? WHERE stream = ? AND sequence = ?')
            .run(JSON.stringify(changed), 'simulation', row.sequence)
        }
      } finally { db.close() }
    }
    const after = await reader.inspect(selection)
    expect(after?.snapshot.revision).toBe(before?.snapshot.revision)
    expect(after?.sourceHash).not.toBe(before?.sourceHash)
    expect(after?.snapshot.entities['one' as never]?.profile['name']).toBe('changed-source')
    await expect(products.browse({ ...input, cursor: first.nextCursor }, call())).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_STALE' })
    await rename(path, `${path}.hidden`)
    try { expect(await reader.inspect(selection)).toBeUndefined() } finally { await rename(`${path}.hidden`, path) }
    if (backend === 'json') await writeFile(path, 'corrupt-source')
    else {
      const db = new DatabaseSync(path)
      try { db.prepare('UPDATE log_entries SET value = ? WHERE stream = ? AND sequence = 1').run('corrupt-source', 'simulation') }
      finally { db.close() }
    }
    await expect(reader.inspect(selection)).rejects.toMatchObject({ code: 'malformed-medium' })
  } finally {
    if (originalJson !== undefined) await writeFile(path, originalJson)
    await reader.close(); await h.close()
  }
})

it.each(['json', 'sqlite'] as const)('drains accepted raw-preservation IO before provider closure (%s)', async (backend) => {
  const h = await createBusinessHarness(backend)
  try {
    await h.run.close()
    const order: string[] = []
    const read = h.provider.rawArchive({ provider: 'local', spec: h.selection.spec }).then((value) => { order.push('read'); return value })
    const closing = h.provider.close().then(() => { order.push('closed') })
    const [archived] = await Promise.all([read, closing])
    expect(archived?.nativeValidation).toBe('not-performed')
    expect(order).toEqual(['read', 'closed'])
    await expect(h.provider.rawArchive({ provider: 'local', spec: h.selection.spec })).rejects.toMatchObject({ code: 'closed' })
  } finally { await h.close() }
})
