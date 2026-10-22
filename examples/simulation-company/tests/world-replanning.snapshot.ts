/** Planning exhaustion uses real model/tools and survives a new-process restore on both persistent backends. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

describe.each(['json', 'sqlite'])('%s World planning budget', (backend) => {
  it.each(['company', 'laboratory'])('stops %s after three recorded attempts and restores the same history', async (scenario) => {
    const evidenceRoot = process.env.WORLD_REPLANNING_EVIDENCE_ROOT
    const temp = resolve(evidenceRoot ?? '.local/world-director-mvp/tmp')
    const face = process.env.CLOCKY_EXAMPLE_MODE ?? 'src'
    await mkdir(temp, { recursive: true })
    const root = await mkdtemp(resolve(temp, `${face}-${backend}-${scenario}-`))
    const fixture = resolve('examples/simulation-company/tests/world-driver-scenario.ts')
    const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
      configArgs: [resolve('examples/simulation-company/tests/fixtures/world-driver/cordis.yml')],
      env: { SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend, WORLD_SCENARIO: scenario,
        WORLD_DRIVER_REPLAN: 'true', TMPDIR: resolve('.local/world-completion/tmp') } })
    const execute = async (recover: boolean) => {
      const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env,
        WORLD_DRIVER_RECOVER: String(recover) }, stdio: ['ignore', 'pipe', 'pipe'] })
      const exited = once(child, 'exit')
      let output = '', errors = ''
      child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString() })
      child.stderr.on('data', (chunk: Buffer) => { errors += chunk.toString() })
      try {
        const [code] = await exited as unknown[]
        expect(code, errors).toBe(0)
        expect(JSON.parse(output)).toEqual({ scenario, stop: 'plan-budget', plans: 3, requests: 1, hires: 0,
          stableStop: true, originalHistory: true, paused: true, modelCalls: recover ? 0 : 12 })
      } finally {
        child.kill('SIGKILL'); const [code, signal] = await exited as unknown[]
        if (evidenceRoot !== undefined) await writeFile(resolve(root, recover ? 'cold-process.json' : 'warm-process.json'),
          JSON.stringify({ face, backend, scenario, recover, pid: child.pid, command: launch.command, args: launch.args,
            code, signal, stdout: output, stderr: errors }, null, 2) + '\n')
      }
    }
    try {
      await execute(false); await execute(true)
      if (evidenceRoot !== undefined) await writeFile(resolve(root, 'complete.json'), JSON.stringify({ face, backend, scenario }) + '\n')
    } finally { if (evidenceRoot === undefined) await rm(root, { recursive: true, force: true }) }
  })
})
