/** Both scenario definitions retain the original historical request charge through real product cold restore. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

describe.each(['json', 'sqlite'])('%s World historical request quota', (backend) => {
  it.each(['company', 'laboratory'])('rejects a new valid %s application after the original closed case and cold restore', async (scenario) => {
    const temp = resolve('.local/world-director-mvp/tmp')
    await mkdir(temp, { recursive: true })
    const root = await mkdtemp(resolve(temp, 'world-request-count-'))
    const fixture = resolve('examples/simulation-company/tests/world-request-count-scenario.ts')
    const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
      configArgs: [resolve('examples/simulation-company/tests/fixtures/world-owner/cordis.yml')],
      env: { SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend, WORLD_SCENARIO: scenario, TMPDIR: temp } })
    const execute = async (recover: boolean) => {
      const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env,
        WORLD_REQUEST_COUNT_RECOVER: String(recover) }, stdio: ['ignore', 'pipe', 'pipe'] })
      const exited = once(child, 'exit')
      let output = '', errors = ''
      if (child.stdout === null || child.stderr === null) throw new Error('Request-count fixture requires piped output')
      child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString() })
      child.stderr.on('data', (chunk: Buffer) => { errors += chunk.toString() })
      try {
        const [code] = await exited as unknown[]
        expect(code, errors).toBe(0)
        expect(JSON.parse(output)).toEqual({ scenario, maxRequests: 1, intents: 1, cases: 1, completed: true, sparePosition: 1,
          exactRetry: true, newApplicationRejected: 'requests', originalFacts: true, originalCommands: true,
          pausedRecovery: recover, modelCalls: recover ? 0 : 18 })
      } finally { child.kill('SIGKILL'); await exited }
    }
    try { await execute(false); await execute(true) }
    finally { await rm(root, { recursive: true, force: true }) }
  })
})
