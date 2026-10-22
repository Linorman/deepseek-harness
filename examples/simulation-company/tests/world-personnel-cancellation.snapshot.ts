/** Original personnel cancellation races retain exact reservations, controller ownership and unique results through cold restoration. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

async function runCase(backend: string, cancellationCase: string, scenario: string): Promise<void> {
  const temp = resolve('.local/world-completion/tmp')
  await mkdir(temp, { recursive: true })
  const root = await mkdtemp(resolve(temp, 'world-personnel-cancellation-'))
  const fixture = resolve('examples/simulation-company/tests/world-personnel-cancellation-scenario.ts')
  const mode = process.env.CLOCKY_EXAMPLE_MODE === 'lib' ? 'lib' : 'source'
  const evidenceRoot = resolve('.agents/plans/2026-10-11-world-simulation-completion/evidence/implementation',
    `c11-personnel-cancellation-${mode}-final13-raw`)
  const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
    configArgs: [resolve('examples/simulation-company/tests/fixtures/world-personnel-cancellation/cordis.yml')],
    env: { SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend, WORLD_SCENARIO: scenario,
      WORLD_PERSONNEL_CANCELLATION_CASE: cancellationCase, WORLD_PERSONNEL_CANCELLATION_EVIDENCE_ROOT: evidenceRoot, TMPDIR: temp } })
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
        expect(result).toMatchObject({ scenario, cancellationCase, originalIdentity: true, originalSession: true, originalMemory: true,
          noPartialMutation: true, drainingReservationAndFencePreserved: cancellationCase === 'during-maintenance',
          actualQuiescenceBeforeSettlement: cancellationCase !== 'before-reserve',
          cancelledBeforeReserveNoRetirement: cancellationCase === 'before-reserve',
          originalAssignmentPreserved: cancellationCase !== 'commit-wins', commitWinsOriginalResult: cancellationCase === 'commit-wins',
          uniqueResult: true, exactRetryNoAppend: true, generatedPeople: 0, privateCanaryLeaks: 0, restored: recover })
        if (recover) expect(result.modelCalls).toBe(0)
        else expect(result.modelCalls).toBeGreaterThan(0)
      } finally { child.kill('SIGKILL'); await exited }
    }
  } finally { await rm(root, { recursive: true, force: true }) }
}
describe.each(['json', 'sqlite'])('%s original personnel cancellation', (backend) => {
  describe.each(['before-reserve', 'during-maintenance', 'commit-wins'])('%s', (cancellationCase) => {
    it.each(['company', 'laboratory'])('preserves original identities and results in %s', async (scenario) => {
      await runCase(backend, cancellationCase, scenario)
    })
  })
})
it('lets original cancellation win before the real held-cut Native commit callback in JSON company', async () => {
  await runCase('json', 'before-native-commit', 'company')
})
