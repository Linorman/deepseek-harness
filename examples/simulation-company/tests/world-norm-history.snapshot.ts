/** Real policy voting, enactment and single-case approved hiring use both Native backends and cold restore. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

describe.each(['json', 'sqlite'])('%s actual Norm history', (backend) => {
  it.each(['company', 'laboratory'])('requires actual separate approval before hiring in %s and restores originals', async (scenario) => {
    const temp = resolve('.local/world-completion/tmp')
    await mkdir(temp, { recursive: true })
    const evidence = process.env.WORLD_CHECKPOINT_HISTORY_EVIDENCE_ROOT
    if (evidence !== undefined) await mkdir(evidence, { recursive: true })
    const root = await mkdtemp(resolve(evidence ?? temp, 'world-norm-history-'))
    const fixture = resolve('examples/simulation-company/tests/world-norm-history-scenario.ts')
    const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
      configArgs: [resolve('examples/simulation-company/tests/fixtures/world-norm-history/cordis.yml')],
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
          const [code, signal] = await exited as unknown[]
          if (evidence !== undefined) await writeFile(resolve(root, recover ? 'cold-process.json' : 'warm-process.json'),
            JSON.stringify({ backend, scenario, recover, face: process.env.CLOCKY_EXAMPLE_MODE ?? 'src',
              command: launch.command, args: launch.args, pid: child.pid, code, signal, stdout: output, stderr: errors }, null, 2))
          expect(code, errors).toBe(0)
          const result = JSON.parse(output) as { modelCalls: number }
          expect(result).toMatchObject({ scenario, normVersions: 3, closures: 2, revoked: true, frozenViews: true,
            privateCanaryLeaks: 0, perHireApprovals: 1, independentVotes: 8,
            committedHires: 1, actualChannel: true, restored: recover })
          if (recover) expect(result.modelCalls).toBe(0)
          else expect(result.modelCalls).toBeGreaterThan(0)
        } finally { child.kill('SIGKILL'); await exited }
      }
    } finally { if (evidence === undefined) await rm(root, { recursive: true, force: true }) }
  })
})
