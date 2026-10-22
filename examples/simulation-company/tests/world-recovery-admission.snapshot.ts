/** Original product histories refuse missing versions or cross-owner evidence on both persistent backends. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

describe.each(['json', 'sqlite'])('%s World writable recovery admission', (backend) => {
  it.each(['company', 'laboratory'])('refuses missing %s versions and original newcomer/effect evidence', async (scenario) => {
    const temp = resolve('.local/world-director-mvp/tmp')
    await mkdir(temp, { recursive: true })
    const root = await mkdtemp(resolve(temp, 'world-recovery-admission-'))
    const execute = async (file: string, mode?: string) => {
      const fixture = resolve(`examples/simulation-company/tests/${file}`)
      const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
        configArgs: [resolve('examples/simulation-company/tests/fixtures/world-owner/cordis.yml')],
        env: { SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend, WORLD_SCENARIO: scenario,
          WORLD_OWNER_CRASH: '', WORLD_OWNER_RECOVER: 'false', WORLD_RECOVERY_DAMAGE: mode ?? '', TMPDIR: temp } })
      const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env }, stdio: ['ignore', 'pipe', 'pipe'] })
      const exited = once(child, 'exit')
      let output = '', errors = ''
      child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString() })
      child.stderr.on('data', (chunk: Buffer) => { errors += chunk.toString() })
      try {
        const [code] = await exited as unknown[]
        expect(code, errors).toBe(0)
        return JSON.parse(output) as unknown
      } finally { child.kill('SIGKILL'); await exited }
    }
    try {
      expect(await execute('world-owner-scenario.ts')).toMatchObject({ originalProduct: true, committed: true, modelCalls: 18 })
      for (const mode of ['compiler-version', 'model-version', 'template-version', 'checkpoint-version',
        'newcomer-channel', 'newcomer-session', 'notification-envelope']) {
        expect(await execute('world-recovery-admission-scenario.ts', mode)).toEqual({ mode, rejected: true,
          stage: mode === 'compiler-version' || mode === 'model-version' || mode === 'template-version'
            ? 'original-creation-parser' : 'authenticated-restore', modelCalls: 0, repaired: false })
      }
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
