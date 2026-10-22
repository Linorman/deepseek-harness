import { randomUUID } from 'node:crypto'
import { baselineInspection } from './inspection-baseline.ts'
/** Frozen B1 workload compares cold replay and warm exact-prefix inspection through the real provider. */
import { performance } from 'node:perf_hooks'
import { cpus, platform, arch } from 'node:os'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { z } from 'zod'
import { simulationChangeSchema } from '@clocky/clocky-simulation'
import { LocalSimulationProvider } from '../src/index.ts'
import { createBusinessHarness } from './business-harness.ts'

it.skipIf(process.env['CLOCKY_B1_BENCHMARK'] !== '1')('records fixed readonly index workload without removing history', async () => {
  const directory = resolve('.agents/plans/2026-10-16-world-post-mvp/evidence/b1')
  const workload = z.strictObject({ version: z.literal(1), date: z.string(), scope: z.string(), backends: z.array(z.enum(['json', 'sqlite'])),
    entities: z.number().int().positive(), profileUpdates: z.number().int().positive(), repetitions: z.number().int().positive(),
    warmup: z.number().int().nonnegative(), mode: z.literal('source'), modelPolicy: z.string(), limitations: z.array(z.string()),
    target: z.strictObject({ warmP50RatioMaximum: z.number().positive(),
      identicalSnapshots: z.literal(true), unchangedHistory: z.literal(true) }),
  }).parse(JSON.parse(await readFile(resolve(directory, 'index-workload.json'), 'utf8')))
  const results = []
  for (const backend of ['json', 'sqlite'] as const) {
    const h = await createBusinessHarness(backend, { maxEntities: 1024 })
    try {
      const creates = Array.from({ length: workload.entities }, (_, index) => simulationChangeSchema.parse({
        kind: 'entity/create', id: `entity-${index}`, entityKind: 'org', cognition: 'none', readiness: 'ready', profile: { name: `Name ${index}` },
      }))
      await h.run.changeMany(creates, h.run.snapshot().revision)
      for (let index = 0; index < workload.profileUpdates; index++) {
        await h.run.change(simulationChangeSchema.parse({ kind: 'entity/profile', id: `entity-${index % workload.entities}`,
          entityRevision: h.run.snapshot().entities[`entity-${index % workload.entities}` as never]!.revision, profile: { name: `Updated ${index}` } }), h.run.snapshot().revision)
      }
      const original = h.run.snapshot()
      const selection = { provider: 'local', spec: h.selection.spec }
      const warm = new LocalSimulationProvider({ name: 'local', root: h.root, backend, replayPageSize: 32 }, () => {})
      const rebuildStart = performance.now()
      await warm.rebuildInspectionIndex(selection)
      const rebuildMs = performance.now() - rebuildStart
      const samples: { baselineMs: number; coldMs: number; warmMs: number; rss: number }[] = []
      try {
        for (let index = 0; index < workload.repetitions + workload.warmup; index++) {
          const cold = new LocalSimulationProvider({ name: 'local', root: h.root, backend, replayPageSize: 32 }, () => {})
          try {
            const baselineStart = performance.now()
            const baselineObservation = await baselineInspection(h.root, backend, selection, h.provider.worldDomains)
            const baselineMs = performance.now() - baselineStart
            const coldStart = performance.now(), coldObservation = await cold.inspect(selection), coldMs = performance.now() - coldStart
            const warmStart = performance.now(), warmObservation = await warm.inspect(selection), warmMs = performance.now() - warmStart
            expect(baselineObservation?.snapshot).toEqual(original)
            expect(coldObservation?.snapshot).toEqual(original)
            expect(warmObservation?.snapshot).toEqual(original)
            if (index >= workload.warmup) samples.push({ baselineMs, coldMs, warmMs, rss: process.memoryUsage().rss })
          } finally { await cold.close() }
        }
      } finally { await warm.close() }
      const percentile = (key: 'baselineMs' | 'coldMs' | 'warmMs', fraction: number) => samples.map(sample => sample[key]).sort((a, b) => a - b)[Math.ceil(samples.length * fraction) - 1]!
      results.push({ backend, revision: original.revision, entities: Object.keys(original.entities).length,
        rebuildMs, modelCalls: 0, tokenUsage: 0, cost: 0, samples,
        baselineP50Ms: percentile('baselineMs', .5), baselineP95Ms: percentile('baselineMs', .95), baselineP99Ms: percentile('baselineMs', .99),
        warmToBaselineRatio: percentile('warmMs', .5) / percentile('baselineMs', .5),
        baselineTargetPassed: percentile('warmMs', .5) / percentile('baselineMs', .5) <= workload.target.warmP50RatioMaximum,
        coldP50Ms: percentile('coldMs', .5), warmP50Ms: percentile('warmMs', .5),
        coldP95Ms: percentile('coldMs', .95), warmP95Ms: percentile('warmMs', .95),
        coldP99Ms: percentile('coldMs', .99), warmP99Ms: percentile('warmMs', .99),
        warmP50Ratio: percentile('warmMs', .5) / percentile('coldMs', .5) })
      expect(h.run.snapshot()).toEqual(original)
    } finally { await h.close() }
  }
  const artifact = JSON.stringify({ workload, control: 'Pre-index bounded read/fold/assert/owner strategy, with current parsers and limits', host: {
    platform: platform(), arch: arch(), cpu: cpus()[0]?.model, node: process.version }, results }, null, 2) + '\n'
  await writeFile(resolve(directory, `index-benchmark-${Date.now()}-${randomUUID()}.json`), artifact, { flag: 'wx' })
  await writeFile(resolve(directory, 'index-benchmark.json'), artifact)
}, 120000)
