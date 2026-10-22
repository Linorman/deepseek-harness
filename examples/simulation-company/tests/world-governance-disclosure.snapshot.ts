/** Attached proposal text in a non-goal context must retain its original permission across disclosure waits and cold restore. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

describe.each(['json', 'sqlite'])('%s non-goal governance disclosure', (backend) => {
  it.each(['company', 'laboratory'])('checks original vote access for %s at both disclosure boundaries', async (scenario) => {
    const temp = resolve('.local/world-completion/tmp')
    const evidence = resolve(process.env.WORLD_GOAL_DISCLOSURE_EVIDENCE_ROOT ?? '.local/world-completion/f07-goal-disclosure/loader')
    await mkdir(temp, { recursive: true }); await mkdir(evidence, { recursive: true })
    const face = process.env.CLOCKY_EXAMPLE_MODE ?? 'src'
    for (const boundary of ['cached', 'pre-step']) {
      const root = await mkdtemp(resolve(evidence, `${face}-${backend}-${scenario}-${boundary}-`))
      const source = resolve('examples/simulation-company/tests/world-governance-scenario.ts')
      const launch = resolveExampleLaunch({ srcBin: source, libBin: source, tsconfigPath: resolve('tsconfig.base.json'),
        configArgs: [resolve('examples/simulation-company/tests/fixtures/world-governance/cordis.yml')],
        env: { SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend, WORLD_SCENARIO: scenario,
          WORLD_GOVERNANCE_DISCLOSURE_BOUNDARY: boundary, TMPDIR: temp } })
      for (const recovering of [false, true]) {
        const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env,
          WORLD_DRIVER_RECOVER: String(recovering) }, stdio: ['ignore', 'pipe', 'pipe'] })
        const exited = once(child, 'exit').then((values: unknown[]) => values)
        let stdout = '', stderr = '', timedOut = false
        child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
        child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
        const timeout = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, 120000)
        try {
          const [code, signal] = await exited
          expect(timedOut).toBe(false); expect(signal).toBe(null); expect(code, stderr).toBe(0)
          expect(JSON.parse(stdout)).toEqual({ scenario, independentSessions: 2, actualVotes: 2,
            actualChannel: true, soleResolution: true, restored: recovering, modelCalls: recovering ? 0 : 39,
            disclosureBoundary: boundary })
        } finally {
          clearTimeout(timeout); child.kill('SIGKILL'); const [code, signal] = await exited
          await writeFile(resolve(root, recovering ? 'process-cold.json' : 'process-warm.json'), JSON.stringify({
            face, backend, scenario, boundary, recovering, pid: child.pid, command: launch.command, args: launch.args,
            exitCode: code, signal, timedOut, stdout, stderr }, null, 2) + '\n')
        }
      }
      await writeFile(resolve(root, 'complete.json'), JSON.stringify({ face, backend, scenario, boundary, root }) + '\n')
    }
  })
})
