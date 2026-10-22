/** Preregistered bounded long-horizon supply comparisons; human assessment is deferred by the user. */
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { environmentStateSchema, environmentRequestSchema, sampleEnvironment } from '../src/world-environment.ts'
import { simTimeSchema } from '../src/time.ts'
const directory = resolve('.agents/plans/2026-10-16-world-post-mvp/evidence/implementation')
const raw = await readFile(resolve(directory, 'c3-long-suite.json'), 'utf8')
const suite = z.object({ version: z.string(), horizons: z.array(z.number().int().min(1).max(4096)),
  scenarioSplits: z.object({ fixed: z.array(z.array(z.number().int().min(0).max(100)).min(1)),
    holdout: z.array(z.array(z.number().int().min(0).max(100)).min(1)) }),
  strategies: z.array(z.enum(['supply-fixed/1', 'supply-seasonal/1'])), initialState: z.record(z.string(), z.unknown()),
  comparisonLimit: z.string(), humanRubric: z.json() }).parse(JSON.parse(raw))
const trials = (['fixed', 'holdout'] as const).flatMap(split => suite.scenarioSplits[split].flatMap((cycle, scenario) =>
  suite.horizons.flatMap(horizon => suite.strategies.map((model, modelIndex) => {
    let state = environmentStateSchema.parse({ ...suite.initialState, model })
    const samples: ReturnType<typeof sampleEnvironment>[] = [], failures: string[] = []
    for (let step = 0; step < horizon; step += 1) {
      const input = environmentRequestSchema.parse({ scopeEntityId: 'experiment', targetEntityId: 'supply', demand: cycle[step % cycle.length] })
      try {
        const sample = sampleEnvironment(state, input, simTimeSchema.parse(String(step + 1)))
        if (sample.inventory !== state.inventory + sample.production - sample.consumed || sample.inventory < state.committed
          || sample.inventory > state.capacity || sample.production > state.sourceLimit || sample.consumed > state.sinkLimit)
          throw new Error(`Resource invariant violation at step ${step + 1}`)
        samples.push(sample); state = { ...state, inventory: sample.inventory, lastTime: sample.time }
      } catch (error) { failures.push(String(error)); break }
    }
    return { id: `${split}-${scenario + 1}-${horizon}-${modelIndex === 0 ? 'A' : 'B'}`, split, horizon, model, samples, failures,
      stop: failures.length ? 'failure' : 'registered-horizon', unmetDemand: samples.reduce((sum, sample) => sum + sample.demand - sample.consumed, 0),
      totalProduction: samples.reduce((sum, sample) => sum + sample.production, 0),
      totalConsumption: samples.reduce((sum, sample) => sum + sample.consumed, 0), finalInventory: state.inventory,
      privacy: { unexpectedPrivateInputRejected: !environmentRequestSchema.safeParse({ scopeEntityId: 'experiment', targetEntityId: 'supply', demand: 1, privateHistory: 'CANARY_PRIVATE_CONTEXT' }).success },
      factConsistency: samples.every(sample => sample.simulated), cost: { modelCalls: 0, tokens: 0, currency: null },
      humanEvaluation: { status: 'deferred-by-user', ratings: [] }, modelJudge: null }
  }))))
const report = { suiteVersion: suite.version, suiteSha256: createHash('sha256').update(raw).digest('hex'),
  comparisonLimit: suite.comparisonLimit, trials,
  failures: trials.flatMap(trial => trial.failures.map(message => ({ trial: trial.id, message }))),
  summary: trials.map(({ samples: _samples, ...trial }) => trial),
  humanAssessment: 'deferred-by-user', modelJudge: null,
  inference: 'Measured resource constraints hold for these registered cycles and horizons. No human credibility or general cognitive improvement is claimed.' }
await writeFile(resolve(directory, 'c3-long-results.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ trials: trials.length, samples: trials.reduce((sum, trial) => sum + trial.samples.length, 0),
  failures: report.failures, suiteSha256: report.suiteSha256, humanAssessment: report.humanAssessment }))
