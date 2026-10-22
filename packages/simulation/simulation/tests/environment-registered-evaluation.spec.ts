/** Evaluator failures must remain visible rather than silently dropping unfavorable traces. */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { sampleEnvironment } from '../src/world-environment.ts'
import { evaluateRegisteredEnvironment, registeredEnvironmentSuiteSchema } from './environment-registered-evaluation.ts'

const raw: unknown = JSON.parse(await readFile(resolve('.agents/plans/2026-10-16-world-post-mvp/evidence/implementation/c3-v2-suite.json'), 'utf8'))
const suite = registeredEnvironmentSuiteSchema.parse(raw)
describe('registered environment assessment', () => {
  it('reports all fixed and held-out pairs, resource costs and honest rating provenance', () => {
    const result = evaluateRegisteredEnvironment(suite)
    expect(result.trials).toHaveLength(24)
    expect(result.pairs).toHaveLength(12)
    expect(result.trials.reduce((sum, trial) => sum + trial.samples.length, 0)).toBe(5376)
    expect(result.failures).toEqual([])
    expect(result.privacy.every(probe => probe.rejected)).toBe(true)
    expect(result.pairs.filter(pair => pair.split === 'holdout').every(pair => pair.complete && pair.unmetDemandDelta < 0 && pair.productionDelta > 0)).toBe(true)
    expect(result.assessment.human).toEqual({ source: null, status: 'deferred-by-user', ratings: [] })
    expect(result.assessment.modelJudge).toBe(null)
    expect(result.trials.every(trial => trial.cost.inferenceCalls === 0 && trial.stop === 'registered-horizon')).toBe(true)
  })

  it('retains each exception and offending sample while completing every other registered trial', () => {
    const exceptions = evaluateRegisteredEnvironment(suite, (state, input, time) => {
      if (state.model === suite.treatment && time === '2') throw new Error('Injected sampler failure')
      return sampleEnvironment(state, input, time)
    })
    expect(exceptions.trials).toHaveLength(24)
    expect(exceptions.failures).toHaveLength(12)
    expect(exceptions.pairs.every(pair => !pair.complete)).toBe(true)
    expect(exceptions.trials.filter(trial => trial.role === 'control')
      .every(trial => trial.stop === 'registered-horizon')).toBe(true)
    expect(exceptions.failures.every(failure => failure.step === 2 && failure.kind === 'exception')).toBe(true)

    const invalid = evaluateRegisteredEnvironment(suite, (state, input, time) =>
      ({ ...sampleEnvironment(state, input, time), inventory: 1 }))
    expect(invalid.failures).toHaveLength(24)
    expect(invalid.trials.every(trial => trial.samples.length === 1 && trial.samples[0]!.inventory === 1)).toBe(true)
    expect(invalid.failures.every(failure => failure.kind === 'constraint')).toBe(true)
  })

  it('rejects ambiguous comparisons and unregistered private input before sampling', () => {
    expect(() => evaluateRegisteredEnvironment({ ...suite, privateHistory: 'CANARY' })).toThrow()
    expect(() => evaluateRegisteredEnvironment({ ...suite, treatment: suite.control })).toThrow()
    expect(() => evaluateRegisteredEnvironment({ ...suite, splits: { fixed: suite.splits.fixed, holdout: suite.splits.fixed } })).toThrow()
    expect(() => evaluateRegisteredEnvironment({ ...suite, initialState: { ...suite.initialState, lastTime: '2' } })).toThrow()
  })
})
