/** Actual task and unreceipted Channel IO are inventoried without writes, then cold-read from their retained original owners. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

describe.each(['json', 'sqlite'])('%s personnel responsibility inspection', (backend) => {
  it.each(['company', 'laboratory'])('retains true owner references without consuming private work in %s', async (scenario) => {
    const temp = resolve('.local/world-completion/tmp')
    await mkdir(temp, { recursive: true })
    const root = await mkdtemp(resolve(temp, 'world-personnel-obligations-'))
    const fixture = resolve('examples/simulation-company/tests/world-personnel-obligations-scenario.ts')
    const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
      configArgs: [resolve('examples/simulation-company/tests/fixtures/world-personnel-obligations/cordis.yml')],
      env: { SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend, WORLD_SCENARIO: scenario, TMPDIR: temp } })
    try {
      for (const recover of [false, true]) {
        const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env,
          WORLD_DRIVER_RECOVER: String(recover) }, stdio: ['ignore', 'pipe', 'pipe'] })
        const exited = once(child, 'exit')
        let output = '', errors = ''
        child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString() })
        child.stderr.on('data', (chunk: Buffer) => { errors += chunk.toString() })
        try {
          const [code] = await exited as unknown[]
          expect(code, errors).toBe(0)
          const result = JSON.parse(output) as { modelCalls: number }
          expect(result).toMatchObject({ scenario, actualPendingTask: true, actualCreator: true, inventedOwnerOrAttempt: false,
            afterIOBeforeReceiptObserved: true, incomingAndOutgoing: true, readonlyCursors: true, privateBodyLeaks: 0,
            exactLimits: true, utf8Bounds: true, selectorRejections: true, originalIdentity: true, restored: recover })
          if (recover) expect(result.modelCalls).toBe(0)
          else expect(result.modelCalls).toBeGreaterThan(0)
        } finally { child.kill('SIGKILL'); await exited }
      }
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
