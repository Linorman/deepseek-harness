/** Preregistered deterministic holdout comparison; automated scores are not human judgments. */
import { describe, expect, it } from 'vitest'
import { environmentRequestSchema, environmentStateSchema, sampleEnvironment } from '../src/world-environment.ts'
import { simTimeSchema } from '../src/time.ts'

const suite = Object.freeze({ version: 'supply-evaluation/1', metric: 'unmet-demand',
  fixed: [2, 3, 4, 3], holdout: [5, 1, 6, 2], rubric: 'Inventory covers obligations; sources and sinks remain bounded.',
  models: ['supply-fixed/1', 'supply-seasonal/1'] as const, humanJudgments: null, modelJudge: null })
describe('registered fixed and holdout supply comparison', () => {
  it('reports every trial, actual samples, costs and limits without claiming human quality', () => {
    const trials = (['fixed', 'holdout'] as const).flatMap(split => suite.models.map((model) => {
      let state = environmentStateSchema.parse({ model, generation: 1, inventory: 6, committed: 2,
        capacity: 20, sourceLimit: 3, sinkLimit: 6, step: 1, lastTime: null })
      const samples = suite[split].map((demand, index) => {
        const sample = sampleEnvironment(state, environmentRequestSchema.parse({ scopeEntityId: 'lab', targetEntityId: 'supply', demand }),
          simTimeSchema.parse(String(index + 1)))
        expect(sample.inventory).toBeGreaterThanOrEqual(state.committed)
        expect(sample.production).toBeLessThanOrEqual(state.sourceLimit)
        expect(sample.consumed).toBeLessThanOrEqual(state.sinkLimit)
        state = { ...state, inventory: sample.inventory, lastTime: sample.time }
        return sample
      })
      return { split, model, samples, unmet: samples.reduce((sum, s) => sum + s.demand - s.consumed, 0),
        modelCalls: 0, tokens: 0, failures: [], stop: 'completed', privacy: 'no-personal-input',
        factConsistency: 'simulated-only', humanJudgments: null, modelJudge: null }
    }))
    expect(trials.map(({ samples: _samples, ...trial }) => trial)).toMatchInlineSnapshot(`
      [
        {
          "factConsistency": "simulated-only",
          "failures": [],
          "humanJudgments": null,
          "model": "supply-fixed/1",
          "modelCalls": 0,
          "modelJudge": null,
          "privacy": "no-personal-input",
          "split": "fixed",
          "stop": "completed",
          "tokens": 0,
          "unmet": 0,
        },
        {
          "factConsistency": "simulated-only",
          "failures": [],
          "humanJudgments": null,
          "model": "supply-seasonal/1",
          "modelCalls": 0,
          "modelJudge": null,
          "privacy": "no-personal-input",
          "split": "fixed",
          "stop": "completed",
          "tokens": 0,
          "unmet": 0,
        },
        {
          "factConsistency": "simulated-only",
          "failures": [],
          "humanJudgments": null,
          "model": "supply-fixed/1",
          "modelCalls": 0,
          "modelJudge": null,
          "privacy": "no-personal-input",
          "split": "holdout",
          "stop": "completed",
          "tokens": 0,
          "unmet": 0,
        },
        {
          "factConsistency": "simulated-only",
          "failures": [],
          "humanJudgments": null,
          "model": "supply-seasonal/1",
          "modelCalls": 0,
          "modelJudge": null,
          "privacy": "no-personal-input",
          "split": "holdout",
          "stop": "completed",
          "tokens": 0,
          "unmet": 3,
        },
      ]
    `)
  })
})
