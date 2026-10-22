/** Resource evaluation only: retain failed samples and keep automated checks separate from human ratings. */
import { z } from 'zod'
import { environmentRequestSchema, environmentStateSchema, sampleEnvironment } from '../src/world-environment.ts'
import { simTimeSchema } from '../src/time.ts'

const model = z.enum(['supply-fixed/1', 'supply-seasonal/1'])
const scenario = z.strictObject({ id: z.string().min(1), demands: z.array(z.number().int().min(0).max(100)).min(1).max(64) })
/** On-disk registration is parsed before its hashes or time are trusted. */
export const environmentRegistrationSchema = z.strictObject({ registeredAt: z.iso.datetime(), suiteVersion: z.literal('supply-registered-evaluation/2'),
  sources: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/)), executionMode: z.string().min(1),
  command: z.strictObject({ executable: z.string().min(1), args: z.array(z.string()), cwd: z.string().min(1) }),
  priorExposure: z.string().min(1) })
/** Frozen experiment inputs reject unknown fields, duplicate scenarios and ambiguous control assignment. */
export const registeredEnvironmentSuiteSchema = z.strictObject({
  version: z.literal('supply-registered-evaluation/2'),
  control: model, treatment: model,
  splits: z.strictObject({ fixed: z.array(scenario).min(1).max(16), holdout: z.array(scenario).min(1).max(16) }),
  horizons: z.array(z.number().int().min(1).max(512)).min(1).max(4),
  initialState: environmentStateSchema,
  intervention: z.string().min(1), exposure: z.string().min(1),
  rubric: z.strictObject({ version: z.literal('supply-review/2'),
    quality: z.literal('Report unmet demand and total production together; lower shortage alone does not establish efficiency.'),
    constraints: z.literal('Every actual sample must conserve stock, cover commitments and obey source/sink bounds.'),
    privacy: z.literal('Reject private history and caller-authored sample fields; no Session disclosure claim follows from parser probes.'),
    human: z.literal('pass/fail/unclear with trial and step references for conservation, provenance, explanation and unsupported realism claims'),
  }),
  humanAssessment: z.literal('deferred-by-user'), modelJudge: z.null(),
  stochasticity: z.literal('Deterministic installed algorithms; no seed or live-model reproducibility claim.'),
}).superRefine((value, ctx) => {
  if (value.control === value.treatment) ctx.addIssue({ code: 'custom', message: 'Control and treatment must differ' })
  const ids = [...value.splits.fixed, ...value.splits.holdout].map(item => item.id)
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: 'Scenario IDs must be unique across splits' })
  if (new Set(value.horizons).size !== value.horizons.length) ctx.addIssue({ code: 'custom', message: 'Horizons must be unique' })
  if (value.initialState.lastTime !== null || value.initialState.step !== 1)
    ctx.addIssue({ code: 'custom', message: 'Evaluation starts at time zero with unit steps' })
})

/** Execute every registered pair, preserving the offending sample when an invariant fails.
 * @param input - Frozen, strictly parsed suite; unrelated private fields reject.
 * @param sampler - Production rule by default; fault injection is confined to harness tests.
 * @returns Raw samples, explicit stops, paired resource differences and uncollected rating provenance.
 */
export function evaluateRegisteredEnvironment(input: unknown, sampler: typeof sampleEnvironment = sampleEnvironment) {
  const suite = registeredEnvironmentSuiteSchema.parse(input)
  const trials = (['fixed', 'holdout'] as const).flatMap(split => suite.splits[split].flatMap(scenario =>
    suite.horizons.flatMap(horizon => (['control', 'treatment'] as const).map((role) => {
      const model = suite[role]
      let state = environmentStateSchema.parse({ ...suite.initialState, model })
      const samples: ReturnType<typeof sampleEnvironment>[] = []
      const failures: { step: number; kind: 'exception' | 'constraint'; message: string }[] = []
      for (let step = 1; step <= horizon; step += 1) {
        const request = environmentRequestSchema.parse({ scopeEntityId: 'evaluation', targetEntityId: 'supply',
          demand: scenario.demands[(step - 1) % scenario.demands.length] })
        let sample: ReturnType<typeof sampleEnvironment>
        try { sample = sampler(state, request, simTimeSchema.parse(String(step))) }
        catch (error) {
          failures.push({ step, kind: 'exception', message: String(error) })
          break
        }
        samples.push(sample)
        if (sample.inventory !== state.inventory + sample.production - sample.consumed
          || sample.previousInventory !== state.inventory || sample.inventory < state.committed
          || sample.inventory > state.capacity || sample.production < 0 || sample.production > state.sourceLimit
          || sample.consumed < 0 || sample.consumed > state.sinkLimit || sample.consumed > request.demand
          || sample.demand !== request.demand || sample.scopeEntityId !== request.scopeEntityId
          || sample.targetEntityId !== request.targetEntityId
          || sample.time !== String(step) || sample.implementation !== model || !sample.simulated) {
          failures.push({ step, kind: 'constraint', message: 'Conservation, bounds or simulated provenance differs from accepted inputs' })
          break
        }
        state = { ...state, inventory: sample.inventory, lastTime: sample.time }
      }
      return { id: `${split}/${scenario.id}/${horizon}/${role}`, scenario: scenario.id, split, role, model, horizon,
        samples, failures, stop: failures.length ? 'failure' : 'registered-horizon',
        quality: { unmetDemand: samples.reduce((sum, sample) => sum + sample.demand - sample.consumed, 0),
          totalDemand: samples.reduce((sum, sample) => sum + sample.demand, 0),
          totalProduction: samples.reduce((sum, sample) => sum + sample.production, 0),
          totalConsumption: samples.reduce((sum, sample) => sum + sample.consumed, 0), finalInventory: state.inventory },
        cost: { inferenceCalls: 0, inputTokens: 0, outputTokens: 0, providerCurrency: null,
          note: 'No inference path exists in this harness; production is reported as a separate simulated resource cost.' } }
    }))))
  const pairs = trials.filter(trial => trial.role === 'control').map((control) => {
    const treatment = trials.find(trial => trial.scenario === control.scenario && trial.horizon === control.horizon && trial.role === 'treatment')!
    return { split: control.split, scenario: control.scenario, horizon: control.horizon,
      control: control.id, treatment: treatment.id, complete: control.failures.length === 0 && treatment.failures.length === 0,
      unmetDemandDelta: treatment.quality.unmetDemand - control.quality.unmetDemand,
      productionDelta: treatment.quality.totalProduction - control.quality.totalProduction }
  })
  const request = { scopeEntityId: 'evaluation', targetEntityId: 'supply', demand: 1 }
  const privacy = [
    { id: 'private-history', rejected: !environmentRequestSchema.safeParse({ ...request, privateHistory: 'CANARY_PRIVATE_CONTEXT' }).success },
    { id: 'caller-sample', rejected: !environmentRequestSchema.safeParse({ ...request, production: 100, simulated: false }).success },
    { id: 'private-state', rejected: !environmentStateSchema.safeParse({ ...suite.initialState, privateHistory: 'CANARY_PRIVATE_CONTEXT' }).success },
  ]
  return { suiteVersion: suite.version, trials, pairs, privacy,
    failures: trials.flatMap(trial => trial.failures.map(failure => ({ trial: trial.id, ...failure }))),
    assessment: { automated: { source: 'installed deterministic rules and arithmetic/schema probes', rubricVersion: suite.rubric.version },
      human: { source: null, status: suite.humanAssessment, ratings: [] }, modelJudge: suite.modelJudge },
    stochasticity: suite.stochasticity,
    limits: 'Resource-only comparison on registered demand cycles. Human credibility, causal plausibility, role differences, Session privacy and general cognition remain unscored.' }
}
