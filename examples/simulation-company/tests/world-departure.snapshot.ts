/** Actual departure and retirement preserve original identities and accepted fences through each backend and cold process. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

async function runCase(backend: string, retire: boolean, scenario: string, future: boolean, handoff: boolean): Promise<void> {
  const temp = resolve('.local/world-completion/tmp')
  await mkdir(temp, { recursive: true })
  const root = await mkdtemp(resolve(temp, 'world-departure-'))
  const fixture = resolve('examples/simulation-company/tests/world-departure-scenario.ts')
  const mode = process.env.CLOCKY_EXAMPLE_MODE === 'lib' ? 'lib' : 'source'
  const evidenceRoot = resolve('.agents/plans/2026-10-11-world-simulation-completion/evidence/implementation',
    `c9-departure-${mode}-final10-raw`)
  const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
    configArgs: [resolve('examples/simulation-company/tests/fixtures/world-departure/cordis.yml')],
    env: { SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend, WORLD_SCENARIO: scenario,
      WORLD_DEPARTURE_RETIRE: String(retire), WORLD_DEPARTURE_FUTURE: String(future), WORLD_DEPARTURE_HANDOFF: String(handoff),
      WORLD_DEPARTURE_EVIDENCE_ROOT: evidenceRoot, TMPDIR: temp } })
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
        expect(result).toMatchObject({ scenario, retire, future, handoff, immediateAcceptedFence: true, unreleasedWriterPreserved: true,
          originalIdentity: true, originalSession: true, originalProfile: true, originalMemory: true,
          assignmentClosed: true, oldRoleAuthorityClosed: true, activeNotTerminated: true,
          personalActivityContinues: !retire, actualRetirementConfirmed: retire, actualTeamCut: true, futurePermissionRevoked: future,
          originalTaskExplicitlyCancelled: handoff, newIndependentPendingTask: handoff,
          privateCanaryLeaks: 0, exactCommitRetryNoAppend: true, generatedPeople: 0, restored: recover })
        if (recover) expect(result.modelCalls).toBe(0)
        else expect(result.modelCalls).toBeGreaterThan(0)
      } finally { child.kill('SIGKILL'); await exited }
    }
  } finally { await rm(root, { recursive: true, force: true }) }
}

describe.each(['json', 'sqlite'])('%s actual departure', (backend) => {
  describe.each([false, true])('retire=%s', (retire) => {
    it.each(['company', 'laboratory'])('preserves original person and Session in %s', async (scenario) => {
      await runCase(backend, retire, scenario, false, false)
    })
  })
})
it('revokes the actual future grant without rewriting its original interval in JSON company', async () => {
  await runCase('json', false, 'company', true, false)
})
it('waits for explicit original task cancellation and creates independent new pending work in JSON company', async () => {
  await runCase('json', false, 'company', false, true)
})
