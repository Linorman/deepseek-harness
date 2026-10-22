import { z } from 'zod'
/** Real Loader + authenticated Host preserve an unsupported original source without creating a Native owner. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { access, mkdir, readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { boot } from '@clocky/clocky-app-boot'
import { simulationRunSpecSchema } from '@clocky/clocky-simulation'
import { JsonStorageBackend } from '@clocky/clocky-storage-json'
import { SqliteStorageBackend } from '@clocky/clocky-storage-sqlite'
import { createApiProxy, toFetchHandler } from '@clocky/clocky-host-apiproxy'
import { InProcessApiClient } from '@clocky/clocky-host-apiproxy/client'
import type { AuthenticatedProductCall } from '@clocky/clocky-product-principal'
import { simulationProductRawArchiveInputSchema } from '@clocky/clocky-simulation-product/schema'
import { templateJSON } from './sdk-product-template.ts'
import { requests } from './product-control-model.ts'

const root = resolve(process.env.SIMULATION_COMPANY_ROOT!), backend = process.env.SIMULATION_COMPANY_BACKEND
assert.ok(backend === 'json' || backend === 'sqlite')
const productId = 'raw-original-product', nativeId = 'raw-original-native'
const [template] = z.array(z.object({ spec: z.record(z.string(), z.unknown()) })).parse(JSON.parse(templateJSON))
assert.ok(template)
const spec = simulationRunSpecSchema.parse({ ...template.spec, runId: nativeId })
const directory = join(root, 'simulation', createHash('sha256').update(nativeId).digest('hex'))
await mkdir(directory, { recursive: true })
const storage = backend === 'json' ? new JsonStorageBackend(join(directory, 'journal'))
  : new SqliteStorageBackend({ path: join(directory, 'journal.sqlite'), journalMode: 'wal' })
const records = [{ kind: 'run/created', originalProtocol: '101', spec: { runId: nativeId } },
  { kind: 'old/unknown-protocol-event', private: '甲😀 original source token=not-a-real-secret' }]
try {
  const log = await storage.log.open({ name: 'simulation', version: 101 })
  await log.append(-1, records)
} finally { await storage.close() }
const before = backend === 'json' ? await readFile(join(directory, 'journal/logs/c2ltdWxhdGlvbg.json')) : undefined
process.env.COMPANY_RAW_IMPORTS = JSON.stringify([{ id: productId, name: 'Original unknown protocol source', ownerPrincipalId: 'reader', provider: 'local', spec }])
const ctx = await boot('simulation-raw-archive', process.argv[2]!)
const call: AuthenticatedProductCall = { principal: { id: 'reader' as never, issuer: 'raw-archive-scenario', subject: 'reader', assurance: 'test', credentialGeneration: 1 },
  credentialGeneration: 1, signal: new AbortController().signal }
const client = new InProcessApiClient(toFetchHandler(createApiProxy(ctx, { cwd: process.cwd(), defaultModelSelection: () => undefined }),
  { authenticatedProductCall: call }))
try {
  const input = simulationProductRawArchiveInputSchema.parse({ runId: productId, limit: 1 })
  const normal = await client.simulations.inspect({ runId: input.runId })
  assert.ok(!normal.result.ok)
  assert.equal((await client.simulations.archiveRaw(input)).result.ok, false)
  const revoke = ctx.simulationProducts.recordReaderRegistrar()([{ principalId: call.principal.id, runId: input.runId }])
  let reply = await client.simulations.archiveRaw(input)
  assert.ok(reply.result.ok)
  const source = reply.result.value.source
  assert.equal(source.journalVersion, 101); assert.equal(source.nativeValidation, 'not-performed'); assert.equal(source.physicalDatabaseCopy, false)
  let text = reply.result.value.items.map(value => value.text).join('')
  let cursor = reply.result.value.nextCursor
  while (cursor !== undefined) {
    reply = await client.simulations.archiveRaw({ ...input, cursor })
    assert.ok(reply.result.ok); assert.deepEqual(reply.result.value.source, source)
    text += reply.result.value.items.map(value => value.text).join(''); cursor = reply.result.value.nextCursor
  }
  assert.equal(createHash('sha256').update(text).digest('hex'), source.sourceHash)
  const archived = z.discriminatedUnion('format', [
    z.object({ format: z.literal('clocky.raw-json-log/v1'), version: z.number(), documentBase64: z.string() }),
    z.object({ format: z.literal('clocky.raw-sqlite-logical/v1'), version: z.number(),
      entries: z.array(z.object({ sequence: z.number().int(), valueBase64: z.string() })) }),
  ]).parse(JSON.parse(text))
  assert.equal(archived.version, 101)
  if (archived.format === 'clocky.raw-json-log/v1') {
    assert.equal(backend, 'json')
    assert.deepEqual(Buffer.from(archived.documentBase64, 'base64'), before)
  } else {
    assert.equal(backend, 'sqlite')
    assert.deepEqual(archived.entries.map(entry => z.json().parse(JSON.parse(
      Buffer.from(entry.valueBase64, 'base64').toString('utf8')))), records)
    const db = new DatabaseSync(join(directory, 'journal.sqlite'), { readOnly: true })
    try { assert.equal((db.prepare('SELECT version FROM log_streams WHERE name = ?').get('simulation') as { version: number }).version, 101) }
    finally { db.close() }
  }
  revoke(); assert.equal((await client.simulations.archiveRaw(input)).result.ok, false)
  await assert.rejects(access(join(directory, 'owner.sqlite')), { code: 'ENOENT' })
  assert.equal(requests.length, 0)
  console.log(JSON.stringify({ originalVersion: 101, rawOnly: true, physicalDatabaseCopy: false, originalBytesPreserved: true,
    nativeOwnerCreated: false, permissionRevoked: true, modelRequests: 0 }))
} finally { await ctx.fiber.dispose() }
