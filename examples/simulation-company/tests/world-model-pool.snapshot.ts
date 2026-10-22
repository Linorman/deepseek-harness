/** A real competing Agent occupies the shared pool; refused director/newborn attempts survive cold explicit continuation. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

describe.each(['json', 'sqlite'])('%s World shared model pool', (backend) => {
  it.each(['company', 'laboratory'].flatMap(scenario => ['director', 'newcomer'].map(mode => ({ scenario, mode }))))(
    'retains $scenario $mode refusal and explicitly resumes the same wake once', async ({ scenario, mode }) => {
      const temp = resolve('.local/world-director-mvp/tmp')
      await mkdir(temp, { recursive: true })
      const root = await mkdtemp(resolve(temp, 'world-model-pool-'))
      const fixture = resolve('examples/simulation-company/tests/world-driver-scenario.ts')
      const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
        configArgs: [resolve('examples/simulation-company/tests/fixtures/world-driver/cordis.yml')],
        env: { SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend, WORLD_SCENARIO: scenario,
          WORLD_DRIVER_POOL: mode, SIMULATION_MODEL_LIMIT: '1', SIMULATION_MODEL_QUEUE_LIMIT: '0', TMPDIR: temp } })
      const execute = async (recover: boolean) => {
        const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env, WORLD_DRIVER_RECOVER: String(recover) },
          stdio: ['ignore', 'pipe', 'pipe'] })
        const exited = once(child, 'exit')
        let output = '', errors = ''
        child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString() })
        child.stderr.on('data', (chunk: Buffer) => { errors += chunk.toString() })
        try {
          const [code] = await exited as unknown[]
          expect(code, errors).toBe(0)
          expect(JSON.parse(output)).toEqual({ mode, stop: 'model-pool-capacity', originalWake: true,
            coldRestore: recover, modelCalls: recover ? mode === 'director' ? 15 : 12 : mode === 'director' ? 3 : 6,
            heldProviderCalls: recover ? 0 : 1 })
        } finally { child.kill('SIGKILL'); await exited }
      }
      try { await execute(false); await execute(true) }
      finally { await rm(root, { recursive: true, force: true }) }
    })
})
