/** Strict original personnel time is honored or explicitly missed without changing original plans or model context. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

describe.each(['json', 'sqlite'])('%s strict personnel time', (backend) => {
  describe.each(['on-time', 'missed'])('%s', (timeCase) => {
    it.each(['company', 'laboratory'])('preserves original slots and contexts in %s', async (scenario) => {
      const temp = resolve('.local/world-completion/tmp')
      await mkdir(temp, { recursive: true })
      const root = await mkdtemp(resolve(temp, 'world-personnel-time-'))
      const fixture = resolve('examples/simulation-company/tests/world-personnel-time-scenario.ts')
      const mode = process.env.CLOCKY_EXAMPLE_MODE === 'lib' ? 'lib' : 'source'
      const evidenceRoot = resolve('.agents/plans/2026-10-11-world-simulation-completion/evidence/implementation',
        `c10-personnel-time-${mode}-final8-raw`)
      const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
        configArgs: [resolve('examples/simulation-company/tests/fixtures/world-personnel-time/cordis.yml')],
        env: { SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend, WORLD_SCENARIO: scenario,
          WORLD_PERSONNEL_TIME_CASE: timeCase, WORLD_PERSONNEL_TIME_EVIDENCE_ROOT: evidenceRoot, TMPDIR: temp } })
      try {
        for (const recover of [false, true]) {
          const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env,
            WORLD_DRIVER_RECOVER: String(recover) }, stdio: ['ignore', 'pipe', 'pipe'] })
          const exited = once(child, 'exit')
          let output = '', errors = ''
          child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString() })
          child.stderr.on('data', (chunk: Buffer) => { errors += chunk.toString() })
          try {
            const [code] = await exited as unknown[]
            expect(code, errors).toBe(0)
            const result = JSON.parse(output) as { modelCalls: number }
            expect(result).toMatchObject({ scenario, timeCase, requestedTime: '3', actualTime: timeCase === 'on-time' ? '3' : null,
              staleTimeNoAppend: timeCase === 'missed', originalSlotsAndContextsUnchanged: true, originalRequestAndPlanUnchanged: true,
              originalIdentity: true, originalSession: true, originalMemory: true, nativeBoundaryNoActorWake: true,
              generatedPeople: 0, privateCanaryLeaks: 0, restored: recover })
            if (recover) expect(result.modelCalls).toBe(0)
            else expect(result.modelCalls).toBeGreaterThan(0)
          } finally { child.kill('SIGKILL'); await exited }
        }
      } finally { await rm(root, { recursive: true, force: true }) }
    })
  })
})
