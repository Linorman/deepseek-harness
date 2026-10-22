/** Real startup history limits preserve original fair tickets and unknown cleanup through SIGKILL and cold recovery. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

const paths = [{ unknown: false, crash: false }, { unknown: false, crash: true }, { unknown: true, crash: false }]
describe.each(['json', 'sqlite'])('%s World Activation history', (backend) => {
  it.each(['company', 'laboratory'].flatMap(scenario => ['director', 'newcomer'].flatMap(mode =>
    paths.map(path => ({ scenario, mode, ...path }))))) (
    'retains $scenario $mode original startup (unknown=$unknown crash=$crash)', async ({ scenario, mode, unknown, crash }) => {
      const temp = resolve('.local/world-director-mvp/tmp')
      await mkdir(temp, { recursive: true })
      const root = await mkdtemp(resolve(temp, 'world-activation-history-'))
      const fixture = resolve('examples/simulation-company/tests/world-owner-scenario.ts')
      const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
        configArgs: [resolve('examples/simulation-company/tests/fixtures/world-owner/cordis.yml')],
        env: { SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend, WORLD_SCENARIO: scenario,
          WORLD_OWNER_ACTIVATION: mode, WORLD_ACTIVATION_CRASH: String(crash), WORLD_ACTIVATION_UNKNOWN: String(unknown), TMPDIR: temp } })
      const execute = async (recover: boolean) => {
        const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env, WORLD_OWNER_RECOVER: String(recover) },
          stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
        const exited = once(child, 'exit')
        let output = '', errors = ''
        if (child.stdout === null || child.stderr === null) throw new Error('Activation history fixture requires piped output')
        child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString() })
        child.stderr.on('data', (chunk: Buffer) => { errors += chunk.toString() })
        try {
          if (!recover && (unknown || crash)) {
            const [event] = await Promise.race([once(child, 'message'), exited.then(() => { throw new Error(errors) })]) as unknown[]
            expect(event).toBe('activation-refusal-durable')
            child.kill('SIGKILL')
            const [code, signal] = await exited as unknown[]
            expect(code).toBeNull(); expect(signal).toBe('SIGKILL')
            return
          }
          const [code] = await exited as unknown[]
          expect(code, errors).toBe(0)
          expect(JSON.parse(output)).toEqual({ scenario, mode, unknown, historyLimit: true, originalSelection: true,
            coldRecovery: recover, modelCalls: recover ? 0 : mode === 'director' ? 3 : 6, attemptedStarts: recover ? 0 : 1 })
        } finally { child.kill('SIGKILL'); await exited }
      }
      try { await execute(false); await execute(true) }
      finally { await rm(root, { recursive: true, force: true }) }
    })
})
