/** Raw preservation is separately authorized and cannot reinterpret an unsupported Native journal as current state. */
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createBusinessHarness } from '../../simulation-local/tests/business-harness.ts'
import { fixture, registration, call } from './fixtures.ts'

it.each(['json', 'sqlite'] as const)('preserves original101 only with whole-record permission and performs no writer/model fallback (%s)', async (backend) => {
  const native = await createBusinessHarness(backend)
  const record = { ...registration(), spec: native.selection.spec }
  const h = await fixture(backend, { imports: [record], maxContextPartBytes: 256,
    caseReaders: [{ principalId: call().principal.id, runId: record.id, content: ['case', 'persona'] }] })
  h.unregister(); h.ctx.simulations.registerProvider(native.provider)
  await native.run.close()
  const directory = join(native.root, createHash('sha256').update(native.selection.spec.runId).digest('hex'))
  if (backend === 'json') {
    const path = join(directory, 'journal', 'logs', 'c2ltdWxhdGlvbg.json')
    const document = z.object({ stream: z.object({ version: z.number() }).loose() }).loose()
      .parse(JSON.parse(await readFile(path, 'utf8')))
    document.stream.version = 101
    await writeFile(path, JSON.stringify(document))
  } else {
    const db = new DatabaseSync(join(directory, 'journal.sqlite'))
    try { db.prepare('UPDATE log_streams SET version = 101 WHERE name = ?').run('simulation') } finally { db.close() }
  }
  const opening = vi.spyOn(native.provider, 'open'), raw = vi.spyOn(native.provider, 'rawArchive')
  try {
    const mounted = await h.mount(), products = mounted.products
    await expect(products.inspect({ runId: record.id }, call())).rejects.toMatchObject({ reason: 'unsupported-version' })
    await expect(products.archiveRaw({ runId: record.id }, call())).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_FORBIDDEN' })
    expect(raw).not.toHaveBeenCalled()
    const release = products.recordReaderRegistrar()([{ principalId: call().principal.id, runId: record.id }])
    let page = await products.archiveRaw({ runId: record.id, limit: 1 }, call())
    expect(page.source).toMatchObject({ journalVersion: 101, nativeValidation: 'not-performed', physicalDatabaseCopy: false })
    expect(page.source.representation).toBe(backend === 'json' ? 'json-document-bytes' : 'sqlite-logical-frames')
    let text = page.items.map(value => value.text).join('')
    const first = page
    while (page.nextCursor !== undefined) {
      page = await products.archiveRaw({ runId: record.id, limit: 1, cursor: page.nextCursor }, call())
      expect(page.source).toEqual(first.source)
      text += page.items.map(value => value.text).join('')
    }
    expect(createHash('sha256').update(text).digest('hex')).toBe(first.source.sourceHash)
    expect(z.object({ version: z.number() }).parse(JSON.parse(text)).version).toBe(101)
    expect(opening).not.toHaveBeenCalled()
    release()
    await expect(products.archiveRaw({ runId: record.id, limit: 1, cursor: first.nextCursor }, call()))
      .rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_FORBIDDEN' })
    expect((await native.provider.rawArchive({ provider: 'local', spec: native.selection.spec }))?.journalVersion).toBe(101)
  } finally { vi.restoreAllMocks(); await native.close() }
})

it.each(['credential', 'record-policy'] as const)('rechecks %s authority after raw IO and isolates registered source selection', async (revocation) => {
  const h = await fixture('json')
  const gate = Promise.withResolvers<undefined>(), entered = Promise.withResolvers<undefined>()
  h.unregister()
  const rawArchive = vi.fn(async () => { entered.resolve(undefined); await gate.promise; return {
    journalVersion: 101, firstSequence: 0, tailSequence: 0, entryCount: 1, representation: 'json-document-bytes' as const,
    sourceHash: 'a'.repeat(64), nativeValidation: 'not-performed' as const, physicalDatabaseCopy: false as const, text: 'private token=secret',
  } })
  h.ctx.simulations.registerProvider({ name: 'local', open: h.open, rawArchive })
  const { products } = await h.mount()
  const revoke = products.recordReaderRegistrar()([{ principalId: call().principal.id }])
  const controller = new AbortController()
  const work = products.archiveRaw({ runId: registration().id }, call(controller))
  const denied = expect(work).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_FORBIDDEN' })
  await entered.promise
  if (revocation === 'credential') controller.abort()
  else revoke()
  gate.resolve(undefined); await denied
  expect(h.open).not.toHaveBeenCalled()
  await expect(products.archiveRaw({ runId: registration('foreign', 'other').id }, call()))
    .rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_FORBIDDEN' })
  expect(rawArchive).toHaveBeenCalledTimes(1)
})

it('invalidates a raw continuation after source replacement or a whole-record policy generation change', async () => {
  const h = await fixture('json', { maxContextPartBytes: 32 })
  h.unregister()
  let source = 'a'
  const rawArchive = vi.fn(async () => ({ journalVersion: 101, firstSequence: 0, tailSequence: 1, entryCount: 2,
    representation: 'sqlite-logical-frames' as const, sourceHash: source.repeat(64), nativeValidation: 'not-performed' as const,
    physicalDatabaseCopy: false as const, text: 'opaque-uninterpreted-source'.repeat(40) }))
  h.ctx.simulations.registerProvider({ name: 'local', open: h.open, rawArchive })
  const { products } = await h.mount()
  const remove = products.recordReaderRegistrar()([{ principalId: call().principal.id, runId: registration().id }])
  const input = { runId: registration().id, limit: 1 }
  const first = await products.archiveRaw(input, call())
  expect(first.nextCursor).toBeDefined()
  source = 'b'
  await expect(products.archiveRaw({ ...input, cursor: first.nextCursor }, call())).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_STALE' })
  source = 'a'; remove()
  products.recordReaderRegistrar()([{ principalId: call().principal.id, runId: registration().id }])
  await expect(products.archiveRaw({ ...input, cursor: first.nextCursor }, call())).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_STALE' })
  expect(h.open).not.toHaveBeenCalled()
})
