/** Model/residency measurements share one durable run with a populated world journal. */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const execute = promisify(execFile)
describe.each(['json', 'sqlite'])('%s combined world and cognition', (backend) => {
  it('retains every batched world event while running bounded actors and cold recovery', async () => {
    await mkdir(resolve('.tmp'), { recursive: true })
    const output = await mkdtemp(resolve('.tmp/actor-world-benchmark-'))
    try {
      const { stdout } = await execute(process.execPath, ['--import', 'tsx/esm', 'scripts/benchmark-simulation.ts',
        '--backend', backend, '--workload', 'actors-world', '--entities', '4', '--operations', '8',
        '--world-events', '17', '--world-batch-size', '5', '--residents', '2', '--models', '2', '--model-delay-ms', '10',
        '--duration-ms', '15000', '--timeout-ms', '60000', '--sample-every', '4', '--entity-batch-size', '4',
        '--replay-page-size', '32', '--output', output])
      const summary = JSON.parse(stdout) as { status: string; report: string }
      expect(summary.status).toBe('measured')
      const report = JSON.parse(await readFile(summary.report, 'utf8')) as { result: {
        worldEvents: number
        requestedWorldEvents: number
        worldBatchSize: number
        completed: number
        modelCalls: number
        peakResidents: number
        peakModels: number
        worldPhase: { count: number }
      } }
      expect(report).toMatchObject({ version: 2, layer: 'scripted-cognition-with-world-history', coldExitCode: 0,
        coldRecovery: { replayEqual: true, modelCalls: 0, publications: 0 },
        result: { completion: 'target-complete', worldComplete: true, cognitionComplete: true, replayEqual: true } })
      expect(report.result.peakModels).toBeGreaterThanOrEqual(1)
      expect(report.result.peakModels).toBeLessThanOrEqual(2)
      const { worldEvents, requestedWorldEvents, worldBatchSize, completed, modelCalls, peakResidents, worldPhase } = report.result
      expect({ worldEvents, requestedWorldEvents, worldBatchSize, completed, modelCalls, peakResidents,
        worldBatches: worldPhase.count }).toMatchSnapshot()
    } finally { await rm(output, { recursive: true, force: true }) }
  })
})
