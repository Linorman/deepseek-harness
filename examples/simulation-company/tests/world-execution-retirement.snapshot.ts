/** A committed hire retains its exact execution lease through failed maintenance finish and effect unload. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

describe.each(['json', 'sqlite'])('%s World execution retirement', (backend) => {
  it.each(['company', 'laboratory'].map(scenario => ({ scenario, pause: false })))(
    'drives $scenario after failed maintenance finish and unload to independent newborn and idle', async ({ scenario, pause }) => {
      const temp = resolve('.local/world-director-mvp/tmp')
      await mkdir(temp, { recursive: true })
      const root = await mkdtemp(resolve(temp, 'world-driver-'))
      const fixture = resolve('examples/simulation-company/tests/world-driver-scenario.ts')
      const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
        configArgs: [resolve('examples/simulation-company/tests/fixtures/world-driver/cordis.yml')],
        env: { SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend, WORLD_SCENARIO: scenario,
          WORLD_DRIVER_PAUSE: String(pause), WORLD_DRIVER_MAINTENANCE_FAILURE: 'true', TMPDIR: temp } })
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
          expect(JSON.parse(output)).toEqual({ scenario, result: 'committed', requests: 1, plans: 1, hires: 1,
            newborn: scenario === 'company' ? 'Lin' : 'Kai', independentSession: true, firstAction: true, notified: true,
            privateInputsExcluded: true, stop: 'idle', modelCalls: recover ? 0 : 18 })
        } finally { child.kill('SIGKILL'); await exited }
      }
      try { await execute(false); await execute(true) }
      finally { await rm(root, { recursive: true, force: true }) }
    },
  )
})
