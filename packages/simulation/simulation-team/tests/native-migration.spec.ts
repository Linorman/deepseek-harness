/** Offline conversion retains raw source and complete owner evidence; direct old-format open remains unsupported. */
import { readFile, mkdtemp, rm, stat } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { expect, it } from 'vitest'
import type { NativeWorldDomain } from '@clocky/clocky-simulation'
import { z } from 'zod'
import { NATIVE_101_RUNTIME_COMMIT, SimulationWorldDomainRegistry, simulationArchivePrefixSchema, simTimeSchema } from '@clocky/clocky-simulation'
import { LocalSimulationProvider } from '@clocky/clocky-simulation-local'
import { createWorldBackup } from '../src/backup.ts'
import { migrateWorldNative101, publishWorldNative101 } from '../src/native-migration.ts'
const fixture = z.object({ spec: simulationArchivePrefixSchema.shape.spec, entries: simulationArchivePrefixSchema.shape.entries,
  snapshot: z.record(z.string(), z.json()) }).parse(JSON.parse(await readFile(new URL('../../simulation-local/tests/fixtures/native101.json', import.meta.url), 'utf8')))
const limits = { maxBytes:1024*1024,maxEntries:1000,pageSize:16 }
function body() {
  return { version:1 as const,snapshot:fixture.snapshot,native:{ name:'simulation',version:101,entries:fixture.entries },
    owners:[{ name:'empty-team',version:2,entries:[] }],sessions:[],attachments:[],references:{
      run:{ runId:fixture.spec.runId,stream:{ name:'simulation',version:101 },firstSequence:0,cursor:z.number().parse(fixture.snapshot.revision) },
      team:{ stream:{ name:'empty-team',version:2 },firstSequence:0,cursor:-1 },channels:[],sessions:[] } }
}
it('retains exact raw bytes and unchanged owner records after independent source and target replay', async () => {
  const provider = new LocalSimulationProvider({ name:'offline',root:'.tmp/never-opened',backend:'json',replayPageSize:16 },()=>{},new SimulationWorldDomainRegistry<NativeWorldDomain>())
  const original = createWorldBackup(body(),limits), text=JSON.stringify(original)+'\n'
  const validators={ sourceRuntimeCommit:NATIVE_101_RUNTIME_COMMIT,source:async()=>fixture.snapshot,
    target:provider.validateArchivePrefix.bind(provider) }
  const directory = await mkdtemp(resolve('.tmp/native101-publish-'))
  try {
    const result=await migrateWorldNative101(text,limits,validators)
    expect(result.originalText).toBe(text)
    expect(result.converted.body.native.version).toBe(102)
    expect(result.converted.body.native.entries.slice(1)).toEqual(original.body.native.entries.slice(1))
    expect(result.converted.body.owners).toEqual(original.body.owners)
    expect(result.converted.body.snapshot).toEqual(fixture.snapshot)
    expect(result.losses).toEqual([])
    const receipt = await publishWorldNative101(directory, text, limits, validators)
    expect(await publishWorldNative101(directory, text, limits, validators)).toEqual(receipt)
    expect(await readFile(join(directory, `${receipt.sourceHash}.source.backup.json`), 'utf8')).toBe(text)
    expect((await stat(join(directory, `${receipt.targetHash}.backup.json`))).mode & 0o777).toBe(0o600)
    const proof = z.object({ originalHash: z.string(), outputHash: z.string(), snapshotHash: z.string() })
      .parse(JSON.parse(await readFile(join(directory, `${receipt.proofHash}.migration.json`), 'utf8')))
    expect(proof.originalHash).toBe(receipt.sourceHash)
    expect(proof.outputHash).toBe(receipt.targetHash)
    await expect(migrateWorldNative101(text,limits,{ ...validators,source:async()=>({ ...fixture.snapshot,time:'99' }) })).rejects.toThrow(/source replay differs/)
    await expect(migrateWorldNative101(text,limits,{ ...validators,target:prefix=>({ ...provider.validateArchivePrefix(prefix),time:simTimeSchema.parse('99') }) })).rejects.toThrow(/changes.*projection/)
    expect(JSON.stringify(original)+'\n').toBe(text)
  } finally { await provider.close(); await rm(directory, { recursive: true, force: true }) }
})
