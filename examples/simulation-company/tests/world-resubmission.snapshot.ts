/** Linked insufficient-information applications use real model/tools and survives a new-process restore on both persistent backends. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

describe.each(['json', 'sqlite'])('%s World resubmission', (backend) => {
  it.each(['company', 'laboratory'])('links %s clarification to the rejected original and restores both cases', async (scenario) => {
    const temp = resolve('.local/world-director-mvp/tmp')
    await mkdir(temp, { recursive: true })
    const root = await mkdtemp(resolve(temp, 'world-resubmission-'))
    const fixture = resolve('examples/simulation-company/tests/world-driver-scenario.ts')
    const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
      configArgs: [resolve('examples/simulation-company/tests/fixtures/world-driver/cordis.yml')],
      env: { SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend, WORLD_SCENARIO: scenario,
        WORLD_DRIVER_RESUBMIT: 'true', TMPDIR: temp } })
    const execute = async (recover: boolean) => {
      const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env,
        WORLD_DRIVER_RECOVER: String(recover) }, stdio: ['ignore', 'pipe', 'pipe'] })
      const exited = once(child, 'exit')
      let output = '', errors = ''
      child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString() })
      child.stderr.on('data', (chunk: Buffer) => { errors += chunk.toString() })
      try {
        const [code] = await exited as unknown[]
        expect(code, errors).toBe(0)
        expect(JSON.parse(output)).toEqual({ scenario, resubmitted: true, linked: true, requests: 2, plans: 2, hires: 1,
          firstAction: true, originalHistory: true, paused: true, modelCalls: recover ? 0 : 30 })
      } finally { child.kill('SIGKILL'); await exited }
    }
    try { await execute(false); await execute(true) }
    finally { await rm(root, { recursive: true, force: true }) }
  })
})
