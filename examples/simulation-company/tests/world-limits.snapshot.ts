/** World quota ownership and durable token/context/microstep stops survive cold recovery on both backends. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

const modes = ['position', 'entities', 'participants', 'channels', 'director-tokens', 'newcomer-tokens', 'context', 'microstep'] as const
const stops = { position: 'position-capacity', entities: 'entity-capacity', participants: 'identity-capacity',
  channels: 'channel-capacity', 'director-tokens': 'budget-limit', 'newcomer-tokens': 'budget-limit',
  context: 'context-limit', microstep: 'microstep-limit' } as const
describe.each(['json', 'sqlite'])('%s World quota stops', (backend) => {
  it.each(modes)('retains original %s limits and stops without extra inference after restore', async (mode) => {
    const temp = resolve('.local/world-director-mvp/tmp')
    await mkdir(temp, { recursive: true })
    const root = await mkdtemp(resolve(temp, 'world-limits-'))
    const scenario = 'company'
    const fixture = resolve('examples/simulation-company/tests/world-driver-scenario.ts')
    const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
      configArgs: [resolve('examples/simulation-company/tests/fixtures/world-driver/cordis.yml')],
      env: { SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend, WORLD_SCENARIO: scenario,
        WORLD_DRIVER_LIMIT: mode, SIMULATION_CONTEXT_LIMIT: mode === 'context' ? '512' : '65536', TMPDIR: temp } })
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
        expect(JSON.parse(output)).toEqual({ scenario, mode, stop: stops[mode], stableStop: true, originalFacts: true,
          pausedRecovery: recover, modelCalls: recover || mode === 'context' ? 0
            : mode === 'director-tokens' || mode === 'microstep' ? 3 : 6 })
      } finally { child.kill('SIGKILL'); await exited }
    }
    try { await execute(false); await execute(true) }
    finally { await rm(root, { recursive: true, force: true }) }
  })
})
