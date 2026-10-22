/** Authenticated product control keeps original rejected world submissions durable through cold recovery. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

describe.each(['json', 'sqlite'])('%s World submission limits', (backend) => {
  it.each(['company', 'laboratory'].flatMap(scenario => ['request-bytes', 'plan-bytes', 'authority'].flatMap(mode =>
    [false, true].map(crash => ({ scenario, mode, crash })))))(

    'retains $scenario $mode unaccepted input (crash=$crash) through cold recovery', async ({ scenario, mode, crash }) => {
      const temp = resolve('.local/world-director-mvp/tmp')
      await mkdir(temp, { recursive: true })
      const root = await mkdtemp(resolve(temp, 'world-submission-limits-'))
      const fixture = resolve('examples/simulation-company/tests/world-owner-scenario.ts')
      const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
        configArgs: [resolve('examples/simulation-company/tests/fixtures/world-owner/cordis.yml')],
        env: { SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend, WORLD_SCENARIO: scenario,
          WORLD_SUBMISSION_LIMIT: mode, WORLD_SUBMISSION_CRASH: String(crash), TMPDIR: temp } })
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
            expect(event).toBe('world-submission-durable')
            child.kill('SIGKILL')
            const [code, signal] = await exited as unknown[]
            expect(code).toBeNull()
            expect(signal).toBe('SIGKILL')
            return
          }
          const [code] = await exited as unknown[]
          expect(code, errors).toBe(0)
          expect(JSON.parse(output)).toEqual({ scenario, mode, stop: mode === 'authority' ? 'authority-missing' : 'world-byte-limit',
            pausedRecovery: recover, rejectedOnce: true, stableReads: true, modelCalls: recover ? 0 : mode === 'request-bytes' ? 3 : 6 })
        } finally { child.kill('SIGKILL'); await exited }
      }
      try { await execute(false); await execute(true) }
      finally { await rm(root, { recursive: true, force: true }) }
    })
})
