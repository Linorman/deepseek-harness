/** Real unknown provider termination retains charged residency until independent-process recovery accounts for the original epoch. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

describe.each(['json', 'sqlite'])('%s World resident capacity', (backend) => {
  it.each(['company', 'laboratory'].flatMap(scenario => ['director', 'newcomer'].map(mode => ({ scenario, mode }))))(
    'blocks $scenario $mode behind an unconfirmed old writer and restores without inference', async ({ scenario, mode }) => {
      const temp = resolve('.local/world-director-mvp/tmp')
      await mkdir(temp, { recursive: true })
      const root = await mkdtemp(resolve(temp, 'world-resident-capacity-'))
      const fixture = resolve('examples/simulation-company/tests/world-resident-capacity-scenario.ts')
      const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
        configArgs: [resolve('examples/simulation-company/tests/fixtures/world-owner/cordis.yml')],
        env: { SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend, WORLD_SCENARIO: scenario,
          WORLD_RESIDENT_MODE: mode, TMPDIR: temp } })
      const execute = async (recover: boolean) => {
        const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env,
          WORLD_RESIDENT_RECOVER: String(recover) }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
        const exited = once(child, 'exit')
        let output = '', errors = ''
        if (child.stdout === null || child.stderr === null) throw new Error('Resident fixture requires piped output')
        child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString() })
        child.stderr.on('data', (chunk: Buffer) => { errors += chunk.toString() })
        try {
          if (!recover) {
            const [message] = await Promise.race([once(child, 'message'), exited.then(() => { throw new Error(errors) })]) as unknown[]
            expect(message).toMatchObject({ event: 'world-resident-unconfirmed', mode, driver: 'waiting',
              stop: mode === 'director' ? 'residency-recovery-required' : 'recovery-required',
              modelCalls: mode === 'director' ? 3 : 6, chargedActors: 1, targetStarts: 0, originalResponsibility: true })
            return
          }
          const [code] = await exited as unknown[]
          expect(code, errors).toBe(0)
          expect(JSON.parse(output)).toEqual({ scenario, mode, coldRecovery: true, modelCalls: 0,
            releasedAfterRestore: true, originalResponsibility: true, chargedActors: 0, targetStarts: 0 })
        } finally { child.kill('SIGKILL'); await exited }
      }
      try { await execute(false); await execute(true) }
      finally { await rm(root, { recursive: true, force: true }) }
    })
})
