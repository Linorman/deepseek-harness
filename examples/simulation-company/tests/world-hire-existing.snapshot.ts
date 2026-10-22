/** Existing identities, private memory and exact approved hiring survive an actual process cold restore. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

describe.each(['json', 'sqlite'])('%s existing-person hiring', (backend) => {
  it.each(['company', 'laboratory'])('reuses original identity and remembered Session in %s', async (scenario) => {
    const temp = resolve('.local/world-completion/tmp')
    const evidenceRoot = process.env.WORLD_ADMISSION_EVIDENCE_ROOT
    const face = process.env.CLOCKY_EXAMPLE_MODE ?? 'src'
    if (evidenceRoot !== undefined) await mkdir(evidenceRoot, { recursive: true })
    await mkdir(temp, { recursive: true })
    const root = await mkdtemp(resolve(evidenceRoot ?? temp, `world-hire-existing-${face}-${backend}-${scenario}-`))
    const fixture = resolve('examples/simulation-company/tests/world-hire-existing-scenario.ts')
    const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
      configArgs: [resolve('examples/simulation-company/tests/fixtures/world-hire-existing/cordis.yml')],
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
          expect(code, errors).toBe(0)
          const result = JSON.parse(output) as { modelCalls: number }
          expect(result).toMatchObject({ scenario, originalIdentity: true, originalPersona: true, originalPrivateChannel: true,
            originalMemory: true, independentVoteSessions: 2, actualVotes: 4, approvedExistingPerson: true,
            missingApprovalRejected: true, uniqueAssignment: true, generatedPeople: 0, generationReservations: 0,
            independentFirstAction: true, privateCanaryLeaks: 0, exactCommitRetryNoAppend: true, restored: recover })
          if (recover) expect(result.modelCalls).toBe(0)
          else expect(result.modelCalls).toBeGreaterThan(0)
        } finally {
          child.kill('SIGKILL'); const [code, signal] = await exited as unknown[]
          if (evidenceRoot !== undefined) await writeFile(resolve(root, recover ? 'cold-process.json' : 'warm-process.json'),
            JSON.stringify({ face, backend, scenario, recover, pid: child.pid, command: launch.command, args: launch.args,
              code, signal, stdout: output, stderr: errors }, null, 2) + '\n')
        }
      }
      if (evidenceRoot !== undefined) await writeFile(resolve(root, 'complete.json'),
        JSON.stringify({ face, backend, scenario, workflow: 'world-hire-existing' }) + '\n')
    } finally { if (evidenceRoot === undefined) await rm(root, { recursive: true, force: true }) }
  })
})
