/** Fixed old-runtime fixture exercises conversion provenance without making 101 an ordinary supported backend format. */
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { expect, it } from 'vitest'
import type { NativeWorldDomain } from '@clocky/clocky-simulation'
import { z } from 'zod'
import { simulationArchivePrefixSchema, NATIVE_101_RUNTIME_COMMIT } from '@clocky/clocky-simulation'
import { LocalSimulationProvider } from '../src/index.ts'
import { NativeWorldRuntime } from '../src/world-runtime.ts'
import { SimulationWorldDomainRegistry } from '@clocky/clocky-simulation'
import { foldEntry, foldEntries } from '../src/journal.ts'
const source = z.object({ spec: simulationArchivePrefixSchema.shape.spec, entries: simulationArchivePrefixSchema.shape.entries,
  snapshot: z.record(z.string(), z.json()) }).parse(JSON.parse(await readFile(new URL('./fixtures/native101.json', import.meta.url), 'utf8')))
function target() {
  const entries = structuredClone(source.entries)
  const first = entries[0]
  if (first === undefined) throw new Error('Missing fixture creation')
  first.value = z.json().parse({ ...z.record(z.string(), z.json()).parse(first.value), migration: { format: 'native101-to102/1', sourceVersion: 101, targetVersion: 102,
    sourceRuntimeCommit: NATIVE_101_RUNTIME_COMMIT, sourceRevision: entries.length - 1,
    sourceHash: createHash('sha256').update(JSON.stringify({ name: 'simulation', version: 101, entries: source.entries })).digest('hex'), contexts: [] } })
  return simulationArchivePrefixSchema.parse({ version: 102, spec: source.spec, entries })
}
it('replays a real pinned-101 fixture unchanged under a verified conversion, refusing ordinary 101 and mutated/truncated provenance', async () => {
  const registry = new SimulationWorldDomainRegistry<NativeWorldDomain>()
  const provider = new LocalSimulationProvider({ name:'offline',root:'.tmp/never-opened',backend:'json',replayPageSize:4 },()=>{}, registry)
  try {
    const converted = target(), original = JSON.stringify(source)
    expect(provider.validateArchivePrefix(converted)).toEqual(source.snapshot)
    expect(() => provider.validateArchivePrefix({ ...converted,version:101 })).toThrow(/unsupported/)
    expect(() => provider.validateArchivePrefix({ ...converted,entries:converted.entries.slice(0,-1) })).toThrow(/missing/)
    const changed = target()
    Object.assign(changed.entries[0]!.value!, { migration: { ...source, sourceRuntimeCommit:'changed' } })
    expect(() => provider.validateArchivePrefix(changed)).toThrow()
    const runtime = new NativeWorldRuntime(registry), first = converted.entries[0]!
    try {
      const state = foldEntry(undefined, first, converted.spec, 'json', runtime)
      const suffix = structuredClone(converted.entries.slice(1))
      suffix[0]!.value = { kind:'run/phase',phase:'paused' }
      expect(() => foldEntries(state,suffix,converted.spec,'json',runtime)).toThrow()
    } finally { runtime.close() }
    expect(JSON.stringify(source)).toBe(original)
  } finally { await provider.close() }
})
