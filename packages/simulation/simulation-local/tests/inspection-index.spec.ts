/** Derived publication cannot change authoritative history or bypass original readers. */
import { createHash } from 'node:crypto'
import { readFile, writeFile, unlink, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { simulationChangeSchema } from '@clocky/clocky-simulation'
import { LocalSimulationProvider } from '../src/index.ts'
import { buildInspectionIndex, inspectionIndexSchema, publishInspectionIndex, readInspectionIndex } from '../src/inspection-index.ts'
import { createBusinessHarness } from './business-harness.ts'

it.each(['json', 'sqlite'] as const)('rebuilds exact references, fences changed prefixes and survives deletion (%s)', async (backend) => {
  const h = await createBusinessHarness(backend)
  const reader = new LocalSimulationProvider({ name: 'local', root: h.root, backend, replayPageSize: 2 }, () => {})
  const selection = { provider: 'local', spec: h.selection.spec }
  const directory = join(h.root, createHash('sha256').update(selection.spec.runId).digest('hex'))
  const path = join(directory, 'inspection-index.json')
  try {
    const created = await reader.rebuildInspectionIndex(selection)
    expect(created.cursor).toBe(h.run.snapshot().revision)
    expect(inspectionIndexSchema.parse(JSON.parse(await readFile(path, 'utf8')))).toEqual(created)
    await h.run.change(simulationChangeSchema.parse({ kind: 'entity/create', id: 'indexed', entityKind: 'org',
      cognition: 'none', profile: {}, readiness: 'ready' }), h.run.snapshot().revision)
    const original = h.run.snapshot()
    expect((await reader.inspect(selection))?.snapshot).toEqual(original)
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(created) // Ordinary reads do not publish.
    const next = await reader.rebuildInspectionIndex(selection)
    expect(next.cursor).toBe(original.revision)
    expect(next.sourceHash).not.toBe(created.sourceHash)
    const observation = await reader.inspect({ ...selection, includeRecords: true })
    expect(buildInspectionIndex(observation!.records!, next.journalVersion)).toEqual(next)
    expect(observation!.sourceHash).toBe(next.sourceHash)
    expect((await reader.inspect(selection))?.sourceHash).toBe(next.sourceHash)
    observation!.snapshot.entities['indexed' as never]!.profile['injected'] = true
    expect((await reader.inspect(selection))?.snapshot).toEqual(original)
    await writeFile(path, '{"version":999}')
    expect((await reader.inspect(selection))?.snapshot).toEqual(original)
    await unlink(path)
    const rebuilt = await reader.rebuildInspectionIndex(selection)
    expect(rebuilt).toEqual(next)
    const cold = new LocalSimulationProvider({ name: 'local', root: h.root, backend, replayPageSize: 2 }, () => {})
    try { expect((await cold.inspect(selection))?.snapshot).toEqual(original) }
    finally { await cold.close() }
    await expect(reader.inspect({ ...selection, spec: { ...selection.spec, rulesVersion: 'other' } })).rejects.toThrow()
    expect((await reader.inspect(selection))?.snapshot).toEqual(original)
  } finally { await reader.close(); await h.close() }
})

it('rejects noncontiguous and unsupported derived formats before publishing', async () => {
  expect(() => buildInspectionIndex([{ sequence: 1, value: { kind: 'run/created' } }], 98)).toThrow()
  expect(() => inspectionIndexSchema.parse({ schema: 'clocky/simulation-inspection-index', version: 2 })).toThrow()
  const h = await createBusinessHarness('json')
  try {
    const index = await h.provider.rebuildInspectionIndex({ provider: 'local', spec: h.selection.spec })
    const directory = join(h.root, createHash('sha256').update(h.selection.spec.runId).digest('hex'))
    const original = await readFile(join(directory, 'inspection-index.json'))
    await expect(publishInspectionIndex(directory, { ...index, cursor: index.cursor + 1 })).rejects.toThrow()
    expect(await readFile(join(directory, 'inspection-index.json'))).toEqual(original)
    const blocked = join(directory, 'blocked')
    await mkdir(blocked)
    await mkdir(join(blocked, 'inspection-index.json'))
    await expect(publishInspectionIndex(blocked, index)).rejects.toThrow()
    expect(await readFile(join(directory, 'inspection-index.json'))).toEqual(original)
  } finally { await h.close() }
})

it('retains the old index across process exit before rename and reads the complete new index after publication', async () => {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const h = await createBusinessHarness('json')
  try {
    const original = await h.provider.rebuildInspectionIndex({ provider: 'local', spec: h.selection.spec })
    const directory = join(h.root, createHash('sha256').update(h.selection.spec.runId).digest('hex'))
    const child = (point: string) => promisify(execFile)(process.execPath,
      ['--import', 'tsx/esm', 'packages/simulation/simulation-local/tests/inspection-index-crash.ts', directory, point],
      { cwd: process.cwd(), env: { ...process.env, TMPDIR: join(process.cwd(), '.tmp/world-post-mvp') } })
    await expect(child('before-rename')).rejects.toMatchObject({ code: 71 })
    expect(JSON.parse(await readFile(join(directory, 'inspection-index.json'), 'utf8'))).toEqual(original)
    await expect(child('after-rename')).rejects.toMatchObject({ code: 72 })
    expect(inspectionIndexSchema.parse(JSON.parse(await readFile(join(directory, 'inspection-index.json'), 'utf8'))).journalVersion).toBe(999)
    expect((await h.provider.inspect({ provider: 'local', spec: h.selection.spec }))?.snapshot).toEqual(h.run.snapshot())
    expect(await h.provider.rebuildInspectionIndex({ provider: 'local', spec: h.selection.spec })).toEqual(original)
  } finally { await h.close() }
})

it.each(['json', 'sqlite'] as const)('bounds and ignores corrupt derived files in a cold reader (%s)', async (backend) => {
  const h = await createBusinessHarness(backend)
  const selection = { provider: 'local', spec: h.selection.spec }
  const directory = join(h.root, createHash('sha256').update(selection.spec.runId).digest('hex'))
  const path = join(directory, 'inspection-index.json')
  try {
    const manifest = await h.provider.rebuildInspectionIndex(selection)
    for (const bytes of ['{', JSON.stringify({ ...manifest, version: 2 }), 'x'.repeat(1024 * 1024)]) {
      await writeFile(path, bytes)
      const cold = new LocalSimulationProvider({ name: 'local', root: h.root, backend, replayPageSize: 1 }, () => {})
      try { expect((await cold.inspect(selection))?.snapshot).toEqual(h.run.snapshot()) }
      finally { await cold.close() }
    }
    await unlink(path); await mkdir(path)
    await expect(readInspectionIndex(directory, manifest)).rejects.toThrow()
  } finally { await h.close() }
})
