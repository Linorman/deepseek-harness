/** Authenticated product control keeps auxiliary compaction pool refusal durable and requires one explicit cold continuation. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

describe.each(['json', 'sqlite'])('%s World auxiliary shared model pool', (backend) => {
  it.each(['company', 'laboratory'].flatMap(scenario => ['director', 'newcomer'].flatMap(mode =>
    [false, true].map(crash => ({ scenario, mode, crash })))))(

    'preserves auxiliary $scenario $mode refusal (crash=$crash) and explicitly continues once', async ({ scenario, mode, crash }) => {
      const temp = resolve('.local/world-director-mvp/tmp')
      await mkdir(temp, { recursive: true })
      const root = await mkdtemp(resolve(temp, 'world-auxiliary-pool-'))
      const fixture = resolve('examples/simulation-company/tests/world-owner-scenario.ts')
      const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
        configArgs: [resolve('examples/simulation-company/tests/fixtures/world-owner/cordis.yml')],
        env: { SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend, WORLD_SCENARIO: scenario,
          WORLD_OWNER_POOL: mode, WORLD_OWNER_POOL_CRASH: String(crash), WORLD_OWNER_POOL_AUX: 'true',
          SIMULATION_MODEL_LIMIT: '1', SIMULATION_MODEL_QUEUE_LIMIT: '0', TMPDIR: temp } })
      const execute = async (recover: boolean) => {
        const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env, WORLD_OWNER_RECOVER: String(recover) },
          stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
        const exited = once(child, 'exit')
        let output = '', errors = ''
        if (child.stdout === null || child.stderr === null) throw new Error('World pool fixture requires piped output')
        child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString() })
        child.stderr.on('data', (chunk: Buffer) => { errors += chunk.toString() })
        try {
          if (crash && !recover) {
            const readiness = once(child, 'message')
            const [event] = await Promise.race([readiness, exited.then(() => { throw new Error(errors) })]) as unknown[]
            expect(event).toBe('pool-refusal-durable')
            child.kill('SIGKILL')
            const [code, signal] = await exited as unknown[]
            expect(code).toBeNull()
            expect(signal).toBe('SIGKILL')
            return
          }
          const [code] = await exited as unknown[]
          expect(code, errors).toBe(0)
          expect(JSON.parse(output)).toEqual({ scenario, mode, stop: 'model-pool-capacity', productOwner: true,
            explicitContinuation: recover, noAutomaticRetry: true,
            modelCalls: recover ? mode === 'director' ? 15 : 12 : mode === 'director' ? 3 : 6,
            heldProviderCalls: recover ? 0 : 1 })
        } finally { child.kill('SIGKILL'); await exited }
      }
      try { await execute(false); await execute(true) }
      finally { await rm(root, { recursive: true, force: true }) }
    })
})
