/** Read-only run observations preserve phase, writers and authoritative durable history. */
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@clocky/cordis'
import { expect, it, vi } from 'vitest'
import Simulations, { simulationChangeSchema } from '@clocky/clocky-simulation'
import { LocalSimulationProvider } from '../src/index.ts'
import { createBusinessHarness } from './business-harness.ts'

it.each(['json', 'sqlite'] as const)('observes the same history while owned locally, by another provider, and after release (%s)', async (backend) => {
  const h = await createBusinessHarness(backend)
  const reader = new LocalSimulationProvider({ name: 'local', root: h.root, backend, replayPageSize: 2 }, () => {})
  const ctx = new Context()
  try {
    await ctx.plugin(Simulations)
    const unregister = ctx.simulations.registerProvider(reader)
    const input = ctx.simulations.resolveInspection({ provider: 'local', spec: h.selection.spec })
    await h.run.setPhase('running', h.run.snapshot().revision)
    await h.run.change(simulationChangeSchema.parse({ kind: 'entity/create', id: 'observer-visible', entityKind: 'org',
      cognition: 'none', profile: { name: 'Observed' } }), h.run.snapshot().revision)
    const before = h.run.snapshot()
    expect(await h.provider.inspect(input)).toEqual({ snapshot: before, owner: 'this-provider' })
    const withRecords = await h.provider.inspect({ ...input, includeRecords: true })
    expect(withRecords?.snapshot).toEqual(before)
    expect(withRecords?.records?.[0]?.value).toMatchObject({ kind: 'run/created' })
    expect(withRecords?.records?.at(-1)?.sequence).toBe(before.revision)
    expect(await ctx.simulations.inspect(input)).toEqual({ snapshot: before, owner: 'other-owner' })
    expect(h.run.snapshot()).toEqual(before)
    await expect(reader.open({ ...h.selection, mode: 'open' })).rejects.toThrow(/coordinator/)
    await h.run.close()
    const path = join(h.root, createHash('sha256').update(input.spec.runId).digest('hex'))
    const files = await readdir(path)
    const ownerFile = await readFile(join(path, 'owner.sqlite'))
    const journal = backend === 'sqlite' ? await readFile(join(path, 'journal.sqlite')) : undefined
    expect(await ctx.simulations.inspect(input)).toEqual({ snapshot: before, owner: 'unowned' })
    const observedFiles = await readdir(path)
    expect(observedFiles.filter(file => file !== 'journal.sqlite-wal' && file !== 'journal.sqlite-shm')).toEqual(files)
    expect(await readFile(join(path, 'owner.sqlite'))).toEqual(ownerFile)
    if (journal !== undefined) expect(await readFile(join(path, 'journal.sqlite'))).toEqual(journal)
    expect(await ctx.simulations.inspect({ ...input, spec: { ...input.spec, runId: 'absent' as never } })).toBeUndefined()
    await expect(stat(join(h.root, createHash('sha256').update('absent').digest('hex')))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(ctx.simulations.inspect({ ...input, spec: { ...input.spec, rulesVersion: 'different' } })).rejects.toThrow()
    unregister()
  } finally { await ctx.fiber.dispose(); await reader.close(); await h.close() }
})

it.each(['json', 'sqlite'] as const)('refuses bounded or malformed history instead of opening another writer (%s)', async (backend) => {
  const h = await createBusinessHarness(backend)
  const bounded = new LocalSimulationProvider({ name: 'local', root: h.root, backend, replayPageSize: 1,
    inspectionMaxEntries: 1, inspectionMaxBytes: 8192 }, () => {})
  const wrongMedium = new LocalSimulationProvider({ name: 'local', root: h.root,
    backend: backend === 'json' ? 'sqlite' : 'json', replayPageSize: 1 }, () => {})
  try {
    await h.run.setPhase('running', h.run.snapshot().revision)
    const input = { provider: 'local', spec: h.selection.spec }
    await expect(bounded.inspect(input)).rejects.toMatchObject({ code: 'invalid-value' })
    await expect(wrongMedium.inspect(input)).rejects.toThrow(/backend does not match/)
    await expect(h.provider.inspect({ ...input, provider: 'other' })).rejects.toThrow(/mismatch/)
    expect(h.run.snapshot().phase).toBe('running')
    if (backend === 'json') {
      await h.run.close()
      const journal = join(h.root, createHash('sha256').update(input.spec.runId).digest('hex'), 'journal', 'logs', 'c2ltdWxhdGlvbg.json')
      const before = await readFile(journal)
      await writeFile(journal, 'malformed')
      await expect(h.provider.inspect(input)).rejects.toMatchObject({ code: 'malformed-medium' })
      await writeFile(journal, before)
    }
  } finally { await bounded.close(); await wrongMedium.close(); await h.close() }
})

it('rejects unsupported registry inspection and closes admission without silently opening a run', async () => {
  const ctx = new Context()
  const h = await createBusinessHarness('json')
  try {
    await ctx.plugin(Simulations)
    const open = vi.fn()
    const release = ctx.simulations.registerProvider({ name: 'unsupported', open })
    const input = { provider: 'unsupported', spec: h.selection.spec }
    expect(() => ctx.simulations.resolveInspection(input)).toThrow(/does not support/)
    await expect(ctx.simulations.inspect(input)).rejects.toThrow(/does not support/)
    expect(open).not.toHaveBeenCalled()
    release()
    await h.provider.close()
    await expect(h.provider.inspect({ provider: 'local', spec: h.selection.spec })).rejects.toThrow(/closed/)
  } finally { await ctx.fiber.dispose(); await h.close() }
})

it('propagates a non-directory run path instead of treating it as an absent journal', async () => {
  const h = await createBusinessHarness('json')
  const root = await mkdtemp(join(process.cwd(), '.tmp', 'simulation-inspection-path-'))
  const path = join(root, createHash('sha256').update(h.selection.spec.runId).digest('hex'))
  await writeFile(path, 'not a run directory')
  const observer = new LocalSimulationProvider({ name: 'local', root, backend: 'json', replayPageSize: 1 }, () => {})
  try {
    await expect(observer.inspect({ provider: 'local', spec: h.selection.spec })).rejects.toMatchObject({ code: 'ENOTDIR' })
  } finally { await observer.close(); await h.close(); await rm(root, { recursive: true, force: true }) }
})
