/** Execute a preregistered, bounded deterministic supply comparison and preserve every raw trajectory. */
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { z } from 'zod'
import { environmentStateSchema, environmentRequestSchema, sampleEnvironment } from '../src/world-environment.ts'
import { simTimeSchema } from '../src/time.ts'
const directory = resolve('.agents/plans/2026-10-16-world-post-mvp/evidence/implementation')
const raw = await readFile(resolve(directory, 'c3-suite.json'), 'utf8')
const suite = z.object({ version: z.string(), scenarioSplits: z.object({ fixed: z.array(z.array(z.number().int().min(0).max(100))),
  holdout: z.array(z.array(z.number().int().min(0).max(100))) }), strategies: z.array(z.enum(['supply-fixed/1', 'supply-seasonal/1'])),
humanRubric: z.unknown(), initialState: z.record(z.string(), z.unknown()) }).parse(JSON.parse(raw))
const configuration = suite
const trials = (['fixed', 'holdout'] as const).flatMap(split => suite.scenarioSplits[split].flatMap((demands, scenario) =>
  suite.strategies.map((model, strategy) => {
    let state = environmentStateSchema.parse({ ...configuration.initialState, model })
    const samples: ReturnType<typeof sampleEnvironment>[] = [], failures: string[] = []
    for (const [index, demand] of demands.entries()) {
      try {
        const sample = sampleEnvironment(state, environmentRequestSchema.parse({ scopeEntityId: 'evaluation', targetEntityId: 'supply', demand }), simTimeSchema.parse(String(index + 1)))
        if (sample.inventory < state.committed || sample.inventory > state.capacity || sample.production > state.sourceLimit
          || sample.consumed > state.sinkLimit || sample.inventory !== state.inventory + sample.production - sample.consumed)
          throw new Error(`Stock invariant failed at step ${index + 1}`)
        samples.push(sample); state = { ...state, inventory: sample.inventory, lastTime: sample.time }
      } catch (error) { failures.push(String(error)); break }
    }
    return { trial: `${split}-${scenario + 1}-${strategy === 0 ? 'A' : 'B'}`, split, model,
      samples, unmetDemand: samples.reduce((sum, sample) => sum + sample.demand - sample.consumed, 0), failures,
      stop: failures.length ? 'failure' : 'completed', cost: { modelCalls: 0, tokens: 0, currency: null },
      privacy: 'no-personal-input', factConsistency: 'simulated-only', humanJudgments: null, modelJudge: null }
  })))
const report = { suiteVersion: suite.version, suiteSha256: createHash('sha256').update(raw).digest('hex'), trials,
  inference: 'This finite deterministic comparison measures stock invariants and unmet demand only; no general cognitive or human credibility improvement is established.',
  failedTrials: trials.filter(t => t.failures.length).map(t => t.trial), humanAssessment: 'pending', modelJudge: null }
await writeFile(resolve(directory, 'c3-results.json'), JSON.stringify(report, null, 2) + '\n')
const anonymous = trials.map(({ model: _model, ...trial }) => ({ ...trial,
  samples: trial.samples.map(({ implementation: _implementation, ...sample }) => sample) }))
await writeFile(resolve(directory, 'c3-human-review.json'), JSON.stringify({ rubric: suite.humanRubric,
  instructions: 'Review traces before consulting c3-results.json, which contains the A/B implementation mapping. A/B masking is not a claim of randomized double-blind assessment.',
  trajectories: anonymous, ratings: [] }, null, 2) + '\n')
console.log(JSON.stringify({ trials: trials.length, failedTrials: report.failedTrials, humanAssessment: 'pending', suiteSha256: report.suiteSha256 }))
