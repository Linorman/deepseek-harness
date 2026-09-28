import { describe, expect, it } from 'vitest'
import { parseSimulationBenchmarkOptions } from './simulation-benchmark-options.ts'

const args = ['--backend', 'sqlite', '--workload', 'ingress', '--entities', '10', '--operations', '100',
  '--duration-ms', '1000', '--timeout-ms', '10000', '--sample-every', '10', '--entity-batch-size', '5', '--replay-page-size', '4', '--output', '.tmp/benchmark']
describe('Simulation benchmark bounds', () => {
  it.each([['--entities', '0'], ['--replay-page-size', '0'], ['--operations', '1.5'], ['--timeout-ms', '1000'], ['--timeout-ms', '2147483648'],
    ['--workload', 'model'], ['--backend', 'remote'], ['--output', '../outside']])('rejects %s=%s before boot', (name, value) => {
    const input = [...args]
    input[input.indexOf(name) + 1] = value
    expect(() => parseSimulationBenchmarkOptions(input)).toThrow()
  })
  it.each([['--models', '5'], ['--residents', '11'], ['--model-delay-ms', '1001']])
  ('rejects inconsistent actor bounds %s=%s', (name, value) => {
    const input = [...args, '--residents', '4', '--models', '2', '--model-delay-ms', '10']
    input[input.indexOf('--workload') + 1] = 'actors'
    input[input.indexOf(name) + 1] = value
    expect(() => parseSimulationBenchmarkOptions(input)).toThrow(/requires/)
  })
  it('requires actor controls and refuses them on a storage workload', () => {
    const input = [...args]
    input[input.indexOf('--workload') + 1] = 'actors'
    expect(() => parseSimulationBenchmarkOptions(input)).toThrow(/residents/)
    expect(() => parseSimulationBenchmarkOptions([...args, '--models', '1'])).toThrow(/only/)
  })
  it.each([['--residents', '1'], ['--models', '2']])('rejects invalid serial delivery bounds %s=%s', (name, value) => {
    const input = [...args, '--residents', '2', '--models', '1', '--model-delay-ms', '10']
    input[input.indexOf('--workload') + 1] = 'messages'
    input[input.indexOf(name) + 1] = value
    expect(() => parseSimulationBenchmarkOptions(input)).toThrow(/Message workload/)
  })
  it.each([['--residents', '2'], ['--models', '3']])('rejects invalid parallel delivery bounds %s=%s', (name, value) => {
    const input = [...args, '--residents', '4', '--models', '2', '--model-delay-ms', '10']
    input[input.indexOf('--workload') + 1] = 'parallel-messages'
    input[input.indexOf(name) + 1] = value
    expect(() => parseSimulationBenchmarkOptions(input)).toThrow(/Parallel messages/)
  })
  it('requires a positive explicit world batch and rejects it for other workloads', () => {
    const input = [...args]
    input[input.indexOf('--workload') + 1] = 'world'
    expect(() => parseSimulationBenchmarkOptions(input)).toThrow(/world-batch-size/)
    for (const value of ['0', '1.5', 'Infinity']) {
      expect(() => parseSimulationBenchmarkOptions([...input, '--world-batch-size', value])).toThrow(/world-batch-size/)
    }
    expect(parseSimulationBenchmarkOptions([...input, '--world-batch-size', '20'])).toMatchObject({ workload: 'world', worldBatchSize: 20 })
    expect(() => parseSimulationBenchmarkOptions([...args, '--world-batch-size', '20'])).toThrow(/only/)
  })
  it('requires coherent organization counts and keeps its workload model-free', () => {
    const input = [...args, '--departments', '2', '--managers', '2', '--days', '3', '--residents', '2']
    input[input.indexOf('--workload') + 1] = 'organization'
    input[input.indexOf('--operations') + 1] = '18'
    expect(parseSimulationBenchmarkOptions(input)).toMatchObject({ workload: 'organization', entities: 10,
      departments: 2, managers: 2, days: 3, residents: 2, operations: 18 })
    for (const [name, value] of [['--entities', '4'], ['--managers', '1'], ['--operations', '19'], ['--residents', '9'],
      ['--days', '9007199254740991'], ['--departments', '0']]) {
      const invalid = [...input]
      invalid[invalid.indexOf(name!) + 1] = value!
      expect(() => parseSimulationBenchmarkOptions(invalid)).toThrow()
    }
    for (const name of ['--departments', '--managers', '--days', '--residents']) {
      const invalid = [...input]
      invalid.splice(invalid.indexOf(name), 2)
      expect(() => parseSimulationBenchmarkOptions(invalid)).toThrow()
    }
    expect(() => parseSimulationBenchmarkOptions([...input, '--models', '1'])).toThrow(/without model controls/)
    expect(() => parseSimulationBenchmarkOptions([...input, '--model-delay-ms', '1'])).toThrow(/without model controls/)
    expect(() => parseSimulationBenchmarkOptions([...args, '--days', '3'])).toThrow(/only/)
  })
  it('requires explicit world history bounds for combined cognition and rejects them elsewhere', () => {
    const input = [...args, '--residents', '4', '--models', '2', '--model-delay-ms', '10']
    input[input.indexOf('--workload') + 1] = 'actors-world'
    expect(() => parseSimulationBenchmarkOptions(input)).toThrow(/world-events/)
    expect(() => parseSimulationBenchmarkOptions([...input, '--world-events', '17'])).toThrow(/world-batch-size/)
    expect(parseSimulationBenchmarkOptions([...input, '--world-events', '17', '--world-batch-size', '5']))
      .toMatchObject({ workload: 'actors-world', worldEvents: 17, worldBatchSize: 5, residents: 4, models: 2 })
    expect(() => parseSimulationBenchmarkOptions([...input, '--world-events', '0', '--world-batch-size', '5'])).toThrow(/world-events/)
    expect(() => parseSimulationBenchmarkOptions([...args, '--world-events', '17'])).toThrow(/only/)
  })
  it('requires every resource and time bound explicitly', () => {
    for (let index = 0; index < args.length; index += 2) {
      expect(() => parseSimulationBenchmarkOptions([...args.slice(0, index), ...args.slice(index + 2)])).toThrow()
    }
  })
})

const liveArgs = ['--backend', 'sqlite', '--workload', 'live-model', '--entities', '1', '--operations', '1',
  '--duration-ms', '1000', '--timeout-ms', '10000', '--sample-every', '1', '--entity-batch-size', '1', '--replay-page-size', '1',
  '--output', '.tmp/live', '--endpoint', 'http://localhost:1234/v1', '--model', 'chosen-model', '--token-budget', '10000',
  '--reasoning-effort', 'high', '--thinking-format', 'deepseek',
  '--tokens-per-request', '1000', '--max-output-tokens', '128', '--max-model-calls', '3', '--context-window', '8192']
it('keeps live inference opt-in with explicit admission and output budgets', () => {
  expect(parseSimulationBenchmarkOptions(liveArgs)).toMatchObject({ workload: 'live-model', tokenBudget: 10000, maxModelCalls: 3,
    reasoningEffort: 'high', thinkingFormat: 'deepseek' })
  expect(() => parseSimulationBenchmarkOptions([...args, '--model', 'chosen-model'])).toThrow(/only to live-model/)
})
it.each([['--token-budget', '0'], ['--token-budget', '500'], ['--max-output-tokens', '1001'],
  ['--context-window', '1'], ['--max-model-calls', '0'], ['--model', ''], ['--entities', '2'], ['--operations', '2'],
  ['--endpoint', 'https://user:secret@example.com'], ['--endpoint', 'https://example.com?key=secret'],
  ['--endpoint', 'file:///tmp/model'], ['--reasoning-effort', 'auto'], ['--thinking-format', 'unknown']])('refuses invalid live budget or endpoint %s', (flag, value) => {
  const input = [...liveArgs]
  input[input.indexOf(flag) + 1] = value
  expect(() => parseSimulationBenchmarkOptions(input)).toThrow()
})
it('refuses missing live budgets and scripted-model controls on a live sample', () => {
  for (const flag of ['--reasoning-effort', '--thinking-format']) {
    const input = [...liveArgs]
    input.splice(input.indexOf(flag), 2)
    expect(() => parseSimulationBenchmarkOptions(input)).toThrow(flag)
    expect(() => parseSimulationBenchmarkOptions([...args, flag, 'high'])).toThrow(/only to live-model/)
  }
  expect(() => parseSimulationBenchmarkOptions(liveArgs.slice(0, -2))).toThrow(/context-window/)
  expect(() => parseSimulationBenchmarkOptions([...liveArgs, '--models', '1'])).toThrow(/one resident/)
})
