import { randomUUID } from 'node:crypto'
/** Frozen same-operation comparison of local commit versus the original whole-run maintenance route. */
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { simulationDecisionIdSchema, simulationWindowRequestSchema } from '@clocky/clocky-simulation'
import { localObjectFixture } from './world-local-object-fixture.ts'
import { contextRequest } from './context-fixture.ts'
import { LocalObjectWorldExecution } from '../../simulation-world/src/local-object.ts'
import { LongitudinalMetrics } from './longitudinal-metrics.ts'

it.skipIf(process.env['CLOCKY_B3C_BENCHMARK'] !== '1')('compares identical rename plans without deleting history or increasing limits', async () => {
  const results = []
  for (const backend of ['json', 'sqlite'] as const) {
    const samples: ({
      repetition: number
      mode: 'local' | 'maintenance'
      elapsedMs: number
      rss: number
      modelCalls: number
      beforeRevision: number
      afterRevision: number
    } & ReturnType<LongitudinalMetrics['sample']>)[] = []
    for (let repetition = 0; repetition < 7; repetition++) {
      for (const mode of ['local', 'maintenance'] as const) {
        const h = await localObjectFixture(backend)
        try {
          const second = await h.request(h.targets[1]!), metrics = new LongitudinalMetrics(h.ctx)
          const id = simulationDecisionIdSchema.parse('unrelated-window')
          const window = await h.run.openWindow(simulationWindowRequestSchema.parse({ id: 'benchmark-window', decisions: [{
            id, entityId: h.requester, context: { ...contextRequest(), world: { kind: 'request', intentId: second.request.intentId } },
          }] }), h.run.snapshot().revision)
          const before = h.run.snapshot()
          // The control adapter advertises no local capability; all actual mutations still use the same Native owner.
          const conservative = new Proxy(h.run, { get(target, key) {
            if (key === 'inspectLocalObjectMutation') return undefined
            const value: unknown = Reflect.get(target, key)
            return typeof value === 'function' ? (...args: unknown[]): unknown => Reflect.apply(value, target, args) : value
          } })
          const handler = mode === 'local' ? h.handler : new LocalObjectWorldExecution(conservative, h.connection,
            { checkpointId: 'unused' as never, ownerName: 'control', maxDrainRounds: 4, maxAttempts: 3 }, h.lifetime.signal)
          const started = performance.now()
          await handler.execute(h.plan)
          const elapsedMs = performance.now() - started, after = h.run.snapshot()
          expect(after.entities[h.targets[0]!]!.profile.name).toBe(h.first.input.name)
          expect(Object.keys(after.entities)).toEqual(Object.keys(before.entities))
          expect(after.spec).toEqual(before.spec)
          if (mode === 'local') {
            expect(after.activeWindowId).toBe(window.id)
            expect(Object.keys(after.maintenance ?? {})).toHaveLength(0)
          }
          samples.push({ repetition, mode, elapsedMs, rss: process.memoryUsage().rss, modelCalls: h.requests.length,
            beforeRevision: before.revision, afterRevision: after.revision, ...metrics.sample(after) })
        } finally { await h.close() }
      }
    }
    const median = (mode: string) => samples.filter(value => value.mode === mode).map(value => value.elapsedMs).sort((a, b) => a - b)[3]!
    results.push({ backend, samples, localP50Ms: median('local'), maintenanceP50Ms: median('maintenance'),
      ratio: median('local') / median('maintenance') })
  }
  const artifact = JSON.stringify({ results }, null, 2) + '\n'
  const directory = '.agents/plans/2026-10-16-world-post-mvp/evidence/b3c'
  await writeFile(resolve(directory, `benchmark-${Date.now()}-${randomUUID()}.json`), artifact, { flag: 'wx' })
  await writeFile(resolve(directory, 'benchmark.json'), artifact)
}, 120000)
