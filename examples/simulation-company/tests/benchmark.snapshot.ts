import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const execute = promisify(execFile)

it('identifies benchmark sources without transient Loader configurations', async () => {
  const directory = await mkdtemp(resolve('examples/simulation-company/.tmp-benchmark-sources-'))
  const temporaryConfig = resolve(directory, 'cordis.yml')
  await writeFile(temporaryConfig, '[]\n')
  try {
    const { stdout } = await execute(process.execPath, ['--import', 'tsx/esm', 'scripts/benchmark-simulation.ts',
      '--backend', 'sqlite', '--workload', 'world', '--world-batch-size', '1', '--entities', '1', '--operations', '1',
      '--duration-ms', '10000', '--timeout-ms', '60000', '--sample-every', '1', '--entity-batch-size', '1',
      '--replay-page-size', '4', '--output', directory])
    const summary = JSON.parse(stdout) as { report: string; status: string }
    expect(summary.status).toBe('measured')
    const sources = JSON.parse(await readFile(resolve(summary.report, '..', 'sources.json'), 'utf8')) as Record<string, string>
    expect(Object.keys(sources).filter(path => path.includes('/.tmp'))).toEqual([])
    for (const path of ['examples/simulation-company/cordis.yml', 'examples/simulation-company/tests/benchmark-scenario.ts',
      'scripts/benchmark-simulation.ts']) expect(sources[path]).toMatch(/^[a-f0-9]{64}$/)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

describe.each(['json', 'sqlite'])('%s storage benchmark', (backend) => {
  it.each(['ingress', 'world'])('measures and restores the %s workload without model calls', async (workload) => {
    await mkdir(resolve('.tmp'), { recursive: true })
    const directory = await mkdtemp(resolve('.tmp/simulation-benchmark-test-'))
    try {
      const { stdout } = await execute(process.execPath, ['--import', 'tsx/esm', 'scripts/benchmark-simulation.ts',
        '--backend', backend, '--workload', workload, ...workload === 'world' ? ['--world-batch-size', '3'] : [], '--entities', '8', '--operations', '16', '--duration-ms', '10000',
        '--timeout-ms', '60000', '--sample-every', '4', '--entity-batch-size', '4', '--replay-page-size', '4', '--output', directory])
      const summary = JSON.parse(stdout) as { report: string; status: string }
      expect(summary.status).toBe('measured')
      expect(JSON.parse(await readFile(summary.report, 'utf8'))).toMatchObject({
        version: 2, lastPhase: 'cold-recovery', coldExitCode: 0, coldRecovery: { replayEqual: true, modelCalls: 0, publications: 0 },
      })
      const report = JSON.parse(await readFile(summary.report, 'utf8')) as {
        result: {
          completed: number
          consumed: number
          completion: string
          modelCalls: number
          replayEqual: boolean
          acceptedResponsibilitiesPreserved: boolean
          teamMessages: number
          residents: number
          diskBytes: number
          phases: Record<string, { p50Ms: number; p95Ms: number; p99Ms: number }> }
      }
      const value = report.result
      const latency = value.phases[workload === 'world' ? 'write-batch' : 'write']!
      expect(value.diskBytes).toBeGreaterThan(0)
      expect(latency.p50Ms).toBeGreaterThan(0)
      expect(latency.p95Ms).toBeGreaterThanOrEqual(latency.p50Ms)
      expect(latency.p99Ms).toBeGreaterThanOrEqual(latency.p95Ms)
      expect({ completed: value.completed, consumed: value.consumed, completion: value.completion,
        modelCalls: value.modelCalls, teamMessages: value.teamMessages, residents: value.residents,
        replayEqual: value.replayEqual, acceptedResponsibilitiesPreserved: value.acceptedResponsibilitiesPreserved }).toMatchSnapshot()
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
})

it('retains a timeout report and never labels an interrupted workload measured', async () => {
  await mkdir(resolve('.tmp'), { recursive: true })
  const directory = await mkdtemp(resolve('.tmp/simulation-benchmark-timeout-'))
  try {
    const execution = execute(process.execPath, ['--import', 'tsx/esm', 'scripts/benchmark-simulation.ts',
      '--backend', 'sqlite', '--workload', 'ingress', '--entities', '1000', '--operations', '100000', '--duration-ms', '1',
      '--timeout-ms', '2', '--sample-every', '100', '--entity-batch-size', '100', '--replay-page-size', '4', '--output', directory])
    const failure: unknown = await execution.catch((error: unknown) => error)
    if (!(failure instanceof Error) || !('stdout' in failure) || typeof failure.stdout !== 'string') {
      throw new Error('Expected a failed benchmark process with its report path')
    }
    const summary = JSON.parse(failure.stdout) as { report: string; status: string }
    expect(summary.status).toBe('timeout')
    expect(JSON.parse(await readFile(summary.report, 'utf8'))).toMatchObject({ status: 'timeout', timedOut: true,
      exitCode: null, signal: 'SIGKILL' })
  } finally { await rm(directory, { recursive: true, force: true }) }
})

describe.each(['json', 'sqlite'])('%s cognition benchmark', (backend) => {
  it.each([1, 2])('rotates canonical Sessions with %s model permits', async (models) => {
    await mkdir(resolve('.tmp'), { recursive: true })
    const directory = await mkdtemp(resolve('.tmp/simulation-actor-benchmark-test-'))
    try {
      const { stdout } = await execute(process.execPath, ['--import', 'tsx/esm', 'scripts/benchmark-simulation.ts',
        '--backend', backend, '--workload', 'actors', '--entities', '4', '--operations', '8', '--residents', '2',
        '--models', String(models), '--model-delay-ms', '20', '--duration-ms', '15000', '--timeout-ms', '60000',
        '--sample-every', '4', '--entity-batch-size', '4', '--replay-page-size', '4', '--output', directory])
      const summary = JSON.parse(stdout) as { report: string; status: string }
      expect(summary.status).toBe('measured')
      expect(JSON.parse(await readFile(summary.report, 'utf8'))).toMatchObject({
        version: 2, lastPhase: 'cold-recovery', coldExitCode: 0, coldRecovery: { replayEqual: true, modelCalls: 0, publications: 0 },
      })
      const report = JSON.parse(await readFile(summary.report, 'utf8')) as { result: {
        completed: number
        completion: string
        modelCalls: number
        peakModels: number
        peakResidents: number
        starts: number
        resumes: number
        reportedTokens: number
        uniqueServed: number
        neverServed: number
        replayEqual: boolean
        canonicalSessionsPreserved: boolean
      } }
      const result = report.result
      expect(result.peakModels).toBeGreaterThanOrEqual(1)
      expect(result.peakModels).toBeLessThanOrEqual(models)
      expect(result.peakResidents).toBe(2)
      expect({ completed: result.completed, completion: result.completion, modelCalls: result.modelCalls,
        starts: result.starts, resumes: result.resumes, reportedTokens: result.reportedTokens,
        uniqueServed: result.uniqueServed, neverServed: result.neverServed,
        replayEqual: result.replayEqual, canonicalSessionsPreserved: result.canonicalSessionsPreserved }).toMatchSnapshot()
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
})

describe.each(['json', 'sqlite'])('%s Team delivery benchmark', (backend) => {
  it.each([false, true])('counts authoritative effects with lost response=%s', async (lostResponse) => {
    await mkdir(resolve('.tmp'), { recursive: true })
    const directory = await mkdtemp(resolve('.tmp/simulation-message-benchmark-test-'))
    try {
      const { stdout } = await execute(process.execPath, ['--import', 'tsx/esm', 'scripts/benchmark-simulation.ts',
        '--backend', backend, '--workload', 'messages', '--entities', '4', '--operations', '8', '--residents', '2',
        '--models', '1', '--model-delay-ms', '5', '--duration-ms', '15000', '--timeout-ms', '60000',
        '--sample-every', '4', '--entity-batch-size', '4', '--replay-page-size', '4', '--output', directory], {
        env: { ...process.env, SIMULATION_BENCHMARK_LOST_POST: String(lostResponse) },
      })
      const summary = JSON.parse(stdout) as { report: string; status: string }
      expect(summary.status).toBe('measured')
      expect(JSON.parse(await readFile(summary.report, 'utf8'))).toMatchObject({
        version: 2, lastPhase: 'cold-recovery', coldExitCode: 0, coldRecovery: { replayEqual: true, modelCalls: 0, publications: 0 },
      })
      const report = JSON.parse(await readFile(summary.report, 'utf8')) as { result: {
        completed: number
        completion: string
        modelCalls: number
        peakModels: number
        peakResidents: number
        teamMessages: number
        uniqueEnvelopes: number
        durableInputs: number
        modelReadMessages: number
        walEnvelopes: number
        walReceipts: number
        duplicateRetriesVerified: number
        responseLossInjected: boolean
        setupMs: number
        setupPhases: { rootMs: number; entitiesMs: number; participantsMs: number; channelsMs: number }
        replayEqual: boolean
      } }
      const result = report.result
      const setupTimes = Object.values(result.setupPhases)
      expect(setupTimes).toHaveLength(4)
      expect(setupTimes.every(value => Number.isFinite(value) && value >= 0)).toBe(true)
      expect(setupTimes.reduce((total, value) => total + value, 0)).toBeLessThanOrEqual(result.setupMs)
      expect(result.responseLossInjected).toBe(lostResponse)
      expect(result.peakModels).toBe(1)
      expect(result.peakResidents).toBe(2)
      expect({ completed: result.completed, completion: result.completion, modelCalls: result.modelCalls,
        teamMessages: result.teamMessages, uniqueEnvelopes: result.uniqueEnvelopes, durableInputs: result.durableInputs,
        modelReadMessages: result.modelReadMessages, walEnvelopes: result.walEnvelopes, walReceipts: result.walReceipts,
        duplicateRetriesVerified: result.duplicateRetriesVerified, replayEqual: result.replayEqual }).toMatchSnapshot()
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
})

describe.each(['json', 'sqlite'])('%s parallel Team delivery benchmark', (backend) => {
  it.each([{ lostResponse: false, operations: 8 }, { lostResponse: true, operations: 8 }, { lostResponse: false, operations: 5 }])
  ('collects $operations messages with lost response=$lostResponse', async ({ lostResponse, operations }) => {
    await mkdir(resolve('.tmp'), { recursive: true })
    const directory = await mkdtemp(resolve('.tmp/simulation-parallel-delivery-test-'))
    try {
      const { stdout } = await execute(process.execPath, ['--import', 'tsx/esm', 'scripts/benchmark-simulation.ts',
        '--backend', backend, '--workload', 'parallel-messages', '--entities', '6', '--operations', String(operations), '--residents', '4',
        '--models', '2', '--model-delay-ms', '20', '--duration-ms', '15000', '--timeout-ms', '60000',
        '--sample-every', '4', '--entity-batch-size', '6', '--replay-page-size', '4', '--output', directory], {
        env: { ...process.env, SIMULATION_BENCHMARK_LOST_POST: String(lostResponse) },
      })
      const summary = JSON.parse(stdout) as { report: string; status: string }
      expect(summary.status).toBe('measured')
      const report = JSON.parse(await readFile(summary.report, 'utf8')) as { result: {
        peakModels: number
        peakResidents: number
        responseLossInjected: boolean
      } }
      expect(report.result.peakModels).toBeGreaterThanOrEqual(1)
      expect(report.result.peakModels).toBeLessThanOrEqual(2)
      expect(report.result.peakResidents).toBe(4)
      expect(report.result.responseLossInjected).toBe(lostResponse)
      expect(report).toMatchObject({ version: 2, coldExitCode: 0,
        coldRecovery: { replayEqual: true, modelCalls: 0, publications: 0 }, result: {
          completed: operations, completion: 'target-complete', parallelWindows: true, decisionWindows: Math.ceil(operations / 2) * 2,
          maxRecipientCohort: 2, modelCalls: operations * 6, teamMessages: operations, uniqueEnvelopes: operations,
          walEnvelopes: operations, walReceipts: operations, durableInputs: operations, modelReadMessages: operations,
          duplicateRetriesVerified: operations, replayEqual: true,
        } })
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
})
