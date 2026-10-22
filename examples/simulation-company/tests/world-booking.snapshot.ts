/** An independently registered appointment domain uses the real tools, Channel and generic driver on both backends. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

describe.each(['json', 'sqlite'])('%s registered booking domain', (backend) => {
  it.each(['company', 'laboratory'])('books a room in %s and restores the exact original mutation without inference', async (scenario) => {
    const temp = resolve(process.env.WORLD_BOOKING_EVIDENCE_ROOT ?? '.local/world-completion/tmp')
    await mkdir(temp, { recursive: true })
    const root = await mkdtemp(resolve(temp, 'world-booking-'))
    const fixture = resolve('examples/simulation-company/tests/world-booking-scenario.ts')
    const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
      configArgs: [resolve('examples/simulation-company/tests/fixtures/world-driver/cordis.yml')],
      env: { SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend, WORLD_SCENARIO: scenario,
        WORLD_DOMAIN_BOOKING: 'true', TMPDIR: temp } })
    try {
      for (const recover of [false, true]) {
        const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env,
          WORLD_DRIVER_RECOVER: String(recover) }, stdio: ['ignore', 'pipe', 'pipe'] })
        const exited = once(child, 'exit').then((values: unknown[]) => values)
        let output = '', errors = ''
        child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString() })
        child.stderr.on('data', (chunk: Buffer) => { errors += chunk.toString() })
        try {
          const [code, signal] = await exited
          await writeFile(resolve(root, `process-${recover ? 'cold' : 'warm'}.json`), JSON.stringify({
            pid: child.pid, face: process.env.CLOCKY_EXAMPLE_MODE ?? 'src', backend, scenario, recover,
            command: launch.command, args: launch.args, code, signal, output, errors }, null, 2) + '\n')
          expect(code, errors).toBe(0)
          expect(JSON.parse(output)).toEqual({ scenario, booking: true, genericDriver: true, noHireIntent: true,
            actualChannel: true, mutations: 1, restored: recover,
            modelCalls: recover ? 0 : process.env.WORLD_BOOKING_ACTOR_QUOTA === 'true' ? 18 : 15,
            ...process.env.WORLD_BOOKING_ACTOR_QUOTA === 'true' ? { actorQuota: true } : {} })
        } finally { child.kill('SIGKILL'); await exited }
      }
    } finally { if (process.env.WORLD_BOOKING_EVIDENCE_ROOT === undefined) await rm(root, { recursive: true, force: true }) }
  })
})
