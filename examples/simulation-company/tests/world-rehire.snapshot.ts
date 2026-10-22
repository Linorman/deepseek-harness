/** Existing identities, private memory and exact approved hiring survive an actual process cold restore. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

describe.each(['json', 'sqlite'])('%s actual rehire', (backend) => {
  it.each(['company', 'laboratory'])('retires then rehires the original Person and remembered Session in %s', async (scenario) => {
    const temp = resolve('.local/world-completion/tmp')
    await mkdir(temp, { recursive: true })
    const root = await mkdtemp(resolve(temp, 'world-rehire-'))
    const fixture = resolve('examples/simulation-company/tests/world-rehire-scenario.ts')
    const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
      configArgs: [resolve('examples/simulation-company/tests/fixtures/world-rehire/cordis.yml')],
      env: { SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend, WORLD_SCENARIO: scenario, TMPDIR: temp } })
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
          const mode = process.env.CLOCKY_EXAMPLE_MODE === 'lib' ? 'lib' : 'source'
          const evidence = resolve(temp, `world-rehire-${mode}-${backend}-${scenario}-${recover ? 'cold' : 'create'}`)
          await writeFile(`${evidence}.stdout.json`, output)
          await writeFile(`${evidence}.stderr.log`, errors)
          expect(code, errors).toBe(0)
          const result = JSON.parse(output) as { modelCalls: number }
          expect(result).toMatchObject({ scenario, retiredThenRehired: true, retiredActivationRejected: true,
            retiredNewNominationRejected: true, oldAssignmentClosed: true,
            originalIdentity: true, originalPersona: true, originalPrivateChannel: true,
            originalMemory: true, separatePersonnelCounts: true, originalParticipantHistory: true, actualNewActivationEpoch: true,
            retiredAnnouncementPreserved: true, originalAnnouncementProcessedAfterRehire: true,
            independentVoteSessions: 2, actualVotes: 4, approvedExistingPerson: true,
            missingApprovalRejected: true, uniqueAssignment: true, generatedPeople: 0, generationReservations: 0,
            independentFirstAction: true, privateCanaryLeaks: 0, exactCommitRetryNoAppend: true, restored: recover })
          if (recover) expect(result.modelCalls).toBe(0)
          else expect(result.modelCalls).toBeGreaterThan(0)
        } finally { child.kill('SIGKILL'); await exited }
      }
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
