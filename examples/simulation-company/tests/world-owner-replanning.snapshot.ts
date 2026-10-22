/** Actual Loader and authenticated product scheduler retain bounded explicit planning continuation. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

describe.each(['json', 'sqlite'])('%s World product replanning', (backend) => {
  it.each(['company', 'laboratory'])('continues one stale %s case without repeating its original start or hiring twice', async (scenario) => {
    const temp = resolve('.local/world-director-mvp/tmp')
    await mkdir(temp, { recursive: true })
    const root = await mkdtemp(resolve(temp, 'world-owner-replanning-'))
    const fixture = resolve('examples/simulation-company/tests/world-owner-scenario.ts')
    const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
      configArgs: [resolve('examples/simulation-company/tests/fixtures/world-owner/cordis.yml')],
      env: { SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend, WORLD_SCENARIO: scenario,
        WORLD_OWNER_REPLAN: 'true', TMPDIR: temp } })
    const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env }, stdio: ['ignore', 'pipe', 'pipe'] })
    const exited = once(child, 'exit')
    let output = '', errors = ''
    child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString() })
    child.stderr.on('data', (chunk: Buffer) => { errors += chunk.toString() })
    try {
      const [code] = await exited as unknown[]
      expect(code, errors).toBe(0)
      expect(JSON.parse(output)).toEqual({ scenario, productOwner: true, explicitContinue: true, originalRetryInert: true,
        cases: 1, plans: 2, hires: 1, modelCalls: 21 })
    } finally { child.kill('SIGKILL'); await exited; await rm(root, { recursive: true, force: true }) }
  })
})
