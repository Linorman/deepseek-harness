/** Authenticated case cancellation and pure original-command replay across both scenarios and durable backends. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

describe.each(['json', 'sqlite'])('%s World product cancellation', (backend) => {
  it.each(['company', 'laboratory'].flatMap(scenario => ['accepted-before-reserve', 'participant-afterIO',
    'committed-before-notification'].map(stage => ({ scenario, stage }))))('settles $scenario at $stage and preserves the original cold receipt',
    async ({ scenario, stage }) => {
      const temp = resolve('.local/world-director-mvp/tmp')
      await mkdir(temp, { recursive: true })
      const root = await mkdtemp(resolve(temp, 'world-case-'))
      const fixture = resolve('examples/simulation-company/tests/world-case-cancel-scenario.ts')
      const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
        configArgs: [resolve('examples/simulation-company/tests/fixtures/world-owner/cordis.yml')],
        env: { SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend, WORLD_SCENARIO: scenario,
          WORLD_CANCEL_STAGE: stage, TMPDIR: temp } })
      try {
        for (const recovering of [false, true]) {
          const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env,
            WORLD_CASE_RECOVER: String(recovering) }, stdio: ['ignore', 'pipe', 'pipe'] })
          const exited = once(child, 'exit')
          let output = '', errors = ''
          child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString() })
          child.stderr.on('data', (chunk: Buffer) => { errors += chunk.toString() })
          try {
            const [code] = await exited as unknown[]
            expect(code, errors).toBe(0)
            expect(JSON.parse(output)).toEqual({ scenario, stage, restored: recovering, modelCalls: recovering ? 0 : 6 })
          } finally { child.kill('SIGKILL'); await exited }
        }
      } finally { await rm(root, { recursive: true, force: true }) }
    })
})
