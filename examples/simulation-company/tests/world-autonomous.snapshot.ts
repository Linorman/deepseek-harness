/** Ordinary goal decisions create their own intent through the real product/Agent path and cold recovery. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

describe.each(['json', 'sqlite'])('%s autonomous world requests', (backend) => {
  it.each(['company', 'laboratory'])('creates a %s case without a prebuilt HireIntent and restores the original result', async (scenario) => {
    const temp = resolve('.local/world-completion/tmp')
    await mkdir(temp, { recursive: true })
    const root = await mkdtemp(resolve(temp, 'world-autonomous-'))
    const fixture = resolve('examples/simulation-company/tests/world-owner-scenario.ts')
    const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
      configArgs: [resolve('examples/simulation-company/tests/fixtures/world-owner/cordis.yml')],
      env: { SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend, WORLD_SCENARIO: scenario,
        WORLD_AUTONOMOUS: 'true', WORLD_OWNER_CRASH: '', TMPDIR: temp } })
    try {
      for (const recover of [false, true]) {
        const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env,
          WORLD_OWNER_RECOVER: String(recover) }, stdio: ['ignore', 'pipe', 'pipe'] })
        const exited = once(child, 'exit')
        let output = '', errors = ''
        child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString() })
        child.stderr.on('data', (chunk: Buffer) => { errors += chunk.toString() })
        try {
          const [code] = await exited as unknown[]
          expect(code, errors).toBe(0)
          expect(JSON.parse(output)).toEqual({ scenario, originalProduct: true, oneOwner: true, committed: true,
            independentNewcomer: true, phase: 'paused', originalStartRetryKeepsPause: true, restored: recover,
            modelCalls: recover ? 0 : 18 })
        } finally { child.kill('SIGKILL'); await exited }
      }
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
