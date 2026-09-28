/** World batches retain one event per update, including repeated entities and a partial tail batch. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

describe.each(['json', 'sqlite'])('%s world batching', (backend) => {
  it.each([1, 7])('retains each update with batch size %s', async (batch) => {
    await mkdir(resolve('.tmp'), { recursive: true })
    const root = await mkdtemp(resolve('.tmp/simulation-world-batch-'))
    const fixture = resolve('examples/simulation-company/tests/benchmark-scenario.ts')
    const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
      configArgs: [resolve('examples/simulation-company/cordis.yml'), '--backend', backend, '--workload', 'world',
        '--entities', '3', '--operations', '23', '--world-batch-size', String(batch), '--duration-ms', '30000',
        '--timeout-ms', '60000', '--sample-every', '10', '--entity-batch-size', '2', '--replay-page-size', '4', '--output', '.tmp'],
      env: { SIMULATION_COMPANY_ROOT: resolve(root, 'data'), SIMULATION_COMPANY_BACKEND: backend } })
    const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env }, stdio: 'pipe' })
    const exited = once(child, 'exit')
    let output = '', error = ''
    child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString() })
    child.stderr.on('data', (chunk: Buffer) => { error += chunk.toString() })
    try {
      const [code] = await exited as unknown[]
      expect(code, error).toBe(0)
      const rows = output.trim().split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line) as {
        kind: string
        completion: string
        completed: number
        writeBatchSize: number
        journalEntries: number
        replayEqual: boolean
        phases: Record<string, { count: number }>
      })
      const result = rows.find(row => row.kind === 'result')!
      expect(result.completion).toBe('target-complete')
      expect({ completed: result.completed, writeBatchSize: result.writeBatchSize,
        batches: result.phases['write-batch']!.count, journalEntries: result.journalEntries, replayEqual: result.replayEqual }).toMatchSnapshot()
    } finally { child.kill('SIGKILL'); await exited; await rm(root, { recursive: true, force: true }) }
  })
})
